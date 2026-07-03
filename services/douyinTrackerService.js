// services/douyinTrackerService.js
// Theo dõi Douyin channel → download video mới → cross-post lên FB Reels, TH, PI, IG, TT
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const DouyinTracking = require('../models/DouyinTracking');
const DouyinVideo = require('../models/DouyinVideo');
const Channel = require('../models/Channel');
const SchedulePost = require('../models/SchedulePost');

// Playwright stealth - bypass anti-bot detection
let _chromium = null;
try {
    const { chromium } = require('playwright-extra');
    const stealth = require('puppeteer-extra-plugin-stealth');
    chromium.use(stealth());
    _chromium = chromium;
    console.log('[Douyin Tracker] Playwright stealth plugin loaded');
} catch (err) {
    console.warn('[Douyin Tracker] playwright-extra/stealth not available, using standard playwright');
    try { _chromium = require('playwright').chromium; } catch {}
}

const DOWNLOAD_DIR = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'douyin-tracker');
const CHECK_INTERVAL_MS = 60 * 1000;
let _interval = null;
let _isProcessing = false;

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
        console.warn(`[Douyin Tracker] Failed to patch Chrome language: ${e.message}`);
    }
}

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// ============================================================
// COOKIE HELPERS
// ============================================================

function generateUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Tạo file cookies tối thiểu cho yt-dlp Douyin (cần s_v_web_id, ttwid, __ac_nonce)
 */
function generateMinimalDouyinCookies(userId) {
    const tempPath = path.join(DOWNLOAD_DIR, `cookies_dy_minimal_${userId}.txt`);
    const sVWebId = `verify_${generateUuid().replace(/-/g, '').slice(0, 32)}`;
    const ttwid = generateUuid();
    const expires = Math.floor(Date.now() / 1000) + 86400 * 30;
    const cookieLines = [
        '# Netscape HTTP Cookie File',
        '# Generated minimal Douyin cookies for yt-dlp',
        '',
        `.douyin.com\tTRUE\t/\tTRUE\t${expires}\ts_v_web_id\t${sVWebId}`,
        `.douyin.com\tTRUE\t/\tTRUE\t${expires}\tttwid\t${ttwid}`,
        `.douyin.com\tTRUE\t/\tTRUE\t${expires}\t__ac_nonce\t0${Date.now().toString(36)}abcdef`,
        `.douyin.com\tTRUE\t/\tFALSE\t${expires}\todin_tt\t${generateUuid().replace(/-/g, '')}`,
    ];
    fs.writeFileSync(tempPath, cookieLines.join('\n'), 'utf-8');
    return tempPath;
}

/**
 * Lấy cookies Douyin từ file đã cấu hình hoặc từ Channel Playwright storage
 */
async function getCookiesPath(userId, tracking) {
    // Ưu tiên: cookies từ tracking config
    if (tracking.cookiesPath && fs.existsSync(tracking.cookiesPath)) {
        return tracking.cookiesPath;
    }
    // Fallback: tìm channel Douyin (nếu có)
    try {
        const channel = await Channel.findOne({ userId, platform: 'DY', isEnabled: true }).sort({ updatedAt: -1 }).lean();
        if (channel?.storageStatePath) {
            const storagePath = path.isAbsolute(channel.storageStatePath)
                ? channel.storageStatePath
                : path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), channel.storageStatePath);
            if (fs.existsSync(storagePath)) {
                const result = convertStorageStateToNetscape(storagePath, userId);
                if (result) return result;
            }
        }
    } catch {}
    // Fallback: file cookies.txt mặc định
    const defaultCookies = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'douyin_cookies.txt');
    if (fs.existsSync(defaultCookies)) return defaultCookies;
    // Tạo minimal cookies cho yt-dlp
    return generateMinimalDouyinCookies(userId);
}

function convertStorageStateToNetscape(storagePath, userId) {
    try {
        const storageState = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
        if (!storageState.cookies?.length) return null;
        const tempPath = path.join(DOWNLOAD_DIR, `cookies_dy_${userId}.txt`);
        const cookieLines = storageState.cookies
            .filter(c => c.domain?.includes('douyin.com'))
            .map(c => {
                const domain = c.domain || '';
                const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
                return `${domain}\t${includeSub}\t${c.path || '/'}\t${c.secure ? 'TRUE' : 'FALSE'}\t${(typeof c.expires === 'number' && c.expires > 0) ? Math.floor(c.expires) : 0}\t${c.name || ''}\t${c.value || ''}`;
            });
        if (!cookieLines.length) return null;
        const header = ['# Netscape HTTP Cookie File', `# Generated for Douyin user ${userId}`, ''];
        fs.writeFileSync(tempPath, header.join('\n') + cookieLines.join('\n'), 'utf-8');
        return tempPath;
    } catch {
        return null;
    }
}

// ============================================================
// PLAYWRIGHT LOGIN: Mở browser thật để user login Douyin
// ============================================================

const DY_SESSION_DIR = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'social-sessions', 'douyin');

/**
 * Mở browser visible để user login Douyin, lưu session cookies
 * @param {string} userId - User ID
 * @param {number} timeout - Timeout ms (default 5 phút)
 * @returns {{ ok: boolean, cookiesPath?: string, error?: string }}
 */
async function loginViaBrowser(userId, timeout = 300000) {
    let browser = null;
    try {
        const pw = _chromium || require('playwright').chromium;
        const sessionDir = path.join(DY_SESSION_DIR, String(userId));
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

        // Patch Chrome profile language to Vietnamese
        patchChromeLanguage(sessionDir);

        browser = await pw.launch({
            headless: false,
            args: [
                '--lang=vi-VN',
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--disable-sync',
            ],
        });
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            storageState: fs.existsSync(path.join(sessionDir, 'state.json'))
                ? path.join(sessionDir, 'state.json') : undefined,
        });
        const page = await context.newPage();

        console.log(`[Douyin Tracker] Opening Douyin login page for user ${userId}...`);
        await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Chờ user login xong (hoặc timeout)
        console.log('[Douyin Tracker] Please login to Douyin in the browser window...');
        console.log(`[Douyin Tracker] Waiting up to ${timeout / 1000}s for login...`);

        const startTime = Date.now();
        let loggedIn = false;
        while (Date.now() - startTime < timeout) {
            await page.waitForTimeout(3000);
            const cookies = await context.cookies('https://www.douyin.com');
            const hasSession = cookies.some(c => c.name === 'sessionid' || c.name === 'passport_csrf_token');
            if (hasSession) {
                loggedIn = true;
                console.log('[Douyin Tracker] Login detected!');
                break;
            }
            // Kiểm tra login modal biến mất
            const hasLoginModal = await page.evaluate(() => {
                return !!document.querySelector('[class*="login"]') && !document.querySelector('[class*="login"]')?.hidden;
            });
            if (!hasLoginModal) {
                // Có thể đã login, chờ thêm 5s
                await page.waitForTimeout(5000);
                const finalCookies = await context.cookies('https://www.douyin.com');
                if (finalCookies.some(c => c.name === 'sessionid')) {
                    loggedIn = true;
                    console.log('[Douyin Tracker] Login confirmed!');
                    break;
                }
            }
        }

        // Lưu session
        const statePath = path.join(sessionDir, 'state.json');
        await context.storageState({ path: statePath });

        // Convert sang Netscape format cho yt-dlp
        const cookiesPath = convertStorageStateToNetscape(statePath, userId);

        await browser.close();
        browser = null;

        if (loggedIn || cookiesPath) {
            console.log(`[Douyin Tracker] Session saved to: ${statePath}`);
            return { ok: true, cookiesPath, statePath };
        }

        return { ok: false, error: 'Login timeout - user did not login within time limit' };
    } catch (err) {
        console.error(`[Douyin Tracker] Login error: ${err.message}`);
        if (browser) await browser.close().catch(() => {});
        return { ok: false, error: err.message };
    }
}

/**
 * Kiểm tra xem user đã login Douyin chưa
 */
async function checkLoginStatus(userId) {
    try {
        const statePath = path.join(DY_SESSION_DIR, String(userId), 'state.json');
        if (!fs.existsSync(statePath)) return { loggedIn: false };

        const storageState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        const dyCookies = storageState.cookies?.filter(c => c.domain?.includes('douyin.com')) || [];
        const hasSession = dyCookies.some(c => c.name === 'sessionid' || c.name === 'passport_csrf_token');
        const hasSvWebId = dyCookies.some(c => c.name === 's_v_web_id');

        return {
            loggedIn: hasSession,
            hasCookies: dyCookies.length > 0,
            hasSvWebId,
            cookieCount: dyCookies.length,
            statePath,
        };
    } catch {
        return { loggedIn: false };
    }
}

// ============================================================
// PLAYWRIGHT: LẤY DANH SÁCH VIDEO TỪ USER PAGE
// Douyin user page: https://www.douyin.com/user/MS4wLjABAAAA...
// yt-dlp chưa hỗ trợ download playlist Douyin, nên dùng Playwright để scrape
// ============================================================

async function fetchUserPageVideos(channelUrl, cookiesPath) {
    let browser = null;
    try {
        const launchOptions = { headless: false, channel: 'chrome' };
        const contextOptions = {
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
        };

        // Patch Chrome profile language to Vietnamese
        const dySessionDir = path.join(DY_SESSION_DIR, String(userId || 'default'));
        patchChromeLanguage(dySessionDir);

        // Load session cookies nếu có
        if (cookiesPath && fs.existsSync(cookiesPath)) {
            try {
                const raw = fs.readFileSync(cookiesPath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed.cookies?.length) {
                    contextOptions.storageState = { cookies: parsed.cookies };
                    console.log(`[Douyin Tracker] Loaded ${parsed.cookies.length} cookies from session`);
                }
            } catch {}
        }

        browser = await _chromium.launch(launchOptions);
        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        // Intercept aweme/post API - trả về danh sách video từ kênh
        let apiVideos = [];
        let apiResolve = null;
        const apiPromise = new Promise(resolve => { apiResolve = resolve; });

        page.on('response', async (response) => {
            if (response.status() !== 200) return;
            const url = response.url();

            // Bắt API aweme/post (danh sách video của user)
            if (url.includes('aweme/v1/web/aweme/post')) {
                try {
                    const text = await response.text();
                    if (text.length > 500) {
                        const data = JSON.parse(text);
                        if (data.aweme_list?.length) {
                            for (const aweme of data.aweme_list) {
                                apiVideos.push({
                                    id: String(aweme.aweme_id),
                                    url: `https://www.douyin.com/video/${aweme.aweme_id}`,
                                    title: aweme.desc || '',
                                    thumbnail: aweme.video?.cover?.url_list?.[0] || '',
                                    viewCount: aweme.statistics?.play_count || 0,
                                    duration: aweme.video?.duration ? Math.round(aweme.video.duration / 1000) : 0,
                                });
                            }
                            console.log(`[Douyin Tracker] API aweme/post: +${data.aweme_list.length} videos, total: ${apiVideos.length}`);
                            if (apiResolve) apiResolve();
                        }
                    }
                } catch {}
            }
        });

        // Navigate to channel page
        console.log(`[Douyin Tracker] Opening channel: ${channelUrl}`);
        try {
            await page.goto(channelUrl, { waitUntil: 'commit', timeout: 20000 });
        } catch {}

        // Đóng login popup (nếu có)
        await page.waitForTimeout(3000);
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(1000);

        // Đợi API response đầu tiên (tối đa 15s)
        await Promise.race([apiPromise, page.waitForTimeout(15000)]);

        // Scroll để load thêm videos
        let prevCount = apiVideos.length;
        for (let i = 0; i < 10; i++) {
            await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
            await page.waitForTimeout(3000);

            // Kiểm tra đã load thêm chưa
            if (apiVideos.length > prevCount) {
                console.log(`[Douyin Tracker] Scroll ${i + 1}: ${apiVideos.length} videos (+${apiVideos.length - prevCount})`);
                prevCount = apiVideos.length;
            }

            // Kiểm tra đã cuộn đến cuối trang chưa
            const scrollInfo = await page.evaluate(() => ({
                scrollY: window.scrollY,
                scrollH: document.documentElement.scrollHeight,
            })).catch(() => ({ scrollY: 0, scrollH: 0 }));

            if (scrollInfo.scrollY + 800 >= scrollInfo.scrollH) {
                console.log(`[Douyin Tracker] Reached bottom at scroll ${i + 1}`);
                break;
            }
        }

        // Fallback: scrape DOM nếu API không hoạt động
        if (apiVideos.length === 0) {
            const domVideos = await page.evaluate(() => {
                const results = [];
                const html = document.body.innerHTML;
                for (const m of html.matchAll(/video\/([0-9]{15,})/g)) {
                    if (!results.find(r => r.id === m[1])) {
                        results.push({
                            id: m[1],
                            url: `https://www.douyin.com/video/${m[1]}`,
                            title: '',
                        });
                    }
                }
                return results;
            }).catch(() => []);

            if (domVideos.length) {
                console.log(`[Douyin Tracker] DOM fallback: ${domVideos.length} videos`);
                apiVideos = domVideos;
            }
        }

        // Kiểm tra login wall
        if (apiVideos.length === 0) {
            const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
            if (bodyText.includes('登录') || bodyText.includes('扫码登录')) {
                console.warn('[Douyin Tracker] Login wall detected');
                return { videos: [], needsLogin: true };
            }
        }

        console.log(`[Douyin Tracker] Total: ${apiVideos.length} videos from channel`);
        return { videos: apiVideos, needsLogin: false };
    } catch (err) {
        console.error(`[Douyin Tracker] Error fetching channel videos: ${err.message}`);
        return { videos: [], needsLogin: false, error: err.message };
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ============================================================
// PLAYWRIGHT: LẤY INFO TỪ TRANG VIDEO (fallback khi yt-dlp fail)
// 3 methods: (1) aweme/detail API interception, (2) RENDER_DATA SSR, (3) network URL sniffing
// ============================================================

async function fetchVideoInfoFromPage(videoUrl, cookiesPath) {
    let browser = null;
    try {
        const pw = { chromium: _chromium };
        const contextOptions = {
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
        };

        // Patch Chrome profile language to Vietnamese
        const dySessionDir = path.join(DY_SESSION_DIR, String(userId || 'default'));
        patchChromeLanguage(dySessionDir);

        // Load cookies - hỗ trợ JSON storage state và Netscape format
        if (cookiesPath && fs.existsSync(cookiesPath)) {
            try {
                const raw = fs.readFileSync(cookiesPath, 'utf-8');
                const parsed = JSON.parse(raw);
                if (parsed.cookies?.length) {
                    const dyCookies = parsed.cookies.filter(c => c.domain?.includes('douyin.com'));
                    if (dyCookies.length) {
                        contextOptions.storageState = { cookies: dyCookies };
                    }
                }
            } catch {
                // Netscape format → convert sang Playwright cookies
                try {
                    const lines = fs.readFileSync(cookiesPath, 'utf-8').split('\n');
                    const cookies = [];
                    for (const line of lines) {
                        if (line.startsWith('#') || !line.trim()) continue;
                        const parts = line.split('\t');
                        if (parts.length >= 7 && parts[0].includes('douyin.com')) {
                            cookies.push({
                                name: parts[5],
                                value: parts[6],
                                domain: parts[0],
                                path: parts[2],
                                secure: parts[3] === 'TRUE',
                                expires: parseInt(parts[4]) || -1,
                            });
                        }
                    }
                    if (cookies.length) contextOptions.storageState = { cookies };
                } catch {}
            }
        }

        browser = await _chromium.launch({ headless: false, channel: 'chrome' });
        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        // Method 1: Bắt aweme/detail API response (cách tốt nhất)
        let apiVideoData = null;
        page.on('response', async (response) => {
            const url = response.url();
            if (apiVideoData) return; // đã có data rồi
            // Bắt aweme/detail API
            if (url.includes('aweme/detail') || url.includes('aweme/v1/web/aweme/detail')) {
                try {
                    const text = await response.text();
                    const data = JSON.parse(text);
                    if (data.aweme_detail) {
                        apiVideoData = data.aweme_detail;
                        console.log(`[Douyin Tracker] Captured aweme/detail API response`);
                    }
                } catch {}
            }
            // Bắt aweme/v1/web/aweme/post (user page list có thể chứa detail)
            if (!apiVideoData && url.includes('aweme/v1/web/aweme/post')) {
                try {
                    const text = await response.text();
                    const data = JSON.parse(text);
                    if (data.aweme_list?.length) {
                        apiVideoData = data.aweme_list[0];
                    }
                } catch {}
            }
        });

        // Navigate - dùng jingxuan page (SSR, chứa video data trong HTML)
        const awemeIdMatch = videoUrl.match(/video\/(\d+)/);
        const awemeId = awemeIdMatch?.[1];
        const jingxuanUrl = awemeId
            ? `https://www.douyin.com/jingxuan?modal_id=${awemeId}`
            : videoUrl;

        await page.goto(jingxuanUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(6000);

        // Method 2: Trích xuất từ RENDER_DATA (SSR embedded data)
        let renderData = null;
        try {
            renderData = await page.evaluate(() => {
                // Douyin embeds video data in a script tag with id="RENDER_DATA"
                const el = document.getElementById('RENDER_DATA');
                if (el) {
                    try {
                        // RENDER_DATA là URL-encoded JSON
                        const decoded = decodeURIComponent(el.textContent);
                        return JSON.parse(decoded);
                    } catch {}
                }
                // Fallback: window._ROUTER_DATA hoặc __NEXT_DATA__
                if (window._ROUTER_DATA) return window._ROUTER_DATA;
                if (window.__NEXT_DATA__) return window.__NEXT_DATA__;
                return null;
            });
        } catch {}

        // Method 3: Network URL sniffing (CDN URLs)
        let cdnUrls = [];
        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('douyinvod.com') || url.includes('.mp4') ||
                (url.includes('play') && url.includes('video'))) {
                cdnUrls.push(url);
            }
        });

        // Chờ thêm 3s để bắt thêm network requests
        await page.waitForTimeout(3000);

        // Extract info từ page DOM
        const domInfo = await page.evaluate(() => {
            const titleEl = document.querySelector('[class*="title"], [class*="desc"], h1, [data-e2e="video-desc"]');
            const title = titleEl?.textContent?.trim() || '';
            const authorEl = document.querySelector('[class*="author"], [class*="nickname"], [data-e2e="video-author"]');
            const author = authorEl?.textContent?.trim() || '';
            const likeEl = document.querySelector('[class*="like"], [data-e2e="digg-count"]');
            const likeText = likeEl?.textContent?.trim() || '0';
            const likeCount = parseInt(likeText.replace(/[^\d]/g, '')) || 0;
            return { title, author, likeCount };
        });

        // Ưu tiên video URL: API > RENDER_DATA > CDN
        let videoUrlDirect = null;
        let title = domInfo.title;
        let author = domInfo.author;

        // Từ aweme/detail API
        if (apiVideoData) {
            const playAddr = apiVideoData.video?.play_addr;
            if (playAddr?.url_list?.length) {
                videoUrlDirect = playAddr.url_list[0];
            }
            if (!title) title = apiVideoData.desc || '';
            if (!author) author = apiVideoData.author?.nickname || '';
        }

        // Từ RENDER_DATA
        if (!videoUrlDirect && renderData) {
            try {
                // Tìm videoDetail trong render data (cấu trúc đa tầng)
                const findVideoDetail = (obj, depth = 0) => {
                    if (!obj || depth > 5) return null;
                    if (obj.videoDetail) return obj.videoDetail;
                    if (obj.app?.videoDetail) return obj.app.videoDetail;
                    if (obj.awemeDetail) return obj.awemeDetail;
                    for (const key of Object.keys(obj)) {
                        if (typeof obj[key] === 'object') {
                            const found = findVideoDetail(obj[key], depth + 1);
                            if (found) return found;
                        }
                    }
                    return null;
                };
                const videoDetail = findVideoDetail(renderData);
                if (videoDetail) {
                    const playAddr = videoDetail.video?.playAddr || videoDetail.video?.play_addr;
                    if (playAddr?.url_list?.length) {
                        videoUrlDirect = playAddr.url_list[0];
                    }
                    if (!title) title = videoDetail.desc || '';
                    if (!author) author = videoDetail.author?.nickname || '';
                }
            } catch {}
        }

        // CDN URLs fallback
        if (!videoUrlDirect && cdnUrls.length) {
            videoUrlDirect = cdnUrls[0];
        }

        console.log(`[Douyin Tracker] Video URL found: ${!!videoUrlDirect} (API: ${!!apiVideoData}, RENDER: ${!!renderData}, CDN: ${cdnUrls.length})`);

        return {
            title,
            author,
            likeCount: domInfo.likeCount,
            videoUrls: videoUrlDirect ? [videoUrlDirect] : cdnUrls,
        };
    } catch (err) {
        console.error(`[Douyin Tracker] Lỗi scrape video page: ${err.message}`);
        return null;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ============================================================
// DOWNLOAD VIDEO - 4 methods: yt-dlp → Playwright intercept (real cookies) → curl CDN → Playwright fetch
// ============================================================

async function downloadVideo(videoUrl, videoId, cookiesPath, userId) {
    const filename = `dy_${videoId}_${Date.now()}.mp4`;
    const outputPath = path.join(DOWNLOAD_DIR, filename);

    // Method 1: Thử yt-dlp
    try {
        const cookiesArg = cookiesPath ? `--cookies "${cookiesPath.replace(/\\/g, '/')}"` : '';
        const safeUrl = videoUrl.replace(/"/g, '\\"');
        const cmd = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4 --no-warnings --no-check-certificates --impersonate chrome ${cookiesArg} -o "${outputPath}" "${safeUrl}"`;
        const execOpts = { timeout: 300000, maxBuffer: 50 * 1024 * 1024 };
        execSync(cmd, execOpts);

        if (fs.existsSync(outputPath)) return { path: outputPath, method: 'ytdlp' };
        const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith(`dy_${videoId}_`));
        if (files.length) return { path: path.join(DOWNLOAD_DIR, files[files.length - 1]), method: 'ytdlp' };
    } catch (err) {
        console.warn(`[Douyin Tracker] yt-dlp failed for ${videoId}: ${err.message?.slice(0, 200)}`);
    }

    // Method 2: Playwright intercept - dùng session cookies thật để bắt aweme/detail API
    try {
        const interceptResult = await downloadViaIntercept(videoUrl, videoId, outputPath, userId, cookiesPath);
        if (interceptResult) return interceptResult;
    } catch (err) {
        console.warn(`[Douyin Tracker] Playwright intercept failed for ${videoId}: ${err.message?.slice(0, 200)}`);
    }

    // Method 3: curl CDN từ fetchVideoInfoFromPage
    try {
        const info = await fetchVideoInfoFromPage(videoUrl, cookiesPath);
        if (info?.videoUrls?.length) {
            for (const directUrl of info.videoUrls.slice(0, 3)) {
                try {
                    const safeOutputPath = outputPath.replace(/\\/g, '/');
                    const safeDirectUrl = directUrl.replace(/"/g, '\\"');
                    const curlCmd = `curl -L -o "${safeOutputPath}" -H "Referer: https://www.douyin.com/" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" --max-time 120 "${safeDirectUrl}"`;
                    execSync(curlCmd, { timeout: 180000, maxBuffer: 50 * 1024 * 1024 });

                    if (fs.existsSync(outputPath)) {
                        const stat = fs.statSync(outputPath);
                        if (stat.size > 10000) {
                            return { path: outputPath, method: 'playwright-curl' };
                        } else {
                            fs.unlinkSync(outputPath);
                        }
                    }
                } catch {}
            }
        }
    } catch (err) {
        console.warn(`[Douyin Tracker] curl fallback failed for ${videoId}: ${err.message?.slice(0, 200)}`);
    }

    return null;
}

/**
 * Download video bằng cách intercept aweme/detail API trong Playwright
 * Cần session cookies thật (đã login) để API response chứa video data
 */
async function downloadViaIntercept(videoUrl, videoId, outputPath, userId, cookiesPath) {
    let browser = null;
    try {
        // Tìm session cookies
        let storageStatePath = null;
        if (userId) {
            const sessionPath = path.join(DY_SESSION_DIR, String(userId), 'state.json');
            if (fs.existsSync(sessionPath)) storageStatePath = sessionPath;
        }
        if (!storageStatePath && cookiesPath && fs.existsSync(cookiesPath)) {
            // Try to use provided cookiesPath
            try {
                const raw = fs.readFileSync(cookiesPath, 'utf-8');
                JSON.parse(raw); // Check if it's JSON
                storageStatePath = cookiesPath;
            } catch {}
        }

        if (!storageStatePath) {
            console.log(`[Douyin Tracker] No session cookies for intercept, skipping`);
            return null;
        }

        // Patch Chrome profile language to Vietnamese
        const dySessionDir = path.join(DY_SESSION_DIR, String(userId || 'default'));
        patchChromeLanguage(dySessionDir);

        // Use real Chrome channel for anti-bot bypass (headless fails with Douyin)
        browser = await _chromium.launch({ headless: false, channel: 'chrome' });
        const contextOptions = {
            viewport: { width: 1280, height: 800 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            locale: 'vi-VN',
            timezoneId: 'Asia/Ho_Chi_Minh',
            storageState: storageStatePath,
        };
        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        // Intercept aweme/detail API - dùng response event để bắt data
        let capturedVideoData = null;
        let capturedResolve = null;
        const capturedPromise = new Promise((resolve) => { capturedResolve = resolve; });

        page.on('response', async (response) => {
            if (capturedVideoData) return;
            const url = response.url();
            if (url.includes('aweme/v1/web/aweme/detail/') && response.status() === 200) {
                try {
                    const text = await response.text();
                    if (text.length > 1000) {
                        const data = JSON.parse(text);
                        if (data.aweme_detail) {
                            capturedVideoData = data.aweme_detail;
                            console.log(`[Douyin Tracker] Intercepted aweme/detail for ${videoId}, len=${text.length}`);
                            if (capturedResolve) capturedResolve();
                        }
                    }
                } catch {}
            }
        });

        // Navigate to video page - commit fast, then wait for API
        await page.goto(videoUrl, { waitUntil: 'commit', timeout: 30000 });

        // Wait up to 20s for aweme/detail API response
        await Promise.race([
            capturedPromise,
            page.waitForTimeout(20000)
        ]);

        // Extract video URL from captured data
        if (capturedVideoData?.video?.play_addr?.url_list?.length) {
            const videoUrlDirect = capturedVideoData.video.play_addr.url_list[0];
            const title = capturedVideoData.desc || '';

            // Download với curl
            try {
                const safeOutputPath = outputPath.replace(/\\/g, '/');
                const safeVideoUrl = videoUrlDirect.replace(/"/g, '\\"');
                const curlCmd = `curl -L -o "${safeOutputPath}" -H "Referer: https://www.douyin.com/" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" --max-time 120 "${safeVideoUrl}"`;
                execSync(curlCmd, { timeout: 180000, maxBuffer: 50 * 1024 * 1024 });

                if (fs.existsSync(outputPath)) {
                    const stat = fs.statSync(outputPath);
                    if (stat.size > 10000) {
                        // Update session cookies after successful download
                        try {
                            const sessionDir = path.join(DY_SESSION_DIR, String(userId));
                            if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
                            await context.storageState({ path: path.join(sessionDir, 'state.json') });
                            console.log(`[Douyin Tracker] Session cookies updated after download`);
                        } catch {}
                        return { path: outputPath, method: 'intercept', title };
                    }
                }
            } catch {}

            // Fallback: download bằng page.evaluate fetch
            try {
                const videoBuffer = await page.evaluate(async (url) => {
                    const response = await fetch(url, {
                        headers: { 'Referer': 'https://www.douyin.com/' }
                    });
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    const blob = await response.blob();
                    const arrayBuffer = await blob.arrayBuffer();
                    return Array.from(new Uint8Array(arrayBuffer));
                }, videoUrlDirect);

                if (videoBuffer?.length > 10000) {
                    fs.writeFileSync(outputPath, Buffer.from(videoBuffer));
                    return { path: outputPath, method: 'intercept-fetch', title };
                }
            } catch {}
        }

        return null;
    } catch (err) {
        console.error(`[Douyin Tracker] downloadViaIntercept error: ${err.message?.slice(0, 200)}`);
        return null;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ============================================================
// CHECK & DOWNLOAD CHO MỘT TRACKING
// ============================================================

async function checkAndDownload(tracking) {
    const userId = tracking.userId;
    console.log(`[Douyin Tracker] Checking: ${tracking.channelName || tracking.channelUrl}`);

    const cookiesPath = await getCookiesPath(userId, tracking);

    // Fetch video list từ user page (dùng Playwright vì yt-dlp chưa hỗ trợ Douyin playlist)
    const result = await fetchUserPageVideos(tracking.channelUrl, cookiesPath);
    const videos = result.videos || [];
    if (result.needsLogin) {
        console.warn(`[Douyin Tracker] Cần cookies.txt để xem channel: ${tracking.channelName || tracking.channelUrl}`);
        tracking.lastError = 'Cần upload cookies.txt (Đăng nhập Douyin trên trình duyệt → Export cookies)';
        await tracking.save();
        return { newCount: 0, downloadCount: 0, needsLogin: true };
    }
    if (result.error) {
        tracking.lastError = result.error;
        await tracking.save();
    }
    if (!videos.length) {
        console.log(`[Douyin Tracker] Không tìm thấy video nào từ ${tracking.channelUrl}`);
        return { newCount: 0, downloadCount: 0 };
    }

    // Lấy danh sách video ID đã download / đang download (bỏ qua skipped)
    const existingIds = await DouyinVideo.find({ 
        trackingId: tracking._id,
        status: { $ne: 'skipped' }
    }).distinct('douyinVideoId');
    const existingSet = new Set(existingIds);

    // Lần check đầu tiên: set lastCheckedAt, vẫn cho phép download video
    const isFirstCheck = !tracking.lastCheckedAt;
    if (isFirstCheck) {
        tracking.lastCheckedAt = new Date();
        await tracking.save();
        console.log(`[Douyin Tracker] Lần check đầu tiên — sẽ tải video mới từ ${tracking.channelName || tracking.channelUrl}`);
    }

    // Filter video mới: bỏ qua video đã download, vẫn cho phép tải video skipped (từ lần check trước)
    const MAX_PER_CHECK = 5;
    const newVideos = videos.filter(v => v.id && !existingSet.has(v.id)).slice(0, MAX_PER_CHECK);
    if (!newVideos.length) {
        console.log(`[Douyin Tracker] Không có video mới từ ${tracking.channelName || tracking.channelUrl}`);
        return { newCount: 0, downloadCount: 0 };
    }

    console.log(`[Douyin Tracker] Tìm thấy ${newVideos.length} video mới từ ${tracking.channelName}`);

    let downloadCount = 0;
    for (const video of newVideos) {
        try {
            const videoDoc = await DouyinVideo.create({
                userId,
                trackingId: tracking._id,
                douyinVideoId: video.id,
                douyinUrl: video.url,
                title: video.title,
                thumbnail: video.thumbnail,
                viewCount: video.viewCount,
                author: tracking.channelName,
                status: 'downloading',
            });

            // Download (auto-retry 3 lần)
            let result = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                result = await downloadVideo(video.url, video.id, cookiesPath, userId);
                if (result) break;
                if (attempt < 3) {
                    console.log(`[Douyin Tracker] Retry ${attempt}/3 cho video ${video.id}...`);
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
            if (result) {
                const stats = fs.statSync(result.path);
                videoDoc.downloadPath = result.path;
                videoDoc.downloadSize = `${(stats.size / (1024 * 1024)).toFixed(1)}MB`;
                videoDoc.downloadMethod = result.method;
                videoDoc.status = 'downloaded';
                videoDoc.downloadedAt = new Date();
                await videoDoc.save();

                await createCrossPostSchedule(videoDoc, tracking);
                downloadCount++;
                console.log(`[Douyin Tracker] Downloaded (${result.method}): ${video.title || video.id}`);
            } else {
                videoDoc.status = 'failed';
                videoDoc.downloadError = 'Download failed (both ytdlp and playwright)';
                await videoDoc.save();
            }
        } catch (err) {
            if (err.code === 11000) {
                console.warn(`[Douyin Tracker] Video ${video.id} đã tồn tại trong DB (duplicate key), bỏ qua`);
            } else {
                console.error(`[Douyin Tracker] Lỗi xử lý video ${video.id}: ${err.message}`);
            }
        }
    }

    tracking.lastCheckedAt = new Date();
    tracking.totalDownloaded = (tracking.totalDownloaded || 0) + downloadCount;
    await tracking.save();

    return { newCount: newVideos.length, downloadCount };
}

// ============================================================
// TẠO SCHEDULE POST CHO CROSS-POST
// ============================================================

async function createCrossPostSchedule(videoDoc, tracking) {
    // Check Telegram review mode
    if (tracking.telegramReview) {
        const { getTelegramConfig, sendVideoForReview } = require('./telegramService');
        const config = await getTelegramConfig(videoDoc.userId);
        if (config) {
            const result = await sendVideoForReview(config.botToken, config.chatId, videoDoc, 'douyin');
            if (result.ok) {
                videoDoc.telegramReviewStatus = 'pending';
                videoDoc.telegramMsgId = result.messageId;
                videoDoc.status = 'pending_review';
                await videoDoc.save();
                console.log(`[Douyin Tracker] Sent to Telegram for review: ${videoDoc.title || videoDoc.douyinVideoId}`);
                return null; // Không tạo schedule post yet, chờ approve
            } else {
                console.warn(`[Douyin Tracker] Telegram review failed, falling back to direct cross-post: ${result.error}`);
            }
        } else {
            console.warn(`[Douyin Tracker] No Telegram config, falling back to direct cross-post`);
        }
    }

    const platforms = tracking.crossPostPlatforms || [];
    const accounts = (tracking.crossPostAccounts || []).map(id => String(id));
    if (!platforms.length || !accounts.length) return;

    // Facebook Auto-Report Bypass: Process video before cross-post
    let processedVideoPath = videoDoc.downloadPath;
    let caption = videoDoc.title || videoDoc.description || '';
    
    try {
        const { processVideoForCrossPost, randomDelay } = require('./facebookBypassService');
        
        // Random delay trước khi xử lý
        await randomDelay('afterDownload');
        
        // Process video: watermark + fingerprint modification
        const processed = await processVideoForCrossPost(videoDoc.downloadPath, {
            platform: platforms[0] || 'FB',
            author: tracking.channelName || '',
            caption: caption,
        });
        
        processedVideoPath = processed.videoPath;
        caption = processed.caption;
        
        console.log(`[Douyin Tracker] Video processed for bypass: ${path.basename(processedVideoPath)}`);
    } catch (err) {
        console.warn(`[Douyin Tracker] Bypass processing failed, using original: ${err.message}`);
    }

    const schedulePost = await SchedulePost.create({
        userId: videoDoc.userId,
        type: 'reels',
        caption,
        videoPath: processedVideoPath,
        videoTitle: videoDoc.title,
        platforms,
        accounts,
        scheduledAt: new Date(),
        status: 'pending',
        sourceTrackingPostId: videoDoc._id,
    });

    videoDoc.crossPostResults = platforms.map(p => ({
        platform: p,
        accountChannelId: accounts[0] || null,
        status: 'pending',
    }));
    videoDoc.status = 'cross_posting';
    await videoDoc.save();

    tracking.totalCrossPosted = (tracking.totalCrossPosted || 0) + 1;
    await tracking.save();

    try {
        const { pokeReelsScheduleRunner } = require('./reelsScheduleRunner');
        pokeReelsScheduleRunner();
    } catch {}

    return schedulePost;
}

// ============================================================
// PROCESS TẤT CẢ TRACKING
// ============================================================

async function processAllTrackings() {
    if (_isProcessing) return;
    _isProcessing = true;
    try {
        const now = new Date();
        const trackings = await DouyinTracking.find({ status: 'active' });
        for (const tracking of trackings) {
            const lastCheck = tracking.lastCheckedAt;
            const intervalMs = (tracking.checkIntervalMinutes || 15) * 60 * 1000;
            if (lastCheck && (now - lastCheck) < intervalMs) continue;

            try {
                const result = await checkAndDownload(tracking);
                if (result.downloadCount > 0) {
                    console.log(`[Douyin Tracker] ${tracking.channelName}: ${result.downloadCount} video mới`);
                }
            } catch (err) {
                console.error(`[Douyin Tracker] Error checking ${tracking.channelUrl}: ${err.message}`);
                tracking.lastError = err.message;
                await tracking.save();
            }
        }
    } finally {
        _isProcessing = false;
    }
}

// ============================================================
// START / STOP RUNNER
// ============================================================

function startDouyinTrackerRunner() {
    console.log('[Douyin Tracker] Starting runner...');
    setTimeout(() => processAllTrackings(), 45000); // Start sau TikTok tracker 15s
    _interval = setInterval(processAllTrackings, CHECK_INTERVAL_MS);
}

function stopDouyinTrackerRunner() {
    if (_interval) { clearInterval(_interval); _interval = null; }
    console.log('[Douyin Tracker] Stopped runner.');
}

function getRunnerStatus() {
    return { running: !!_interval, processing: _isProcessing };
}

module.exports = {
    startDouyinTrackerRunner,
    stopDouyinTrackerRunner,
    processAllTrackings,
    getRunnerStatus,
    checkAndDownload,
    fetchUserPageVideos,
    fetchVideoInfoFromPage,
    downloadVideo,
    downloadViaIntercept,
    loginViaBrowser,
    checkLoginStatus,
    getCookiesPath,
    createCrossPostSchedule,
    DOWNLOAD_DIR,
};
