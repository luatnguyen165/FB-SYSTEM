const path = require('path');
const fs = require('fs');
const { getOrOpenSocialContext } = require('./services/socialPlaywrightService');

const userId = '6a0fd44f96ab8884de405bc2';
const accountName = 'Janssen Luuk';
const accountType = 'Personal';
const videoPath = path.join(__dirname, 'uploads', 'videos', '1782753067711-602469579.mp4');
const screenshotDir = path.join(__dirname, 'debug-pi-idea');

if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

async function dumpDOM(page, label) {
    try {
        const info = await page.evaluate(() => {
            const inputs = [...document.querySelectorAll('input')].map(i => ({
                type: i.type, name: i.name, id: i.id, placeholder: i.placeholder,
                'aria-label': i.getAttribute('aria-label'), visible: i.offsetParent !== null
            }));
            const buttons = [...document.querySelectorAll('button')].map(b => ({
                text: b.textContent?.trim().substring(0, 60), id: b.id,
                'data-test-id': b.getAttribute('data-test-id'),
                disabled: b.disabled, visible: b.offsetParent !== null
            }));
            const editables = [...document.querySelectorAll('[contenteditable="true"]')].map(e => ({
                tag: e.tagName, id: e.id, 'aria-label': e.getAttribute('aria-label'),
                text: e.textContent?.substring(0, 50), visible: e.offsetParent !== null
            }));
            const links = [...document.querySelectorAll('a[href]')].filter(a =>
                a.textContent?.toLowerCase().includes('idea') ||
                a.textContent?.toLowerCase().includes('ý tưởng') ||
                a.href.includes('idea')
            ).map(a => ({ text: a.textContent?.trim().substring(0, 60), href: a.href.substring(0, 100) }));
            const fileInputs = [...document.querySelectorAll('input[type="file"]')].map(i => ({
                accept: i.accept, id: i.id, name: i.name
            }));
            return { inputs, buttons, editables, links, fileInputs, url: location.href, bodyText: document.body?.innerText?.substring(0, 500) };
        });
        fs.writeFileSync(path.join(screenshotDir, `${label}-dom.json`), JSON.stringify(info, null, 2));
        console.log(`[DEBUG] ${label} DOM: ${info.inputs.length} inputs, ${info.buttons.length} buttons, ${info.editables.length} editables, ${info.links.length} idea links, ${info.fileInputs.length} fileInputs`);
        if (info.links.length > 0) console.log(`[DEBUG] ${label} Idea links:`, JSON.stringify(info.links));
        if (info.fileInputs.length > 0) console.log(`[DEBUG] ${label} File inputs:`, JSON.stringify(info.fileInputs));
    } catch (e) {
        console.log(`[DEBUG] ${label} DOM dump error: ${e.message}`);
    }
}

(async () => {
    console.log('=== Pinterest Idea Pin Debug ===');
    const ssPath = path.join(__dirname, 'social-sessions', userId, 'pi_1781873552284-PI');
    console.log('Session dir exists:', fs.existsSync(ssPath));

    const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'PI', { headless: false, existingSessionDir: ssPath });
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.bringToFront().catch(() => {});

    // Step 1: Go to pinterest.com
    console.log('\n=== STEP 1: pinterest.com ===');
    await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    console.log('URL:', page.url());
    await page.screenshot({ path: path.join(screenshotDir, '01-homepage.png'), fullPage: false });
    await dumpDOM(page, '01-homepage');

    // Step 2: Find create button
    console.log('\n=== STEP 2: Find create button ===');
    const createBtnSelectors = [
        'button[data-test-id="create-tab"]',
        'div.dVx3J_.Q3hcOU.mm_g7v',
        '[data-test-id="create-button"]',
        'a[href*="/pin-builder/"]',
        'button[aria-label*="Create" i]',
        'button[aria-label*="Tạo" i]',
    ];
    for (const sel of createBtnSelectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        console.log(`  ${sel}: ${count}`);
    }

    // Click create button
    let createBtnClicked = false;
    for (const sel of createBtnSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
            await btn.click();
            createBtnClicked = true;
            console.log(`Clicked create via: ${sel}`);
            break;
        }
    }
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(screenshotDir, '02-create-menu.png'), fullPage: false });
    await dumpDOM(page, '02-create-menu');

    // Step 3: Find Idea Pin menu item
    console.log('\n=== STEP 3: Find Idea Pin in menu ===');
    const ideaSelectors = [
        '[role="menuitem"]',
        '#VerticalNav-CreationOptions-Flyout [id*="Idea" i]',
        '[data-test-id="create-idea-pin"]',
        'a[href*="idea-pin"]',
        'a[href*="idea_pin"]',
        'span:has-text("Idea")',
        'div:has-text("Idea Pin")',
    ];
    for (const sel of ideaSelectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
            const items = await page.locator(sel).allTextContents().catch(() => []);
            console.log(`  ${sel}: ${count} items = ${items.map(t => t.trim().substring(0, 40)).join(' | ')}`);
        }
    }

    // Try clicking Idea Pin
    let ideaClicked = false;
    const allMenuItems = await page.locator('[role="menuitem"]').all();
    console.log(`Found ${allMenuItems.length} menu items`);
    for (const item of allMenuItems) {
        const text = await item.textContent().catch(() => '');
        console.log(`  Menu item: "${text.trim().substring(0, 50)}"`);
        if (text.toLowerCase().includes('idea') || text.toLowerCase().includes('ý tưởng')) {
            await item.click();
            ideaClicked = true;
            console.log(`Clicked Idea Pin menu item: "${text.trim()}"`);
            break;
        }
    }
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(screenshotDir, '03-idea-pin-page.png'), fullPage: false });
    await dumpDOM(page, '03-idea-pin-page');
    console.log('URL after idea pin click:', page.url());

    // Step 4: Check if we're on idea pin builder
    console.log('\n=== STEP 4: Check current page ===');
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);

    // If not on idea pin builder, try direct URLs
    if (!currentUrl.includes('idea') && !currentUrl.includes('pin-creation')) {
        console.log('Not on idea pin page, trying direct URLs...');
        const tryUrls = [
            'https://www.pinterest.com/idea-pin-builder/',
            'https://www.pinterest.com/pin-creation-tool/',
        ];
        for (const url of tryUrls) {
            console.log(`Trying: ${url}`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(3000);
            console.log('URL:', page.url());
            await page.screenshot({ path: path.join(screenshotDir, `04-tried-${tryUrls.indexOf(url)}.png`), fullPage: false });
            await dumpDOM(page, `04-tried-${tryUrls.indexOf(url)}`);
            if (page.url().includes('idea') || page.url().includes('pin-creation')) break;
        }
    }

    // Step 5: Find file input and upload
    console.log('\n=== STEP 5: Find file input ===');
    let activePage = page;
    // Check all pages for file input
    for (const p of context.pages()) {
        const fileCount = await p.locator('input[type="file"]').count().catch(() => 0);
        if (fileCount > 0) {
            activePage = p;
            console.log(`Found file input on: ${p.url().substring(0, 80)}`);
            break;
        }
    }

    const fileInputs = await activePage.locator('input[type="file"]').count().catch(() => 0);
    console.log(`File inputs on activePage: ${fileInputs}`);

    if (fileInputs > 0) {
        console.log('Uploading video...');
        await activePage.locator('input[type="file"]').first().setInputFiles([videoPath], { timeout: 30000 });
        console.log('Video uploaded, waiting 15s for processing...');
        await activePage.waitForTimeout(15000);
        await activePage.screenshot({ path: path.join(screenshotDir, '05-after-upload.png'), fullPage: false });
        await dumpDOM(activePage, '05-after-upload');

        // Check for "Tiếp theo" button
        console.log('\n=== STEP 5b: Check Next button ===');
        const nextSelectors = [
            'button:has-text("Tiếp theo")',
            'button:has-text("Next")',
            'button[aria-label*="Tiếp theo" i]',
            'button[aria-label*="Next" i]',
            'a:has-text("Tiếp theo")',
            'a:has-text("Next")',
        ];
        for (const sel of nextSelectors) {
            const count = await activePage.locator(sel).count().catch(() => 0);
            if (count > 0) {
                const btn = activePage.locator(sel).first();
                const visible = await btn.isVisible().catch(() => false);
                const disabled = await btn.isDisabled().catch(() => false);
                const text = await btn.textContent().catch(() => '');
                console.log(`  ${sel}: count=${count} visible=${visible} disabled=${disabled} text="${text.trim().substring(0, 40)}"`);
            }
        }

        // Wait for button to become enabled
        console.log('Waiting for Next button to enable (up to 60s)...');
        for (let i = 0; i < 12; i++) {
            for (const sel of nextSelectors) {
                const btn = activePage.locator(sel).first();
                if (await btn.count() > 0) {
                    const visible = await btn.isVisible().catch(() => false);
                    const disabled = await btn.isDisabled().catch(() => false);
                    if (visible && !disabled) {
                        console.log(`Button "${sel}" is now enabled! Clicking...`);
                        await btn.click();
                        await activePage.waitForTimeout(5000);
                        await activePage.screenshot({ path: path.join(screenshotDir, '06-after-next.png'), fullPage: false });
                        await dumpDOM(activePage, '06-after-next');
                        console.log('URL after Next:', activePage.url());

                        // Now check for board, title, publish
                        console.log('\n=== STEP 6-8: Board/Title/Publish ===');
                        // Dump full page text for analysis
                        const bodyText = await activePage.locator('body').textContent().catch(() => '');
                        fs.writeFileSync(path.join(screenshotDir, '06-body-text.txt'), bodyText);
                        console.log('Body text (first 500):', bodyText.substring(0, 500));

                        // Check for publish button
                        const publishSelectors = [
                            'button:has-text("Publish")',
                            'button:has-text("Đăng")',
                            'button:has-text("Xuất bản")',
                            '[data-test-id="publish-button"]',
                            'button[aria-label*="publish" i]',
                        ];
                        for (const pSel of publishSelectors) {
                            const count = await activePage.locator(pSel).count().catch(() => 0);
                            if (count > 0) {
                                const pBtn = activePage.locator(pSel).first();
                                const visible = await pBtn.isVisible().catch(() => false);
                                const disabled = await pBtn.isDisabled().catch(() => false);
                                console.log(`  Publish ${pSel}: count=${count} visible=${visible} disabled=${disabled}`);
                            }
                        }

                        break;
                    }
                }
            }
            if (i % 3 === 0) console.log(`  Waiting... ${i * 5}s`);
            await activePage.waitForTimeout(5000);
        }
    } else {
        console.log('No file input found!');
        await activePage.screenshot({ path: path.join(screenshotDir, '05-no-file-input.png'), fullPage: false });
    }

    console.log('\n=== DONE ===');
    await context.close().catch(() => {});
})();
