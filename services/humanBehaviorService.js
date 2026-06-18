const { platform } = require('os');

// ====== TIỆN ÍCH ======

function randomWait(min, max) {
    return new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));
}

function gaussianRandom(mean, std, min = 0, max = Infinity) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    num = num * std + mean;
    return Math.min(max, Math.max(min, Math.round(num)));
}

/**
 * Gõ text vào element đang được focus - dùng insertText cho nhanh,
 * nếu không được thì fallback về type từng ký tự
 * 
 * ⚠️ LƯU Ý: pressSequentially là locator method, KHÔNG PHẢI keyboard method
 *    page.keyboard.pressSequentially() KHÔNG TỒN TẠI
 *    => Luôn dùng page.keyboard.type() hoặc locator.pressSequentially()
 */
async function humanLikeTyping(page, text) {
    if (!text || !text.length) return;
    
    console.log(`\n===== [humanLikeTyping] START =====`);
    console.log(`[humanLikeTyping] text length=${text.length}, preview="${text.substring(0, 100)}"`);
    
    // Bước 1: Log activeElement trước khi gõ
    try {
        const info = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el) return { exists: false, reason: 'No active element' };
            return {
                tag: el.tagName,
                editable: el.isContentEditable || el.getAttribute('contenteditable'),
                role: el.getAttribute('role') || ''
            };
        });
        console.log(`[humanLikeTyping] activeElement BEFORE:`, JSON.stringify(info));
    } catch (e) {
        console.log(`[humanLikeTyping] Can't get activeElement:`, e.message);
    }
    
    // Bước 2: Thử insertText trước (nhanh nhất - chèn nguyên text cùng lúc)
    try {
        await page.evaluate((t) => {
            const el = document.activeElement;
            if (!el) return;
            // Dùng document.execCommand('insertText') - Facebook Lexical chấp nhận
            const sel = window.getSelection();
            if (sel && el.isContentEditable) {
                sel.collapse(el, 0);
                document.execCommand('insertText', false, t);
            }
        }, text);
        console.log(`[humanLikeTyping] insertText done`);
    } catch (e) {
        console.log(`[humanLikeTyping] insertText failed:`, e.message);
    }
    
    await page.waitForTimeout(100);
    
    // Bước 3: Verify - nếu text đã được nhập thì thôi
    let typedOk = false;
    try {
        const after = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el) return '';
            return (el.textContent || el.innerText || el.value || '');
        });
        typedOk = after.includes(text.substring(0, 20));
        console.log(`[humanLikeTyping] After insertText: length=${after.length}, includes="${text.substring(0,20)}"? ${typedOk}`);
    } catch (e) {
        console.log(`[humanLikeTyping] Verify error:`, e.message);
    }
    
    // Bước 4: Nếu insertText không được, fallback type từng ký tự
    if (!typedOk) {
        console.log(`[humanLikeTyping] insertText failed, fallback to type()...`);
        for (let i = 0; i < text.length; i++) {
            await page.keyboard.type(text[i], { delay: 0 });
            // Thỉnh thoảng yield cho event loop
            if (i % 50 === 0) await new Promise(r => setImmediate(r));
        }
        console.log(`[humanLikeTyping] Fallback type() done`);
        
        await page.waitForTimeout(100);
        
        try {
            const after = await page.evaluate(() => {
                const el = document.activeElement;
                if (!el) return '';
                return (el.textContent || el.innerText || el.value || '').substring(0, 200);
            });
            console.log(`[humanLikeTyping] After fallback (first 200): "${after}"`);
        } catch (e) {}
    }
    
    console.log(`===== [humanLikeTyping] END =====\n`);
}

/**
 * Di chuyển chuột giống người thật
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
 * Scroll feed và tương tác nhẹ
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
        // === 1. navigator.webdriver ===
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        delete navigator.__proto__.webdriver;

        // === 2. window.chrome ===
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.runtime) {
            window.chrome.runtime = {
                connect: function(){},
                sendMessage: function(){},
                onMessage: { addListener: function(){}, removeListener: function(){} },
                id: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
                PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
                PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
                PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
                RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
                OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
                OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }
            };
        }
        if (!window.chrome.csi) window.chrome.csi = function(){ return { onloadT: Date.now(), startE: Date.now(), pageT: Date.now() - performance.timing.navigationStart }; };
        if (!window.chrome.loadTimes) window.chrome.loadTimes = function(){ return { requestTime: Date.now()/1000 - 1, startLoadTime: Date.now()/1000 - 0.5, commitLoadTime: Date.now()/1000, finishDocumentLoadTime: Date.now()/1000 + 0.5, firstPaintTime: Date.now()/1000 + 0.3, finishLoadTime: Date.now()/1000 + 1, navigationType: 'Other' }; };

        // === 3. plugins ===
        Object.defineProperty(navigator, 'plugins', {
            get: function() {
                var p = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 }
                ];
                p.refresh = function(){};
                p.item = function(i){ return this[i]; };
                p.namedItem = function(n){ for(var i=0;i<this.length;i++) if(this[i].name===n) return this[i]; return null; };
                return p;
            }
        });

        // === 4. languages ===
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'language', { get: () => 'vi-VN' });

        // === 5. permissions ===
        var origQuery = navigator.permissions.query;
        navigator.permissions.query = function(p) {
            if (p.name === 'notifications') return Promise.resolve({ state: 'prompt', onchange: null });
            return origQuery.call(this, p);
        };

        // === 6. WebGL ===
        var origGetParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(p) {
            if (p === 37445) return 'Intel Inc.';
            if (p === 37446) return 'Intel Iris OpenGL Engine';
            return origGetParam.call(this, p);
        };
        var origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(p) {
            if (p === 37445) return 'Intel Inc.';
            if (p === 37446) return 'Intel Iris OpenGL Engine';
            return origGetParam2.call(this, p);
        };

        // === 7. hardwareConcurrency & deviceMemory ===
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

        // === 8. platform ===
        Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

        // === 9. connection ===
        if (navigator.connection) {
            Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
        }

        // === 10. Remove automation markers ===
        delete window.__playwright;
        delete window.__pw_manual;
        delete window.__PW_inspect;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_JSON;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Proxy;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Object;

        // === 11. Notification.permission ===
        if (window.Notification) {
            Object.defineProperty(Notification, 'permission', { get: () => 'default' });
        }

        // === 12. MediaDevices ===
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            var origEnum = navigator.mediaDevices.enumerateDevices;
            navigator.mediaDevices.enumerateDevices = function() {
                return Promise.resolve([
                    { deviceId: '', groupId: '', kind: 'audioinput', label: '' },
                    { deviceId: '', groupId: '', kind: 'audiooutput', label: '' },
                    { deviceId: '', groupId: '', kind: 'videoinput', label: '' }
                ]);
            };
        }

        // === 13. screen properties ===
        Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
        Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

        // === 14. Max touch points ===
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

        // === 15. vendor ===
        Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });

        // === 16. Do Not Track ===
        Object.defineProperty(navigator, 'doNotTrack', { get: () => null });

        // === 17. cookieEnabled ===
        Object.defineProperty(navigator, 'cookieEnabled', { get: () => true });

        // === 18. Remove iframe detection ===
        if (window.frameElement) {
            Object.defineProperty(window, 'frameElement', { get: () => null });
        }

        // === 19. Instagram-specific: override toString để tránh bị check ===
        var origToString = Function.prototype.toString;
        Function.prototype.toString = function() {
            if (this === navigator.permissions.query) return 'function query() { [native code] }';
            if (this === navigator.mediaDevices.enumerateDevices) return 'function enumerateDevices() { [native code] }';
            return origToString.call(this);
        };

        // === 20. Override getComputedStyle để không bị detect ===
        var origGetComputedStyle = window.getComputedStyle;
        window.getComputedStyle = function(el, pseudo) {
            var style = origGetComputedStyle.call(this, el, pseudo);
            // Thêm missing properties mà Instagram check
            if (!style.fontDisplay) {
                Object.defineProperty(style, 'fontDisplay', { get: () => 'auto' });
            }
            return style;
        };

        // === 21. Fix Date/timezone一致性 ===
        var origDate = Date;
        var dateOffset = 0;
        Date = function() {
            return new origDate(origDate.now() + dateOffset);
        };
        Date.now = function() { return origDate.now() + dateOffset; };
        Date.prototype = origDate.prototype;
        Date.parse = origDate.parse;
        Date.UTC = origDate.UTC;
        Date.prototype.constructor = Date;

        // === 22. Override Error.prepareStackTrace để stack trace看起来正常 ===
        if (Error.prepareStackTrace) {
            var origPrepareStackTrace = Error.prepareStackTrace;
            Error.prepareStackTrace = function(error, structuredStackTrace) {
                var filtered = structuredStackTrace.filter(function(callSite) {
                    var name = callSite.getFileName() || '';
                    return !name.includes('playwright') && !name.includes('puppeteer');
                });
                return origPrepareStackTrace(error, filtered);
            };
        }
    `;
}

/**
 * Warm-up Instagram login page - mô phỏng hành vi người thật trước khi đăng nhập
 * Giúp tránh bị detect là bot ngay khi vừa mở trang
 */
async function warmUpInstagramPage(page) {
    console.log(`[IG WarmUp] Bắt đầu mô phỏng hành vi người thật...`);

    try {
        // 1. Đợi trang tải hoàn toàn
        await page.waitForLoadState('networkidle').catch(() => {});
        await randomWait(2000, 4000);

        // 2. Di chuyển chuột ngẫu nhiên khắp trang (giống người đang nhìn trang)
        const vp = page.viewportSize() || { width: 1280, height: 800 };
        for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
            const randX = Math.floor(Math.random() * vp.width * 0.7) + vp.width * 0.15;
            const randY = Math.floor(Math.random() * vp.height * 0.7) + vp.height * 0.15;
            await humanLikeMouseMove(page, randX, randY);
            await randomWait(800, 2000);
        }

        // 3. Scroll nhẹ xuống (giống người đang đọc trang login)
        await humanLikeScroll(page, 100 + Math.floor(Math.random() * 200));
        await randomWait(1500, 3000);

        // 4. Scroll lên lại
        await humanLikeScroll(page, -(50 + Math.floor(Math.random() * 100)));
        await randomWait(1000, 2500);

        // 5. Di chuyển chuột về vùng login form (giữa trang)
        const centerX = vp.width / 2 + (Math.random() - 0.5) * 200;
        const centerY = vp.height / 2 + (Math.random() - 0.5) * 100;
        await humanLikeMouseMove(page, centerX, centerY);
        await randomWait(500, 1500);

        // 6. Thỉnh thoảng giả vờ click vào vùng trống (không có gì)
        if (Math.random() < 0.3) {
            const emptyX = Math.floor(Math.random() * vp.width * 0.3) + vp.width * 0.05;
            const emptyY = vp.height * 0.8 + Math.floor(Math.random() * 50);
            await page.mouse.click(emptyX, emptyY, { delay: 50 + Math.floor(Math.random() * 100) });
            await randomWait(500, 1000);
        }

        // 7. Đợi thêm một chút như người đang đọc
        await randomWait(1000, 2000);

        console.log(`[IG WarmUp] Hoàn thành warm-up`);
    } catch (e) {
        console.warn(`[IG WarmUp] Lỗi: ${e.message}`);
    }
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
    getAntiDetectionScript,
    warmUpInstagramPage
};