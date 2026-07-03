const fs = require('fs');
const path = require('path');
const { getOrOpenFacebookContext } = require('./facebook/session');
const { findFirstVisibleLocator, writeTextIntoLocator, normalizePublishedFacebookUrl } = require('./facebook/utils');
const {
    randomWait,
    humanLikeTyping,
    humanLikeClick,
    humanLikeScroll,
    humanLikeMouseMove,
    warmUp,
    simulateHumanAfterPost
} = require('./humanBehaviorService');
const {
    resolveLocalImagePath,
    normalizeScheduleImageInputs,
    isAllowedPostImageFile,
    normalizeFacebookGroupUrl,
    buildFacebookGroupTargetUrl
} = require('./common/facebook');

async function uploadImagesIntoPostDialog(page, dialog, imagePaths = []) {
    const resolvedPaths = normalizeScheduleImageInputs(imagePaths).filter(isAllowedPostImageFile);
    console.log(`[Upload] imagePaths=${imagePaths.length} resolvedPaths=${resolvedPaths.length}`);
    if (!resolvedPaths.length) return false;

    const rejectedPaths = normalizeScheduleImageInputs(imagePaths).filter((filePath) => !isAllowedPostImageFile(filePath));
    if (rejectedPaths.length) { console.log(`[Upload] Rejected: ${rejectedPaths.join(', ')}`); }

    // Debug: dump dialog structure
    const dialogInfo = await page.evaluate(() => {
        const d = document.querySelector('div[role="dialog"]');
        if (!d) return { exists: false };
        const inputs = d.querySelectorAll('input[type="file"]');
        const btns = d.querySelectorAll('[role="button"], button');
        return {
            exists: true,
            fileInputs: inputs.length,
            buttons: Array.from(btns).map(b => ({ text: (b.textContent || '').trim().substring(0, 40), visible: b.offsetParent !== null })),
        };
    }).catch(() => ({ exists: false, error: true }));
    console.log(`[Upload] Dialog: exists=${dialogInfo.exists} fileInputs=${dialogInfo.fileInputs || 0}`);
    if (dialogInfo.buttons) {
        dialogInfo.buttons.forEach((b, i) => {
            if (b.text) console.log(`[Upload]   btn[${i}]: "${b.text}" visible=${b.visible}`);
        });
    }

    // uploadButtonCandidates removed — use direct input[type=file] instead of clicking Photo/video button

    const waitForPreviewToRender = async () => {
        await page.waitForTimeout(3000);
        const previewHints = [
            'div[role="dialog"] img',
            'div[role="dialog"] video',
            'div[role="dialog"] [aria-label*="preview" i]',
            'div[role="dialog"] [aria-label*="xóa" i]',
            'div[role="dialog"] [aria-label*="remove" i]'
        ];

        for (const selector of previewHints) {
            const hintLocator = dialog.locator(selector).first();
            const count = await hintLocator.count().catch(() => 0);
            if (count) {
                const visible = await hintLocator.isVisible().catch(() => false);
                if (visible) return true;
            }
        }

        return true;
    };

    const getPreviewItemCount = async () => {
        const selectors = [
            'div[role="dialog"] img',
            'div[role="dialog"] video'
        ];

        let total = 0;
        for (const selector of selectors) {
            total += await dialog.locator(selector).count().catch(() => 0);
        }
        return total;
    };

    const waitForPreviewCountIncrease = async (previousCount) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < 12000) {
            const currentCount = await getPreviewItemCount();
            if (currentCount > previousCount) return true;
            await page.waitForTimeout(1000);
        }
        return false;
    };

    const trySetFilesOnLocator = async (locator, filePath, label = 'input') => {
        const count = await locator.count().catch(() => 0);
        console.log(`[Upload]   ${label}: ${count} inputs found`);

        for (let i = 0; i < count; i++) {
            const input = locator.nth(i);
            const meta = await input.evaluate((el) => ({
                accept: el.getAttribute('accept') || '',
                name: el.getAttribute('name') || '',
                id: el.id || '',
                multiple: el.hasAttribute('multiple'),
                type: el.getAttribute('type') || ''
            })).catch(() => null);

            if (!meta || String(meta.type || '').toLowerCase() !== 'file') {
                console.log(`[Upload]   ${label}[${i}]: skip (type=${meta?.type})`);
                continue;
            }

            if (meta.accept && !/image|video/i.test(meta.accept)) {
                console.log(`[Upload]   ${label}[${i}]: skip (accept=${meta.accept})`);
                continue;
            }

            console.log(`[Upload]   ${label}[${i}]: trying setInputFiles...`);
            try {
                await input.waitFor({ state: 'attached', timeout: 10000 });
                await input.setInputFiles(filePath);
                console.log(`[Upload]   ✅ ${label}[${i}]: setInputFiles OK`);
                return true;
            } catch (err) {
                console.log(`[Upload]   ❌ ${label}[${i}]: ${err.message.substring(0, 80)}`);
            }
        }

        return false;
    };

    // 1) Ảnh đầu tiên ưu tiên input[type=file] trong dialog.
    console.log('[Upload] Strategy 1: dialog input[type=file]...');
    const dialogFileInputs = dialog.locator('xpath=.//input[@type="file"]');
    const dfiCount = await dialogFileInputs.count().catch(() => 0);
    console.log(`[Upload]   dialog file input count: ${dfiCount}`);
    if (await trySetFilesOnLocator(dialogFileInputs, resolvedPaths[0], 'dialog input[type="file"]')) {
        console.log('[Upload]   ✅ Strategy 1 success — first image uploaded via dialog input');
        const initialPreviewCount = await getPreviewItemCount();
        console.log(`[Upload]   Preview count after first upload: ${initialPreviewCount}`);
        await waitForPreviewToRender();

        console.log('[Upload] Strategy 2: multi-image upload for remaining images...');
        // 2) Nếu có nhiều ảnh thì đẩy từng ảnh tiếp theo qua nút upload/Add ảnh của Facebook.
        for (let index = 1; index < resolvedPaths.length; index++) {
            const filePath = resolvedPaths[index];
            console.log(`[Upload]   Image ${index + 1}/${resolvedPaths.length}: ${path.basename(filePath)}`);
            const beforeCount = await getPreviewItemCount();
            const uploaded = await trySetFilesOnLocator(dialog.locator('xpath=.//input[@type="file"]'), filePath, `dialog input[type="file"] multi-${index + 1}`)
                || await trySetFilesOnLocator(page.locator('xpath=//div[@role="dialog"]//input[@type="file"]'), filePath, `page dialog input[type="file"] multi-${index + 1}`)
                || await trySetFilesOnLocator(page.locator('input[type="file"]'), filePath, `page input[type="file"] multi-${index + 1}`);

            if (!uploaded) {
                console.log(`[Upload]   ❌ Multi-image upload failed for image ${index + 1}`);
                return false;
            }
            console.log(`[Upload]   ✅ Image ${index + 1} uploaded`);


            const previewOk = await waitForPreviewCountIncrease(beforeCount);
            if (!previewOk) {
                await waitForPreviewToRender();
            }
        }

        return true;
    }

    // 3) Nếu dialog không có input phù hợp thì thử từng ảnh bằng file chooser.
    console.log('[Upload] Strategy 3: file chooser fallback for all images...');
    for (let index = 0; index < resolvedPaths.length; index++) {
        const filePath = resolvedPaths[index];
        console.log(`[Upload]   Image ${index + 1}/${resolvedPaths.length}: ${path.basename(filePath)}`);
        const beforeCount = await getPreviewItemCount();
            const uploaded = await trySetFilesOnLocator(dialog.locator('xpath=.//input[@type="file"]'), filePath, `dialog input[type="file"] fallback-${index + 1}`)
                || await trySetFilesOnLocator(page.locator('xpath=//div[@role="dialog"]//input[@type="file"]'), filePath, `page dialog input[type="file"] fallback-${index + 1}`)
                || await trySetFilesOnLocator(page.locator('input[type="file"]'), filePath, `page input[type="file"] fallback-${index + 1}`);

        if (!uploaded) {
            console.log(`[Upload]   ❌ Strategy 3 failed for image ${index + 1}`);
            return false;
        }
        console.log(`[Upload]   ✅ Image ${index + 1} uploaded`);

        const previewOk = await waitForPreviewCountIncrease(beforeCount);
        if (!previewOk) {
            await waitForPreviewToRender();
        }
    }

    return true;
}

/**
 * Focus vào contenteditable div của Facebook một cách đáng tin cậy
 * Dùng Playwright locator.click() thay vì coordinate click để đảm bảo focus đúng
 */
async function focusFacebookContentEditable(page, textBox) {
    if (!textBox) return false;
    
    try {
        // Dùng scrollIntoView + click của Playwright (đáng tin cậy hơn coordinate click)
        await textBox.scrollIntoViewIfNeeded().catch(() => {});
        await randomWait(300, 800);
        
        // Click bằng Playwright locator API - đảm bảo focus đúng
        await textBox.click({ force: true });
        await randomWait(500, 1000);
        
        // Verify focus đã được set
        const isFocused = await textBox.evaluate((el) => {
            return document.activeElement === el || el.contains(document.activeElement);
        }).catch(() => false);
        
        if (!isFocused) {
            console.log('[GroupPost] First click did not focus, trying force focus...');
            await textBox.focus().catch(() => {});
            await randomWait(300, 600);
        }
        
        return true;
    } catch (err) {
        console.error('[GroupPost] Failed to focus textbox:', err.message);
        return false;
    }
}

async function runBotPostGroupInstant(page, { groupUrl, content, images }) {
    if (!groupUrl) {
        throw new Error('Thiếu groupUrl để đăng bài');
    }

    const finalContent = String(content || '').trim();
    const imagePaths = Array.isArray(images) ? images.filter(Boolean) : [];

    if (!finalContent && !imagePaths.length) {
        throw new Error('Cần có nội dung hoặc ảnh để đăng bài');
    }

    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);

    // Mở khung đăng bài - hỗ trợ cả tiếng Việt và tiếng Anh
    const openBoxSelectors = [
        // Vietnamese
        'xpath=//span[contains(text(), "Bạn viết gì đi...")]/ancestor::div[@role="button"]',
        'xpath=//span[contains(text(), "viết gì")]/ancestor::div[@role="button"]',
        'xpath=//div[@role="button"]//span[contains(text(),"viết")]',
        '[role="button"]:has-text("viết gì")',
        '[role="button"]:has-text("Bạn viết")',
        // English
        'xpath=//span[contains(text(), "Write something")]/ancestor::div[@role="button"]',
        'xpath=//div[@role="button"]//span[contains(text(),"Write something")]',
        '[role="button"]:has-text("Write something")',
        'xpath=//div[@role="button"][.//span[contains(text(),"Write")]]',
    ];

    let openBoxBtn = null;
    for (const selector of openBoxSelectors) {
        try {
            const candidate = page.locator(selector).first();
            const count = await candidate.count().catch(() => 0);
            if (count > 0) {
                const visible = await candidate.isVisible().catch(() => false);
                if (visible) {
                    openBoxBtn = candidate;
                    console.log(`[GroupPost] Found post box opener with selector: ${selector}`);
                    break;
                }
            }
        } catch (e) {}
    }

    if (!openBoxBtn) {
        // Thử lần cuối với waitFor timeout dài hơn
        console.log('[GroupPost] Post box opener not found immediately, trying longer wait...');
        for (const selector of openBoxSelectors) {
            try {
                const candidate = page.locator(selector).first();
                await candidate.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
                const visible = await candidate.isVisible().catch(() => false);
                if (visible) {
                    openBoxBtn = candidate;
                    console.log(`[GroupPost] Found post box opener after wait with selector: ${selector}`);
                    break;
                }
            } catch (e) {}
        }
    }

    if (!openBoxBtn) {
        throw new Error('Không tìm thấy khung đăng bài trên group Facebook');
    }

    await openBoxBtn.scrollIntoViewIfNeeded().catch(() => {});
    await randomWait(500, 1000);
    await humanLikeClick(page, openBoxBtn);
    await randomWait(2000, 3000);

    // Upload ảnh nếu có - hỗ trợ nhiều ảnh cùng lúc
    if (imagePaths.length) {
        const resolvedPaths = imagePaths
            .map(p => resolveLocalImagePath(p))
            .filter(p => p && fs.existsSync(p));
        
        if (resolvedPaths.length > 0) {
            await uploadImagesIntoPostDialog(page, page.locator('xpath=//div[@role="dialog"]'), resolvedPaths);
            if (resolvedPaths.length) {
                await randomWait(5000, 10000);
            }
        }
    }

    // Sau khi upload ảnh xong, Facebook có thể re-render dialog
    // Cần tìm lại contenteditable và focus đúng cách
    if (finalContent) {
        console.log('[GroupPost] Finding contenteditable div after image upload...');
        
        // Tìm textbox với nhiều selector dự phòng
        const textBoxSelectors = [
            'xpath=//div[@role="dialog"]//div[@contenteditable="true"]',
            'xpath=//div[@role="dialog"]//div[contains(@class, "notranslate")][@contenteditable="true"]',
            'xpath=//div[@role="dialog"]//div[contains(@class, "xi81zsa")][@contenteditable="true"]',
            'div[role="dialog"] div[contenteditable="true"]',
            'div[role="dialog"] div[aria-label*="viết" i][contenteditable="true"]',
            'div[role="dialog"] div[aria-label*="write" i][contenteditable="true"]',
        ];
        
        let textBox = null;
        for (const selector of textBoxSelectors) {
            try {
                const candidate = page.locator(selector).first();
                const count = await candidate.count().catch(() => 0);
                if (count > 0) {
                    textBox = candidate;
                    console.log(`[GroupPost] Found contenteditable with selector: ${selector}`);
                    break;
                }
            } catch (e) {}
        }

        if (textBox) {
            // Focus vào textbox trước
            const focused = await focusFacebookContentEditable(page, textBox);
            if (!focused) {
                console.log('[GroupPost] Could not focus textbox, trying fallback...');
                // Fallback: thử click vào vùng soạn thảo
                try {
                    await textBox.evaluate((el) => el.focus());
                    await randomWait(500, 1000);
                } catch (e) {
                    console.error('[GroupPost] Fallback focus failed:', e.message);
                }
            }
            
            await randomWait(400, 1200);
            
            // Kiểm tra focus trước khi gõ
            const activeElementInfo = await page.evaluate(() => {
                const active = document.activeElement;
                if (!active) return { tag: 'none', editable: false };
                return {
                    tag: active.tagName,
                    editable: active.isContentEditable || active.getAttribute('contenteditable') === 'true',
                    role: active.getAttribute('role') || '',
                    class: (active.className || '').substring(0, 100)
                };
            }).catch(() => ({ tag: 'unknown', editable: false }));
            
            console.log('[GroupPost] Active element before typing:', JSON.stringify(activeElementInfo));
            
            if (activeElementInfo.editable) {
                // Gõ content vào element đã được focus
                await humanLikeTyping(page, finalContent);
                console.log('[GroupPost] Content typed successfully via focused element');
            } else {
                // Fallback: dùng fill hoặc humanLikeTyping
                console.log('[GroupPost] Active element not editable, typing directly...');
                try {
                    await textBox.fill(finalContent);
                    console.log('[GroupPost] Content filled via locator.fill()');
                } catch (fillErr) {
                    console.log('[GroupPost] fill() failed, using humanLikeTyping...');
                    await textBox.focus().catch(() => {});
                    await humanLikeTyping(page, finalContent);
                    console.log('[GroupPost] Content typed via humanLikeTyping');
                }
            }
        } else {
            console.log('[GroupPost] Không tìm thấy contenteditable div! Không thể gõ content.');
        }
    }

    // Chờ ngẫu nhiên trước khi đăng (như người đang suy nghĩ, check lại bài)
    const prePublishPause = 5000 + Math.floor(Math.random() * 10000);
    console.log(`[GroupPost] Pre-publish pause ${prePublishPause}ms...`);
    await randomWait(prePublishPause - 2000, prePublishPause + 2000);

    // Di chuột đến nút Đăng và click - với nhiều chiến lược dự phòng
    const postButtonSelectors = [
        // aria-label là selector ổn định nhất (HTML gốc có role="button" + aria-label="Post")
        'xpath=//div[@role="dialog"]//div[@role="button"][@aria-label="Post"]',
        'xpath=//div[@role="dialog"]//div[@role="button"][@aria-label="Đăng"]',
        // Exact text match (tránh match "Add to your post")
        'xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Đăng"]]',
        'xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Post"]]',
        // Exact normalize-space match trên button text
        'xpath=//div[@role="dialog"]//div[@role="button"][normalize-space(.)="Đăng"]',
        'xpath=//div[@role="dialog"]//div[@role="button"][normalize-space(.)="Post"]',
    ];

    let postButton = null;
    let postButtonFound = false;

    for (const selector of postButtonSelectors) {
        try {
            const candidate = page.locator(selector).first();
            const count = await candidate.count().catch(() => 0);
            if (count > 0) {
                const visible = await candidate.isVisible().catch(() => false);
                const enabled = await candidate.isEnabled().catch(() => true);
                if (visible && enabled) {
                    postButton = candidate;
                    postButtonFound = true;
                    console.log(`[GroupPost] Found post button with selector: ${selector}`);
                    break;
                }
            }
        } catch (e) {
            // tiếp tục thử selector tiếp theo
        }
    }

    // Nếu chưa tìm thấy nút nào visible+enabled, thử chờ lâu hơn để Facebook xử lý ảnh xong
    if (!postButtonFound && imagePaths.length > 0) {
        console.log('[GroupPost] Post button not immediately visible, waiting for image processing...');
        await randomWait(5000, 10000);

        for (const selector of postButtonSelectors) {
            try {
                const candidate = page.locator(selector).first();
                await candidate.waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
                const visible = await candidate.isVisible().catch(() => false);
                const enabled = await candidate.isEnabled().catch(() => true);
                if (visible && enabled) {
                    postButton = candidate;
                    postButtonFound = true;
                    console.log(`[GroupPost] Found post button after waiting with selector: ${selector}`);
                    break;
                }
            } catch (e) {
                // tiếp tục
            }
        }
    }

    // Cuộn nút Đăng vào view trước khi tương tác
    if (postButtonFound && postButton) {
        await postButton.scrollIntoViewIfNeeded().catch(() => {});
        await randomWait(500, 1000);

        // Playwright click thường bị chặn bởi overlay data-visualcompletion="ignore"
        // → Dùng mouse.click với toạ độ (trusted events, isTrusted=true)
        const btnBox = await postButton.boundingBox().catch(() => null);
        if (btnBox) {
            const cx = btnBox.x + btnBox.width / 2;
            const cy = btnBox.y + btnBox.height / 2;
            await page.mouse.move(cx, cy, { steps: 5 });
            await randomWait(100, 300);
            await page.mouse.down();
            await randomWait(30, 80);
            await page.mouse.up();
            console.log(`[GroupPost] Post button clicked via mouse at (${Math.round(cx)}, ${Math.round(cy)})`);
        } else {
            await humanLikeClick(page, postButton);
            console.log('[GroupPost] Post button clicked via humanLikeClick');
        }
    } else {
        // Fallback: Ctrl+Enter hoặc JS dispatch
        console.log('[GroupPost] Post button not found, trying Ctrl+Enter + mouse fallback...');
        
        // Kiểm tra xem bài đã được đăng chưa (dialog đã đóng)
        const dialogStillOpen2 = await page.locator('xpath=//div[@role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogStillOpen2) {
            console.log('[GroupPost] Post submitted successfully');
        } else {
            // Thử lần cuối: scope vào dialog — KHÔNG click toàn trang
            console.log('[GroupPost] Trying final fallback: finding button with "Đăng" inside dialog...');
            const dialogFallbacks = [
                page.locator('xpath=//div[@role="dialog"]//div[@role="button"][normalize-space(.)="Đăng"]').first(),
                page.locator('xpath=//div[@role="dialog"]//div[@role="button"][normalize-space(.)="Post"]').first(),
                page.locator('xpath=//div[@role="dialog"]//button[normalize-space(.)="Đăng"]').first(),
                page.locator('xpath=//div[@role="dialog"]//button[normalize-space(.)="Post"]').first(),
            ];
            let fallbackClicked = false;
            for (const btn of dialogFallbacks) {
                const count = await btn.count().catch(() => 0);
                if (count > 0) {
                    const vis = await btn.isVisible().catch(() => false);
                    const en = await btn.isEnabled().catch(() => true);
                    if (vis && en) {
                        await btn.scrollIntoViewIfNeeded().catch(() => {});
                        const btnBox = await btn.boundingBox().catch(() => null);
                        if (btnBox) {
                            const cx = btnBox.x + btnBox.width / 2;
                            const cy = btnBox.y + btnBox.height / 2;
                            await page.mouse.move(cx, cy, { steps: 5 });
                            await randomWait(100, 300);
                            await page.mouse.down();
                            await randomWait(30, 80);
                            await page.mouse.up();
                        } else {
                            await humanLikeClick(page, btn);
                        }
                        console.log('[GroupPost] Fallback clicked button inside dialog');
                        fallbackClicked = true;
                        break;
                    }
                }
            }
            if (!fallbackClicked) {
                console.log('[GroupPost] WARNING: Could not find any "Đăng" button. Dumping dialog buttons:');
                try {
                    const dialogBtns = await page.evaluate(() => {
                        const dialog = document.querySelector('div[role="dialog"]');
                        if (!dialog) return 'no dialog found';
                        const btns = dialog.querySelectorAll('[role="button"], button');
                        return Array.from(btns).map(b => ({
                            tag: b.tagName,
                            text: b.textContent?.trim().substring(0, 50),
                            disabled: b.disabled,
                            visible: b.offsetParent !== null,
                            classes: b.className?.substring(0, 80),
                        }));
                    });
                    console.log('[GroupPost] Dialog buttons:', JSON.stringify(dialogBtns, null, 2));
                } catch (e) {
                    console.log('[GroupPost] Cannot dump buttons:', e.message);
                }
                const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => 'N/A');
                console.log(`[GroupPost] Page text preview: ${pageText}`);
            }
        }
    }

    // Xử lý popup "Đăng bài viết gốc" — Facebook hỏi khi share shared post
    const originalPostStartTime = Date.now();
    while (Date.now() - originalPostStartTime < 15000) {
        const originalPostBtns = [
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Đăng bài viết gốc")]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Post original")]').first(),
            page.locator('xpath=//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
            page.locator('xpath=//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
        ];
        let handled = false;
        for (const btn of originalPostBtns) {
            const count = await btn.count().catch(() => 0);
            if (count > 0) {
                const visible = await btn.isVisible().catch(() => false);
                if (visible) {
                    const btnText = await btn.textContent().catch(() => '');
                    console.log(`[GroupPost] Found "Đăng bài viết gốc" button: "${btnText.trim().substring(0, 50)}"`);
                    await btn.click({ force: true }).catch(() => {});
                    await randomWait(2000, 3000);
                    handled = true;
                    break;
                }
            }
        }
        if (handled) break;
        // Kiểm tra dialog đã đóng (post đã gửi) thì thoát
        const dialogOpen = await page.locator('xpath=//div[@role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogOpen) break;
        await randomWait(1000, 2000);
    }

    // Chờ bài đăng hoàn tất: đợi dialog đóng hoặc URL thay đổi
    console.log('[GroupPost] Waiting for post to complete (dialog close or URL change)...');
    const originalUrl = page.url();
    const postStartedAt = Date.now();
    const postMaxWait = imagePaths.length ? 45000 : 20000;

    // Đợi cho compose dialog (có contenteditable) biến mất — đây là dấu hiệu post đã gửi
    try {
        await page.waitForFunction(() => {
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            for (const d of dialogs) {
                if (d.querySelector('[contenteditable="true"]')) {
                    return false;
                }
            }
            return true;
        }, { timeout: postMaxWait });
        console.log('[GroupPost] Compose dialog closed — post likely sent');
    } catch (e) {
        console.log(`[GroupPost] Wait for compose dialog close timed out after ${postMaxWait}ms`);
    }

    // Đợi thêm 3s cho Facebook xử lý backend
    await page.waitForTimeout(3000);

    // Chụp URL hiện tại SAU khi đã đợi xong
    const finalUrl = page.url();
    const urlChanged = finalUrl !== originalUrl;

    // Kiểm tra compose dialog đã đóng chưa (chỉ check dialog có contenteditable — KHÔNG check toast/dialog mới)
    const composeDialogStillOpen = await page.locator('xpath=//div[@role="dialog"]//div[@contenteditable="true"]').first().isVisible().catch(() => false);

    // Kiểm tra thêm: có toast/thông báo thành công không
    const successToast = await page.locator('xpath=//div[@role="alert" or contains(@aria-label,"success") or contains(text(),"thành công") or contains(text(),"shared") or contains(text(),"đã đăng")]').first().isVisible().catch(() => false);

    // Post thành công nếu: compose dialog đóng, HOẶC URL thay đổi, HOẶC có toast thành công
    const postLikelySucceeded = !composeDialogStillOpen || urlChanged || successToast;

    console.log(`[GroupPost] Post check: composeDialogOpen=${composeDialogStillOpen}, urlChanged=${urlChanged} (${originalUrl} -> ${finalUrl}), successToast=${successToast}, likelySucceeded=${postLikelySucceeded}`);

    if (postLikelySucceeded) {
        console.log('[GroupPost] Simulating human behavior after posting...');
        await simulateHumanAfterPost(page, {
            minWait: 5000,
            maxWait: 10000,
            shouldLikeOwnPost: true
        });
        console.log('[GroupPost] Post-publish behavior complete');
    }

    return {
        success: postLikelySucceeded,
        message: postLikelySucceeded
            ? (imagePaths.length ? 'Đã đăng bài Post kèm ảnh thành công' : 'Đã đăng bài Post thành công')
            : 'Đăng bài thất bại - compose dialog vẫn mở',
        publishedUrl: postLikelySucceeded ? (finalUrl || '') : ''
    };
}

async function runBotPostGroupInstantWithAccount({ userId, accountName, accountType = 'Cá nhân', post, headless = true, existingSessionDir = '' }) {
    const { context, sessionKey } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless, existingSessionDir });

    try {
        const page = context.pages()[0] || await context.newPage();
        const result = await runBotPostGroupInstant(page, post);
        return result;
    } finally {
        // Đóng context trước
        try {
            if (context && !context.isClosed()) {
                await context.close();
            }
        } catch (e) {
            console.log('[GroupPost] context.close() error:', e.message);
        }

        // Xóa session khỏi ACTIVE_FB_SESSIONS
        try {
            const { ACTIVE_FB_SESSIONS } = require('./facebook/session');
            ACTIVE_FB_SESSIONS.delete(sessionKey);
        } catch (e) {}
    }
}

/**
 * Đăng bài lên Timeline cá nhân (facebook.com/home)
 * Click "Bạn đang nghĩ gì?" → mở dialog → upload ảnh → gõ nội dung → Đăng
 */
async function runBotPostPersonalTimeline(page, { profileUrl, content, images }) {
    const finalContent = String(content || '').trim();
    const imagePaths = Array.isArray(images) ? images.filter(Boolean) : [];

    if (!finalContent && !imagePaths.length) {
        throw new Error('Cần có nội dung hoặc ảnh để đăng bài');
    }

    // 1) Navigate to Facebook home / profile
    const targetUrl = profileUrl || 'https://www.facebook.com/';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);

    // 2) Click "Bạn đang nghĩ gì?" to open post dialog
    // HTML: div[role="button"] > div > span(text="Bạn đang nghĩ gì?")
    const openBoxSelectors = [
        'xpath=//div[@role="button" and @tabindex="0"][.//span[normalize-space(text())="Bạn đang nghĩ gì?"]]',
        'xpath=//div[@role="button"][.//span[normalize-space(text())="Bạn đang nghĩ gì?"]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "Bạn đang nghĩ gì")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "nghĩ gì")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "What\'s on your mind")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "What")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "đang nghĩ")]]',
        'xpath=//div[@role="button"][.//div[@contenteditable="true"]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "on your mind")]]',
        'div[role="button"]:has(span:text-is("Bạn đang nghĩ gì?"))',
        'div[role="button"]:has(span:text("Bạn đang nghĩ gì"))',
        '[role="button"]:has-text("Bạn đang nghĩ gì")',
        '[role="button"]:has-text("What\'s on your mind")',
        '[role="button"]:has-text("đang nghĩ")',
        '[data-pagelet="Composer"] div[role="button"]',
        'div[role="main"] div[role="button"][tabindex]',
    ];

    let openBoxBtn = null;
    for (const selector of openBoxSelectors) {
        try {
            const candidate = page.locator(selector).first();
            const count = await candidate.count().catch(() => 0);
            if (count > 0) {
                const visible = await candidate.isVisible().catch(() => false);
                if (visible) {
                    openBoxBtn = candidate;
                    console.log(`[PersonalPost] Found "Bạn đang nghĩ gì?" with selector: ${selector}`);
                    break;
                }
            }
        } catch (e) {}
    }

    if (!openBoxBtn) {
        console.log('[PersonalPost] Not found immediately, waiting longer...');
        for (const selector of openBoxSelectors) {
            try {
                const candidate = page.locator(selector).first();
                await candidate.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
                const visible = await candidate.isVisible().catch(() => false);
                if (visible) {
                    openBoxBtn = candidate;
                    console.log(`[PersonalPost] Found after wait: ${selector}`);
                    break;
                }
            } catch (e) {}
        }
    }

    if (!openBoxBtn) {
        throw new Error('Không tìm thấy "Bạn đang nghĩ gì?" trên Timeline');
    }

    await openBoxBtn.scrollIntoViewIfNeeded().catch(() => {});
    await randomWait(500, 1000);
    await humanLikeClick(page, openBoxBtn);
    await randomWait(2000, 3000);

    // 3) Upload ảnh nếu có
    if (imagePaths.length) {
        const resolvedPaths = imagePaths
            .map(p => resolveLocalImagePath(p))
            .filter(p => p && fs.existsSync(p));

        if (resolvedPaths.length > 0) {
            await uploadImagesIntoPostDialog(page, page.locator('xpath=//div[@role="dialog"]'), resolvedPaths);
            await randomWait(5000, 10000);
        }
    }

    // 4) Gõ nội dung
    if (finalContent) {
        const textBoxSelectors = [
            'xpath=//div[@role="dialog"]//div[@contenteditable="true"]',
            'xpath=//div[@role="dialog"]//div[contains(@class, "notranslate")][@contenteditable="true"]',
            'xpath=//div[contains(@class, "xi81zsa")][@contenteditable="true"]',
            'div[role="dialog"] div[contenteditable="true"]',
            'div[contenteditable="true"]'
        ];

        let textBox = null;
        for (const selector of textBoxSelectors) {
            try {
                const candidate = page.locator(selector).first();
                const count = await candidate.count().catch(() => 0);
                if (count > 0) {
                    textBox = candidate;
                    console.log(`[PersonalPost] Found contenteditable: ${selector}`);
                    break;
                }
            } catch (e) {}
        }

        if (textBox) {
            await focusFacebookContentEditable(page, textBox);
            await randomWait(400, 1200);

            const activeElementInfo = await page.evaluate(() => {
                const active = document.activeElement;
                if (!active) return { tag: 'none', editable: false };
                return {
                    tag: active.tagName,
                    editable: active.isContentEditable || active.getAttribute('contenteditable') === 'true'
                };
            }).catch(() => ({ tag: 'unknown', editable: false }));

            if (activeElementInfo.editable) {
                await humanLikeTyping(page, finalContent);
                console.log('[PersonalPost] Content typed successfully');
            } else {
                try {
                    await textBox.fill(finalContent);
                } catch (fillErr) {
                    await textBox.focus().catch(() => {});
                    await humanLikeTyping(page, finalContent);
                }
                console.log('[PersonalPost] Content typed via fallback');
            }
        }
    }

    // 5) Pause trước khi đăng
    const prePublishPause = 5000 + Math.floor(Math.random() * 10000);
    console.log(`[PersonalPost] Pre-publish pause ${prePublishPause}ms...`);
    await randomWait(prePublishPause - 2000, prePublishPause + 2000);

    // 6) Click nút Đăng — scoped inside dialog
    const postButtonSelectors = [
        'xpath=//div[@role="dialog"]//div[@role="button"][@aria-label="Post"]',
        'xpath=//div[@role="dialog"]//div[@role="button"][@aria-label="Đăng"]',
        'xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Đăng"]]',
        'xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="Post"]]',
        'xpath=//div[@role="dialog"]//div[@role="button"][normalize-space(.)="Đăng"]',
        'xpath=//div[@role="dialog"]//div[@role="button"][normalize-space(.)="Post"]',
    ];

    let postButton = null;
    for (const selector of postButtonSelectors) {
        try {
            const candidate = page.locator(selector).first();
            const count = await candidate.count().catch(() => 0);
            if (count > 0) {
                const visible = await candidate.isVisible().catch(() => false);
                const enabled = await candidate.isEnabled().catch(() => true);
                if (visible && enabled) {
                    postButton = candidate;
                    console.log(`[PersonalPost] Found post button: ${selector}`);
                    break;
                }
            }
        } catch (e) {}
    }

    if (!postButton && imagePaths.length > 0) {
        console.log('[PersonalPost] Waiting for image processing...');
        await randomWait(5000, 10000);
        for (const selector of postButtonSelectors) {
            try {
                const candidate = page.locator(selector).first();
                await candidate.waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
                const visible = await candidate.isVisible().catch(() => false);
                const enabled = await candidate.isEnabled().catch(() => true);
                if (visible && enabled) {
                    postButton = candidate;
                    break;
                }
            } catch (e) {}
        }
    }

    if (postButton) {
        await postButton.scrollIntoViewIfNeeded().catch(() => {});
        await randomWait(500, 1000);
        // mouse.click với toạ độ (trusted events, isTrusted=true)
        const btnBox = await postButton.boundingBox().catch(() => null);
        if (btnBox) {
            const cx = btnBox.x + btnBox.width / 2;
            const cy = btnBox.y + btnBox.height / 2;
            await page.mouse.move(cx, cy, { steps: 5 });
            await randomWait(100, 300);
            await page.mouse.down();
            await randomWait(30, 80);
            await page.mouse.up();
            console.log(`[PersonalPost] Post button clicked via mouse at (${Math.round(cx)}, ${Math.round(cy)})`);
        } else {
            await humanLikeClick(page, postButton);
            console.log('[PersonalPost] Post button clicked');
        }
    } else {
        console.log('[PersonalPost] Trying Ctrl+Enter fallback...');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
        await randomWait(2000, 3000);
    }

    // 7) Chờ dialog đóng = đăng thành công
    const startedAt = Date.now();
    let postLikelySucceeded = false;
    while (Date.now() - startedAt < 30000) {
        // Kiểm tra nút "Đăng bài viết gốc" và click nếu thấy
        const originalPostBtns = [
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Đăng bài viết gốc")]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Post original")]').first(),
            page.locator('xpath=//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
            page.locator('xpath=//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
        ];
        for (const btn of originalPostBtns) {
            const count = await btn.count().catch(() => 0);
            if (count > 0) {
                const visible = await btn.isVisible().catch(() => false);
                if (visible) {
                    const btnText = await btn.textContent().catch(() => '');
                    console.log(`[PersonalPost] Found "Đăng bài viết gốc" button: "${btnText.trim().substring(0, 50)}"`);
                    await btn.click({ force: true }).catch(() => {});
                    await randomWait(2000, 3000);
                    break;
                }
            }
        }

        const dialogStillOpen = await page.locator('xpath=//div[@role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogStillOpen) {
            postLikelySucceeded = true;
            break;
        }
        await randomWait(1000, 2000);
    }

    if (postLikelySucceeded) {
        await simulateHumanAfterPost(page).catch(() => {});
    }

    const currentUrl = page.url();
    return {
        success: postLikelySucceeded,
        message: postLikelySucceeded ? 'Đăng bài thành công trên Timeline' : 'Đăng bài thất bại - dialog vẫn mở',
        publishedUrl: postLikelySucceeded ? currentUrl : ''
    };
}

/**
 * Đăng bài lên Fanpage
 * Click "Bạn đang nghĩ gì?" trên fanpage → dialog → upload ảnh → gõ nội dung → Đăng
 */
async function runBotPostFanpage(page, { pageUrl, content, images }) {
    if (!pageUrl) throw new Error('Thiếu pageUrl để đăng bài lên Fanpage');

    const finalContent = String(content || '').trim();
    const imagePaths = Array.isArray(images) ? images.filter(Boolean) : [];

    if (!finalContent && !imagePaths.length) {
        throw new Error('Cần có nội dung hoặc ảnh để đăng bài');
    }

    // 1) Navigate to fanpage
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);

    // 2) Click "Bạn đang nghĩ gì?" — fanpage also uses same text
    const openBoxSelectors = [
        'xpath=//div[@role="button" and @tabindex="0"][.//span[normalize-space(text())="Bạn đang nghĩ gì?"]]',
        'xpath=//div[@role="button"][.//span[normalize-space(text())="Bạn đang nghĩ gì?"]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "Bạn đang nghĩ gì")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "nghĩ gì")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "What\'s on your mind")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "What")]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "đang nghĩ")]]',
        'xpath=//div[@role="button"][.//div[@contenteditable="true"]]',
        'xpath=//div[@role="button"][.//span[contains(text(), "on your mind")]]',
        'div[role="button"]:has(span:text-is("Bạn đang nghĩ gì?"))',
        'div[role="button"]:has(span:text("Bạn đang nghĩ gì"))',
        '[role="button"]:has-text("Bạn đang nghĩ gì")',
        '[role="button"]:has-text("What\'s on your mind")',
        '[role="button"]:has-text("đang nghĩ")',
        '[data-pagelet="Composer"] div[role="button"]',
        'div[role="main"] div[role="button"][tabindex]',
    ];

    let openBoxBtn = null;
    for (const selector of openBoxSelectors) {
        try {
            const candidate = page.locator(selector).first();
            const count = await candidate.count().catch(() => 0);
            if (count > 0) {
                const visible = await candidate.isVisible().catch(() => false);
                if (visible) {
                    openBoxBtn = candidate;
                    console.log(`[FanpagePost] Found "Bạn đang nghĩ gì?" with: ${selector}`);
                    break;
                }
            }
        } catch (e) {}
    }

    if (!openBoxBtn) {
        console.log('[FanpagePost] Not found immediately, waiting...');
        for (const selector of openBoxSelectors) {
            try {
                const candidate = page.locator(selector).first();
                await candidate.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
                const visible = await candidate.isVisible().catch(() => false);
                if (visible) {
                    openBoxBtn = candidate;
                    console.log(`[FanpagePost] Found after wait: ${selector}`);
                    break;
                }
            } catch (e) {}
        }
    }

    if (!openBoxBtn) {
        throw new Error('Không tìm thấy "Bạn đang nghĩ gì?" trên Fanpage');
    }

    await openBoxBtn.scrollIntoViewIfNeeded().catch(() => {});
    await randomWait(500, 1000);
    await humanLikeClick(page, openBoxBtn);
    await randomWait(2000, 3000);

    // 3) Upload ảnh nếu có
    if (imagePaths.length) {
        const resolvedPaths = imagePaths
            .map(p => resolveLocalImagePath(p))
            .filter(p => p && fs.existsSync(p));

        if (resolvedPaths.length > 0) {
            await uploadImagesIntoPostDialog(page, page.locator('xpath=//div[@role="dialog"]'), resolvedPaths);
            await randomWait(5000, 10000);
        }
    }

    // 4) Gõ nội dung
    if (finalContent) {
        const textBoxSelectors = [
            'xpath=//div[@role="dialog"]//div[@contenteditable="true"]',
            'xpath=//div[@role="dialog"]//div[contains(@class, "notranslate")][@contenteditable="true"]',
            'xpath=//div[contains(@class, "xi81zsa")][@contenteditable="true"]',
            'div[role="dialog"] div[contenteditable="true"]',
            'div[contenteditable="true"]'
        ];

        let textBox = null;
        for (const selector of textBoxSelectors) {
            try {
                const candidate = page.locator(selector).first();
                const count = await candidate.count().catch(() => 0);
                if (count > 0) {
                    textBox = candidate;
                    console.log(`[FanpagePost] Found contenteditable: ${selector}`);
                    break;
                }
            } catch (e) {}
        }

        if (textBox) {
            await focusFacebookContentEditable(page, textBox);
            await randomWait(400, 1200);

            const activeElementInfo = await page.evaluate(() => {
                const active = document.activeElement;
                if (!active) return { tag: 'none', editable: false };
                return {
                    tag: active.tagName,
                    editable: active.isContentEditable || active.getAttribute('contenteditable') === 'true'
                };
            }).catch(() => ({ tag: 'unknown', editable: false }));

            if (activeElementInfo.editable) {
                await humanLikeTyping(page, finalContent);
                console.log('[FanpagePost] Content typed successfully');
            } else {
                try {
                    await textBox.fill(finalContent);
                } catch (fillErr) {
                    await textBox.focus().catch(() => {});
                    await humanLikeTyping(page, finalContent);
                }
                console.log('[FanpagePost] Content typed via fallback');
            }
        }
    }

    // 5) Pause trước khi tiếp
    const prePublishPause = 3000 + Math.floor(Math.random() * 5000);
    console.log(`[FanpagePost] Pre-publish pause ${prePublishPause}ms...`);
    await randomWait(prePublishPause - 1000, prePublishPause + 1000);

    // Helper: tìm + click 1 nút trong dialog theo text
    async function clickDialogButton(labelText, logPrefix) {
        const selectors = [
            // aria-label trước (ổn định nhất)
            `xpath=//div[@role="dialog"]//div[@role="button"][@aria-label="${labelText}"]`,
            `xpath=//div[@role="dialog"]//button[@aria-label="${labelText}"]`,
            `xpath=//div[@role="dialog"]//div[@role="button"][normalize-space(text())="${labelText}"]`,
            `xpath=//div[@role="dialog"]//div[@role="button"][.//span[normalize-space(text())="${labelText}"]]`,
            `xpath=//div[@role="dialog"]//span[normalize-space(text())="${labelText}"]/ancestor::div[@role="button"]`,
            `xpath=//div[@role="dialog"]//div[@role="button"][string-length(normalize-space(.))<=20 and contains(normalize-space(.), "${labelText}")]`,
            `xpath=//div[@role="dialog"]//button[normalize-space(.)="${labelText}"]`,
        ];
        for (const selector of selectors) {
            try {
                const candidate = page.locator(selector).first();
                const count = await candidate.count().catch(() => 0);
                if (count > 0) {
                    const visible = await candidate.isVisible().catch(() => false);
                    const enabled = await candidate.isEnabled().catch(() => true);
                    if (visible && enabled) {
                        await candidate.scrollIntoViewIfNeeded().catch(() => {});
                        await randomWait(500, 1000);

                        // mouse.click với toạ độ (trusted events, isTrusted=true)
                        const btnBox = await candidate.boundingBox().catch(() => null);
                        if (btnBox) {
                            const cx = btnBox.x + btnBox.width / 2;
                            const cy = btnBox.y + btnBox.height / 2;
                            await page.mouse.move(cx, cy, { steps: 5 });
                            await randomWait(100, 300);
                            await page.mouse.down();
                            await randomWait(30, 80);
                            await page.mouse.up();
                            console.log(`[FanpagePost] ${logPrefix} clicked via mouse at (${Math.round(cx)}, ${Math.round(cy)})`);
                        } else {
                            await humanLikeClick(page, candidate);
                            console.log(`[FanpagePost] ${logPrefix} clicked: ${selector}`);
                        }
                        return true;
                    }
                }
            } catch (e) {}
        }
        console.log(`[FanpagePost] ${logPrefix} not found`);
        return false;
    }

    // 6) Click "Tiếp" (Next)
    const nextClicked = await clickDialogButton('Tiếp', 'Tiếp button');
    if (nextClicked) {
        await randomWait(2000, 3000);
    }

    // 7) Click "Đăng" (Post)
    const postClicked = await clickDialogButton('Đăng', 'Đăng button');
    if (!postClicked) {
        console.log('[FanpagePost] Trying Ctrl+Enter fallback...');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
        await randomWait(2000, 3000);
    }

    // 7) Chờ dialog đóng hoặc có tín hiệu thành công
    const startedAt = Date.now();
    let postLikelySucceeded = false;
    while (Date.now() - startedAt < 45000) {
        // Kiểm tra nút "Đăng bài viết gốc" và click nếu thấy
        // Facebook hiển thị dialog này khi share shared post → hỏi "Đăng bài viết gốc" hay "Chia sẻ liên kết"
        const originalPostBtns = [
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Đăng bài viết gốc")]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][contains(., "Post original")]').first(),
            page.locator('xpath=//div[@role="dialog"]//div[@role="button"][.//span[contains(normalize-space(.), "bài viết gốc")]]').first(),
            page.locator('xpath=//div[@role="button"][.//span[contains(normalize-space(.), "Đăng bài viết gốc")]]').first(),
            page.locator('xpath=//div[@role="button"][.//span[contains(normalize-space(.), "Post original")]]').first(),
        ];
        for (const btn of originalPostBtns) {
            const count = await btn.count().catch(() => 0);
            if (count > 0) {
                const visible = await btn.isVisible().catch(() => false);
                if (visible) {
                    const btnText = await btn.textContent().catch(() => '');
                    console.log(`[FanpagePost] Found "Đăng bài viết gốc" button: "${btnText.trim().substring(0, 50)}"`);
                    await btn.click({ force: true }).catch(() => {});
                    await randomWait(2000, 3000);
                    break;
                }
            }
        }

        // Kiểm tra dialog đã đóng chưa
        const dialogStillOpen = await page.locator('xpath=//div[@role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogStillOpen) {
            postLikelySucceeded = true;
            break;
        }
        // Kiểm tra toast/thong bao thanh cong
        const toast = page.locator('div[role="alert"], span:has-text("đã đăng"), span:has-text("đã chia sẻ"), span:has-text("posted"), span:has-text("shared")').first();
        if (await toast.isVisible().catch(() => false)) {
            postLikelySucceeded = true;
            break;
        }
        // Kiem tra URL thay doi (FB redirect sau khi post)
        const curUrl = page.url();
        if (curUrl.includes('/posts/') || curUrl.includes('/reel/') || curUrl.includes('/reels/')) {
            postLikelySucceeded = true;
            break;
        }
        await randomWait(1000, 2000);
    }

    if (postLikelySucceeded) {
        await simulateHumanAfterPost(page).catch(() => {});
    }

    const currentUrl = page.url();
    return {
        success: postLikelySucceeded,
        message: postLikelySucceeded ? 'Đăng bài thành công trên Fanpage' : 'Đăng bài thất bại - dialog vẫn mở',
        publishedUrl: postLikelySucceeded ? currentUrl : ''
    };
}

async function runBotPostPersonalTimelineWithAccount({ userId, accountName, accountType = 'Cá nhân', post, headless = true, existingSessionDir = '' }) {
    const { context, sessionKey } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless, existingSessionDir });
    try {
        const page = context.pages()[0] || await context.newPage();
        return await runBotPostPersonalTimeline(page, post);
    } finally {
        try { if (context && !context.isClosed()) await context.close(); } catch (e) {}
        try { const { ACTIVE_FB_SESSIONS } = require('./facebook/session'); ACTIVE_FB_SESSIONS.delete(sessionKey); } catch (e) {}
    }
}

async function runBotPostFanpageWithAccount({ userId, accountName, accountType = 'Fanpage', post, headless = true, existingSessionDir = '' }) {
    const { context, sessionKey } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless, existingSessionDir });
    try {
        const page = context.pages()[0] || await context.newPage();
        return await runBotPostFanpage(page, post);
    } finally {
        try { if (context && !context.isClosed()) await context.close(); } catch (e) {}
        try { const { ACTIVE_FB_SESSIONS } = require('./facebook/session'); ACTIVE_FB_SESSIONS.delete(sessionKey); } catch (e) {}
    }
}

module.exports = {
    runBotPostGroupInstant,
    runBotPostGroupInstantWithAccount,
    runBotPostPersonalTimeline,
    runBotPostPersonalTimelineWithAccount,
    runBotPostFanpage,
    runBotPostFanpageWithAccount
};