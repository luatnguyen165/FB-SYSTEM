const fs = require('fs');
const path = require('path');
const { getOrOpenSocialContext, safeCloseBrowser } = require('./socialPlaywrightService');

const IG_MAX_CHARS = 1000;

function sanitizeContentForIG(text) {
    if (!text) return '';
    let s = String(text);
    s = s.replace(/^\s*[-*_]{3,}\s*$/gm, '');
    s = s.replace(/^#{1,6}\s+/gm, '');
    s = s.replace(/\*\*(.+?)\*\*/g, '$1');
    s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
    s = s.replace(/^\s*[*-]\s+/gm, '');
    s = s.replace(/^>\s*/gm, '');
    s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.trim();
    if (s.length > IG_MAX_CHARS) {
        s = s.substring(0, IG_MAX_CHARS - 3).trim() + '...';
        console.log(`[IG] Caption truncated to ${IG_MAX_CHARS} chars`);
    }
    return s;
}

async function saveDebugScreenshot(page, stepName, userId) {
    try {
        const screenshotDir = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'ig-debug');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        const filename = `ig-debug-${userId || 'unknown'}-${stepName}-${Date.now()}.png`;
        await page.screenshot({ path: path.join(screenshotDir, filename), fullPage: true });
        console.log(`[IG] Debug screenshot: ${filename}`);
    } catch (e) {}
}

async function dismissExistingDialogs(page) {
    console.log('[IG] Dismissing dialogs...');
    try {
        const closeButtons = page.locator('div[role="dialog"] svg[aria-label="Close"], div[role="dialog"] button[aria-label="Close"]');
        for (let i = 0; i < await closeButtons.count(); i++) {
            const btn = closeButtons.nth(i);
            if (await btn.isVisible().catch(() => false)) {
                await btn.click().catch(() => {});
                await page.waitForTimeout(1000);
            }
        }
    } catch (_) {}
    try {
        if (await page.locator('div[role="dialog"]').count() > 0) {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000);
        }
    } catch (_) {}
    try {
        const notNowBtns = page.locator('button:has-text("Not Now"), button:has-text("Not now"), button:has-text("Không"), button:has-text("Allow"), button:has-text("Turn On")');
        for (let i = 0; i < await notNowBtns.count(); i++) {
            const btn = notNowBtns.nth(i);
            if (await btn.isVisible().catch(() => false)) {
                await btn.click().catch(() => {});
                await page.waitForTimeout(500);
            }
        }
    } catch (_) {}
    await page.waitForTimeout(1000);
    console.log('[IG] Dialogs dismissed');
}

async function fillCaptionIG(page, text) {
    if (!text) return;

    const captionSelectors = [
        "//div[@role='dialog']//div[@role='textbox'][@aria-label='Write a caption...']",
        "//div[@role='dialog']//div[@role='textbox'][@aria-label='Viết chú thích...']",
        "//div[@role='dialog']//div[@contenteditable='true'][@role='textbox']",
        "//div[@role='textbox'][@aria-label='Write a caption...']",
        "//div[@contenteditable='true'][@role='textbox']",
    ];

    for (let attempt = 1; attempt <= 3; attempt++) {
        let filled = false;
        for (const sel of captionSelectors) {
            try {
                const box = page.locator(`xpath=${sel}`).first();
                if (await box.count() === 0) continue;
                if (!(await box.isVisible().catch(() => false))) continue;

                await box.click();
                await page.waitForTimeout(300);
                try {
                    await box.fill(text);
                } catch (_) {
                    await page.evaluate((txt) => {
                        const el = document.querySelector("[contenteditable='true'][role='textbox']")
                                || document.querySelector("div[contenteditable='true']");
                        if (!el) return;
                        el.focus();
                        document.execCommand('selectAll');
                        document.execCommand('delete');
                        document.execCommand('insertText', false, txt);
                    }, text);
                }
                await page.waitForTimeout(500);
                filled = true;
                console.log(`[IG] Caption filled`);
                break;
            } catch (e) {}
        }
        if (filled) break;
        console.log(`[IG] Caption attempt ${attempt} failed, waiting 3s...`);
        await page.waitForTimeout(3000);
    }
}

function resolveVideoPathToAbsolute(videoPath) {
    if (!videoPath) return '';
    if (path.isAbsolute(videoPath) && /^[A-Za-z]:[/\\]/.test(videoPath)) return videoPath;
    const cleaned = videoPath.replace(/^\/+/, '');
    return path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), cleaned);
}

async function clickCreatePostDropdown(page) {
    const createBtnSelectors = [
        'svg[aria-label="Create"]',
        'svg[aria-label="New post"]',
        'svg[aria-label="Tạo"]',
        'svg[aria-label="Bài viết mới"]',
        'a[href="/create/select/"]',
        'a[href="/create/select"]',
        '[data-testid="new-post-button"]',
    ];

    let clicked = false;
    for (const sel of createBtnSelectors) {
        try {
            const el = page.locator(sel).first();
            if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
                const tagName = await el.evaluate(e => e.tagName.toLowerCase()).catch(() => '');
                if (tagName === 'svg' || tagName === 'img') {
                    const parent = el.locator('xpath=ancestor::a | ancestor::button | ancestor::div[@role="button"]').first();
                    if (await parent.count() > 0 && await parent.isVisible().catch(() => false)) {
                        await parent.click();
                    } else {
                        await el.click();
                    }
                } else {
                    await el.click();
                }
                clicked = true;
                console.log(`[IG] Create button clicked: ${sel}`);
                break;
            }
        } catch (_) {}
    }

    if (!clicked) {
        throw new Error('Không tìm thấy nút Create/New post trên Instagram');
    }

    await page.waitForTimeout(2000);

    const modalAppear = await page.locator('div[role="dialog"]').count().catch(() => 0);
    if (modalAppear > 0) {
        const modalText = await page.locator('div[role="dialog"]').first().textContent().catch(() => '');
        if (/select|from computer|chọn|từ máy tính|drag|drop|kéo|thả/i.test(modalText)) {
            console.log('[IG] Create modal appeared');
            return;
        }
    }

    const postTextSelectors = [
        ':text-is("Post")',
        ':text-is("Bài viết")',
        'div[role="menuitem"]:has-text("Post")',
        'div[role="menuitem"]:has-text("Bài viết")',
    ];

    for (const sel of postTextSelectors) {
        try {
            const els = await page.locator(sel).all();
            for (const el of els) {
                const text = (await el.textContent().catch(() => '')).trim();
                const vis = await el.isVisible().catch(() => false);
                if (vis && /^(post|bài viết)$/i.test(text)) {
                    await el.click();
                    console.log(`[IG] Clicked "Post" in dropdown`);
                    break;
                }
            }
            break;
        } catch (_) {}
    }

    await page.waitForSelector('input[type="file"], div[role="dialog"], button:has-text("Select")', { timeout: 10000 }).catch(() => {});
}

async function uploadFileToInstagram(page, context, filePath, { retries = 3, stepLabel = 'Video' } = {}) {
    console.log(`[IG] STEP 5 - Waiting for file input... (timeout 30s)`);
    await page.waitForSelector('input[type="file"]', { timeout: 30000 }).catch(() => console.log(`[IG] STEP 5 - No file input on main page`));

    let activePage = page;
    console.log(`[IG] STEP 5 - Scanning ${context.pages().length} pages for file input...`);
    for (const p of context.pages()) {
        const inputCount = await p.locator('input[type="file"]').count().catch(() => 0);
        const urlShort = p.url().substring(0, 80);
        console.log(`[IG] STEP 5 - Page: ${urlShort} fileInputs=${inputCount}`);
        if (inputCount > 0) {
            await p.bringToFront().catch(() => {});
            activePage = p;
            break;
        }
    }

    const fileToSend = Array.isArray(filePath) ? filePath[0] : filePath;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const fiCount = await activePage.locator('input[type="file"]').count();
            console.log(`[IG] STEP 5 (attempt ${attempt}) - activePage=${activePage.url().substring(0, 60)} fileInputs=${fiCount}`);
            if (fiCount === 0) {
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 3000));
                    for (const p of context.pages()) {
                        const cnt = await p.locator('input[type="file"]').count().catch(() => 0);
                        console.log(`[IG] STEP 5 - Re-scan: ${p.url().substring(0, 60)} fileInputs=${cnt}`);
                        if (cnt > 0) {
                            activePage = p;
                            break;
                        }
                    }
                }
                continue;
            }

            const handle = await activePage.locator('input[type="file"]').first().elementHandle();
            if (handle) {
                await handle.setInputFiles(fileToSend);
                console.log(`[IG] ${stepLabel} uploaded`);
                handle.dispose().catch(() => {});
                await new Promise(r => setTimeout(r, 5000));
                return activePage;
            }

        } catch (e) {
            console.log(`[IG] Upload attempt ${attempt} error: ${e.message}`);
            if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
        }
    }

    throw new Error('Không tìm thấy input file để upload');
}

async function clickNextButton(page, { maxClicks = 2 } = {}) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1500);

    const nextTexts = ['Next', 'Tiếp', 'Continue'];

    for (let clickRound = 1; clickRound <= maxClicks; clickRound++) {
        let clicked = false;

        try {
            const dialog = page.locator('div[role="dialog"]').first();
            if (await dialog.count() > 0) {
                for (const text of nextTexts) {
                    try {
                        const btn = dialog.locator(`div[role="button"]:has-text("${text}"), button:has-text("${text}")`).first();
                        if (await btn.count() === 0) continue;
                        const vis = await btn.isVisible().catch(() => false);
                        const dis = await btn.isDisabled().catch(() => true);
                        if (vis && !dis) {
                            await btn.click();
                            clicked = true;
                            console.log(`[IG] Next clicked (dialog) round ${clickRound}`);
                            await page.waitForTimeout(3000);
                            break;
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}
        if (clicked) continue;

        for (const text of nextTexts) {
            try {
                const btn = page.locator(`[role="button"]:has-text("${text}"), button:has-text("${text}")`).first();
                if (await btn.count() === 0) continue;
                const vis = await btn.isVisible().catch(() => false);
                const dis = await btn.isDisabled().catch(() => true);
                if (vis && !dis) {
                    await btn.click();
                    clicked = true;
                    console.log(`[IG] Next clicked (page) round ${clickRound}`);
                    await page.waitForTimeout(3000);
                    break;
                }
            } catch (_) {}
        }

        if (!clicked) break;
    }
}

async function clickShareButton(page, { retries = 3 } = {}) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);

    const shareTexts = ['Share', 'Chia sẻ', 'Post', 'Đăng'];

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const dialog = page.locator('div[role="dialog"]').first();
            if (await dialog.count() > 0) {
                for (const text of shareTexts) {
                    try {
                        const btns = dialog.locator(`div[role="button"]:has-text("${text}"), button:has-text("${text}")`);
                        for (let i = 0; i < await btns.count().catch(() => 0); i++) {
                            const btn = btns.nth(i);
                            const btnText = (await btn.textContent().catch(() => '')).trim();
                            const vis = await btn.isVisible().catch(() => false);
                            const dis = await btn.isDisabled().catch(() => true);
                            if (vis && !dis && /^(share|chia sẻ|post|đăng)$/i.test(btnText)) {
                                await btn.click({ force: true }).catch(() => btn.click());
                                await page.waitForTimeout(2000);
                                console.log(`[IG] Share clicked`);
                                return true;
                            }
                        }
                    } catch (_) {}
                }
            }
        } catch (_) {}

        for (const text of shareTexts) {
            try {
                const btns = page.locator(`div[role="button"]:has-text("${text}"), button:has-text("${text}")`);
                for (let i = 0; i < await btns.count().catch(() => 0); i++) {
                    const btn = btns.nth(i);
                    const btnText = (await btn.textContent().catch(() => '')).trim();
                    const vis = await btn.isVisible().catch(() => false);
                    const dis = await btn.isDisabled().catch(() => true);
                    if (vis && !dis && /^(share|chia sẻ|post|đăng)$/i.test(btnText)) {
                        await btn.click({ force: true }).catch(() => btn.click());
                        await page.waitForTimeout(2000);
                        console.log(`[IG] Share clicked (page)`);
                        return true;
                    }
                }
            } catch (_) {}
        }

        if (attempt < retries) {
            console.log(`[IG] Share not found, retrying...`);
            await page.waitForTimeout(3000);
        }
    }

    console.log(`[IG] WARNING: Share button not found!`);
    return false;
}

async function waitForIGSuccess(activePage, { maxWaitMs = 180000, regex } = {}) {
    const startTime = Date.now();
    const checkRegex = regex || /reel shared|your reel has been shared|post shared|your post has been shared|đã chia sẻ|chia sẻ thành công/i;
    const delay = (ms) => new Promise(r => setTimeout(r, ms));

    while (Date.now() - startTime < maxWaitMs) {
        await activePage.waitForTimeout(3000).catch(() => delay(3000));
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        let currentUrl = '';
        try { currentUrl = activePage.url(); } catch (_) { break; }

        if (currentUrl.includes('/p/') || currentUrl.includes('/reel/') || currentUrl.includes('/reels/') || currentUrl.includes('/tv/')) {
            console.log(`[IG] SUCCESS (URL) after ${elapsed}s: ${currentUrl}`);
            return currentUrl;
        }

        try {
            const dialog = activePage.locator('div[role="dialog"]').first();
            if (await dialog.count() > 0) {
                const dialogText = await dialog.textContent().catch(() => '');
                if (checkRegex.test(dialogText)) {
                    console.log(`[IG] SUCCESS DIALOG after ${elapsed}s`);

                    let url = '';
                    try {
                        const href = await dialog.locator('a[href*="/reel/"], a[href*="/p/"], a[href*="/tv/"]').first().getAttribute('href').catch(() => '');
                        if (href) url = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
                    } catch (_) {}

                    try {
                        const doneBtn = dialog.locator('div[role="button"]:has-text("Done"), button:has-text("Done"), div[role="button"]:has-text("Xong"), button:has-text("Xong")').first();
                        if (await doneBtn.count() > 0 && await doneBtn.isVisible().catch(() => false)) {
                            await doneBtn.click().catch(() => {});
                            await activePage.waitForTimeout(3000);
                        }
                    } catch (_) {}

                    if (!url) {
                        try {
                            const afterUrl = activePage.url();
                            if (afterUrl.includes('/p/') || afterUrl.includes('/reel/') || afterUrl.includes('/reels/') || afterUrl.includes('/tv/')) {
                                url = afterUrl;
                            }
                        } catch (_) {}
                    }

                    if (!url) {
                        try {
                            const href = await activePage.locator('a[href*="/reel/"], a[href*="/p/"]').first().getAttribute('href').catch(() => '');
                            if (href) url = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
                        } catch (_) {}
                    }

                    return url;
                }
            }
        } catch (_) {}

        console.log(`[IG] Processing... ${elapsed}s/${maxWaitMs / 1000}s`);
    }

    try {
        const finalUrl = activePage.url();
        if (finalUrl.includes('/p/') || finalUrl.includes('/reel/') || finalUrl.includes('/reels/') || finalUrl.includes('/tv/')) {
            return finalUrl;
        }
    } catch (_) {}
    return '';
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: Upload video to Instagram (Reels)
// ═══════════════════════════════════════════════════════════════════════════════
async function uploadVideoToInstagram({ userId, accountName, accountType = 'Personal', videoPath, caption = '', headless = false, existingSessionDir = '' }) {
    console.log(`[IG Upload] ===== START =====`);
    console.log(`[IG Upload] account=${accountName} video=${videoPath} headless=${headless}`);
    if (!userId || !accountName || !videoPath) throw new Error('Thiếu userId, accountName hoặc videoPath');

    const resolved = resolveVideoPathToAbsolute(videoPath);
    if (!fs.existsSync(resolved)) throw new Error(`File không tồn tại: ${resolved}`);
    videoPath = resolved;

    let activePage = null;
    let browserContext = null;
    let chromeProc = null;

    try {
        const result = await getOrOpenSocialContext(userId, accountName, accountType, 'IG', { headless, existingSessionDir });
        browserContext = result.context;
        chromeProc = result.chromeProc;
        const pages = browserContext.pages();
        const page = pages.length > 0 ? pages[0] : await browserContext.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.bringToFront().catch(() => {});

        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        if (page.url().includes('login')) {
            await saveDebugScreenshot(page, 'login-required', userId);
            throw new Error('Chưa đăng nhập Instagram');
        }

        await dismissExistingDialogs(page);
        await page.waitForTimeout(1000);

        console.log(`[IG Upload] STEP 4 - Click Create -> Post...`);
        await clickCreatePostDropdown(page);

        console.log(`[IG Upload] STEP 5 - Upload video...`);
        activePage = await uploadFileToInstagram(page, browserContext, videoPath, { retries: 3, stepLabel: 'Video' });

        console.log(`[IG Upload] STEP 6 - Next...`);
        await clickNextButton(activePage, { maxClicks: 2 });

        console.log(`[IG Upload] STEP 8 - Caption...`);
        await fillCaptionIG(activePage, sanitizeContentForIG(caption));

        console.log(`[IG Upload] STEP 9 - Share...`);
        const shareSuccess = await clickShareButton(activePage, { retries: 3 });

        console.log(`[IG Upload] STEP 10 - Waiting for confirmation...`);
        const publishedUrl = await waitForIGSuccess(activePage, { maxWaitMs: 180000 });

        if (publishedUrl) {
            return { success: true, publishedUrl, message: 'Đăng Instagram Reels thành công' };
        }
        if (shareSuccess) {
            return { success: false, publishedUrl: '', message: 'Instagram: Đã Share nhưng chưa xác nhận video được đăng' };
        }
        return { success: false, publishedUrl: '', message: 'Instagram: Không tìm thấy nút Share' };

    } catch (error) {
        console.error(`[IG Upload] ERROR: ${error.message}`);
        return { success: false, publishedUrl: '', message: `Instagram: ${error.message}` };
    } finally {
        console.log(`[IG Upload] Đóng Chrome...`);
        safeCloseBrowser({ page: activePage, context: browserContext, chromeProc });
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN: Upload images to Instagram (Post)
// ═══════════════════════════════════════════════════════════════════════════════
async function uploadImagesToInstagram({ userId, accountName, accountType = 'Personal', images = [], caption = '', headless = false, existingSessionDir = '' }) {
    console.log(`[IG Post] ===== START =====`);
    console.log(`[IG Post] account=${accountName} images=${images.length} caption=${caption}`);

    if (!images.length) throw new Error('Thiếu ảnh để đăng Instagram');
    if (!accountName) throw new Error('Thiếu tài khoản Instagram');

    const resolvedImages = images.map(img => {
        if (path.isAbsolute(img) && /^[A-Za-z]:[/\\]/.test(img)) return img;
        return path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), img.replace(/^\/+/, ''));
    }).filter(p => {
        const exists = fs.existsSync(p);
        if (!exists) console.log(`[IG Post] Warning: ảnh không tồn tại: ${p}`);
        return exists;
    });

    if (!resolvedImages.length) throw new Error('Không tìm thấy file ảnh nào');

    let activePage = null;
    let browserContext = null;
    let chromeProc = null;

    try {
        const result = await getOrOpenSocialContext(userId, accountName, accountType, 'IG', { headless, existingSessionDir });
        browserContext = result.context;
        chromeProc = result.chromeProc;
        const pages = browserContext.pages();
        const page = pages.length > 0 ? pages[0] : await browserContext.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.bringToFront().catch(() => {});

        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        if (page.url().includes('login')) {
            await saveDebugScreenshot(page, 'login-required', userId);
            throw new Error('Chưa đăng nhập Instagram');
        }

        await dismissExistingDialogs(page);
        await page.waitForTimeout(1000);

        console.log(`[IG Post] STEP 4 - Click Create -> Post...`);
        await clickCreatePostDropdown(page);

        console.log(`[IG Post] STEP 5 - Upload ${resolvedImages.length} images...`);
        activePage = await uploadFileToInstagram(page, browserContext, resolvedImages, { retries: 3, stepLabel: 'Images' });

        console.log(`[IG Post] STEP 6 - Next...`);
        await clickNextButton(activePage, { maxClicks: 2 });

        console.log(`[IG Post] STEP 7 - Caption...`);
        await fillCaptionIG(activePage, sanitizeContentForIG(caption));

        console.log(`[IG Post] STEP 8 - Share...`);
        const shareSuccess = await clickShareButton(activePage, { retries: 3 });

        console.log(`[IG Post] STEP 9 - Waiting for confirmation...`);
        const publishedUrl = await waitForIGSuccess(activePage, {
            maxWaitMs: 90000,
            regex: /post shared|your post has been shared|đã chia sẻ|chia sẻ thành công/i
        });

        if (!publishedUrl) await saveDebugScreenshot(activePage, 'post-failed', userId);

        if (publishedUrl) {
            return { success: true, publishedUrl, message: 'Đăng Instagram Post thành công' };
        }
        if (shareSuccess) {
            return { success: false, publishedUrl: '', message: 'Instagram Post: Đã Share nhưng chưa xác nhận bài đăng' };
        }
        return { success: false, publishedUrl: '', message: 'Instagram Post: Không tìm thấy nút Share' };

    } catch (error) {
        console.error(`[IG Post] ERROR: ${error.message}`);
        return { success: false, publishedUrl: '', message: `Instagram Post: ${error.message}` };
    } finally {
        console.log(`[IG Post] Đóng Chrome...`);
        safeCloseBrowser({ page: activePage, context: browserContext, chromeProc });
    }
}

module.exports = { uploadVideoToInstagram, uploadImagesToInstagram };
