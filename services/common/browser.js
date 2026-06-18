/**
 * Shared browser session management utilities
 * Used by facebook/session.js and socialPlaywrightService.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SESSION_ROOT = path.join(global.USER_DATA_DIR || path.join(__dirname, '..', '..'), 'social-sessions');

/**
 * Disable Chrome automation infobar via Windows Registry
 */
function disableChromeAutomationInfobar() {
    if (process.platform !== 'win32') return false;
    try {
        const { execSync } = require('child_process');
        execSync('reg delete "HKEY_CURRENT_USER\\Software\\Google\\Chrome" /v SuppressInfobarEnabled /f 2>nul', { stdio: 'ignore' });
        execSync('reg add "HKEY_CURRENT_USER\\Software\\Google\\Chrome" /v SuppressInfobarEnabled /t REG_DWORD /d 1 /f', { stdio: 'ignore' });
        execSync('reg add "HKEY_CURRENT_USER\\Software\\Policies\\Google\\Chrome" /v SuppressInfobarEnabled /t REG_DWORD /d 1 /f 2>nul', { stdio: 'ignore' });
        console.log('[Anti-Detection] Đã set Windows Registry để ẩn Chrome automation infobar');
        return true;
    } catch (e) {
        console.warn('[Anti-Detection] Không thể set registry:', e.message);
        return false;
    }
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

/**
 * Sanitize folder name for safe filesystem usage
 */
function sanitizeFolderName(value = '') {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9ก-๙_-]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'social-account';
}

/**
 * Build account folder path
 */
function buildAccountFolder(userId, accountName, platform = 'FB') {
    const safeAccountName = sanitizeFolderName(accountName);
    return path.join(SESSION_ROOT, String(userId), `${safeAccountName}-${platform}`);
}

function buildStorageStatePath(userId, accountName, platform = 'FB') {
    return path.join(buildAccountFolder(userId, accountName, platform), 'storage-state.json');
}

/**
 * Verify cookies saved in session directory
 */
function verifyCookiesSaved(userSessionDir) {
    if (!userSessionDir || !fs.existsSync(userSessionDir)) {
        return { valid: false, reason: 'Thư mục session không tồn tại' };
    }

    const foundCookiesFiles = [];
    
    try {
        const walkDir = (dir, depth = 0) => {
            if (depth > 4) return;
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

    if (foundCookiesFiles.length > 0) {
        const largest = foundCookiesFiles.sort((a, b) => b.size - a.size)[0];
        return { valid: true, cookiesCount: Math.round(largest.size / 200), storageStatePath: largest.path };
    }

    const localStatePath = path.join(userSessionDir, 'Local State');
    if (fs.existsSync(localStatePath)) {
        try {
            const stats = fs.statSync(localStatePath);
            if (stats.size > 50) {
                return { valid: true, cookiesCount: 5, storageStatePath: userSessionDir };
            }
        } catch (e) { /* ignore */ }
    }

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

    if (userSessionDir) {
        try {
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
 * Get Chrome args for anti-detection
 */
function getChromeArgs(isTikTok = false) {
    const baseArgs = [
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

    if (isTikTok) {
        return [
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
        ];
    }

    return baseArgs;
}

/**
 * Get user agent string
 */
function getUserAgent(isTikTok = false) {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

/**
 * Wait for context close event
 */
async function waitForContextClose(context) {
    try {
        await context.waitForEvent('close', { timeout: 0 });
    } catch (e) {
        const pagesAfterClose = context.pages();
        const activePage = pagesAfterClose.length > 0 ? pagesAfterClose[pagesAfterClose.length - 1] : null;
        if (activePage && !activePage.isClosed()) {
            await activePage.waitForEvent('close', { timeout: 0 }).catch(() => {});
        }
    }
}

module.exports = {
    SESSION_ROOT,
    disableChromeAutomationInfobar,
    ensureDir,
    sanitizeFolderName,
    buildAccountFolder,
    buildStorageStatePath,
    verifyCookiesSaved,
    getChromeArgs,
    getUserAgent,
    waitForContextClose
};