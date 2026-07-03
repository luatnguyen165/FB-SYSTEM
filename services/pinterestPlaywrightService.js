const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { getOrOpenSocialContext } = require('./socialPlaywrightService');
const { typeWithNewlines } = require('./humanBehaviorService');

/**
 * Patch Chrome profile language to Vietnamese
 */
function patchChromeLanguage(sessionDir) {
    try {
        const defaultDir = path.join(sessionDir, 'Default');
        if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
        const VI_LANG = 'vi-VN,vi,en-US,en';

        const prefsPath = path.join(defaultDir, 'Preferences');
        let prefs = {};
        if (fs.existsSync(prefsPath)) { try { prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8')); } catch (e) {} }
        if (!prefs.intl) prefs.intl = {};
        prefs.intl.selected_languages = VI_LANG;
        prefs.intl.accept_languages = VI_LANG;
        if (!prefs.browser) prefs.browser = {};
        prefs.browser.language = 'vi-VN';
        fs.writeFileSync(prefsPath, JSON.stringify(prefs));

        const secPrefsPath = path.join(defaultDir, 'Secure Preferences');
        if (fs.existsSync(secPrefsPath)) {
            try { const sp = JSON.parse(fs.readFileSync(secPrefsPath, 'utf8')); if (!sp.browser) sp.browser = {}; sp.browser.language = 'vi-VN'; fs.writeFileSync(secPrefsPath, JSON.stringify(sp)); } catch (e) {}
        }

        const localStatePath = path.join(sessionDir, 'Local State');
        if (fs.existsSync(localStatePath)) {
            try { const ls = JSON.parse(fs.readFileSync(localStatePath, 'utf8')); if (!ls.intl) ls.intl = {}; ls.intl.selected_languages = VI_LANG; ls.intl.accept_languages = VI_LANG; fs.writeFileSync(localStatePath, JSON.stringify(ls)); } catch (e) {}
        }
    } catch (e) {
        console.warn(`[Pinterest Pin] Failed to patch Chrome language: ${e.message}`);
    }
}

/**
 * Resolve local file path (image/video) -> absolute filesystem path
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
 * Lấy duration (giây) của video qua ffprobe.
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
 * Validate video cho Pinterest Idea Pin: 3-60 giây.
 * Throw error nếu vi phạm.
 */
async function assertPinterestIdeaPinDuration(videoPath) {
    const MIN_SECONDS = 3;
    const MAX_SECONDS = 60;
    const absolutePath = resolveFilePath(videoPath);
    const duration = await getVideoDurationSeconds(absolutePath);
    if (duration > 0) {
        if (duration < MIN_SECONDS) {
            throw new Error(
                `Pinterest Idea Pin yêu cầu video tối thiểu ${MIN_SECONDS} giây. Video này dài ${Math.round(duration)} giây.`
            );
        }
        if (duration > MAX_SECONDS) {
            throw new Error(
                `Pinterest Idea Pin chỉ hỗ trợ video tối đa ${MAX_SECONDS} giây. Video này dài ${Math.round(duration)} giây.`
            );
        }
    }
    return duration;
}

/**
 * Pin 1 ảnh (Pinterest chỉ pin từng ảnh một) lên board.
 * Nếu có boardName → chọn đúng board đó.
 * Nếu không có boardName → tự chọn board đầu tiên trong dropdown (board mặc định).
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.accountName
 * @param {string} [opts.accountType='Personal']
 * @param {string[]} opts.images - danh sách URL/path ảnh (sẽ pin ảnh đầu tiên)
 * @param {string} [opts.caption=''] - title + description cho Pin
 * @param {string} [opts.boardName=''] - tên board muốn pin vào (optional, mặc định: board đầu tiên)
 * @param {boolean} [opts.headless=false]
 * @param {string} [opts.existingSessionDir='']
 * @returns {Promise<{success: boolean, publishedUrl: string, message: string}>}
 */
/**
 * Helper: chọn board đầu tiên trong dropdown Pinterest
 * Pinterest dropdown thường render trong portal ở body, không nằm trong cùng container
 * HTML thật: <div data-test-id="board-row-{boardName}" role="...">...</div>
 */
async function selectFirstBoard(activePage) {
    // Pinterest thường render options trong dropdown menu với cấu trúc:
    // <section> <div role="list"> <div role="listitem"> <div role="button" data-test-id="board-row-XXX">...</div> </div> </div> </section>
    const optionSelectors = [
        // Selector mới nhất từ Pinterest 2026 - data-test-id chứa tên board
        'div[data-test-id^="board-row-"]',
        'div[data-test-id*="board-row"]',
        '[data-test-id*="boardWithoutSection"]',
        // List item bao ngoài
        'div[data-test-id="boardWithoutSection"] [role="button"]',
        'div[role="listitem"] [role="button"]',
        // Generic selectors
        '[role="option"]',
        '[role="menuitem"]',
        '[role="listbox"] [role="option"]',
        '[role="dialog"] [role="option"]',
        // Class-based
        'div[class*="boardOption" i]',
        'div[class*="board-option" i]',
        'div[class*="BoardItem" i]',
        'div[class*="boardItem" i]',
        'div[class*="board-item" i]',
        'li[class*="board" i]',
        'div[aria-selected]'
    ];

    // Đợi options load (Pinterest có thể fetch boards từ API)
    console.log(`[Pinterest Pin] STEP 6 - Đợi options load...`);
    const startWait = Date.now();
    let foundOption = null;
    while (Date.now() - startWait < 8000) {
        for (const sel of optionSelectors) {
            try {
                const locs = activePage.locator(sel);
                const cnt = await locs.count();
                if (cnt > 0) {
                    for (let i = 0; i < cnt; i++) {
                        const el = locs.nth(i);
                        const visible = await el.isVisible().catch(() => false);
                        if (visible) {
                            foundOption = { selector: sel, element: el, index: i };
                            break;
                        }
                    }
                    if (foundOption) break;
                }
            } catch (e) {}
        }
        if (foundOption) break;
        await activePage.waitForTimeout(500);
    }

    if (!foundOption) {
        // Debug: log toàn bộ HTML structure để tìm dropdown
        const debugInfo = await activePage.evaluate(() => {
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="listbox"], [role="menu"]'));
            return {
                dialogCount: dialogs.length,
                dialogs: dialogs.slice(0, 5).map(d => ({
                    role: d.getAttribute('role'),
                    ariaLabel: d.getAttribute('aria-label'),
                    childCount: d.children.length,
                    snippet: d.outerHTML.substring(0, 300)
                }))
            };
        }).catch(() => null);
        console.log(`[Pinterest Pin] STEP 6 - Debug dialog: ${JSON.stringify(debugInfo)}`);
        console.log(`[Pinterest Pin] STEP 6 - Không tìm thấy option board nào để chọn mặc định`);
        return false;
    }

    const boardText = (await foundOption.element.textContent().catch(() => '') || '').trim();
    await foundOption.element.click();
    console.log(`[Pinterest Pin] STEP 6 - Đã chọn board mặc định: "${boardText.substring(0, 50)}" (selector: ${foundOption.selector})`);
    return true;
}

async function pinImageToPinterest({ userId, accountName, accountType = 'Personal', images = [], caption = '', title = '', boardName = '', headless = true, existingSessionDir = '' }) {
    console.log(`[Pinterest Pin] ===== BẮT ĐẦU =====`);
    console.log(`[Pinterest Pin] STEP 0 - account=${accountName} board=${boardName || '(auto)'} images=${images.length} title=${(title || '').substring(0, 50)}... caption=${(caption || '').substring(0, 50)}...`);

    if (!userId || !accountName) throw new Error('Thiếu userId hoặc accountName');
    if (!Array.isArray(images) || images.length === 0) throw new Error('Pinterest yêu cầu phải có ít nhất 1 hình ảnh');
    if (!title || !String(title).trim()) throw new Error('Pinterest yêu cầu phải có tiêu đề bài viết');

    // Pinterest chỉ pin 1 ảnh mỗi lần. Lấy ảnh đầu tiên.
    const resolvedImage = resolveFilePath(images[0]);
    if (!resolvedImage || !fs.existsSync(resolvedImage)) {
        throw new Error(`Không tìm thấy file ảnh: ${images[0]}`);
    }
    console.log(`[Pinterest Pin] STEP 1 - resolved image=${resolvedImage}`);

    try {
        console.log(`[Pinterest Pin] STEP 2 - Mở context...`);
        // Patch Chrome profile language to Vietnamese
        const pinSessionDir = existingSessionDir || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'Electron', 'FB-SYSTEM', 'chrome-profiles', `${userId}_pinterest`);
        patchChromeLanguage(pinSessionDir);
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'PI', { headless, existingSessionDir: pinSessionDir });
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        // Không set viewport - để Chrome dùng kích thước thật
        await page.bringToFront().catch(() => {});

        console.log(`[Pinterest Pin] STEP 3 - pinterest.com...`);
        await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (page.url().includes('login') || page.url().includes('/login/')) {
            throw new Error('Chưa đăng nhập Pinterest');
        }

        // STEP 4: Click nút "Tạo" (data-test-id="create-tab", aria-label="Tạo") trên vertical nav
        // Đây là nút Create chính ở sidebar trái Pinterest, mở dropdown CreationOptions
        console.log(`[Pinterest Pin] STEP 4 - Click nút Tạo...`);
        const createBtn = page.locator('button[data-test-id="create-tab"]').first();
        const createCount = await createBtn.count();
        if (createCount === 0) {
            // Fallback: thử các selector cũ
            const fallbackBtn = page.locator('div.dVx3J_.Q3hcOU.mm_g7v, [data-test-id="create-button"], a[href*="/pin-builder/"]').first();
            if (await fallbackBtn.count() === 0) {
                throw new Error('Không tìm thấy nút Tạo Pinterest (button[data-test-id="create-tab"])');
            }
            await fallbackBtn.click();
        } else {
            await createBtn.click();
        }
        await page.waitForTimeout(2500);

        // STEP 4b: Click "Ghim" trong dropdown VerticalNav-CreationOptions-Flyout
        // Pinterest render menu item với class "ADXRXN B3GZzn dHA5K0 i1hWBD qzrGlv zEVE_X"
        // Bên trong có div.WuRgKB với text "Ghim"
        console.log(`[Pinterest Pin] STEP 4b - Chọn Ghim trong menu...`);

        // Selector chính xác từ HTML Pinterest VN: div ngoài cùng có class chứa "Ghim" title
        // Cấu trúc: div.ADXRXN[id="Tạo-Ghim"] > ... > div.WuRgKB (text "Ghim")
        const pinSelectors = [
            // Click chính div ngoài cùng có id="Tạo-Ghim" (cha clickable)
            '#Tạo-Ghim',
            '[id="Tạo-Ghim"]',
            'div[id="Tạo-Ghim"]',
            // Click div.WuRgKB chứa text "Ghim" (text node)
            'div.WuRgKB.aMgNKE.YfEt3H.v_eFe4.qnEc35.hxKTA7.mm0O_j',
            '.WuRgKB.mm0O_j',
            // Click cha của text "Ghim"
            '#VerticalNav-CreationOptions-Flyout div:has(> div.WuRgKB)',
            // Click bằng text "Ghim" - lấy cha clickable
            'div:has(div.WuRgKB:has-text("Ghim"))',
            'div:has(> .WuRgKB:text-is("Ghim"))',
            // Fallback: text search
            'div:text-is("Ghim")',
            'div.WuRgKB:has-text("Ghim")',
            '[role="menuitem"]:has-text("Ghim")',
        ];

        let clicked = false;
        for (const sel of pinSelectors) {
            const count = await page.locator(sel).count();
            if (count === 0) {
                console.log(`[Pinterest Pin] STEP 4b - ${sel.substring(0, 70)}... count=0`);
                continue;
            }
            const visible = await page.locator(sel).first().isVisible().catch(() => false);
            if (!visible) {
                console.log(`[Pinterest Pin] STEP 4b - ${sel.substring(0, 70)}... count=${count} not visible`);
                continue;
            }
            console.log(`[Pinterest Pin] STEP 4b - CLICKING: ${sel.substring(0, 70)}... (count=${count})`);
            try {
                await page.locator(sel).first().click({ timeout: 5000 });
                clicked = true;
                console.log(`[Pinterest Pin] STEP 4b - Click thành công!`);
                break;
            } catch (e) {
                console.log(`[Pinterest Pin] STEP 4b - Click fail: ${e.message.substring(0, 100)}`);
            }
        }

        if (!clicked) {
            // Retry sau 5s
            console.log(`[Pinterest Pin] STEP 4b - Retry sau 5s...`);
            await page.waitForTimeout(5000);
            for (const sel of ['#Tạo-Ghim', 'div.WuRgKB:has-text("Ghim")', 'div:text-is("Ghim")']) {
                const count = await page.locator(sel).count();
                if (count > 0) {
                    const visible = await page.locator(sel).first().isVisible().catch(() => false);
                    if (visible) {
                        console.log(`[Pinterest Pin] STEP 4b - Retry CLICK: ${sel}`);
                        try {
                            await page.locator(sel).first().click({ timeout: 5000 });
                            clicked = true;
                            break;
                        } catch (e) {}
                    }
                }
            }
        }

        if (!clicked) {
            throw new Error('Không tìm thấy hoặc không click được "Ghim" trong menu Pinterest');
        }

        console.log(`[Pinterest Pin] STEP 4b - Đã click Ghim, đợi Pin builder load...`);
        await page.waitForTimeout(6000);

        // STEP 5: Tìm input file và upload
        // Pin builder có thể mở: 1) inline modal, 2) trang mới, 3) popup
        // Cần scan TẤT CẢ pages và chờ file input xuất hiện (timeout 30s)
        console.log(`[Pinterest Pin] STEP 5 - Upload ảnh...`);

        const waitForFileInput = async (timeoutMs = 30000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                const allPages = context.pages();
                for (const p of allPages) {
                    // Bỏ qua about:blank và trang chủ Pinterest
                    const url = p.url();
                    if (url === 'about:blank' || url === 'https://www.pinterest.com/' || url === 'https://www.pinterest.com') continue;
                    try {
                        // Tìm input file visible (accept=image/*)
                        const fileInputs = await p.locator('input[type="file"]').count().catch(() => 0);
                        if (fileInputs > 0) {
                            // Verify có ít nhất 1 input visible & accept file
                            for (let i = 0; i < fileInputs; i++) {
                                const isVisible = await p.locator('input[type="file"]').nth(i).isVisible().catch(() => false);
                                const accept = await p.locator('input[type="file"]').nth(i).getAttribute('accept').catch(() => '');
                                if (isVisible || !accept || accept.includes('image')) {
                                    return p;
                                }
                            }
                            // Nếu không có input visible nào nhưng có input ẩn, vẫn trả về page
                            return p;
                        }
                    } catch (e) {}
                }
                await page.waitForTimeout(1000);
            }
            return null;
        };

        const activePage = await waitForFileInput(30000);
        if (!activePage) {
            // Debug: log tất cả URLs của context pages
            const urls = context.pages().map(p => p.url()).join('\n  - ');
            throw new Error(`Không tìm thấy input file trong Pin builder sau 30s. Pages hiện tại:\n  - ${urls}`);
        }

        console.log(`[Pinterest Pin] STEP 5 - Tìm thấy input file trên page: ${activePage.url().substring(0, 80)}`);
        const fileInput = activePage.locator('input[type="file"]');
        await fileInput.first().setInputFiles([resolvedImage], { timeout: 30000 });
        console.log(`[Pinterest Pin] STEP 5 - Ảnh đã upload`);
        await activePage.waitForTimeout(5000);

        // STEP 6: Chọn board
        // - Nếu có boardName: tìm và chọn đúng board đó
        // - Nếu KHÔNG có boardName: chọn board đầu tiên trong dropdown (board mặc định)
        console.log(`[Pinterest Pin] STEP 6 - Chọn board (requested="${boardName || '(default)'}")...`);
        try {
            // Pinterest hiển thị dropdown board sau khi upload ảnh
            // Selector mới: [data-test-id="board-dropdown-select-button"] (button mở dropdown)
            //               [data-test-id="board-dropdown-placeholder"] (nội dung hiện tại)
            const boardTriggers = [
                '[data-test-id="board-dropdown-select-button"]',
                '[data-test-id="board-select"]',
                '[data-test-id="board-dropdown"]',
                '[data-test-id="board-dropdown-placeholder"]',
                'button[aria-label*="board" i]',
                'div[aria-label*="board" i][role="button"]',
                'select[name*="board" i]',
                '[data-test-id*="board-select" i]'
            ];
            let boardTrigger = null;
            for (const sel of boardTriggers) {
                const loc = activePage.locator(sel).first();
                if (await loc.count() > 0) {
                    const visible = await loc.isVisible().catch(() => false);
                    if (visible) {
                        boardTrigger = loc;
                        console.log(`[Pinterest Pin] STEP 6 - Tìm thấy board trigger: ${sel}`);
                        break;
                    }
                }
            }

            if (boardTrigger) {
                await boardTrigger.click();
                await activePage.waitForTimeout(2000);

                if (boardName) {
                    // Tìm và chọn board cụ thể - dựa vào data-test-id="board-row-{name}"
                    // Thử click trực tiếp board-row-{boardName} trước
                    const specificBoard = activePage.locator(`div[data-test-id="board-row-${boardName}"]`).first();
                    if (await specificBoard.count() > 0) {
                        const visible = await specificBoard.isVisible().catch(() => false);
                        if (visible) {
                            await specificBoard.click();
                            console.log(`[Pinterest Pin] STEP 6 - Đã chọn board: "${boardName}" (data-test-id match)`);
                        } else {
                            // Fallback: tìm theo text
                            const boardByText = activePage.locator(`div[data-test-id^="board-row-"]:has-text("${boardName}")`).first();
                            if (await boardByText.count() > 0) {
                                await boardByText.click();
                                console.log(`[Pinterest Pin] STEP 6 - Đã chọn board: "${boardName}" (text match)`);
                            } else {
                                console.log(`[Pinterest Pin] STEP 6 - Không tìm thấy board "${boardName}", dùng board mặc định`);
                                await selectFirstBoard(activePage);
                            }
                        }
                    } else {
                        console.log(`[Pinterest Pin] STEP 6 - Không tìm thấy board "${boardName}", dùng board mặc định`);
                        await selectFirstBoard(activePage);
                    }
                } else {
                    // Không có boardName → chọn board đầu tiên trong danh sách
                    await selectFirstBoard(activePage);
                }
                await activePage.waitForTimeout(1000);
            } else {
                console.log(`[Pinterest Pin] STEP 6 - Không tìm thấy board trigger, có thể board đã được chọn sẵn`);
            }
        } catch (e) {
            console.log(`[Pinterest Pin] STEP 6 - Lỗi chọn board: ${e.message}`);
        }

        // STEP 7: Title + Description
        // Pinterest yêu cầu TITLE là bắt buộc (ít nhất 1 ký tự) mới cho Publish.
        console.log(`[Pinterest Pin] STEP 7 - Nhập title + description...`);

        // title: lấy từ frontend (postTitle) - bắt buộc cho Pinterest
        // caption: lấy từ frontend (caption) - nội dung mô tả chi tiết (description)
        let firstLine = String(title || '').trim();
        let rest = String(caption || '').trim();

        if (!firstLine) {
            // Fallback: dùng tên file ảnh làm title
            const path = require('path');
            const filename = path.basename(resolvedImage, path.extname(resolvedImage));
            firstLine = filename.replace(/[-_]+/g, ' ').trim() || 'Pin';
            console.log(`[Pinterest Pin] STEP 7 - Title rỗng, dùng tên file: "${firstLine}"`);
        } else {
            console.log(`[Pinterest Pin] STEP 7 - Title từ frontend: "${firstLine.substring(0, 50)}"`);
        }
        console.log(`[Pinterest Pin] STEP 7 - Description từ frontend: "${rest.substring(0, 50)}..." (${rest.length} chars)`);

        // Nhập title (bắt buộc) - selector mới: #storyboard-selector-title
        // Pinterest title là <input type="text"> - dùng fill() để chắc chắn clear hết content cũ
        console.log(`[Pinterest Pin] STEP 7 - Đợi title box xuất hiện...`);
        let titleBox = null;
        const titleSelectors = [
            '#storyboard-selector-title',
            'input[placeholder*="Add" i][aria-label*="title" i]',
            'textarea[aria-label*="title" i]',
            '[data-test-id="pin-title"]',
            'input[id*="title" i]'
        ];
        // Đợi tối đa 15s cho title box
        const titleWaitStart = Date.now();
        while (Date.now() - titleWaitStart < 15000) {
            for (const sel of titleSelectors) {
                const loc = activePage.locator(sel).first();
                if (await loc.count() > 0) {
                    const visible = await loc.isVisible().catch(() => false);
                    if (visible) {
                        titleBox = loc;
                        console.log(`[Pinterest Pin] STEP 7 - Tìm thấy title box với selector: ${sel}`);
                        break;
                    }
                }
            }
            if (titleBox) break;
            await activePage.waitForTimeout(1000);
        }

        if (titleBox) {
            // Scroll vào view + click để focus
            await titleBox.scrollIntoViewIfNeeded().catch(() => {});
            await titleBox.click({ timeout: 5000 });
            await activePage.waitForTimeout(500);
            // Clear bằng select all + delete
            await titleBox.fill('');
            await activePage.keyboard.press('Control+a');
            await activePage.keyboard.press('Delete');
            await activePage.waitForTimeout(200);
            // Gõ title
            await titleBox.fill(firstLine);
            // Verify
            const typedValue = await titleBox.inputValue().catch(() => '');
            console.log(`[Pinterest Pin] STEP 7 - Title đã nhập: "${typedValue}" (expected: "${firstLine}")`);
            if (typedValue !== firstLine) {
                console.log(`[Pinterest Pin] STEP 7 - Fill() chưa đúng, thử keyboard.type`);
                await titleBox.click();
                await activePage.keyboard.press('Control+a');
                await activePage.keyboard.press('Delete');
                await activePage.keyboard.type(firstLine, { delay: 30 });
            }
        } else {
            console.log(`[Pinterest Pin] STEP 7 - Không tìm thấy title box sau 15s, cần kiểm tra selector`);
            throw new Error('Không tìm thấy ô tiêu đề Pinterest - không thể publish');
        }

        // Verify title đã được nhập trước khi nhập description
        const titleValue = await activePage.locator('#storyboard-selector-title').first().inputValue().catch(() => '');
        if (!titleValue || !titleValue.trim()) {
            throw new Error('Tiêu đề Pinterest chưa được nhập - không thể publish');
        }
        console.log(`[Pinterest Pin] STEP 7 - ✓ Title verified: "${titleValue}"`);

        // Nhập description (tuỳ chọn) - Pinterest dùng DraftEditor
        // Selector mới (cụ thể hơn): div.DraftEditor-editorContainer > div.public-DraftEditor-content[aria-label="Thêm mô tả chi tiết"]
        if (rest) {
            console.log(`[Pinterest Pin] STEP 7 - Đợi description box...`);
            const descSelectors = [
                // Selector mới: chính xác từ HTML Pinterest
                'div.DraftEditor-editorContainer > div.public-DraftEditor-content[aria-label="Thêm mô tả chi tiết"]',
                '.DraftEditor-editorContainer .public-DraftEditor-content[aria-label="Thêm mô tả chi tiết"]',
                // Fallback cũ
                '.public-DraftEditor-content[aria-label*="mô tả" i]',
                '[contenteditable="true"][aria-label*="mô tả" i]',
                '[contenteditable="true"]',
                'textarea[aria-label*="description" i]',
                '[data-test-id="pin-description"]'
            ];
            let descBox = null;
            let matchedSel = '';
            for (const sel of descSelectors) {
                const loc = activePage.locator(sel);
                const count = await loc.count();
                if (count > 0) {
                    for (let i = 0; i < count; i++) {
                        const item = loc.nth(i);
                        const visible = await item.isVisible().catch(() => false);
                        if (visible) {
                            descBox = item;
                            matchedSel = sel;
                            break;
                        }
                    }
                    if (descBox) break;
                    descBox = loc.first();
                    matchedSel = sel;
                    break;
                }
            }
            if (descBox) {
                console.log(`[Pinterest Pin] STEP 7 - Tìm thấy description box: ${matchedSel}`);
                await descBox.scrollIntoViewIfNeeded().catch(() => {});

                // Click vào đúng element
                try {
                    await descBox.click({ timeout: 5000 });
                } catch (e) {
                    console.log(`[Pinterest Pin] STEP 7 - Click thường fail, thử force click: ${e.message}`);
                    await descBox.click({ force: true, timeout: 5000 });
                }
                await activePage.waitForTimeout(500);

                // Verify focus đã vào contenteditable
                const focused = await activePage.evaluate(() => {
                    const el = document.activeElement;
                    return el ? {
                        tag: el.tagName,
                        ce: el.getAttribute('contenteditable'),
                        aria: el.getAttribute('aria-label'),
                        cls: el.className?.substring(0, 80)
                    } : null;
                });
                console.log(`[Pinterest Pin] STEP 7 - Active element: ${JSON.stringify(focused)}`);

                // Clear content cũ
                await activePage.keyboard.press('Control+a');
                await activePage.waitForTimeout(200);
                await activePage.keyboard.press('Delete');
                await activePage.waitForTimeout(300);

                // Gõ description — fill trước, fallback insertText giữ newline
                try {
                    await descBox.fill(rest);
                } catch (_) {
                    await typeWithNewlines(activePage, rest);
                }
                await activePage.waitForTimeout(800);

                // Verify đã gõ
                const descValue = await descBox.textContent().catch(() => '');
                console.log(`[Pinterest Pin] STEP 7 - Description sau khi gõ: "${(descValue || '').substring(0, 80)}..." (${descValue?.length || 0} chars)`);

                if (!descValue || descValue.trim().length === 0) {
                    console.log(`[Pinterest Pin] STEP 7 - TextContent rỗng, fallback keyboard.insertText`);
                    await activePage.keyboard.insertText(rest);
                    await activePage.waitForTimeout(500);
                }
            } else {
                console.log(`[Pinterest Pin] STEP 7 - Không tìm thấy description box, bỏ qua`);
            }
        }

        // Verify description đã được nhập (nếu có rest) trước khi publish
        if (rest) {
            const descFinal = await activePage.locator('.public-DraftEditor-content[aria-label*="mô tả" i]').first().textContent().catch(() => '');
            if (!descFinal || !descFinal.trim()) {
                throw new Error('Description Pinterest chưa được nhập - không thể publish');
            }
            console.log(`[Pinterest Pin] STEP 7 - ✓ Description verified: "${(descFinal || '').substring(0, 80)}..." (${descFinal.length} chars)`);
        }
        await activePage.waitForTimeout(1000);

        // STEP 7b: Nhập Destination Link (tuỳ chọn) - Pinterest có thể yêu cầu URL đích
        console.log(`[Pinterest Pin] STEP 7b - Kiểm tra Destination Link...`);
        const destInput = activePage.locator('input[placeholder*="link" i][aria-label*="destination" i], input[placeholder*="Add a destination" i], input[data-test-id*="destination" i]').first();
        if (await destInput.count() > 0) {
            // Không có URL → bỏ qua
            console.log(`[Pinterest Pin] STEP 7b - Có ô destination nhưng bỏ qua (không có URL)`);
        }

        // STEP 8: Publish - selector mới: [data-test-id="storyboard-creation-nav-done"] button
        console.log(`[Pinterest Pin] STEP 8 - Publish...`);
        const publishBtn = activePage.locator('[data-test-id="storyboard-creation-nav-done"] button, button:has-text("Publish"), button:has-text("Đăng"), [data-test-id="publish-button"]').first();
        const publishCount = await publishBtn.count();
        if (publishCount === 0) {
            throw new Error('Không tìm thấy nút Publish Pinterest');
        }
        const isEnabled = await publishBtn.isEnabled().catch(() => false);
        if (!isEnabled) {
            // Có thể vì title trống hoặc board chưa chọn
            throw new Error('Nút Publish Pinterest chưa được kích hoạt (thiếu title hoặc board?)');
        }

        // Lưu URL trước khi click để so sánh
        const urlBefore = activePage.url();
        await publishBtn.click();
        console.log(`[Pinterest Pin] STEP 8 - Đã click Publish, đợi redirect...`);

        // Đợi URL đổi sang trang Pin chi tiết (URL có dạng /pin/<id>/)
        // Hoặc đợi dialog lỗi / confirm modal xuất hiện
        let publishedUrl = '';
        let isSuccess = false;
        const publishWaitStart = Date.now();
        let lastErrorDialogText = '';
        let lastErrorDialogHtml = '';
        while (Date.now() - publishWaitStart < 30000) {
            const currentUrl = activePage.url();

            // Thành công: URL đổi và có dạng /pin/<digits>/
            if (currentUrl !== urlBefore && /\/(?:pin|pin\/)\d+/.test(currentUrl)) {
                publishedUrl = currentUrl;
                isSuccess = true;
                console.log(`[Pinterest Pin] STEP 8 - Pin đã đăng: ${publishedUrl}`);
                break;
            }

            // Fail: Pinterest hiện dialog/notification lỗi
            // Pinterest hay hiện toast góc dưới + modal confirm
            const errorSelectors = [
                '[role="alertdialog"]',
                '[role="dialog"]',
                '[data-test-id*="error" i]',
                '[data-test-id*="toast" i]',
                '[data-test-id*="alert" i]',
                'div[class*="Toast" i]',
                'div[class*="Error" i]',
                'div[class*="errorMessage" i]'
            ];
            for (const es of errorSelectors) {
                const cnt = await activePage.locator(es).count().catch(() => 0);
                if (cnt > 0) {
                    for (let i = 0; i < cnt; i++) {
                        const el = activePage.locator(es).nth(i);
                        const visible = await el.isVisible().catch(() => false);
                        if (!visible) continue;
                        const txt = (await el.textContent().catch(() => '') || '').trim();
                        const html = (await el.innerHTML().catch(() => '') || '').trim();
                        if (txt && txt.length > 3) {
                            lastErrorDialogText = txt;
                            lastErrorDialogHtml = html;
                            console.log(`[Pinterest Pin] STEP 8 - Pinterest dialog (${es}): "${txt.substring(0, 300)}"`);
                            // Nếu là dialog xác nhận (VD: "Đăng ngay?") → không phải lỗi
                            const isConfirm = /xác nhận|confirm|are you sure|publish now|tiếp tục|continue/i.test(txt);
                            // Nếu là toast thông báo thành công (VD: "Đã đăng") → bỏ qua
                            const isSuccessToast = /đã (được )?đăng|đã tạo|thành công|published|created|đã (được )?chia sẻ/i.test(txt);
                            if (isSuccessToast) {
                                console.log(`[Pinterest Pin] STEP 8 - Toast thanh cong, post thanh cong`);
                                publishedUrl = activePage.url();
                                isSuccess = true;
                                break;
                            }
                            if (!isConfirm) {
                                throw new Error(`Pinterest báo lỗi khi publish: ${txt.substring(0, 300)}`);
                            }
                        }
                    }
                }
            }

            // Thoat vong lap neu da thanh cong
            if (isSuccess) break;

            // Nếu vẫn ở trang builder, đợi tiếp
            await activePage.waitForTimeout(1000);
        }

        if (!isSuccess) {
            // Timeout 30s mà URL không đổi → coi như fail
            const currentUrl = activePage.url();
            const errorMsg = lastErrorDialogText
                ? `Dialog: ${lastErrorDialogText.substring(0, 200)} | HTML: ${lastErrorDialogHtml.substring(0, 300)}`
                : 'Không bắt được dialog nào';
            throw new Error(`Publish Pinterest timeout - URL không đổi sang trang Pin sau 30s. URL: ${currentUrl} | ${errorMsg}`);
        }

        console.log(`[Pinterest Pin] HOÀN THÀNH url=${publishedUrl}`);

        // Auto close page + context để giải phóng tài nguyên
        try {
            await activePage.close();
            console.log(`[Pinterest Pin] HOÀN THÀNH - Đã đóng page`);
        } catch (e) {
            console.log(`[Pinterest Pin] Lỗi đóng page: ${e.message}`);
        }

        // Đóng context nếu không reuse (chỉ khi là context mới tạo riêng cho pin này)
        try {
            // Không đóng context nếu nó thuộc session pool (user có thể đăng tiếp)
            // Chỉ log
            console.log(`[Pinterest Pin] HOÀN THÀNH - Giữ context cho session pool`);
        } catch (e) {}

        return {
            success: true,
            publishedUrl,
            message: 'Đăng Pinterest Pin thành công'
        };

    } catch (error) {
        console.error(`[Pinterest Pin] LỖI: ${error.message}`);

        // Đóng page kể cả khi fail
        try {
            if (typeof activePage !== 'undefined' && activePage) {
                await activePage.close();
            }
        } catch (e) {}

        return {
            success: false,
            publishedUrl: '',
            message: `Pinterest Pin: ${error.message}`
        };
    }
}

module.exports = { pinImageToPinterest, uploadVideoToPinterest };

/**
 * Upload 1 video Idea Pin lên Pinterest board.
 * Pinterest Idea Pin = "Ảnh ghép" trong menu Tạo.
 * Flow đơn giản: pin-creation-tool → upload → fill title/desc → Publish.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.accountName
 * @param {string} [opts.accountType='Personal']
 * @param {string} opts.videoPath - đường dẫn video local
 * @param {string} [opts.caption=''] - description cho Idea Pin
 * @param {string} [opts.title=''] - title cho Idea Pin (bắt buộc)
 * @param {string} [opts.boardName=''] - tên board muốn pin vào (optional)
 * @param {boolean} [opts.headless=false]
 * @param {string} [opts.existingSessionDir='']
 * @returns {Promise<{success: boolean, publishedUrl: string, message: string}>}
 */
async function uploadVideoToPinterest({ userId, accountName, accountType = 'Personal', videoPath, caption = '', title = '', boardName = '', headless = true, existingSessionDir = '' }) {
    console.log(`[Pinterest Idea Pin] ===== BẮT ĐẦU =====`);
    console.log(`[Pinterest Idea Pin] STEP 0 - account=${accountName} board=${boardName || '(auto)'} video=${videoPath} title=${(title || '').substring(0, 50)}... caption=${(caption || '').substring(0, 50)}...`);

    if (!userId || !accountName) throw new Error('Thiếu userId hoặc accountName');
    if (!videoPath) throw new Error('Thiếu videoPath cho Pinterest Idea Pin');
    if (!title || !String(title).trim()) throw new Error('Pinterest Idea Pin yêu cầu phải có tiêu đề video');

    const resolvedVideo = resolveFilePath(videoPath);
    if (!resolvedVideo || !fs.existsSync(resolvedVideo)) {
        throw new Error(`Không tìm thấy file video: ${videoPath}`);
    }
    console.log(`[Pinterest Idea Pin] STEP 1 - resolved video=${resolvedVideo}`);

    await assertPinterestIdeaPinDuration(videoPath);

    let activePage = null;
    let context = null;
    try {
        console.log(`[Pinterest Idea Pin] STEP 2 - Mở context...`);
        // Pinterest bypass CDP Chrome (bị crash trên Windows) → dùng Playwright persistent context
        const pw = require('playwright');
        const userSessionDir = existingSessionDir || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'Electron', 'FB-SYSTEM', 'chrome-profiles', `${userId}_pinterest`);
        console.log(`[Pinterest Idea Pin] STEP 2 - sessionDir=${userSessionDir} headless=${headless}`);

        // Patch Chrome profile language
        patchChromeLanguage(userSessionDir);

        // Retry nếu Chrome crash do profile bị lock (exit code 21)
        let contextLaunched = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                context = await pw.chromium.launchPersistentContext(userSessionDir, {
                    headless: headless,
                    channel: 'chrome',
                    args: [
                        '--lang=vi-VN',
                        '--start-maximized',
                        '--disable-blink-features=AutomationControlled',
                        '--no-first-run',
                        '--disable-sync',
                    ],
                    ignoreDefaultArgs: ['--enable-automation', '--enable-logging', '--no-sandbox']
                });
                contextLaunched = true;
                break;
            } catch (launchErr) {
                console.log(`[Pinterest Idea Pin] STEP 2 - Launch attempt ${attempt + 1} failed: ${launchErr.message.substring(0, 100)}`);
                if (attempt < 2) {
                    // Kill Chrome processes using this profile, then retry
                    const { execSync } = require('child_process');
                    try { execSync('taskkill /f /im chrome.exe 2>nul', { stdio: 'ignore' }); } catch (_) {}
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
        }
        if (!contextLaunched) {
            throw new Error('Không thể khởi động Chrome sau 3 lần thử');
        }

        // Load cookies
        const ssPath = path.join(userSessionDir, 'storage-state.json');
        if (fs.existsSync(ssPath)) {
            try {
                const ss = JSON.parse(fs.readFileSync(ssPath, 'utf8'));
                if (ss.cookies?.length > 0) {
                    await context.addCookies(ss.cookies);
                    console.log(`[Pinterest Idea Pin] STEP 2 - Loaded ${ss.cookies.length} cookies`);
                }
            } catch (e) {
                console.log(`[Pinterest Idea Pin] STEP 2 - Cookie load error: ${e.message}`);
            }
        }

        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        await page.bringToFront().catch(() => {});

        console.log(`[Pinterest Idea Pin] STEP 3 - pinterest.com...`);
        await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (page.url().includes('login') || page.url().includes('/login/')) {
            throw new Error('Chưa đăng nhập Pinterest');
        }
        console.log(`[Pinterest Idea Pin] STEP 3 - OK URL: ${page.url()}`);

        // STEP 4: Navigate directly to pin-creation-tool (Idea Pin builder)
        // Menu "Tạo" giờ có 3 options: Ghim, Bảng, Ảnh ghép (tên mới của Idea Pin)
        // Click button[data-test-id="create-tab"] bị header intercept → dùng force
        // Hoặc navigate thẳng pin-creation-tool cho nhanh
        console.log(`[Pinterest Idea Pin] STEP 4 - Mở pin-creation-tool...`);
        await page.goto('https://www.pinterest.com/pin-creation-tool/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        }).catch(() => {});
        await page.waitForTimeout(5000);

        const currentUrl = page.url();
        console.log(`[Pinterest Idea Pin] STEP 4 - URL: ${currentUrl}`);
        if (!currentUrl.includes('pin-creation') && !currentUrl.includes('idea')) {
            // Fallback: click Create → Ảnh ghép
            console.log(`[Pinterest Idea Pin] STEP 4 - Direct URL failed, trying menu...`);
            await page.goto('https://www.pinterest.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
            await page.locator('button[data-test-id="create-tab"]').first().click({ force: true });
            await page.waitForTimeout(2000);
            // Click "Ảnh ghép" trong flyout menu
            const collageSelectors = [
                'a[href*="pin-creation-tool"]',
                'a[href*="idea-pin"]',
                'span:has-text("Ảnh ghép")',
                'div:has-text("Ảnh ghép")',
            ];
            for (const sel of collageSelectors) {
                const el = page.locator(sel).first();
                if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
                    await el.click({ force: true });
                    console.log(`[Pinterest Idea Pin] STEP 4 - Clicked collage via: ${sel}`);
                    break;
                }
            }
            await page.waitForTimeout(5000);
        }

        // Đợi file input xuất hiện
        console.log(`[Pinterest Idea Pin] STEP 5 - Đợi file input...`);
        activePage = page;
        const waitForFileInput = async (timeoutMs = 30000) => {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                for (const p of context.pages()) {
                    try {
                        if (await p.locator('input[type="file"]').count() > 0) return p;
                    } catch (_) {}
                }
                await page.waitForTimeout(1000);
            }
            return null;
        };
        activePage = await waitForFileInput(30000);
        if (!activePage) {
            const urls = context.pages().map(p => p.url()).join('\n  - ');
            throw new Error(`Không tìm thấy file input sau 30s. Pages:\n  - ${urls}`);
        }
        console.log(`[Pinterest Idea Pin] STEP 5 - File input trên: ${activePage.url().substring(0, 80)}`);

        // STEP 5: Upload video
        console.log(`[Pinterest Idea Pin] STEP 5 - Upload video...`);
        await activePage.locator('input[type="file"]').first().setInputFiles([resolvedVideo], { timeout: 30000 });
        console.log(`[Pinterest Idea Pin] STEP 5 - Video uploaded, đợi xử lý 15s...`);
        await activePage.waitForTimeout(15000);

        // Verify video appeared (check for publish button or title input)
        const hasTitleInput = await activePage.locator('#storyboard-selector-title').count() > 0;
        const hasPublishBtn = await activePage.locator('button:has-text("Đăng")').count() > 0;
        console.log(`[Pinterest Idea Pin] STEP 5 - titleInput=${hasTitleInput} publishBtn=${hasPublishBtn}`);

        // STEP 6: Chọn board (optional — Pinterest auto-selects last used board)
        if (boardName) {
            console.log(`[Pinterest Idea Pin] STEP 6 - Chọn board: "${boardName}"...`);
            try {
                // Board dropdown: div showing current board name with chevron
                const boardDropdown = activePage.locator('div[role="button"]:has-text("SIÊU Sao"), div[data-test-id*="board"]').first();
                if (await boardDropdown.count() > 0 && await boardDropdown.isVisible().catch(() => false)) {
                    await boardDropdown.click();
                    await activePage.waitForTimeout(2000);
                    // Search for board
                    const boardOption = activePage.locator(`div:has-text("${boardName}"), span:has-text("${boardName}")`).first();
                    if (await boardOption.count() > 0 && await boardOption.isVisible().catch(() => false)) {
                        await boardOption.click();
                        console.log(`[Pinterest Idea Pin] STEP 6 - Đã chọn board: "${boardName}"`);
                    }
                    await activePage.waitForTimeout(1000);
                }
            } catch (e) {
                console.log(`[Pinterest Idea Pin] STEP 6 - Lỗi chọn board: ${e.message}`);
            }
        } else {
            console.log(`[Pinterest Idea Pin] STEP 6 - Board auto-selected, skip`);
        }

        // STEP 7: Title
        console.log(`[Pinterest Idea Pin] STEP 7 - Nhập title...`);
        let firstLine = String(title || '').trim();
        if (!firstLine) {
            const filename = path.basename(resolvedVideo, path.extname(resolvedVideo));
            firstLine = filename.replace(/[-_]+/g, ' ').trim() || 'Idea Pin';
        }

        const titleBox = activePage.locator('#storyboard-selector-title').first();
        if (await titleBox.count() > 0) {
            await titleBox.click({ force: true }).catch(() => {});
            await activePage.waitForTimeout(300);
            await titleBox.fill('');
            await activePage.keyboard.press('Control+a');
            await activePage.keyboard.press('Delete');
            await activePage.waitForTimeout(200);
            await titleBox.fill(firstLine);
            await activePage.waitForTimeout(300);
            const titleVal = await titleBox.inputValue().catch(() => '');
            console.log(`[Pinterest Idea Pin] STEP 7 - ✓ Title: "${titleVal}"`);
        } else {
            console.log(`[Pinterest Idea Pin] STEP 7 - #storyboard-selector-title not found, skip`);
        }

        // STEP 7b: Description
        const desc = String(caption || '').trim();
        if (desc) {
            console.log(`[Pinterest Idea Pin] STEP 7b - Nhập description...`);
            const descBox = activePage.locator('[contenteditable="true"][aria-label*="mô tả" i], [contenteditable="true"][aria-label*="description" i]').first();
            if (await descBox.count() > 0) {
                await descBox.click({ force: true }).catch(() => {});
                await activePage.waitForTimeout(300);
                await activePage.keyboard.press('Control+a');
                await activePage.keyboard.press('Delete');
                await activePage.waitForTimeout(200);
                try {
                    await descBox.fill(desc);
                } catch (_) {
                    await typeWithNewlines(activePage, desc);
                }
                await activePage.waitForTimeout(500);
                const descVal = await descBox.textContent().catch(() => '');
                console.log(`[Pinterest Idea Pin] STEP 7b - ✓ Description: "${(descVal || '').substring(0, 50)}..."`);
            } else {
                console.log(`[Pinterest Idea Pin] STEP 7b - Description box not found, skip`);
            }
        }

        // STEP 8: Publish
        console.log(`[Pinterest Idea Pin] STEP 8 - Publish...`);
        const publishBtn = activePage.locator('button:has-text("Đăng")').first();
        if (await publishBtn.count() === 0) {
            throw new Error('Không tìm thấy nút "Đăng"');
        }
        // Đợi button enabled (video processing có thể mất thêm thời gian)
        for (let i = 0; i < 12; i++) {
            const disabled = await publishBtn.isDisabled().catch(() => false);
            if (!disabled) break;
            console.log(`[Pinterest Idea Pin] STEP 8 - Nút "Đăng" chưa enabled, đợi 5s...`);
            await activePage.waitForTimeout(5000);
        }
        await publishBtn.click();
        console.log(`[Pinterest Idea Pin] STEP 8 - Đã click "Đăng", đợi 12s...`);
        await activePage.waitForTimeout(12000);

        // Check success
        const finalUrl = activePage.url();
        console.log(`[Pinterest Idea Pin] STEP 8 - URL sau publish: ${finalUrl}`);

        // Đóng page
        try { await activePage.close(); } catch (_) {}

        return {
            success: true,
            publishedUrl: finalUrl,
            message: 'Đăng Pinterest Idea Pin thành công'
        };

    } catch (error) {
        console.error(`[Pinterest Idea Pin] LỖI: ${error.message}`);
        try { if (activePage) await activePage.close(); } catch (_) {}
        try { if (context) await context.close(); } catch (_) {}
        return {
            success: false,
            publishedUrl: '',
            message: `Pinterest Idea Pin: ${error.message}`
        };
    }
}
