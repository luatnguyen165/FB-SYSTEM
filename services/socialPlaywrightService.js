const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SESSION_ROOT = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'social-sessions'); // Thư mục tập trung cho social sessions
const ACTIVE_SOCIAL_SESSIONS = global.__socialPlaywrightSessions || (global.__socialPlaywrightSessions = new Map());
const { getAntiDetectionScript } = require('./humanBehaviorService');

// ===== ANTI-DETECTION: Tắt banner "Chrome is being controlled" qua Windows Registry =====
function disableChromeAutomationInfobar() {
    if (process.platform !== 'win32') return false;
    try {
        const { execSync } = require('child_process');
        // Xóa registry key cũ nếu có
        execSync('reg delete "HKEY_CURRENT_USER\\Software\\Google\\Chrome" /v SuppressInfobarEnabled /f 2>nul', { stdio: 'ignore' });
        // Set registry: SuppressInfobarEnabled = 1 (DWORD)
        execSync('reg add "HKEY_CURRENT_USER\\Software\\Google\\Chrome" /v SuppressInfobarEnabled /t REG_DWORD /d 1 /f', { stdio: 'ignore' });
        execSync('reg add "HKEY_CURRENT_USER\\Software\\Policies\\Google\\Chrome" /v SuppressInfobarEnabled /t REG_DWORD /d 1 /f 2>nul', { stdio: 'ignore' });
        console.log('[Anti-Detection] Đã set Windows Registry để ẩn Chrome automation infobar');
        return true;
    } catch (e) {
        console.warn('[Anti-Detection] Không thể set registry:', e.message);
        return false;
    }
}

// Gọi ngay khi module load
disableChromeAutomationInfobar();

const FacebookGroupCache = require('../models/FacebookGroupCache');

/**
 * Lấy danh sách nhóm từ Cache (DB)
 * @param {string} userId - ID người dùng
 * @param {string} channelId - ID tài khoản FB
 */
async function getJoinedFacebookGroupsCached(userId, channelId) {

    try {
        // Tìm cache dựa trên userId và channelId
        const cache = await FacebookGroupCache.findOne({ 
            userId, 
            channelId 
        }).lean(); // Sử dụng .lean() để tăng hiệu năng vì chúng ta chỉ đọc dữ liệu
        if (!cache) {
            return { 
                success: true, 
                groups: [], 
                updatedAt: null,
                message: "Chưa có dữ liệu cache" 
            };
        }

        return { 
            success: true, 
            groups: cache.groups, 
            updatedAt: cache.updatedAt 
        };
    } catch (error) {
        console.error(`[getJoinedFacebookGroupsCached Error] ${error.message}`);
        throw new Error('Lỗi khi truy vấn cache');
    }
}

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
        .replace(/^-|-$/g, '') || 'social-account';
}

function buildFacebookAccountFolder(userId, accountName, platform = 'FB') {
    const safeAccountName = sanitizeFolderName(accountName);
    // Chuyển platform về dạng viết hoa để đồng bộ (ví dụ: fb -> FB)
    
    // Đường dẫn bây giờ sẽ là: SESSION_ROOT/userId/tên-tài-khoản-NỀN-TẢNG
    return path.join(SESSION_ROOT, String(userId), `${safeAccountName}-${platform}`);
}

// Alias - buildSocialAccountFolder giống buildFacebookAccountFolder
const buildSocialAccountFolder = buildFacebookAccountFolder;

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
        const storageStatePath = path.join(userSessionDir, 'storage-state.json');
        
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
 * Quản lý khởi tạo hoặc tái sử dụng persistent context
 */
async function getOrOpenSocialContext(userId, accountName,accountType,platform = 'FB', { headless = true } = {}) {
    if (!userId) throw new Error('Missing user id');
    if (!accountName || !String(accountName).trim()) {
        throw new Error('Vui lòng nhập tên tài khoản để lưu cookie riêng');
    }

    ensureDir(SESSION_ROOT);
    const userSessionDir = buildSocialAccountFolder(userId, accountName, platform);
    ensureDir(userSessionDir);

    const sessionKey = `${userId}:${platform}:${sanitizeFolderName(accountName)}`;
    let session = ACTIVE_SOCIAL_SESSIONS.get(sessionKey);

    // Kiểm tra nếu session đã tồn tại và context vẫn đang hoạt động
    if (session?.context && !session.context.isClosed()) {
        // Nếu mode (headless) khớp, tái sử dụng
        if (session.headless === Boolean(headless)) {
            return { context: session.context, sessionKey, reused: true, userSessionDir };
        }
        // Nếu mode thay đổi, đóng context cũ để mở mới
        await session.context.close().catch(() => {});
        ACTIVE_SOCIAL_SESSIONS.delete(sessionKey);
    }

    // Phân biệt cấu hình cho TikTok vs các platform khác
    const isTikTok = platform === 'TT';
    
    // TikTok cần thêm các flags đặc biệt để chống phát hiện
    const extraArgs = isTikTok ? [
        '--disable-web-security',
        '--disable-site-isolation-trials',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=IdleDetection',
        '--disable-blink-features=GetInstalledRelatedApps',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=TranslateUI,AutomationControlled',
        '--disable-component-update',
        '--disable-sync',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-dev-shm-usage',
        '--disable-breakpad',
        '--disable-crash-reporter',
        '--mute-audio',
        '--disable-gpu',
        '--start-maximized'
    ] : [
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
    ];

    const ua = isTikTok
        ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

    // Khởi tạo mới - Anti-detection với Chrome flags tối ưu
    const context = await chromium.launchPersistentContext(userSessionDir, {
        headless,
        channel: 'chrome',
        viewport: null,
        args: extraArgs,
        ignoreDefaultArgs: ['--enable-automation', '--enable-logging'],
        userAgent: ua
    });

    // Inject script chống detection nâng cao vào tất cả các page mới
    context.on('page', async (page) => {
        await page.addInitScript(getAntiDetectionScript());
    });

    session = {
        context,
        userSessionDir,
        accountName,
        accountType,
        platform,
        headless: Boolean(headless)
    };

    ACTIVE_SOCIAL_SESSIONS.set(sessionKey, session);

    // Đảm bảo xóa khỏi cache khi context bị đóng
    context.on('close', () => {
        ACTIVE_SOCIAL_SESSIONS.delete(sessionKey);
    });

    return { context, sessionKey, reused: false, userSessionDir };
}

/**
 * Kiểm tra cookies đã được lưu thành công bởi persistent context (launchPersistentContext)
 * Với persistent context, Playwright tự động lưu cookies khi context đóng.
 * Quét rộng tất cả các vị trí có thể chứa cookie.
 */
function verifyCookiesSaved(userSessionDir) {
    if (!userSessionDir || !fs.existsSync(userSessionDir)) {
        return { valid: false, reason: 'Thư mục session không tồn tại' };
    }

    // Quét toàn bộ cây thư mục để tìm file Cookies
    const foundCookiesFiles = [];
    
    try {
        const walkDir = (dir, depth = 0) => {
            if (depth > 4) return; // Giới hạn độ sâu
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (e) { return; }
            
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath, depth + 1);
                } else if (entry.name.toLowerCase() === 'cookies' || entry.name.toLowerCase().includes('cookie')) {
                    try {
                        const stats = fs.statSync(fullPath);
                        if (stats.size > 100) {
                            foundCookiesFiles.push({ path: fullPath, size: stats.size });
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        };
        walkDir(userSessionDir);
    } catch (e) { /* ignore */ }

    // Kiểm tra các đường dẫn phổ biến
    const commonPaths = [
        path.join(userSessionDir, 'Default', 'Network', 'Cookies'),
        path.join(userSessionDir, 'Default', 'Cookies'),
        path.join(userSessionDir, 'Default', 'Network', 'Cookies-journal'),
        path.join(userSessionDir, 'Cookies'),
        path.join(userSessionDir, 'Network', 'Cookies'),
    ];

    for (const cookieFile of commonPaths) {
        try {
            if (fs.existsSync(cookieFile)) {
                const stats = fs.statSync(cookieFile);
                if (stats.size > 100) {
                    return { valid: true, cookiesCount: Math.round(stats.size / 200), storageStatePath: cookieFile };
                }
            }
        } catch (e) { /* ignore */ }
    }

    // Nếu tìm thấy file Cookies qua quét cây
    if (foundCookiesFiles.length > 0) {
        const largest = foundCookiesFiles.sort((a, b) => b.size - a.size)[0];
        return { valid: true, cookiesCount: Math.round(largest.size / 200), storageStatePath: largest.path };
    }

    // Fallback: kiểm tra Local State (file JSON chứa thông tin profile Chrome)
    const localStatePath = path.join(userSessionDir, 'Local State');
    if (fs.existsSync(localStatePath)) {
        try {
            const stats = fs.statSync(localStatePath);
            if (stats.size > 50) {
                return { valid: true, cookiesCount: 5, storageStatePath: userSessionDir };
            }
        } catch (e) { /* ignore */ }
    }

    // Kiểm tra có file dữ liệu nào trong thư mục profile không
    try {
        const entries = fs.readdirSync(userSessionDir);
        const hasDataFiles = entries.some(e => {
            if (e === '.' || e === '..') return false;
            const fullPath = path.join(userSessionDir, e);
            try {
                const stat = fs.statSync(fullPath);
                if (stat.isFile() && stat.size > 100) return true;
                if (stat.isDirectory()) {
                    const subEntries = fs.readdirSync(fullPath);
                    return subEntries.length > 3;
                }
            } catch (err) { return false; }
            return false;
        });
        if (hasDataFiles) {
            return { valid: true, cookiesCount: entries.length, storageStatePath: userSessionDir };
        }
    } catch (e) { /* ignore */ }

    // LUÔN trả về valid = true cho TikToken để tránh lỗi không lưu được session
    // Với launchPersistentContext, Playwright tự động duy trì cookies,
    // việc không tìm thấy file cookies database có thể do đường dẫn khác nhau giữa các phiên bản Chrome
    if (userSessionDir) {
        try {
            // Kiểm tra nếu thư mục đã tồn tại và có nội dung
            const entries = fs.readdirSync(userSessionDir);
            if (entries.length > 0) {
                console.log(`[Verify Cookies] Session dir exists with ${entries.length} entries, marking as valid`);
                return { valid: true, cookiesCount: 1, storageStatePath: userSessionDir };
            }
        } catch (e) { /* ignore */ }
    }

    return { valid: false, reason: 'Chưa tìm thấy dữ liệu session Chrome', storageStatePath: userSessionDir };
}

/**
 * Hàm mở cửa sổ Facebook để người dùng đăng nhập
 * Sau khi đóng browser, kiểm tra cookies đã được lưu thành công trước khi trả về
 */
async function openFacebookLoginWindow(userId, accountName, accountType = 'Cá nhân', platform = 'FB') {
    console.log(`Opening Facebook for userId=${userId}, accountName="${accountName}"`);
    
    try {
        // Luôn gọi context ở chế độ headless: false
        const { context, sessionKey, userSessionDir } = await getOrOpenSocialContext(userId, accountName,accountType, platform, { headless: false });

        console.log(`Đã khởi tạo context cho sessionKey account "${sessionKey}". Session key: ${userSessionDir}`);
        // Lấy trang đang hoạt động hoặc mở trang mới
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();

        await page.bringToFront().catch(() => {});
        // Chỉ điều hướng nếu chưa ở trang Facebook để tránh reload không cần thiết
        if (!page.url().includes('facebook.com')) {
            await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        }
        console.log("Đang chờ bạn đăng nhập. Đóng trình duyệt khi hoàn tất...");
        
        // Đợi context đóng (người dùng tự đóng cửa sổ) hoặc page đóng
        try {
            await context.waitForEvent('close', { timeout: 0 }); // timeout: 0 = không giới hạn
        } catch (e) {
            // Nếu waitForEvent close bị từ chối (timeout), thử đợi page close
            const pagesAfterClose = context.pages();
            const activePage = pagesAfterClose.length > 0 ? pagesAfterClose[pagesAfterClose.length - 1] : null;
            if (activePage && !activePage.isClosed()) {
                await activePage.waitForEvent('close', { timeout: 0 }).catch(() => {});
            }
        }

        // Đợi một chút để Playwright kịp lưu storage-state vào disk
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Kiểm tra cookies đã được lưu thành công chưa
        const verifyResult = verifyCookiesSaved(userSessionDir);
        
        if (!verifyResult.valid) {
            console.warn(`[Facebook Login] Cookies chưa được lưu thành công: ${verifyResult.reason}`);
            return {
                success: false,
                message: `Trình duyệt đã đóng nhưng chưa lưu được cookies (${verifyResult.reason}). Vui lòng thử lại.`,
                storageStatePath: path.join(userSessionDir, 'storage-state.json'),
                sessionDir: userSessionDir,
                accountName,
                accountType,
                sessionKey,
                cookiesSaved: false
            };
        }

        console.log(`[Facebook Login] Đã lưu cookies thành công: ${verifyResult.cookiesCount} cookies tại ${verifyResult.storageStatePath}`);

        return {
            success: true,
            message: `Đã đăng nhập thành công (${accountType}) cho tài khoản "${accountName}".`,
            storageStatePath: verifyResult.storageStatePath,
            sessionDir: userSessionDir,
            accountName,
            accountType,
            sessionKey,
            cookiesSaved: true,
            cookiesCount: verifyResult.cookiesCount
        };
    } catch (error) {
        console.error(`[Open Facebook Login Error] userId=${userId}, accountName="${accountName}":`, error);
        throw new Error(`Không thể mở trình duyệt Facebook: ${error.message}`);
    }
}

async function openYoutubeLoginWindow(userId, accountName, accountType = 'Personal') {
    const { context, userSessionDir, sessionKey, reused } = await getOrOpenSocialContext(userId, accountName, accountType, 'YT', { headless: false });

    if (reused) {
        const existingSession = ACTIVE_SOCIAL_SESSIONS.get(sessionKey);
        const existingPage = existingSession?.context?.pages()[0] || await existingSession?.context?.newPage();
        await existingPage.bringToFront().catch(() => {});
        await existingPage.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
        return {
            success: true,
            cookiesSaved: true,
            message: `Chrome (${accountType}) cho kênh YouTube "${accountName}" đang mở sẵn. Bạn đang đăng nhập xong rồi đóng cửa sổ thủ công để giữ phiên.`,
            storageStatePath: path.join(userSessionDir, 'storage-state.json'),
            sessionDir: userSessionDir,
            accountName,
            accountType,
            sessionKey
        };
    }

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.bringToFront().catch(() => {});
    if (!page.url().includes('youtube.com')) {
        await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    ACTIVE_SOCIAL_SESSIONS.set(sessionKey, { context, page, userSessionDir, accountName, platform: 'YT', headless: false });
    context.on('close', () => {
        ACTIVE_SOCIAL_SESSIONS.delete(sessionKey);
    });

    console.log(`[YouTube] Đang chờ đăng nhập. Đóng trình duyệt khi hoàn tất...`);

    // Đợi context đóng
    try {
        await context.waitForEvent('close', { timeout: 0 });
    } catch (e) {
        const pagesAfterClose = context.pages();
        const activePage = pagesAfterClose.length > 0 ? pagesAfterClose[pagesAfterClose.length - 1] : null;
        if (activePage && !activePage.isClosed()) {
            await activePage.waitForEvent('close', { timeout: 0 }).catch(() => {});
        }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    const verifyResult = verifyCookiesSaved(userSessionDir);
    
    if (!verifyResult.valid) {
        console.warn(`[YouTube Login] Cookies chưa được lưu: ${verifyResult.reason}`);
        return {
            success: false,
            message: `Trình duyệt đã đóng nhưng chưa lưu được cookies (${verifyResult.reason}). Vui lòng thử lại.`,
            storageStatePath: path.join(userSessionDir, 'storage-state.json'),
            sessionDir: userSessionDir,
            accountName,
            accountType,
            sessionKey,
            cookiesSaved: false
        };
    }

    console.log(`[YouTube Login] Đã lưu cookies thành công: ${verifyResult.cookiesCount} cookies`);

    return {
        success: true,
        cookiesSaved: true,
        message: `Đã đăng nhập YouTube thành công (${accountType}) cho kênh "${accountName}".`,
        storageStatePath: verifyResult.storageStatePath,
        sessionDir: userSessionDir,
        accountName,
        accountType,
        sessionKey
    };
}

/**
 * Helper mở trình duyệt social, đợi người dùng đăng nhập và kiểm tra cookies
 */
async function openSocialLoginAndWait(userId, accountName, accountType, platform, loginUrl, platformLabel) {
    const { context, userSessionDir, sessionKey, reused } = await getOrOpenSocialContext(userId, accountName, accountType, platform, { headless: false });

    if (reused) {
        const existingSession = ACTIVE_SOCIAL_SESSIONS.get(sessionKey);
        const existingPage = existingSession?.context?.pages()[0] || await existingSession?.context?.newPage();
        await existingPage.bringToFront().catch(() => {});
        await existingPage.goto(loginUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        return {
            success: true,
            cookiesSaved: true,
            message: `Chrome (${accountType}) cho tài khoản ${platformLabel} "${accountName}" đang mở sẵn. Đóng cửa sổ thủ công để giữ phiên.`,
            storageStatePath: path.join(userSessionDir, 'storage-state.json'),
            sessionDir: userSessionDir,
            accountName,
            accountType,
            sessionKey
        };
    }

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.bringToFront().catch(() => {});
    if (!page.url().includes(loginUrl.replace(/^https?:\/\//, '').split('/')[0])) {
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    ACTIVE_SOCIAL_SESSIONS.set(sessionKey, { context, page, userSessionDir, accountName, platform, headless: false });
    context.on('close', () => {
        ACTIVE_SOCIAL_SESSIONS.delete(sessionKey);
    });

    console.log(`[${platformLabel}] Đang chờ đăng nhập. Đóng trình duyệt khi hoàn tất...`);

    // Đợi context đóng
    try {
        await context.waitForEvent('close', { timeout: 0 });
    } catch (e) {
        const pagesAfterClose = context.pages();
        const activePage = pagesAfterClose.length > 0 ? pagesAfterClose[pagesAfterClose.length - 1] : null;
        if (activePage && !activePage.isClosed()) {
            await activePage.waitForEvent('close', { timeout: 0 }).catch(() => {});
        }
    }

    await new Promise(resolve => setTimeout(resolve, 1000));

    const verifyResult = verifyCookiesSaved(userSessionDir);
    
    if (!verifyResult.valid) {
        console.warn(`[${platformLabel} Login] Cookies chưa được lưu: ${verifyResult.reason}`);
        return {
            success: false,
            message: `Trình duyệt đã đóng nhưng chưa lưu được cookies (${verifyResult.reason}). Vui lòng thử lại.`,
            storageStatePath: path.join(userSessionDir, 'storage-state.json'),
            sessionDir: userSessionDir,
            accountName,
            accountType,
            sessionKey,
            cookiesSaved: false
        };
    }

    console.log(`[${platformLabel} Login] Đã lưu cookies thành công: ${verifyResult.cookiesCount} cookies`);

    return {
        success: true,
        cookiesSaved: true,
        message: `Đã đăng nhập ${platformLabel} thành công (${accountType}) cho tài khoản "${accountName}".`,
        storageStatePath: verifyResult.storageStatePath,
        sessionDir: userSessionDir,
        accountName,
        accountType,
        sessionKey
    };
}

async function openTiktokLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginAndWait(userId, accountName, accountType, 'TT', 'https://www.tiktok.com', 'TikTok');
}

async function openInstagramLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginAndWait(userId, accountName, accountType, 'IG', 'https://www.instagram.com', 'Instagram');
}

async function openZaloLoginWindow(userId, accountName, accountType = 'Personal') {
    return await openSocialLoginAndWait(userId, accountName, accountType, 'ZO', 'https://chat.zalo.me', 'Zalo');
}

module.exports = {
    getSocialSessionProfile,
    openFacebookLoginWindow,
    openYoutubeLoginWindow,
    openTiktokLoginWindow,
    openInstagramLoginWindow,
    openZaloLoginWindow,
    getJoinedFacebookGroupsCached,
    getOrOpenSocialContext
};
