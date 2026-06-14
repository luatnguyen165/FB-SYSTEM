const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { SESSION_ROOT, ensureDir, sanitizeFolderName, buildAccountFolder, verifyCookiesSaved, getChromeArgs, getUserAgent, waitForContextClose } = require('./common/browser');
const { getAntiDetectionScript } = require('./humanBehaviorService');
const FacebookGroupCache = require('../models/FacebookGroupCache');

const ACTIVE_SOCIAL_SESSIONS = global.__socialPlaywrightSessions || (global.__socialPlaywrightSessions = new Map());

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
