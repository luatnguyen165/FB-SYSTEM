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
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        fs.writeFileSync(filepath, r.data);
        return `/uploads/tracking/${path.basename(saveDir)}/${filename}${ext}`;
    } catch { return null; }
}

// ==================== RESOLVE USERNAME → ID ====================

async function resolveProfileId(profileIdOrUsername, cookies, proxy) {
    // Nếu đã là numeric ID thì trả về luôn
    if (/^\d+$/.test(profileIdOrUsername)) return profileIdOrUsername;

    // Visit profile page để lấy numeric ID
    try {
        console.log(`[Profile Scraper] Resolving username "${profileIdOrUsername}" → numeric ID...`);
        const url = `https://www.facebook.com/${profileIdOrUsername}`;
        const r = await axios.get(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; '),
            },
            timeout: 15000,
            httpsAgent: getHttpsAgent(proxy),
            maxRedirects: 5,
        });

        // Tìm numeric ID từ HTML: "userID":"123456" hoặc profile.php?id=123456
        const html = r.data || '';
        const patterns = [
            /"userID":"(\d+)"/,
            /"user_id":"(\d+)"/,
            /profile\.php\?id=(\d+)/,
            /"entity_id":"(\d+)"/,
            /"actorID":"(\d+)"/,
        ];
        for (const p of patterns) {
            const m = html.match(p);
            if (m) {
                console.log(`[Profile Scraper] Resolved: ${profileIdOrUsername} → ${m[1]}`);
                return m[1];
            }
        }
        console.log(`[Profile Scraper] Không tìm thấy numeric ID trong HTML`);
    } catch (e) {
        console.log(`[Profile Scraper] Lỗi resolve username: ${e.message}`);
    }
    return profileIdOrUsername; // fallback
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
    const allPosts = [];
    let cursor = null;
    let pageNum = 0;

    console.log(`[Profile Scraper] === START === profileId="${profileId}", limit=${limit}, c_user=${cookies.c_user || 'null'}, fb_dtsg=${fbDtsg ? 'yes' : 'no'}`);

    // Resolve username → numeric ID
    let numericId;
    try {
        numericId = await resolveProfileId(profileId, cookies, proxy);
        console.log(`[Profile Scraper] Resolved: ${profileId} → ${numericId}`);
    } catch (e) {
        console.error(`[Profile Scraper] Lỗi resolve profileId: ${e.message}`);
        return [];
    }

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

        let cleanedData = [];
        for (let retry = 0; retry < 3; retry++) {
            try {
                const r = await axios.post(GRAPHQL_URL, new URLSearchParams(payload).toString(), {
                    headers: { 'user-agent': 'Mozilla/5.0', 'content-type': 'application/x-www-form-urlencoded', origin: 'https://www.facebook.com', referer: `https://www.facebook.com/profile.php?id=${numericId}` },
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

            allPosts.push({ postId, text, permalink, commentCount, authorName, images: savedImages });
            console.log(`[Profile Scraper] ✓ ${postId}: "${text.substring(0, 50)}..." (${savedImages.length} ảnh)`);
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

    console.log(`[Profile Scraper] Hoàn thành: ${allPosts.length} bài viết`);
    return allPosts;
}

module.exports = { scrapeProfilePosts };
