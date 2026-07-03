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

(async () => {
    console.log('=== Debug: Trigger "Đăng bài viết gốc" ===');

    const { context } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: false, existingSessionDir });
    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront().catch(() => {});

    // STEP 1: Go to fanpage and create a shared post
    console.log('\n=== STEP 1: Navigate to fanpage ===');
    await page.goto('https://www.facebook.com/panziofficial/posts/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log('URL:', page.url());

    // STEP 2: Click "Bạn đang nghĩ gì?" to open dialog
    console.log('\n=== STEP 2: Open post dialog ===');
    const openBoxBtn = page.locator('xpath=//div[@role="button" and @tabindex="0"][.//span[normalize-space(text())="Bạn đang nghĩ gì?"]]').first();
    if (await openBoxBtn.count() > 0 && await openBoxBtn.isVisible().catch(() => false)) {
        await openBoxBtn.click();
        console.log('Clicked "Bạn đang nghĩ gì?"');
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotDir, 'orig-02-dialog.png'), fullPage: false });

    // STEP 3: Upload image
    console.log('\n=== STEP 3: Upload image ===');
    const fileInput = page.locator('xpath=//div[@role="dialog"]//input[@type="file"]').first();
    if (await fileInput.count() > 0) {
        await fileInput.setInputFiles([imgPath], { timeout: 30000 });
        console.log('Image uploaded');
        await page.waitForTimeout(5000);
    }

    // STEP 4: Type content that does NOT contain "gốc"
    console.log('\n=== STEP 4: Type content ===');
    const textBox = page.locator('xpath=//div[@role="dialog"]//div[@contenteditable="true"]').first();
    if (await textBox.count() > 0) {
        await textBox.click();
        await page.waitForTimeout(500);
        const content = 'Debug test - Dang bai viet goc ' + new Date().toLocaleTimeString('vi-VN');
        await textBox.type(content, { delay: 50 });
        console.log('Typed:', content);
    }
    await page.waitForTimeout(2000);

    // STEP 5: Click Tiếp
    console.log('\n=== STEP 5: Click Tiếp ===');
    const nextBtn = page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Tiếp"]]').first();
    if (await nextBtn.count() > 0 && await nextBtn.isVisible().catch(() => false)) {
        await nextBtn.click();
        console.log('Clicked Tiếp');
    }
    await page.waitForTimeout(3000);

    // Dump full dialog state before clicking Đăng
    const dialogInfo = await page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
        return dialogs.filter(d => d.offsetParent !== null).map(d => {
            const buttons = [...d.querySelectorAll('div[role="button"], button')].map(b => ({
                text: b.textContent?.trim().substring(0, 80),
                role: b.getAttribute('role'),
                disabled: b.getAttribute('aria-disabled'),
                tabindex: b.getAttribute('tabindex'),
            }));
            const headings = [...d.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')].map(h => h.textContent?.trim().substring(0, 80));
            const spans = [...d.querySelectorAll('span')].map(s => s.textContent?.trim()).filter(t => t && t.length < 80 && t.length > 0);
            return { headings, buttons, spans };
        });
    });
    console.log('\nDialog state before Đăng:', JSON.stringify(dialogInfo, null, 2));

    // STEP 6: Click Đăng
    console.log('\n=== STEP 6: Click Đăng ===');
    const postBtn = page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Đăng"]]').first();
    if (await postBtn.count() > 0 && await postBtn.isVisible().catch(() => false)) {
        await postBtn.click();
        console.log('Clicked Đăng');
    }

    // STEP 7: Watch for "Đăng bài viết gốc" with DOM dump
    console.log('\n=== STEP 7: Watch for "Đăng bài viết gốc" (30s) ===');
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000);

        // Dump all dialogs
        const dialogs = await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
            return dialogs.filter(d => d.offsetParent !== null).map(d => {
                const text = d.textContent?.trim().substring(0, 500) || '';
                const buttons = [...d.querySelectorAll('div[role="button"], button, a[role="button"]')].map(b => ({
                    text: b.textContent?.trim().substring(0, 80),
                    tag: b.tagName,
                    role: b.getAttribute('role'),
                    tabindex: b.getAttribute('tabindex'),
                    disabled: b.getAttribute('aria-disabled'),
                    classes: b.className?.substring(0, 60),
                }));
                const spans = [...d.querySelectorAll('span')].map(s => s.textContent?.trim()).filter(t => t && t.length > 2 && t.length < 60);
                return { text, buttons, spans };
            });
        });

        // Check for "gốc" or "original" in dialog text (but NOT in our post content)
        let foundOriginalBtn = false;
        for (const d of dialogs) {
            // Check buttons only
            for (const btn of d.buttons) {
                const t = (btn.text || '').toLowerCase();
                if (t.includes('gốc') || t.includes('original') || t.includes('post original')) {
                    console.log(`\n*** FOUND ORIGINAL BUTTON at ${i + 1}s: "${btn.text}" role=${btn.role} tabindex=${btn.tabindex} disabled=${btn.disabled} ***`);
                    console.log(`  Tag: ${btn.tag}, Classes: ${btn.classes}`);

                    // Screenshot
                    await page.screenshot({ path: path.join(screenshotDir, `orig-07-found-${i}s.png`), fullPage: false });

                    // Full dialog dump
                    fs.writeFileSync(path.join(screenshotDir, `orig-07-dialog-${i}s.json`), JSON.stringify(d, null, 2));
                    console.log('  Full dialog dump saved');

                    foundOriginalBtn = true;

                    // Click the button
                    // Try multiple selectors
                    const clickSelectors = [
                        `xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "${btn.text}")]]`,
                        `xpath=//div[@role="dialog"]//div[@role="button"][contains(., "${btn.text}")]`,
                        `xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(text(), "gốc")]]`,
                        `xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(text(), "original")]]`,
                    ];
                    for (const sel of clickSelectors) {
                        const locator = page.locator(sel).first();
                        const count = await locator.count().catch(() => 0);
                        const visible = count > 0 ? await locator.isVisible().catch(() => false) : false;
                        console.log(`  Trying selector: ${sel.substring(0, 80)}... count=${count} visible=${visible}`);
                        if (count > 0 && visible) {
                            // Try force click
                            await locator.click({ force: true }).catch(e => {
                                console.log(`  Click failed: ${e.message.substring(0, 100)}`);
                            });
                            await page.waitForTimeout(3000);
                            console.log(`  Clicked!`);
                            await page.screenshot({ path: path.join(screenshotDir, 'orig-08-after-click.png'), fullPage: false });
                            break;
                        }
                    }
                    break;
                }
            }
            if (foundOriginalBtn) break;
        }

        if (foundOriginalBtn) break;

        // Check if dialog closed = success
        const visibleDialogs = dialogs.filter(d => d.text.length > 10);
        if (visibleDialogs.length === 0 && i > 3) {
            console.log(`Dialog closed at ${i + 1}s — post succeeded`);
            await page.screenshot({ path: path.join(screenshotDir, 'orig-07-dialog-closed.png'), fullPage: false });
            break;
        }

        if (i % 5 === 0) console.log(`  Waiting... ${i + 1}s (dialogs: ${dialogs.length})`);
    }

    await page.screenshot({ path: path.join(screenshotDir, 'orig-09-final.png'), fullPage: false });
    console.log('\n=== DONE ===');
    console.log('URL:', page.url());
    await context.close().catch(() => {});
})();
