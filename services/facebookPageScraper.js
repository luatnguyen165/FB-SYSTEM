// services/facebookPageScraper.js
// Facebook Profile/Page Post Scraper via GraphQL API (ported from Python index.js)
// DOC_ID: 25430544756617998 - ProfileCometTimelineFeedRefetchQuery

const fs = require('fs');
const path = require('path');
const https = require('https');

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';
const DOC_ID = '25430544756617998';        // ProfileCometTimelineFeedRefetchQuery
const DOC_ID_PHOTO = '26168653472729001';  // CometPhotoRootContentQuery

let PAGE_NAME = null;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildCookieString(cookies) {
    if (!cookies || typeof cookies !== 'object') return '';
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function httpPost(url, headers, body, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
            headers, timeout
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                // DEBUG: Log response details
                console.log(`  [httpPost] status=${res.statusCode} length=${data.length} ct=${res.headers['content-type'] || 'N/A'}`);
                if (data.length === 0) {
                    console.log(`  [httpPost] EMPTY RESPONSE BODY! status=${res.statusCode} headers=${JSON.stringify(res.headers).substring(0, 300)}`);
                } else if (data.length < 500) {
                    console.log(`  [httpPost] body: ${data.substring(0, 300)}`);
                } else {
                    console.log(`  [httpPost] body preview: ${data.substring(0, 200)}...`);
                }
                resolve({ status: res.statusCode, text: data, headers: res.headers });
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ============================================================
// PARSE FB RESPONSE
// ============================================================

function extractDataBlocks(rawText) {
    const blocks = [];
    if (!rawText || typeof rawText !== 'string') return blocks;
    let i = 0;
    const n = rawText.length;
    while (true) {
        const idx = rawText.indexOf('"data"', i);
        if (idx === -1) break;
        const bs = rawText.indexOf('{', idx);
        if (bs === -1) break;
        let depth = 0, j;
        for (j = bs; j < n; j++) {
            if (rawText[j] === '{') depth++;
            else if (rawText[j] === '}') { depth--; if (depth === 0) { try { blocks.push(JSON.parse(rawText.slice(bs, j+1))); } catch(e){ console.log(`  [extractDataBlocks] JSON parse error at index ${i}: ${e.message}`); } i = j+1; break; } }
        }
        if (j >= n) break;
    }
    return blocks;
}

function cleanDataBlocks(blocks) {
    if (!Array.isArray(blocks)) return [];
    return blocks.filter(b => { 
        if (!b || typeof b !== 'object') return false; 
        try {
            if (b.errors) delete b.errors;
            if (b.extensions) delete b.extensions;
        } catch (e) { /* safe delete */ }
        return true; 
    });
}

/**
 * P0 FIX: Parse Facebook GraphQL response với fallback mechanisms
 * - Chính: Dùng extractDataBlocks (regex-based JSON extraction)
 * - Fallback 1: Thử parse toàn bộ response như JSON
 * - Fallback 2: Tìm data trong array response
 */
function parseFbResponse(text) {
    const result = [];
    try {
        if (!text || typeof text !== 'string') {
            console.log(`  [parseFbResponse] text is empty or not string: ${typeof text}`);
            return result;
        }

        const cleaned = text.replace(/^for\s*\(;;;\s*\)\s*;?\s*/gm, '').trim();
        console.log(`  [parseFbResponse] rawText length=${text.length} cleaned length=${cleaned.length}`);

        // Chính: Extract data blocks
        let blocks = cleanDataBlocks(extractDataBlocks(cleaned));
        
        // Fallback 1: Nếu không tìm thấy data blocks, thử parse toàn bộ như JSON
        if (blocks.length === 0 && cleaned.length > 0) {
            try {
                console.log('  [parseFbResponse] Trying fallback 1: full JSON parse');
                const parsed = JSON.parse(cleaned);
                if (parsed && typeof parsed === 'object') {
                    // Có thể là array response
                    if (Array.isArray(parsed)) {
                        blocks = [].concat(...parsed.map(item => {
                            if (item?.data) return [item.data];
                            return [item];
                        }));
                    } else if (parsed.data) {
                        blocks = [parsed.data];
                    } else {
                        blocks = [parsed];
                    }
                }
            } catch (e1) {
                console.log(`  [parseFbResponse] Fallback 1 failed: ${e1.message}`);
            }
        }

        // Fallback 2: Tìm tất cả JSON objects trong response
        if (blocks.length === 0 && cleaned.length > 0) {
            try {
                console.log('  [parseFbResponse] Trying fallback 2: extract all JSON objects');
                const jsonRegex = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g;
                let match;
                while ((match = jsonRegex.exec(cleaned)) !== null) {
                    try {
                        const parsed = JSON.parse(match[0]);
                        if (parsed && typeof parsed === 'object' && parsed.data) {
                            blocks.push(parsed.data);
                        }
                    } catch (e2) { /* skip invalid JSON */ }
                }
            } catch (e2) {
                console.log(`  [parseFbResponse] Fallback 2 failed: ${e2.message}`);
            }
        }

        console.log(`  [parseFbResponse] extracted ${blocks.length} data blocks`);

        if (blocks.length === 0 && cleaned.length > 0) {
            console.log(`  [parseFbResponse] ⚠️ No blocks found! first 300 chars: ${cleaned.substring(0, 300)}`);
        }

        // Dedup blocks by JSON.stringify
        const seen = new Set();
        for (const block of blocks) {
            if (!block || typeof block !== 'object') continue;
            const key = JSON.stringify(block);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(block);
            }
        }

        console.log(`  [parseFbResponse] returning ${result.length} unique blocks`);
        return result;
    } catch (err) {
        console.error(`  [parseFbResponse] CRITICAL error: ${err.message}`);
        return result;
    }
}

// ============================================================
// EXTRACT PAGE NAME
// ============================================================

function extractPageName(node) {
    try {
        const actors = node?.comet_sections?.content?.story?.actors || [];
        if (actors.length > 0 && actors[0].name) return actors[0].name;
        const owningProfile = node?.feedback?.owning_profile;
        if (owningProfile?.name) return owningProfile.name;
        if (owningProfile?.short_name) return owningProfile.short_name;
        return null;
    } catch (e) {
        return null;
    }
}

// ============================================================
// EXTRACT COMMENT COUNT
// ============================================================

function extractCommentCount(node) {
    try {
        const fb = node.feedback || {};
        const p1 = (fb.comment_rendering_instance || {}).comments || {};
        if (p1.total_count != null) return p1.total_count;

        const cs = node.comet_sections || {};
        const story = (cs.feedback || {}).story || {};
        const ufiStory = (story.story_ufi_container || {}).story || {};
        const ft = (ufiStory.feedback_context || {}).feedback_target_with_context || {};
        const p2 = (ft.comment_rendering_instance || {}).comments || {};
        if (p2.total_count != null) return p2.total_count;

        const uf = (ft.comet_ufi_summary_and_actions_renderer || {}).feedback || {};
        const p3 = (uf.comment_rendering_instance || {}).comments || {};
        if (p3.total_count != null) return p3.total_count;

        const csr = (fb.comments_count_summary_renderer || {}).feedback || {};
        const p5 = (csr.comment_rendering_instance || {}).comments || {};
        if (p5.total_count != null) return p5.total_count;

        return 0;
    } catch (e) {
        return 0;
    }
}

// ============================================================
// IS REEL OR VIDEO POST
// ============================================================

function isReelOrVideoPost(node) {
    if (!node) return false;
    if ((node.__typename || '').toLowerCase().includes('reel')) return true;
    const content = (node.comet_sections || {}).content || {};
    if ((content.__typename || '').toLowerCase().includes('reel')) return true;
    for (const att of (node.attachments || [])) {
        const stylesMedia = (((att.styles || {}).attachment || {}).media || {});
        if (stylesMedia.__typename === 'Video') return true;
        if (JSON.stringify(stylesMedia || '').toLowerCase().includes('reel')) return true;
        for (const sub of ((att.all_subattachments || {}).nodes || [])) {
            const subMedia = (sub.media || {});
            if (subMedia.__typename === 'Video') return true;
            if (JSON.stringify(subMedia || '').toLowerCase().includes('reel')) return true;
        }
    }
    return false;
}

// ============================================================
// DOWNLOAD IMAGE
// ============================================================

function downloadImage(url, postId, idx = 1, saveDir = 'page_post') {
    if (!url || !postId) return Promise.resolve(null);
    return new Promise(resolve => {
        try {
            const dir = path.join(saveDir, String(postId));
            fs.mkdirSync(dir, { recursive: true });
            let ext = '.jpg';
            if (url.toLowerCase().includes('.png')) ext = '.png';
            else if (url.toLowerCase().includes('.jpeg')) ext = '.jpeg';
            const file = idx === 1 ? `${postId}${ext}` : `${postId}_${idx}${ext}`;
            const fp = path.join(dir, file);
            https.get(url, {timeout:30000}, res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => { fs.writeFileSync(fp, Buffer.concat(chunks)); console.log(`  Downloaded: ${file}`); resolve(file); });
                res.on('error', () => resolve(null));
            }).on('error', () => resolve(null));
        } catch(e) { resolve(null); }
    });
}

// ============================================================
// EXTRACT MEDIA
// ============================================================

let imageCounters = {};

async function extractMedia(node, postId, saveDir) {
    const media = [];
    let lastMediaId = null;
    if (!imageCounters[postId]) imageCounters[postId] = 0;

    for (const att of (node.attachments || [])) {
        // ===== PATH 1: att.styles.attachment.media (standard structure) =====
        const stylesMedia = (((att.styles || {}).attachment || {}).media || {});
        
        // Single photo via photo_image key
        if (stylesMedia.photo_image && stylesMedia.photo_image.uri) {
            imageCounters[postId]++;
            lastMediaId = stylesMedia.id || null;
            const u = stylesMedia.photo_image.uri;
            const f = await downloadImage(u, postId, imageCounters[postId], saveDir);
            media.push({ type: 'photo', url: u, saved_as: f });
        }
        // Single photo via image key
        else if (stylesMedia.image && stylesMedia.image.uri) {
            imageCounters[postId]++;
            lastMediaId = stylesMedia.id || null;
            const u = stylesMedia.image.uri;
            const f = await downloadImage(u, postId, imageCounters[postId], saveDir);
            media.push({ type: 'photo', url: u, saved_as: f });
        }
        // Single video
        if (stylesMedia.__typename === 'Video') {
            media.push({ type: 'video', url: stylesMedia.playable_url || '' });
        }

        // ===== PATH 2: att.all_subattachments (album / multi-photo) =====
        for (const sub of ((att.all_subattachments || {}).nodes || [])) {
            const subMedia = (sub.media || {});
            if (subMedia.image && subMedia.image.uri) {
                imageCounters[postId]++;
                lastMediaId = subMedia.id || null;
                const u = subMedia.image.uri;
                const f = await downloadImage(u, postId, imageCounters[postId], saveDir);
                media.push({ type: 'photo', url: u, saved_as: f });
            }
            if (subMedia.__typename === 'Video') {
                media.push({ type: 'video', url: subMedia.playable_url || '' });
            }
        }

        // ===== PATH 3: att.media directly (fallback for some response shapes) =====
        if (media.length === 0 && att.media) {
            const directMedia = att.media;
            if (directMedia.photo_image && directMedia.photo_image.uri) {
                imageCounters[postId]++;
                lastMediaId = directMedia.id || null;
                const u = directMedia.photo_image.uri;
                const f = await downloadImage(u, postId, imageCounters[postId], saveDir);
                media.push({ type: 'photo', url: u, saved_as: f });
            } else if (directMedia.image && directMedia.image.uri) {
                imageCounters[postId]++;
                lastMediaId = directMedia.id || null;
                const u = directMedia.image.uri;
                const f = await downloadImage(u, postId, imageCounters[postId], saveDir);
                media.push({ type: 'photo', url: u, saved_as: f });
            }
            if (directMedia.__typename === 'Video') {
                media.push({ type: 'video', url: directMedia.playable_url || '' });
            }
        }

        // ===== PATH 4: att.url with photo extension (last resort) =====
        if (media.length === 0 && att.url && /\.(jpg|jpeg|png|webp)/i.test(att.url)) {
            imageCounters[postId]++;
            const f = await downloadImage(att.url, postId, imageCounters[postId], saveDir);
            media.push({ type: 'photo', url: att.url, saved_as: f });
        }
    }

    // ===== PATH 5: node.sponsor (boosted/sponsored posts with different structure) =====
    if (media.length === 0 && node.sponsor && node.sponsor.sponsor_entity) {
        const sponsorMedia = node.sponsor.sponsor_entity.profile_picture || {};
        if (sponsorMedia.uri) {
            // Don't count sponsor profile pic as post media, just note it
        }
    }

    console.log(`  [extractMedia] Post ${postId}: found ${media.length} media items (${media.filter(m => m.type === 'photo').length} photos, ${media.filter(m => m.type === 'video').length} videos)`);

    const photoCount = media.filter(m => m.type === 'photo').length;
    if (photoCount === 5 && lastMediaId) {
        const remaining = await fetchRemainingImages(lastMediaId, postId, imageCounters[postId], saveDir);
        media.push(...remaining);
    }

    return media;
}

// ============================================================
// FETCH REMAINING IMAGES
// ============================================================

async function fetchRemainingImages(lastMediaId, postId, currentCount, saveDir) {
    if (!lastMediaId || !postId) return [];
    console.log(`  Fetching remaining images after #${currentCount}...`);

    const headers = {
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://www.facebook.com',
        'x-fb-friendly-name': 'CometPhotoRootContentQuery'
    };

    const remaining = [];
    let currentNode = lastMediaId;
    const visited = new Set();
    let idx = currentCount + 1;

    while (currentNode && !visited.has(currentNode) && idx <= 50) {
        visited.add(currentNode);
        const variables = {
            isMediaset: true,
            renderLocation: 'comet_media_viewer',
            nodeID: currentNode,
            mediasetToken: `pcb.${postId}`,
            scale: 2,
            feedLocation: 'COMET_MEDIA_VIEWER',
            feedbackSource: 65,
            focusCommentID: null,
            privacySelectorRenderLocation: 'COMET_MEDIA_VIEWER',
            useDefaultActor: false,
            shouldShowComments: true
        };
        const payload = new URLSearchParams({
            av: '0', __user: '0', __a: '1', fb_dtsg: '', doc_id: DOC_ID_PHOTO,
            variables: JSON.stringify(variables)
        });

        try {
            const r = await httpPost(GRAPHQL_URL, headers, payload.toString());
            if (r.status !== 200) break;
            const blocks = parseFbResponse(r.text);
            if (!blocks.length) break;

            let imageUrl = null;
            for (const block of blocks) {
                if (block.currMedia) { imageUrl = block.currMedia.image?.uri; break; }
            }
            if (imageUrl) {
                const f = await downloadImage(imageUrl, postId, idx, saveDir);
                if (f) { remaining.push({ type: 'photo', url: imageUrl, saved_as: f }); idx++; }
            }

            let nextNode = null;
            for (const block of blocks) {
                if (block.nextMediaAfterNodeId?.id) { nextNode = block.nextMediaAfterNodeId.id; break; }
            }
            if (nextNode) { currentNode = nextNode; await wait(500); } else break;
        } catch (e) { break; }
    }
    if (remaining.length) console.log(`  Fetched ${remaining.length} more images`);
    return remaining;
}

// ============================================================
// EXTRACT POST DATA
// ============================================================

function extractPostTime(node) {
    try {
        // Try multiple paths for post creation time
        // Path 1: comet_sections.content.story.creation_time (seconds)
        const cs = ((node.comet_sections || {}).content || {}).story || {};
        if (cs.creation_time) return new Date(cs.creation_time * 1000);

        // Path 2: feedback.creation_time (seconds)
        const fb = node.feedback || {};
        if (fb.creation_time) return new Date(fb.creation_time * 1000);

        // Path 3: node.creation_time directly
        if (node.creation_time) return new Date(node.creation_time * 1000);

        // Path 4: comet_sections.context_layout.story.comet_sections.title.story.creation_time
        try {
            const t = node.comet_sections?.context_layout?.story?.comet_sections?.title?.story?.creation_time;
            if (t) return new Date(t * 1000);
        } catch(e) {}

        // Path 5: time field in unified_stories_compact
        if (node.time) return new Date(node.time * 1000);

        return null;
    } catch (e) {
        return null;
    }
}

async function extractPostData(node, pageName, saveDir) {
    if (!node || node.__typename !== 'Story') return null;
    const cs = ((node.comet_sections || {}).content || {}).story || {};
    const message = (cs.message || {}).text || '';
    const postId = node.post_id;
    if (!postId) return null;
    if (!pageName) pageName = extractPageName(node);

    let permalink = node.permalink_url || '';
    try { permalink = node.attachments[0]?.styles?.attachment?.url || permalink; } catch(e) {}

    const nf = pageName ? pageName.replace(/[^a-zA-Z0-9\s\-_]/g, '').trim() || 'Unknown' : 'Unknown';
    const mediaSaveDir = saveDir ? path.join(saveDir, nf) : path.join('page_post', nf);
    const media = await extractMedia(node, postId, mediaSaveDir);
    const postedAt = extractPostTime(node);

    return {
        id: node.id,
        post_id: postId,
        feedback_id: node.feedback?.id || '',
        text: message,
        message: message,
        comment_count: extractCommentCount(node),
        page_name: pageName,
        permalink: permalink,
        postUrl: permalink || `https://www.facebook.com/${postId}`,
        media: media,
        photos: media.filter(m => m.type === 'photo'),
        videos: media.filter(m => m.type === 'video'),
        posted_at: postedAt ? postedAt.toISOString() : null,
        postedAt: postedAt
    };
}

// ============================================================
// FETCH POSTS FROM PAGE/PROFILE
// ============================================================

async function fetchPagePosts({ pageId, cookies = {}, fbDtsg = '', limit = 10, minComments = 0, maxRetries = 5 }) {
    const FETCH_START = Date.now();
    const HARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút tổng
    const MAX_PAGES = 20; // Giới hạn số page GraphQL
    // ====== DEBUG: BANNER + INPUT VERIFICATION ======
    console.log(`\n[Page Scraper] ===============================================`);
    console.log(`[Page Scraper] 🚀 fetchPagePosts() called`);
    console.log(`[Page Scraper] -----------------------------------------------`);
    console.log(`[Page Scraper] 📌 INPUT PARAMETERS:`);
    console.log(`[Page Scraper]    pageId     = ${JSON.stringify(pageId)} (type: ${typeof pageId}) ← ID của page/profile CẦN QUÉT`);
    console.log(`[Page Scraper]    limit      = ${limit}`);
    console.log(`[Page Scraper]    minComments= ${minComments}`);
    console.log(`[Page Scraper]    maxRetries = ${maxRetries}`);
    console.log(`[Page Scraper]    hardTimeout= ${HARD_TIMEOUT_MS}ms, maxPages=${MAX_PAGES}`);
    console.log(`[Page Scraper] -----------------------------------------------`);
    console.log(`[Page Scraper] 🍪 ACCOUNT COOKIES (cookies của tk đang login):`);
    console.log(`[Page Scraper]    c_user     = ${cookies.c_user || 'MISSING'} ← ID tài khoản FB đang scrape`);
    console.log(`[Page Scraper]    xs         = ${cookies.xs ? 'YES (' + cookies.xs.substring(0, 10) + '...)' : 'MISSING'}`);
    console.log(`[Page Scraper]    datr       = ${cookies.datr ? 'YES' : 'MISSING'}`);
    console.log(`[Page Scraper]    fr         = ${cookies.fr ? 'YES' : 'MISSING'}`);
    console.log(`[Page Scraper]    Total keys = ${Object.keys(cookies).length} [${Object.keys(cookies).join(', ')}]`);
    console.log(`[Page Scraper] 🔑 fbDtsg     = ${fbDtsg ? fbDtsg.substring(0, 20) + '... (len=' + fbDtsg.length + ')' : 'EMPTY'}`);
    console.log(`[Page Scraper] 🍪 Cookie str length = ${buildCookieString(cookies).length}`);
    console.log(`[Page Scraper] ===============================================\n`);

    // ====== VALIDATION ======
    if (!pageId) {
        console.error(`[Page Scraper] ❌ FATAL: pageId is required! Got: ${pageId}`);
        return [];
    }
    if (!cookies.c_user) {
        console.warn(`[Page Scraper] ⚠️  WARNING: c_user cookie missing — request will likely fail auth check`);
    }
    if (!fbDtsg) {
        console.warn(`[Page Scraper] ⚠️  WARNING: fbDtsg token missing — request will likely fail CSRF check`);
    }

    const allPosts = [];
    let cursor = null, pageNum = 1;
    PAGE_NAME = null;
    imageCounters = {};

    const headers = {
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://www.facebook.com',
        'referer': `https://www.facebook.com/profile.php?id=${pageId}`
    };
    const cookieStr = buildCookieString(cookies);
    console.log(`[Page Scraper] 🔗 Referer URL = ${headers.referer}`);

    while (allPosts.length < limit) {
        // ⏱️ HARD TIMEOUT + MAX PAGES GUARD
        const elapsed = Date.now() - FETCH_START;
        if (elapsed > HARD_TIMEOUT_MS) {
            console.log(`[Page Scraper] ⏱️ HARD TIMEOUT reached (${(elapsed/1000).toFixed(1)}s > ${HARD_TIMEOUT_MS/1000}s), stopping.`);
            break;
        }
        if (pageNum > MAX_PAGES) {
            console.log(`[Page Scraper] 🛑 MAX_PAGES reached (${MAX_PAGES}), stopping.`);
            break;
        }
        console.log(`[Page Scraper] ⏱️ elapsed=${(elapsed/1000).toFixed(1)}s / ${(HARD_TIMEOUT_MS/1000).toFixed(0)}s`);
        console.log(`\n--- 📄 Fetching page ${pageNum} (target pageId=${pageId}) ---`);

        const variables = {
            count: 3,
            cursor: cursor,
            id: pageId,
            feedLocation: 'TIMELINE',
            renderLocation: 'timeline',
            scale: 2,
            useDefaultActor: false
        };
        const payload = new URLSearchParams({
            av: cookies.c_user || '0',
            __user: cookies.c_user || '0',
            __a: '1',
            fb_dtsg: fbDtsg || '',
            doc_id: DOC_ID,
            variables: JSON.stringify(variables)
        });

        // DEBUG: Show what is being sent to Facebook
        console.log(`[Page Scraper] 📨 GraphQL variables.id = ${pageId} (target pageId)`);
        console.log(`[Page Scraper] 📨 GraphQL doc_id       = ${DOC_ID}`);
        console.log(`[Page Scraper] 📨 av (c_user)          = ${cookies.c_user || '0'} (account, NOT pageId)`);
        console.log(`[Page Scraper] 📨 __user (c_user)      = ${cookies.c_user || '0'} (account, NOT pageId)`);
        console.log(`[Page Scraper] 📨 payload size         = ${payload.toString().length} bytes`);
        console.log(`[Page Scraper] 📨 payload preview      = ${payload.toString().substring(0, 300)}...`);

        let r;
        let cleanedData = [];
        let emptyRetryCount = 0;
        const maxEmptyRetries = 3;

        while (emptyRetryCount < maxEmptyRetries) {
            try {
                r = await httpPost(GRAPHQL_URL, { ...headers, cookie: cookieStr }, payload.toString());
            } catch (e) {
                console.log(`  Request failed: ${e.message}`);
                break;
            }
            if (r.status !== 200) {
                console.log(`  Non-200 status: ${r.status}`);
                break;
            }
            console.log(`  Status code: ${r.status}`);

            cleanedData = parseFbResponse(r.text);
            if (cleanedData && cleanedData.length > 0) {
                break;
            }
            emptyRetryCount++;
            if (emptyRetryCount < maxEmptyRetries) {
                console.log(`  Empty response, retrying ${emptyRetryCount}/${maxEmptyRetries}...`);
                await wait(2000);
            }
        }

        if (!cleanedData || cleanedData.length === 0) {
            console.log(`  No data after retries, stopping.`);
            break;
        }

        console.log(`  Got ${cleanedData.length} data blocks`);

        // Extract story nodes from cleaned data
        const storyNodes = [];
        let timelineBlock = null;
        for (const block of cleanedData) {
            if (!block || typeof block !== 'object') continue;
            const node = block.node || {};
            if (node.timeline_list_feed_units) {
                timelineBlock = block;
                for (const edge of (node.timeline_list_feed_units.edges || [])) {
                    const edgeNode = edge.node;
                    if (edgeNode && edgeNode.__typename === 'Story') {
                        storyNodes.push(edgeNode);
                    }
                }
            } else if (node.__typename === 'Story') {
                storyNodes.push(node);
            } else if (node.__typename === 'Group') {
                for (const edge of (node.group_feed?.edges || [])) {
                    if ((edge.node || {}).__typename === 'Story') {
                        storyNodes.push(edge.node);
                    }
                }
            }
        }

        console.log(`  Found ${storyNodes.length} story nodes`);
        let pageName = PAGE_NAME;
        for (const node of storyNodes) {
            if (allPosts.length >= limit) break;
            if (isReelOrVideoPost(node)) {
                console.log(`  ⏭️ Skip reel/video post`);
                continue;
            }
            const commentCount = extractCommentCount(node);
            if (commentCount < minComments) {
                console.log(`  ⏭️ Skip post with ${commentCount} comments (< ${minComments})`);
                continue;
            }
            const postData = await extractPostData(node, pageName, 'page_post');
            if (!postData) continue;
            if (!pageName) {
                pageName = postData.page_name;
                PAGE_NAME = pageName;
            }
            // Skip if already collected
            if (allPosts.some(p => p.post_id === postData.post_id)) {
                console.log(`  ⏭️ Skip duplicate post: ${postData.post_id}`);
                continue;
            }
            allPosts.push(postData);
            console.log(`  ✅ Post: ${postData.post_id} — "${(postData.message || '').substring(0, 60)}..."`);
        }

        // Get next cursor for pagination
        let nextCursor = null;
        if (timelineBlock) {
            const pageInfo = (timelineBlock.node?.timeline_list_feed_units || {}).page_info;
            if (pageInfo && pageInfo.has_next_page) {
                nextCursor = pageInfo.end_cursor;
            }
        }
        if (!nextCursor) {
            for (const block of cleanedData) {
                if (block && block.page_info && block.page_info.has_next_page) {
                    nextCursor = block.page_info.end_cursor;
                    break;
                }
            }
        }
        if (!nextCursor) {
            console.log(`  No more pages, stopping.`);
            break;
        }
        cursor = nextCursor;
        pageNum++;
        await wait(1000);
    }

    console.log(`\n[Page Scraper] ✅ Done! Fetched ${allPosts.length} posts`);
    return allPosts;
}

module.exports = {
    fetchPagePosts,
    parseFbResponse,
    extractMedia,
    extractPostData,
    downloadImage
};
