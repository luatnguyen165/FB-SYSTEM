/**
 * Mở Chrome login Facebook thủ công
 * Flow: Mở Chrome → facebook.com/login → User login tay → Auto detect login → Lưu cookies
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const SESSION_DIR = path.join(__dirname, 'social-sessions', '6a0fd44f96ab8884de405bc2', 'fb_1783012655208-FB');

// Patch language
const prefsPath = path.join(SESSION_DIR, 'Default', 'Preferences');
if (fs.existsSync(prefsPath)) {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    if (!prefs.intl) prefs.intl = {};
    prefs.intl.selected_languages = 'vi-VN,vi,en-US,en';
    prefs.intl.accept_languages = 'vi-VN,vi,en-US,en';
    if (!prefs.browser) prefs.browser = {};
    prefs.browser.language = 'vi-VN';
    fs.writeFileSync(prefsPath, JSON.stringify(prefs));
}

async function main() {
    console.log('='.repeat(50));
    console.log('[LOGIN] Mở Chrome để login Facebook');
    console.log('='.repeat(50));
    console.log(`[LOGIN] Session: ${SESSION_DIR}`);
    console.log('');

    const context = await chromium.launchPersistentContext(SESSION_DIR, {
        headless: false,
        channel: 'chrome',
        viewport: null,
        args: ['--lang=vi-VN', '--start-maximized', '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
    });

    const page = context.pages()[0] || await context.newPage();

    // Navigate to Facebook login
    await page.goto('https://www.facebook.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('[LOGIN] Đã mở facebook.com/login');
    console.log('[LOGIN] Hãy login bằng tay trong Chrome...');
    console.log('[LOGIN] Script sẽ tự detect khi login thành công (có c_user cookie)');
    console.log('');

    // Poll for login success (check c_user cookie)
    const MAX_WAIT = 5 * 60 * 1000; // 5 minutes
    const startTime = Date.now();
    let loggedIn = false;

    while (Date.now() - startTime < MAX_WAIT) {
        await page.waitForTimeout(3000);

        // Check if redirected away from login page
        const url = page.url();
        const cookies = await context.cookies('https://www.facebook.com');
        const hasCUser = cookies.some(c => c.name === 'c_user' && c.value);
        const hasXs = cookies.some(c => c.name === 'xs' && c.value);

        if (hasCUser && hasXs) {
            loggedIn = true;
            const cUser = cookies.find(c => c.name === 'c_user').value;
            console.log(`[LOGIN] ✅ Login thành công! c_user=${cUser}`);
            console.log(`[LOGIN] Facebook cookies: ${cookies.length}`);

            // Save storage state
            const ssPath = path.join(SESSION_DIR, 'storage-state.json');
            const storageState = await context.storageState();
            fs.writeFileSync(ssPath, JSON.stringify(storageState, null, 2));
            console.log(`[LOGIN] Đã lưu storage-state: ${ssPath}`);
            console.log(`[LOGIN] Cookies: ${storageState.cookies.length}`);

            break;
        }

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        process.stdout.write(`\r[LOGIN] Đợi login... ${elapsed}s `);
    }

    console.log('');
    if (loggedIn) {
        console.log('[LOGIN] Đợi 5s để save xong...');
        await page.waitForTimeout(5000);
        // Re-save to be sure
        const ssPath = path.join(SESSION_DIR, 'storage-state.json');
        const storageState = await context.storageState();
        fs.writeFileSync(ssPath, JSON.stringify(storageState, null, 2));
        console.log(`[LOGIN] Final save: ${storageState.cookies.length} cookies`);
    } else {
        console.log('[LOGIN] ❌ Timeout 5 phút chưa login');
    }

    await context.close().catch(() => {});
    console.log('[LOGIN] Done');
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
