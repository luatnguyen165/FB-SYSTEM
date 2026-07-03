const path = require('path');
const fs = require('fs');
const { getOrOpenSocialContext } = require('./services/socialPlaywrightService');

const userId = '6a0fd44f96ab8884de405bc2';
const accountName = 'Janssen Luuk';
const accountType = 'Personal';
const videoPath = path.join(__dirname, 'uploads', 'videos', '1782753067711-602469579.mp4');
const screenshotDir = path.join(__dirname, 'debug-pi-idea');
const existingSessionDir = path.join(__dirname, 'social-sessions', userId, 'pi_1781874446649-PI');

if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

(async () => {
    console.log('=== Pinterest Idea Pin Debug v2 ===');

    const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'PI', { headless: false, existingSessionDir });
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    await page.bringToFront().catch(() => {});

    // Step 1: Go to pinterest.com
    console.log('\n=== STEP 1: pinterest.com ===');
    await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    console.log('URL:', page.url());
    await page.screenshot({ path: path.join(screenshotDir, 'v2-01-homepage.png'), fullPage: false });

    // Dump all elements with "create" or "tạo" in their attributes
    const allClickable = await page.evaluate(() => {
        const results = [];
        // All buttons
        document.querySelectorAll('button').forEach((el, i) => {
            results.push({
                tag: 'button', index: i,
                text: el.textContent?.trim().substring(0, 60),
                id: el.id, classes: el.className?.substring(0, 80),
                'data-test-id': el.getAttribute('data-test-id'),
                'aria-label': el.getAttribute('aria-label'),
                rect: el.getBoundingClientRect(),
                disabled: el.disabled,
            });
        });
        // All links
        document.querySelectorAll('a').forEach((el, i) => {
            results.push({
                tag: 'a', index: i,
                text: el.textContent?.trim().substring(0, 60),
                href: el.href?.substring(0, 100),
                id: el.id, classes: el.className?.substring(0, 80),
                'data-test-id': el.getAttribute('data-test-id'),
                rect: el.getBoundingClientRect(),
            });
        });
        // All divs with data-test-id
        document.querySelectorAll('[data-test-id]').forEach((el, i) => {
            results.push({
                tag: el.tagName, index: i,
                'data-test-id': el.getAttribute('data-test-id'),
                text: el.textContent?.trim().substring(0, 60),
                rect: el.getBoundingClientRect(),
            });
        });
        return results;
    });
    // Filter for anything "create" or "tạo"
    const createRelated = allClickable.filter(el =>
        (el.text || '').toLowerCase().includes('creat') ||
        (el.text || '').toLowerCase().includes('tạo') ||
        (el['data-test-id'] || '').includes('create') ||
        (el['aria-label'] || '').toLowerCase().includes('creat') ||
        (el['aria-label'] || '').toLowerCase().includes('tạo') ||
        (el.href || '').includes('create') ||
        (el.href || '').includes('pin-builder')
    );
    console.log('\nCreate-related elements:', JSON.stringify(createRelated, null, 2));

    // Find the "+" button in left sidebar nav
    const sidebarNav = await page.evaluate(() => {
        const nav = document.querySelector('nav') || document.querySelector('[role="navigation"]');
        if (!nav) return 'no nav found';
        const items = [];
        nav.querySelectorAll('*').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                items.push({
                    tag: el.tagName, text: el.textContent?.trim().substring(0, 40),
                    'data-test-id': el.getAttribute('data-test-id'),
                    'aria-label': el.getAttribute('aria-label'),
                    href: el.href?.substring(0, 80),
                    x: Math.round(rect.x), y: Math.round(rect.y),
                    w: Math.round(rect.width), h: Math.round(rect.height),
                });
            }
        });
        return items;
    });
    console.log('\nSidebar nav items:', JSON.stringify(sidebarNav, null, 2));

    // Try clicking the Create button using force
    console.log('\n=== STEP 2: Click Create ===');
    // Method 1: Try data-test-id
    let clicked = false;
    const createSelectors = [
        'button[data-test-id="create-tab"]',
        '[data-test-id="create-button"]',
        '[data-test-id="mweb-create-button"]',
    ];
    for (const sel of createSelectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
            await page.locator(sel).first().click({ force: true });
            clicked = true;
            console.log(`Clicked via: ${sel}`);
            break;
        }
    }

    // Method 2: If not clicked, try the sidebar "+" icon via JavaScript
    if (!clicked) {
        console.log('Trying JS click on sidebar create...');
        const jsClicked = await page.evaluate(() => {
            // Look for sidebar nav items
            const nav = document.querySelector('nav') || document.querySelector('[role="navigation"]');
            if (nav) {
                // Find all clickable items in nav
                const links = nav.querySelectorAll('a, button, div[role="button"]');
                for (const link of links) {
                    const text = link.textContent?.trim().toLowerCase() || '';
                    const ariaLabel = link.getAttribute('aria-label')?.toLowerCase() || '';
                    const testId = link.getAttribute('data-test-id') || '';
                    const href = link.href || '';
                    if (text.includes('tạo') || text.includes('create') || text.includes('+') ||
                        ariaLabel.includes('create') || ariaLabel.includes('tạo') ||
                        testId.includes('create') || href.includes('pin-builder')) {
                        link.click();
                        return { success: true, text: link.textContent?.trim().substring(0, 40), href: href.substring(0, 80) };
                    }
                }
            }
            // Fallback: look for any element with "+" text
            const allElements = document.querySelectorAll('*');
            for (const el of allElements) {
                if (el.children.length === 0 && el.textContent?.trim() === '+') {
                    el.click();
                    return { success: true, text: '+', tag: el.tagName };
                }
            }
            return { success: false };
        });
        console.log('JS click result:', JSON.stringify(jsClicked));
        if (jsClicked.success) clicked = true;
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(screenshotDir, 'v2-02-after-create-click.png'), fullPage: false });

    // Dump what appeared after clicking create
    const afterCreate = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll('[role="menuitem"], [role="menu"] *, [data-test-id*="create"], [data-test-id*="idea"]').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                items.push({
                    tag: el.tagName, text: el.textContent?.trim().substring(0, 60),
                    'data-test-id': el.getAttribute('data-test-id'),
                    'role': el.getAttribute('role'),
                    href: el.href?.substring(0, 100),
                    x: Math.round(rect.x), y: Math.round(rect.y),
                });
            }
        });
        return items;
    });
    console.log('\nAfter create click - menu items:', JSON.stringify(afterCreate, null, 2));

    // Step 3: Find and click "Idea Pin"
    console.log('\n=== STEP 3: Find Idea Pin ===');
    let ideaClicked = false;
    // Try menu items
    const menuItems = await page.locator('[role="menuitem"]').all();
    console.log(`Found ${menuItems.length} menuitem elements`);
    for (const item of menuItems) {
        const text = await item.textContent().catch(() => '');
        console.log(`  menuitem: "${text.trim().substring(0, 50)}"`);
        if (text.toLowerCase().includes('idea') || text.toLowerCase().includes('ý tưởng')) {
            await item.click({ force: true });
            ideaClicked = true;
            console.log(`Clicked: "${text.trim()}"`);
            break;
        }
    }

    // If not found, try JS
    if (!ideaClicked) {
        console.log('Trying JS click on Idea Pin...');
        const jsIdea = await page.evaluate(() => {
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
                const text = el.textContent?.trim() || '';
                if ((text === 'Idea Pin' || text === 'Ý tưởng' || text === 'Tạo Ý tưởng') && el.offsetParent !== null) {
                    el.click();
                    return { success: true, text };
                }
            }
            // Try links
            const links = document.querySelectorAll('a[href*="idea"], a[href*="pin-creation"]');
            if (links.length > 0) {
                links[0].click();
                return { success: true, href: links[0].href };
            }
            return { success: false };
        });
        console.log('JS Idea click:', JSON.stringify(jsIdea));
        if (jsIdea.success) ideaClicked = true;
    }

    // If still not found, try direct URL
    if (!ideaClicked) {
        console.log('Trying direct URL...');
        await page.goto('https://www.pinterest.com/pin-creation-tool/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(3000);
        console.log('URL after direct nav:', page.url());
    }

    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(screenshotDir, 'v2-03-idea-pin-page.png'), fullPage: false });

    // Dump current page state
    const pageState = await page.evaluate(() => {
        return {
            url: location.href,
            title: document.title,
            fileInputs: [...document.querySelectorAll('input[type="file"]')].map(i => ({ accept: i.accept, id: i.id })),
            buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => ({
                text: b.textContent?.trim().substring(0, 50), id: b.id,
                'data-test-id': b.getAttribute('data-test-id'), disabled: b.disabled,
            })),
            inputs: [...document.querySelectorAll('input:not([type="file"])')].filter(i => i.offsetParent !== null).map(i => ({
                type: i.type, id: i.id, placeholder: i.placeholder, 'aria-label': i.getAttribute('aria-label'),
            })),
            bodyText: document.body?.innerText?.substring(0, 1000),
        };
    });
    fs.writeFileSync(path.join(screenshotDir, 'v2-03-page-state.json'), JSON.stringify(pageState, null, 2));
    console.log('\nPage state:', JSON.stringify(pageState, null, 2));

    // Step 4: Upload video
    console.log('\n=== STEP 4: Upload video ===');
    if (pageState.fileInputs.length > 0) {
        console.log('Found file input, uploading...');
        await page.locator('input[type="file"]').first().setInputFiles([videoPath], { timeout: 30000 });
        console.log('Video uploaded, waiting 15s...');
        await page.waitForTimeout(15000);
        await page.screenshot({ path: path.join(screenshotDir, 'v2-04-after-upload.png'), fullPage: false });

        // Dump state after upload
        const afterUpload = await page.evaluate(() => ({
            url: location.href,
            buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => ({
                text: b.textContent?.trim().substring(0, 50), id: b.id, disabled: b.disabled,
                'data-test-id': b.getAttribute('data-test-id'),
            })),
            bodyText: document.body?.innerText?.substring(0, 500),
        }));
        fs.writeFileSync(path.join(screenshotDir, 'v2-04-after-upload.json'), JSON.stringify(afterUpload, null, 2));
        console.log('After upload:', JSON.stringify(afterUpload, null, 2));

        // Step 5: Find and click Next
        console.log('\n=== STEP 5: Click Next ===');
        // Wait for video to process and button to enable
        let nextClicked = false;
        for (let attempt = 0; attempt < 15; attempt++) {
            const nextSels = [
                'button:has-text("Tiếp theo")',
                'button:has-text("Next")',
                'button[aria-label*="Tiếp theo" i]',
                'button[aria-label*="Next" i]',
                'a:has-text("Tiếp theo")',
                'a:has-text("Next")',
            ];
            for (const sel of nextSels) {
                const btn = page.locator(sel).first();
                if (await btn.count() > 0) {
                    const visible = await btn.isVisible().catch(() => false);
                    const disabled = await btn.isDisabled().catch(() => false);
                    if (visible && !disabled) {
                        await btn.click({ force: true });
                        nextClicked = true;
                        console.log(`Clicked Next via: ${sel} (attempt ${attempt})`);
                        break;
                    }
                }
            }
            if (nextClicked) break;
            if (attempt % 3 === 0) console.log(`  Waiting for Next button... attempt ${attempt}`);
            await page.waitForTimeout(5000);
        }
        await page.waitForTimeout(5000);
        await page.screenshot({ path: path.join(screenshotDir, 'v2-05-after-next.png'), fullPage: false });

        // Dump final state
        const finalState = await page.evaluate(() => ({
            url: location.href,
            buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => ({
                text: b.textContent?.trim().substring(0, 50), id: b.id, disabled: b.disabled,
                'data-test-id': b.getAttribute('data-test-id'),
            })),
            inputs: [...document.querySelectorAll('input:not([type="file"])')].filter(i => i.offsetParent !== null).map(i => ({
                type: i.type, id: i.id, placeholder: i.placeholder, 'aria-label': i.getAttribute('aria-label'),
            })),
            editables: [...document.querySelectorAll('[contenteditable="true"]')].filter(e => e.offsetParent !== null).map(e => ({
                tag: e.tagName, 'aria-label': e.getAttribute('aria-label'), text: e.textContent?.substring(0, 50),
            })),
            bodyText: document.body?.innerText?.substring(0, 1000),
        }));
        fs.writeFileSync(path.join(screenshotDir, 'v2-05-final-state.json'), JSON.stringify(finalState, null, 2));
        console.log('\nFinal state:', JSON.stringify(finalState, null, 2));

    } else {
        console.log('No file input found! Cannot upload.');
        // Try navigating to pin-creation-tool directly
        console.log('Trying pin-creation-tool...');
        await page.goto('https://www.pinterest.com/pin-creation-tool/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(5000);
        await page.screenshot({ path: path.join(screenshotDir, 'v2-04-pin-creation-tool.png'), fullPage: false });
        const pctState = await page.evaluate(() => ({
            url: location.href,
            fileInputs: [...document.querySelectorAll('input[type="file"]')].length,
            buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => ({
                text: b.textContent?.trim().substring(0, 50), disabled: b.disabled,
            })),
            bodyText: document.body?.innerText?.substring(0, 500),
        }));
        console.log('Pin creation tool state:', JSON.stringify(pctState, null, 2));
    }

    console.log('\n=== DONE ===');
    await context.close().catch(() => {});
})();
