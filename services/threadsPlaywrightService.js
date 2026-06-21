const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { getOrOpenSocialContext } = require('./socialPlaywrightService');

/**
 * Resolve local file path (image hoặc video) -> absolute filesystem path
 */
function resolveFilePath(filePath = '') {
    const rawPath = String(filePath || '').trim();
    if (!rawPath) return '';
    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
    const cleaned = rawPath.replace(/^\/+/, '');
    const resolved = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), cleaned);
    return resolved;
}

/**
 * Lấy duration (giây) của video qua ffprobe. Trả về 0 nếu không đọc được.
 */
function getVideoDurationSeconds(absolutePath) {
    return new Promise((resolve) => {
        if (!absolutePath || !fs.existsSync(absolutePath)) return resolve(0);
        try {
            ffmpeg.ffprobe(absolutePath, (err, data) => {
                if (err || !data?.format?.duration) return resolve(0);
                const duration = Number(data.format.duration);
                resolve(Number.isFinite(duration) ? duration : 0);
            });
        } catch (e) {
            resolve(0);
        }
    });
}

/**
 * Validate video cho Threads: tối đa 5 phút (300s).
 * Throw error nếu vi phạm.
 */
async function assertThreadsVideoDuration(videoPath) {
    const MAX_SECONDS = 300; // 5 phút
    const absolutePath = resolveFilePath(videoPath);
    const duration = await getVideoDurationSeconds(absolutePath);
    if (duration > 0 && duration > MAX_SECONDS) {
        throw new Error(
            `Threads chỉ hỗ trợ video tối đa 5 phút. Video này dài ${Math.round(duration)} giây (~${Math.round(duration / 60)} phút).`
        );
    }
    return duration;
}

/**
 * Upload 1 hoặc nhiều ảnh + caption lên Threads feed (threads.net)
 * Threads UI: click "What's new?" -> modal composer -> upload ảnh -> type caption -> Post
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.accountName
 * @param {string} [opts.accountType='Personal']
 * @param {string[]} opts.images - danh sách URL/path ảnh
 * @param {string} [opts.caption='']
 * @param {boolean} [opts.headless=false]
 * @param {string} [opts.existingSessionDir='']
 * @returns {Promise<{success: boolean, publishedUrl: string, message: string}>}
 */
async function postImagesToThreads({ userId, accountName, accountType = 'Personal', images = [], caption = '', headless = false, existingSessionDir = '' }) {
    console.log(`[Threads Post] ===== BẮT ĐẦU =====`);
    console.log(`[Threads Post] STEP 0 - account=${accountName} images=${images.length} caption=${(caption || '').substring(0, 50)}...`);

    if (!userId || !accountName) throw new Error('Thiếu userId hoặc accountName');
    if (!Array.isArray(images) || images.length === 0) throw new Error('Threads yêu cầu phải có ít nhất 1 hình ảnh');

    const resolvedImages = images.map(resolveFilePath).filter(p => p && fs.existsSync(p));
    console.log(`[Threads Post] STEP 1 - resolved images=${resolvedImages.length}`);
    if (!resolvedImages.length) throw new Error('Không tìm thấy file ảnh hợp lệ');

    try {
        console.log(`[Threads Post] STEP 2 - Mở context...`);
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'TH', { headless, existingSessionDir });
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        // Không set viewport - để Chrome dùng kích thước thật
        await page.bringToFront().catch(() => {});

        console.log(`[Threads Post] STEP 3 - threads.net...`);
        await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (page.url().includes('login') || page.url().includes('accounts.threads.com')) {
            throw new Error('Chưa đăng nhập Threads');
        }

        // STEP 4: Click composer - Threads có 2 nơi mở composer:
        // - Nút "What's new?" ở sidebar/trang chủ
        // - Nút "Post" ở bottom nav (mobile view) hoặc top bar
        console.log(`[Threads Post] STEP 4 - Mở composer...`);
        const composerOpened = await openComposer(page);
        if (!composerOpened) {
            throw new Error('Không tìm thấy nút mở composer Threads');
        }
        await page.waitForTimeout(2500);

        // STEP 5: Upload ảnh
        console.log(`[Threads Post] STEP 5 - Upload ${resolvedImages.length} ảnh...`);
        // Tìm input file trong tất cả pages (composer có thể mở tab mới)
        let activePage = page;
        const allPages = context.pages();
        for (const p of allPages) {
            const fileInputs = await p.locator('input[type="file"]').count().catch(() => 0);
            if (fileInputs > 0) {
                // Check xem input có accept image không
                const accepts = await p.locator('input[type="file"]').first().getAttribute('accept').catch(() => '');
                if (!accepts || accepts.includes('image')) {
                    activePage = p;
                    break;
                }
            }
        }

        const fileInput = activePage.locator('input[type="file"]');
        const fileInputCount = await fileInput.count();
        if (fileInputCount === 0) {
            throw new Error('Không tìm thấy input file trong composer Threads');
        }
        await fileInput.first().setInputFiles(resolvedImages);
        console.log(`[Threads Post] STEP 5 - Đã upload ảnh vào composer`);
        await activePage.waitForTimeout(3000);

        // STEP 6: Caption - Threads dùng contenteditable div với aria-label
        console.log(`[Threads Post] STEP 6 - Nhập caption...`);
        const captionXPath = "//div[@contenteditable='true' and (@aria-label or @data-lexical-editor)]";
        const captionBox = activePage.locator(captionXPath).first();
        if (await captionBox.count() > 0) {
            await captionBox.click();
            await activePage.waitForTimeout(500);
            // Clear existing content
            await activePage.keyboard.press('Control+a');
            await activePage.keyboard.press('Backspace');
            await activePage.keyboard.type(caption || '', { delay: 25 });
        } else {
            console.log(`[Threads Post] STEP 6 - Không tìm thấy caption box, bỏ qua caption`);
        }
        await activePage.waitForTimeout(1000);

        // STEP 7: Click Post button
        console.log(`[Threads Post] STEP 7 - Click Post...`);
        // Threads có 2 nút "Post": ở composer modal và ở cuối form. Click nút visible cuối cùng.
        const postXPath = "//div[@role='button' and (normalize-space(.)='Post' or normalize-space(.)='Đăng')]";
        const postBtns = activePage.locator(postXPath);
        const postBtnCount = await postBtns.count();
        console.log(`[Threads Post] STEP 7 - Tìm thấy ${postBtnCount} nút Post`);

        let clicked = false;
        for (let i = postBtnCount - 1; i >= 0; i--) {
            const btn = postBtns.nth(i);
            const isVisible = await btn.isVisible().catch(() => false);
            const isEnabled = await btn.isEnabled().catch(() => false);
            if (isVisible && isEnabled) {
                await btn.click();
                clicked = true;
                break;
            }
        }

        if (!clicked) {
            // Fallback: click nút có text "Post" không phải ở nav
            await activePage.locator('button:has-text("Post")').last().click();
        }

        // Đợi Threads xử lý post (3-8 giây)
        await activePage.waitForTimeout(8000);

        const publishedUrl = activePage.url();
        console.log(`[Threads Post] HOÀN THÀNH url=${publishedUrl}`);

        // Đóng page để giải phóng tài nguyên
        try { await activePage.close(); } catch (e) {}

        return {
            success: true,
            publishedUrl,
            message: 'Đăng Threads Post thành công'
        };

    } catch (error) {
        console.error(`[Threads Post] LỖI: ${error.message}`);
        return {
            success: false,
            publishedUrl: '',
            message: `Threads Post: ${error.message}`
        };
    }
}

/**
 * Mở composer Threads - tìm và click nút mở composer
 */
async function openComposer(page) {
    // Thử các selector phổ biến cho nút composer Threads
    const selectors = [
        // "What's new?" prompt
        'svg[aria-label="Create"]',
        'a[aria-label="Create"]',
        'div[aria-label="Create"]',
        // Text "What's new?" / "Viết gì đó..."
        'div:text("What\'s new?")',
        'div:text("Bạn đang nghĩ gì?")',
        // Mobile: bottom nav
        'a[href*="/post"]',
    ];

    for (const sel of selectors) {
        try {
            const locator = page.locator(sel).first();
            if (await locator.count() > 0) {
                const visible = await locator.isVisible().catch(() => false);
                if (visible) {
                    console.log(`[Threads Post] Click composer via selector: ${sel}`);
                    await locator.click();
                    return true;
                }
            }
        } catch (e) {
            // continue
        }
    }
    return false;
}

module.exports = { postImagesToThreads, uploadVideoToThreads };

/**
 * Upload 1 video + caption lên Threads feed (Threads hỗ trợ video dạng Reels tối đa 5 phút)
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.accountName
 * @param {string} [opts.accountType='Personal']
 * @param {string} opts.videoPath - đường dẫn video local
 * @param {string} [opts.caption='']
 * @param {boolean} [opts.headless=false]
 * @param {string} [opts.existingSessionDir='']
 * @returns {Promise<{success: boolean, publishedUrl: string, message: string}>}
 */
async function uploadVideoToThreads({ userId, accountName, accountType = 'Personal', videoPath, caption = '', title = '', headless = false, existingSessionDir = '' }) {
    console.log(`[Threads Reels] ===== BẮT ĐẦU =====`);
    console.log(`[Threads Reels] STEP 0 - account=${accountName} video=${videoPath} title=${(title || '').substring(0, 50)}... caption=${(caption || '').substring(0, 50)}...`);

    if (!userId || !accountName) throw new Error('Thiếu userId hoặc accountName');
    if (!videoPath) throw new Error('Thiếu videoPath cho Threads Reels');

    const resolvedVideo = resolveFilePath(videoPath);
    if (!resolvedVideo || !fs.existsSync(resolvedVideo)) {
        throw new Error(`Không tìm thấy file video: ${videoPath}`);
    }
    console.log(`[Threads Reels] STEP 1 - resolved video=${resolvedVideo}`);

    // Validate duration: Threads tối đa 5 phút
    await assertThreadsVideoDuration(videoPath);

    // title: lấy từ frontend (giống Post/PI) - optional cho Threads
    // caption: lấy từ frontend - nội dung
    // Threads composer chỉ có 1 ô contenteditable → gộp: title (dòng 1) + 2 dòng + caption
    const composerText = String(title || '').trim() + (caption ? '\n\n' + String(caption).trim() : '');

    try {
        console.log(`[Threads Reels] STEP 2 - Mở context...`);
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'TH', { headless, existingSessionDir });
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        // Không set viewport - để Chrome dùng kích thước thật
        await page.bringToFront().catch(() => {});

        console.log(`[Threads Reels] STEP 3 - threads.net...`);
        await page.goto('https://www.threads.net/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (page.url().includes('login') || page.url().includes('accounts.threads.com')) {
            throw new Error('Chưa đăng nhập Threads');
        }

        // STEP 4: Mở composer
        console.log(`[Threads Reels] STEP 4 - Mở composer...`);
        const composerOpened = await openComposer(page);
        if (!composerOpened) {
            throw new Error('Không tìm thấy nút mở composer Threads');
        }
        await page.waitForTimeout(2500);

        // STEP 5: Tìm input file video (Threads composer có nhiều input - 1 cho ảnh, 1 cho video)
        console.log(`[Threads Reels] STEP 5 - Upload video...`);
        let activePage = page;
        const allPages = context.pages();
        for (const p of allPages) {
            const fileInputs = await p.locator('input[type="file"]').count().catch(() => 0);
            if (fileInputs > 0) {
                activePage = p;
                break;
            }
        }

        // Threads: input file đầu tiên accept cả image và video. Upload trực tiếp video file.
        const fileInputs = activePage.locator('input[type="file"]');
        const fileInputCount = await fileInputs.count();
        if (fileInputCount === 0) {
            throw new Error('Không tìm thấy input file trong composer Threads');
        }

        // Tìm input chấp nhận video (accept bao gồm "video" hoặc không có accept cụ thể)
        let videoInput = null;
        for (let i = 0; i < fileInputCount; i++) {
            const input = fileInputs.nth(i);
            const accept = await input.getAttribute('accept').catch(() => '');
            if (!accept || accept.includes('video') || accept.includes('image')) {
                videoInput = input;
                break;
            }
        }
        if (!videoInput) videoInput = fileInputs.first();

        await videoInput.setInputFiles([resolvedVideo]);
        console.log(`[Threads Reels] STEP 5 - Video đã upload, đợi xử lý...`);
        await activePage.waitForTimeout(8000); // Video cần thời gian xử lý lâu hơn ảnh

        // STEP 6: Title + Caption
        // Threads composer chỉ có 1 ô contenteditable - gộp: title (dòng 1) + 2 dòng + caption
        console.log(`[Threads Reels] STEP 6 - Nhập title + caption...`);
        const captionXPath = "//div[@contenteditable='true' and (@aria-label or @data-lexical-editor)]";
        const captionBox = activePage.locator(captionXPath).first();
        if (await captionBox.count() > 0) {
            await captionBox.click();
            await activePage.waitForTimeout(500);
            await activePage.keyboard.press('Control+a');
            await activePage.keyboard.press('Backspace');
            await activePage.keyboard.type(composerText, { delay: 25 });
        } else {
            console.log(`[Threads Reels] STEP 6 - Không tìm thấy caption box`);
        }
        await activePage.waitForTimeout(1000);

        // STEP 7: Click Post
        console.log(`[Threads Reels] STEP 7 - Click Post...`);
        const postXPath = "//div[@role='button' and (normalize-space(.)='Post' or normalize-space(.)='Đăng')]";
        const postBtns = activePage.locator(postXPath);
        const postBtnCount = await postBtns.count();
        console.log(`[Threads Reels] STEP 7 - Tìm thấy ${postBtnCount} nút Post`);

        let clicked = false;
        for (let i = postBtnCount - 1; i >= 0; i--) {
            const btn = postBtns.nth(i);
            const isVisible = await btn.isVisible().catch(() => false);
            const isEnabled = await btn.isEnabled().catch(() => false);
            if (isVisible && isEnabled) {
                await btn.click();
                clicked = true;
                break;
            }
        }

        if (!clicked) {
            await activePage.locator('button:has-text("Post")').last().click();
        }

        // Đợi Threads xử lý video (lâu hơn ảnh)
        await activePage.waitForTimeout(12000);

        const publishedUrl = activePage.url();
        console.log(`[Threads Reels] HOÀN THÀNH url=${publishedUrl}`);

        try { await activePage.close(); } catch (e) {}

        return {
            success: true,
            publishedUrl,
            message: 'Đăng Threads Reels thành công'
        };

    } catch (error) {
        console.error(`[Threads Reels] LỖI: ${error.message}`);
        return {
            success: false,
            publishedUrl: '',
            message: `Threads Reels: ${error.message}`
        };
    }
}
