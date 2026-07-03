// services/facebook/utils.js
const { humanLikeTyping } = require('../humanBehaviorService');

function normalizeFacebookProfileUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';

    let parsed;
    try {
        parsed = new URL(raw);
    } catch (err) {
        return '';
    }

    if (!/^(www\.)?facebook\.com$/i.test(parsed.hostname)) return '';

    const pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\/+$/, '/');
    const blocked = new Set([
        '/', '/login.php', '/home.php', '/groups/', '/groups', '/reels/', '/reels', '/watch/', '/watch',
        '/marketplace/', '/marketplace', '/events/', '/events', '/messages/', '/messages', '/notifications/',
        '/notifications', '/settings/', '/settings', '/profile.php', '/share/', '/share'
    ]);

    const normalizedPath = pathname.toLowerCase();
    if (blocked.has(normalizedPath)) return '';

    return `${parsed.origin}${pathname}${parsed.search || ''}`;
}

function normalizeFacebookUploadLandingUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';

    let parsed;
    try {
        parsed = new URL(raw);
    } catch (err) {
        return '';
    }

    if (!/^(www\.)?facebook\.com$/i.test(parsed.hostname)) return '';

    const pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\/+$/, '/');
    const blocked = new Set([
        '/', '/login.php', '/home.php', '/groups/', '/groups', '/reels/', '/reels', '/watch/', '/watch',
        '/marketplace/', '/marketplace', '/events/', '/events', '/messages/', '/messages', '/notifications/',
        '/notifications', '/settings/', '/settings', '/share/', '/share', '/help/', '/help', '/privacy/', '/privacy',
        '/gaming/', '/gaming', '/ads/', '/ads', '/business/', '/business'
    ]);

    const normalizedPath = pathname.toLowerCase();
    if (blocked.has(normalizedPath)) return '';

    return `${parsed.origin}${pathname}${parsed.search || ''}`;
}

function normalizePublishedFacebookUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';

    try {
        const parsed = new URL(raw);
        if (!/^(www\.)?facebook\.com$/i.test(parsed.hostname)) return '';

        const path = parsed.pathname.replace(/\/+$/, '/');
        const lower = path.toLowerCase();

        if (lower.includes('/reel/') || lower.includes('/reels/') || lower.includes('/posts/')) {
            return `${parsed.origin}${path}${parsed.search || ''}`;
        }

        if ((lower.includes('/permalink.php') || lower.includes('/story.php')) && (parsed.searchParams.get('story_fbid') || parsed.searchParams.get('id'))) {
            return `${parsed.origin}${path}${parsed.search || ''}`;
        }
    } catch (err) {
        return '';
    }

    return '';
}

function isLikelyFacebookProfilePath(pathname = '') {
    const normalized = String(pathname || '').toLowerCase();
    if (!normalized || normalized === '/' || normalized === '/login.php' || normalized === '/home.php') return false;

    const blockedPrefixes = [
        '/groups', '/reels', '/watch', '/marketplace', '/events', '/messages', '/notifications',
        '/settings', '/login', '/recover', '/gaming', '/help', '/privacy', '/pages', '/ads', '/business'
    ];

    return !blockedPrefixes.some(prefix => normalized.startsWith(prefix));
}

async function extractFacebookProfileUrlFromPage(page) {
    const currentUrl = page?.url?.() || '';
    const normalizedCurrent = normalizeFacebookProfileUrl(currentUrl);
    if (normalizedCurrent) return normalizedCurrent;

    return page.evaluate(() => {
        const blocked = new Set([
            'login.php', 'home.php', 'groups', 'reels', 'watch', 'marketplace', 'events', 'messages',
            'notifications', 'settings', 'share', 'help', 'privacy', 'gaming', 'pages', 'ads', 'business'
        ]);

        const anchors = Array.from(document.querySelectorAll('a[href*="facebook.com/"]'));
        for (const anchor of anchors) {
            const href = anchor.getAttribute('href') || '';
            try {
                const url = new URL(href, location.origin);
                if (!/facebook\.com$/i.test(url.hostname) && !/\.facebook\.com$/i.test(url.hostname)) continue;

                const pathname = url.pathname.replace(/\/+$/, '').replace(/^\/+/, '');
                if (!pathname) continue;
                const firstSegment = pathname.split('/')[0].toLowerCase();
                if (blocked.has(firstSegment)) continue;

                return `${url.origin}${url.pathname}${url.search || ''}`.replace(/\/$/, '/');
            } catch (err) {
                continue;
            }
        }
        return '';
    }).then((url) => normalizeFacebookProfileUrl(url)).catch(() => '');
}

function stopFacebookProfileUrlWatcher(sessionKey) {
    const { PROFILE_URL_WATCHERS } = require('./session');
    const watcher = PROFILE_URL_WATCHERS.get(sessionKey);
    if (watcher?.timer) {
        clearInterval(watcher.timer);
    }
    PROFILE_URL_WATCHERS.delete(sessionKey);
}

function startFacebookProfileUrlWatcher({ sessionKey, userId, channelId, accountName, accountType, maxWaitMs = 10 * 60 * 1000, intervalMs = 4000 }) {
    if (!sessionKey || !userId || !channelId) return;
    const { PROFILE_URL_WATCHERS, ACTIVE_FB_SESSIONS } = require('./session');
    if (PROFILE_URL_WATCHERS.has(sessionKey)) return;

    const startedAt = Date.now();
    const watcher = { timer: null };

    watcher.timer = setInterval(async () => {
        try {
            const session = ACTIVE_FB_SESSIONS.get(sessionKey);
            if (!session?.context) {
                stopFacebookProfileUrlWatcher(sessionKey);
                return;
            }

            const page = session.page || session.context.pages()[0] || await session.context.newPage();
            const profileUrl = await extractFacebookProfileUrlFromPage(page);
            if (profileUrl) {
                const Channel = require('../../models/Channel');
                await Channel.updateOne(
                    { _id: channelId, userId },
                    { $set: { profileUrl } }
                );
                console.log(`[FB Connect] Auto-attached profileUrl for ${accountName} (${accountType}): ${profileUrl}`);
                stopFacebookProfileUrlWatcher(sessionKey);
                return;
            }

            if (Date.now() - startedAt > maxWaitMs) {
                stopFacebookProfileUrlWatcher(sessionKey);
            }
        } catch (error) {
            console.error('[FB Connect] Profile URL watcher error:', error.message || error);
            if (Date.now() - startedAt > maxWaitMs) {
                stopFacebookProfileUrlWatcher(sessionKey);
            }
        }
    }, intervalMs);

    PROFILE_URL_WATCHERS.set(sessionKey, watcher);
}

/**
 * Dọn các Facebook sessions KHÔNG còn được sử dụng.
 *
 * Mỗi session giữ 1 Playwright context (200-400MB RAM).
 * Khi user đóng browser nhưng không logout, session vẫn nằm trong ACTIVE_FB_SESSIONS.
 * Cron này chạy mỗi 30 phút, xóa session idle > `maxIdleMs` (mặc định 30 phút).
 *
 * @param {number} maxIdleMs - Sessions idle quá thời gian này sẽ bị xóa (mặc định 30 phút)
 * @returns {{checked: number, cleaned: number, active: number}}
 */
function cleanupStaleFbSessions(maxIdleMs = 30 * 60 * 1000) {
    const { ACTIVE_FB_SESSIONS } = require('./session');
    const now = Date.now();
    let cleaned = 0;
    let active = 0;
    const checked = ACTIVE_FB_SESSIONS.size;

    for (const [key, session] of ACTIVE_FB_SESSIONS) {
        const lastUsed = session.lastUsedAt || session.createdAt || 0;
        const idleMs = now - lastUsed;

        if (idleMs > maxIdleMs) {
            // Đóng context an toàn
            try {
                if (session.context?.close) {
                    session.context.close().catch(() => {});
                }
            } catch (e) { /* ignore */ }
            ACTIVE_FB_SESSIONS.delete(key);
            cleaned++;
            console.log(`[FB Cleanup] Removed stale session "${key}" (idle ${Math.round(idleMs / 60000)}min)`);
        } else {
            active++;
        }
    }

    if (cleaned > 0) {
        console.log(`[FB Cleanup] Done. Checked=${checked}, Cleaned=${cleaned}, Active=${active}`);
    }

    return { checked, cleaned, active };
}

/**
 * Đánh dấu session vừa được dùng — dùng cho cleanup.
 * Gọi ở các điểm user tương tác (open, scan, post...).
 */
function touchFbSession(sessionKey) {
    if (!sessionKey) return;
    const { ACTIVE_FB_SESSIONS } = require('./session');
    const session = ACTIVE_FB_SESSIONS.get(sessionKey);
    if (session) {
        session.lastUsedAt = Date.now();
    }
}

/**
 * Cron job: dọn sessions idle > 30 phút, chạy mỗi 30 phút.
 * Idempotent: gọi nhiều lần chỉ tạo 1 interval.
 */
let cleanupCronStarted = false;
let cleanupCronTimer = null;
function startFbSessionCleanupCron(intervalMs = 30 * 60 * 1000) {
    if (cleanupCronStarted) return;
    cleanupCronStarted = true;
    cleanupCronTimer = setInterval(() => {
        try {
            cleanupStaleFbSessions();
        } catch (e) {
            console.error('[FB Cleanup] Cron error:', e.message);
        }
    }, intervalMs);
    console.log(`[FB Cleanup] Cron started (interval=${intervalMs / 60000}min)`);
}

function stopFbSessionCleanupCron() {
    if (cleanupCronTimer) {
        clearInterval(cleanupCronTimer);
        cleanupCronTimer = null;
    }
    cleanupCronStarted = false;
    console.log('[FB Cleanup] Cron stopped');
}

async function findFirstVisibleLocator(page, selectors = [], label = 'field') {
    for (const selector of selectors) {
        const locator = page.locator(selector).first();
        const count = await locator.count().catch(() => 0);
        console.log(`[Reels Upload] ${label}: selector=${selector}, count=${count}`);
        if (!count) continue;

        const isVisible = await locator.isVisible().catch(() => false);
        if (isVisible) return locator;
    }

    return null;
}

async function writeTextIntoLocator(page, locator, text, label = 'field') {
    const trimmed = String(text || '').trim();
    const count = await locator.count().catch(() => 0);
    console.log(`[Reels Upload] ${label}: locator count = ${count}, text length = ${trimmed.length}`);

    if (!count || !trimmed) return false;

    const target = locator.first();
    try {
        await target.waitFor({ state: 'visible', timeout: 15000 });
    } catch (err) {
        console.log(`[Reels Upload] ${label}: not visible -> ${err.message || err}`);
        return false;
    }

    try {
        const isEditable = await target.evaluate((el) => {
            const tag = (el?.tagName || '').toLowerCase();
            const role = String(el?.getAttribute?.('role') || '').toLowerCase();
            return tag === 'textarea' || tag === 'input' || role === 'textbox' || el?.isContentEditable;
        }).catch(() => false);

        console.log(`[Reels Upload] ${label}: editable=${Boolean(isEditable)}`);

        if (isEditable) {
            await target.click({ force: true }).catch(() => {});
            const tagName = await target.evaluate((el) => String(el?.tagName || '').toLowerCase()).catch(() => '');

            if (tagName === 'input' || tagName === 'textarea') {
                await target.fill(trimmed);
            } else {
                await target.focus().catch(() => {});
                await target.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
                await target.press('Backspace').catch(() => {});
                await humanLikeTyping(page, trimmed);
            }

            await page.waitForTimeout(500);
            const after = await target.evaluate((el) => (el.value ?? el.innerText ?? el.textContent ?? '')).catch(() => '');
            console.log(`[Reels Upload] ${label}: after write length=${String(after || '').length}`);
            return true;
        }

        await target.click({ force: true }).catch(() => {});
        const typed = await writeTextToActiveElement(page, trimmed, `${label}-active`).catch(() => false);
        if (typed) return true;
        await humanLikeTyping(page, trimmed);
        return true;
    } catch (err) {
        console.log(`[Reels Upload] ${label}: write failed -> ${err.message || err}`);
        return false;
    }
}

async function writeTextToActiveElement(page, text, label = 'active-element') {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;

    try {
        const active = page.locator(':focus').first();
        const count = await active.count().catch(() => 0);
        if (count) {
            const tagName = await active.evaluate((el) => String(el?.tagName || '').toLowerCase()).catch(() => '');
            if (tagName === 'input' || tagName === 'textarea') {
                await active.fill(trimmed).catch(() => {});
            } else {
                await active.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => {});
                await active.press('Backspace').catch(() => {});
                await humanLikeTyping(page, trimmed);
            }
        } else {
            await humanLikeTyping(page, trimmed);
        }

        await page.waitForTimeout(300);

        const activeValue = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active) return '';
            return String(active.value ?? active.innerText ?? active.textContent ?? '');
        }).catch(() => '');

        console.log(`[Reels Upload] ${label}: active element value length=${String(activeValue || '').length}`);
        return true;
    } catch (err) {
        console.log(`[Reels Upload] ${label}: write active failed -> ${err.message || err}`);
        return false;
    }
}

async function waitForCaptionEditor(page, selectors = [], { timeoutMs = 15000, intervalMs = 1000, label = 'caption' } = {}) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
        const locator = await findFirstVisibleLocator(page, selectors, label);
        if (locator) return locator;
        await page.waitForTimeout(intervalMs);
    }

    return null;
}

module.exports = {
    normalizeFacebookProfileUrl,
    normalizeFacebookUploadLandingUrl,
    normalizePublishedFacebookUrl,
    isLikelyFacebookProfilePath,
    extractFacebookProfileUrlFromPage,
    stopFacebookProfileUrlWatcher,
    startFacebookProfileUrlWatcher,
    findFirstVisibleLocator,
    writeTextIntoLocator,
    writeTextToActiveElement,
    waitForCaptionEditor,
    startFbSessionCleanupCron
};