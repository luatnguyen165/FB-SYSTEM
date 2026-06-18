// services/facebookProfileScraper.js
// Scrape bài viết từ Facebook Profile qua GraphQL API
// Refactor từ facebook_post_comment_scraper/post_scraper.py

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

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

// ==================== IMAGE HANDLING ====================

const imageCounters = {};

function extractMediaUrls(node, postId) {
    if (!imageCounters[postId]) imageCounters[postId] = 0;
    const images = [];
    let lastMediaId = null;

    const addPhoto = (mediaNode) => {
        const url = mediaNode?.photo_image?.uri || mediaNode?.image?.uri;
        if (url) {
            imageCounters[postId]++;
            lastMediaId = mediaNode.id;
            images.push(url);
        }
    };

    for (const att of (node?.attachments || [])) {
        const attachment = att?.styles?.attachment || {};
        if (attachment.media) addPhoto(attachment.media);
        for (const m of (attachment?.all_subattachments?.nodes || [])) {
            if (m?.media) addPhoto(m.media);
        }
    }

    return { images, lastMediaId };
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
            if (isReelOrVideoPost(node)) continue;

            const postId = node.post_id;
            if (!postId) continue;

            const text = node?.comet_sections?.content?.story?.message?.text || '';
            const permalink = node?.attachments?.[0]?.styles?.attachment?.url || '';
            const commentCount = extractCommentCount(node);
            const authorName = extractPageName(node) || '';

            // Extract thời gian đăng bài
            let publishedAt = null;
            let publishedAtText = '';

            // Debug: log top-level keys và timestamp fields
            const nodeKeys = Object.keys(node || {});
            const cometKeys = Object.keys(node?.comet_sections || {});
            const contentKeys = Object.keys(node?.comet_sections?.content || {});
            const storyKeys = Object.keys(node?.comet_sections?.content?.story || {});
            console.log(`[Profile Scraper] Debug ${postId}: nodeKeys=${nodeKeys.join(',')}`);
            console.log(`[Profile Scraper] Debug ${postId}: cometKeys=${cometKeys.join(',')}`);
            console.log(`[Profile Scraper] Debug ${postId}: contentKeys=${contentKeys.join(',')}`);
            console.log(`[Profile Scraper] Debug ${postId}: storyKeys=${storyKeys.join(',')}`);

            // Tìm timestamp trong nhiều paths
            const debugTime = {
                // Path 1: trực tiếp trong story
                story_created_time: node?.comet_sections?.content?.story?.created_time,
                story_creation_time: node?.comet_sections?.content?.story?.creation_time,
                // Path 2: trong feedback
                feedback_creation_time: node?.feedback?.story?.creation_time,
                feedback_created_time: node?.feedback?.story?.created_time,
                // Path 3: trong attachment target
                attachment_post_time: node?.attachments?.[0]?.styles?.attachment?.target?.post_time,
                // Path 4: trong actors subtitle
                actors_subtitle: node?.comet_sections?.content?.story?.actors?.[0]?.subtitle?.text,
                // Path 5: trong context_layout
                context_layout_keys: Object.keys(node?.comet_sections?.content?.story?.comet_sections?.context_layout?.story?.comet_sections || {}),
                // Path 6: trong metadata
                metadata_keys: Object.keys(node?.comet_sections?.content?.story?.comet_sections?.metadata?.[0]?.story?.comet_sections || {}),
                // Path 7: raw timestamp fields
                raw_timestamp: node?.timestamp,
                raw_created: node?.created_time,
                raw_comet_sections_keys: cometKeys,
            };
            console.log(`[Profile Scraper] Debug ${postId} time:`, JSON.stringify(debugTime));

            try {
                // Path 1: Unix timestamp từ created_time
                const createdTime = node?.comet_sections?.content?.story?.created_time;
                if (createdTime) {
                    publishedAt = new Date(createdTime * 1000);
                    publishedAtText = publishedAt.toISOString();
                }

                // Path 2: feedback.story.creation_time
                if (!publishedAt) {
                    const creationTime = node?.feedback?.story?.creation_time;
                    if (creationTime) {
                        publishedAt = new Date(creationTime * 1000);
                        publishedAtText = publishedAt.toISOString();
                    }
                }

                // Path 3: target.post_time
                if (!publishedAt) {
                    const postTime = node?.attachments?.[0]?.styles?.attachment?.target?.post_time;
                    if (postTime) {
                        publishedAt = new Date(postTime * 1000);
                        publishedAtText = publishedAt.toISOString();
                    }
                }

                // Path 4: Text thời gian từ UI (encoded spans)
                if (!publishedAt) {
                    const timeText = extractTimestampText(node);
                    if (timeText) {
                        publishedAtText = timeText;
                        // Parse "3 thg 6, 2025 14:30" → Date
                        const parsed = parseVietnameseDate(timeText);
                        if (parsed) publishedAt = parsed;
                    }
                }
            } catch {}

            // Extract images
            const { images: rawUrls, lastMediaId } = extractMediaUrls(node, postId);
            let allImageUrls = [...rawUrls];

            // Fetch remaining if 5 images (may have more)
            if (rawUrls.length === 5 && lastMediaId) {
                const extra = await fetchRemainingImageUrls(lastMediaId, postId, cookies, fbDtsg, proxy);
                allImageUrls.push(...extra);
            }

            // Download images
            const postSaveDir = path.join(saveDir, String(postId));
            const savedImages = [];
            for (let i = 0; i < allImageUrls.length; i++) {
                const saved = await downloadImage(allImageUrls[i], postSaveDir, `${postId}_${i + 1}`);
                if (saved) savedImages.push(saved);
            }

            allPosts.push({ postId, text, permalink, commentCount, authorName, images: savedImages, publishedAt, publishedAtText });
            console.log(`[Profile Scraper] ✓ ${postId}: "${text.substring(0, 50)}..." (${savedImages.length} ảnh) time="${publishedAtText || 'N/A'}"`);
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

module.exports = { scrapeProfilePosts };
