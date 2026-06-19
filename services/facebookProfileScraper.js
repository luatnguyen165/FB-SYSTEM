// services/facebookProfileScraper.js
// Scrape bài viết từ Facebook Profile qua GraphQL API
// Refactor từ facebook_post_comment_scraper/post_scraper.py

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Download Facebook video bằng python facebook-video-download-api.py
 * @param {string} reelUrl - URL reel/video
 * @param {string} saveDir - Thư mục lưu video
 * @param {string} filename - Tên file
 * @returns {string|null} Đường dẫn file đã download hoặc null nếu lỗi
 */
async function downloadFacebookReel(reelUrl, saveDir, filename = '', retries = 2) {
    if (!reelUrl || !reelUrl.includes('facebook.com')) return null;

    if (!filename) {
        const reelId = reelUrl.match(/reel\/(\d+)/)?.[1] || Date.now();
        filename = `reel_${reelId}.mp4`;
    }

    const filepath = path.join(saveDir, filename);
    fs.mkdirSync(saveDir, { recursive: true });

    const pythonScript = path.join(__dirname, '..', 'utils', 'facebook-video-download-api.py');

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

            console.log(`[Reel Download] Attempt ${attempt}: ${reelUrl.substring(0, 80)}...`);
            const result = execSync(`python "${pythonScript}" "${reelUrl}"`, {
                timeout: 60000,
                stdio: 'pipe'
            }).toString();

            let videoDownloadUrl = '';
            const hdMatch = result.match(/HD Link:\s*(https?:\/\/\S+)/);
            const sdMatch = result.match(/SD Link:\s*(https?:\/\/\S+)/);
            if (hdMatch) videoDownloadUrl = hdMatch[1].trim();
            else if (sdMatch) videoDownloadUrl = sdMatch[1].trim();

            if (!videoDownloadUrl) {
                console.log(`[Reel Download] No video URL found`);
                continue;
            }

            console.log(`[Reel Download] Downloading: ${videoDownloadUrl.substring(0, 80)}...`);
            const res = await axios.get(videoDownloadUrl, {
                responseType: 'arraybuffer',
                timeout: 300000,
                headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                maxRedirects: 5,
            });

            if (res.data && res.data.length > 10000) {
                fs.writeFileSync(filepath, Buffer.from(res.data));
                console.log(`[Reel Download] ✓ ${filename} (${(res.data.length / 1024 / 1024).toFixed(1)}MB)`);
                return filepath;
            }
        } catch (e) {
            console.log(`[Reel Download] Attempt ${attempt} failed: ${e.message?.substring(0, 100)}`);
            if (attempt < retries) await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.error(`[Reel Download] ✗ All ${retries} attempts failed for ${reelUrl}`);
    return null;
}

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';
const DOC_ID = '25430544756617998'; // ProfileCometTimelineFeedRefetchQuery
const DOC_ID_PHOTO = '26168653472729001'; // CometPhotoRootContentQuery

// ==================== HELPERS ====================

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sanitizeFolderName(name) {
    return (name || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Unknown';
}

function getHttpsAgent(proxy) {
    return proxy ? new HttpsProxyAgent(proxy) : null;
}

// ==================== PARSE FB RESPONSE ====================

function extractDataBlocks(rawText) {
    if (typeof rawText !== 'string') return [];
    const blocks = [];
    let i = 0;
    const n = rawText.length;

    while (true) {
        const idx = rawText.indexOf('"data"', i);
        if (idx === -1) break;
        const braceStart = rawText.indexOf('{', idx);
        if (braceStart === -1) break;

        let depth = 0;
        for (let j = braceStart; j < n; j++) {
            if (rawText[j] === '{') depth++;
            else if (rawText[j] === '}') {
                depth--;
                if (depth === 0) {
                    try { blocks.push(JSON.parse(rawText.substring(braceStart, j + 1))); } catch (_) {}
                    i = j + 1;
                    break;
                }
            }
        }
        if (depth !== 0) break;
    }
    return blocks;
}

function parseFbResponse(text) {
    if (typeof text !== 'string') return [];
    text = text.replace(/^for \(;;\);/gm, '').trim();
    return extractDataBlocks(text).filter(b => typeof b === 'object' && b !== null && !Array.isArray(b))
        .map(b => { const c = { ...b }; delete c.errors; delete c.extensions; return c; });
}

// ==================== EXTRACT DATA ====================

function extractPageName(node) {
    try {
        const actors = node?.comet_sections?.content?.story?.actors;
        if (actors?.length > 0) return actors[0].name;
        const owning = node?.feedback?.owning_profile;
        if (owning) return owning.name || owning.short_name;
        return null;
    } catch { return null; }
}

function extractCommentCount(node) {
    try {
        // 6 paths to find comment count
        const paths = [
            n => n?.feedback?.comment_rendering_instance?.comments?.total_count,
            n => n?.comet_sections?.feedback?.story?.story_ufi_container?.story?.feedback_context?.feedback_target_with_context?.comment_rendering_instance?.comments?.total_count,
            n => n?.comet_sections?.feedback?.story?.story_ufi_container?.story?.feedback_context?.feedback_target_with_context?.comet_ufi_summary_and_actions_renderer?.feedback?.comment_rendering_instance?.comments?.total_count,
            n => n?.comet_sections?.feedback?.story?.feedback_context?.feedback_target_with_context?.comment_rendering_instance?.comments?.total_count,
            n => n?.feedback?.comments_count_summary_renderer?.feedback?.comment_rendering_instance?.comments?.total_count,
            n => n?.feedback?.comment_rendering_instance?.comments?.total_count,
        ];
        for (const p of paths) {
            const c = p(node);
            if (c != null) return c;
        }
        return 0;
    } catch { return 0; }
}

function isReelOrVideoPost(node) {
    if ((node?.__typename || '').toLowerCase().includes('reel')) return true;
    if ((node?.comet_sections?.content?.__typename || '').toLowerCase().includes('reel')) return true;
    for (const att of (node?.attachments || [])) {
        const media = att?.styles?.attachment?.media;
        if (media?.__typename === 'Video') return true;
        if (JSON.stringify(media || {}).toLowerCase().includes('reel')) return true;
        for (const m of (att?.styles?.attachment?.all_subattachments?.nodes || [])) {
            if (m?.media?.__typename === 'Video') return true;
            if (JSON.stringify(m?.media || {}).toLowerCase().includes('reel')) return true;
        }
    }
    return false;
}

// ==================== MEDIA HANDLING ====================

const imageCounters = {};

function extractMediaUrls(node, postId) {
    if (!imageCounters[postId]) imageCounters[postId] = 0;
    const images = [];
    const videos = [];
    let lastMediaId = null;

    const addPhoto = (mediaNode) => {
        const url = mediaNode?.photo_image?.uri || mediaNode?.image?.uri;
        if (url) {
            imageCounters[postId]++;
            lastMediaId = mediaNode.id;
            images.push(url);
        }
    };

    const addVideo = (mediaNode, reelUrl) => {
        // Lấy video URL từ nhiều sources (bao gồm Reels)
        let url = mediaNode?.playable_url
            || mediaNode?.playable_url_quality_hd
            || mediaNode?.playable_url_quality_sd
            || mediaNode?.browser_native_hd_url
            || mediaNode?.browser_native_sd_url
            || mediaNode?.video_url
            || '';

        // Reels: URL nằm trong videoDeliveryResponseFragment
        if (!url) {
            const delivery = mediaNode?.videoDeliveryResponseFragment || mediaNode?.videoDeliveryLegacyFields;
            if (delivery) {
                const deliveryStr = JSON.stringify(delivery);
                const mp4Match = deliveryStr.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
                if (mp4Match) url = mp4Match[0];
            }
        }

        // Lưu reel URL để fetch video sau
        if (!url && reelUrl) {
            videos.push({ url: '', reelUrl, duration: mediaNode?.video_duration || mediaNode?.length_in_second || 0 });
            return;
        }

        if (url && url.startsWith('http') && !url.includes('facebook.com/reel')) {
            videos.push({ url, duration: mediaNode?.video_duration || mediaNode?.length_in_second || 0 });
        }
    };

    const isVideo = (media) => {
        if (!media) return false;
        if (media.__typename === 'Video') return true;
        if (media.playable_url || media.playable_url_quality_hd || media.browser_native_hd_url) return true;
        if (media.url && media.__typename === 'Video') return true;
        return false;
    };

    // Tìm reel URL từ timestamp.story.url
    const reelUrl = node?.comet_sections?.timestamp?.story?.url || '';
    const isReel = reelUrl.includes('/reel/');

    // Nếu là Reel → luôn thêm reelUrl cho download
    if (isReel) {
        console.log(`[Profile Scraper] ${postId}: Reel detected → ${reelUrl}`);
        videos.push({ url: '', reelUrl, duration: 0 });
    } else {
        // Không phải Reel → extract ảnh + video bình thường
        for (const att of (node?.attachments || [])) {
            const attachment = att?.styles?.attachment || {};
            if (attachment.media) {
                if (isVideo(attachment.media)) addVideo(attachment.media, '');
                else addPhoto(attachment.media);
            }
            for (const m of (attachment?.all_subattachments?.nodes || [])) {
                if (m?.media) {
                    if (isVideo(m.media)) addVideo(m.media, '');
                    else addPhoto(m.media);
                }
            }
        }
    }

    return { images, videos, lastMediaId };
}

async function fetchRemainingImageUrls(lastMediaId, postId, cookies, fbDtsg, proxy) {
    if (!lastMediaId) return [];
    const urls = [];
    let currentNode = lastMediaId;
    const visited = new Set();
    let count = 0;

    while (currentNode && !visited.has(currentNode) && count < 50) {
        visited.add(currentNode);
        const variables = {
            isMediaset: true, renderLocation: 'comet_media_viewer',
            nodeID: currentNode, mediasetToken: `pcb.${postId}`,
            scale: 2, feedLocation: 'COMET_MEDIA_VIEWER',
            feedbackSource: 65, focusCommentID: null,
            privacySelectorRenderLocation: 'COMET_MEDIA_VIEWER',
            useDefaultActor: false, shouldShowComments: true,
        };
        const payload = {
            av: cookies.c_user || '0', __user: cookies.c_user || '0',
            __a: '1', fb_dtsg: fbDtsg || '',
            doc_id: DOC_ID_PHOTO, variables: JSON.stringify(variables),
        };
        try {
            const r = await axios.post(GRAPHQL_URL, new URLSearchParams(payload).toString(), {
                headers: { 'user-agent': 'Mozilla/5.0', 'content-type': 'application/x-www-form-urlencoded', origin: 'https://www.facebook.com', 'x-fb-friendly-name': 'CometPhotoRootContentQuery' },
                timeout: 30000, httpsAgent: getHttpsAgent(proxy),
            });
            if (r.status !== 200) break;
            const blocks = parseFbResponse(r.data);
            let imageUrl = null, nextNode = null;
            for (const b of blocks) {
                if (b.currMedia?.image?.uri) imageUrl = b.currMedia.image.uri;
                if (b.nextMediaAfterNodeId?.id) nextNode = b.nextMediaAfterNodeId.id;
            }
            if (imageUrl) { urls.push(imageUrl); count++; }
            if (nextNode) { currentNode = nextNode; await sleep(500); }
            else break;
        } catch { break; }
    }
    return urls;
}

async function downloadImage(url, saveDir, filename) {
    try {
        fs.mkdirSync(saveDir, { recursive: true });
        const ext = url.toLowerCase().includes('.png') ? '.png' : url.toLowerCase().includes('.webp') ? '.webp' : '.jpg';
        const filepath = path.join(saveDir, `${filename}${ext}`);
        console.log(`[Download] Downloading: ${url.substring(0, 80)}...`);
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        fs.writeFileSync(filepath, r.data);
        const relativePath = `/uploads/scraper/${path.basename(saveDir)}/${filename}${ext}`;
        console.log(`[Download] Saved: ${relativePath} (${r.data.length} bytes)`);
        return relativePath;
    } catch (e) {
        console.error(`[Download] Failed: ${e.message}`);
        return null;
    }
}

// ==================== DOWNLOAD QUEUE ====================
class DownloadQueue {
    constructor(concurrency = 2, delayMs = 500, retries = 3) {
        this.queue = [];
        this.running = 0;
        this.concurrency = concurrency;
        this.delayMs = delayMs;
        this.retries = retries;
    }

    async add(task, taskName = 'task') {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, taskName, resolve, reject, attempt: 1 });
            this.process();
        });
    }

    async process() {
        if (this.running >= this.concurrency || this.queue.length === 0) return;

        this.running++;
        const item = this.queue.shift();

        try {
            const result = await item.task();
            item.resolve(result);
        } catch (e) {
            if (item.attempt < this.retries) {
                item.attempt++;
                console.log(`[Queue] Retry ${item.attempt}/${this.retries} for ${item.taskName}`);
                await sleep(this.delayMs * 2); // Delay hơn khi retry
                this.queue.unshift(item); // Đưa lại đầu queue
                this.running--;
                this.process();
                return;
            } else {
                console.log(`[Queue] Failed after ${this.retries} attempts: ${item.taskName}`);
                item.resolve(null); // Resolve null thay vì reject để không break flow
            }
        } finally {
            this.running--;
            if (this.delayMs > 0) {
                await sleep(this.delayMs);
            }
            this.process();
        }
    }
}

// Singleton queue cho download ảnh
const imageDownloadQueue = new DownloadQueue(2, 300, 3); // 2 concurrent, 300ms delay, 3 retries

// ==================== EXTRACT TIMESTAMP ====================

/**
 * Extract thời gian từ Facebook story node
 * Facebook encode timestamp bằng CSS classes trong spans
 */
function extractTimestampText(node) {
    try {
        // Path 1: Text từ metadata
        const metadata = node?.comet_sections?.content?.story?.comet_sections?.context_layout?.story?.comet_sections?.metadata;
        if (metadata && metadata.length > 0) {
            for (const meta of metadata) {
                const text = meta?.story?.comet_sections?.creation_time?.creation_time?.text;
                if (text) return text;
                const ranges = meta?.story?.comet_sections?.creation_time?.creation_time?.ranges;
                if (ranges && ranges.length > 0) {
                    return ranges.map(r => r?.entity?.title?.text || '').join('');
                }
            }
        }

        // Path 2: Từ timestamp_renderer
        const timestampRenderer = node?.comet_sections?.content?.story?.comet_sections?.context_layout?.story?.comet_sections?.timestamp_renderer?.story?.created_time?.text;
        if (timestampRenderer) return timestampRenderer;

        // Path 3: Từ actors[0].subtitle.text
        const subtitle = node?.comet_sections?.content?.story?.actors?.[0]?.subtitle?.text;
        if (subtitle) return subtitle;

        // Path 4: Từ feedback.story.url
        const feedbackTime = node?.feedback?.story?.comet_sections?.creation_time?.creation_time?.text;
        if (feedbackTime) return feedbackTime;

        return '';
    } catch { return ''; }
}

/**
 * Parse ngày giờ tiếng Việt: "3 thg 6, 2025 14:30" hoặc "14:30 03/06/2025"
 */
function parseVietnameseDate(text) {
    if (!text) return null;
    try {
        // Pattern: "3 thg 6, 2025 14:30" hoặc "3 tháng 6, 2025 lúc 14:30"
        const match1 = text.match(/(\d{1,2})\s*th(?:á)?ng?\s*(\d{1,2}),?\s*(\d{4})(?:\s*lúc)?\s*(\d{1,2}):(\d{2})/);
        if (match1) {
            const [, day, month, year, hour, minute] = match1;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        }

        // Pattern: "14:30 03/06/2025" hoặc "03/06/2025 14:30"
        const match2 = text.match(/(\d{1,2}):(\d{2})\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (match2) {
            const [, hour, minute, day, month, year] = match2;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        }
        const match3 = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})/);
        if (match3) {
            const [, day, month, year, hour, minute] = match3;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
        }

        // Pattern: "2 giờ" / "3 ngày" / "1 tuần" (relative)
        const relMatch = text.match(/(\d+)\s*(giờ|phút|ngày|tuần|tháng)/);
        if (relMatch) {
            const [, num, unit] = relMatch;
            const now = new Date();
            const n = parseInt(num);
            if (unit === 'phút') now.setMinutes(now.getMinutes() - n);
            else if (unit === 'giờ') now.setHours(now.getHours() - n);
            else if (unit === 'ngày') now.setDate(now.getDate() - n);
            else if (unit === 'tuần') now.setDate(now.getDate() - n * 7);
            else if (unit === 'tháng') now.setMonth(now.getMonth() - n);
            return now;
        }

        return null;
    } catch { return null; }
}

// ==================== RESOLVE USERNAME → ID ====================

async function resolveProfileIdAndToken(profileIdOrUsername, cookies, proxy) {
    let numericId = profileIdOrUsername;
    let fbDtsg = '';

    // Nếu đã là numeric ID thì chỉ cần lấy fb_dtsg
    const needsResolve = !/^\d+$/.test(profileIdOrUsername);

    try {
        console.log(`[Profile Scraper] Resolving "${profileIdOrUsername}"...`);
        const url = needsResolve
            ? `https://www.facebook.com/${profileIdOrUsername}`
            : `https://www.facebook.com/profile.php?id=${profileIdOrUsername}`;

        const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        const r = await axios.get(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                cookie: cookieHeader,
            },
            timeout: 15000,
            httpsAgent: getHttpsAgent(proxy),
            maxRedirects: 5,
        });

        const html = r.data || '';

        // Tìm numeric ID
        if (needsResolve) {
            const idPatterns = [/"userID":"(\d+)"/, /"user_id":"(\d+)"/, /profile\.php\?id=(\d+)/, /"entity_id":"(\d+)"/, /"actorID":"(\d+)"/];
            for (const p of idPatterns) {
                const m = html.match(p);
                if (m) { numericId = m[1]; break; }
            }
        }

        // Tìm fb_dtsg từ HTML
        const dtsgPatterns = [
            /"DTSGInitialData".*?"token"\s*:\s*"([^"]+)"/,
            /"fb_dtsg"\s*:\s*"([^"]+)"/,
            /name="fb_dtsg"\s+value="([^"]+)"/,
            /"async_get_token"\s*:\s*"([^"]+)"/,
        ];
        for (const p of dtsgPatterns) {
            const m = html.match(p);
            if (m) { fbDtsg = m[1]; break; }
        }

        console.log(`[Profile Scraper] Resolved: id=${numericId}, fb_dtsg=${fbDtsg ? 'yes' : 'no'}`);
    } catch (e) {
        console.log(`[Profile Scraper] Lỗi resolve: ${e.message}`);
    }

    return { numericId, fbDtsg };
}

// ==================== SCRAPE FROM HTML ====================

/**
 * Extract ảnh từ story node
 */
function extractImagesFromStory(story) {
    const images = [];
    try {
        const attachments = story?.attachments || [];
        for (const att of attachments) {
            const media = att?.styles?.attachment?.media;
            if (media) {
                const url = media?.photo_image?.uri || media?.image?.uri || media?.viewer_image?.uri;
                if (url) images.push(url);
            }
            const allMedia = att?.styles?.attachment?.all_subattachments?.nodes || [];
            for (const m of allMedia) {
                const url = m?.media?.photo_image?.uri || m?.media?.image?.uri || m?.media?.viewer_image?.uri;
                if (url) images.push(url);
            }
        }
    } catch (e) { /* skip */ }
    return images;
}

/**
 * Scrape bài viết trực tiếp từ HTML (không cần GraphQL)
 */
async function scrapeFromHtml(profileUrl, cookies, proxy, limit = 10) {
    const posts = [];
    try {
        const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        console.log(`[HTML Scraper] Fetching ${profileUrl}...`);

        const r = await axios.get(profileUrl, {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'cookie': cookieHeader,
                'accept': 'text/html,application/xhtml+xml',
                'accept-language': 'vi-VN,vi;q=0.9',
            },
            timeout: 30000,
            httpsAgent: getHttpsAgent(proxy),
        });

        const html = r.data || '';
        console.log(`[HTML Scraper] Page length: ${html.length}`);

        // Tìm bài viết từ data blocks
        const dataBlocks = extractDataBlocks(html);
        console.log(`[HTML Scraper] Found ${dataBlocks.length} data blocks`);

        for (const block of dataBlocks) {
            if (posts.length >= limit) break;
            try {
                const stories = findStoryNodes(block);
                for (const story of stories) {
                    if (posts.length >= limit) break;
                    const postId = story.post_id;
                    const text = story?.comet_sections?.content?.story?.message?.text || '';
                    const permalink = story?.attachments?.[0]?.styles?.attachment?.url || '';
                    const images = extractImagesFromStory(story);
                    const commentCount = story?.feedback?.comment_rendering_instance?.comments?.total_count || 0;
                    let publishedAt = null;
                    try {
                        const ct = story?.comet_sections?.content?.story?.created_time || story?.feedback?.story?.creation_time;
                        if (ct) publishedAt = new Date(ct * 1000);
                    } catch {}
                    if (postId && (text || images.length > 0)) {
                        posts.push({ postId, text, permalink, images, commentCount, publishedAt });
                        console.log(`[HTML Scraper] Found post ${postId}: "${text.substring(0, 50)}..." (${images.length} images) ${publishedAt ? publishedAt.toISOString() : ''}`);
                    }
                }
            } catch (e) { /* skip */ }
        }

        // Fallback: tìm ảnh trực tiếp từ HTML nếu không có data blocks
        if (posts.length === 0) {
            console.log(`[HTML Scraper] Trying direct HTML image extraction...`);
            const imgPattern = /https:\/\/scontent[^"'\s]+\.(?:jpg|png|webp|jpeg)[^"'\s]*/gi;
            const foundImages = [...new Set((html.match(imgPattern) || []).slice(0, 20))];
            if (foundImages.length > 0) {
                posts.push({ postId: 'html_' + Date.now(), text: '', permalink: profileUrl, images: foundImages, commentCount: 0 });
                console.log(`[HTML Scraper] Found ${foundImages.length} images from HTML`);
            }
        }

        console.log(`[HTML Scraper] Total: ${posts.length} posts`);
    } catch (e) {
        console.error(`[HTML Scraper] Error: ${e.message}`);
    }
    return posts;
}

function findStoryNodes(obj) {
    const results = [];
    if (!obj || typeof obj !== 'object') return results;

    if (obj.__typename === 'Story' && obj.post_id) {
        results.push(obj);
    }

    if (obj.edges && Array.isArray(obj.edges)) {
        for (const edge of obj.edges) {
            if (edge?.node?.__typename === 'Story') results.push(edge.node);
        }
    }

    for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
            results.push(...findStoryNodes(obj[key]));
        }
    }
    return results;
}

// ==================== MAIN SCRAPER ====================

/**
 * Scrape bài viết từ Facebook profile
 * @param {Object} options
 * @param {string} options.profileId - Facebook profile ID hoặc username
 * @param {Object} options.cookies - Facebook cookies { c_user, xs, ... }
 * @param {string} options.fbDtsg - FB_DTSG token
 * @param {number} options.limit - Số bài tối đa
 * @param {string} options.proxy - Proxy URL (optional)
 * @param {string} options.saveDir - Thư mục lưu ảnh
 * @returns {Array} Danh sách bài viết
 */
async function scrapeProfilePosts({ profileId, cookies, fbDtsg, limit = 10, proxy = null, saveDir = 'uploads/tracking' }) {
    console.log(`[Profile Scraper] === START === profileId="${profileId}", limit=${limit}, c_user=${cookies.c_user || 'null'}, fb_dtsg=${fbDtsg ? 'yes' : 'no'}`);

    // Resolve username → numeric ID + lấy fb_dtsg
    let numericId;
    try {
        const resolved = await resolveProfileIdAndToken(profileId, cookies, proxy);
        numericId = resolved.numericId;
        if (resolved.fbDtsg && !fbDtsg) {
            fbDtsg = resolved.fbDtsg;
            console.log(`[Profile Scraper] Got fb_dtsg from page`);
        }
        console.log(`[Profile Scraper] Resolved: ${profileId} → ${numericId}, fb_dtsg=${fbDtsg ? 'yes' : 'no'}`);
    } catch (e) {
        console.error(`[Profile Scraper] Lỗi resolve profileId: ${e.message}`);
        return [];
    }

    // Thử GraphQL trước
    const allPosts = [];
    let cursor = null;
    let pageNum = 0;

    while (allPosts.length < limit) {
        pageNum++;
        const variables = {
            count: 3, cursor, id: numericId,
            feedLocation: 'TIMELINE', renderLocation: 'timeline',
            scale: 2, useDefaultActor: false,
        };
        const payload = {
            av: cookies.c_user || '0', __user: cookies.c_user || '0',
            __a: '1', fb_dtsg: fbDtsg || '',
            doc_id: DOC_ID, variables: JSON.stringify(variables),
        };

        console.log(`[Profile Scraper] Page ${pageNum}: calling GraphQL with id=${numericId}, cursor=${cursor || 'null'}`);

        // Build cookie header
        const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

        let cleanedData = [];
        for (let retry = 0; retry < 3; retry++) {
            try {
                const r = await axios.post(GRAPHQL_URL, new URLSearchParams(payload).toString(), {
                    headers: {
                        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'content-type': 'application/x-www-form-urlencoded',
                        'origin': 'https://www.facebook.com',
                        'referer': `https://www.facebook.com/profile.php?id=${numericId}`,
                        'cookie': cookieHeader,
                    },
                    timeout: 30000, httpsAgent: getHttpsAgent(proxy),
                });
                console.log(`[Profile Scraper] GraphQL response: status=${r.status}, length=${(r.data || '').length}`);
                if (r.data && typeof r.data === 'string') {
                    console.log(`[Profile Scraper] Response preview: ${r.data.substring(0, 200)}`);
                }
                cleanedData = parseFbResponse(r.data);
                console.log(`[Profile Scraper] Parsed ${cleanedData.length} data blocks`);
                if (cleanedData.length > 0) break;
                else console.log(`[Profile Scraper] Empty response, retry ${retry + 1}/3`);
            } catch (e) {
                console.error(`[Profile Scraper] GraphQL error retry ${retry + 1}/3: ${e.message}`);
                if (e.response) {
                    console.error(`[Profile Scraper] Response status: ${e.response.status}, data: ${JSON.stringify(e.response.data).substring(0, 200)}`);
                }
                await sleep(2000);
            }
        }

        if (cleanedData.length === 0) {
            console.log('[Profile Scraper] Không có data, dừng');
            break;
        }

        // Collect Story nodes
        const storyNodes = [];
        let timelineBlock = null;
        for (const block of cleanedData) {
            const node = block.node || {};
            if (node.timeline_list_feed_units) {
                timelineBlock = block;
                for (const edge of (node.timeline_list_feed_units.edges || [])) {
                    if (edge?.node?.__typename === 'Story') storyNodes.push(edge.node);
                }
            }
            if (node.__typename === 'Story') storyNodes.push(node);
            if (node.__typename === 'Group') {
                for (const edge of (node?.group_feed?.edges || [])) {
                    if (edge?.node?.__typename === 'Story') storyNodes.push(edge.node);
                }
            }
        }

        console.log(`[Profile Scraper] Page ${pageNum}: ${storyNodes.length} posts`);

        for (const node of storyNodes) {
            if (allPosts.length >= limit) break;

            const postId = node.post_id;
            const postIndex = allPosts.length + 1;
            console.log(`[Profile Scraper] ──────────── Post ${postIndex}/${limit} ────────────`);
            if (!postId) continue;

            const text = node?.comet_sections?.content?.story?.message?.text || '';
            const permalink = node?.attachments?.[0]?.styles?.attachment?.url || '';
            const commentCount = extractCommentCount(node);
            const authorName = extractPageName(node) || '';

            // Extract thời gian đăng bài
            let publishedAt = null;
            let publishedAtText = '';

            // Debug: log timestamp object structure
            const tsObj = node?.comet_sections?.timestamp;
            console.log(`[Profile Scraper] Debug ${postId}: timestamp type=${typeof tsObj}, keys=${Object.keys(tsObj || {}).join(',')}`);
            if (tsObj) {
                console.log(`[Profile Scraper] Debug ${postId}: timestamp=${JSON.stringify(tsObj).substring(0, 500)}`);
            }

            try {
                // Path 1: comet_sections.timestamp.story.creation_time (Unix)
                const creationTime = node?.comet_sections?.timestamp?.story?.creation_time;
                if (creationTime) {
                    publishedAt = new Date(creationTime * 1000);
                    publishedAtText = publishedAt.toLocaleString('vi-VN');
                }

                // Path 2: comet_sections.content.story.created_time
                if (!publishedAt) {
                    const ct = node?.comet_sections?.content?.story?.created_time;
                    if (ct) {
                        publishedAt = new Date(ct * 1000);
                        publishedAtText = publishedAt.toLocaleString('vi-VN');
                    }
                }

                // Path 3: feedback.story.creation_time
                if (!publishedAt) {
                    const ct = node?.feedback?.story?.creation_time;
                    if (ct) {
                        publishedAt = new Date(ct * 1000);
                        publishedAtText = publishedAt.toLocaleString('vi-VN');
                    }
                }

                // Path 4: attachment target.post_time
                if (!publishedAt) {
                    const pt = node?.attachments?.[0]?.styles?.attachment?.target?.post_time;
                    if (pt) {
                        publishedAt = new Date(pt * 1000);
                        publishedAtText = publishedAt.toLocaleString('vi-VN');
                    }
                }
            } catch {}

            // Debug attachments cho reels
            const att0 = node?.attachments?.[0]?.styles?.attachment;
            if (att0?.media?.__typename === 'Video') {
                const m = att0.media;
                console.log(`[Profile Scraper] Debug ${postId}: playable_url=${m.playable_url?.substring(0, 100) || 'null'}`);
                console.log(`[Profile Scraper] Debug ${postId}: browser_native_hd=${m.browser_native_hd_url?.substring(0, 100) || 'null'}`);

                // Tìm tất cả URLs trong video delivery
                const delivery = m.videoDeliveryResponseFragment;
                if (delivery) {
                    const deliveryStr = JSON.stringify(delivery);
                    // Tìm tất cả URLs có thể là video
                    const allVideoUrls = deliveryStr.match(/https?:\/\/[^"'\s]+(?:\.mp4|\.m3u8|video)[^"'\s]*/g);
                    if (allVideoUrls) {
                        console.log(`[Profile Scraper] Debug ${postId}: videoUrls=${allVideoUrls.slice(0, 5).join('\n')}`);
                    }
                }
            }

            // Extract images + videos
            const { images: rawUrls, videos: rawVideos, lastMediaId } = extractMediaUrls(node, postId);
            let allImageUrls = [...rawUrls];

            console.log(`[Post ${postIndex}] ${postId}: ${allImageUrls.length} ảnh, ${rawVideos.length} video`);

            // Fetch remaining if 5 images (may have more)
            if (rawUrls.length === 5 && lastMediaId) {
                console.log(`[Post ${postIndex}] Fetch thêm ảnh...`);
                const extra = await fetchRemainingImageUrls(lastMediaId, postId, cookies, fbDtsg, proxy);
                allImageUrls.push(...extra);
            }

            // Download images (dùng queue)
            const postSaveDir = path.join(saveDir, String(postId));
            const savedImages = [];

            // Download tuần tự với queue
            for (let i = 0; i < allImageUrls.length; i++) {
                const imgName = `${postId}_img_${i + 1}`;
                console.log(`[Post ${postIndex}] Download ảnh ${i + 1}/${allImageUrls.length}...`);
                const saved = await imageDownloadQueue.add(
                    () => downloadImage(allImageUrls[i], postSaveDir, `${postId}_${i + 1}`),
                    imgName
                );
                if (saved) savedImages.push(saved);
            }
            console.log(`[Post ${postIndex}] ✓ ${savedImages.length}/${allImageUrls.length} ảnh`);

            // Download videos (dùng queue)
            const savedVideos = [];
            const videoTasks = [];

            for (let i = 0; i < rawVideos.length; i++) {
                const v = rawVideos[i];
                const videoUrl = v.reelUrl || v.url;
                if (!videoUrl || !videoUrl.includes('facebook.com')) continue;

                videoTasks.push({
                    url: videoUrl,
                    index: videoTasks.length + 1
                });
            }

            // Download tuần tự với queue
            for (const vt of videoTasks) {
                const videoName = `${postId}_video_${vt.index}`;
                console.log(`[Post ${postIndex}] Download video ${vt.index}/${videoTasks.length}...`);
                const savedPath = await imageDownloadQueue.add(
                    () => downloadFacebookReel(vt.url, postSaveDir, `${postId}_video_${vt.index}.mp4`),
                    videoName
                );
                if (savedPath) {
                    savedVideos.push(`/uploads/scraper/${postId}/${postId}_video_${vt.index}.mp4`);
                    console.log(`[Post ${postIndex}] ✓ Video ${vt.index} xong`);
                } else {
                    console.log(`[Post ${postIndex}] ✗ Video ${vt.index} thất bại`);
                }
            }

            allPosts.push({ postId, text, permalink, commentCount, authorName, images: savedImages, videos: savedVideos, publishedAt, publishedAtText });
            console.log(`[Post ${postIndex}] ✓ HOÀN THÀNH: "${text.substring(0, 40)}..." (${savedImages.length} ảnh, ${savedVideos.length} video)`);
        }

        // Pagination
        let pageInfo = timelineBlock?.node?.timeline_list_feed_units?.page_info;
        if (!pageInfo) {
            for (const b of cleanedData) {
                if (b?.page_info) { pageInfo = b.page_info; break; }
            }
        }
        cursor = pageInfo?.end_cursor;
        if (!cursor) break;
        await sleep(1000);
    }

    // Fallback: nếu GraphQL không có bài, thử scrape từ HTML
    if (allPosts.length === 0) {
        console.log(`[Profile Scraper] GraphQL 0 posts, fallback to HTML scraping...`);
        const profileUrl = `https://www.facebook.com/profile.php?id=${numericId}`;
        const htmlPosts = await scrapeFromHtml(profileUrl, cookies, proxy, limit);
        allPosts.push(...htmlPosts);
    }

    console.log(`[Profile Scraper] Hoàn thành: ${allPosts.length} bài viết`);
    return allPosts;
}

module.exports = { scrapeProfilePosts, downloadFacebookReel, DownloadQueue, imageDownloadQueue };
