const fs = require('fs');
const path = require('path');
const { getOrOpenSocialContext } = require('./socialPlaywrightService');

function resolveVideoPathToAbsolute(videoPath) {
    if (!videoPath) return '';
    if (path.isAbsolute(videoPath) && /^[A-Za-z]:[/\\]/.test(videoPath)) return videoPath;
    const cleaned = videoPath.replace(/^\/+/, '');
    return path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), cleaned);
}

async function uploadVideoToInstagram({ userId, accountName, accountType = 'Personal', videoPath, caption = '', headless = false }) {
    console.log(`[IG Upload] ===== BẮT ĐẦU =====`);
    console.log(`[IG Upload] STEP 0 - account=${accountName} video=${videoPath} headless=${headless}`);
    if (!userId || !accountName || !videoPath) throw new Error('Thiếu userId, accountName hoặc videoPath');

    const resolved = resolveVideoPathToAbsolute(videoPath);
    console.log(`[IG Upload] STEP 1 - resolved=${resolved} exists=${fs.existsSync(resolved)}`);
    if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);
    videoPath = resolved;

    try {
        console.log(`[IG Upload] STEP 2 - Mở context desktop...`);
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'IG', { headless });
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.bringToFront().catch(() => {});

        console.log(`[IG Upload] STEP 3 - instagram.com...`);
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);
        if (page.url().includes('login')) throw new Error('Chưa đăng nhập');

        // STEP 4: Click Create -> tìm dropdown -> click "Post"
        console.log(`[IG Upload] STEP 4 - Click New post...`);
        await page.locator('svg[aria-label="New post"]').first().click();
        await page.waitForTimeout(2000);

        // Debug: xem dropdown hiện ra ở đâu
        const dropdownHTML = await page.evaluate(() => {
            const dropdown = document.querySelector('div[role="menu"]') || 
                             document.querySelector('div[role="listbox"]') ||
                             document.querySelector('[class*="dropdown"]');
            if (dropdown) return dropdown.innerHTML?.substring(0, 500) || '';
            // Tìm element chứa "Post" text trong dropdown, không phải feed
            const allDivs = document.querySelectorAll('div[role="menuitem"]');
            return Array.from(allDivs).map(d => d.textContent).join(' | ');
        });
        console.log(`[IG Upload] STEP 4 - Dropdown: ${dropdownHTML}`);

        // Click "Post" trong dropdown - tìm element chứa từ "Post"
        console.log(`[IG Upload] STEP 4 - Click Post trong dropdown...`);
        // Tìm tất cả element chứa text "Post" và click cái visible đầu tiên
        const postElements = page.locator(':text("Post")').all();
        const postEls = await postElements;
        console.log(`[IG Upload] STEP 4 - Elements containing "Post": ${postEls.length}`);
        
        let clicked = false;
        for (const el of postEls) {
            const tag = await el.evaluate(e => e.tagName).catch(() => '');
            const text = (await el.textContent().catch(() => '')).trim();
            const vis = await el.isVisible().catch(() => false);
            console.log(`[IG Upload] STEP 4 -   tag="${tag}" text="${text.substring(0,30)}" visible=${vis}`);
            if (vis && text.toLowerCase() === 'post') {
                console.log(`[IG Upload] STEP 4 -   Clicking!`);
                await el.click();
                clicked = true;
                break;
            }
        }
        
        if (!clicked) {
            // Fallback: click element đầu tiên chứa Post text
            console.log(`[IG Upload] STEP 4 - Fallback: click element có text Post...`);
            await page.locator(':text-is("Post")').first().click();
        }
        await page.waitForTimeout(3000);
        console.log(`[IG Upload] STEP 4 - URL=${page.url()}`);

        // STEP 5: Upload file
        console.log(`[IG Upload] STEP 5 - Upload...`);
        
        // Chờ dialog/popup hiện
        await page.waitForTimeout(3000);
        
        // Kiểm tra tất cả các page
        let activePage = page;
        const allPages = context.pages();
        console.log(`[IG Upload] STEP 5 - Total pages: ${allPages.length}`);
        for (const p of allPages) {
            await p.bringToFront().catch(() => {});
            await p.waitForTimeout(1000);
            const title = await p.title().catch(() => '');
            const url = p.url();
            const inputCount = await p.locator('input[type="file"]').count().catch(() => 0);
            const dialogCount = await p.locator('div[role="dialog"]').count().catch(() => 0);
            console.log(`[IG Upload] STEP 5 - Page title="${title}" url=${url} inputs=${inputCount} dialogs=${dialogCount}`);
            
            if (inputCount > 0) {
                activePage = p;
                break;
            }
        }

        // Upload file
        const inputs = activePage.locator('input[type="file"]');
        const fiCount = await inputs.count();
        console.log(`[IG Upload] STEP 5 - Active page file inputs: ${fiCount}`);

        if (fiCount > 0) {
            await inputs.first().setInputFiles(videoPath);
            console.log(`[IG Upload] STEP 5 - File uploaded!`);
        } else {
            // Fallback: chờ dialog
            const dialog = activePage.locator('div[role="dialog"]');
            const diCount = await dialog.count();
            console.log(`[IG Upload] STEP 5 - Dialogs: ${diCount}`);
            if (diCount > 0) {
                const fi2 = dialog.locator('input[type="file"]');
                if (await fi2.count() > 0) {
                    await fi2.first().setInputFiles(videoPath);
                    console.log(`[IG Upload] STEP 5 - File uploaded in dialog!`);
                } else {
                    throw new Error('Dialog không chứa input file');
                }
            } else {
                throw new Error(`Không tìm thấy input file`);
            }
        }
        
        await activePage.waitForTimeout(5000);

        // STEP 6: Next - Instagram dùng div[role="button"] thay vì <button>
        console.log(`[IG Upload] STEP 6 - Next...`);
        // Dùng xpath: tìm div có role="button" chứa text "Next"
        const nextXPath = "//div[@role='button'][contains(.,'Next') or contains(.,'Tiếp')]";
        const nextBtn = activePage.locator(nextXPath).first();
        const nbCount = await nextBtn.count().catch(() => 0);
        console.log(`[IG Upload] STEP 6 - Next button count: ${nbCount}`);
        if (nbCount > 0) { await nextBtn.click(); await activePage.waitForTimeout(2000); }
        // Click lần 2 (filter/crop page)
        try { if (await nextBtn.isVisible()) { await nextBtn.click(); await activePage.waitForTimeout(2000); } } catch(e) {}

        console.log(`[IG Upload] STEP 8 - Caption...`);
        // Instagram dùng div contenteditable với role="textbox"
        const capXPath = "//div[@role='textbox'][@aria-label='Write a caption...']";
        const captionBox = activePage.locator(capXPath).first();
        const capCount = await captionBox.count().catch(() => 0);
        console.log(`[IG Upload] STEP 8 - Caption box count: ${capCount}`);
        if (capCount > 0) {
            // Click để focus, sau đó select all + type
            await captionBox.click();
            await activePage.waitForTimeout(500);
            await activePage.keyboard.press('Control+a');
            await activePage.keyboard.press('Backspace');
            await activePage.keyboard.type(caption, { delay: 30 });
            console.log(`[IG Upload] STEP 8 - Đã nhập caption`);
        } else {
            // Fallback: textarea
            const textarea = activePage.locator('textarea').first();
            if (await textarea.count() > 0) { await textarea.fill(caption); }
        }
        await activePage.waitForTimeout(1000);

        console.log(`[IG Upload] STEP 9 - Share...`);
        const shareXPath = "//div[@role='button'][contains(.,'Share') or contains(.,'Chia sẻ')]";
        // Dùng .last() để lấy nút Share cuối cùng (trong dialog upload, không phải feed)
        const shareBtn = activePage.locator(shareXPath).last();
        const sbCount = await activePage.locator(shareXPath).count().catch(() => 0);
        console.log(`[IG Upload] STEP 9 - Share button count: ${sbCount}`);
        if (sbCount > 0) { await shareBtn.click(); }
        console.log(`[IG Upload] STEP 9 - Đã click Share, đợi 15s rồi đóng...`);
        // Đợi 15-20 giây cho video xử lý
        await activePage.waitForTimeout(15000);

        const publishedUrl = (activePage.url().includes('/p/') || activePage.url().includes('/reel/')) ? activePage.url() : '';
        console.log(`[IG Upload] HOÀN THÀNH url=${publishedUrl}`);

        // Đóng page để giải phóng tài nguyên
        try { await activePage.close(); } catch(e) {}
       
        return { success: true, publishedUrl, message: 'Đăng Instagram thành công' };

    } catch (error) {
        console.error(`[IG Upload] LỖI: ${error.message}`);
        return { success: false, publishedUrl: '', message: `Instagram: ${error.message}` };
    }
}

/**
 * Đăng ảnh lên Instagram (Post, không phải Reels)
 */
async function uploadImagesToInstagram({ userId, accountName, accountType = 'Personal', images = [], caption = '', headless = false }) {
    console.log(`[IG Post] ===== BẮT ĐẦU =====`);
    console.log(`[IG Post] STEP 0 - account=${accountName} images=${images.length} caption=${caption}`);

    if (!images.length) throw new Error('Thiếu ảnh để đăng Instagram');
    if (!accountName) throw new Error('Thiếu tài khoản Instagram');

    // Resolve image paths
    const resolvedImages = images.map(img => {
        const cleaned = img.replace(/^\/+/, '');
        const resolved = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), cleaned);
        if (!fs.existsSync(resolved)) {
            console.log(`[IG Post] Warning: ảnh không tồn tại: ${resolved}`);
        }
        return resolved;
    }).filter(fs.existsSync);

    if (!resolvedImages.length) throw new Error('Không tìm thấy file ảnh nào');

    try {
        console.log(`[IG Post] STEP 2 - Mở context desktop...`);
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'IG', { headless });
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.bringToFront().catch(() => {});

        console.log(`[IG Post] STEP 3 - instagram.com...`);
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);
        if (page.url().includes('login')) throw new Error('Chưa đăng nhập');

        // STEP 4: Click Create -> Post
        console.log(`[IG Post] STEP 4 - Click New post...`);
        await page.locator('svg[aria-label="New post"]').first().click();
        await page.waitForTimeout(2000);

        // Click "Post" trong dropdown
        const postEls = await page.locator(':text("Post")').all();
        for (const el of postEls) {
            const text = (await el.textContent().catch(() => '')).trim();
            const vis = await el.isVisible().catch(() => false);
            if (vis && text.toLowerCase() === 'post') {
                await el.click();
                break;
            }
        }
        await page.waitForTimeout(3000);

        // STEP 5: Upload images
        console.log(`[IG Post] STEP 5 - Upload ${resolvedImages.length} ảnh...`);
        let activePage = page;
        const allPages = context.pages();
        for (const p of allPages) {
            const fi = await p.locator('input[type="file"]').count().catch(() => 0);
            if (fi > 0) { activePage = p; break; }
        }

        const fileInput = activePage.locator('input[type="file"]');
        if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(resolvedImages);
            console.log(`[IG Post] STEP 5 - Ảnh đã upload!`);
        } else {
            throw new Error('Không tìm thấy input file');
        }
        await activePage.waitForTimeout(5000);

        // STEP 6: Next (Instagram multi-image cần click Next)
        console.log(`[IG Post] STEP 6 - Next...`);
        const nextXPath = "//div[@role='button'][contains(.,'Next') or contains(.,'Tiếp')]";
        const nextBtn = activePage.locator(nextXPath).first();
        if (await nextBtn.count() > 0) { await nextBtn.click(); await activePage.waitForTimeout(2000); }
        try { if (await nextBtn.isVisible()) { await nextBtn.click(); await activePage.waitForTimeout(2000); } } catch(e) {}

        // STEP 7: Caption
        console.log(`[IG Post] STEP 7 - Caption...`);
        const capXPath = "//div[@role='textbox'][@aria-label='Write a caption...']";
        const captionBox = activePage.locator(capXPath).first();
        if (await captionBox.count() > 0) {
            await captionBox.click();
            await activePage.waitForTimeout(500);
            await activePage.keyboard.press('Control+a');
            await activePage.keyboard.press('Backspace');
            await activePage.keyboard.type(caption, { delay: 30 });
        }
        await activePage.waitForTimeout(1000);

        // STEP 8: Share
        console.log(`[IG Post] STEP 8 - Share...`);
        const shareXPath = "//div[@role='button'][contains(.,'Share') or contains(.,'Chia sẻ')]";
        const shareBtn = activePage.locator(shareXPath).last();
        if (await shareBtn.count() > 0) { await shareBtn.click(); }
        // Đợi 15-20 giây cho ảnh xử lý
        await activePage.waitForTimeout(15000);

        const publishedUrl = activePage.url().includes('/p/') ? activePage.url() : '';
        console.log(`[IG Post] HOÀN THÀNH url=${publishedUrl}`);

        // Đóng page để giải phóng tài nguyên
        try { await activePage.close(); } catch(e) {}
        
        return { success: true, publishedUrl, message: 'Đăng Instagram Post thành công' };

    } catch (error) {
        console.error(`[IG Post] LỖI: ${error.message}`);
        return { success: false, publishedUrl: '', message: `Instagram Post: ${error.message}` };
    }
}

module.exports = { uploadVideoToInstagram, uploadImagesToInstagram };
