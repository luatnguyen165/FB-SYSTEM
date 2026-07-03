// services/facebook/session.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const { SESSION_ROOT, ensureDir, sanitizeFolderName, buildAccountFolder, getChromeArgs, getUserAgent } = require('../common/browser');

const ACTIVE_FB_SESSIONS = new Map();
const PROFILE_URL_WATCHERS = global.__facebookProfileUrlWatchers || (global.__facebookProfileUrlWatchers = new Map());

// Track background group-scan jobs theo sessionKey — chống trùng giữa các lần reconnect
const GROUP_SCAN_JOBS = global.__facebookGroupScanJobs || (global.__facebookGroupScanJobs = new Map());

// Alias for backward compatibility
const buildFacebookAccountFolder = buildAccountFolder;

/**
 * Patch Chrome profile Preferences để force ngôn ngữ vi-VN
 * Chrome profile cũ có selected_languages="en-US,en" → override --lang flag
 */
function patchChromeLanguage(sessionDir) {
    try {
        const defaultDir = path.join(sessionDir, 'Default');
        if (!fs.existsSync(defaultDir)) {
            fs.mkdirSync(defaultDir, { recursive: true });
        }

        const VI_LANG = 'vi-VN,vi,en-US,en';

        // Patch 1: Default/Preferences
        const prefsPath = path.join(defaultDir, 'Preferences');
        let prefs = {};
        if (fs.existsSync(prefsPath)) {
            try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch (e) { prefs = {}; }
        }
        if (!prefs.intl) prefs.intl = {};
        prefs.intl.selected_languages = VI_LANG;
        prefs.intl.accept_languages = VI_LANG;
        if (!prefs.browser) prefs.browser = {};
        prefs.browser.language = 'vi-VN';
        fs.writeFileSync(prefsPath, JSON.stringify(prefs));

        // Patch 2: Default/Secure Preferences
        const secPrefsPath = path.join(defaultDir, 'Secure Preferences');
        if (fs.existsSync(secPrefsPath)) {
            try {
                const sp = JSON.parse(fs.readFileSync(secPrefsPath, 'utf8'));
                if (!sp.browser) sp.browser = {};
                sp.browser.language = 'vi-VN';
                fs.writeFileSync(secPrefsPath, JSON.stringify(sp));
            } catch (e) {}
        }

        // Patch 3: Local State (browser-wide)
        const localStatePath = path.join(sessionDir, 'Local State');
        if (fs.existsSync(localStatePath)) {
            try {
                const ls = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
                if (!ls.intl) ls.intl = {};
                ls.intl.selected_languages = VI_LANG;
                ls.intl.accept_languages = VI_LANG;
                fs.writeFileSync(localStatePath, JSON.stringify(ls));
            } catch (e) {}
        }
    } catch (e) {
        console.warn(`[Facebook Context] Failed to patch Chrome language: ${e.message}`);
    }
}

async function getOrOpenFacebookContext(userId, accountName, accountType, platform = 'FB', { headless = true, existingSessionDir = '' } = {}) {
    if (!userId) throw new Error('Missing user id');
    if (!accountName || !String(accountName).trim()) {
        throw new Error('Vui lòng nhập tên tài khoản Facebook');
    }

    ensureDir(SESSION_ROOT);
    // Ưu tiên dùng session dir đã có (từ channel storageStatePath) để tránh mismatch khi accountName đổi
    const existingDirValid = existingSessionDir && fs.existsSync(existingSessionDir);
    const fallbackDir = buildFacebookAccountFolder(userId, accountName, platform);
    const userSessionDir = existingDirValid ? existingSessionDir : fallbackDir;
    
    console.log(`[Facebook Context] Session resolution: existingSessionDir=${existingSessionDir || '(empty)'}`);
    console.log(`[Facebook Context] Session resolution: existingDirValid=${existingDirValid}, fallbackDir=${fallbackDir}`);
    console.log(`[Facebook Context] Session resolution: using=${userSessionDir}`);
    
    ensureDir(userSessionDir);

    const folderName = path.basename(userSessionDir);
    const sessionKey = `${userId}:${folderName}`;

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

    if (existingSession) {
        ACTIVE_FB_SESSIONS.delete(sessionKey);
    }

    // Clean up stale lock files
    try {
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'Singleton'];
        for (const lockFile of lockFiles) {
            const lockPath = path.join(userSessionDir, lockFile);
            if (fs.existsSync(lockPath)) {
                fs.unlinkSync(lockPath);
                console.log(`[Facebook Context] Removed stale lock file: ${lockPath}`);
            }
        }
    } catch (e) { /* silent */ }

    // Kill any Chrome process using this user-data-dir
    try {
        const { execSync } = require('child_process');
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
        } catch (wmicErr) { /* wmic may not be available */ }
        await new Promise(r => setTimeout(r, 1000));
    } catch (e) { /* Non-critical */ }

    // Kiểm tra Chrome profile có Cookies file không
    const cookiesFile = path.join(userSessionDir, 'Default', 'Cookies');
    const ssPath = path.join(userSessionDir, 'storage-state.json');
    const hasCookiesFile = fs.existsSync(cookiesFile);
    const hasStorageState = fs.existsSync(ssPath);

    // Patch Chrome Preferences → force ngôn ngữ vi-VN
    patchChromeLanguage(userSessionDir);

    let context;
    let reusedSession = false;

    if (!hasCookiesFile && hasStorageState) {
        // Chrome profile bị corrupt (thiếu Cookies file) → dùng non-persistent + storageState
        // launchPersistentContext + addCookies không hoạt động vì Chrome tự quản lý cookie store
        console.log(`[Facebook Context] Chrome profile missing Cookies file! Using storageState fallback for: ${sessionKey}`);
        const browser = await chromium.launch({
            headless: headless,
            channel: 'chrome',
            args: [
                '--lang=vi-VN',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=AutomationControlled',
                '--disable-webrtc-multiple-routes',
                '--disable-webrtc-hw-encoding',
                '--disable-webrtc-hw-decoding',
                '--disable-webrtc',
                '--enforce-webrtc-ip-permission-check'
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });
        context = await browser.newContext({
            storageState: ssPath,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            viewport: null,
            timezoneId: 'Asia/Ho_Chi_Minh',
            locale: 'vi-VN',
            extraHTTPHeaders: { 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' },
        });
        let ssCookieCount = 0;
        try { ssCookieCount = JSON.parse(fs.readFileSync(ssPath, 'utf8')).cookies?.length || 0; } catch (e) {}
        console.log(`[Facebook Context] Created non-persistent context with storageState (${ssCookieCount} cookies loaded)`);
    } else {
        // Chrome profile bình thường → dùng launchPersistentContext
        console.log(`[Facebook Context] Launching persistent context for: ${sessionKey}`);
        context = await chromium.launchPersistentContext(userSessionDir, {
            headless: headless,
            channel: 'chrome',
            viewport: null,
            args: [
                '--lang=vi-VN',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=AutomationControlled',
                '--disable-webrtc-multiple-routes',
                '--disable-webrtc-hw-encoding',
                '--disable-webrtc-hw-decoding',
                '--disable-webrtc',
                '--enforce-webrtc-ip-permission-check'
            ],
            ignoreDefaultArgs: ['--enable-automation'],
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
            timezoneId: 'Asia/Ho_Chi_Minh',
            locale: 'vi-VN',
            extraHTTPHeaders: { 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' },
        });
    }

    // Inject anti-detection
    const { getAntiDetectionScript } = require('../humanBehaviorService');
    await context.addInitScript(getAntiDetectionScript());

    // Set Facebook locale cookie → force FB UI language to Vietnamese
    try {
        await context.addCookies([
            { name: 'locale', value: 'vi_VN', domain: '.facebook.com', path: '/' },
            { name: 'lang', value: 'vi', domain: '.facebook.com', path: '/' },
        ]);
    } catch (e) {}

    ACTIVE_FB_SESSIONS.set(sessionKey, {
        context,
        userSessionDir,
        accountName,
        platform,
        headless
    });

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

/**
 * Verify Facebook session is still valid by navigating to facebook.com 
 * and checking if c_user/xs cookies survive server response.
 * Returns { valid: boolean, reason: string }
 */
async function verifyFacebookSession(context, { timeout = 15000 } = {}) {
    const page = context.pages()[0] || await context.newPage();
    let sessionInvalidated = false;
    let invalidationReason = '';

    // Listen for Set-Cookie headers that delete c_user/xs
    const responseHandler = async (response) => {
        try {
            const url = response.url();
            if (!url.includes('facebook.com') || url.includes('static')) return;
            const headers = await response.allHeaders();
            const setCookie = headers['set-cookie'];
            if (setCookie) {
                if (setCookie.includes('c_user=deleted') || setCookie.includes('c_user=;')) {
                    sessionInvalidated = true;
                    invalidationReason = 'Facebook server deleted c_user cookie (session invalidated server-side)';
                    console.log(`[Session Verify] ${invalidationReason}`);
                }
                if (setCookie.includes('xs=deleted') || setCookie.includes('xs=;')) {
                    sessionInvalidated = true;
                    invalidationReason = 'Facebook server deleted xs cookie (session invalidated server-side)';
                    console.log(`[Session Verify] ${invalidationReason}`);
                }
            }
        } catch (e) { /* headers may not be accessible */ }
    };
    page.on('response', responseHandler);

    try {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout });
        await page.waitForTimeout(3000);

        // Double-check cookies
        const cookies = await context.cookies('https://www.facebook.com');
        const cu = cookies.find(c => c.name === 'c_user');
        const xs = cookies.find(c => c.name === 'xs');

        if (!cu || !xs) {
            sessionInvalidated = true;
            if (!invalidationReason) {
                invalidationReason = !cu && !xs ? 'c_user and xs cookies missing after navigation' :
                    !cu ? 'c_user cookie missing after navigation' : 'xs cookie missing after navigation';
            }
        }

        if (sessionInvalidated) {
            console.log(`[Session Verify] Session INVALID for account: ${invalidationReason}`);
            console.log(`[Session Verify] User needs to re-login to Facebook to create a new session.`);
        } else {
            console.log(`[Session Verify] Session VALID - c_user=${cu.value.substring(0, 10)}... xs=YES`);
        }

        return { valid: !sessionInvalidated, reason: invalidationReason };
    } catch (e) {
        return { valid: false, reason: `Navigation error: ${e.message}` };
    } finally {
        page.removeListener('response', responseHandler);
    }
}

async function openFacebookLoginWindow(userId, accountName, accountType = 'Cá nhân', platform = 'FB') {
    const folderName = path.basename(buildFacebookAccountFolder(userId, accountName));
    const sessionKey = `${userId}:${folderName}`;
    
    if (ACTIVE_FB_SESSIONS.has(sessionKey)) {
        console.log("Session đã mở rồi, không khởi tạo lại.");
        const { context } = ACTIVE_FB_SESSIONS.get(sessionKey);
        const page = context.pages()[0];
        if (page) await page.bringToFront();
        return { success: true, message: "Trình duyệt đang mở sẵn." };
    }

    const { context } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: false });

    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront();
    
    if (!page.url().includes('facebook.com')) {
        await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
    }

    return { success: true, message: "Đã mở trình duyệt lần đầu." };
}

module.exports = {
    SESSION_ROOT,
    ACTIVE_FB_SESSIONS,
    PROFILE_URL_WATCHERS,
    GROUP_SCAN_JOBS,
    ensureDir,
    sanitizeFolderName,
    buildFacebookAccountFolder,
    getOrOpenFacebookContext,
    openFacebookLoginWindow
};