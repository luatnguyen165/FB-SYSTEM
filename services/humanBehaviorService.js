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
 * Gõ text vào Facebook contenteditable
 * 
 * ⚠️ Facebook dùng Lexical Editor (rich text custom) - không chấp nhận textContent hay InputEvent
 * => Phải dùng pressSequentially để gõ từng ký tự qua keyboard, delay siêu thấp (1-3ms)
 * 
 * @param {object} page - Playwright page
 * @param {string} text - Nội dung cần gõ
 */
async function humanLikeTyping(page, text) {
    if (!text || !text.length) return;
    
    const activeEl = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        return {
            tag: el.tagName,
            editable: el.isContentEditable || el.getAttribute('contenteditable') === 'true',
            role: el.getAttribute('role') || '',
            placeholder: el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
        };
    }).catch(() => null);
    
    console.log(`[humanLikeTyping] activeElement:`, JSON.stringify(activeEl));
    console.log(`[humanLikeTyping] text length=${text.length}, preview="${text.substring(0, 50)}..."`);

    // Dùng pressSequentially với delay 1-3ms để Facebook Lexical Editor nhận biết
    await page.keyboard.pressSequentially(text, { delay: 1 + Math.floor(Math.random() * 2) });
    
    // Verify text đã được nhập
    const afterText = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return '';
        return el.textContent || el.innerText || el.value || '';
    }).catch(() => '');
    
    console.log(`[humanLikeTyping] After typing, length=${afterText.length}`);
    
    if (afterText.length < text.length * 0.5) {
        console.log(`[humanLikeTyping] Text too short (${afterText.length}/${text.length}), trying fallback...`);
        // Fallback: thử fill
        try {
            const locator = page.locator(':focus').first();
            if (await locator.count() > 0) {
                await locator.fill(text);
                console.log('[humanLikeTyping] Fallback fill() worked');
            }
        } catch (e) {
            console.log('[humanLikeTyping] Fallback fill() failed:', e.message);
            // Fallback cuối: type từng ký tự
            for (let i = 0; i < text.length; i++) {
                await page.keyboard.type(text[i], { delay: 1 });
            }
        }
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
    
    const numSteps = steps || Math.max(8, Math.floor(distance / 10) + Math.floor(Math.random() * 5));
    
    for (let i = 1; i <= numSteps; i++) {
        const t = i / numSteps;
        const jitterX = Math.sin(t * Math.PI * 3) * (Math.random() * 3);
        const jitterY = Math.cos(t * Math.PI * 2) * (Math.random() * 3);
        const controlOffset = distance * 0.15;
        const bx = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * (fromX + (Math.random() - 0.5) * controlOffset) + t * t * targetX;
        const by = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * (fromY + (Math.random() - 0.5) * controlOffset) + t * t * targetY;
        
        await page.mouse.move(bx + jitterX, by + jitterY);
        const stepDelay = 5 + Math.floor(Math.random() * 15);
        await new Promise(resolve => setTimeout(resolve, stepDelay));
    }
    
    await page.evaluate(({ x, y }) => { window.mouseX = x; window.mouseY = y; }, { x: targetX, y: targetY }).catch(() => {});
}

/**
 * Click giống người thật
 */
async function humanLikeClick(page, locator, { delay = null } = {}) {
    const count = await locator.count().catch(() => 0);
    if (!count) return false;
    
    const target = locator.first();
    const box = await target.boundingBox().catch(() => null);
    if (!box) return false;
    
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
 * Cuộn trang giống người thật
 */
async function humanLikeScroll(page, distance, direction = 1) {
    const absDistance = Math.abs(distance);
    const totalSteps = Math.max(5, Math.floor(absDistance / 80));
    
    for (let step = 0; step < totalSteps; step++) {
        const progress = step / totalSteps;
        let easeFactor;
        if (progress < 0.3) {
            easeFactor = progress / 0.3;
        } else if (progress < 0.7) {
            easeFactor = 1;
        } else {
            easeFactor = (1 - progress) / 0.3;
        }
        
        const scrollAmount = Math.max(5, Math.floor(easeFactor * 60 + Math.random() * 20));
        await page.mouse.wheel(0, scrollAmount * direction);
        await new Promise(resolve => setTimeout(resolve, 20 + Math.floor(Math.random() * 30)));
    }
}

/**
 * Tương tác ngẫu nhiên với bài viết Facebook
 */
async function performRandomReaction(page) {
    try {
        const actionType = Math.floor(Math.random() * 4);
        
        if (actionType === 0) {
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
 */
async function warmUp(page, { minInteractions = 3, maxInteractions = 6 } = {}) {
    const totalActions = Math.floor(Math.random() * (maxInteractions - minInteractions + 1)) + minInteractions;
    
    for (let i = 0; i < totalActions; i++) {
        await humanLikeScroll(page, 300 + Math.floor(Math.random() * 700));
        await randomWait(1500, 3500);
        
        if (Math.random() < 0.35) {
            await performRandomReaction(page);
            await randomWait(1500, 3000);
        }
        
        if (Math.random() < 0.25) {
            await randomWait(2500, 5000);
        }
        
        const vp = page.viewportSize() || { width: 1366, height: 768 };
        await humanLikeMouseMove(page,
            Math.floor(Math.random() * vp.width * 0.8) + vp.width * 0.1,
            Math.floor(Math.random() * vp.height * 0.8) + vp.height * 0.1
        );
        await randomWait(300, 800);
    }
}

/**
 * Hành vi sau khi đăng bài
 */
async function simulateHumanAfterPost(page, { 
    minWait = 5000, 
    maxWait = 10000,
    shouldLikeOwnPost = true 
} = {}) {
    console.log('[HumanBehavior] Simulating human behavior after post...');
    
    await humanLikeScroll(page, -150, -1);
    await randomWait(1000, 2500);
    
    await humanLikeScroll(page, 400, 1);
    await randomWait(1500, 3000);
    
    const interactions = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < interactions; i++) {
        await performRandomReaction(page);
        await randomWait(1500, 3500);
        
        const vp = page.viewportSize() || { width: 1366, height: 768 };
        await humanLikeMouseMove(page,
            Math.floor(Math.random() * vp.width),
            Math.floor(Math.random() * vp.height)
        );
        await randomWait(500, 1500);
    }
    
    if (shouldLikeOwnPost) {
        try {
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
    
    const finalWait = gaussianRandom(minWait, 1000, minWait, maxWait);
    console.log(`[HumanBehavior] Final wait ${finalWait}ms before closing...`);
    await new Promise(resolve => setTimeout(resolve, finalWait));
    
    console.log('[HumanBehavior] Human behavior simulation complete');
}

/**
 * Enhanced anti-detection init script
 */
function getAntiDetectionScript() {
    return `
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        
        if (window.chrome && window.chrome.runtime) {
            delete window.chrome.runtime;
        }
        
        Object.defineProperty(navigator, 'plugins', {
            get: () => [
                { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                { name: 'Native Client', filename: 'internal-nacl-plugin' }
            ]
        });
        
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
        
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = (params) => {
            if (params.name === 'notifications' || params.name === 'clipboard-read' || params.name === 'clipboard-write') {
                return Promise.resolve({ state: 'prompt', onchange: null });
            }
            return originalQuery(params);
        };
        
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
            if (param === 37445) return 'Intel Inc.';
            if (param === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.call(this, param);
        };
        
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
            const canvas = this;
            const context = canvas.getContext('2d');
            if (context) {
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const pixels = imageData.data;
                for (let i = 0; i < pixels.length; i += 4) {
                    pixels[i] = pixels[i] ^ (Math.random() > 0.99 ? 1 : 0);
                }
                context.putImageData(imageData, 0, 0);
            }
            return originalToDataURL.call(this, type);
        };
        
        document.addEventListener('mousemove', (e) => {
            window.mouseX = e.clientX;
            window.mouseY = e.clientY;
        });
        
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