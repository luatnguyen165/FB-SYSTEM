// services/facebookBypassService.js
// Facebook Auto-Report Bypass: watermark, credits, delays, metadata modification
// Giúp video cross-posted từ TikTok/Douyin không bị Facebook flag là "unoriginal content"

// ============================================================
// REBROWSER-PATCHES: Fix CDP Runtime.Enable leak
// Phải set TRƯỚC KHI load playwright
// ============================================================
if (!process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE) {
    process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = 'addBinding';
    console.log('[Bypass] REBROWSER_PATCHES_RUNTIME_FIX_MODE = addBinding');
}

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// ANTI-DETECT: Browser Fingerprint Injection
// ============================================================

/**
 * Script inject vào browser để bypass Facebook fingerprint detection
 *涵盖了:
 * - navigator.webdriver = false
 * - WebGL vendor/renderer spoofing
 * - Canvas fingerprint noise
 * - Timing randomization
 * - CDP Runtime.enable leak fix
 */
const ANTI_DETECT_SCRIPT = `
// ============================================
// FULL STEALTH: Comprehensive fingerprint bypass
// Covers: webdriver, CDP, canvas, WebGL, audio,
// fonts, timezone, plugins, WebRTC, permissions
// ============================================

// ===== 1. navigator.webdriver =====
try { delete Object.getPrototypeOf(navigator).webdriver; } catch(e) {}
Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
try {
    const navProto = Object.getPrototypeOf(navigator);
    const desc = Object.getOwnPropertyDescriptor(navProto, 'webdriver');
    if (desc) Object.defineProperty(navProto, 'webdriver', { get: () => undefined, configurable: true });
} catch(e) {}

// ===== 2. Remove CDP/Playwright artifacts =====
delete window.__pwInitScripts;
delete window.__playwright;
delete window.__playwright_evaluation_script__;
try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array; } catch(e) {}
try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise; } catch(e) {}
try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol; } catch(e) {}
try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_JSON; } catch(e) {}
try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Object; } catch(e) {}
try { delete window.cdc_adoQpoasnfa76pfcZLmcfl_Proxy; } catch(e) {}

// ===== 3. Chrome runtime (ensure exists) =====
if (!window.chrome) window.chrome = {};
if (!window.chrome.runtime) window.chrome.runtime = { connect: () => {}, sendMessage: () => {} };

// ===== 4. iframe contentWindow =====
const origCreateElement = document.createElement.bind(document);
document.createElement = function(tag) {
    const el = origCreateElement(tag);
    if (tag.toLowerCase() === 'iframe') {
        const origCW = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
        Object.defineProperty(el, 'contentWindow', {
            get: function() {
                const win = origCW.get.call(this);
                if (win) {
                    try { Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined, configurable: true }); } catch(e) {}
                }
                return win;
            },
            configurable: true,
        });
    }
    return el;
};

// ===== 5. Canvas Fingerprint Noise =====
// Thêm noise cực nhỏ vào canvas toDataURL/toBlob để phá fingerprint
(function() {
    const noiseLevel = 1; // ±1 pixel value (không nhìn thấy)
    try {
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function() {
            try {
                const ctx = this.getContext('2d');
                if (ctx) {
                    const w = this.width, h = this.height;
                    if (w > 16 && h > 16) {
                        const imageData = ctx.getImageData(0, 0, Math.min(w, 16), Math.min(h, 16));
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i += 4) {
                            data[i] = Math.max(0, Math.min(255, data[i] + ((i % 3 === 0) ? noiseLevel : -noiseLevel)));
                        }
                        ctx.putImageData(imageData, 0, 0);
                    }
                }
            } catch(e) {}
            return origToDataURL.apply(this, arguments);
        };

        const origToBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function() {
            try {
                const ctx = this.getContext('2d');
                if (ctx) {
                    const w = this.width, h = this.height;
                    if (w > 16 && h > 16) {
                        const imageData = ctx.getImageData(0, 0, Math.min(w, 16), Math.min(h, 16));
                        const data = imageData.data;
                        for (let i = 0; i < data.length; i += 4) {
                            data[i] = Math.max(0, Math.min(255, data[i] + ((i % 3 === 0) ? noiseLevel : -noiseLevel)));
                        }
                        ctx.putImageData(imageData, 0, 0);
                    }
                }
            } catch(e) {}
            return origToBlob.apply(this, arguments);
        };
    } catch(e) {}
})();

// ===== 6. WebGL Fingerprint Spoofing =====
(function() {
    try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        const getParameter2 = (typeof WebGL2RenderingContext !== 'undefined') ? WebGL2RenderingContext.prototype.getParameter : null;

        const spoofParam = function(param) {
            // UNMASKED_VENDOR_WEBGL
            if (param === 37445) return 'Intel Inc.';
            // UNMASKED_RENDERER_WEBGL
            if (param === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.call(this, param);
        };

        WebGLRenderingContext.prototype.getParameter = spoofParam;
        if (getParameter2) {
            WebGL2RenderingContext.prototype.getParameter = spoofParam;
        }

        // Spoof getExtension for debug info
        const origGetExtension = WebGLRenderingContext.prototype.getExtension;
        WebGLRenderingContext.prototype.getExtension = function(name) {
            const ext = origGetExtension.call(this, name);
            if (name === 'WEBGL_debug_renderer_info' && ext) {
                return Object.create(ext, {
                    UNMASKED_VENDOR_WEBGL: { value: 37445 },
                    UNMASKED_RENDERER_WEBGL: { value: 37446 }
                });
            }
            return ext;
        };
    } catch(e) {}
})();

// ===== 7. AudioContext Fingerprint Noise =====
(function() {
    try {
        const origCreateOscillator = AudioContext.prototype.createOscillator;
        AudioContext.prototype.createOscillator = function() {
            const osc = origCreateOscillator.call(this);
            try {
                const origFreq = Object.getOwnPropertyDescriptor(OscillatorNode.prototype, 'frequency');
                if (origFreq && origFreq.get) {
                    const origGet = origFreq.get;
                    Object.defineProperty(osc.frequency, 'value', {
                        get: function() {
                            return origGet.call(this) + (Math.random() * 0.001);
                        },
                        set: function(v) { origFreq.set.call(this, v); },
                        configurable: true
                    });
                }
            } catch(e2) {}
            return osc;
        };

        // Spoof AnalyserNode getFloatFrequencyData
        const origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
        if (origGetFloat) {
            AnalyserNode.prototype.getFloatFrequencyData = function(array) {
                origGetFloat.call(this, array);
                for (let i = 0; i < array.length; i++) {
                    array[i] += (Math.random() * 0.0001);
                }
            };
        }
    } catch(e) {}
})();

// ===== 8. navigator.plugins spoofing =====
(function() {
    try {
        const plugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ];

        Object.defineProperty(navigator, 'plugins', {
            get: function() {
                const arr = plugins.map((p, i) => {
                    const plugin = Object.create(Plugin.prototype, {
                        name: { value: p.name },
                        filename: { value: p.filename },
                        description: { value: p.description },
                        length: { value: 1 },
                        item: { value: function(i) { return null; } },
                        namedItem: { value: function(n) { return null; } }
                    });
                    return plugin;
                });
                arr.item = function(i) { return arr[i] || null; };
                arr.namedItem = function(n) { return arr.find(p => p.name === n) || null; };
                arr.refresh = function() {};
                return arr;
            },
            configurable: true
        });
    } catch(e) {}
})();

// ===== 9. navigator.languages =====
(function() {
    try {
        Object.defineProperty(navigator, 'languages', {
            get: function() { return ['en-US', 'en']; },
            configurable: true
        });
    } catch(e) {}
})();

// ===== 10. Permissions API =====
(function() {
    try {
        const origQuery = navigator.permissions?.query;
        if (origQuery) {
            navigator.permissions.query = function(desc) {
                if (desc && desc.name === 'notifications') {
                    return Promise.resolve({ state: Notification.permission || 'default', onchange: null });
                }
                return origQuery.call(this, desc);
            };
        }
    } catch(e) {}
})();

// ===== 11. WebRTC Leak Protection =====
// Prevent local IP leak via WebRTC
(function() {
    try {
        const origRTC = window.RTCPeerConnection;
        if (origRTC) {
            window.RTCPeerConnection = function() {
                const pc = new origRTC(...arguments);
                try {
                    const origCreateDataChannel = pc.createDataChannel.bind(pc);
                    pc.createDataChannel = function() {
                        return origCreateDataChannel.apply(this, arguments);
                    };
                } catch(e) {}
                return pc;
            };
            window.RTCPeerConnection.prototype = origRTC.prototype;

            // Override ICE candidate to filter local IPs
            const origAddIce = RTCPeerConnection.prototype.addIceCandidate;
            if (origAddIce) {
                RTCPeerConnection.prototype.addIceCandidate = function(candidate) {
                    if (candidate && candidate.candidate && candidate.candidate.includes('.local')) {
                        return Promise.resolve();
                    }
                    return origAddIce.call(this, candidate);
                };
            }
        }
    } catch(e) {}
})();

// ===== 12. Timezone Consistency =====
// Ensure timezone matches user's expected timezone
(function() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const origResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function() {
            const result = origResolvedOptions.call(this);
            if (!result.timeZone) result.timeZone = tz;
            return result;
        };
    } catch(e) {}
})();

// ===== 13. Font Fingerprint - hide uncommon fonts =====
(function() {
    try {
        const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
        CanvasRenderingContext2D.prototype.measureText = function(text) {
            const result = origMeasureText.call(this, text);
            // Add tiny width variation to prevent font fingerprinting
            try {
                Object.defineProperty(result, 'width', {
                    get: function() { return origMeasureText.call(this._ctx || null, text).width + (Math.random() * 0.001); },
                    configurable: true
                });
            } catch(e) {}
            return result;
        };
    } catch(e) {}
})();

// ===== 14. Do Not Track =====
(function() {
    try {
        Object.defineProperty(navigator, 'doNotTrack', {
            get: function() { return '1'; },
            configurable: true
        });
    } catch(e) {}
})();

// ===== 15. Hardware Concurrency (hide real CPU cores) =====
(function() {
    try {
        const real = navigator.hardwareConcurrency || 4;
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: function() { return Math.min(real, 8); }, // Cap at 8 cores
            configurable: true
        });
    } catch(e) {}
})();

// ===== 16. Device Memory =====
(function() {
    try {
        Object.defineProperty(navigator, 'deviceMemory', {
            get: function() { return 8; }, // Spoof to 8GB
            configurable: true
        });
    } catch(e) {}
})();

// ===== 17. Connection (Network Information) =====
(function() {
    try {
        if (navigator.connection) {
            Object.defineProperty(navigator.connection, 'rtt', {
                get: function() { return 100; },
                configurable: true
            });
        }
    } catch(e) {}
})();
`;

/**
 * Inject anti-detect script vào page
 * @param {import('playwright').Page} page - Playwright page
 */
async function injectAntiDetectScript(page) {
    try {
        await page.addInitScript(ANTI_DETECT_SCRIPT);
        console.log('[Bypass] Anti-detect script injected');
    } catch (err) {
        console.warn(`[Bypass] Failed to inject anti-detect script: ${err.message}`);
    }
}

/**
 * Tạo Playwright context với anti-detect settings
 * @param {import('playwright').Browser} browser
 * @param {object} options
 * @returns {import('playwright').BrowserContext}
 */
async function createAntiDetectContext(browser, options = {}) {
    const {
        storageState = undefined,
        viewport = { width: 1920, height: 1080 },
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        locale = 'vi-VN',
        timezoneId = 'Asia/Ho_Chi_Minh',
    } = options;

    const context = await browser.newContext({
        storageState,
        viewport,
        userAgent,
        locale,
        timezoneId,
        // Anti-detect settings
        bypassCSP: true,
        javaScriptEnabled: true,
        ignoreHTTPSErrors: false,
        // Device scale factor
        deviceScaleFactor: 1,
        hasTouch: false,
        // Color scheme
        colorScheme: 'light',
    });

    // Inject anti-detect script to all pages
    await context.addInitScript(ANTI_DETECT_SCRIPT);

    return context;
}

// ============================================================
// HUMAN BEHAVIOR SIMULATION
// ============================================================

/**
 * Di chuyển chuột theo Bezier curve (tự nhiên hơn linear)
 * @param {import('playwright').Page} page
 * @param {number} startX
 * @param {number} startY
 * @param {number} endX
 * @param {number} endY
 * @param {number} steps - Số bước (càng nhiều càng mượt)
 */
async function humanMouseMove(page, startX, startY, endX, endY, steps = 20) {
    // Tạo Bezier curve control points
    const controlX1 = startX + (endX - startX) * 0.3 + (Math.random() - 0.5) * 100;
    const controlY1 = startY + (endY - startY) * 0.1 + (Math.random() - 0.5) * 50;
    const controlX2 = startX + (endX - startX) * 0.7 + (Math.random() - 0.5) * 100;
    const controlY2 = startY + (endY - startY) * 0.9 + (Math.random() - 0.5) * 50;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        // Cubic Bezier formula
        const x = u*u*u*startX + 3*u*u*t*controlX1 + 3*u*t*t*controlX2 + t*t*t*endX;
        const y = u*u*u*startY + 3*u*u*t*controlY1 + 3*u*t*t*controlY2 + t*t*t*endY;
        
        await page.mouse.move(x, y);
        await page.waitForTimeout(10 + Math.random() * 20);
    }
}

/**
 * Typing với speed tự nhiên (50-150ms per char)
 * @param {import('playwright').Page} page
 * @param {string} selector - CSS selector
 * @param {string} text - Text to type
 */
async function humanType(page, selector, text) {
    await page.click(selector);
    await page.waitForTimeout(200 + Math.random() * 300);
    
    for (const char of text) {
        await page.keyboard.type(char, { delay: 50 + Math.random() * 100 });
        // Occasionally pause longer (giống người thật suy nghĩ)
        if (Math.random() < 0.1) {
            await page.waitForTimeout(300 + Math.random() * 500);
        }
    }
}

/**
 * Random scroll (không scroll một mạch)
 * @param {import('playwright').Page} page
 * @param {number} maxScroll - Max pixels to scroll
 */
async function humanScroll(page, maxScroll = 500) {
    const scrollAmount = 100 + Math.random() * maxScroll;
    await page.evaluate((amount) => {
        window.scrollBy({ top: amount, behavior: 'smooth' });
    }, scrollAmount);
    await page.waitForTimeout(500 + Math.random() * 1000);
}

/**
 * Random delay trong khoảng min-max
 * @param {number} min - Minimum ms
 * @param {number} max - Maximum ms
 */
function randomDelay(min, max) {
    return min + Math.random() * (max - min);
}

/**
 * Đợi với random delay
 * @param {number} min - Minimum ms
 * @param {number} max - Maximum ms
 */
async function waitForRandom(min, max) {
    const delay = randomDelay(min, max);
    await new Promise(resolve => setTimeout(resolve, delay));
    return delay;
}

// ============================================================
// CONFIGURATION
// ============================================================

const BYPASS_CONFIG = {
    // Watermark settings
    watermark: {
        enabled: false,
        position: 'top-right', // top-right, top-left, bottom-right, bottom-left
        text: '© TikTok/Douyin',
        fontSize: 24,
        fontColor: 'white',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: 10,
        opacity: 0.7,
    },
    
    // Delay settings (milliseconds)
    delays: {
        betweenPosts: { min: 30000, max: 120000 }, // 30s - 2min between posts
        afterDownload: { min: 5000, max: 15000 }, // 5-15s after download
        beforeUpload: { min: 10000, max: 30000 }, // 10-30s before upload
    },
    
    // Metadata modification
    metadata: {
        addCredits: true,
        creditFormat: 'Video from {platform} by @{author}',
        randomizeCaption: true,
        captionVariations: [
            '{original}',
            '{original} #viral',
            '{original} #trending',
            '{original} #fyp',
            '{original} #shorts',
        ],
    },
    
    // Video processing
    video: {
        addIntro: false, // Add 1-2s intro clip
        changeFps: true, // Slightly change FPS (30 → 29.97)
        changeResolution: false, // Add slight resolution change
        trimEnd: false, // Disabled - trim filter has compatibility issues
        addNoise: true, // Add subtle noise overlay for fingerprint change
    },
};

// ============================================================
// WATERMARK PROCESSING
// ============================================================

/**
 * Thêm watermark/credits vào video bằng ffmpeg
 * @param {string} inputPath - Đường dẫn video gốc
 * @param {object} options - Tùy chọn watermark
 * @returns {string} Đường dẫn video đã xử lý
 */
function addWatermark(inputPath, options = {}) {
    const config = { ...BYPASS_CONFIG.watermark, ...options };
    
    if (!config.enabled) {
        console.log('[Bypass] Watermark disabled, skipping');
        return inputPath;
    }
    
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input video not found: ${inputPath}`);
    }
    
    const outputPath = inputPath.replace('.mp4', '_watermarked.mp4');
    
    // Tạo text watermark với ffmpeg drawtext filter
    const positionMap = {
        'top-right': `x=w-tw-${config.padding}:y=${config.padding}`,
        'top-left': `x=${config.padding}:y=${config.padding}`,
        'bottom-right': `x=w-tw-${config.padding}:y=h-th-${config.padding}`,
        'bottom-left': `x=${config.padding}:y=h-th-${config.padding}`,
    };
    
    const posExpr = positionMap[config.position] || positionMap['top-right'];
    
    // Escape text cho ffmpeg
    const escapedText = config.text.replace(/'/g, "\\'").replace(/:/g, "\\:");
    
    const filter = `drawtext=text='${escapedText}':fontsize=${config.fontSize}:fontcolor=${config.fontColor}@${config.opacity}:${posExpr}:box=1:boxcolor=black@0.5:boxborderw=${config.padding}`;
    
    const cmd = `ffmpeg -y -i "${inputPath}" -vf "${filter}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`;
    
    try {
        console.log(`[Bypass] Adding watermark to: ${path.basename(inputPath)}`);
        execSync(cmd, { timeout: 300000, stdio: 'pipe' });
        
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log(`[Bypass] Watermarked video: ${stats.size} bytes`);
            return outputPath;
        }
    } catch (err) {
        console.error(`[Bypass] Watermark failed: ${err.message}`);
    }
    
    return inputPath; // Fallback to original
}

// ============================================================
// VIDEO FINGERPRINT MODIFICATION
// ============================================================

/**
 * Thay đổi video fingerprint để tránh duplicate detection
 * @param {string} inputPath - Đường dẫn video gốc
 * @returns {string} Đường dẫn video đã xử lý
 */
function modifyVideoFingerprint(inputPath) {
    const config = BYPASS_CONFIG.video;
    
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Input video not found: ${inputPath}`);
    }
    
    const outputPath = inputPath.replace('.mp4', '_modified.mp4');
    const filters = [];
    
    // Thay đổi FPS slightly (30 → 29.97)
    if (config.changeFps) {
        filters.push('fps=29.97');
    }
    
    // Add subtle noise overlay for fingerprint change (rất nhẹ, không ảnh hưởng chất lượng)
    if (config.addNoise) {
        // noise filter: tạo hạt nhẹ + overlay để thay đổi video fingerprint
        filters.push('noise=c0s=3:c0f=t+u');
    }
    
    if (filters.length === 0) {
        console.log('[Bypass] No fingerprint modifications enabled');
        return inputPath;
    }
    
    const filterStr = filters.join(',');
    const cmd = `ffmpeg -y -i "${inputPath}" -vf "${filterStr}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`;
    
    try {
        console.log(`[Bypass] Modifying video fingerprint: ${path.basename(inputPath)}`);
        execSync(cmd, { timeout: 300000, stdio: 'pipe' });
        
        if (fs.existsSync(outputPath)) {
            const stats = fs.statSync(outputPath);
            console.log(`[Bypass] Modified video: ${stats.size} bytes`);
            return outputPath;
        }
    } catch (err) {
        console.error(`[Bypass] Fingerprint modification failed: ${err.message}`);
    }
    
    return inputPath;
}

// ============================================================
// METADATA MODIFICATION
// ============================================================

/**
 * Tạo caption unique cho mỗi platform
 * @param {string} originalCaption - Caption gốc
 * @param {string} platform - Platform name (FB, IG, TT, etc.)
 * @param {string} author - Tác giả gốc
 * @returns {string} Caption đã chỉnh sửa
 */
function generateUniqueCaption(originalCaption, platform, author = '') {
    const config = BYPASS_CONFIG.metadata;
    
    if (!config.randomizeCaption) {
        return originalCaption;
    }
    
    // Random variation
    const variation = config.captionVariations[
        Math.floor(Math.random() * config.captionVariations.length)
    ];
    
    let caption = variation.replace('{original}', originalCaption);
    
    // Add credits if enabled
    if (config.addCredits && author) {
        const credit = config.creditFormat
            .replace('{platform}', platform)
            .replace('{author}', author);
        caption = `${caption}\n\n${credit}`;
    }
    
    return caption;
}

// ============================================================
// DELAY MECHANISM
// ============================================================

/**
 * Random delay trong khoảng min-max (ms)
 * @param {string} type - Loại delay (betweenPosts, afterDownload, beforeUpload)
 * @returns {Promise<number>} Delay thực tế (ms)
 */
function randomDelay(type = 'betweenPosts') {
    const config = BYPASS_CONFIG.delays[type] || BYPASS_CONFIG.delays.betweenPosts;
    const delay = Math.floor(Math.random() * (config.max - config.min + 1)) + config.min;
    
    console.log(`[Bypass] Random delay (${type}): ${delay}ms`);
    
    return new Promise(resolve => setTimeout(resolve, delay));
}

// ============================================================
// CONTENT QUALITY CHECK
// ============================================================

/**
 * Kiểm tra video trước khi post (tránh flag)
 * @param {string} videoPath - Đường dẫn video
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkVideoQuality(videoPath) {
    if (!fs.existsSync(videoPath)) {
        return { ok: false, reason: 'Video file not found' };
    }
    
    const stats = fs.statSync(videoPath);
    const sizeMB = stats.size / (1024 * 1024);
    
    // Check file size (quá nhỏ có thể là spam)
    if (sizeMB < 0.1) {
        return { ok: false, reason: 'Video too small (< 100KB)' };
    }
    
    // Check file size (quá lớn có thể bị reject)
    if (sizeMB > 100) {
        return { ok: false, reason: 'Video too large (> 100MB)' };
    }
    
    // Check video duration bằng ffprobe
    try {
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`;
        const duration = parseFloat(execSync(cmd, { timeout: 10000, encoding: 'utf-8' }));
        
        if (duration < 3) {
            return { ok: false, reason: 'Video too short (< 3s)' };
        }
        
        if (duration > 600) {
            return { ok: false, reason: 'Video too long (> 10 minutes)' };
        }
        
        return { ok: true, duration, sizeMB };
    } catch (err) {
        // ffprobe failed, but video exists - allow it
        console.warn(`[Bypass] Could not check video duration: ${err.message}`);
        return { ok: true, sizeMB };
    }
}

// ============================================================
// MAIN PROCESSING PIPELINE
// ============================================================

/**
 * Xử lý video trước khi cross-post
 * @param {string} inputPath - Đường dẫn video gốc
 * @param {object} metadata - { platform, author, caption }
 * @returns {{ videoPath: string, caption: string }}
 */
async function processVideoForCrossPost(inputPath, metadata = {}) {
    console.log(`[Bypass] Processing video for cross-post: ${path.basename(inputPath)}`);
    
    // 1. Quality check
    const qualityCheck = checkVideoQuality(inputPath);
    if (!qualityCheck.ok) {
        console.warn(`[Bypass] Quality check failed: ${qualityCheck.reason}`);
        // Continue anyway, but log warning
    }
    
    let currentPath = inputPath;
    
    // 2. Modify fingerprint (trước watermark)
    if (BYPASS_CONFIG.video.changeFps || BYPASS_CONFIG.video.trimEnd) {
        const modifiedPath = modifyVideoFingerprint(currentPath);
        if (modifiedPath !== currentPath) {
            // Xóa file tạm trước đó (nếu không phải gốc)
            if (currentPath !== inputPath) {
                try { fs.unlinkSync(currentPath); } catch {}
            }
            currentPath = modifiedPath;
        }
    }
    
    // 3. Add watermark
    if (BYPASS_CONFIG.watermark.enabled) {
        const watermarkedPath = addWatermark(currentPath);
        if (watermarkedPath !== currentPath) {
            // Xóa file tạm trước đó (nếu không phải gốc)
            if (currentPath !== inputPath) {
                try { fs.unlinkSync(currentPath); } catch {}
            }
            currentPath = watermarkedPath;
        }
    }
    
    // 4. Generate unique caption
    const caption = generateUniqueCaption(
        metadata.caption || '',
        metadata.platform || 'FB',
        metadata.author || ''
    );
    
    console.log(`[Bypass] Processing complete: ${path.basename(currentPath)}`);
    
    return {
        videoPath: currentPath,
        caption,
        originalPath: inputPath,
    };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    // Existing exports
    addWatermark,
    modifyVideoFingerprint,
    generateUniqueCaption,
    randomDelay,
    checkVideoQuality,
    processVideoForCrossPost,
    BYPASS_CONFIG,
    
    // New anti-detect exports
    ANTI_DETECT_SCRIPT,
    injectAntiDetectScript,
    createAntiDetectContext,
    humanMouseMove,
    humanType,
    humanScroll,
    waitForRandom,
};
