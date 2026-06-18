const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const { SESSION_ROOT, ensureDir, sanitizeFolderName, buildAccountFolder, buildStorageStatePath } = require('./common/browser');
const getProfile = require('../../FbV2/getProfile');
const { getAntiDetectionScript } = require('./humanBehaviorService');
const FacebookGroupCache = require('../models/FacebookGroupCache');

const ACTIVE_SOCIAL_SESSIONS = global.__socialPlaywrightSessions || (global.__socialPlaywrightSessions = new Map());

// ─── Chrome CDP Helpers ────────────────────────────────────────────────────────

/** Port base cho CDP, mỗi session +1 để tránh conflict */
let cdpPortCounter = 9222;

/**
 * Tìm đường dẫn chrome.exe trên máy
 */
function getChromeExecutablePath() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

/**
 * Launch Chrome thật với remote-debugging-port, dùng profile riêng
 * @returns {{ process: ChildProcess, port: number }}
 */
function launchChromeWithCDP(profileDir, url = '', { debugPort = 0 } = {}) {
    const chromeExe = getChromeExecutablePath();
    if (!chromeExe) throw new Error('Không tìm thấy Chrome trên máy');

    const port = debugPort || (cdpPortCounter++);
    const args = [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profileDir}`,
        '--start-maximized',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-background-networking',
    ];
    if (url) args.push(url);

    console.log(`[CDP] Launch Chrome port=${port} profile=${profileDir}`);
    const chromeProcess = spawn(chromeExe, args, { detached: true, stdio: 'ignore' });
    chromeProcess.unref();

    return { process: chromeProcess, port };
}

/**
 * Kết nối Playwright vào Chrome qua CDP
 * @returns {{ browser, context, page }}
 */
async function connectChromeCDP(port, retries = 10) {
    for (let i = 0; i < retries; i++) {
        try {
            const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
            const context = browser.contexts()[0];
            const page = context.pages()[0] || await context.newPage();
            console.log(`[CDP] Đã kết nối port ${port}`);
            return { browser, context, page };
        } catch (e) {
            if (i < retries - 1) {
                await new Promise(r => setTimeout(r, 1000));
            } else {
                throw new Error(`Không thể kết nối CDP port ${port}: ${e.message}`);
            }
        }
    }
}

/**
 * Đợi Chrome process đóng
 */
function waitForChromeClose(chromeProcess) {
    return new Promise((resolve) => {
        let resolved = false;
        chromeProcess.on('close', () => {
            if (!resolved) { resolved = true; resolve(); }
        });
        // Fallback: poll
        const check = setInterval(() => {
            try {
                process.kill(chromeProcess.pid, 0);
            } catch (e) {
                clearInterval(check);
                if (!resolved) { resolved = true; resolve(); }
            }
        }, 2000);
    });
}

/**
 * Login chung cho mọi platform bằng CDP Chrome thật
 * @param {string} platform - 'IG', 'FB', 'TT', 'YT', etc.
 * @param {string} loginUrl - URL đăng nhập
 * @param {string[]} sessionCookieNames - Tên cookie xác nhận login (vd: ['sessionid'])
 * @param {string} platformLabel - Tên hiển thị
 */
async function openSocialLoginWithCDP(userId, accountName, accountType, platform, loginUrl, sessionCookieNames, platformLabel) {
    const storageStatePath = getStorageStatePath(userId, accountName, platform);
    const sessionKey = `${userId}:${platform}:${sanitizeFolderName(accountName)}`;
    const profileDir = buildAccountFolder(userId, accountName, platform);
    ensureDir(profileDir);

    // Xoá session cũ
    if (fs.existsSync(storageStatePath)) {
        try { fs.unlinkSync(storageStatePath); } catch (e) {}
    }

    // Launch Chrome thật
    let chromeProc, port;
    try {
        ({ process: chromeProc, port } = launchChromeWithCDP(profileDir, loginUrl));
    } catch (e) {
        return {
            success: false,
            message: e.message,
            storageStatePath: '', sessionDir: profileDir,
            accountName, accountType, sessionKey: null, cookiesSaved: false
        };
    }

    // Đợi Chrome khởi động
    await new Promise(r => setTimeout(r, 3000));

    // Kết nối CDP
    let browser, context, page;
    try {
        ({ browser, context, page } = await connectChromeCDP(port));
    } catch (e) {
        try { chromeProc.kill(); } catch (e2) {}
        return {
            success: false,
            message: e.message,
            storageStatePath: '', sessionDir: profileDir,
            accountName, accountType, sessionKey: null, cookiesSaved: false
        };
    }

    ACTIVE_SOCIAL_SESSIONS.set(sessionKey, { context, page, userSessionDir: profileDir, accountName, platform, headless: false });

    console.log(`[${platformLabel}] Đang chờ đăng nhập. Đóng trình duyệt khi hoàn tất...`);

    // Poll cookies + lưu liên tục mỗi 2 giây
    let loginDetected = false;
    let lastSavedCookies = '';
    const pollTimer = setInterval(async () => {
        try {
            if (context.isClosed()) return;
            const cookies = await context.cookies();
            const cookiesJson = JSON.stringify(cookies);

            // Check login
            if (!loginDetected) {
                const found = sessionCookieNames.some(name =>
                    cookies.some(c => c.name === name && c.value && c.value.trim() !== '')
                );
                if (found) {
                    loginDetected = true;
                    console.log(`[${platformLabel}] ✅ Phát hiện session cookies!`);
                }
            }

            // Lưu cookies nếu có thay đổi
            if (cookies.length > 0 && cookiesJson !== lastSavedCookies) {
                lastSavedCookies = cookiesJson;
                fs.writeFileSync(storageStatePath, JSON.stringify({ cookies, origins: [] }, null, 2));
                console.log(`[${platformLabel}] Đã lưu ${cookies.length} cookies`);
            }
        } catch (e) {}
    }, 2000);

    // Đợi user đóng Chrome
    await waitForChromeClose(chromeProc);
    clearInterval(pollTimer);

    // Lưu lần cuối trước khi đóng connection
    try {
        if (context && !context.isClosed()) {
            const cookies = await context.cookies();
            if (cookies.length > 0) {
                fs.writeFileSync(storageStatePath, JSON.stringify({ cookies, origins: [] }, null, 2));
                console.log(`[${platformLabel}] Lưu lần cuối: ${cookies.length} cookies`);
            }
        }
    } catch (e) {}
    try { await browser.close(); } catch (e) {}

    const hasSession = hasValidSessionCookies(storageStatePath, platform);

    if (!hasSession) {
        return {
            success: false,
            message: `Trình duyệt đã đóng nhưng chưa phát hiện đăng nhập ${platformLabel}. Vui lòng thử lại.`,
            storageStatePath, sessionDir: profileDir,
            accountName, accountType, sessionKey, cookiesSaved: false
        };
    }

    console.log(`[${platformLabel}] Đã phát hiện session cookies hợp lệ`);

    // Scrape profile từ cookies đã lưu
    let myName = '', myProfileUrl = '', myAvatarUrl = '';
    if (hasSession) {
        try {
            console.log(`[${platformLabel}] Đang scrape profile...`);
            const hBrowser = await chromium.launch({
                headless: true, channel: 'chrome',
                args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--disable-sync'],
                ignoreDefaultArgs: ['--enable-automation', '--enable-logging', '--no-sandbox']
            });
            const hCtx = await hBrowser.newContext({ storageState: storageStatePath });
            const hPage = hCtx.pages()[0] || await hCtx.newPage();
            const profileData = await scrapePlatformProfile(hPage, platform);
            myName = profileData.name;
            myProfileUrl = profileData.profileUrl;
            myAvatarUrl = profileData.avatarUrl;
            await hCtx.close().catch(() => {});
            await hBrowser.close().catch(() => {});
            console.log(`[${platformLabel}] Profile: name="${myName}" url="${myProfileUrl}" avatar=${myAvatarUrl ? 'yes' : 'no'}`);

            // Download avatar về local (giống Facebook)
            if (myAvatarUrl && myAvatarUrl.startsWith('http')) {
                try {
                    const downloadFn = platform === 'FB' ? downloadFbAvatar
                        : platform === 'TT' ? downloadTiktokAvatar
                        : null;
                    if (downloadFn) {
                        const localAvatar = await downloadFn(myAvatarUrl, userId, accountName);
                        if (localAvatar) myAvatarUrl = localAvatar;
                    }
                } catch (e) {
                    console.warn(`[${platformLabel}] Download avatar lỗi: ${e.message}`);
                }
            }
        } catch (e) {
            console.warn(`[${platformLabel}] Scrape lỗi: ${e.message}`);
        }
    }

    return {
        success: true, cookiesSaved: true,
        message: `Đã đăng nhập ${platformLabel} thành công cho "${myName || accountName}".`,
        storageStatePath, sessionDir: profileDir,
        accountName, accountType, sessionKey,
        myName: myName || '', myProfileUrl: myProfileUrl || '', myAvatarUrl: myAvatarUrl || ''
    };
}

// ─── Session cookie verification ───────────────────────────────────────────────

function getStorageStatePath(userId, accountName, platform = 'FB') {
    return buildStorageStatePath(userId, accountName, platform);
}

/** Platform-specific session cookies that confirm a user is actually logged in */
const PLATFORM_SESSION_COOKIES = {
    FB: ['c_user', 'xs'],
    TT: ['sessionid'],
    IG: ['sessionid'],
    YT: ['SAPISID'],
    ZO: ['zmp3sz'],
    PI: ['_pinterest_sess'],
    TH: ['sessionid'],
};

/** Domain filter per platform */
const PLATFORM_DOMAINS = {
    FB: 'facebook.com',
    TT: 'tiktok.com',
    IG: 'instagram.com',
    YT: 'youtube.com',
    ZO: 'zalo.me',
    PI: 'pinterest.com',
    TH: 'threads.net',
};

/**
 * Periodically save context.storageState() to a JSON file while the context is open.
 * @param {import('playwright').BrowserContext} context
 * @param {string} filePath  Full path to the JSON file to write
 * @param {number} intervalMs  Poll interval (default 2s)
 * @returns {() => void}      Stop function
 */
function startPeriodicStorageSave(context, filePath, intervalMs = 2000) {
    let timer;
    let running = true;

    const save = async () => {
        if (!running) return;
        try {
            if (!context.isClosed()) {
                const state = await context.storageState();
                fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
            }
        } catch (e) {
            // Silently ignore – context may have been disposed during the async
        }
        if (running && !context.isClosed()) {
            timer = setTimeout(save, intervalMs);
        }
    };

    save();
    return () => {
        running = false;
        if (timer) clearTimeout(timer);
    };
}

/**
 * Read a previously-saved storage-state JSON and verify that the platform's
 * essential session cookies are present (proves the user actually logged in).
 * @param {string} storageStatePath
 * @param {string} platform  e.g. 'FB', 'TT', 'IG', …
 * @returns {boolean}
 */
function hasValidSessionCookies(storageStatePath, platform) {
    try {
        if (!fs.existsSync(storageStatePath)) {
            console.log(`[Session Verify] storage-state file not found: ${storageStatePath}`);
            return false;
        }

        const raw = fs.readFileSync(storageStatePath, 'utf8');
        const data = JSON.parse(raw);
        if (!data.cookies || !Array.isArray(data.cookies) || data.cookies.length === 0) {
            console.log(`[Session Verify] No cookies in storage state`);
            return false;
        }

        const expected = PLATFORM_SESSION_COOKIES[platform];
        if (!expected || expected.length === 0) {
            console.log(`[Session Verify] Unknown platform: ${platform}`);
            return false;
        }

        const expectedDomain = PLATFORM_DOMAINS[platform];

        let foundCount = 0;
        for (const cookie of data.cookies) {
            if (expected.includes(cookie.name) &&
                cookie.value && cookie.value.trim() !== '' &&
                (!expectedDomain || (cookie.domain && cookie.domain.includes(expectedDomain)))) {
                foundCount++;
            }
        }

        const requiredCount = platform === 'FB' ? expected.length : 1;
        console.log(`[Session Verify] ${platform}: found ${foundCount}/${expected.length} session cookies (need ≥ ${requiredCount})`);
        return foundCount >= requiredCount;
    } catch (e) {
        console.error(`[hasValidSessionCookies] Error:`, e.message);
        return false;
    }
}

/**
 * Download Facebook avatar từ CDN về local để tránh URL hết hạn
 */
async function downloadFbAvatar(url, userId, accountName) {
    if (!url || url === 'Không tìm thấy' || !url.startsWith('http')) return '';
    try {
        const https = require('https');
        const http = require('http');

        const avatarDir = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'avatars');
        ensureDir(avatarDir);

        const filename = `${userId}_${sanitizeFolderName(accountName)}_fb_avatar.jpg`;
        const filePath = path.join(avatarDir, filename);

        // Download với follow redirect
        const response = await new Promise((resolve, reject) => {
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 15000
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    // Follow redirect
                    const redirectMod = res.headers.location.startsWith('https') ? https : http;
                    redirectMod.get(res.headers.location, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                        timeout: 15000
                    }, resolve).on('error', reject);
                    return;
                }
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                resolve(res);
            });
            req.on('error', reject);
        });

        const buffer = await new Promise((resolve, reject) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });

        if (buffer.length < 100) {
            console.warn(`[Avatar Download] File quá nhỏ (${buffer.length} bytes), bỏ qua`);
            return '';
        }

        fs.writeFileSync(filePath, buffer);
        console.log(`[Avatar] Đã lưu avatar local: ${filePath}`);
        return `/uploads/avatars/${filename}`;
    } catch (e) {
        console.error(`[Avatar Download] Lỗi: ${e.message}`);
        return '';
    }
}

/**
 * Lấy thông tin profile Facebook từ page đã có session.
 * (Y chang code bên FbV2/getProfile.js)
 * @param {import('playwright').Page} page
 * @returns {Promise<{myName: string, myProfileUrl: string, myAvatarUrl: string, accountType: string}>}
 */
async function scrapeFacebookProfile(page) {
    // Block image/font resources để tăng tốc
    await page.route('**/*.{png,jpg,jpeg,gif,svg,webp,woff,woff2,ttf,eot}', route => route.abort()).catch(() => {});

    console.log(`[Facebook Profile Scrape] --> Đang vào https://facebook.com/me để lấy profile URL...`);
    await page.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);

    let myName = 'Không tìm thấy';
    let myProfileUrl = 'Không tìm thấy';
    let myAvatarUrl = 'Không tìm thấy';
    let accountType = 'Không xác định';

    try {
        myProfileUrl = page.url();
        console.log(`[Facebook Profile Scrape] URL hiện tại: ${myProfileUrl}`);

        // === KIỂM TRA FANPAGE HAY CÁ NHÂN ===
        try {
            if (myProfileUrl.includes('/pages/')) {
                accountType = 'Fanpage';
            } else {
                await page.waitForTimeout(1000);
                const isFanpage = await page.evaluate(() => {
                    const bodyText = document.body.innerText || '';
                    const hasAddFriend = bodyText.includes('Kết bạn') || bodyText.includes('Add Friend') || bodyText.includes('Thêm bạn bè');
                    const hasLikePage = bodyText.includes('Thích trang') || bodyText.includes('Like Page');
                    const hasPageLikes = /[\d,.]+\s*(lượt thích|lượt like|page likes|people like this)/i.test(bodyText);
                    const hasFriends = /bạn bè|friends|bạn chung|mutual friends/i.test(bodyText);
                    if (hasAddFriend) return false;
                    if (hasLikePage) return true;
                    if (hasPageLikes && !hasFriends) return true;
                    if (hasFriends && !hasPageLikes) return false;
                    const pathname = window.location.pathname.replace(/\/$/, '');
                    const lastSegment = pathname.split('/').pop() || '';
                    if (lastSegment.includes('.') && !lastSegment.startsWith('profile.php')) return false;
                    return true;
                });
                accountType = isFanpage ? 'Fanpage' : 'Cá nhân';
            }
        } catch (e) {
            accountType = myProfileUrl.includes('/pages/') ? 'Fanpage' : 'Cá nhân';
        }
        console.log(`[Facebook Profile Scrape] Loại tài khoản: ${accountType}`);

        // === LẤY TÊN TỪ H1 ===
        try {
            try {
                const btnLocator = page.locator('h1 div[role="button"]').first();
                await btnLocator.waitFor({ timeout: 5000 });
                const btnFullText = await btnLocator.textContent();
                if (btnFullText) {
                    const cleanName = btnFullText.replace(/\s/g, ' ').replace(/\u00a0/g, '').trim();
                    if (cleanName && cleanName.length > 0 && cleanName.length <= 200 && !/^\d+$/.test(cleanName)) {
                        myName = cleanName;
                    }
                }
            } catch (e) {
                // Fallback
            }

            if (myName === 'Không tìm thấy' || myName === '') {
                await page.locator('h1').first().waitFor({ timeout: 3000 }).catch(() => {});
                const nameFromH1 = await page.evaluate(() => {
                    const h1 = document.querySelector('h1');
                    if (!h1) return '';
                    const btnDiv = h1.querySelector('div[role="button"]');
                    if (btnDiv) {
                        for (const node of btnDiv.childNodes) {
                            if (node.nodeType === Node.TEXT_NODE) {
                                const text = node.textContent.replace(/\s+/g, ' ').trim();
                                if (text && text.length > 0 && text.length <= 200 && !/^\d+$/.test(text)) return text;
                            }
                        }
                        const fullText = btnDiv.textContent.replace(/\s+/g, ' ').trim();
                        if (fullText && fullText.length > 0 && fullText.length <= 200) return fullText;
                    }
                    const children = h1.querySelectorAll('a, span, div, strong, b');
                    let bestName = '';
                    for (const child of children) {
                        const text = child.textContent.trim();
                        if (!text || text.length < 2) continue;
                        if (/^\d+$/.test(text) || /thông báo|notification/i.test(text)) continue;
                        if (text.length > bestName.length) bestName = text;
                    }
                    if (!bestName) {
                        const fullText = h1.textContent.replace(/\s+/g, ' ').trim();
                        const lines = fullText.split(/[\n,;]/).map(s => s.trim()).filter(s => s.length > 2);
                        for (const line of lines) {
                            if (/^\d+$/.test(line) || /thông báo|notification/i.test(line)) continue;
                            if (line.length > bestName.length) bestName = line;
                        }
                        if (!bestName) bestName = lines[0] || fullText;
                    }
                    return bestName;
                });
                if (nameFromH1) myName = nameFromH1;
            }
        } catch (e) {
            // ignore
        }

        // Fallback: lấy từ page title
        if (myName === 'Không tìm thấy' || myName === '') {
            try {
                const titleText = await page.title();
                if (titleText && titleText !== 'Facebook') {
                    let cleaned = titleText.replace(/^\(\d+\)\s*/, '').trim();
                    cleaned = cleaned.replace(/\s*\|\s*Facebook\s*$/i, '').trim();
                    if (cleaned && cleaned.toLowerCase() !== 'facebook') myName = cleaned;
                }
            } catch (e) {}
        }

        // Fallback: lấy tên từ URL
        if (myName === 'Không tìm thấy' || myName === '') {
            try {
                const url = page.url();
                if (url) {
                    const urlObj = new URL(url);
                    const pathParts = urlObj.pathname.replace(/\/$/, '').split('/').filter(Boolean);
                    const lastPart = pathParts[pathParts.length - 1] || '';
                    if (lastPart.startsWith('profile.php')) {
                        const params = new URLSearchParams(urlObj.search);
                        const id = params.get('id');
                        if (id) myName = `User ID: ${id}`;
                    } else if (lastPart && !lastPart.includes('.')) {
                        myName = `@${lastPart}`;
                    }
                }
            } catch (e) {}
        }

        // Fallback: og:title
        if (myName === 'Không tìm thấy' || myName === '' || myName.startsWith('@') || myName.startsWith('User ID')) {
            try {
                const ogTitle = await page.evaluate(() => {
                    const meta = document.querySelector('meta[property="og:title"]');
                    return meta ? meta.getAttribute('content') : '';
                });
                if (ogTitle && !ogTitle.includes('Facebook') && !/^\(\d+\)/.test(ogTitle)) myName = ogTitle;
            } catch (e) {}
        }

        // Fallback: alt từ avatar
        if (myName === 'Không tìm thấy' || myName === '') {
            try {
                const altName = await page.evaluate(() => {
                    const imgs = document.querySelectorAll('img[alt*="đại diện"], img[alt*="profile"], img[alt*="avatar"], img[alt*="Profile"]');
                    for (const img of imgs) {
                        const alt = img.getAttribute('alt');
                        if (alt) {
                            let name = alt.replace(/Ảnh đại diện của\s*/i, '').replace(/Profile (picture|photo) of\s*/i, '').replace(/avatar of\s*/i, '').trim();
                            if (name) return name;
                        }
                    }
                    return '';
                });
                if (altName) myName = altName;
            } catch (e) {}
        }

        // === LẤY AVATAR ===
        try {
            const avatarImg = page.locator('img[alt*="Ảnh đại diện"], img[alt*="profile"], img[alt*="avatar"], img[alt*="Profile"]').first();
            await avatarImg.waitFor({ timeout: 3000 });
            myAvatarUrl = await avatarImg.getAttribute('src');
        } catch (e) {}

        if (myAvatarUrl === 'Không tìm thấy') {
            try {
                const svgImage = page.locator('svg image').first();
                await svgImage.waitFor({ timeout: 3000 });
                const href = await svgImage.getAttribute('xlink:href');
                if (href) myAvatarUrl = href;
            } catch (e) {}
        }

        if (myAvatarUrl === 'Không tìm thấy') {
            try {
                const allImages = page.locator('img');
                const count = await allImages.count();
                for (let i = 0; i < count; i++) {
                    const img = allImages.nth(i);
                    const src = await img.getAttribute('src');
                    if (src && src.includes('.jpg') && !src.includes('emoji') && !src.includes('icon')) {
                        myAvatarUrl = src;
                        break;
                    }
                }
            } catch (e) {}
        }

    } catch (err) {
        console.error(`[Facebook Profile Scrape] Lỗi khi lấy dữ liệu: ${err.message}`);
    }

    console.log(`[Facebook Profile Scrape] name="${myName}" url="${myProfileUrl}" avatar=${myAvatarUrl !== 'Không tìm thấy' ? 'yes' : 'no'}`);
    return { myName, myProfileUrl, myAvatarUrl, accountType };
}

// Gọi ngay khi module load
require('./common/browser').disableChromeAutomationInfobar();

/**
 * Lấy danh sách nhóm từ Cache (DB)
 */
async function getJoinedFacebookGroupsCached(userId, channelId) {
    try {
        const cache = await FacebookGroupCache.findOne({ userId, channelId }).lean();
        if (!cache) {
            return { success: true, groups: [], updatedAt: null, message: "Chưa có dữ liệu cache" };
        }
        return { success: true, groups: cache.groups, updatedAt: cache.updatedAt };
    } catch (error) {
        console.error(`[getJoinedFacebookGroupsCached Error] ${error.message}`);
        throw new Error('Lỗi khi truy vấn cache');
    }
}

// Alias
const buildSocialAccountFolder = buildAccountFolder;

/**
 * Lấy thông tin profile từ session đã lưu trong thư mục social-sessions
 * @param {string} userId - ID của người dùng
 * @param {string} accountName - Tên tài khoản social
 * @param {string} platform - Platform (FB, YT, TT, IG, ZO)
 * @returns {Object|null} Thông tin profile nếu có, null nếu không tìm thấy
 */
async function getSocialSessionProfile(userId, accountName, platform = 'FB') {
    try {
        const userSessionDir = buildSocialAccountFolder(userId, accountName, platform);
        const storageStatePath = getStorageStatePath(userId, accountName, platform);
        
        if (!fs.existsSync(storageStatePath)) {
            console.log(`[Social Session] Không tìm thấy storage-state.json cho ${platform} account: ${accountName}`);
            return null;
        }
        
        const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
        
        // Trích xuất profile URL nếu có
        let profileUrl = '';
        if (storageState.cookies && storageState.cookies.length > 0) {
            // Thử tìm cookies của Facebook để lấy profile
            const fbCookies = storageState.cookies.filter(c => c.domain && c.domain.includes('facebook.com'));
            if (fbCookies.length > 0) {
                // Profile URL thường được lưu trong cookies hoặc localStorage
                // Ở đây chúng ta trả về thông tin cơ bản
                profileUrl = `https://www.facebook.com`;
            }
        }
        
        return {
            userId,
            accountName,
            platform,
            userSessionDir,
            storageStatePath,
            profileUrl,
            hasValidSession: true
        };
    } catch (error) {
        console.error(`[Social Session] Lỗi khi đọc profile từ ${platform} account: ${accountName}`, error.message);
        return null;
    }
}

/**
 * Quản lý khởi tạo hoặc tái sử dụng browser context
 * Dùng CDP Chrome thật - không bị detect automation
 */
async function getOrOpenSocialContext(userId, accountName, accountType, platform = 'FB', { headless = true, existingSessionDir = '' } = {}) {
    if (!userId) throw new Error('Missing user id');
    if (!accountName || !String(accountName).trim()) {
        throw new Error('Vui lòng nhập tên tài khoản để lưu cookie riêng');
    }

    ensureDir(SESSION_ROOT);
    const userSessionDir = (existingSessionDir && fs.existsSync(existingSessionDir))
        ? existingSessionDir
        : buildSocialAccountFolder(userId, accountName, platform);
    ensureDir(userSessionDir);

    const sessionKey = `${userId}:${platform}:${sanitizeFolderName(accountName)}`;
    let session = ACTIVE_SOCIAL_SESSIONS.get(sessionKey);

    // Tái sử dụng session nếu còn sống
    if (session?.context && !session.context.isClosed()) {
        if (session.headless === Boolean(headless)) {
            return { context: session.context, sessionKey, reused: true, userSessionDir };
        }
        try { await session.browser?.close(); } catch (e) {}
        ACTIVE_SOCIAL_SESSIONS.delete(sessionKey);
    }

    // Dùng CDP Chrome thật (không dùng Playwright launch)
    if (headless) {
        // Headless mode: dùng Playwright launch cho các task chạy nền (upload, scrape)
        const context = await chromium.launchPersistentContext(userSessionDir, {
            headless: true,
            channel: 'chrome',
            viewport: null,
            args: [
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=AutomationControlled',
                '--no-first-run',
                '--disable-sync',
                '--disable-background-networking'
            ],
            ignoreDefaultArgs: ['--enable-automation', '--enable-logging', '--no-sandbox']
        });

        session = { context, browser: null, userSessionDir, accountName, accountType, platform, headless: true };
        ACTIVE_SOCIAL_SESSIONS.set(sessionKey, session);
        context.on('close', () => ACTIVE_SOCIAL_SESSIONS.delete(sessionKey));

        return { context, sessionKey, reused: false, userSessionDir };
    }

    // Non-headless: dùng CDP Chrome thật
    const platformUrls = {
        FB: 'https://www.facebook.com',
        TT: 'https://www.tiktok.com',
        IG: 'https://www.instagram.com',
        YT: 'https://www.youtube.com',
        ZO: 'https://chat.zalo.me',
        PI: 'https://www.pinterest.com',
        TH: 'https://www.threads.net'
    };
    const targetUrl = platformUrls[platform] || 'https://www.google.com';

    let chromeProc, port;
    try {
        ({ process: chromeProc, port } = launchChromeWithCDP(userSessionDir, targetUrl));
    } catch (e) {
        throw new Error(`Không thể mở Chrome: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 3000));

    let browser, context, page;
    try {
        ({ browser, context, page } = await connectChromeCDP(port));
    } catch (e) {
        try { chromeProc.kill(); } catch (e2) {}
        throw new Error(`Không thể kết nối Chrome: ${e.message}`);
    }

    // Load cookies từ storage state nếu có
    const storageStatePath = getStorageStatePath(userId, accountName, platform);
    if (fs.existsSync(storageStatePath)) {
        try {
            const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
            if (storageState.cookies?.length > 0) {
                await context.addCookies(storageState.cookies);
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            }
        } catch (e) {}
    }

    session = { context, browser, chromeProc, userSessionDir, accountName, accountType, platform, headless: false };
    ACTIVE_SOCIAL_SESSIONS.set(sessionKey, session);

    context.on('close', () => ACTIVE_SOCIAL_SESSIONS.delete(sessionKey));

    return { context, sessionKey, reused: false, userSessionDir };
}

/**
 * Hàm mở cửa sổ Facebook để người dùng đăng nhập.
 *
 * Flow (y chang FbV2):
 *   1. Dùng chromium.launch() + newContext() (non-persistent) → không restore session cũ → không google.com/newtab
 *   2. Cookie polling phát hiện c_user + xs → loginSuccess = true, đóng Chrome login ngay
 *   3. Mở Chrome headless mới với session đã lưu → dùng getProfile() từ FbV2
 *      để lấy accountName, accountType, profileUrl, avatarUrl
 *   4. Lưu DB + UI → đóng Chrome headless
 *   5. User tắt Chrome sớm / login chưa xong → không lưu DB
 */
/**
 * Mở cửa sổ Facebook cho người dùng đăng nhập (y chang FbV2/fbv2.js).
 *
 * Flow:
 *   1. Nếu chưa có session → Chromium non-persistent (headless:false, channel:chrome) → facebook.com/login
 *   2. Cookie polling phát hiện c_user + xs (in-memory) → loginSuccess = true
 *   3. Lưu storageState vào file NGAY KHI BROWSER CÒN MỞ (giống FbV2: lưu trước khi close)
 *   4. Đợi user đóng Chrome
 *   5. Mở Chromium headless (channel:chrome) → newContext({ storageState }) → getProfile()
 *   6. User tắt Chrome sớm/login chưa xong → không lưu DB
 */
async function openFacebookLoginWindow(userId, accountName, accountType = 'Cá nhân', platform = 'FB') {
    const result = await openSocialLoginWithCDP(userId, accountName, accountType, 'FB', 'https://www.facebook.com', ['c_user', 'xs'], 'Facebook');

    // Facebook dùng getProfile() riêng để scrape
    if (result.success && result.cookiesSaved && result.storageStatePath) {
        try {
            console.log('[Facebook Login] Đang scrape profile...');
            const hBrowser = await chromium.launch({
                headless: true, channel: 'chrome',
                args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--disable-sync'],
                ignoreDefaultArgs: ['--enable-automation', '--enable-logging', '--no-sandbox']
            });
            const hCtx = await hBrowser.newContext({ storageState: result.storageStatePath });
            const profileData = await getProfile(hCtx);
            await hCtx.close().catch(() => {});
            await hBrowser.close().catch(() => {});

            if (profileData.myAvatarUrl && profileData.myAvatarUrl !== 'Không tìm thấy') {
                const localAvatarUrl = await downloadFbAvatar(profileData.myAvatarUrl, userId, accountName);
                if (localAvatarUrl) profileData.myAvatarUrl = localAvatarUrl;
            }

            result.myName = profileData.myName || '';
            result.myProfileUrl = profileData.myProfileUrl || '';
            result.myAvatarUrl = profileData.myAvatarUrl || '';
            result.scrapedAccountType = profileData.accountType || accountType;
        } catch (e) {
            console.warn(`[Facebook Login] Scrape lỗi: ${e.message}`);
        }
    }

    return result;
}

async function openYoutubeLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginWithCDP(userId, accountName, accountType, 'YT', 'https://www.youtube.com', ['SAPISID'], 'YouTube');
}

/**
 * Helper mở trình duyệt social, đợi người dùng đăng nhập và kiểm tra cookies
 * Sử dụng hasValidSessionCookies() thay vì verifyCookiesSaved() để tránh lưu profile
 * khi người dùng tắt Chrome hoặc chưa đăng nhập thành công.
 */
/**
 * Scrape profile info từ page cho tất cả platforms
 */
async function scrapePlatformProfile(page, platform) {
    let name = '';
    let profileUrl = '';
    let avatarUrl = '';

    try {
        switch (platform) {
            case 'TT': {
                // Vào TikTok homepage (user đã login)
                await page.goto('https://www.tiktok.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await page.waitForTimeout(5000);

                // Dùng XPath tìm link profile trong sidebar: <a href="/@username">
                const profileHref = await page.evaluate(() => {
                    // XPath: tìm a có href bắt đầu bằng /@ và chứa img (avatar link trong sidebar)
                    const xpath = '//a[starts-with(@href, "/@") and .//img]';
                    const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    for (let i = 0; i < result.snapshotLength; i++) {
                        const el = result.snapshotItem(i);
                        const href = el.getAttribute('href') || '';
                        // Bỏ các link không phải profile (video, reel...)
                        if (href.match(/^\/@[a-zA-Z0-9._]+$/) && !href.includes('/video/') && !href.includes('/live/')) {
                            return href;
                        }
                    }
                    // Fallback: tìm a[href^="/@"] trong sidebar/header
                    const allLinks = document.querySelectorAll('a[href^="/@"]');
                    for (const link of allLinks) {
                        const href = link.getAttribute('href') || '';
                        if (href.match(/^\/@[a-zA-Z0-9._]+$/)) return href;
                    }
                    return '';
                }).catch(() => '');

                if (profileHref) {
                    profileUrl = 'https://www.tiktok.com' + profileHref;
                    console.log(`[TikTok Scrape] Tìm thấy profile link: ${profileUrl}`);

                    // Vào trang profile thật để scrape
                    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await page.waitForTimeout(4000);
                } else {
                    console.log(`[TikTok Scrape] Không tìm thấy profile link trong sidebar`);
                }

                // Scrape bằng XPath
                const ttData = await page.evaluate(() => {
                    const r = { name: '', avatar: '', username: '' };

                    // NAME — XPath: //h1[@data-e2e="user-title"]
                    let el = document.evaluate('//h1[@data-e2e="user-title"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (el) r.name = el.textContent?.trim() || '';

                    // Fallback: //h2[@data-e2e="user-title"]
                    if (!r.name) {
                        el = document.evaluate('//h2[@data-e2e="user-title"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (el) r.name = el.textContent?.trim() || '';
                    }

                    // Fallback: //span[@data-e2e="user-title"]
                    if (!r.name) {
                        el = document.evaluate('//span[@data-e2e="user-title"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                        if (el) r.name = el.textContent?.trim() || '';
                    }

                    // AVATAR — //div[contains(@class,"DivAvatarContainer")]//img
                    el = document.evaluate('//div[contains(@class,"DivAvatarContainer")]//img', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (el && el.src) r.avatar = el.src;

                    // USERNAME — XPath: //span[@data-e2e="user-subtitle"]
                    el = document.evaluate('//span[@data-e2e="user-subtitle"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                    if (el) r.username = el.textContent?.trim() || '';

                    // Fallback: lấy từ URL pathname
                    if (!r.username) {
                        const match = window.location.pathname.match(/\/@([^/?]+)/);
                        if (match) r.username = '@' + match[1];
                    }

                    return r;
                });

                name = ttData.name || '';
                avatarUrl = ttData.avatar || '';

                // Username → profileUrl
                if (ttData.username && !profileUrl) {
                    const username = ttData.username.startsWith('@') ? ttData.username : '@' + ttData.username;
                    profileUrl = 'https://www.tiktok.com/' + username;
                }

                break;
            }
            case 'IG': {
                // Vào trang Instagram
                await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await page.waitForTimeout(4000);

                const igData = await page.evaluate(() => {
                    const r = { name: '', avatar: '', url: '', username: '' };

                    // Cách 1: Tìm từ link có href dạng /username/
                    const allLinks = document.querySelectorAll('a[href]');
                    for (const link of allLinks) {
                        const href = link.getAttribute('href') || '';
                        // Profile link: /username/ (không phải /explore/, /direct/, /accounts/, /p/, /reel/)
                        if (href.match(/^\/[a-zA-Z0-9._]{1,30}\/?$/) &&
                            !href.includes('/explore') && !href.includes('/direct') &&
                            !href.includes('/accounts') && !href.includes('/p/') &&
                            !href.includes('/reel/') && !href.includes('/stories/')) {
                            const img = link.querySelector('img');
                            if (img) {
                                r.username = href.replace(/\//g, '');
                                r.avatar = img.src || '';
                                r.name = img.alt || r.username;
                                break;
                            }
                        }
                    }

                    // Cách 2: Tìm từ tất cả img có src chứa instagram
                    if (!r.avatar) {
                        const imgs = document.querySelectorAll('img[src*="instagram"], img[src*="cdninstagram"]');
                        for (const img of imgs) {
                            const alt = img.alt || '';
                            const src = img.src || '';
                            // Avatar thường có kích thước nhỏ và alt là tên
                            if (alt && alt.length < 50 && !alt.includes('Like') && !alt.includes('Comment')) {
                                const parentLink = img.closest('a[href]');
                                if (parentLink) {
                                    const href = parentLink.getAttribute('href') || '';
                                    if (href.match(/^\/[a-zA-Z0-9._]{1,30}\/?$/)) {
                                        r.username = href.replace(/\//g, '');
                                        r.avatar = src;
                                        r.name = alt;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // Cách 3: Tìm username từ meta tag
                    if (!r.username) {
                        // Try og:title
                        const ogTitle = document.querySelector('meta[property="og:title"]');
                        if (ogTitle) {
                            const content = ogTitle.getAttribute('content') || '';
                            // Format: "username on Instagram: ..." hoặc "username (@username)"
                            const match = content.match(/^([a-zA-Z0-9._]+)/);
                            if (match) {
                                r.username = match[1];
                                r.name = match[1];
                            }
                        }
                    }

                    // Cách 4: Tìm từ script JSON-LD
                    if (!r.username) {
                        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                        for (const s of scripts) {
                            try {
                                const data = JSON.parse(s.textContent);
                                if (data['@type'] === 'Person' && data.alternateName) {
                                    r.username = data.alternateName.replace('@', '');
                                    r.name = data.name || r.username;
                                    if (data.image) r.avatar = data.image;
                                    break;
                                }
                            } catch (e) {}
                        }
                    }

                    if (r.username) {
                        r.url = 'https://www.instagram.com/' + r.username;
                    }

                    return r;
                });

                name = igData.name || igData.username || '';
                avatarUrl = igData.avatar || '';
                profileUrl = igData.url || '';

                // Fallback: nếu không scrape được, thử vào trang profile trực tiếp
                if (!profileUrl) {
                    try {
                        await page.goto('https://www.instagram.com/accounts/edit/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                        await page.waitForTimeout(2000);
                        const editData = await page.evaluate(() => {
                            const r = { username: '', name: '' };
                            const inputs = document.querySelectorAll('input');
                            for (const input of inputs) {
                                const label = input.getAttribute('aria-label') || input.getAttribute('name') || '';
                                if (label.toLowerCase().includes('username') || input.id === 'pepUsername') {
                                    r.username = input.value || '';
                                }
                                if (label.toLowerCase().includes('name') || input.id === 'pepName') {
                                    r.name = input.value || '';
                                }
                            }
                            return r;
                        });
                        if (editData.username) {
                            name = editData.name || editData.username;
                            profileUrl = 'https://www.instagram.com/' + editData.username;
                        }
                    } catch (e) {}
                }

                break;
            }
            case 'YT': {
                await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await page.waitForTimeout(3000);
                const ytData = await page.evaluate(() => {
                    const r = { name: '', avatar: '', url: '' };

                    // Avatar từ header
                    const img = document.querySelector('#avatar img, img.yt-img-shadow, ytd-topbar-menu-button-renderer img');
                    if (img) r.avatar = img.src || '';

                    // Tên kênh từ nhiều vị trí
                    const channelBtn = document.querySelector('#channel-name a, #channel-header a, ytd-channel-name a');
                    if (channelBtn) { r.name = channelBtn.textContent?.trim() || ''; r.url = channelBtn.href || ''; }

                    // Fallback: tìm từ button menu
                    if (!r.name) {
                        const menuBtn = document.querySelector('#avatar-btn button, #avatar-btn a');
                        if (menuBtn) {
                            const title = menuBtn.getAttribute('title') || menuBtn.getAttribute('aria-label') || '';
                            if (title) r.name = title;
                        }
                    }

                    // Fallback: meta tag
                    if (!r.name) {
                        const meta = document.querySelector('meta[property="og:title"]');
                        if (meta) r.name = meta.getAttribute('content') || '';
                    }

                    return r;
                });
                name = ytData.name;
                avatarUrl = ytData.avatar;
                profileUrl = ytData.url;
                break;
            }
            case 'TH': {
                await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await page.waitForTimeout(4000);
                const thData = await page.evaluate(() => {
                    const r = { name: '', avatar: '', username: '' };

                    // Cách 1: Tìm từ link profile
                    const links = document.querySelectorAll('a[href*="/"]');
                    for (const link of links) {
                        const href = link.getAttribute('href') || '';
                        if (href.match(/^\/[a-zA-Z0-9._]{1,30}\/?$/) && !href.includes('/explore') && !href.includes('/direct')) {
                            const img = link.querySelector('img');
                            if (img) {
                                r.username = href.replace(/\//g, '');
                                r.avatar = img.src || '';
                                r.name = img.alt || r.username;
                                break;
                            }
                        }
                    }

                    // Cách 2: Tìm từ img avatar
                    if (!r.avatar) {
                        const imgs = document.querySelectorAll('img[src*="instagram"], img[src*="cdninstagram"], img[src*="threads"]');
                        for (const img of imgs) {
                            const alt = img.alt || '';
                            if (alt && alt.length < 50 && !alt.includes('Like') && !alt.includes('Comment')) {
                                r.avatar = img.src || '';
                                r.name = alt;
                                break;
                            }
                        }
                    }

                    // Cách 3: Tìm từ span/header
                    if (!r.name) {
                        const h2 = document.querySelector('h2');
                        if (h2) r.name = h2.textContent?.trim() || '';
                    }

                    // Cách 4: meta tag
                    if (!r.name) {
                        const meta = document.querySelector('meta[property="og:title"]');
                        if (meta) {
                            const content = meta.getAttribute('content') || '';
                            r.name = content.replace(/\s*•\s*Threads.*$/i, '').trim();
                        }
                    }

                    return r;
                });
                name = thData.name || thData.username || '';
                avatarUrl = thData.avatar || '';
                if (thData.username) profileUrl = 'https://www.threads.net/' + thData.username;
                break;
            }
            case 'ZO': {
                await page.goto('https://chat.zalo.me/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await page.waitForTimeout(3000);
                const zoData = await page.evaluate(() => {
                    const r = { name: '', avatar: '' };
                    // Avatar
                    const img = document.querySelector('.avatar img, .profile-avatar img, img[src*="avatar"]');
                    if (img) r.avatar = img.src || '';
                    // Name
                    const nameEl = document.querySelector('.profile-name, .user-name, .display-name');
                    if (nameEl) r.name = nameEl.textContent?.trim() || '';
                    return r;
                });
                name = zoData.name;
                avatarUrl = zoData.avatar;
                break;
            }
            case 'PI': {
                await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                await page.waitForTimeout(3000);
                const piData = await page.evaluate(() => {
                    const r = { name: '', avatar: '', url: '' };
                    // Avatar
                    const img = document.querySelector('img[src*="avatar"], img[data-test-id="profile-avatar"]');
                    if (img) r.avatar = img.src || '';
                    // Name/URL từ link profile
                    const profileLink = document.querySelector('a[href*="/"]');
                    if (profileLink) {
                        const href = profileLink.getAttribute('href') || '';
                        if (href.match(/^\/[a-zA-Z0-9_]+\/?$/)) {
                            r.url = 'https://www.pinterest.com' + href;
                            r.name = href.replace(/\//g, '');
                        }
                    }
                    // Fallback: meta
                    if (!r.name) {
                        const meta = document.querySelector('meta[property="og:title"]');
                        if (meta) r.name = meta.getAttribute('content') || '';
                    }
                    return r;
                });
                name = piData.name;
                avatarUrl = piData.avatar;
                profileUrl = piData.url;
                break;
            }
            default: {
                break;
            }
        }
    } catch (e) {
        console.warn(`[Scrape ${platform}] Error: ${e.message}`);
    }

    return { name: name || '', profileUrl: profileUrl || '', avatarUrl: avatarUrl || '' };
}

/**
 * Open an already-connected social account without resetting/deleting its saved session.
 * Dùng CDP Chrome thật - không bị detect automation.
 */
async function openExistingSocialBrowserWindow(userId, accountName, accountType = 'Personal', platform = 'FB', storageStatePath = '') {
    const platformUrls = {
        FB: 'https://www.facebook.com',
        TT: 'https://www.tiktok.com',
        IG: 'https://www.instagram.com',
        YT: 'https://www.youtube.com',
        ZO: 'https://chat.zalo.me',
        PI: 'https://www.pinterest.com',
        TH: 'https://www.threads.net'
    };

    const normalizedPlatform = String(platform || 'FB').toUpperCase();
    const targetUrl = platformUrls[normalizedPlatform] || platformUrls.FB;
    const savedStatePath = normalizeEncryptedStoragePath(storageStatePath);
    const profileDir = savedStatePath
        ? path.dirname(savedStatePath)
        : buildAccountFolder(userId, accountName, normalizedPlatform);

    ensureDir(profileDir);

    const sessionKey = `${userId}:${normalizedPlatform}:${sanitizeFolderName(path.basename(profileDir))}`;
    let session = ACTIVE_SOCIAL_SESSIONS.get(sessionKey);

    // Kiểm tra session đang mở
    if (session?.context && !session.context.isClosed()) {
        const page = session.context.pages()[0] || await session.context.newPage();
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        return {
            success: true, cookiesSaved: true,
            message: `Chrome (${accountType}) cho ${normalizedPlatform} "${accountName}" đang mở sẵn.`,
            storageStatePath: savedStatePath || getStorageStatePath(userId, accountName, normalizedPlatform),
            sessionDir: profileDir, accountName, accountType, sessionKey
        };
    }

    // Load cookies từ storage state vào Chrome profile
    const statePath = savedStatePath || getStorageStatePath(userId, accountName, normalizedPlatform);
    if (fs.existsSync(statePath)) {
        try {
            const storageState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            // Copy cookies vào Chrome profile format nếu cần
            console.log(`[Open ${normalizedPlatform}] Loaded ${storageState.cookies?.length || 0} cookies from storage state`);
        } catch (e) {}
    }

    // Launch Chrome thật với CDP
    let chromeProc, port;
    try {
        ({ process: chromeProc, port } = launchChromeWithCDP(profileDir, targetUrl));
    } catch (e) {
        return {
            success: false, message: e.message,
            storageStatePath: statePath, sessionDir: profileDir,
            accountName, accountType, sessionKey: null, cookiesSaved: false
        };
    }

    await new Promise(r => setTimeout(r, 3000));

    let browser, context, page;
    try {
        ({ browser, context, page } = await connectChromeCDP(port));
    } catch (e) {
        try { chromeProc.kill(); } catch (e2) {}
        return {
            success: false, message: e.message,
            storageStatePath: statePath, sessionDir: profileDir,
            accountName, accountType, sessionKey: null, cookiesSaved: false
        };
    }

    // Inject cookies từ storage state vào browser
    if (fs.existsSync(statePath)) {
        try {
            const storageState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (storageState.cookies && storageState.cookies.length > 0) {
                await context.addCookies(storageState.cookies);
                await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
                console.log(`[Open ${normalizedPlatform}] Injected ${storageState.cookies.length} cookies`);
            }
        } catch (e) {
            console.warn(`[Open ${normalizedPlatform}] Lỗi inject cookies: ${e.message}`);
        }
    }

    ACTIVE_SOCIAL_SESSIONS.set(sessionKey, { context, page, userSessionDir: profileDir, accountName, accountType, platform: normalizedPlatform, headless: false });

    // Đợi Chrome đóng
    await waitForChromeClose(chromeProc);

    // Lưu cookies mới
    try {
        if (context && !context.isClosed()) {
            const cookies = await context.cookies();
            if (cookies.length > 0) {
                fs.writeFileSync(statePath, JSON.stringify({ cookies, origins: [] }, null, 2));
            }
        }
    } catch (e) {}
    try { await browser.close(); } catch (e) {}
    ACTIVE_SOCIAL_SESSIONS.delete(sessionKey);

    return {
        success: true, cookiesSaved: true,
        message: `Đã mở Chrome (${accountType}) cho ${normalizedPlatform} "${accountName}".`,
        storageStatePath: statePath, sessionDir: profileDir,
        accountName, accountType, sessionKey
    };
}

function normalizeEncryptedStoragePath(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('enc:')) return '';
    return raw;
}

/**
 * Scrape TikTok profile info từ browser context đã đăng nhập.
 * Trả về { myName, myProfileUrl, myAvatarUrl }
 */
async function scrapeTiktokProfile(context) {
    let myName = 'Không tìm thấy';
    let myProfileUrl = 'Không tìm thấy';
    let myAvatarUrl = 'Không tìm thấy';

    try {
        const page = context.pages()[0] || await context.newPage();

        // Vào TikTok homepage (user đã login)
        await page.goto('https://www.tiktok.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(5000);

        // Nếu redirect về trang login -> chưa đăng nhập
        if (page.url().includes('login')) {
            console.log('[TikTok Profile] Chưa đăng nhập, bỏ qua scrape');
            return { myName, myProfileUrl, myAvatarUrl };
        }

        // Dùng XPath tìm link profile trong sidebar: <a href="/@username">
        const profileHref = await page.evaluate(() => {
            const xpath = '//a[starts-with(@href, "/@") and .//img]';
            const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < result.snapshotLength; i++) {
                const el = result.snapshotItem(i);
                const href = el.getAttribute('href') || '';
                if (href.match(/^\/@[a-zA-Z0-9._]+$/) && !href.includes('/video/') && !href.includes('/live/')) {
                    return href;
                }
            }
            const allLinks = document.querySelectorAll('a[href^="/@"]');
            for (const link of allLinks) {
                const href = link.getAttribute('href') || '';
                if (href.match(/^\/@[a-zA-Z0-9._]+$/)) return href;
            }
            return '';
        }).catch(() => '');

        if (profileHref) {
            myProfileUrl = 'https://www.tiktok.com' + profileHref;
            console.log(`[TikTok Profile] Tìm thấy profile link: ${myProfileUrl}`);

            // Vào trang profile thật để scrape
            await page.goto(myProfileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(4000);
        } else {
            console.log(`[TikTok Profile] Không tìm thấy profile link trong sidebar`);
        }

        // Scrape bằng XPath
        const profileData = await page.evaluate(() => {
            const result = { name: '', avatarUrl: '', username: '' };

            // NAME — //h1[@data-e2e="user-title"]
            let el = document.evaluate('//h1[@data-e2e="user-title"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el) result.name = el.textContent?.trim() || '';

            if (!result.name) {
                el = document.evaluate('//h2[@data-e2e="user-title"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (el) result.name = el.textContent?.trim() || '';
            }

            if (!result.name) {
                el = document.evaluate('//span[@data-e2e="user-title"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
                if (el) result.name = el.textContent?.trim() || '';
            }

            // AVATAR — //div[contains(@class,"DivAvatarContainer")]//img
            el = document.evaluate('//div[contains(@class,"DivAvatarContainer")]//img', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el && el.src) result.avatarUrl = el.src;

            // USERNAME — //span[@data-e2e="user-subtitle"]
            el = document.evaluate('//span[@data-e2e="user-subtitle"]', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            if (el) result.username = el.textContent?.trim() || '';

            if (!result.username) {
                const match = window.location.pathname.match(/\/@([^/?]+)/);
                if (match) result.username = '@' + match[1];
            }

            return result;
        });

        if (profileData.name) myName = profileData.name;
        if (profileData.avatarUrl) myAvatarUrl = profileData.avatarUrl;

        // Username → profileUrl
        if (profileData.username && myProfileUrl === 'Không tìm thấy') {
            const username = profileData.username.startsWith('@') ? profileData.username : '@' + profileData.username;
            myProfileUrl = 'https://www.tiktok.com/' + username;
        }

        console.log(`[TikTok Profile] name="${myName}" url="${myProfileUrl}" avatar=${myAvatarUrl !== 'Không tìm thấy' ? 'yes' : 'no'}`);
    } catch (err) {
        console.error(`[TikTok Profile] Lỗi scrape: ${err.message}`);
    }

    return { myName, myProfileUrl, myAvatarUrl };
}

/**
 * Download TikTok avatar từ CDN về local
 */
async function downloadTiktokAvatar(url, userId, accountName) {
    if (!url || url === 'Không tìm thấy' || !url.startsWith('http')) return '';
    try {
        const https = require('https');
        const http = require('http');

        const avatarDir = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'avatars');
        ensureDir(avatarDir);

        const filename = `${userId}_${sanitizeFolderName(accountName)}_tt_avatar.jpg`;
        const filePath = path.join(avatarDir, filename);

        const response = await new Promise((resolve, reject) => {
            const mod = url.startsWith('https') ? https : http;
            const req = mod.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 15000
            }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    const redirectMod = res.headers.location.startsWith('https') ? https : http;
                    redirectMod.get(res.headers.location, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                        timeout: 15000
                    }, resolve).on('error', reject);
                    return;
                }
                if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                resolve(res);
            });
            req.on('error', reject);
        });

        const buffer = await new Promise((resolve, reject) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        });

        if (buffer.length < 100) return '';

        fs.writeFileSync(filePath, buffer);
        console.log(`[TikTok Avatar] Đã lưu avatar local: ${filePath}`);
        return `/uploads/avatars/${filename}`;
    } catch (e) {
        console.error(`[TikTok Avatar] Lỗi download: ${e.message}`);
        return '';
    }
}

async function openTiktokLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginWithCDP(userId, accountName, accountType, 'TT', 'https://www.tiktok.com', ['sessionid'], 'TikTok');
}

async function openInstagramLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginWithCDP(userId, accountName, accountType, 'IG', 'https://www.instagram.com', ['sessionid'], 'Instagram');
}

async function openZaloLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginWithCDP(userId, accountName, accountType, 'ZO', 'https://chat.zalo.me', ['zmp3sz'], 'Zalo');
}

async function openPinterestLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginWithCDP(userId, accountName, accountType, 'PI', 'https://www.pinterest.com', ['_pinterest_sess'], 'Pinterest');
}

async function openThreadsLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginWithCDP(userId, accountName, accountType, 'TH', 'https://www.threads.net', ['sessionid'], 'Threads');
}

module.exports = {
    getSocialSessionProfile,
    openFacebookLoginWindow,
    openYoutubeLoginWindow,
    openTiktokLoginWindow,
    openInstagramLoginWindow,
    openZaloLoginWindow,
    openPinterestLoginWindow,
    openThreadsLoginWindow,
    openExistingSocialBrowserWindow,
    getJoinedFacebookGroupsCached,
    getOrOpenSocialContext,
    downloadTiktokAvatar
};
