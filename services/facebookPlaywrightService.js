const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const FacebookGroupCache = require('../models/FacebookGroupCache');
const { platform } = require('os');
const {
    randomWait,
    gaussianRandom,
    humanLikeTyping,
    humanLikeMouseMove,
    humanLikeClick,
    humanLikeScroll,
    warmUp,
    simulateHumanAfterPost
} = require('./humanBehaviorService');

// ===== ANTI-DETECTION: Tắt banner "Chrome is being controlled" qua Windows Registry =====
(function suppressChromeWarning() {
    if (process.platform !== 'win32') return;
    try {
        const { execSync } = require('child_process');
        execSync('reg delete "HKEY_CURRENT_USER\\Software\\Google\\Chrome" /v SuppressInfobarEnabled /f 2>nul', { stdio: 'ignore' });
        execSync('reg add "HKEY_CURRENT_USER\\Software\\Google\\Chrome" /v SuppressInfobarEnabled /t REG_DWORD /d 1 /f', { stdio: 'ignore' });
        execSync('reg add "HKEY_CURRENT_USER\\Software\\Policies\\Google\\Chrome" /v SuppressInfobarEnabled /t REG_DWORD /d 1 /f 2>nul', { stdio: 'ignore' });
    } catch (e) { /* silent */ }
})();

const SESSION_ROOT = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'social-sessions'); // Thư mục tập trung

const FACEBOOK_URL = 'https://www.facebook.com/';
const FACEBOOK_GROUPS_URL = 'https://www.facebook.com/groups/';
const FACEBOOK_GROUPS_FEED_URL = 'https://www.facebook.com/groups/feed/';
const FACEBOOK_GROUPS_YOU_URL = 'https://www.facebook.com/groups/you/';
const FACEBOOK_REELS_URL = 'https://www.facebook.com/reels/';
const PROFILE_URL_WATCHERS = global.__facebookProfileUrlWatchers || (global.__facebookProfileUrlWatchers = new Map());
const ACTIVE_FB_SESSIONS = new Map();
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}
function sanitizeFolderName(value = '') {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9ก-๙_-]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'account';
}

function buildFacebookAccountFolder(userId, accountName, platform = 'FB') {
    const safeAccountName = sanitizeFolderName(accountName);
    // Chuyển platform về dạng viết hoa để đồng bộ (ví dụ: fb -> FB)
    
    // Đường dẫn bây giờ sẽ là: SESSION_ROOT/userId/tên-tài-khoản-NỀN-TẢNG
    return path.join(SESSION_ROOT, String(userId), `${safeAccountName}-${platform}`);
}
async function getOrOpenFacebookContext(userId, accountName, platform, { headless = false } = {}) {
    if (!userId || !accountName) throw new Error('Missing userId or accountName');

    ensureDir(SESSION_ROOT);
    const userSessionDir = buildFacebookAccountFolder(userId, accountName, platform || 'FB');
    ensureDir(userSessionDir);

    const sessionKey = `${userId}:${userSessionDir}`;
    
    // Kiểm tra session đang hoạt động
    const existingSession = ACTIVE_FB_SESSIONS.get(sessionKey);
    if (existingSession?.context && !existingSession.context.isClosed()) {
        return { context: existingSession.context, userSessionDir, sessionKey, reusedSession: true };
    }

    // Khởi tạo persistent context mới - Anti-detection
    console.log(`[FB Playwright] Opening session: ${userSessionDir} (headless=${headless})`);
    const context = await chromium.launchPersistentContext(userSessionDir, {
        headless: headless,
        channel: 'chrome',
        viewport: null,
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=TranslateUI,AutomationControlled',
            '--no-default-browser-check',
            '--disable-component-update',
            '--disable-sync',
            '--disable-background-networking',
            '--disable-dev-shm-usage',
            '--disable-breakpad',
            '--disable-crash-reporter',
            '--mute-audio'
        ],
        ignoreDefaultArgs: ['--enable-automation', '--enable-logging'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });

    // Inject script chống detection vào tất cả các page (dùng enhanced version)
    const { getAntiDetectionScript } = require('./humanBehaviorService');
    context.on('page', async (page) => {
        await page.addInitScript(getAntiDetectionScript());
    });

    ACTIVE_FB_SESSIONS.set(sessionKey, { context, userSessionDir, accountName, headless });

    // Dọn dẹp bộ nhớ khi đóng
    context.on('close', () => ACTIVE_FB_SESSIONS.delete(sessionKey));

    return { context, userSessionDir, sessionKey, reusedSession: false };
}
async function openFacebookLoginWindow(userId, accountName,accountType = 'Cá nhân', platform = 'FB') {
    // 1. Mở context (headless: false bắt buộc)
    const { context, userSessionDir } = await getOrOpenFacebookContext(userId, accountName, platform, { headless: false });

    const page = context.pages()[0] || await context.newPage();
    
    await page.bringToFront();
    
    if (!page.url().includes('facebook.com')) {
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
    }

    // 2. GIỮ TRÌNH DUYỆT SỐNG: Trả về một Promise chỉ resolve khi user đóng trình duyệt
    return new Promise((resolve) => {
        console.log(`Đang chờ bạn đăng nhập tài khoản "${accountName}"...`);
        
        // Khi user chủ động đóng trình duyệt, sự kiện 'close' sẽ kích hoạt
        context.once('close', () => {
            console.log("Trình duyệt đã đóng, kết thúc phiên làm việc.");
            resolve({
                success: true,
                message: `Đã hoàn tất phiên làm việc cho "${accountName}".`,
                sessionDir: userSessionDir,
                accountName,
                accountType
            });
        });
    });
}

function buildInvalidGroupSegments() {
    return new Set([
        'feed', 'discover', 'create', 'search', 'settings', 'joined', 'your', 'invites', 'pending',
        'suggestions', 'popular', 'explore', 'recommendations', 'feeds', 'top_chats', 'groups'
    ]);
}

function normalizeGroupLabel(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
}

async function extractFacebookGroupsFromPage(page, invalidSegments) {
    return page.evaluate(({ invalidSegmentsList }) => {
        const normalizeText = (value = '') => String(value).replace(/\s+/g, ' ').trim();
        const invalidSegments = new Set(invalidSegmentsList || []);

        const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
        const items = [];

        anchors.forEach((anchor) => {
            const rawHref = anchor.getAttribute('href') || '';
            const label = normalizeText(anchor.innerText || anchor.textContent || '');
            if (!rawHref || !label) return;

            let url;
            try {
                url = new URL(rawHref, location.origin);
            } catch (err) {
                return;
            }

            const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
            if (!match) return;

            const groupId = match[1].trim();
            if (!groupId || invalidSegments.has(groupId.toLowerCase())) return;
            if (label.length < 2) return;

            items.push({
                groupId,
                groupUrl: url.toString(),
                groupName: label
            });
        });

        return items;
    }, { invalidSegmentsList: Array.from(invalidSegments) });
}

// Hàm quét group mới - dùng $$eval như code mẫu
async function extractFacebookGroupsFromPageV2(page) {
    return page.$$eval('a[href*="/groups/"]', elements => {
        return elements
            .filter(el => {
                const href = el.href;
                const text = el.innerText.trim();
                // Chi lay link co ID nhom, bo qua menu
                const isGroupLink = /\/groups\/\d+\/$/.test(href);
                const isMenuLink = href.includes('/joins') || href.includes('/feed') || href.includes('/discover') || 
                                   href.includes('/search') || href.includes('/settings') || href.includes('/create') ||
                                   href.includes('/members') || href.includes('/photos') || href.includes('/videos') || href.includes('/files');
                return isGroupLink && !isMenuLink && text !== "" && text !== "Xem nhom";
            })
            .map(el => ({ name: el.innerText.split('\n')[0], url: el.href }));
    });
}

// Quet group tu trang joins voi bao cao tien trinh
async function scrapeGroupsFromJoinsPage({ page, maxScrollRounds = 5, scrollDelayMs = 3000, onProgress, onGroupsFound, maxGroups = 0 }) {
    const joinsUrl = 'https://www.facebook.com/groups/joins/?nav_source=tab';
    return scrapeGroupsFromUrl({ page, targetUrl: joinsUrl, maxScrollRounds, scrollDelayMs, onProgress, onGroupsFound, maxGroups });
}

// Quet group tu 1 group cu the hoac URL tuy chinh - voi bao cao tien trinh va gioi han maxGroups
async function scrapeGroupsFromUrl({ page, targetUrl, maxScrollRounds = 5, scrollDelayMs = 3000, scrollAmount = 3000, onProgress, onGroupsFound, maxGroups = 0 }) {
    const discoveredById = new Map(); // Key: groupId -> group object
    let retryCount = 0;
    let lastHeight = 0;
    let totalNewGroups = 0;
    
    // console.log(`[Group Scrape] Starting scrape from: ${targetUrl}, maxGroups: ${maxGroups || 'unlimited'}`);
    
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);

    // Bao cao bat dau
    if (onProgress) onProgress({ phase: 'loading', message: 'Dang tai trang...', found: 0, newGroups: 0 });

    while (retryCount < maxScrollRounds) {
        // Kiem tra neu da dat gioi han maxGroups
        if (maxGroups > 0 && discoveredById.size >= maxGroups) {
        // console.log(`[Group Scrape] Da dat gioi han ${maxGroups} groups, dung lai`);
            break;
        }

        // Dung $$eval nhu code mau
        const currentGroups = await page.$$eval('a[href*="/groups/"]', elements => {
            return elements
                .filter(el => {
                    const href = el.href;
                    const text = el.innerText.trim();
                    // Chi lay link co ID nhom, bo qua menu
                    const isGroupLink = /\/groups\/\d+\/$/.test(href);
                    const isMenuLink = href.includes('/joins') || href.includes('/feed') || href.includes('/discover') || 
                                       href.includes('/search') || href.includes('/settings') || href.includes('/create') ||
                                       href.includes('/members') || href.includes('/photos') || href.includes('/videos') || href.includes('/files');
                    return isGroupLink && !isMenuLink && text !== "" && text !== "Xem nhom";
                })
                .map(el => ({ name: el.innerText.split('\n')[0], url: el.href }));
        });

        let newGroups = 0;
        const newFoundGroups = [];
        for (const group of currentGroups) {
            // Trich xuat groupId tu URL
            const match = group.url.match(/\/groups\/(\d+)\//);
            if (!match) continue;
            const groupId = match[1];
            
            // Chi them neu chua co
            if (!discoveredById.has(groupId)) {
                const groupData = {
                    groupId: groupId,
                    groupUrl: group.url,
                    groupName: group.name
                };
                discoveredById.set(groupId, groupData);
                newFoundGroups.push(groupData);
                newGroups++;
                totalNewGroups++;
                
                // Neu dat gioi han maxGroups thi dung
                if (maxGroups > 0 && discoveredById.size >= maxGroups) {
                    // console.log(`[Group Scrape] Da dat gioi han ${maxGroups} groups`);
                    break;
                }
            }
        }
        
        // Goi callback khi co group moi - de luu vao DB ngay lap tuc
        if (onGroupsFound && newFoundGroups.length > 0) {
            const currentGroupsArray = Array.from(discoveredById.values());
            try {
                await onGroupsFound(currentGroupsArray, newFoundGroups);
            } catch (e) {
                // console.log(`[Group Scrape] Loi khi goi onGroupsFound: ${e.message}`);
            }
        }
        
        // Bao cao tien trinh
        if (onProgress) {
            onProgress({ 
                phase: 'scraping', 
                message: `Da tim thay ${discoveredById.size} group...`, 
                found: discoveredById.size,
                newGroups: totalNewGroups,
                round: retryCount + 1,
                maxRounds: maxScrollRounds
            });
        }
        
        // console.log(`[Group Scrape] Found ${currentGroups.length} groups, ${newGroups} new. Total: ${discoveredById.size}`);
        
        // Cuon trang
        await page.mouse.wheel(0, scrollAmount || 3000);
        await page.waitForTimeout(scrollDelayMs);

        const newHeight = await page.evaluate('document.body.scrollHeight');
        if (newHeight === lastHeight) {
            retryCount++;
        } else {
            retryCount = 0;
            lastHeight = newHeight;
        }
    }

    // Bao cao hoan tat
    if (onProgress) {
        onProgress({ 
            phase: 'complete', 
            message: `Hoan tat! Da tim thay ${discoveredById.size} group`, 
            found: discoveredById.size,
            newGroups: totalNewGroups
        });
    }

    // Tra ve danh sach da loai bo trung, sap xep theo ten
    return Array.from(discoveredById.values())
        .filter(group => group.groupName && group.groupId)
        .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));
}

async function scanFacebookGroups({
    page,
    candidateUrls,
    invalidSegments,
    initialWaitMs,
    maxRoundsPerUrl,
    scrollWaitMs,
    stableThreshold,
    stopAfterStablePasses,
    discovered
}) {
    const discoveredMap = discovered || new Map();

    const addGroupsFromPage = async () => {
        const pageGroups = await extractFacebookGroupsFromPage(page, invalidSegments);
        let added = 0;
        for (const group of pageGroups) {
            const key = `${group.groupId}|${group.groupUrl}`;
            if (!discoveredMap.has(key)) {
                discoveredMap.set(key, group);
                added += 1;
            }
        }
        return added;
    };

    let stablePasses = 0;
    for (const url of candidateUrls) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(initialWaitMs);

        let previousCount = -1;
        let stableRounds = 0;
        for (let round = 0; round < maxRoundsPerUrl; round++) {
            await addGroupsFromPage();

            const currentCount = discoveredMap.size;
            if (currentCount === previousCount) {
                stableRounds += 1;
            } else {
                stableRounds = 0;
                previousCount = currentCount;
            }

            if (stableRounds >= stableThreshold) break;

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
            await page.waitForTimeout(scrollWaitMs);
        }
    }

    // Khi goi theo vong quet sau, ham ben ngoai se quyet dinh co lap lai hay khong.
    // O day chi tra ve map hien tai de tai su dung.
    return discoveredMap;
}

async function getOrOpenFacebookContext(userId, accountName, accountType, platform = 'FB', { headless = true } = {}) {
    if (!userId) throw new Error('Missing user id');
    if (!accountName || !String(accountName).trim()) {
        throw new Error('Vui lòng nhập tên tài khoản Facebook');
    }

    // 1. Chuẩn bị đường dẫn
    ensureDir(SESSION_ROOT);
    const userSessionDir = buildFacebookAccountFolder(userId, accountName, platform);
    ensureDir(userSessionDir);

    // 2. Tạo key định danh duy nhất (userId + tên account đã sanitize)
    const folderName = path.basename(userSessionDir);
    const sessionKey = `${userId}:${folderName}`;
    
    // console.log(`[Facebook Context] Requesting context for: ${sessionKey}, headless: ${headless}`);

    // 3. Kiểm tra trong RAM (ACTIVE_FB_SESSIONS)
    const existingSession = ACTIVE_FB_SESSIONS.get(sessionKey);
    
    if (existingSession && existingSession.context && !existingSession.context.isClosed()) {
        console.log(`[Facebook Context] Reusing existing active session from RAM: ${sessionKey}`);
        return { 
            context: existingSession.context, 
            userSessionDir, 
            sessionKey, 
            reusedSession: true 
        };
    }

    // Nếu không có trong RAM, nhưng có thể đã từng chạy trước khi restart server
    // thì lệnh launchPersistentContext bên dưới sẽ tự động load lại Cookies từ thư mục.
    if (existingSession) {
        ACTIVE_FB_SESSIONS.delete(sessionKey);
    }

    // 4. Dọn dẹp lock file Chrome cũ && kill Chrome process đang dùng cùng user-data-dir
    try {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'Singleton'];
        for (const lockFile of lockFiles) {
            const lockPath = path.join(userSessionDir, lockFile);
            if (fs.existsSync(lockPath)) {
                fs.unlinkSync(lockPath);
                console.log(`[Facebook Context] Removed stale lock file: ${lockPath}`);
            }
        }
    } catch (e) {
        // Không quan trọng nếu không xóa được
    }

    // Kill any Chrome process that may still be using this user-data-dir
    try {
        const { execSync } = require('child_process');
        // Kill all chrome.exe processes that reference this session dir
        try {
            const wmicOutput = execSync(`wmic process where "name='chrome.exe'" get CommandLine,ProcessId /format:list`, { encoding: 'utf-8', timeout: 5000 });
            const lines = wmicOutput.split('\n');
            let currentPid = '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('ProcessId=')) {
                    currentPid = trimmed.replace('ProcessId=', '').trim();
                }
                if (trimmed.startsWith('CommandLine=') && trimmed.includes(path.basename(userSessionDir)) && currentPid) {
                    console.log(`[Facebook Context] Killing stale Chrome process PID=${currentPid} using ${path.basename(userSessionDir)}`);
                    try { execSync(`taskkill /F /PID ${currentPid}`, { stdio: 'ignore', timeout: 3000 }); } catch (e) { }
                    currentPid = '';
                }
            }
        } catch (wmicErr) {
            // wmic may not be available, fallback is fine
        }
        // Wait a moment for processes to fully terminate
        await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
        // Non-critical, continue anyway
    }

    // 5. Khởi tạo (hoặc nạp lại) context - Anti-detection (with retry)
    console.log(`[Facebook Context] Launching new/persistent context for: ${sessionKey}`);
    let context;
    const launchOptions = {
        headless: headless,
        channel: 'chrome',
        viewport: null,
        args: [
            '--no-sandbox',
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=TranslateUI,AutomationControlled',
            '--no-default-browser-check',
            '--disable-component-update',
            '--disable-sync',
            '--disable-background-networking',
            '--disable-dev-shm-usage',
            '--disable-breakpad',
            '--disable-crash-reporter',
            '--mute-audio'
        ],
        ignoreDefaultArgs: ['--enable-automation', '--enable-logging'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            context = await chromium.launchPersistentContext(userSessionDir, launchOptions);
            break; // Success
        } catch (launchErr) {
            console.error(`[Facebook Context] Launch attempt ${attempt + 1} failed: ${launchErr.message}`);
            if (attempt < MAX_RETRIES) {
                // Clean up lock files again and retry
                try {
                    for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
                        const lockPath = path.join(userSessionDir, lockFile);
                        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
                    }
                } catch (e) { }
                // Force kill all chrome processes on retry
                try {
                    require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore', timeout: 5000 });
                    await new Promise(r => setTimeout(r, 2000));
                } catch (e) { }
            } else {
                throw launchErr;
            }
        }
    }

    // Inject script chống detection vào tất cả các page mới
    const { getAntiDetectionScript } = require('./humanBehaviorService');
    context.on('page', async (page) => {
        await page.addInitScript(getAntiDetectionScript());
    });

    // 5. Lưu vào RAM để lần tới gọi không cần khởi tạo lại
    ACTIVE_FB_SESSIONS.set(sessionKey, {
        context,
        userSessionDir,
        accountName,
        platform,
        headless
    });

    // 6. Xử lý dọn dẹp khi trình duyệt bị tắt
    context.on('close', () => {
        console.log(`[Facebook Context] Session closed: ${sessionKey}`);
        ACTIVE_FB_SESSIONS.delete(sessionKey);
    });

    return { 
        context, 
        userSessionDir, 
        sessionKey, 
        reusedSession: false 
    };
}

async function openFacebookLoginWindow(userId, accountName, accountType = 'Cá nhân', platform = 'FB') {
    // 1. Kiểm tra xem đã có session nào đang chạy trong RAM chưa
    // Nếu có, chỉ cần focus vào nó, không được khởi tạo lại!
    const folderName = path.basename(buildFacebookAccountFolder(userId, accountName));
    const sessionKey = `${userId}:${folderName}`;
    
    if (ACTIVE_FB_SESSIONS.has(sessionKey)) {
        console.log("Session đã mở rồi, không khởi tạo lại.");
        const { context } = ACTIVE_FB_SESSIONS.get(sessionKey);
        const page = context.pages()[0];
        if (page) await page.bringToFront();
        return { success: true, message: "Trình duyệt đang mở sẵn." };
    }

    // 2. Nếu chưa có, mới gọi getOrOpenFacebookContext
    const { context } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: false });

    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront();
    
    // Chỉ vào FB nếu trang hiện tại chưa phải FB
    if (!page.url().includes('facebook.com')) {
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
    }

    return { success: true, message: "Đã mở trình duyệt lần đầu." };
}

async function getJoinedFacebookGroups(userId, accountName, accountType = 'Cá nhân',platform = 'FB') {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, platform, { headless: true });

    try {
        const page = context.pages()[0] || await context.newPage();
        const discovered = await scanFacebookGroups({
            page,
            candidateUrls: [FACEBOOK_GROUPS_YOU_URL, FACEBOOK_GROUPS_FEED_URL, FACEBOOK_GROUPS_URL],
            invalidSegments: buildInvalidGroupSegments(),
            initialWaitMs: 2500,
            maxRoundsPerUrl: 10,
            scrollWaitMs: 1800,
            stableThreshold: 2
        });

        return Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'));
    } finally {
        if (isExternal) {
            await context.close().catch(() => {});
            ACTIVE_FB_SESSIONS.delete(sessionKey);
        }
    }
}

async function persistFacebookGroupCache({ userId, channelId, accountName, accountType, groups }) {
    const result = await FacebookGroupCache.findOneAndUpdate(
        { userId, channelId },
        {
            userId,
            channelId,
            accountName,
            accountType: accountType || 'Cá nhân',
            groups,
            updatedAt: new Date()
        },
        { upsert: true, new: true }
    );
    console.log(`[Group Cache] Saved ${groups.length} groups for user ${userId}, channel ${channelId}`);
    return result;
}

function normalizeShopeeLinksInput(shopeeLinks) {
    if (!shopeeLinks) return [];

    if (Array.isArray(shopeeLinks)) {
        return shopeeLinks.map(link => String(link || '').trim()).filter(Boolean);
    }

    if (typeof shopeeLinks === 'string') {
        return shopeeLinks
            .split(/[\n,;]/)
            .map(link => String(link || '').trim())
            .filter(Boolean);
    }

    return [String(shopeeLinks).trim()].filter(Boolean);
}

function buildAffiliateCaptionText(shopeeLinks = []) {
    // Caption cua Reels chi giu noi dung chinh; affiliate link se duoc dang o comment rieng.
    if (!Array.isArray(shopeeLinks) || !shopeeLinks.length) return '';
    return '';
}

function buildAffiliateCommentTexts(shopeeLinks = []) {
    if (!Array.isArray(shopeeLinks) || !shopeeLinks.length) return [];

    return shopeeLinks
        .map((link) => String(link || '').trim())
        .filter(Boolean)
        .map((link) => `Mua san pham trong video tai day nha moi nguoi: ${link}`);
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
                await target.type(trimmed, { delay: 20 });
            }

            await page.waitForTimeout(500);
            const after = await target.evaluate((el) => (el.value ?? el.innerText ?? el.textContent ?? '')).catch(() => '');
            console.log(`[Reels Upload] ${label}: after write length=${String(after || '').length}`);
            return true;
        }

        await target.click({ force: true }).catch(() => {});
        const typed = await writeTextToActiveElement(page, trimmed, `${label}-active`).catch(() => false);
        if (typed) return true;
        await page.keyboard.type(trimmed, { delay: 20 }).catch(() => {});
        return true;
    } catch (err) {
        console.log(`[Reels Upload] ${label}: write failed -> ${err.message || err}`);
        return false;
    }
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
                await active.type(trimmed, { delay: 20 }).catch(() => {});
            }
        } else {
            await page.keyboard.type(trimmed, { delay: 20 }).catch(() => {});
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

function buildFacebookReelsTargetUrl(profileUrl = '') {
    const normalizedProfileUrl = normalizeFacebookProfileUrl(profileUrl);
    if (!normalizedProfileUrl) return FACEBOOK_REELS_URL;

    try {
        const url = new URL(normalizedProfileUrl);
        const pathname = url.pathname.toLowerCase();

        if (pathname.includes('/reels')) {
            return normalizedProfileUrl;
        }

        if (pathname.includes('profile.php')) {
            return FACEBOOK_REELS_URL;
        }

        const basePath = url.pathname.replace(/\/+$/, '');
        return `${url.origin}${basePath}/reels/`;
    } catch (err) {
        return FACEBOOK_REELS_URL;
    }
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

        // Facebook group post sau khi dang thuong tra ve permalink.php hoac story.php
        // nen can nhan them cac URL nay de khong bi rong publishedUrl.
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

function extractFacebookProfileUrlFromPage(page) {
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
    const watcher = PROFILE_URL_WATCHERS.get(sessionKey);
    if (watcher?.timer) {
        clearInterval(watcher.timer);
    }
    PROFILE_URL_WATCHERS.delete(sessionKey);
}

function startFacebookProfileUrlWatcher({ sessionKey, userId, channelId, accountName, accountType, maxWaitMs = 10 * 60 * 1000, intervalMs = 4000 }) {
    if (!sessionKey || !userId || !channelId) return;
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
                const Channel = require('../models/Channel');
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

function resolveLocalVideoPath(videoPath = '') {
    const rawPath = String(videoPath || '').trim();
    if (!rawPath) return '';

    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
        return rawPath;
    }

const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..');
    const normalizedRelative = rawPath.replace(/^\/+/, '').replace(/^\.\/+/, '');

    const candidates = [
        path.join(projectRoot, normalizedRelative),
        path.join(projectRoot, 'uploads', 'videos', path.basename(normalizedRelative))
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return rawPath;
}

function getFacebookPostGroupService() {
    return require('./facebookPostGroupService');
}

async function runBotPostGroupInstant(...args) {
    return getFacebookPostGroupService().runBotPostGroupInstant(...args);
}

async function runBotPostGroupInstantWithAccount(...args) {
    return getFacebookPostGroupService().runBotPostGroupInstantWithAccount(...args);
}

async function runBotUploadInstant({ page, post }) {
    const videoPath = resolveLocalVideoPath(post?.videoPath || '');
    const shopeeLinks = normalizeShopeeLinksInput(post?.shopeeLinks);
    const linkedProfileUrl = normalizeFacebookUploadLandingUrl(post?.profileUrl || '');
    const targetReelsUrl = buildFacebookReelsTargetUrl(linkedProfileUrl);
    const finalCaption = String(post?.content || post?.caption || '').trim();
    const fileInputSelector = 'input[type="file"][accept*="video"]';

    console.log('[Reels Upload] ===== START =====');
    console.log('[Reels Upload] videoPath =', videoPath);
    console.log('[Reels Upload] caption =', JSON.stringify(finalCaption));
    console.log('[Reels Upload] shopeeLinks =', JSON.stringify(shopeeLinks));
    console.log('[Reels Upload] profileUrl =', linkedProfileUrl || '(empty)');

    if (!videoPath) throw new Error('Thieu videoPath de upload Reels');
    if (!fs.existsSync(videoPath)) throw new Error('Khong tim thay file video tren server');

    console.log('[Reels Upload] Bat dau dang Reels...');

    // Bước 1: Navigate đến trang Fanpage
    const fanpageUrl = linkedProfileUrl || targetReelsUrl;
    console.log('[Reels Upload] Di chuyen den Fanpage:', fanpageUrl);
    await page.goto(fanpageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    // Bước 2: Click vào Tab Reels
    console.log('[Reels Upload] Dang tim va click vao Tab [Reels]...');
    const reelsTabMain = page.locator('xpath=//span[text()="Reels"]').first();
    await reelsTabMain.waitFor({ state: 'visible', timeout: 30000 });
    await reelsTabMain.click();
    console.log('[Reels Upload] Da click vao Tab Reels');
    await page.waitForTimeout(3000);

    // Bước 3: Click nút "Tạo thước phim"
    console.log('[Reels Upload] Dang tim nut [Tao thuoc phim]...');
    const createReelsButton = page.locator('xpath=//span[text()="Tạo thước phim"]');
    await createReelsButton.waitFor({ state: 'visible', timeout: 15000 });
    await createReelsButton.click();
    console.log('[Reels Upload] Da click nut Tao thuoc phim');
    await page.waitForTimeout(3000);

    // Bước 4: Upload video
    console.log('[Reels Upload] Dang chon file video...');
    await page.waitForSelector(fileInputSelector, { state: 'hidden', timeout: 15000 });
    await page.setInputFiles(fileInputSelector, videoPath);
    console.log('[Reels Upload] Da day file video thanh cong!');

    // Bước 5: Đợi nút "Tiếp" sáng lên 
    const nextButtonXpath = 'xpath=//span[text()="Tiếp"]';
    const nextButton = page.locator(nextButtonXpath).first();
    console.log('[Reels Upload] Dang doi nut [Tiep] (Lan 1) sang len...');
    await nextButton.waitFor({ state: 'visible', timeout: 300000 });
    // Đợi thêm 8s cho Facebook check bản quyền xong rồi mới click (nút visible nhưng chưa clickable ngay)
    console.log('[Reels Upload] Nut Tiep da hien thi, doi 8s de Facebook check ban quyen xong...');
    await page.waitForTimeout(8000);
    console.log('[Reels Upload] Bam Tiep (Lan 1) - Qua man hinh check ban quyen...');
    await nextButton.click({ force: true });
    await page.waitForTimeout(5000);

    // Bước 6: Điền Caption ở màn hình edit (sau khi qua màn check bản quyền)
    console.log('[Reels Upload] Dang dien mo ta bai viet...');
    const captionSelectors = [
        'div[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea'
    ];
    let captionInput = null;
    for (const sel of captionSelectors) {
        const loc = page.locator(sel).first();
        const visible = await loc.isVisible().catch(() => false);
        if (visible) { captionInput = loc; break; }
    }
    if (captionInput && finalCaption) {
        await captionInput.click();
        await page.waitForTimeout(500);
        await captionInput.fill(finalCaption);
        console.log('[Reels Upload] Caption da dien xong');
    } else {
        console.log('[Reels Upload] Khong tim thay o caption hoac caption rong');
    }
    await page.waitForTimeout(1000);

    // Bước 7: Click Tiếp lần 2 (qua tab chỉnh sửa - visible filter)
    console.log('[Reels Upload] Dang tim nut [Tiep] (Lan 2) dang hien thi...');
    const nextButtonVisible = page.locator('xpath=//span[text()="Tiếp"] >> visible=true').first();
    await nextButtonVisible.waitFor({ state: 'visible', timeout: 15000 });
    await nextButtonVisible.click();
    console.log('[Reels Upload] Da bam Tiep (Lan 2) - Qua tab Cai dat chia se.');
    await page.waitForTimeout(3000);

    // Bước 8: Click nút Đăng
    console.log('[Reels Upload] Dang tim nut [Dang]...');
    const publishButton = page.locator('xpath=//span[text()="Đăng"] >> visible=true').last();
    await publishButton.waitFor({ state: 'visible', timeout: 15000 });
    await publishButton.click();
    console.log('[Reels Upload] DA BAM DANG THANH CONG!');

    // Bước 10: Chờ 25s cho Facebook xử lý
    console.log('[Reels Upload] Dang doi 25s de Facebook xuat ban...');
    await page.waitForTimeout(25000);
    console.log('[Reels Upload] Da qua 25s!');

    // Bước 11: Navigate đến trang Reels và đợi 8s cho load xong
    const reelsTabUrl = (linkedProfileUrl || '').replace(/\/+$/, '') + '/reels/';
    console.log('[Reels Upload] Di chuyen vao Tab Reels:', reelsTabUrl);
    await page.goto(reelsTabUrl, { waitUntil: 'load' });
    await page.waitForTimeout(8000);

    // Trích xuất URL bài đã đăng
    const publishedUrlCandidates = [
        page.url(),
        await page.locator('a[href*="/reel/"]').first().getAttribute('href').catch(() => ''),
        await page.locator('a[href*="/reels/"]').first().getAttribute('href').catch(() => ''),
        await page.locator('a[href*="/posts/"]').first().getAttribute('href').catch(() => '')
    ].filter(Boolean);
    const publishedUrl = publishedUrlCandidates
        .map(normalizePublishedFacebookUrl)
        .find(Boolean) || '';
    console.log('[Reels Upload] publishedUrl =', publishedUrl || '(empty)');

    // Bước 12: Click mở video Reels mới nhất và comment Shopee
    let commentPosted = false;
    if (shopeeLinks.length) {
        console.log('[Reels Upload] Click mo Video Reels moi nhat (O dau tien)...');
        const firstReelCard = page.locator('xpath=(//span[text()="0"])[1] >> visible=true');
        await firstReelCard.waitFor({ state: 'visible', timeout: 15000 });
        await firstReelCard.click();
        await page.waitForTimeout(2000);

        console.log('[Reels Upload] Tiep can o binh luan Reels...');
        const commentSelector = 'div[role="textbox"][aria-label*="Bình luận dưới tên"] >> visible=true';
        const commentInput = page.locator(commentSelector).first();
        await commentInput.waitFor({ state: 'visible', timeout: 15000 });
        await commentInput.focus();
        await commentInput.click();
        await page.waitForTimeout(1000);

        const submitCommentBtn = page.locator('div[role="button"][aria-label="Đăng bình luận"] >> visible=true').first();
        await submitCommentBtn.waitFor({ state: 'visible', timeout: 10000 });

        const affiliateCommentTexts = buildAffiliateCommentTexts(shopeeLinks);
        console.log('[Reels Upload] So comment affiliate:', affiliateCommentTexts.length);
        for (const commentText of affiliateCommentTexts) {
            await commentInput.focus();
            await commentInput.click();
            await page.waitForTimeout(800);
            await commentInput.pressSequentially(commentText, { delay: 30 });
            await page.waitForTimeout(1500);
            await submitCommentBtn.click();
            await page.waitForTimeout(5000);
            commentPosted = true;
            console.log('[Reels Upload] Da gui binh luan affiliate thanh cong!');
        }
        await page.waitForTimeout(4000);
    }

    // Warm-up sau khi đăng
    console.log('[Reels Upload] Warming up after posting video...');
    await warmUp(page, { minInteractions: 3, maxInteractions: 6 });
    console.log('[Reels Upload] Warm-up complete');

    // Hành vi sau khi đăng
    console.log('[Reels Upload] Simulating human behavior after posting...');
    await simulateHumanAfterPost(page, { minWait: 5000, maxWait: 10000, shouldLikeOwnPost: true });
    console.log('[Reels Upload] Post-publish behavior complete');

    console.log('[Reels Upload] ===== END =====');

    return {
        success: true,
        message: commentPosted
            ? 'Da upload Reels va dang binh luan Shopee thanh cong'
            : 'Da upload Reels thanh cong',
        shopeeLinksUsed: shopeeLinks,
        publishedUrl
    };
}

async function runBotUploadInstantWithAccount({ userId, accountName, accountType = 'Cá nhân', post, headless = false }) {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless });

    try {
        const page = context.pages()[0] || await context.newPage();
        const result = await runBotUploadInstant({ page, post });
        return result;
    } finally {
        // Đợi 15s rồi đóng Chromern để giải phóng tài nguyên
        console.log(`[Reels Upload] Đợi 15s rồi đóng Chromium...`);
        await new Promise(resolve => setTimeout(resolve, 15000)).catch(() => {});
        try { await context.close(); } catch(e) {}
        ACTIVE_FB_SESSIONS.delete(sessionKey);
        console.log(`[Reels Upload] Chromium đã đóng.`);
    }
}

async function getJoinedFacebookGroupsDeep({ userId, channelId, accountName, accountType = 'Cá nhân' }) {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: true });

    try {
        const page = context.pages()[0] || await context.newPage();
        const discovered = new Map();
        let stableDeepPasses = 0;
        const maxPasses = 12;

        for (let pass = 0; pass < maxPasses; pass++) {
            const beforeCount = discovered.size;

            await scanFacebookGroups({
                page,
                candidateUrls: [FACEBOOK_GROUPS_YOU_URL, FACEBOOK_GROUPS_FEED_URL, FACEBOOK_GROUPS_URL],
                invalidSegments: buildInvalidGroupSegments(),
                initialWaitMs: 2200,
                maxRoundsPerUrl: 10,
                scrollWaitMs: 1600,
                stableThreshold: 2,
                discovered
            });

            const afterCount = discovered.size;
            if (afterCount === beforeCount) {
                stableDeepPasses += 1;
            } else {
                stableDeepPasses = 0;
                await persistFacebookGroupCache({
                    userId,
                    channelId,
                    accountName,
                    accountType,
                    groups: Array.from(discovered.values())
                });
            }

            if (stableDeepPasses >= 2) break;
        }

        const groups = Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'));

        await persistFacebookGroupCache({
            userId,
            channelId,
            accountName,
            accountType,
            groups
        });

        return groups;
    } finally {
        if (isExternal) {
            await context.close().catch(() => {});
            ACTIVE_FB_SESSIONS.delete(sessionKey);
        }
    }
}

async function getJoinedFacebookGroupsQuick({ userId, channelId, accountName, accountType = 'Cá nhân' }) {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: true });

    try {
        const page = context.pages()[0] || await context.newPage();
        const candidateUrls = [
            FACEBOOK_GROUPS_YOU_URL,
            FACEBOOK_GROUPS_FEED_URL
        ];

        const discovered = await scanFacebookGroups({
            page,
            candidateUrls,
            invalidSegments: buildInvalidGroupSegments(),
            initialWaitMs: 900,
            maxRoundsPerUrl: 4,
            scrollWaitMs: 700,
            stableThreshold: 1
        });

        const groups = Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'));

        await persistFacebookGroupCache({
            userId,
            channelId,
            accountName,
            accountType,
            groups
        });

        return groups;
    } finally {
        if (isExternal) {
            await context.close().catch(() => {});
            ACTIVE_FB_SESSIONS.delete(sessionKey);
        }
    }
}

async function getJoinedFacebookGroupsCached({ userId, channelId, accountName, accountType = 'Cá nhân', forceRefresh = false, scanMode = 'fast' }) {
    if (!userId || !channelId) {
        throw new Error('Thieu thong tin tai khoan Facebook de lay group');
    }

    const cachedDoc = await FacebookGroupCache.findOne({ userId, channelId }).lean();
    if (cachedDoc?.groups?.length && !forceRefresh) {
        return {
            groups: cachedDoc.groups,
            source: 'cache',
            updatedAt: cachedDoc.updatedAt || null
        };
    }

    const groups = forceRefresh
        ? (scanMode === 'deep'
            ? await getJoinedFacebookGroupsDeep({ userId, channelId, accountName, accountType })
            : await getJoinedFacebookGroupsQuick({ userId, channelId, accountName, accountType }))
        : await getJoinedFacebookGroups(userId, accountName, accountType);

    await persistFacebookGroupCache({
        userId,
        channelId,
        accountName,
        accountType,
        groups
    });

    return {
        groups,
        source: forceRefresh ? 'scrape-deep' : 'scrape',
        updatedAt: new Date()
    };
}


// ============================================================
// COMMENT ON POST - Mo Chrome (headless: false) + CONSOLE.LOG CHI TIET
// ============================================================
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}






const wait = ms => new Promise(r => setTimeout(r, ms));

async function uploadFileToComment(page, filePath) {
    console.log('  step=upload: Bat dau upload file', filePath);
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            console.log('  step=upload: File khong ton tai ->', filePath);
            return false;
        }

        // Danh sách các selector của nút Attach trên Facebook
        const attachBtns = [
            'div[aria-label="Đính kèm một ảnh hoặc video"]',
            'div[aria-label="Attach a photo"]',
            'div[aria-label="Anh/video"]'
        ];

        for (const selBtn of attachBtns) {
            const btn = page.locator(selBtn).first();
            if (await btn.count() > 0) {
                console.log('  step=upload: Dang click vao nut:', selBtn);

                // KỸ THUẬT QUAN TRỌNG: 
                // Chờ đợi filechooser xuất hiện ngay khi click
                const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
                
                await btn.click({ force: true });
                
                try {
                    const fileChooser = await fileChooserPromise;
                    await fileChooser.setFiles(filePath);
                    await page.waitForTimeout(2000); // Đợi upload xong
                    console.log('  step=upload: Upload OK qua filechooser');
                    return true;
                } catch (e) {
                    console.log('  step=upload: Khong bat duoc filechooser qua click, thu cach thay the...');
                }
            }
        }

        // // Cách dự phòng: Tìm thẳng input file nếu không cần click
        // const fi = page.locator('input[type="file"]').last();
        // if (await fi.count() > 0) {
        //     await fi.setInputFiles(filePath);
        //     await page.waitForTimeout(2000);
        //     console.log('  step=upload: SetInputFiles truc tiep OK');
        //     return true;
        // }

        console.log('  step=upload: KHONG tim thay input file nao');
        return false;
    } catch (e) {
        console.log('  step=upload: LOI ->', e.message);
        return false;
    }
}

async function sendTextComment(page, text) {
    console.log('  step=sendText: Bat dau gui text comment');
    if (!text) {
        console.log('  step=sendText: Text rong, bo qua');
        return { sent: false, error: 'Empty text' };
    }
    var txtStr = String(text);
    console.log('  step=sendText: Text length=', txtStr.length, 'preview=', JSON.stringify(txtStr.substring(0, 60)));

    var selectors = [
        'div[role="textbox"][aria-label*="Bình luận dưới tên"] >> visible=true',
        'div[aria-label*="Comment as"]',
        'div[aria-label="Viet binh luan"]',
        'div[aria-label="Write a comment"]',
        'div[role="textbox"][contenteditable="true"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        var loc = page.locator(sel).first();
        var cnt = await loc.count().catch(function () { return 0; });
        var visible = cnt > 0 ? await loc.isVisible().catch(function () { return false; }) : false;
        console.log('  step=sendText: Selector[' + i + '] =', sel, '| count=', cnt, '| visible=', visible);
        if (cnt > 0) {
            try {
                console.log('  step=sendText: Found comment box via', sel);

                // Wait for visible, then focus + click to activate blinking cursor (like real user)
                await loc.waitFor({ state: 'visible', timeout: 8000 }).catch(function () { });
                await loc.focus().catch(function () { });
                await loc.click().catch(function () { });
                await wait(1000);

                console.log('  step=sendText: Bat dau go tung ky tu (human-like)...');
                for (var k = 0; k < txtStr.length; k++) {
                    await page.keyboard.type(txtStr[k], { delay: Math.floor(Math.random()*20, 60) });
                }
                console.log('  step=sendText: Da go xong', txtStr.length, 'ky tu');
                await wait(800);
                console.log('  step=sendText: Nhan Enter de post...');
                await page.keyboard.press('Enter');
                await wait(2500);
                console.log('  step=sendText: Da gui Enter xong, doi 2.5s');
                return { sent: true, error: '' };
            } catch (e) {
                console.log('  step=sendText: LOI voi selector nay ->', e.message, '| thu selector tiep theo');
            }
        }
    }
    console.log('  step=sendText: KHONG tim thay o comment nao hoat dong');
    return { sent: false, error: 'Khong tim thay o comment' };
}

async function sendMediaComment(page, filePath, caption, mediaType) {
    console.log('  step=sendMedia: Bat dau gui', mediaType, 'comment');
    if (!filePath) {
        console.log('  step=sendMedia: Thieu filePath');
        return { sent: false, error: 'Missing file path' };
    }
    if (!fs.existsSync(filePath)) {
        console.log('  step=sendMedia: File khong ton tai ->', filePath);
        return { sent: false, error: 'File not found' };
    }

    var selectors = [
         'div[role="textbox"][aria-label*="Bình luận dưới tên"] >> visible=true',
        'div[aria-label*="Comment as"]',
        'div[aria-label="Viet binh luan"]',
        'div[aria-label="Write a comment"]',
        'div[role="textbox"][contenteditable="true"]'
    ];
    var focused = false;
    for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        var loc = page.locator(sel).first();
        var cnt = await loc.count().catch(function () { return 0; });
        if (cnt > 0) {
            console.log('  step=sendMedia: Found comment box via', sel);

            // Wait for visible, then focus + click to activate blinking cursor (like real user)
            await loc.waitFor({ state: 'visible', timeout: 8000 }).catch(function () { });
            await loc.focus().catch(function () { });
            await loc.click().catch(function () { });
            await wait(1000);
            focused = true;
            break;
        }
    }
    if (!focused) {
        console.log('  step=sendMedia: KHONG tim thay o comment');
        return { sent: false, error: 'Khong tim thay o comment' };
    }

    var uploadOk = await uploadFileToComment(page, filePath);
    if (!uploadOk) {
        console.log('  step=sendMedia: Upload file that bai');
        return { sent: false, error: 'Khong the upload file' };
    }

    await wait(Math.floor(Math.random()*1500, 3000));

    if (caption) {
        console.log('  step=sendMedia: Go caption (length=', String(caption).length, ')');
        for (var j = 0; j < selectors.length; j++) {
            var selCap = selectors[j];
            var locCap = page.locator(selCap).first();
            if (await locCap.count().catch(function () { return 0; }) > 0) {
                await locCap.click({ force: true });
                await wait(200);
                var cap = ' ' + String(caption);
                for (var m = 0; m < cap.length; m++) {
                    await page.keyboard.type(cap[m], { delay: Math.floor(Math.random()*20, 60) });
                }
                await wait(400);
                break;
            }
        }
    }
    console.log('  step=sendMedia: Nhan Enter de post...');
    await page.keyboard.press('Enter');
    await wait(3500);
    console.log('  step=sendMedia: Da gui xong');
    return { sent: true, error: '' };
}

/**
 * Mo Chrome (headless: false), navigate toi post, gui comment, GIU BROWSER MO vai giay
 * de user quan sat. Log chi tiet tung buoc ra terminal.
 */
async function commentOnPost(params) {
    params = params || {};
    var channel = params.channel;
    var postUrl = params.postUrl;
    var commentType = params.commentType || 'text';
    var commentContent = params.commentContent || '';
    var commentFilePath = params.commentFilePath || null;
    var keepOpenMs = params.keepOpenMs != null ? params.keepOpenMs : 10000;
    // Hỗ trợ post nhiều comment trong 1 lần mở browser
    var comments = params.comments || null; // Array of { type, content, filePath, caption }

    console.log("=======================================")
    console.log('BAT DAU CHAY PLAY COMMENT');
    console.log("=======================================")
    console.log('Tham so dau vao:');
    console.log('  - accountName    :', channel && channel.accountName || '(null)');
    console.log('  - accountType    :', channel && channel.accountType || '(null)');
    console.log('  - postUrl        :', postUrl || '(null)');
    console.log('  - commentType    :', commentType);
    console.log('  - commentContent :', JSON.stringify(String(commentContent || '').substring(0, 100)));
    console.log('  - commentFilePath:', commentFilePath || '(null)');
    console.log('  - keepOpenMs     :', keepOpenMs);
    console.log('  - comments count :', comments ? comments.length : 'N/A (single mode)');

    if (!channel) {
        console.log('LOI: Missing channel');
        return { success: false, error: 'Missing channel' };
    }
    if (!postUrl) {
        console.log('LOI: Missing postUrl');
        return { success: false, error: 'Missing postUrl' };
    }

    var context = null;
    var sessionKey = null;

    try {
        console.log('step=1: Goi getOrOpenFacebookContext(headless: false) cho account', channel.accountName);
        var ctx = await getOrOpenFacebookContext(
            channel.userId,
            channel.accountName,
            channel.accountType || 'Ca nhan',
            'FB',
            { headless: false }
        );
        context = ctx.context;
        sessionKey = ctx.sessionKey;
        console.log('step=2: Context da mo thanh cong, sessionKey=', sessionKey);
        console.log('step=2: So page dang mo trong context =', context.pages().length);

        var page = context.pages()[0] || await context.newPage();
        console.log('step=3: Lay page thanh cong');
        console.log('step=3: URL hien tai cua page =', page.url());

        console.log('step=4: bringToFront()...');
        await page.bringToFront().catch(function (e) { console.log('step=4: bringToFront warning ->', e.message); });

        console.log('step=5: Navigate toi postUrl =', postUrl);
        console.log('step=5: (co the mat 3-10s cho FB load)...');
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function (e) {
            console.log('step=5: Page goto warning ->', e.message);
        });
        await wait(2500);
        console.log('step=5: Da navigate xong, URL hien tai =', page.url());

        console.log('step=6: title page =', JSON.stringify(await page.title().catch(function () { return ''; })));

        // Xử lý post nhiều comment hoặc single comment
        var allResults = [];
        var commentList = comments && comments.length > 0 ? comments : [{
            type: commentType,
            content: commentContent,
            filePath: commentFilePath
        }];

        for (var i = 0; i < commentList.length; i++) {
            var cmt = commentList[i];
            console.log("=======================================")
            console.log('COMMENT #' + (i + 1) + '/' + commentList.length);
            console.log("=======================================")
            console.log('  - type    :', cmt.type);
            console.log('  - content :', JSON.stringify(String(cmt.content || '').substring(0, 100)));
            console.log('  - filePath:', cmt.filePath || '(null)');
            console.log('  - caption :', JSON.stringify(String(cmt.caption || '').substring(0, 100)));

            var result = { sent: false, error: 'Invalid comment type' };
            if (cmt.type === 'text' && cmt.content) {
                console.log('  -> Nhanh text comment...');
                result = await sendTextComment(page, cmt.content);
            } else if ((cmt.type === 'image' || cmt.type === 'video') && cmt.filePath) {
                console.log('  -> Nhanh', cmt.type, 'comment...');
                result = await sendMediaComment(page, cmt.filePath, cmt.caption || cmt.content, cmt.type);
            } else {
                console.log('  -> LOI - type/content/file khong hop le');
                result = { sent: false, error: 'Invalid: type=' + cmt.type + ', content=' + (!!cmt.content) + ', file=' + (!!cmt.filePath) };
            }

            allResults.push({
                index: i,
                type: cmt.type,
                success: !!result.sent,
                error: result.error || null
            });

            console.log("=======================================")
            if (result.sent) {
                console.log('KET QUA COMMENT #' + (i + 1) + ': THANH CONG');
            } else {
                console.log('KET QUA COMMENT #' + (i + 1) + ': THAT BAI ->', result.error);
            }

            // Delay giữa các comment (trừ comment cuối)
            if (i < commentList.length - 1) {
                var delayMs = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000; // 5-15s
                console.log('Delay ' + delayMs + 'ms truoc comment tiep theo...');
                await wait(delayMs);
            }
        }

        console.log("=======================================")
        console.log('TONG KET: ' + allResults.filter(r => r.success).length + '/' + allResults.length + ' comment thanh cong');
        console.log('Buoc tiep theo: GIU BROWSER MO', keepOpenMs, 'ms de ban xem...');
        console.log("=======================================")

        await wait(keepOpenMs);

        console.log('step=final: Dong context va don dep...');
        var successCount = allResults.filter(r => r.success).length;
        return { 
            success: successCount > 0, 
            error: successCount === 0 ? allResults[0]?.error : null,
            results: allResults,
            postedCount: successCount
        };
    } catch (err) {
        console.log('LOI TONG: ', err.message);
        console.log('LOI stack: ', err.stack);
        return { success: false, error: err.message };
    } finally {
        try {
            if (context) {
                await context.close();
                ACTIVE_FB_SESSIONS.delete(sessionKey);
                console.log('step=final: Da dong context, cleanup xong');
            }
        } catch (e) {
            console.log('step=final: Loi khi dong context ->', e.message);
        }
        console.log("=======================================")
        console.log('KET THUC');
        console.log("=======================================")
    }
}

module.exports = {
    openFacebookLoginWindow,
    getOrOpenFacebookContext,
    getJoinedFacebookGroups,
    getJoinedFacebookGroupsQuick,
    getJoinedFacebookGroupsDeep,
    getJoinedFacebookGroupsCached,
    scrapeGroupsFromUrl,
    scrapeGroupsFromJoinsPage,
    extractFacebookGroupsFromPageV2,
    persistFacebookGroupCache,
    startFacebookProfileUrlWatcher,
    stopFacebookProfileUrlWatcher,
    findFirstVisibleLocator,
    writeTextIntoLocator,
    normalizePublishedFacebookUrl,
    runBotUploadInstantWithAccount,
    runBotUploadInstant,
    runBotPostGroupInstantWithAccount,
    runBotPostGroupInstant,
    commentOnPost
};
