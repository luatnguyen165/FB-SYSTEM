const fs = require('fs');
const path = require('path');
const { getOrOpenSocialContext } = require('./socialPlaywrightService');
const { randomWait, humanLikeTyping } = require('./humanBehaviorService');

/**
 * Resolve relative video path (/uploads/videos/xxx) to absolute filesystem path
 */
function resolveVideoPathToAbsolute(videoPath) {
    if (!videoPath) return '';
    if (path.isAbsolute(videoPath) && /^[A-Za-z]:[/\\]/.test(videoPath)) {
        return videoPath;
    }
    const cleaned = videoPath.replace(/^\/+/, '');
    return path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), cleaned);
}

const TIKTOK_UPLOAD_URL = 'https://www.tiktok.com/upload';

/**
 * Upload video lên TikTok
 * @param {Object} options
 * @param {string} options.userId - ID người dùng
 * @param {string} options.accountName - Tên tài khoản TikTok (channel name)
 * @param {string} options.accountType - Loại tài khoản
 * @param {string} options.videoPath - Đường dẫn file video
 * @param {string} options.title - Tiêu đề/caption cho video
 * @param {string[]} options.hashtags - Mảng hashtag (không cần #)
 * @param {boolean} options.headless - Chạy ẩn hay hiển thị browser
 * @returns {Object} { success, message, publishedUrl }
 */
async function uploadVideoToTikTok({
    userId,
    accountName,
    accountType = 'Personal',
    videoPath,
    title = '',
    hashtags = [],
    headless = true,
    existingSessionDir = ''
}) {
    console.log(`[TikTok Upload] ===== BẮT ĐẦU UPLOAD =====`);
    console.log(`[TikTok Upload] STEP 0 - Input params: userId=${userId} account=${accountName} accountType=${accountType} headless=${headless}`);
    console.log(`[TikTok Upload] STEP 0 - videoPath gốc: ${videoPath}`);
    console.log(`[TikTok Upload] STEP 0 - title: "${title}" hashtags: [${hashtags.join(', ')}]`);

    // Validate
    if (!userId) {
        console.error(`[TikTok Upload] STEP 0 - LỖI: Thiếu userId`);
        throw new Error('Thiếu userId');
    }
    if (!accountName) {
        console.error(`[TikTok Upload] STEP 0 - LỖI: Thiếu tên tài khoản TikTok`);
        throw new Error('Thiếu tên tài khoản TikTok');
    }
    if (!videoPath) {
        console.error(`[TikTok Upload] STEP 0 - LỖI: Thiếu đường dẫn video`);
        throw new Error('Thiếu đường dẫn video');
    }
    
    // Resolve relative path to absolute before checking existence
    console.log(`[TikTok Upload] STEP 1 - Resolve video path...`);
    const resolvedVideoPath = resolveVideoPathToAbsolute(videoPath);
    console.log(`[TikTok Upload] STEP 1 - videoPath gốc: ${videoPath}`);
    console.log(`[TikTok Upload] STEP 1 - resolvedVideoPath: ${resolvedVideoPath}`);
    console.log(`[TikTok Upload] STEP 1 - fs.existsSync check: ${fs.existsSync(resolvedVideoPath)}`);
    
    if (!fs.existsSync(resolvedVideoPath)) {
        console.error(`[TikTok Upload] STEP 1 - LỖI: File video không tồn tại tại: ${resolvedVideoPath}`);
        throw new Error(`File video không tồn tại: ${resolvedVideoPath}`);
    }
    console.log(`[TikTok Upload] STEP 1 - File video tồn tại OK`);
    
    // Use resolved path throughout the function
    videoPath = resolvedVideoPath;

    let context;
    let sessionKey;

    try {
        // 1. Mở context TikTok (sử dụng persistent context từ socialPlaywrightService)
        console.log(`[TikTok Upload] STEP 2 - Mở context TikTok...`);
        console.log(`[TikTok Upload] STEP 2 - Gọi getOrOpenSocialContext(userId=${userId}, accountName=${accountName}, accountType=${accountType}, platform=TT, headless=${headless})`);
        const result = await getOrOpenSocialContext(userId, accountName, accountType, 'TT', { headless, existingSessionDir });
        context = result.context;
        sessionKey = result.sessionKey;
        console.log(`[TikTok Upload] STEP 2 - Context OK: sessionKey=${sessionKey} reused=${result.reused}`);

        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        await page.bringToFront().catch(() => {});
        console.log(`[TikTok Upload] STEP 2 - Page OK, current URL: ${page.url()}`);

        // 2. Điều hướng đến trang upload TikTok
        console.log(`[TikTok Upload] STEP 3 - Điều hướng đến ${TIKTOK_UPLOAD_URL}...`);
        await page.goto(TIKTOK_UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`[TikTok Upload] STEP 3 - Đã load trang upload, URL hiện tại: ${page.url()}`);

        // QUAN TRỌNG: Đợi lâu hơn để trang upload load hoàn chỉnh (button, file input, v.v.)
        console.log(`[TikTok Upload] STEP 3 - Đợi 8s cho trang load hoàn chỉnh...`);
        await page.waitForTimeout(8000);
        console.log(`[TikTok Upload] STEP 3 - Đã chờ 8s, URL: ${page.url()}`);

        // Kiểm tra đăng nhập
        const currentUrl = page.url();
        console.log(`[TikTok Upload] STEP 3 - Kiểm tra đăng nhập: URL=${currentUrl}`);
        if (currentUrl.includes('login') || currentUrl.includes('passport')) {
            console.error(`[TikTok Upload] STEP 3 - LỖI: Tài khoản TikTok chưa đăng nhập`);
            throw new Error('Tài khoản TikTok chưa đăng nhập. Vui lòng đăng nhập lại.');
        }
        console.log(`[TikTok Upload] STEP 3 - Đã đăng nhập OK`);

        // 3. Upload file video
        console.log(`[TikTok Upload] STEP 4 - Upload file video: ${videoPath}`);
        console.log(`[TikTok Upload] STEP 4 - Page URL: ${page.url()}`);
        console.log(`[TikTok Upload] STEP 4 - Page title: ${await page.title().catch(() => 'N/A')}`);
        
        // Đợi thêm 2s nữa cho chắc chắn
        await page.waitForTimeout(2000);

        // Debug: lấy thông tin buttons và inputs trả về Node.js console
        const pageDebugData = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const inputs = Array.from(document.querySelectorAll('input'));
            return {
                buttons: btns.map(b => ({
                    text: (b.textContent?.trim() || '').substring(0, 60),
                    e2e: b.getAttribute('data-e2e') || '',
                    className: (b.className || '').substring(0, 60),
                    visible: b.offsetParent !== null
                })),
                fileInputs: inputs.filter(i => i.type === 'file').map(i => ({
                    id: i.id,
                    accept: i.accept,
                    visible: i.offsetParent !== null
                })),
                allInputs: inputs.map(i => ({
                    type: i.type,
                    id: i.id,
                    accept: i.accept,
                    visible: i.offsetParent !== null
                }))
            };
        });
        console.log(`[TikTok Upload] STEP 4 - DEBUG: ${pageDebugData.buttons.length} buttons`);
        pageDebugData.buttons.forEach((b, i) => console.log(`[TikTok Upload] STEP 4 - DEBUG btn[${i}]: text="${b.text}" e2e="${b.e2e}" visible=${b.visible}`));
        console.log(`[TikTok Upload] STEP 4 - DEBUG: ${pageDebugData.fileInputs.length} file inputs`);
        pageDebugData.fileInputs.forEach((fi, i) => console.log(`[TikTok Upload] STEP 4 - DEBUG fileInput[${i}]: id="${fi.id}" accept="${fi.accept}" visible=${fi.visible}`));
        console.log(`[TikTok Upload] STEP 4 - DEBUG: ${pageDebugData.allInputs.length} total inputs`);
        pageDebugData.allInputs.forEach((inp, i) => console.log(`[TikTok Upload] STEP 4 - DEBUG input[${i}]: type="${inp.type}" id="${inp.id}" accept="${inp.accept}" visible=${inp.visible}`));

        // Cách 1: Đợi nút "Select video" xuất hiện, click và dùng file chooser
        console.log(`[TikTok Upload] STEP 4 - C1: Chờ nút "Select video" xuất hiện...`);
        let fileInputSet = false;

        try {
            // Đợi button select video xuất hiện (tối đa 30s)
            const selectBtn = page.locator('button[data-e2e="select_video_button"]').first();
            await selectBtn.waitFor({ state: 'visible', timeout: 30000 });
            console.log(`[TikTok Upload] STEP 4 - C1: Nút "Select video" đã visible`);
            
            // Tạo file chooser promise trước khi click
            const fcPromise = page.waitForEvent('filechooser', { timeout: 15000 });
            
            // Click nút
            await selectBtn.click();
            console.log(`[TikTok Upload] STEP 4 - C1: Đã click, chờ file chooser...`);
            
            const fileChooser = await fcPromise;
            console.log(`[TikTok Upload] STEP 4 - C1: File chooser opened, setting file...`);
            await fileChooser.setFiles(videoPath);
            console.log(`[TikTok Upload] STEP 4 - C1: File set thành công!`);
            fileInputSet = true;
        } catch (err) {
            console.log(`[TikTok Upload] STEP 4 - C1: Lỗi: ${err.message}`);
        }

        // Cách 2: Nếu C1 thất bại, thử đợi thêm và dùng waitFor load state
        if (!fileInputSet) {
            console.log(`[TikTok Upload] STEP 4 - C2: Thử dùng waitForSelector...`);
            try {
                await page.waitForSelector('input[type="file"]', { timeout: 15000 });
                const fileInput = page.locator('input[type="file"]').first();
                const count = await fileInput.count();
                console.log(`[TikTok Upload] STEP 4 - C2: input[type="file"] found, count=${count}`);
                if (count > 0) {
                    await fileInput.setInputFiles(videoPath);
                    console.log(`[TikTok Upload] STEP 4 - C2: File set thành công!`);
                    fileInputSet = true;
                }
            } catch (err) {
                console.log(`[TikTok Upload] STEP 4 - C2: Lỗi: ${err.message}`);
            }
        }

        if (!fileInputSet) {
            console.error(`[TikTok Upload] STEP 4 - LỖI: Không thể upload video`);
            // Log HTML của upload area
            const html = await page.evaluate(() => {
                const el = document.querySelector('[class*="upload"]') || document.querySelector('[class*="Upload"]') || document.body;
                return el?.innerHTML?.substring(0, 2000) || '';
            }).catch(() => '');
            console.log(`[TikTok Upload] STEP 4 - Upload area HTML:\n${html}`);
            throw new Error('Không thể upload video: không tìm thấy nút Select video hoặc input file trên TikTok');
        }

        console.log('[TikTok Upload] STEP 4 - Đã set file thành công, đang xử lý...');

        // Đợi video upload & xử lý - TikTok cần thời gian để upload và xử lý video
        console.log(`[TikTok Upload] STEP 5 - Đợi video upload & xử lý + tìm nút Post (tối đa 5 phút)...`);
        
        // Gộp STEP 5 và STEP 7: đợi nút Post sáng, vừa đợi vừa nhập caption
        let postButton = null;
        const maxWaitMs = 300000; // 5 phút
        const startTime = Date.now();
        
        // Đợi 20s ban đầu cho video upload
        console.log(`[TikTok Upload] STEP 5 - Đợi 20s ban đầu cho video upload...`);
        await page.waitForTimeout(20000);
        
        // Polling tìm nút Post
        while ((Date.now() - startTime) < maxWaitMs) {
            // Tìm nút Post bằng nhiều selectors
            const postSelectors = [
                'button[data-e2e="post_video_button"]',
                'button:has-text("Post")',
                'button:has-text("Đăng")'
            ];
            
            for (const sel of postSelectors) {
                const btn = page.locator(sel).first();
                const count = await btn.count().catch(() => 0);
                if (count > 0) {
                    const disabled = await btn.getAttribute('aria-disabled').catch(() => 'true');
                    const isDisabled = disabled === 'true' || disabled === true;
                    if (!isDisabled) {
                        postButton = btn;
                        const elapsed = Math.round((Date.now() - startTime) / 1000);
                        console.log(`[TikTok Upload] STEP 5 - Nút Post đã sáng sau ${elapsed}s!`);
                        break;
                    }
                }
            }
            if (postButton) break;
            
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`[TikTok Upload] STEP 5 - Đợi nút Post... (${elapsed}s)`);
            await page.waitForTimeout(5000);
        }

        if (!postButton) {
            console.error(`[TikTok Upload] STEP 5 - LỖI: Timeout sau ${maxWaitMs / 1000}s, nút Post không sáng`);
            throw new Error('Timeout: Nút Post không sáng sau 5 phút, không thể đăng');
        }
        
        console.log(`[TikTok Upload] STEP 5 - Đã tìm thấy nút Post sẵn sàng, bắt đầu nhập caption...`);

        // Dismiss any modal dialogs blocking the editor
        console.log('[TikTok Upload] STEP 6 - Dismissing modals...');
        for (let i = 0; i < 3; i++) {
            const modalOverlay = page.locator('.TUXModal-overlay, div[role="dialog"], div[data-tux-color-scheme]').first();
            if (await modalOverlay.isVisible().catch(() => false)) {
                // Try clicking close button or pressing Escape
                const closeBtn = page.locator('.TUXModal button[aria-label="Close"], .TUXModal button[aria-label="Đóng"], div[role="dialog"] button[aria-label="Close"]').first();
                if (await closeBtn.isVisible().catch(() => false)) {
                    await closeBtn.click().catch(() => {});
                    console.log(`[TikTok Upload] STEP 6 - Closed modal via button`);
                } else {
                    await page.keyboard.press('Escape');
                    console.log(`[TikTok Upload] STEP 6 - Closed modal via Escape`);
                }
                await page.waitForTimeout(1000);
            } else {
                break;
            }
        }

        // Nhập Caption và Hashtags
        console.log('[TikTok Upload] STEP 6 - Nhập caption...');
        const fullCaption = buildCaption(title, hashtags);

        // Selector cho editor caption của TikTok
        const editorSelectors = [
            '.public-DraftEditor-content[contenteditable="true"]',
            '[data-testid="post-editor-mention-container"]',
            '[contenteditable="true"][role="textbox"]',
            '.DraftEditor-root [contenteditable="true"]'
        ];

        let editorFound = false;
        for (const selector of editorSelectors) {
            console.log(`[TikTok Upload] STEP 6 - Thử selector: ${selector}`);
            const editor = page.locator(selector).first();
            const count = await editor.count().catch(() => 0);
            console.log(`[TikTok Upload] STEP 6 -   count=${count}`);
            if (count > 0) {
                const isVisible = await editor.isVisible().catch(() => false);
                console.log(`[TikTok Upload] STEP 6 -   isVisible=${isVisible}`);
                if (isVisible) {
                    console.log(`[TikTok Upload] STEP 6 - Tìm thấy editor: ${selector}`);

                    // Click để focus
                    console.log(`[TikTok Upload] STEP 6 - Click để focus editor...`);
                    await editor.click({ force: true });
                    await page.waitForTimeout(500);

                    // Select all và xóa nội dung cũ
                    console.log(`[TikTok Upload] STEP 6 - Xóa nội dung cũ...`);
                    await page.keyboard.press('Control+A');
                    await page.keyboard.press('Backspace');
                    await page.waitForTimeout(300);

                    // Typing giống người dùng thật
                    console.log(`[TikTok Upload] STEP 6 - Gõ caption (humanLikeTyping)...`);
                    await humanLikeTyping(page, fullCaption);

                    // Ép TikTok nhận diện nội dung
                    await page.keyboard.press('Space');
                    await page.keyboard.press('Backspace');

                    editorFound = true;
                    console.log(`[TikTok Upload] STEP 6 - Đã nhập caption thành công`);
                    break;
                }
            }
        }

        if (!editorFound) {
            console.warn('[TikTok Upload] STEP 6 - Không tìm thấy editor caption, thử dùng keyboard.type...');
            await page.keyboard.type(fullCaption, { delay: 80 });
            console.log(`[TikTok Upload] STEP 6 - Đã gõ caption qua keyboard.type`);
        }

        await page.waitForTimeout(2000);
        console.log(`[TikTok Upload] STEP 6 - Đã chờ 2s sau khi nhập caption`);

        // Click nút Post (đã được tìm thấy ở STEP 5)
        console.log('[TikTok Upload] STEP 7 - Dismiss modals before Post...');
        for (let i = 0; i < 3; i++) {
            const modal = page.locator('.TUXModal-overlay, div[role="dialog"]').first();
            if (await modal.isVisible().catch(() => false)) {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(1000);
            } else {
                break;
            }
        }

        console.log('[TikTok Upload] STEP 7 - Click nút Post...');
        await postButton.click({ force: true });
        console.log('[TikTok Upload] STEP 7 - Đã click nút Post');
        
        // Sau khi click Post thành công, mặc định coi là đã đăng thành công
        // TikTok sẽ xử lý và redirect hoặc hiển thị popup
        console.log('[TikTok Upload] STEP 8 - Đợi 5s cho TikTok xử lý...');
        await page.waitForTimeout(5000);
        console.log(`[TikTok Upload] STEP 8 - URL sau click: ${page.url()}`);

        // 8. Lấy published URL
        console.log('[TikTok Upload] STEP 9 - Lấy URL video đã đăng...');
        let publishedUrl = '';
        
        // Đợi thêm 10s để chắc chắn TikTok xử lý xong
        console.log('[TikTok Upload] STEP 9 - Đợi 10s để lấy URL...');
        await page.waitForTimeout(10000);
        const finalUrl = page.url();
        console.log(`[TikTok Upload] STEP 9 - finalUrl: ${finalUrl}`);

        // Thử lấy URL từ nhiều nguồn
        if (finalUrl.includes('/video/') || finalUrl.includes('/@')) {
            publishedUrl = finalUrl;
            console.log(`[TikTok Upload] STEP 9 - Lấy URL từ page URL: ${publishedUrl}`);
        }

        // Nếu chưa có URL, thử lấy từ các link trên trang
        if (!publishedUrl) {
            const videoLinks = await page.evaluate(() => {
                const links = document.querySelectorAll('a[href*="/video/"], a[href*="/@"]');
                for (const link of links) {
                    const href = link.getAttribute('href');
                    if (href && !href.includes('/upload')) return href.startsWith('http') ? href : `https://www.tiktok.com${href}`;
                }
                return '';
            }).catch(() => '');
            if (videoLinks) {
                publishedUrl = videoLinks;
                console.log(`[TikTok Upload] STEP 9 - Lấy URL từ link video trên trang: ${publishedUrl}`);
            }
        }

        // Kiểm tra thông báo thành công
        const successSelectors = [
            '[data-e2e="success_modal"]',
            ':has-text("posted successfully")',
            ':has-text("đăng thành công")',
            ':has-text("Your video has been uploaded")',
            ':has-text("Video published")',
            '[class*="success"]'
        ];

        for (const selector of successSelectors) {
            const el = page.locator(selector).first();
            const count = await el.count().catch(() => 0);
            console.log(`[TikTok Upload] STEP 9 - Kiểm tra success selector: ${selector} count=${count}`);
            if (count > 0) {
                console.log(`[TikTok Upload] STEP 9 - Phát hiện thông báo thành công: ${selector}`);
                break;
            }
        }

        // Đóng popup nếu có
        const closeBtn = page.locator('[data-e2e="close_button"], button:has-text("Close"), button:has-text("Đóng")').first();
        const closeBtnCount = await closeBtn.count().catch(() => 0);
        console.log(`[TikTok Upload] STEP 9 - close button count: ${closeBtnCount}`);
        if (closeBtnCount > 0) {
            await closeBtn.click().catch(() => {});
            console.log(`[TikTok Upload] STEP 9 - Đã click close button`);
        }

        // QUAN TRỌNG: Nếu đến được đây mà không throw error, coi như đăng thành công
        // Vì nút Post đã được click, không có exception -> TikTok đã nhận lệnh đăng
        console.log(`[TikTok Upload] STEP 9 - Kết quả cuối: success=true url=${publishedUrl}`);
        console.log(`[TikTok Upload] ===== KẾT THÚC UPLOAD =====`);

        return {
            success: true,
            publishedUrl,
            message: publishedUrl 
                ? 'Đăng video TikTok thành công' 
                : 'Đã đăng video TikTok (không lấy được URL video)'
        };

    } catch (error) {
        console.error(`[TikTok Upload] ===== LỖI =====`);
        console.error(`[TikTok Upload] Lỗi tại STEP: ${error.message}`);
        console.error(`[TikTok Upload] Stack: ${error.stack}`);
        console.error(`[TikTok Upload] ===== KẾT THÚC (LỖI) =====`);
        return {
            success: false,
            publishedUrl: '',
            message: `Lỗi TikTok upload: ${error.message}`
        };
    }
}

/**
 * Tạo caption hoàn chỉnh từ title và hashtags
 */
function buildCaption(title = '', hashtags = []) {
    const parts = [];

    if (title && title.trim()) {
        parts.push(title.trim());
    }

    // Thêm hashtags (đảm bảo có dấu #)
    if (Array.isArray(hashtags) && hashtags.length > 0) {
        const formattedTags = hashtags
            .map(tag => {
                const t = String(tag).trim();
                if (!t) return '';
                return t.startsWith('#') ? t : `#${t}`;
            })
            .filter(Boolean);

        if (formattedTags.length > 0) {
            parts.push('\n');
            parts.push(formattedTags.join(' '));
        }
    }

    return parts.join('');
}

/**
 * Upload video TikTok ngay lập tức (không qua lịch trình)
 * Wrapper cho convenience
 */
async function uploadVideoToTikTokNow({
    userId,
    accountName,
    accountType = 'Personal',
    videoPath,
    title = '',
    hashtags = [],
    headless = true,
    existingSessionDir = ''
}) {
    return uploadVideoToTikTok({
        userId,
        accountName,
        accountType,
        videoPath,
        title,
        hashtags,
        headless: headless === false ? false : true, // Default visible browser
        existingSessionDir
    });
}

module.exports = {
    uploadVideoToTikTok,
    uploadVideoToTikTokNow,
    buildCaption
};