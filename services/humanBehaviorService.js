const { platform } = require('os');

// ====== TIỆN ÍCH HUMAN-LIKE BEHAVIOR ======

/**
 * Chờ ngẫu nhiên trong khoảng [min, max] ms
 */
function randomWait(min, max) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));
}

/**
 * Tạo delay phân phối chuẩn (gaussian) gần với hành vi người thật
 * @param {number} mean - Giá trị trung bình (ms)
 * @param {number} std - Độ lệch chuẩn (ms)
 * @param {number} min - Giá trị tối thiểu
 * @param {number} max - Giá trị tối đa
 */
function gaussianRandom(mean, std, min = 0, max = Infinity) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    num = num * std + mean;
    return Math.min(max, Math.max(min, Math.round(num)));
}

/**
 * Gõ text giống người thật với tốc độ không đều
 * - Thỉnh thoảng chậm lại (suy nghĩ)
 * - Thỉnh thoảng gõ sai rồi sửa
 */
async function humanLikeTyping(page, text, { baseDelay = 5, variance = 5 } = {}) {
    if (!text || !text.length) return;
    
    // Gõ cực nhanh: dùng insertText thay vì gõ từng ký tự riêng lẻ
    try {
        // Thử dùng insertText để paste nguyên đoạn text cùng lúc (siêu nhanh)
        await page.evaluate((t) => {
            const el = document.activeElement;
            if (!el) return;
            if (el.isContentEditable) {
                el.textContent = t;
                // Trigger input event để Facebook nhận biết
                el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
            } else if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLTextAreaElement.prototype, 'value'
                )?.set || Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                )?.set;
                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(el, t);
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                    el.value = t;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        }, text);
        
        // Vẫn gõ thêm vài ký tự cuối bằng keyboard để tạo dấu hiệu "người gõ"
        await randomWait(50, 150);
        if (text.length > 0) {
            const lastChar = text[text.length - 1];
            await page.keyboard.type(lastChar, { delay: 3 });
            await page.keyboard.press('Backspace', { delay: 2 });
        }
        
        return;
    } catch (e) {
        // Fallback nếu evaluate không được
    }
    
    // Fallback: gõ nhanh từng ký tự
    let i = 0;
    while (i < text.length) {
        const char = text[i];
        const delay = Math.max(1, Math.floor(Math.random() * 3)); // 1-3ms
        await page.keyboard.type(char, { delay });
        i++;
    }
}

/**
 * Di chuyển chuột giống người thật (đường đi cong, không thẳng)
 * @param {object} page - Playwright page
 * @param {number} targetX - Tọa độ X đích
 * @param {number} targetY - Tọa độ Y đích
 * @param {object} options - Tùy chọn
 */
async function humanLikeMouseMove(page, targetX, targetY, { steps = null } = {}) {
    const vp = page.viewportSize() || { width: 1366, height: 768 };
    const currentPos = await page.evaluate(() => ({ x: window.mouseX || 0, y: window.mouseY || 0 })).catch(() => ({ x: vp.width / 2, y: vp.height / 2 }));
    
    const fromX = currentPos.x;
    const fromY = currentPos.y;
    const distance = Math.sqrt(Math.pow(targetX - fromX, 2) + Math.pow(targetY - fromY, 2));
    
    // Số bước di chuyển tỉ lệ với khoảng cách
    const numSteps = steps || Math.max(8, Math.floor(distance / 10) + Math.floor(Math.random() * 5));
    
    for (let i = 1; i <= numSteps; i++) {
        const t = i / numSteps;
        
        // Thêm độ cong (bezier đơn giản) và jitter
        const jitterX = Math.sin(t * Math.PI * 3) * (Math.random() * 3);
        const jitterY = Math.cos(t * Math.PI * 2) * (Math.random() * 3);
        
        // Đường cong cubic bezier đơn giản hóa
        const controlOffset = distance * 0.15;
        const bx = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * (fromX + (Math.random() - 0.5) * controlOffset) + t * t * targetX;
        const by = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * (fromY + (Math.random() - 0.5) * controlOffset) + t * t * targetY;
        
        await page.mouse.move(bx + jitterX, by + jitterY);
        
        // Micro-pause mỗi bước (tốc độ không đều)
        const stepDelay = 5 + Math.floor(Math.random() * 15);
        await new Promise(resolve => setTimeout(resolve, stepDelay));
    }
    
    // Lưu tọa độ chuột hiện tại
    await page.evaluate(({ x, y }) => { window.mouseX = x; window.mouseY = y; }, { x: targetX, y: targetY }).catch(() => {});
}

/**
 * Click giống người thật: di chuột đến vị trí, pause nhẹ, click
 */
async function humanLikeClick(page, locator, { delay = null } = {}) {
    const count = await locator.count().catch(() => 0);
    if (!count) return false;
    
    const target = locator.first();
    const box = await target.boundingBox().catch(() => null);
    if (!box) return false;
    
    // Click vào vị trí hơi lệch trong element (như người dùng thật)
    const offsetX = box.width * (0.2 + Math.random() * 0.6);
    const offsetY = box.height * (0.2 + Math.random() * 0.6);
    const centerX = box.x + offsetX;
    const centerY = box.y + offsetY;
    
    await humanLikeMouseMove(page, centerX, centerY);
    await randomWait(100, 400);
    
    await page.mouse.click(centerX, centerY, {
        delay: delay || Math.floor(Math.random() * 150) + 30
    });
    
    return true;
}

/**
 * Cuộn trang giống người thật (có gia tốc, giảm tốc)
 * @param {object} page - Playwright page
 * @param {number} distance - Khoảng cách cuộn (px)
 * @param {number} direction - 1: xuống, -1: lên
 */
async function humanLikeScroll(page, distance, direction = 1) {
    const absDistance = Math.abs(distance);
    const totalSteps = Math.max(5, Math.floor(absDistance / 80));
    
    // Cuộn với gia tốc (bắt đầu chậm, nhanh dần, chậm dần)
    for (let step = 0; step < totalSteps; step++) {
        const progress = step / totalSteps;
        // Hàm easing: slow -> fast -> slow
        let easeFactor;
        if (progress < 0.3) {
            easeFactor = progress / 0.3; // tăng tốc
        } else if (progress < 0.7) {
            easeFactor = 1; // tốc độ tối đa
        } else {
            easeFactor = (1 - progress) / 0.3; // giảm tốc
        }
        
        const scrollAmount = Math.max(5, Math.floor(easeFactor * 60 + Math.random() * 20));
        await page.mouse.wheel(0, scrollAmount * direction);
        await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 30)));
    }
}

/**
 * Tương tác ngẫu nhiên với bài viết Facebook (like, thả tim, comment)
 */
async function performRandomReaction(page) {
    try {
        // Chọn ngẫu nhiên hành động
        const actionType = Math.floor(Math.random() * 4);
        
        if (actionType === 0) {
            // Like bài viết
            const likeSelectors = [
                'div[aria-label="Thích"]',
                'div[aria-label="Like"]',
                'span[aria-label="Thích"]',
                'span[aria-label="Like"]'
            ];
            
            for (const sel of likeSelectors) {
                const buttons = page.locator(sel);
                const count = await buttons.count().catch(() => 0);
                if (count > 0) {
                    const idx = Math.floor(Math.random() * Math.min(count, 3));
                    const btn = buttons.nth(idx);
                    const isVisible = await btn.isVisible().catch(() => false);
                    if (isVisible) {
                        await btn.scrollIntoViewIfNeeded().catch(() => {});
                        await randomWait(700, 2000);
                        await humanLikeClick(page, btn);
                        return true;
                    }
                }
            }
        } else if (actionType === 1) {
            // Thả tim
            const heartSelectors = [
                'div[aria-label="Yêu thích"]',
                'div[aria-label="Love"]',
                'span[aria-label="Yêu thích"]',
                'span[aria-label="Love"]'
            ];
            
            for (const sel of heartSelectors) {
                const buttons = page.locator(sel);
                const count = await buttons.count().catch(() => 0);
                if (count > 0) {
                    const idx = Math.floor(Math.random() * Math.min(count, 3));
                    const btn = buttons.nth(idx);
                    const isVisible = await btn.isVisible().catch(() => false);
                    if (isVisible) {
                        await btn.scrollIntoViewIfNeeded().catch(() => {});
                        await randomWait(500, 1500);
                        await humanLikeClick(page, btn);
                        return true;
                    }
                }
            }
        } else if (actionType === 2) {
            // Click xem comment
            const commentSelectors = [
                'div[aria-label="Bình luận"]',
                'div[aria-label="Comment"]',
                'span[aria-label="Bình luận"]'
            ];
            
            for (const sel of commentSelectors) {
                const buttons = page.locator(sel);
                const count = await buttons.count().catch(() => 0);
                if (count > 0) {
                    const idx = Math.floor(Math.random() * Math.min(count, 3));
                    const btn = buttons.nth(idx);
                    const isVisible = await btn.isVisible().catch(() => false);
                    if (isVisible) {
                        await btn.scrollIntoViewIfNeeded().catch(() => {});
                        await randomWait(1000, 2500);
                        await humanLikeClick(page, btn);
                        return true;
                    }
                }
            }
        } else {
            // Click share
            const shareSelectors = [
                'div[aria-label="Chia sẻ"]',
                'div[aria-label="Share"]',
                'span[aria-label="Chia sẻ"]'
            ];
            
            for (const sel of shareSelectors) {
                const buttons = page.locator(sel);
                const count = await buttons.count().catch(() => 0);
                if (count > 0) {
                    const idx = Math.floor(Math.random() * Math.min(count, 3));
                    const btn = buttons.nth(idx);
                    const isVisible = await btn.isVisible().catch(() => false);
                    if (isVisible) {
                        await btn.scrollIntoViewIfNeeded().catch(() => {});
                        await randomWait(800, 2000);
                        await humanLikeClick(page, btn);
                        return true;
                    }
                }
            }
        }
    } catch (e) {
        // Silent fail
    }
    return false;
}

/**
 * Scroll feed và tương tác nhẹ (warm-up trước khi đăng)
 * @param {object} page - Playwright page
 * @param {number} minInteractions - Số tương tác tối thiểu
 * @param {number} maxInteractions - Số tương tác tối đa
 */
async function warmUp(page, { minInteractions = 3, maxInteractions = 6 } = {}) {
    const totalActions = Math.floor(Math.random() * (maxInteractions - minInteractions + 1)) + minInteractions;
    
    for (let i = 0; i < totalActions; i++) {
        // Scroll xuống
        await humanLikeScroll(page, 300 + Math.floor(Math.random() * 700));
        await randomWait(1500, 3500);
        
        // Đôi khi tương tác
        if (Math.random() < 0.35) {
            await performRandomReaction(page);
            await randomWait(1500, 3000);
        }
        
        // Đôi khi dừng lại đọc (không làm gì) như người dùng thật
        if (Math.random() < 0.25) {
            await randomWait(2500, 5000);
        }
        
        // Di chuyển chuột lung tung
        const vp = page.viewportSize() || { width: 1366, height: 768 };
        await humanLikeMouseMove(page,
            Math.floor(Math.random() * vp.width * 0.8) + vp.width * 0.1,
            Math.floor(Math.random() * vp.height * 0.8) + vp.height * 0.1
        );
        await randomWait(300, 800);
    }
}

/**
 * Hành vi sau khi đăng bài - giống người thật vừa đăng xong
 * - Scroll lên/xuống
 * - Like/thả tim bài viết vừa đăng (nếu thấy)
 * - Tương tác nhẹ
 * - Chờ 5-10s rồi mới đóng
 */
async function simulateHumanAfterPost(page, { 
    minWait = 5000, 
    maxWait = 10000,
    shouldLikeOwnPost = true 
} = {}) {
    console.log('[HumanBehavior] Simulating human behavior after post...');
    
    // 1. Cuộn nhẹ lên để xem lại bài đăng
    await humanLikeScroll(page, -150, -1);
    await randomWait(1000, 2500);
    
    // 2. Cuộn xuống một chút
    await humanLikeScroll(page, 400, 1);
    await randomWait(1500, 3000);
    
    // 3. Tương tác ngẫu nhiên với feed
    const interactions = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < interactions; i++) {
        await performRandomReaction(page);
        await randomWait(1500, 3500);
        
        // Di chuyển chuột
        const vp = page.viewportSize() || { width: 1366, height: 768 };
        await humanLikeMouseMove(page,
            Math.floor(Math.random() * vp.width),
            Math.floor(Math.random() * vp.height)
        );
        await randomWait(500, 1500);
    }
    
    // 4. Nếu shouldLikeOwnPost, tìm và like bài viết vừa đăng
    if (shouldLikeOwnPost) {
        try {
            // Tìm nút like gần nhất có thể là bài vừa đăng
            const likeBtns = page.locator('div[aria-label="Like"], div[aria-label="Thích"]');
            const count = await likeBtns.count().catch(() => 0);
            if (count > 0) {
                const btn = likeBtns.first();
                const isVisible = await btn.isVisible().catch(() => false);
                if (isVisible) {
                    await randomWait(2000, 4000);
                    await humanLikeClick(page, btn);
                    console.log('[HumanBehavior] Liked own post');
                    await randomWait(1000, 2000);
                }
            }
        } catch (e) {
            // ignore
        }
    }
    
    // 5. Chờ 5-10s trước khi kết thúc
    const finalWait = gaussianRandom(minWait, 1000, minWait, maxWait);
    console.log(`[HumanBehavior] Final wait ${finalWait}ms before closing...`);
    await new Promise(resolve => setTimeout(resolve, finalWait));
    
    console.log('[HumanBehavior] Human behavior simulation complete');
}

/**
 * Enhanced anti-detection init script để inject vào mọi page
 * Giúp trình duyệt trông giống người dùng thật hơn
 */
function getAntiDetectionScript() {
    return `
        // --- Ghi đè webdriver ---
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        // --- Xóa chrome.runtime ---
        if (window.chrome && window.chrome.runtime) {
            delete window.chrome.runtime;
        }
        
        // --- plugins giả ---
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client', filename: 'internal-nacl-plugin' }
            ]
        });
        
        // --- languages đầy đủ ---
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
        
        // --- permissions API fake ---
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = (params) => {
            if (params.name === 'notifications' || params.name === 'clipboard-read' || params.name === 'clipboard-write') {
                return Promise.resolve({ state: 'prompt', onchange: null });
            }
            return originalQuery(params);
        };
        
        // --- WebGL vendor fake ---
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
            if (param === 37445) return 'Intel Inc.';
            if (param === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.call(this, param);
        };
        
        // --- Canvas fingerprint noise (nhẹ, không làm hỏng chức năng) ---
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
            const canvas = this;
            const context = canvas.getContext('2d');
            if (context) {
                // Chỉ thêm noise rất nhẹ để khác biệt fingerprint
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const pixels = imageData.data;
                for (let i = 0; i < pixels.length; i += 4) {
                    pixels[i] = pixels[i] ^ (Math.random() > 0.99 ? 1 : 0);
                }
                context.putImageData(imageData, 0, 0);
            }
            return originalToDataURL.call(this, type);
        };
        
        // --- Theo dõi vị trí chuột để humanLikeClick dùng ---
        document.addEventListener('mousemove', (e) => {
            window.mouseX = e.clientX;
            window.mouseY = e.clientY;
        });
        
        // --- Thêm div ẩn chứa thông tin "trình duyệt thật" ---
        const hiddenDiv = document.createElement('div');
        hiddenDiv.style.display = 'none';
        hiddenDiv.id = 'fb-automation-marker';
        hiddenDiv.setAttribute('data-automation', 'false');
        document.documentElement.appendChild(hiddenDiv);
    `;
}

module.exports = {
    randomWait,
    gaussianRandom,
    humanLikeTyping,
    humanLikeMouseMove,
    humanLikeClick,
    humanLikeScroll,
    performRandomReaction,
    warmUp,
    simulateHumanAfterPost,
    getAntiDetectionScript
};