/**
 * Test: Upload ảnh lên nhiều Facebook Group (multi-group post)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const TEST_IMAGE = path.resolve('uploads/ai-scan/Cng-ng-Ngi-Yu-Ch-Poodle-Vit-Nam/27317377587871515/27317377587871515.jpg');

// Groups to test (from crawled data - account is likely member)
const GROUPS = [
    { id: '3605726626108046', name: 'HKTeam' },
    { id: '297966441569360', name: 'CrawledGroup2' },
    { id: '383133088985948', name: 'CrawledGroup3' },
    { id: '411484614557670', name: 'CrawledGroup4' },
    { id: '420307299059111', name: 'CrawledGroup5' },
];

const CONTENT_BASE = 'Test upload đa group từ FB-SYSTEM 🐶';

async function main() {
    console.log('='.repeat(60));
    console.log('[DEBUG] Multi-Group Upload Test');
    console.log(`[DEBUG] Groups: ${GROUPS.length}`);
    console.log('='.repeat(60));

    // Find session
    const SESSION_ROOTS = [
        path.join(__dirname, 'social-sessions'),
        path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'Electron', 'FB-SYSTEM', 'social-sessions'),
    ];
    let SESSION_ROOT = '';
    for (const root of SESSION_ROOTS) {
        if (fs.existsSync(root)) { SESSION_ROOT = root; break; }
    }
    if (!SESSION_ROOT) { console.error('No social-sessions dir found'); process.exit(1); }

    const userIds = fs.readdirSync(SESSION_ROOT).filter(d => fs.statSync(path.join(SESSION_ROOT, d)).isDirectory());
    const candidates = [];
    for (const uid of userIds) {
        const accounts = fs.readdirSync(path.join(SESSION_ROOT, uid)).filter(d => d.endsWith('-FB'));
        for (const acct of accounts) {
            const ssPath = path.join(SESSION_ROOT, uid, acct, 'storage-state.json');
            if (!fs.existsSync(ssPath)) continue;
            try {
                const data = JSON.parse(fs.readFileSync(ssPath, 'utf8'));
                const cookies = data.cookies || [];
                const hasCUser = cookies.some(c => c.name === 'c_user');
                const hasXs = cookies.some(c => c.name === 'xs');
                if (hasCUser && hasXs) {
                    candidates.push({
                        dir: path.join(SESSION_ROOT, uid, acct),
                        name: acct.replace(/-FB$/, ''),
                        count: cookies.length,
                        cUser: cookies.find(c => c.name === 'c_user').value,
                    });
                }
            } catch (e) {}
        }
    }
    candidates.sort((a, b) => b.count - a.count);

    // Prefer the known account
    const targetSession = candidates.find(c => c.cUser === '61591442646663');
    const sessionDir = targetSession ? targetSession.dir : candidates[0]?.dir;
    const accountName = targetSession ? targetSession.name : candidates[0]?.name;

    if (!sessionDir) { console.error('No FB session'); process.exit(1); }
    console.log(`[DEBUG] Session: ${accountName}`);

    // Patch language
    const prefsPath = path.join(sessionDir, 'Default', 'Preferences');
    if (fs.existsSync(prefsPath)) {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (!prefs.intl) prefs.intl = {};
        prefs.intl.selected_languages = 'vi-VN,vi,en-US,en';
        prefs.intl.accept_languages = 'vi-VN,vi,en-US,en';
        if (!prefs.browser) prefs.browser = {};
        prefs.browser.language = 'vi-VN';
        fs.writeFileSync(prefsPath, JSON.stringify(prefs));
    }

    if (!fs.existsSync(TEST_IMAGE)) {
        console.error(`[ERROR] Image not found: ${TEST_IMAGE}`);
        process.exit(1);
    }

    // Launch Chrome (ONE session, reuse for all groups)
    console.log('\n--- STEP 1: Launch Chrome ---');
    const context = await chromium.launchPersistentContext(sessionDir, {
        headless: false,
        channel: 'chrome',
        viewport: null,
        args: ['--lang=vi-VN', '--start-maximized', '--disable-blink-features=AutomationControlled'],
        ignoreDefaultArgs: ['--enable-automation'],
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        extraHTTPHeaders: {
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        },
    });
    const page = context.pages()[0] || await context.newPage();

    await context.addCookies([
        { name: 'locale', value: 'vi_VN', domain: '.facebook.com', path: '/' },
        { name: 'lang', value: 'vi', domain: '.facebook.com', path: '/' },
    ]);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    console.log('[DEBUG] Chrome launched');

    const results = [];

    for (let i = 0; i < GROUPS.length; i++) {
        const group = GROUPS[i];
        const groupUrl = `https://www.facebook.com/groups/${group.id}`;
        const content = `${CONTENT_BASE} #${i + 1}`;

        console.log('\n' + '='.repeat(60));
        console.log(`[GROUP ${i + 1}/${GROUPS.length}] ${group.name} (${group.id})`);
        console.log('='.repeat(60));

        try {
            const success = await postToGroup(page, groupUrl, group.name, content, TEST_IMAGE, i);
            results.push({ group: group.name, id: group.id, success });
        } catch (e) {
            console.log(`[ERROR] Group ${group.name}: ${e.message.substring(0, 100)}`);
            results.push({ group: group.name, id: group.id, success: false, error: e.message.substring(0, 100) });
        }

        // Delay between groups (human behavior)
        if (i < GROUPS.length - 1) {
            const delay = 15000 + Math.floor(Math.random() * 20000);
            console.log(`\n[DELAY] Waiting ${(delay / 1000).toFixed(0)}s before next group...`);
            await page.waitForTimeout(delay);
        }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('[RESULTS SUMMARY]');
    console.log('='.repeat(60));
    for (const r of results) {
        console.log(`  ${r.success ? '✅' : '❌'} ${r.group} (${r.id})${r.error ? ` - ${r.error}` : ''}`);
    }
    console.log(`\nTotal: ${results.filter(r => r.success).length}/${results.length} successful`);

    console.log('\n[WAIT] Browser open for 15s...');
    await page.waitForTimeout(15000);
    await context.close().catch(() => {});
}

async function postToGroup(page, groupUrl, groupName, content, imagePath, index) {
    // Navigate
    console.log(`[STEP] Navigate to ${groupUrl}`);
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Find post box
    console.log('[STEP] Find post box...');
    const openBoxSelectors = [
        'xpath=//span[contains(text(), "Bạn viết gì đi...")]/ancestor::div[@role="button"]',
        'xpath=//span[contains(text(), "Write something")]/ancestor::div[@role="button"]',
        'xpath=//div[@role="button"]//span[contains(text(),"Write")]',
        '[role="button"]:has-text("Write something")',
    ];

    let openBoxBtn = null;
    for (const sel of openBoxSelectors) {
        const c = page.locator(sel).first();
        if (await c.count().catch(() => 0) > 0 && await c.isVisible().catch(() => false)) {
            openBoxBtn = c;
            console.log(`[STEP] Found post box: ${sel.substring(0, 50)}...`);
            break;
        }
    }

    if (!openBoxBtn) {
        // Debug: dump page to understand why
        const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500)).catch(() => '');
        const pageUrl = page.url();
        console.log(`[DEBUG] Page URL: ${pageUrl}`);
        console.log(`[DEBUG] Page text: ${pageText.substring(0, 300)}`);
        throw new Error('Post box not found');
    }

    // Click to open dialog
    await openBoxBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    await openBoxBtn.click({ force: true });
    console.log('[STEP] Clicked post box, waiting for dialog...');
    await page.waitForTimeout(5000);

    // Verify dialog
    const dialogVisible = await page.locator('div[role="dialog"]').first().isVisible().catch(() => false);
    if (!dialogVisible) throw new Error('Dialog not opened');

    // Wait for contenteditable
    try {
        await page.waitForSelector('div[role="dialog"] [contenteditable="true"]', { timeout: 10000 });
    } catch (e) {
        throw new Error('Contenteditable not found in dialog');
    }

    // Upload image
    console.log('[STEP] Upload image...');
    const dfiCount = await page.locator('div[role="dialog"] input[type="file"]').count().catch(() => 0);
    if (dfiCount > 0) {
        await page.locator('div[role="dialog"] input[type="file"]').first().setInputFiles(imagePath);
        console.log('[STEP] ✅ Image uploaded');
        await page.waitForTimeout(3000);
    }

    // Type content
    console.log('[STEP] Type content...');
    const editable = page.locator('div[role="dialog"] [contenteditable="true"]').first();
    if (await editable.count() > 0) {
        await editable.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
        await page.keyboard.type(content, { delay: 30 });
        console.log(`[STEP] ✅ Content typed: "${content.substring(0, 30)}..."`);
        await page.waitForTimeout(2000);
    }

    // Click Post button using mouse.click (trusted events)
    console.log('[STEP] Click Post button...');
    const postSelector = 'div[role="dialog"] div[aria-label="Post"], div[role="dialog"] div[aria-label="Đăng"]';
    const postBtn = page.locator(postSelector).first();
    const postCount = await postBtn.count().catch(() => 0);

    if (postCount === 0) {
        throw new Error('Post button not found');
    }

    await postBtn.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const btnBox = await postBtn.boundingBox().catch(() => null);
    if (btnBox) {
        const cx = btnBox.x + btnBox.width / 2;
        const cy = btnBox.y + btnBox.height / 2;
        await page.mouse.move(cx, cy, { steps: 5 });
        await page.waitForTimeout(200);
        await page.mouse.down();
        await page.waitForTimeout(50);
        await page.mouse.up();
        console.log(`[STEP] ✅ Post button clicked via mouse at (${Math.round(cx)}, ${Math.round(cy)})`);
    } else {
        throw new Error('Post button boundingBox not found');
    }

    // Wait for dialog to close
    console.log('[STEP] Wait for post completion...');
    let postDone = false;
    for (let i = 0; i < 15; i++) {
        await page.waitForTimeout(2000);
        const dialogOpen = await page.locator('div[role="dialog"]').first().isVisible().catch(() => false);

        // Handle "Post original" popup
        const originalPostBtns = [
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
        ];
        for (const btn of originalPostBtns) {
            if (await btn.count().catch(() => 0) > 0 && await btn.isVisible().catch(() => false)) {
                const btnBox2 = await btn.boundingBox().catch(() => null);
                if (btnBox2) {
                    await page.mouse.click(btnBox2.x + btnBox2.width / 2, btnBox2.y + btnBox2.height / 2);
                    console.log('[STEP] ✅ "Post original" clicked');
                    await page.waitForTimeout(2000);
                }
            }
        }

        if (!dialogOpen) {
            console.log(`[STEP] ✅ Dialog closed after ${(i + 1) * 2}s — POST SUCCESS`);
            postDone = true;
            break;
        }
        console.log(`[STEP] Poll ${i + 1}: dialog still open...`);
    }

    return postDone;
}

main().catch(e => {
    console.error('[FATAL]', e);
    process.exit(1);
});
