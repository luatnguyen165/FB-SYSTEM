const path = require('path');
const fs = require('fs');
const { getOrOpenFacebookContext } = require('./services/facebook/session');

const userId = '6a0fd44f96ab8884de405bc2';
const accountName = 'PANZI';
const accountType = 'Cá nhân';
const existingSessionDir = path.join(__dirname, 'social-sessions', userId, 'fb_1781766572698-FB');
const imgPath = path.join(__dirname, 'uploads', 'images', 'test-fanpage-post.jpg');
const screenshotDir = path.join(__dirname, 'debug-fb-fanpage');

if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

async function dumpDialogDOM(page, label) {
    try {
        const info = await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
            const results = [];
            for (const dialog of dialogs) {
                if (!dialog.offsetParent) continue;
                const buttons = [...dialog.querySelectorAll('div[role="button"], button')].map(b => ({
                    tag: b.tagName,
                    text: b.textContent?.trim().substring(0, 80),
                    role: b.getAttribute('role'),
                    tabindex: b.getAttribute('tabindex'),
                    'aria-label': b.getAttribute('aria-label'),
                    rect: (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
                }));
                const spans = [...dialog.querySelectorAll('span')].map(s => ({
                    text: s.textContent?.trim().substring(0, 80),
                    rect: (() => { const r = s.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })(),
                }));
                const headings = [...dialog.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].map(h => h.textContent?.trim().substring(0, 80));
                results.push({ headings, buttons, spans });
            }
            return results;
        });
        fs.writeFileSync(path.join(screenshotDir, `${label}-dom.json`), JSON.stringify(info, null, 2));
        console.log(`[DEBUG] ${label}: ${info.length} dialog(s)`);
        for (const d of info) {
            console.log(`  headings: ${d.headings.join(' | ')}`);
            console.log(`  buttons: ${d.buttons.map(b => `"${b.text}" (${b.role})`).join(' | ')}`);
            // Find anything with "gốc" or "original"
            const originalBtns = d.buttons.filter(b => (b.text || '').toLowerCase().includes('gốc') || (b.text || '').toLowerCase().includes('original'));
            if (originalBtns.length > 0) {
                console.log(`  *** FOUND "original" button: ${JSON.stringify(originalBtns)}`);
            }
        }
    } catch (e) {
        console.log(`[DEBUG] DOM dump error: ${e.message}`);
    }
}

(async () => {
    console.log('=== Debug: Fanpage Post "Đăng bài viết gốc" ===');

    const { context } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: false, existingSessionDir });
    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront().catch(() => {});

    // Navigate to fanpage
    console.log('\n=== STEP 1: Navigate to fanpage ===');
    await page.goto('https://www.facebook.com/panziofficial', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log('URL:', page.url());
    await page.screenshot({ path: path.join(screenshotDir, '01-fanpage.png'), fullPage: false });

    // Click "Bạn đang nghĩ gì?"
    console.log('\n=== STEP 2: Open post dialog ===');
    const openBoxSelectors = [
        'xpath=//div[@role="button" and @tabindex="0"][.//span[normalize-space(text())="Bạn đang nghĩ gì?"]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "Bạn đang nghĩ gì")]]',
    ];
    let boxOpened = false;
    for (const sel of openBoxSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
            await btn.click();
            boxOpened = true;
            console.log(`Clicked "Bạn đang nghĩ gì?" via: ${sel}`);
            break;
        }
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotDir, '02-dialog-opened.png'), fullPage: false });
    await dumpDialogDOM(page, '02-dialog-opened');

    // Upload image
    console.log('\n=== STEP 3: Upload image ===');
    const fileInput = page.locator('xpath=//div[@role="dialog"]//input[@type="file"]').first();
    if (await fileInput.count() > 0) {
        await fileInput.setInputFiles([imgPath], { timeout: 30000 });
        console.log('Image uploaded');
        await page.waitForTimeout(5000);
    }

    // Type content
    console.log('\n=== STEP 4: Type content ===');
    const textBox = page.locator('xpath=//div[@role="dialog"]//div[@contenteditable="true"]').first();
    if (await textBox.count() > 0) {
        await textBox.click();
        await page.waitForTimeout(500);
        const content = 'Debug test - Đăng bài viết gốc ' + new Date().toLocaleTimeString('vi-VN');
        await textBox.type(content, { delay: 50 });
        console.log('Typed:', content);
        await page.waitForTimeout(2000);
    }

    // Click "Tiếp"
    console.log('\n=== STEP 5: Click Tiếp ===');
    const nextBtn = page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Tiếp"]]').first();
    if (await nextBtn.count() > 0 && await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        console.log('Clicked Tiếp');
        await page.waitForTimeout(3000);
    }
    await page.screenshot({ path: path.join(screenshotDir, '05-after-tiep.png'), fullPage: false });
    await dumpDialogDOM(page, '05-after-tiep');

    // Click "Đăng"
    console.log('\n=== STEP 6: Click Đăng ===');
    const postBtn = page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Đăng"]]').first();
    if (await postBtn.count() > 0 && await postBtn.isVisible().catch(() => false)) {
        await postBtn.click();
        console.log('Clicked Đăng');
    }

    // Watch for "Đăng bài viết gốc" — screenshot every 1s for 30s
    console.log('\n=== STEP 7: Watch for "Đăng bài viết gốc" (30s) ===');
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000);

        // Check all dialogs
        const dialogs = await page.locator('div[role="dialog"]').all();
        let foundOriginal = false;
        for (const dialog of dialogs) {
            const isVisible = await dialog.isVisible().catch(() => false);
            if (!isVisible) continue;

            const allText = await dialog.textContent().catch(() => '');
            if (allText.includes('gốc') || allText.includes('original') || allText.includes('Gốc') || allText.includes('Original')) {
                console.log(`\n*** FOUND "gốc/original" in dialog at ${i + 1}s ***`);
                console.log(`Dialog text: ${allText.substring(0, 300)}`);
                foundOriginal = true;

                // Screenshot
                await page.screenshot({ path: path.join(screenshotDir, `07-original-found-${i}s.png`), fullPage: false });
                await dumpDialogDOM(page, `07-original-found-${i}s`);

                // Try clicking the button
                const originalBtns = [
                    'xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Gốc")]]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "original")]]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "bài viết gốc")]]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Original post")]]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][contains(., "gốc")]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Gốc")]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][contains(., "original")]',
                    'xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Original")]',
                ];

                for (const sel of originalBtns) {
                    const btn = page.locator(sel).first();
                    const count = await btn.count().catch(() => 0);
                    const visible = count > 0 ? await btn.isVisible().catch(() => false) : false;
                    if (count > 0 && visible) {
                        const btnText = await btn.textContent().catch(() => '');
                        console.log(`Clicking original button via: ${sel} text="${btnText.trim().substring(0, 60)}"`);
                        await btn.click().catch(() => {});
                        await page.waitForTimeout(3000);
                        console.log('Clicked "Đăng bài viết gốc"!');
                        await page.screenshot({ path: path.join(screenshotDir, '08-after-original-click.png'), fullPage: false });
                        break;
                    }
                }
                break;
            }
        }

        if (foundOriginal) break;

        // Also check: dialog closed = success
        const dialogCount = await page.locator('div[role="dialog"]:visible').count().catch(() => 0);
        if (dialogCount === 0 && i > 5) {
            console.log(`Dialog closed at ${i + 1}s — post likely succeeded`);
            await page.screenshot({ path: path.join(screenshotDir, '07-dialog-closed.png'), fullPage: false });
            break;
        }

        if (i % 5 === 0) console.log(`  Waiting... ${i + 1}s`);
    }

    await page.screenshot({ path: path.join(screenshotDir, '09-final.png'), fullPage: false });
    console.log('\n=== DONE ===');
    console.log('URL:', page.url());

    await context.close().catch(() => {});
})();
