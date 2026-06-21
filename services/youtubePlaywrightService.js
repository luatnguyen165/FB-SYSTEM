// services/youtubePlaywrightService.js
// Upload YouTube Shorts qua YouTube Studio UI
// Flow YASGU-style (theo https://github.com/hankerspace/YASGU):
//   1. goto youtube.com/upload
//   2. Upload qua ytcp-uploads-file-picker > input[type="file"]
//   3. Nhập title/description bằng #textbox
//   4. Chọn "Không dành cho trẻ em" bằng [name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]
//   5. Click "Tiếp" bằng #next-button × 3
//   6. Chọn Public (radio[2])
//   7. Click "Done" bằng #done-button
//   8. Lấy URL video mới nhất từ studio/.../videos/short

const fs = require('fs');
const path = require('path');
const { getOrOpenSocialContext } = require('./socialPlaywrightService');

/**
 * Resolve local file path
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
 * Validate duration YouTube Shorts: tối đa 60 giây
 */
function assertYouTubeShortDuration(videoPath) {
    return new Promise((resolve) => {
        if (!videoPath || !fs.existsSync(videoPath)) return resolve(0);
        try {
            const ffmpeg = require('fluent-ffmpeg');
            ffmpeg.ffprobe(videoPath, (err, data) => {
                if (err || !data?.format?.duration) return resolve(0);
                const duration = Number(data.format.duration);
                if (duration > 0 && duration > 60) {
                    throw new Error(
                        `YouTube Shorts chỉ hỗ trợ video tối đa 60 giây. Video này dài ${Math.round(duration)} giây.`
                    );
                }
                resolve(duration);
            });
        } catch (e) {
            if (e.message.includes('YouTube Shorts')) throw e;
            resolve(0);
        }
    });
}

/**
 * Build URL YouTube Shorts từ video ID
 */
function buildYoutubeShortUrl(videoId) {
    return `https://www.youtube.com/shorts/${videoId}`;
}

/**
 * Upload 1 video lên YouTube Shorts
 * Flow: áp dụng pattern YASGU (Selenium) → Playwright
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.accountName
 * @param {string} [opts.accountType='Personal']
 * @param {string} opts.videoPath
 * @param {string} [opts.title='']
 * @param {string} [opts.caption='']
 * @param {string} [opts.tags='']
 * @param {boolean} [opts.headless=false]
 * @param {string} [opts.existingSessionDir='']
 * @returns {Promise<{success: boolean, publishedUrl: string, message: string}>}
 */
async function uploadVideoToYouTubeShort({ userId, accountName, accountType = 'Personal', videoPath, title = '', caption = '', tags = '', headless = false, existingSessionDir = '' }) {
    console.log(`[YouTube Short] ===== BẮT ĐẦU (YASGU-style) =====`);
    console.log(`[YouTube Short] STEP 0 - account=${accountName} video=${videoPath} title=${(title || '').substring(0, 50)}... caption=${(caption || '').substring(0, 50)}...`);

    if (!userId || !accountName) throw new Error('Thiếu userId hoặc accountName');
    if (!videoPath) throw new Error('Thiếu videoPath cho YouTube Shorts');

    const resolvedVideo = resolveFilePath(videoPath);
    if (!resolvedVideo || !fs.existsSync(resolvedVideo)) {
        throw new Error(`Không tìm thấy file video: ${videoPath}`);
    }
    console.log(`[YouTube Short] STEP 0 - resolved video=${resolvedVideo}`);

    // Validate duration: YouTube Shorts tối đa 60 giây
    await assertYouTubeShortDuration(resolvedVideo);

    let activePage = null;

    try {
        console.log(`[YouTube Short] STEP 0 - Mở context...`);
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'YT', { headless, existingSessionDir });
        const pages = context.pages();
        let page = pages.length > 0 ? pages[0] : await context.newPage();
        activePage = page;
        await page.bringToFront().catch(() => {});

        // ============================================================
        // FLOW YASGU-STYLE (đơn giản & chắc chắn):
        //   1. goto youtube.com/upload thẳng (bypass UI flow dài)
        //   2. Upload qua ytcp-uploads-file-picker > input (selector chính xác từ YASGU)
        //   3. Nhập title/description bằng ID="textbox" (YASGU dùng contenteditable#textbox)
        //   4. Chọn "Không dành cho trẻ em" bằng name="VIDEO_MADE_FOR_KIDS_NOT_MFK"
        //   5. Click "Tiếp" bằng ID="next-button" (YASGU dùng cứng ID)
        //   6. Chọn Public (radio thứ 3 trong nhóm)
        //   7. Click "Done" bằng ID="done-button"
        //   8. Fallback: lấy URL video mới nhất từ studio/.../videos/short
        // ============================================================

        // STEP 1: Mở thẳng youtube.com/upload (giống YASGU)
        console.log(`[YouTube Short] STEP 1 - Mở youtube.com/upload...`);
        await page.goto('https://www.youtube.com/upload', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await page.waitForTimeout(5000);

        if (page.url().includes('accounts.google.com') || page.url().includes('signin')) {
            throw new Error('Chưa đăng nhập YouTube');
        }
        console.log(`[YouTube Short] STEP 1 - OK → URL: ${page.url()}`);

        // Upload page (sau khi goto) — dùng page này cho các bước tiếp theo
        const uploadPage = page;
        page = uploadPage;
        activePage = uploadPage;

        // STEP 2: Upload video bằng selector chính xác từ YASGU
        // YASGU: FILE_PICKER_TAG = "ytcp-uploads-file-picker"; file_input = file_picker.find_element(TAG_NAME="input")
        console.log(`[YouTube Short] STEP 2 - Upload video qua ytcp-uploads-file-picker...`);

        const waitForFilePicker = async (timeoutMs = 30000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                // Selector chính xác từ YASGU
                const picker = uploadPage.locator('ytcp-uploads-file-picker').first();
                if (await picker.count() > 0) {
                    return picker;
                }
                // Fallback: bất kỳ input[type="file"] nào
                const fallbackInput = uploadPage.locator('input[type="file"]').first();
                if (await fallbackInput.count() > 0) {
                    return fallbackInput;
                }
                await uploadPage.waitForTimeout(1000);
            }
            return null;
        };

        const filePicker = await waitForFilePicker(30000);
        if (!filePicker) {
            throw new Error('Không tìm thấy ytcp-uploads-file-picker hoặc input[type="file"] sau 30s');
        }
        console.log(`[YouTube Short] STEP 2 - OK Đã tìm thấy file picker`);

        // Lấy input[type="file"] trong picker (giống YASGU: file_picker.find_element(TAG_NAME="input"))
        const fileInput = filePicker.locator('input[type="file"]').first();
        await fileInput.setInputFiles([resolvedVideo], { timeout: 60000 });
        console.log(`[YouTube Short] STEP 2 - OK Video đã chọn, đợi xử lý...`);
        await uploadPage.waitForTimeout(20000); // Video cần thời gian upload + xử lý

        // STEP 3: Nhập title — YASGU dùng ID="textbox"
        // textbox là contenteditable có thể có nhiều (title + description) → textboxes[0] = title
        console.log(`[YouTube Short] STEP 3 - Nhập title...`);
        const titleText = String(title || '').trim();
        if (!titleText) {
            throw new Error('YouTube Shorts yêu cầu phải có tiêu đề video');
        }
        await uploadPage.waitForTimeout(3000);
        const textboxes = uploadPage.locator('#textbox');
        const textboxCount = await textboxes.count();
        console.log(`[YouTube Short] STEP 3 - Tìm thấy ${textboxCount} textbox(es)`);
        if (textboxCount > 0) {
            const titleBox = textboxes.first();
            await titleBox.click({ force: true }).catch(() => {});
            await uploadPage.waitForTimeout(500);
            await uploadPage.keyboard.press('Control+a');
            await uploadPage.keyboard.press('Delete');
            await uploadPage.waitForTimeout(200);
            await uploadPage.keyboard.type(titleText, { delay: 15 });
            await uploadPage.waitForTimeout(500);
            const titleVal = await titleBox.textContent().catch(() => '');
            console.log(`[YouTube Short] STEP 3 - ✓ Title: "${(titleVal || '').substring(0, 80)}" (${titleVal?.length || 0} chars)`);
        } else {
            throw new Error('Không tìm thấy #textbox (contenteditable) cho title');
        }

        // STEP 4: Nhập description — YASGU dùng textboxes[-1]
        console.log(`[YouTube Short] STEP 4 - Nhập description...`);
        const descText = String(caption || '').trim();
        if (descText) {
            try {
                await uploadPage.waitForTimeout(2000);
                const descBox = textboxes.last();
                await descBox.click({ force: true }).catch(() => {});
                await uploadPage.waitForTimeout(500);
                await uploadPage.keyboard.press('Control+a');
                await uploadPage.keyboard.press('Delete');
                await uploadPage.waitForTimeout(200);
                await uploadPage.keyboard.type(descText, { delay: 15 });
                await uploadPage.waitForTimeout(500);
                const descVal = await descBox.textContent().catch(() => '');
                console.log(`[YouTube Short] STEP 4 - ✓ Description: "${(descVal || '').substring(0, 80)}..." (${descVal?.length || 0} chars)`);
            } catch (e) {
                console.log(`[YouTube Short] STEP 4 - Lỗi description (bỏ qua): ${e.message}`);
            }
        }
        await uploadPage.waitForTimeout(1000);

        // STEP 5: Chọn "Không dành cho trẻ em" — YASGU dùng NAME="VIDEO_MADE_FOR_KIDS_NOT_MFK"
        console.log(`[YouTube Short] STEP 5 - Chọn "Không dành cho trẻ em"...`);
        try {
            // Selector chính xác từ YASGU
            const notForKidsCheckbox = uploadPage.locator('[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').first();
            if (await notForKidsCheckbox.count() > 0) {
                await notForKidsCheckbox.click({ force: true }).catch(() => {});
                await uploadPage.waitForTimeout(500);
                console.log(`[YouTube Short] STEP 5 - OK Đã chọn "Không dành cho trẻ em" (YASGU selector)`);
            } else {
                // Fallback: tìm theo text
                const radioFallback = uploadPage.locator(
                    'tp-yt-paper-radio-button:has(#radioLabel:has-text("Không, nội dung này không dành cho trẻ em"))'
                ).first();
                if (await radioFallback.count() > 0) {
                    await radioFallback.click({ force: true }).catch(() => {});
                    console.log(`[YouTube Short] STEP 5 - OK Đã chọn (text fallback)`);
                } else {
                    console.log(`[YouTube Short] STEP 5 - Không thấy radio, có thể đã chọn sẵn`);
                }
            }
        } catch (e) {
            console.log(`[YouTube Short] STEP 5 - Lỗi: ${e.message}`);
        }
        await uploadPage.waitForTimeout(500);

        // STEP 6: Click "Tiếp" 3 lần — YASGU dùng ID="next-button"
        console.log(`[YouTube Short] STEP 6 - Click "Tiếp" 3 lần (Details → Video elements → Checks → Visibility)...`);
        for (let step = 1; step <= 3; step++) {
            const stepName = `STEP 6.${step}`;
            // Selector chính xác từ YASGU: ID="next-button"
            let nextBtn = uploadPage.locator('#next-button').first();
            if (await nextBtn.count() === 0) {
                // Fallback: tìm theo text
                nextBtn = uploadPage.locator(
                    'ytcp-button-shape button:has-text("Tiếp"), ' +
                    'ytcp-button-shape button:has-text("Next")'
                ).first();
            }
            const maxWait = 60;
            let clicked = false;
            for (let i = 0; i < maxWait; i++) {
                if (await nextBtn.count() > 0) {
                    const visible = await nextBtn.isVisible().catch(() => false);
                    const enabled = !await nextBtn.isDisabled().catch(() => true);
                    if (visible && enabled) {
                        await nextBtn.click().catch(() => {});
                        await uploadPage.waitForTimeout(2500);
                        console.log(`[YouTube Short] ${stepName} - OK Đã click "Tiếp" lần ${step}/3 → URL: ${uploadPage.url()}`);
                        clicked = true;
                        break;
                    }
                }
                await uploadPage.waitForTimeout(1000);
            }
            if (!clicked) {
                throw new Error(`${stepName} - Không tìm thấy hoặc không click được nút "Tiếp" sau ${maxWait}s`);
            }
        }

        // STEP 7: Chọn "Công khai" (Public) — YASGU dùng radio_button[2].click()
        console.log(`[YouTube Short] STEP 7 - Chọn Visibility = Công khai...`);
        try {
            // Cách 1: YASGU dùng Xpath //*[@id="radioLabel"] → lấy radio thứ 3 (Public)
            const radioLabels = uploadPage.locator('#radioLabel');
            const radioCount = await radioLabels.count();
            console.log(`[YouTube Short] STEP 7 - Tìm thấy ${radioCount} radio labels`);
            if (radioCount >= 3) {
                // YASGU: radio_button[2] = Public (index 2)
                await radioLabels.nth(2).click({ force: true }).catch(() => {});
                await uploadPage.waitForTimeout(800);
                console.log(`[YouTube Short] STEP 7 - OK Đã chọn Public (YASGU style index 2)`);
            } else {
                // Fallback: tìm theo name="PUBLIC"
                const publicRadio = uploadPage.locator('tp-yt-paper-radio-button[name="PUBLIC"]').first();
                if (await publicRadio.count() > 0) {
                    const radioLabel = publicRadio.locator('#radioLabel').first();
                    if (await radioLabel.count() > 0) {
                        await radioLabel.click({ force: true }).catch(() => {});
                    } else {
                        await publicRadio.click({ force: true }).catch(() => {});
                    }
                    await uploadPage.waitForTimeout(800);
                    console.log(`[YouTube Short] STEP 7 - OK Đã chọn Public (name fallback)`);
                }
            }
        } catch (e) {
            console.log(`[YouTube Short] STEP 7 - Lỗi chọn Visibility: ${e.message}`);
        }

        // STEP 8: Click "Done" — YASGU dùng ID="done-button"
        console.log(`[YouTube Short] STEP 8 - Click "Done"...`);
        let doneBtn = uploadPage.locator('#done-button').first();
        if (await doneBtn.count() === 0) {
            // Fallback: tìm theo text
            doneBtn = uploadPage.locator(
                'ytcp-button-shape button:has-text("Done"), ' +
                'ytcp-button-shape button:has-text("Hoàn tất"), ' +
                'ytcp-button-shape button:has-text("Xuất bản"), ' +
                'ytcp-button-shape button:has-text("Publish")'
            ).first();
        }
        let doneClicked = false;
        for (let i = 0; i < 30; i++) {
            if (await doneBtn.count() > 0) {
                const visible = await doneBtn.isVisible().catch(() => false);
                const enabled = !await doneBtn.isDisabled().catch(() => true);
                if (visible && enabled) {
                    await doneBtn.click().catch(() => {});
                    doneClicked = true;
                    console.log(`[YouTube Short] STEP 8 - OK Đã click Done → URL: ${uploadPage.url()}`);
                    break;
                }
            }
            await uploadPage.waitForTimeout(1000);
        }
        if (!doneClicked) {
            throw new Error('Không tìm thấy hoặc không click được nút Done/Publish');
        }

        // STEP 9: Lấy URL video đã đăng — pattern YASGU
        console.log(`[YouTube Short] STEP 9 - Lấy URL video...`);
        let publishedUrl = '';

        // Cách 1: Đợi URL đổi sang /shorts/...
        const waitStart = Date.now();
        while (Date.now() - waitStart < 30000) {
            const url = uploadPage.url();
            if (/\/shorts\/[a-zA-Z0-9_-]+/.test(url)) {
                publishedUrl = url;
                console.log(`[YouTube Short] STEP 9 - ✓ URL từ tab: ${publishedUrl}`);
                break;
            }
            // Đóng dialog "Video đã được xử lý" / "Close dialog"
            const closeBtn = uploadPage.locator(
                'ytcp-button-shape button:has-text("Đóng"), ' +
                'ytcp-button-shape button:has-text("Close"), ' +
                'ytcp-button-shape button:has-text("Hoàn tất"), ' +
                'ytcp-button-shape button:has-text("Done")'
            ).first();
            if (await closeBtn.count() > 0 && await closeBtn.isVisible().catch(() => false)) {
                await closeBtn.click().catch(() => {});
                await uploadPage.waitForTimeout(2000);
            }
            await uploadPage.waitForTimeout(1000);
        }

        // Cách 2 (giống YASGU): navigate sang studio/channel/.../videos/short → lấy video mới nhất
        if (!publishedUrl) {
            console.log(`[YouTube Short] STEP 9 - URL không đổi sang /shorts/, dùng fallback YASGU (navigate videos/short)...`);
            try {
                // Lấy channel ID từ URL hiện tại
                let channelId = '';
                const urlMatch = uploadPage.url().match(/channel\/(UC[a-zA-Z0-9_-]+)/);
                if (urlMatch) {
                    channelId = urlMatch[1];
                } else {
                    // Nếu không có → vào studio.youtube.com để lấy
                    await uploadPage.goto('https://studio.youtube.com', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await uploadPage.waitForTimeout(3000);
                    channelId = uploadPage.url().split('/').filter(p => p.startsWith('UC'))[0] || '';
                }

                if (channelId) {
                    console.log(`[YouTube Short] STEP 9 - Channel ID: ${channelId}, navigate videos/short...`);
                    await uploadPage.goto(`https://studio.youtube.com/channel/${channelId}/videos/short`, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    }).catch(() => {});
                    await uploadPage.waitForTimeout(5000);

                    // YASGU: videos = driver.find_elements(TAG_NAME="ytcp-video-row"); first_video = videos[0]
                    const videoRows = uploadPage.locator('ytcp-video-row');
                    const rowCount = await videoRows.count();
                    console.log(`[YouTube Short] STEP 9 - Tìm thấy ${rowCount} video rows`);
                    if (rowCount > 0) {
                        const firstRow = videoRows.first();
                        const anchorTag = firstRow.locator('a').first();
                        const href = await anchorTag.getAttribute('href').catch(() => '');
                        if (href) {
                            // href có dạng /shorts/VIDEO_ID hoặc /video/VIDEO_ID
                            const shortMatch = href.match(/\/shorts\/([a-zA-Z0-9_-]+)/);
                            if (shortMatch) {
                                publishedUrl = buildYoutubeShortUrl(shortMatch[1]);
                            } else {
                                const videoMatch = href.match(/\/video\/([a-zA-Z0-9_-]+)/) || href.match(/[?&]v=([a-zA-Z0-9_-]+)/);
                                if (videoMatch) {
                                    publishedUrl = `https://www.youtube.com/watch?v=${videoMatch[1]}`;
                                } else {
                                    publishedUrl = href.startsWith('http') ? href : `https://www.youtube.com${href}`;
                                }
                            }
                            console.log(`[YouTube Short] STEP 9 - ✓ URL từ videos/short: ${publishedUrl}`);
                        }
                    }
                }
            } catch (e) {
                console.log(`[YouTube Short] STEP 9 - Lỗi fallback: ${e.message}`);
            }
        }

        // Cách 3: URL hiện tại (last resort)
        if (!publishedUrl) {
            publishedUrl = uploadPage.url();
            console.log(`[YouTube Short] STEP 9 - ⚠ Không lấy được URL, dùng URL hiện tại: ${publishedUrl}`);
        }

        console.log(`[YouTube Short] HOÀN THÀNH url=${publishedUrl}`);

        // Auto close page
        try {
            await uploadPage.close();
            console.log(`[YouTube Short] HOÀN THÀNH - Đã đóng page`);
        } catch (e) {}

        return {
            success: true,
            publishedUrl,
            message: 'Đăng YouTube Short thành công'
        };

    } catch (error) {
        console.error(`[YouTube Short] LỖI: ${error.message}`);
        // Close page kể cả khi fail
        try {
            if (activePage) await activePage.close();
        } catch (e) {}
        return {
            success: false,
            publishedUrl: '',
            message: `YouTube Short: ${error.message}`
        };
    }
}

module.exports = { uploadVideoToYouTubeShort, assertYouTubeShortDuration };
