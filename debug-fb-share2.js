const path = require('path');
const fs = require('fs');
const { getOrOpenFacebookContext } = require('./services/facebook/session');

const userId = '6a0fd44f96ab8884de405bc2';
const accountName = 'PANZI';
const accountType = 'Cá nhân';
const existingSessionDir = path.join(__dirname, 'social-sessions', userId, 'fb_1781766572698-FB');
const screenshotDir = path.join(__dirname, 'debug-fb-fanpage');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

async function dumpAllButtons(page, label) {
    try {
        const info = await page.evaluate(() => {
            const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
            return dialogs.filter(d => d.offsetParent !== null).map(d => ({
                text: d.textContent?.trim().substring(0, 500),
                buttons: [...d.querySelectorAll('div[role="button"], button')].map(b => ({
                    text: b.textContent?.trim().substring(0, 100),
                    tabindex: b.getAttribute('tabindex'),
                    disabled: b.getAttribute('aria-disabled'),
                })),
            }));
        });
        fs.writeFileSync(path.join(screenshotDir, `${label}.json`), JSON.stringify(info, null, 2));
        for (const d of info) {
            const btnTexts = d.buttons.filter(b => b.text.length > 0).map(b => `"${b.text}"`);
            console.log(`  [${label}] Dialog buttons: ${btnTexts.join(' | ')}`);
        }
    } catch (e) {
        console.log(`  [${label}] Error: ${e.message}`);
    }
}

(async () => {
    console.log('=== Debug: Trigger "Đăng bài viết gốc" via group share ===');

    const { context } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: false, existingSessionDir });
    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront().catch(() => {});

    // STEP 1: Go to a shared post (one that was shared from another page)
    console.log('\n=== STEP 1: Go to shared post ===');
    await page.goto('https://www.facebook.com/panziofficial/posts/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Scroll down to find posts
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(screenshotDir, 'share2-01.png'), fullPage: false });

    // STEP 2: Find and click Share button on the first post
    console.log('\n=== STEP 2: Find Share button ===');
    // The share button is usually a div[role="button"] with "Chia sẻ" text
    const shareBtns = await page.locator('span:text-is("Chia sẻ")').all();
    console.log(`Found ${shareBtns.length} "Chia sẻ" spans`);
    for (let i = 0; i < shareBtns.length; i++) {
        const parent = shareBtns[i].locator('xpath=ancestor::div[@role="button"]').first();
        if (await parent.count() > 0 && await parent.isVisible().catch(() => false)) {
            console.log(`Clicking Share button #${i}`);
            await parent.click();
            await page.waitForTimeout(3000);
            break;
        }
    }

    await page.screenshot({ path: path.join(screenshotDir, 'share2-02-after-click.png'), fullPage: false });
    await dumpAllButtons(page, 'share2-02');

    // STEP 3: Look for share options - "Chia sẻ lên Trang", "Chia sẻ lên nhóm", etc.
    console.log('\n=== STEP 3: Share options ===');
    // Dump all visible menu items
    const menuItems = await page.evaluate(() => {
        const items = [...document.querySelectorAll('[role="menuitem"], [role="option"], [role="menu"] [role="button"]')];
        return items.filter(i => i.offsetParent !== null).map(i => ({
            text: i.textContent?.trim().substring(0, 80),
            role: i.getAttribute('role'),
            'data-testid': i.getAttribute('data-testid'),
        }));
    });
    console.log('Menu items:', JSON.stringify(menuItems, null, 2));

    // Look for group share option
    const groupShareBtn = page.locator('[role="menuitem"]:has-text("nhóm"), [role="menuitem"]:has-text("group"), [role="option"]:has-text("nhóm")').first();
    if (await groupShareBtn.count() > 0 && await groupShareBtn.isVisible().catch(() => false)) {
        console.log('Found group share option, clicking...');
        await groupShareBtn.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(screenshotDir, 'share2-03-group.png'), fullPage: false });
        await dumpAllButtons(page, 'share2-03');
    }

    // Try to look for "Chia sẻ lên nhóm" button in the share dialog
    const shareToGroupBtn = page.locator('[role="button"]:has-text("Chia sẻ lên nhóm")').first();
    if (await shareToGroupBtn.count() > 0 && await shareToGroupBtn.isVisible().catch(() => false)) {
        console.log('Found "Chia sẻ lên nhóm", clicking...');
        await shareToGroupBtn.click();
        await page.waitForTimeout(3000);
        await page.screenshot({ path: path.join(screenshotDir, 'share2-04-share-to-group.png'), fullPage: false });
        await dumpAllButtons(page, 'share2-04');
    }

    // If we see a group selector, select first group and click Đăng
    console.log('\n=== STEP 4: Check for group selector + Đăng ===');
    const groupSelector = page.locator('[role="combobox"]:has-text("Chọn nhóm"), [role="listbox"]:has-text("nhóm")').first();
    if (await groupSelector.count() > 0) {
        console.log('Found group selector');
        await groupSelector.click();
        await page.waitForTimeout(2000);
        const firstGroup = page.locator('[role="option"]').first();
        if (await firstGroup.count() > 0) {
            await firstGroup.click();
            await page.waitForTimeout(2000);
        }
    }

    // Now click "Đăng" and watch for "Đăng bài viết gốc"
    const postBtn = page.locator('[role="button"]:has-text("Đăng")').first();
    if (await postBtn.count() > 0 && await postBtn.isVisible().catch(() => false)) {
        console.log('Clicking Đăng...');
        await postBtn.click();

        console.log('\n=== STEP 5: Watch for "Đăng bài viết gốc" (30s) ===');
        for (let i = 0; i < 30; i++) {
            await page.waitForTimeout(1000);

            const dialogs = await page.evaluate(() => {
                const dials = [...document.querySelectorAll('div[role="dialog"]')];
                return dials.filter(d => d.offsetParent !== null).map(d => ({
                    text: d.textContent?.trim().substring(0, 500),
                    buttons: [...d.querySelectorAll('div[role="button"], button')].map(b => ({
                        text: b.textContent?.trim().substring(0, 100),
                        tag: b.tagName,
                        tabindex: b.getAttribute('tabindex'),
                        disabled: b.getAttribute('aria-disabled'),
                    })),
                }));
            });

            let found = false;
            for (const d of dialogs) {
                for (const btn of d.buttons) {
                    const t = (btn.text || '').toLowerCase();
                    if (t.includes('gốc') || t.includes('original')) {
                        console.log(`\n*** FOUND at ${i + 1}s: "${btn.text}" ***`);
                        console.log(`  Dialog text: ${d.text.substring(0, 300)}`);
                        await page.screenshot({ path: path.join(screenshotDir, `share2-05-original-${i}s.png`), fullPage: false });
                        fs.writeFileSync(path.join(screenshotDir, `share2-05-dialog-${i}s.json`), JSON.stringify(d, null, 2));
                        found = true;

                        // Click it
                        const clickSels = [
                            `xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(text(), "${btn.text.trim().substring(0, 20)}")]]`,
                            `xpath=//div[@role="dialog"]//div[@role="button"][contains(., "${btn.text.trim().substring(0, 20)}")]`,
                        ];
                        for (const sel of clickSels) {
                            const loc = page.locator(sel).first();
                            if (await loc.count() > 0 && await loc.isVisible().catch(() => false)) {
                                await loc.click({ force: true }).catch(() => {});
                                await page.waitForTimeout(3000);
                                console.log('  Clicked!');
                                await page.screenshot({ path: path.join(screenshotDir, 'share2-06-after-click.png'), fullPage: false });
                                break;
                            }
                        }
                        break;
                    }
                }
                if (found) break;
            }
            if (found) break;
            if (i % 5 === 0) console.log(`  Waiting... ${i + 1}s`);
        }
    } else {
        console.log('No "Đăng" button found. Current dialogs:');
        await dumpAllButtons(page, 'share2-no-dang');
    }

    console.log('\n=== DONE ===');
    console.log('URL:', page.url());
    await page.screenshot({ path: path.join(screenshotDir, 'share2-final.png'), fullPage: false });
    await context.close().catch(() => {});
})();
