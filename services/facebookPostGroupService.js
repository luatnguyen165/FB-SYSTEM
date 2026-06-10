const fs = require('fs');
const path = require('path');
const {
    getOrOpenFacebookContext,
    findFirstVisibleLocator,
    writeTextIntoLocator,
    normalizePublishedFacebookUrl
} = require('./facebookPlaywrightService');
const {
    randomWait,
    humanLikeTyping,
    humanLikeClick,
    humanLikeScroll,
    humanLikeMouseMove,
    warmUp,
    simulateHumanAfterPost
} = require('./humanBehaviorService');

function resolveLocalImagePath(imagePath = '') {
    const rawPath = String(imagePath || '').trim();
    if (!rawPath) return '';

    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
        return rawPath;
    }

const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..');
    const normalizedRelative = rawPath.replace(/^\/+/, '').replace(/^\.\/+/, '');

    const candidates = [
        path.join(projectRoot, normalizedRelative),
        path.join(projectRoot, 'uploads', 'images', path.basename(normalizedRelative))
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return rawPath;
}

function normalizeScheduleImageInputs(images = []) {
    const values = Array.isArray(images) ? images : [images];
    return values
        .map(resolveLocalImagePath)
        .filter(Boolean)
        .filter((filePath) => fs.existsSync(filePath));
}

function normalizeFacebookGroupUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';

    try {
        const parsed = new URL(raw);
        if (!/^(www\.)?facebook\.com$/i.test(parsed.hostname)) return '';

        const pathname = parsed.pathname.replace(/\/+$/, '/');
        if (!/^\/groups\//i.test(pathname)) return '';

        return `${parsed.origin}${pathname}${parsed.search || ''}`;
    } catch (err) {
        return '';
    }
}

function buildFacebookGroupTargetUrl(groupUrl = '', groupId = '') {
    const normalizedGroupUrl = normalizeFacebookGroupUrl(groupUrl);
    if (normalizedGroupUrl) return normalizedGroupUrl;

    const rawGroupId = String(groupId || '').trim();
    if (!rawGroupId) return '';
    if (/^https?:\/\//i.test(rawGroupId)) return normalizeFacebookGroupUrl(rawGroupId);

    return `https://www.facebook.com/groups/${encodeURIComponent(rawGroupId)}`;
}

function isAllowedPostImageFile(filePath = '') {
    const ext = path.extname(String(filePath || '').trim()).toLowerCase();
    return ['.jpg', '.jpeg', '.png'].includes(ext);
}

async function uploadImagesIntoPostDialog(page, dialog, imagePaths = []) {
    const resolvedPaths = normalizeScheduleImageInputs(imagePaths).filter(isAllowedPostImageFile);
    if (!resolvedPaths.length) return false;

    const rejectedPaths = normalizeScheduleImageInputs(imagePaths).filter((filePath) => !isAllowedPostImageFile(filePath));
    if (rejectedPaths.length) {}

    const uploadButtonCandidates = [
        'xpath=.//div[@role="button"][.//span[contains(normalize-space(.), "Ảnh") or contains(normalize-space(.), "Photo") or contains(normalize-space(.), "Video") or contains(normalize-space(.), "Media")]]',
        'xpath=.//*[@role="button"][.//*[contains(normalize-space(.), "Ảnh") or contains(normalize-space(.), "Photo") or contains(normalize-space(.), "Video") or contains(normalize-space(.), "Media")]]',
        'button:has-text("Ảnh")',
        'button:has-text("Photo")',
        'button:has-text("Video")',
        'button:has-text("Media")',
        '[role="button"]:has-text("Ảnh")',
        '[role="button"]:has-text("Photo")',
        '[role="button"]:has-text("Video")',
        '[role="button"]:has-text("Media")'
    ];

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

    const uploadSingleFileViaChooser = async (filePath, label = 'chooser') => {
        const uploadButton = await findFirstVisibleLocator(dialog, uploadButtonCandidates, `group-post-upload-button-${label}`)
            || await findFirstVisibleLocator(page, uploadButtonCandidates, `group-post-upload-button-page-${label}`);

        if (!uploadButton) return false;

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 15000 }),
            uploadButton.click({ force: true })
        ]);

        await fileChooser.setFiles(filePath);
        return true;
    };

    const trySetFilesOnLocator = async (locator, filePath, label = 'input') => {
        const count = await locator.count().catch(() => 0);

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
                continue;
            }

            if (meta.accept && !/image|video/i.test(meta.accept)) {
                continue;
            }

            try {
                await input.waitFor({ state: 'attached', timeout: 10000 });
                await input.setInputFiles(filePath);
                return true;
            } catch (err) {
            }
        }

        return false;
    };

    // 1) Ảnh đầu tiên ưu tiên input[type=file] trong dialog.
    const dialogFileInputs = dialog.locator('xpath=.//input[@type="file"]');
    if (await trySetFilesOnLocator(dialogFileInputs, resolvedPaths[0], 'dialog input[type="file"]')) {
        const initialPreviewCount = await getPreviewItemCount();
        await waitForPreviewToRender();

        // 2) Nếu có nhiều ảnh thì đẩy từng ảnh tiếp theo qua nút upload/Add ảnh của Facebook.
        for (let index = 1; index < resolvedPaths.length; index++) {
            const filePath = resolvedPaths[index];
            const beforeCount = await getPreviewItemCount();
            const uploaded = await uploadSingleFileViaChooser(filePath, `multi-${index + 1}`)
                || await trySetFilesOnLocator(page.locator('xpath=//div[@role="dialog"]//input[@type="file"]'), filePath, `page dialog input[type="file"] multi-${index + 1}`)
                || await trySetFilesOnLocator(page.locator('input[type="file"]'), filePath, `page input[type="file"] multi-${index + 1}`);

            if (!uploaded) {
                return false;
            }

            const previewOk = await waitForPreviewCountIncrease(beforeCount);
            if (!previewOk) {
                await waitForPreviewToRender();
            }
        }

        return true;
    }

    // 3) Nếu dialog không có input phù hợp thì thử từng ảnh bằng file chooser.
    for (let index = 0; index < resolvedPaths.length; index++) {
        const filePath = resolvedPaths[index];
        const beforeCount = await getPreviewItemCount();
        const uploaded = await uploadSingleFileViaChooser(filePath, `fallback-${index + 1}`)
            || await trySetFilesOnLocator(page.locator('xpath=//div[@role="dialog"]//input[@type="file"]'), filePath, `page dialog input[type="file"] fallback-${index + 1}`)
            || await trySetFilesOnLocator(page.locator('input[type="file"]'), filePath, `page input[type="file"] fallback-${index + 1}`);

        if (!uploaded) {
            return false;
        }

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

    // Mở khung đăng bài - với nhiều lựa chọn selector
    const openBoxSelectors = [
        'xpath=//span[contains(text(), "Bạn viết gì đi...")]/ancestor::div[@role="button"]',
        'xpath=//span[contains(text(), "viết gì")]/ancestor::div[@role="button"]',
        'xpath=//span[contains(text(), "What")]/ancestor::div[@role="button"]',
        'xpath=//div[@role="button"]//span[contains(text(),"viết")]',
        'xpath=//div[@role="button"]//span[contains(text(),"post")]',
        '[role="button"]:has-text("viết gì")',
        '[role="button"]:has-text("Bạn viết")',
        'div[role="button"]:has-text("viết gì")'
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
            'div[role="dialog"] div[contenteditable="true"]',
            'div[role="dialog"] div[aria-label*="viết" i][contenteditable="true"]',
            'div[role="dialog"] div[aria-label*="write" i][contenteditable="true"]',
            'div[contenteditable="true"]'
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
                // Fallback: dùng fill hoặc type vào textBox trực tiếp
                console.log('[GroupPost] Active element not editable, typing directly...');
                try {
                    await textBox.fill(finalContent);
                    console.log('[GroupPost] Content filled via locator.fill()');
                } catch (fillErr) {
                    console.log('[GroupPost] fill() failed, trying pressSequentially...');
                    await textBox.focus().catch(() => {});
                    await textBox.pressSequentially(finalContent, { delay: 30 + Math.floor(Math.random() * 40) });
                    console.log('[GroupPost] Content typed via pressSequentially');
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
        'xpath=//div[@role="button"]//span[text()="Đăng"]',
        'xpath=//div[@role="button"]//span[contains(text(),"Đăng")]',
        'xpath=//div[@role="button"][contains(.,"Đăng")]',
        'xpath=//span[text()="Đăng"]/ancestor::div[@role="button"]',
        'xpath=//span[contains(text(),"Đăng")]/ancestor::div[@role="button"]',
        'xpath=//div[@aria-label="Đăng"]',
        'xpath=//*[@aria-label="Đăng"]',
        'div[role="button"]:has-text("Đăng")',
        'button:has-text("Đăng")',
        '[role="button"]:has-text("Đăng")',
        '[aria-label="Đăng"]'
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
        await humanLikeClick(page, postButton);
        console.log('[GroupPost] Post button clicked successfully');
    } else {
        // Fallback: thử gửi bằng tổ hợp phím Ctrl+Enter (Facebook hỗ trợ)
        console.log('[GroupPost] Post button not found, trying Ctrl+Enter fallback...');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
        await randomWait(2000, 3000);
        
        // Kiểm tra xem bài đã được đăng chưa (dialog đã đóng)
        const dialogStillOpen = await page.locator('xpath=//div[@role="dialog"]').first().isVisible().catch(() => false);
        if (!dialogStillOpen) {
            console.log('[GroupPost] Ctrl+Enter fallback succeeded (dialog closed)');
        } else {
            // Thử lần cuối: tìm bất kỳ nút nào có chữ Đăng và click
            console.log('[GroupPost] Trying final fallback: finding any button with "Đăng"...');
            const allButtons = page.locator('xpath=//*[contains(text(),"Đăng")]/ancestor::*[@role="button" or self::button]');
            const btnCount = await allButtons.count().catch(() => 0);
            if (btnCount > 0) {
                for (let i = 0; i < btnCount; i++) {
                    const btn = allButtons.nth(i);
                    const vis = await btn.isVisible().catch(() => false);
                    const en = await btn.isEnabled().catch(() => true);
                    if (vis && en) {
                        await btn.scrollIntoViewIfNeeded().catch(() => {});
                        await humanLikeClick(page, btn);
                        console.log(`[GroupPost] Fallback clicked button ${i}`);
                        break;
                    }
                }
            } else {
                console.log('[GroupPost] WARNING: Could not find any "Đăng" button. Page content:');
                const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => 'N/A');
                console.log(`[GroupPost] Page text preview: ${pageText}`);
            }
        }
    }

    // Chờ bài đăng hoàn tất: đợi dialog đóng hoặc URL thay đổi
    console.log('[GroupPost] Waiting for post to complete (dialog close or URL change)...');
    let currentUrl = page.url();
    const postStartedAt = Date.now();
    const postMaxWait = imagePaths.length ? 30000 : 20000;
    
    try {
        await page.waitForFunction(() => {
            const dialogs = document.querySelectorAll('div[role="dialog"]');
            for (const d of dialogs) {
                if (d.querySelector('[contenteditable="true"]') || d.textContent.includes('Đăng')) {
                    return false;
                }
            }
            return true;
        }, { timeout: postMaxWait }).catch(() => {});
    } catch (e) {
        console.log(`[GroupPost] Wait for dialog close timed out after ${postMaxWait}ms`);
    }

    await page.waitForTimeout(3000);
    
    try {
        await page.waitForFunction((oldUrl) => {
            return window.location.href !== oldUrl && 
                   (window.location.href.includes('/posts/') || 
                    window.location.href.includes('/permalink.php') ||
                    window.location.href.includes('/story.php') ||
                    window.location.href.includes('/groups/'));
        }, currentUrl, { timeout: 10000 }).catch(() => {});
    } catch (e) {
    }
    currentUrl = page.url();

    console.log('[GroupPost] Simulating human behavior after posting...');
    await simulateHumanAfterPost(page, { 
        minWait: 5000, 
        maxWait: 10000,
        shouldLikeOwnPost: true
    });
    console.log('[GroupPost] Post-publish behavior complete');

    return {
        success: true,
        message: imagePaths.length
            ? 'Đã đăng bài Post kèm ảnh thành công'
            : 'Đã đăng bài Post thành công',
        publishedUrl: currentUrl || ''
    };
}

async function runBotPostGroupInstantWithAccount({ userId, accountName, accountType = 'Cá nhân', post, headless = false }) {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless });

    try {
        const page = context.pages()[0] || await context.newPage();
        const result = await runBotPostGroupInstant(page, post);
        return result;
    } finally {
        try {
            await context.close();
        } catch (e) {}
        global.__facebookPlaywrightSessions?.delete?.(sessionKey);
    }
}

module.exports = {
    runBotPostGroupInstant,
    runBotPostGroupInstantWithAccount
};