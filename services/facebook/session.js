// services/facebook/session.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const { SESSION_ROOT, ensureDir, sanitizeFolderName, buildAccountFolder, getChromeArgs, getUserAgent } = require('../common/browser');

const ACTIVE_FB_SESSIONS = new Map();
const PROFILE_URL_WATCHERS = global.__facebookProfileUrlWatchers || (global.__facebookProfileUrlWatchers = new Map());

// Alias for backward compatibility
const buildFacebookAccountFolder = buildAccountFolder;

async function getOrOpenFacebookContext(userId, accountName, accountType, platform = 'FB', { headless = true } = {}) {
    if (!userId) throw new Error('Missing user id');
    if (!accountName || !String(accountName).trim()) {
        throw new Error('Vui lòng nhập tên tài khoản Facebook');
    }

    ensureDir(SESSION_ROOT);
    const userSessionDir = buildFacebookAccountFolder(userId, accountName, platform);
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

    // Launch persistent context with retry
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
            break;
        } catch (launchErr) {
            console.error(`[Facebook Context] Launch attempt ${attempt + 1} failed: ${launchErr.message}`);
            if (attempt < MAX_RETRIES) {
                try {
                    for (const lockFile of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
                        const lockPath = path.join(userSessionDir, lockFile);
                        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
                    }
                } catch (e) { }
                try {
                    require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore', timeout: 5000 });
                    await new Promise(r => setTimeout(r, 2000));
                } catch (e) { }
            } else {
                throw launchErr;
            }
        }
    }

    // Inject anti-detection script
    const { getAntiDetectionScript } = require('../humanBehaviorService');
    context.on('page', async (page) => {
        await page.addInitScript(getAntiDetectionScript());
    });

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
    ensureDir,
    sanitizeFolderName,
    buildFacebookAccountFolder,
    getOrOpenFacebookContext,
    openFacebookLoginWindow
};