/**
 * Debug: Test upload ảnh lên Facebook Group
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const { normalizeScheduleImageInputs, isAllowedPostImageFile } = require('./services/common/facebook');
const { findFirstVisibleLocator } = require('./services/facebook/utils');
const { randomWait } = require('./services/humanBehaviorService');

const GROUP_URL = 'https://www.facebook.com/groups/3605726626108046';
const TEST_IMAGE = path.resolve('uploads/ai-scan/Cng-ng-Ngi-Yu-Ch-Poodle-Vit-Nam/27317377587871515/27317377587871515.jpg');
const TEST_CONTENT = 'Test upload ảnh + text từ FB-SYSTEM 🐶 #test #poodle';

async function main() {
    console.log('='.repeat(60));
    console.log('[DEBUG] Facebook Group Upload Test');
    console.log('='.repeat(60));

    // Find FB session with valid login cookies (c_user + xs)
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
    let sessionDir = '';
    let accountName = '';

    // Prioritize sessions with c_user + xs cookies (most cookies first)
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
    // Sort by cookie count (most first)
    candidates.sort((a, b) => b.count - a.count);

    if (!sessionDir) {
        // Use first candidate
        sessionDir = candidates[0].dir;
        accountName = candidates[0].name;
    }

    // Override: use the specific account with c_user=61591442646663
    const targetSession = candidates.find(c => c.cUser === '61591442646663');
    if (targetSession) {
        sessionDir = targetSession.dir;
        accountName = targetSession.name;
    }

    // Try first 3 candidates
    console.log(`[DEBUG] Found ${candidates.length} logged-in sessions:`);
    candidates.slice(0, 5).forEach(c => console.log(`  ${c.name}: ${c.count} cookies`));
    if (!sessionDir) { console.error('No FB session'); process.exit(1); }
    console.log(`[DEBUG] Session: ${accountName} → ${sessionDir}`);

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

    // Resolve image
    if (!fs.existsSync(TEST_IMAGE)) {
        console.error(`[ERROR] Image not found: ${TEST_IMAGE}`);
        process.exit(1);
    }
    console.log(`[DEBUG] Image: ${TEST_IMAGE} (${(fs.statSync(TEST_IMAGE).size / 1024).toFixed(1)} KB)`);

    // Launch Chrome
    console.log('\n--- STEP 1: Launch Chrome (headless: false) ---');
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

    // Force set Facebook locale cookie + extra headers
    await context.addCookies([
        { name: 'locale', value: 'vi_VN', domain: '.facebook.com', path: '/' },
        { name: 'lang', value: 'vi', domain: '.facebook.com', path: '/' },
    ]);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    console.log('[DEBUG] Chrome launched + Accept-Language: vi-VN set');

    try {
        // Navigate to group
        console.log('\n--- STEP 2: Navigate to group ---');
        await page.goto(GROUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);
        console.log(`[DEBUG] URL: ${page.url()}`);
        console.log(`[DEBUG] Title: ${await page.title()}`);

        // Find post box
        console.log('\n--- STEP 3: Find post box opener (EN+VI) ---');
        const openBoxSelectors = [
            // Vietnamese
            'xpath=//span[contains(text(), "Bạn viết gì đi...")]/ancestor::div[@role="button"]',
            'xpath=//span[contains(text(), "viết gì")]/ancestor::div[@role="button"]',
            'xpath=//div[@role="button"]//span[contains(text(),"viết")]',
            '[role="button"]:has-text("viết gì")',
            '[role="button"]:has-text("Bạn viết")',
            // English
            'xpath=//span[contains(text(), "Write something")]/ancestor::div[@role="button"]',
            'xpath=//div[@role="button"]//span[contains(text(),"Write")]',
            '[role="button"]:has-text("Write something")',
            // Broader
            'xpath=//div[@role="button"][.//span[contains(@class,"notranslate")]]',
        ];

        let openBoxBtn = null;
        for (const sel of openBoxSelectors) {
            const c = page.locator(sel).first();
            const cnt = await c.count().catch(() => 0);
            if (cnt > 0) {
                const vis = await c.isVisible().catch(() => false);
                const txt = await c.textContent().catch(() => '');
                console.log(`[DEBUG] "${sel.substring(0, 55)}..." → count=${cnt} vis=${vis} text="${(txt||'').substring(0, 40)}"`);
                if (vis && !openBoxBtn) openBoxBtn = c;
            }
        }

        if (!openBoxBtn) {
            console.log('[ERROR] Post box not found. Dumping page...');
            const body = await page.evaluate(() => document.body?.innerText?.substring(0, 3000)).catch(() => '');
            console.log(body);
            console.log('\n[WAIT] 60s for manual check...');
            await page.waitForTimeout(60000);
            return;
        }

        // Click post box
        console.log('\n--- STEP 4: Click post box ---');
        await openBoxBtn.scrollIntoViewIfNeeded().catch(() => {});
        await randomWait(500, 800);
        await openBoxBtn.click({ force: true });
        console.log('[DEBUG] Clicked post box');

        // Wait longer for dialog to fully render
        console.log('[DEBUG] Waiting 5s for dialog to render...');
        await page.waitForTimeout(5000);

        // Check dialog
        console.log('\n--- STEP 5: Check dialog ---');
        const dialogVisible = await page.locator('div[role="dialog"]').first().isVisible().catch(() => false);
        console.log(`[DEBUG] Dialog visible: ${dialogVisible}`);

        // Dump FULL dialog HTML to understand structure
        const dialogHTML = await page.evaluate(() => {
            const d = document.querySelector('div[role="dialog"]');
            if (!d) return 'NO DIALOG';
            return d.innerHTML.substring(0, 5000);
        }).catch(() => 'ERROR');
        console.log(`[DEBUG] Dialog HTML (first 3000 chars):\n${dialogHTML.substring(0, 3000)}`);

        // Dump all elements in dialog
        const dialogDump = await page.evaluate(() => {
            const d = document.querySelector('div[role="dialog"]');
            if (!d) return { exists: false };
            const all = d.querySelectorAll('*');
            const fileInputs = d.querySelectorAll('input[type="file"]');
            const btns = d.querySelectorAll('[role="button"], button');
            const editables = d.querySelectorAll('[contenteditable="true"]');
            return {
                exists: true,
                totalElements: all.length,
                fileInputs: fileInputs.length,
                fileInputDetails: Array.from(fileInputs).map(fi => ({
                    accept: fi.getAttribute('accept'),
                    name: fi.getAttribute('name'),
                    id: fi.id,
                    multiple: fi.hasAttribute('multiple'),
                    hidden: fi.hidden || fi.style.display === 'none',
                })),
                buttons: Array.from(btns).map(b => ({
                    text: (b.textContent || '').trim().substring(0, 50),
                    visible: b.offsetParent !== null,
                })),
                editables: editables.length,
                spans: d.querySelectorAll('span').length,
                imgs: d.querySelectorAll('img').length,
            };
        }).catch(() => ({ exists: false, error: true }));

        console.log(`[DEBUG] Dialog exists: ${dialogDump.exists}`);
        if (dialogDump.exists) {
            console.log(`[DEBUG] Total elements: ${dialogDump.totalElements}`);
            console.log(`[DEBUG] Spans: ${dialogDump.spans}, Imgs: ${dialogDump.imgs}`);
            console.log(`[DEBUG] File inputs: ${dialogDump.fileInputs}`);
            dialogDump.fileInputDetails.forEach((fi, i) => {
                console.log(`  input[${i}]: accept="${fi.accept}" name="${fi.name}" multiple=${fi.multiple} hidden=${fi.hidden}`);
            });
            console.log(`[DEBUG] Buttons:`);
            dialogDump.buttons.forEach((b, i) => {
                console.log(`  btn[${i}]: "${b.text}" visible=${b.visible}`);
            });
            console.log(`[DEBUG] Contenteditable: ${dialogDump.editables}`);
        }

        // Dump ALL file inputs on page
        console.log('\n--- STEP 5b: All file inputs on page ---');
        const allFileInputs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('input[type="file"]')).map((fi, i) => ({
                index: i,
                accept: fi.getAttribute('accept'),
                name: fi.getAttribute('name'),
                id: fi.id,
                multiple: fi.hasAttribute('multiple'),
                inDialog: !!fi.closest('div[role="dialog"]'),
                visible: fi.offsetParent !== null,
                parentTag: fi.parentElement?.tagName,
                parentClass: (fi.parentElement?.className || '').substring(0, 60),
            }));
        }).catch(() => []);
        console.log(`[DEBUG] Total file inputs on page: ${allFileInputs.length}`);
        allFileInputs.forEach(fi => {
            console.log(`  [${fi.index}] inDialog=${fi.inDialog} accept="${fi.accept}" name="${fi.name}" visible=${fi.visible} parent=${fi.parentTag}.${fi.parentClass}`);
        });

        // STEP 6: Wait for contenteditable to appear (dialog fully loaded)
        console.log('\n--- STEP 6: Wait for dialog to fully load ---');
        try {
            await page.waitForSelector('div[role="dialog"] [contenteditable="true"]', { timeout: 10000 });
            console.log('[DEBUG] ✅ Contenteditable found in dialog');
        } catch (e) {
            console.log('[DEBUG] ❌ No contenteditable in dialog after 10s');
            // Try clicking "Viết" / "Photo" button inside dialog to trigger compose
            const triggerBtns = [
                'div[role="dialog"] [role="button"]:has-text("Viết")',
                'div[role="dialog"] [role="button"]:has-text("Photo")',
                'div[role="dialog"] [role="button"]:has-text("Ảnh")',
            ];
            for (const sel of triggerBtns) {
                const btn = page.locator(sel).first();
                const cnt = await btn.count().catch(() => 0);
                if (cnt > 0) {
                    const vis = await btn.isVisible().catch(() => false);
                    console.log(`[DEBUG] Found trigger btn "${sel.substring(0, 40)}..." vis=${vis}`);
                    if (vis) {
                        await btn.click({ force: true });
                        await page.waitForTimeout(3000);
                        break;
                    }
                }
            }
        }

        // Re-check dialog state after waiting
        const dialogState2 = await page.evaluate(() => {
            const d = document.querySelector('div[role="dialog"]');
            if (!d) return { exists: false };
            return {
                exists: true,
                elements: d.querySelectorAll('*').length,
                fileInputs: d.querySelectorAll('input[type="file"]').length,
                editables: d.querySelectorAll('[contenteditable="true"]').length,
                buttons: Array.from(d.querySelectorAll('[role="button"], button')).map(b => ({
                    text: (b.textContent || '').trim().substring(0, 50),
                    visible: b.offsetParent !== null,
                })).filter(b => b.text),
            };
        }).catch(() => ({ exists: false }));
        console.log(`[DEBUG] Dialog after wait: elements=${dialogState2.elements} fileInputs=${dialogState2.fileInputs} editables=${dialogState2.editables}`);
        if (dialogState2.buttons) {
            dialogState2.buttons.forEach((b, i) => console.log(`  btn[${i}]: "${b.text}" visible=${b.visible}`));
        }

        // STEP 7: Upload via file input
        console.log('\n--- STEP 7: Try upload ---');
        let uploaded = false;

        // Strategy 1: dialog file inputs
        const dfiCount = await page.locator('div[role="dialog"] input[type="file"]').count().catch(() => 0);
        console.log(`[DEBUG] Dialog file inputs: ${dfiCount}`);
        for (let i = 0; i < dfiCount; i++) {
            const input = page.locator('div[role="dialog"] input[type="file"]').nth(i);
            try {
                await input.waitFor({ state: 'attached', timeout: 10000 });
                await input.setInputFiles(TEST_IMAGE);
                console.log(`[DEBUG] ✅ Uploaded via dialog input[${i}]`);
                uploaded = true;
                break;
            } catch (e) {
                console.log(`[DEBUG] ❌ dialog input[${i}]: ${e.message.substring(0, 100)}`);
            }
        }

        // Strategy 2: all page file inputs (try each)
        if (!uploaded) {
            console.log('[DEBUG] Trying all page file inputs...');
            const piCount = await page.locator('input[type="file"]').count().catch(() => 0);
            for (let i = 0; i < piCount; i++) {
                const input = page.locator('input[type="file"]').nth(i);
                const meta = await input.evaluate(el => ({
                    accept: el.getAttribute('accept') || '',
                    inDialog: !!el.closest('div[role="dialog"]'),
                })).catch(() => ({}));
                console.log(`[DEBUG] page input[${i}]: accept="${meta.accept.substring(0, 50)}" inDialog=${meta.inDialog}`);
                if (!/image|video/i.test(meta.accept)) continue;
                try {
                    await input.waitFor({ state: 'attached', timeout: 5000 });
                    await input.setInputFiles(TEST_IMAGE);
                    console.log(`[DEBUG] ✅ Uploaded via page input[${i}]`);
                    uploaded = true;
                    break;
                } catch (e) {
                    console.log(`[DEBUG] ❌ page input[${i}]: ${e.message.substring(0, 80)}`);
                }
            }
        }

        // Strategy 3: file chooser via upload button
        if (!uploaded) {
            console.log('[DEBUG] Trying file chooser...');
            const dialog = page.locator('div[role="dialog"]').first();
            const uploadBtnCandidates = [
                '[role="button"]:has-text("Ảnh")',
                '[role="button"]:has-text("Photo")',
                '[role="button"]:has-text("Video")',
                '[role="button"]:has-text("Media")',
            ];
            const uploadBtn = await findFirstVisibleLocator(dialog, uploadBtnCandidates, 'upload')
                || await findFirstVisibleLocator(page, uploadBtnCandidates, 'upload-page');

            if (uploadBtn) {
                try {
                    const [fileChooser] = await Promise.all([
                        page.waitForEvent('filechooser', { timeout: 15000 }),
                        uploadBtn.click({ force: true })
                    ]);
                    await fileChooser.setFiles(TEST_IMAGE);
                    console.log('[DEBUG] ✅ Uploaded via file chooser');
                    uploaded = true;
                } catch (e) {
                    console.log(`[DEBUG] ❌ File chooser: ${e.message.substring(0, 100)}`);
                }
            } else {
                console.log('[DEBUG] ❌ No upload button found');
            }
        }

        // STEP 8: Check preview
        console.log('\n--- STEP 8: Check preview ---');
        await page.waitForTimeout(5000);

        const previewInfo = await page.evaluate(() => {
            const d = document.querySelector('div[role="dialog"]');
            if (!d) return { noDialog: true };
            const all = d.querySelectorAll('*');
            return {
                totalElements: all.length,
                imgs: d.querySelectorAll('img').length,
                videos: d.querySelectorAll('video').length,
                removeBtns: d.querySelectorAll('[aria-label*="xóa" i], [aria-label*="remove" i], [aria-label*="Gỡ" i]').length,
                fileInputs: d.querySelectorAll('input[type="file"]').length,
                editables: d.querySelectorAll('[contenteditable="true"]').length,
                buttons: Array.from(d.querySelectorAll('[role="button"], button')).map(b => ({
                    text: (b.textContent || '').trim().substring(0, 40),
                    visible: b.offsetParent !== null,
                })).filter(b => b.text),
                // Dump first 2000 chars of dialog text
                text: d.innerText?.substring(0, 500) || '',
            };
        }).catch(() => ({ error: true }));

        console.log(`[DEBUG] Dialog state after upload:`);
        console.log(`  Total elements: ${previewInfo.totalElements}`);
        console.log(`  Imgs: ${previewInfo.imgs}`);
        console.log(`  Videos: ${previewInfo.videos}`);
        console.log(`  Remove buttons: ${previewInfo.removeBtns}`);
        console.log(`  File inputs: ${previewInfo.fileInputs}`);
        console.log(`  Editables: ${previewInfo.editables}`);
        console.log(`  Dialog text: "${(previewInfo.text || '').substring(0, 200)}"`);
        if (previewInfo.buttons) {
            previewInfo.buttons.forEach((b, i) => console.log(`  btn[${i}]: "${b.text}" visible=${b.visible}`));
        }

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log(`[RESULT] Uploaded: ${uploaded}`);
        console.log('='.repeat(60));

        // STEP 9: Type content into contenteditable
        console.log('\n--- STEP 9: Type content ---');
        const textBox = page.locator('div[role="dialog"] [contenteditable="true"]').first();
        const tbCount = await textBox.count().catch(() => 0);
        console.log(`[DEBUG] Contenteditable in dialog: ${tbCount}`);

        if (tbCount > 0) {
            try {
                await textBox.scrollIntoViewIfNeeded().catch(() => {});
                await textBox.click({ force: true });
                await page.waitForTimeout(500);
                await textBox.fill(TEST_CONTENT);
                console.log(`[DEBUG] ✅ Content typed: "${TEST_CONTENT}"`);
            } catch (e) {
                console.log(`[DEBUG] ❌ fill() failed: ${e.message.substring(0, 80)}`);
                try {
                    await textBox.focus();
                    await page.keyboard.type(TEST_CONTENT, { delay: 50 });
                    console.log(`[DEBUG] ✅ Content typed via keyboard`);
                } catch (e2) {
                    console.log(`[DEBUG] ❌ keyboard type failed: ${e2.message.substring(0, 80)}`);
                }
            }
        }

        await page.waitForTimeout(2000);

        // STEP 10: Click Post button
        console.log('\n--- STEP 10: Click Post button ---');

        // Strategy 1: Focus contenteditable first, then Ctrl+Enter
        console.log('[DEBUG] Strategy 1: Focus contenteditable + Ctrl+Enter');
        try {
            const editable = page.locator('div[role="dialog"] [contenteditable="true"]').first();
            if (await editable.count() > 0) {
                await editable.click({ force: true, timeout: 3000 }).catch(() => {});
                await page.waitForTimeout(300);
            }
        } catch (e) {}
        await page.keyboard.press('Control+Enter');
        console.log('[DEBUG] ✅ Ctrl+Enter sent (after focus)');
        await page.waitForTimeout(3000);

        // Check if dialog closed
        let dialogGone = !(await page.locator('div[role="dialog"]').first().isVisible().catch(() => true));
        console.log(`[DEBUG] Dialog after Ctrl+Enter: ${dialogGone ? 'CLOSED ✅' : 'still open'}`);

        if (!dialogGone) {
            // Strategy 2: JS dispatch mousedown/mouseup/click on Post button
            console.log('[DEBUG] Strategy 2: JS mouse event dispatch on Post button');
            const clickResult = await page.evaluate(() => {
                const d = document.querySelector('div[role="dialog"]');
                if (!d) return 'no dialog';
                // Find Post button by aria-label
                const btn = d.querySelector('div[aria-label="Post"][role="button"]') || 
                            d.querySelector('div[aria-label="Đăng"][role="button"]');
                if (!btn) return 'no button found';
                
                // Get button rect
                const rect = btn.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                
                // Remove overlay elements that might block clicks
                const overlays = d.querySelectorAll('[data-visualcompletion="ignore"]');
                overlays.forEach(o => { o.style.pointerEvents = 'none'; });
                
                // Dispatch full mouse event sequence
                const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
                for (const type of events) {
                    const evt = new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                        clientX: x,
                        clientY: y,
                        screenX: x,
                        screenY: y,
                        button: 0,
                        buttons: type.includes('down') ? 1 : 0,
                    });
                    btn.dispatchEvent(evt);
                }
                return `clicked at (${Math.round(x)}, ${Math.round(y)})`;
            });
            console.log(`[DEBUG] JS dispatch result: ${clickResult}`);
            await page.waitForTimeout(3000);

            dialogGone = !(await page.locator('div[role="dialog"]').first().isVisible().catch(() => true));
            console.log(`[DEBUG] Dialog after JS dispatch: ${dialogGone ? 'CLOSED ✅' : 'still open'}`);
        }

        if (!dialogGone) {
            // Strategy 3: Click inner span directly
            console.log('[DEBUG] Strategy 3: Click inner span "Post" directly');
            try {
                const spanBtn = page.locator('div[role="dialog"] //span[normalize-space(text())="Post"]').first();
                if (await spanBtn.count() > 0) {
                    await spanBtn.click({ force: true, timeout: 3000 });
                    console.log('[DEBUG] ✅ Inner span clicked');
                    await page.waitForTimeout(3000);
                }
            } catch (e) {
                console.log(`[DEBUG] Span click failed: ${e.message.substring(0, 60)}`);
            }
            dialogGone = !(await page.locator('div[role="dialog"]').first().isVisible().catch(() => true));
            console.log(`[DEBUG] Dialog after span click: ${dialogGone ? 'CLOSED ✅' : 'still open'}`);
        }

        if (!dialogGone) {
            // Strategy 4: Playwright native mouse click on button coordinates
            console.log('[DEBUG] Strategy 4: Playwright mouse.click on button coords');
            try {
                const btnBox = await page.locator('div[role="dialog"] div[aria-label="Post"]').first().boundingBox();
                if (btnBox) {
                    const cx = btnBox.x + btnBox.width / 2;
                    const cy = btnBox.y + btnBox.height / 2;
                    console.log(`[DEBUG] Button at (${Math.round(cx)}, ${Math.round(cy)})`);
                    await page.mouse.move(cx, cy, { steps: 5 });
                    await page.waitForTimeout(200);
                    await page.mouse.down();
                    await page.waitForTimeout(50);
                    await page.mouse.up();
                    console.log('[DEBUG] ✅ Native mouse click done');
                    await page.waitForTimeout(3000);
                }
            } catch (e) {
                console.log(`[DEBUG] Mouse click failed: ${e.message.substring(0, 60)}`);
            }
            dialogGone = !(await page.locator('div[role="dialog"]').first().isVisible().catch(() => true));
            console.log(`[DEBUG] Dialog after mouse click: ${dialogGone ? 'CLOSED ✅' : 'still open'}`);
        }

        // Wait for dialog to close
        console.log('\n--- STEP 11: Wait for post completion ---');

        // Poll for up to 30s
        let postDone = false;
        for (let i = 0; i < 15; i++) {
            await page.waitForTimeout(2000);
            const dialogOpen = await page.locator('div[role="dialog"]').first().isVisible().catch(() => false);
            const url = page.url();

            // Check for "Post original" / "Đăng bài viết gốc" popup
            const originalPostBtns = [
                page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
                page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
                page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Post original")]').first(),
                page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Đăng bài viết gốc")]').first(),
            ];
            for (const btn of originalPostBtns) {
                const cnt = await btn.count().catch(() => 0);
                if (cnt > 0) {
                    const vis = await btn.isVisible().catch(() => false);
                    if (vis) {
                        const txt = await btn.textContent().catch(() => '');
                        console.log(`[DEBUG] Found "Post original" button: "${(txt||'').substring(0, 30)}"`);
                        await btn.click({ force: true }).catch(() => {});
                        await page.waitForTimeout(2000);
                        break;
                    }
                }
            }

            if (!dialogOpen) {
                console.log(`[DEBUG] ✅ Dialog closed after ${(i+1)*2}s`);
                postDone = true;
                break;
            }

            // Check for error messages
            const errorText = await page.evaluate(() => {
                const d = document.querySelector('div[role="dialog"]');
                if (!d) return '';
                return d.innerText?.substring(0, 300) || '';
            }).catch(() => '');
            console.log(`[DEBUG] Poll ${i+1}: dialog still open. Text: "${errorText.substring(0, 150)}"`);
        }

        const finalUrl = page.url();
        console.log(`[DEBUG] URL: ${finalUrl}`);
        console.log('\n' + '='.repeat(60));
        console.log(`[FINAL RESULT] Post success: ${postDone}`);
        console.log('='.repeat(60));

        console.log('\n[WAIT] Browser open for 10s for manual inspection...');
        await page.waitForTimeout(10000);

    } catch (e) {
        console.error(`[ERROR] ${e.message}`);
        console.error(e.stack);
    } finally {
        await context.close().catch(() => {});
    }
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
