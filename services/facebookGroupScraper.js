// services/facebookGroupScraper.js - Scrape bài viết từ Facebook Group
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { imageDownloadQueue, DownloadQueue } = require('./facebookProfileScraper');

// Queue riêng cho video group: 1 concurrent, delay 1s, 2 retries
const videoDownloadQueue = new DownloadQueue(1, 1000, 2);

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';
const DOC_ID = '25716860671307636'; // GroupsCometFeedRegularStoriesPaginationQuery

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==================== PARSE FB RESPONSE ====================
function extractDataBlocks(rawText) {
    if (typeof rawText !== 'string') return [];
    const blocks = [];
    let i = 0;
    while (true) {
        const idx = rawText.indexOf('"data"', i);
        if (idx === -1) break;
        const braceStart = rawText.indexOf('{', idx);
        if (braceStart === -1) break;
        let depth = 0;
        for (let j = braceStart; j < rawText.length; j++) {
            if (rawText[j] === '{') depth++;
            else if (rawText[j] === '}') {
                depth--;
                if (depth === 0) {
                    try {
                        blocks.push(JSON.parse(rawText.substring(braceStart, j + 1)));
                    } catch {}
                    i = j + 1;
                    break;
                }
            }
        }
    }
    return blocks;
}

function parseFbResponse(text) {
    // Handle both string and already-parsed object
    if (typeof text !== 'string') {
        if (Array.isArray(text)) return text.filter(b => b && typeof b === 'object');
        if (typeof text === 'object') {
            // Might be { data: [...] } wrapper
            const inner = text?.data || text;
            if (Array.isArray(inner)) return inner.filter(b => b && typeof b === 'object');
            return [inner].filter(b => b && typeof b === 'object');
        }
        text = String(text);
    }
    text = text.replace('for (;;);', '').trim();
    const blocks = extractDataBlocks(text);
    console.log(`[Parse] Found ${blocks.length} data blocks`);
    return blocks.filter(b => b && typeof b === 'object');
}

// ==================== EXTRACT HELPERS ====================
function extractGroupName(node) {
    try {
        const contextLayout = node?.comet_sections?.context_layout?.story?.comet_sections?.title?.story?.to;
        if (contextLayout?.__typename === 'Group') return contextLayout.name;
        const targetGroup = node?.comet_sections?.content?.story?.target_group;
        if (targetGroup?.name) return targetGroup.name;
        const assocGroup = node?.feedback?.associated_group;
        if (assocGroup?.name) return assocGroup.name;
        return null;
    } catch { return null; }
}

function extractCommentCount(node) {
    try {
        const paths = [
            node?.feedback?.comment_rendering_instance?.comments?.total_count,
            node?.comet_sections?.feedback?.story?.story_ufi_container?.story?.feedback_context?.feedback_target_with_context?.comment_rendering_instance?.comments?.total_count,
            node?.comet_sections?.feedback?.story?.feedback_context?.feedback_target_with_context?.comment_rendering_instance?.comments?.total_count,
        ];
        for (const c of paths) {
            if (c != null) return c;
        }
        return 0;
    } catch { return 0; }
}

function isReelPost(node) {
    if (!node) return false;
    if ((node.__typename || '').toLowerCase().includes('reel')) return true;
    const content = node?.comet_sections?.content;
    if ((content?.__typename || '').toLowerCase().includes('reel')) return true;
    for (const att of (node.attachments || [])) {
        const styleList = att?.styles?.attachment?.style_infos?.[0]?.style_list || [];
        if (styleList.includes('fb_shorts_creation')) return true;
        if (JSON.stringify(att || {}).toLowerCase().includes('fb_shorts')) return true;
    }
    return false;
}

function extractMedia(node, rawText) {
    const images = [];
    const videos = [];
    let lastMediaId = null;

    const addImage = (mediaNode) => {
        const url = mediaNode?.photo_image?.uri || mediaNode?.image?.uri;
        if (url) {
            images.push(url);
            lastMediaId = mediaNode.id;
        }
    };

    const addVideo = (m, postPermalink) => {
        // Ưu tiên permalink_url cho download
        if (m.permalink_url) {
            videos.push({ url: m.permalink_url, reelUrl: m.permalink_url });
        } else {
            const url = m.playable_url || m.playable_url_quality_hd || m.browser_native_hd_url || '';
            if (url) {
                videos.push({ url, reelUrl: url });
            } else if (m.id) {
                // Không có direct URL → dùng video ID tạo URL
                const videoByIdUrl = `https://www.facebook.com/watch/?v=${m.id}`;
                videos.push({ url: videoByIdUrl, reelUrl: videoByIdUrl });
            }
        }
    };

    // Lấy post permalink từ node trước khi parse attachments
    const postPermalink = node?.comet_sections?.content?.story?.url || '';
    const groupId = node?.feedback?.associated_group?.id || '';
    const fallbackPermalink = postPermalink || (groupId && node?.post_id ? `https://www.facebook.com/groups/${groupId}/posts/${node.post_id}/` : '');

    // Parse từ node attachments (nếu có)
    for (const att of (node.attachments || [])) {
        const attachment = att?.styles?.attachment || {};

        // Check all_subattachments TRƯỚC (album có nhiều videos)
        for (const sub of (attachment.all_subattachments?.nodes || [])) {
            if (sub.media?.__typename === 'Photo') addImage(sub.media);
            if (sub.media?.__typename === 'Video') addVideo(sub.media, fallbackPermalink);
        }

        // Check attachment.media (single video/photo)
        if (attachment.media?.__typename === 'Photo') addImage(attachment.media);
        if (attachment.media?.__typename === 'Video') addVideo(attachment.media, fallbackPermalink);
    }

    // Nếu attachments rỗng, dùng post permalink (script sẽ tự tìm video trong post)
    if (videos.length === 0 && node?.post_id) {
        const postId = node.post_id;
        const postPermalink = node?.comet_sections?.content?.story?.url || '';

        if (postPermalink && postPermalink.includes('/posts/')) {
            // Kiểm tra có video trong post không
            let hasVideo = false;
            if (rawText) {
                const postIdx = rawText.indexOf(`"post_id":"${postId}"`);
                if (postIdx > -1) {
                    const subAtchArea = rawText.substring(Math.max(0, postIdx - 2000), Math.min(rawText.length, postIdx + 15000));
                    hasVideo = subAtchArea.includes('"__typename":"Video"');
                }
            }

            if (hasVideo && postPermalink) {
                // Chỉ push 1 video (script chỉ extract được 1 video URL từ 1 page)
                videos.push({ url: postPermalink, reelUrl: postPermalink });
                console.log(`[ExtractMedia] Post ${postId}: 1 video via post permalink`);
            }
        }
    }

    return { images, videos, lastMediaId };
}

function extractTimestamp(node, rawText, postIndex) {
    try {
        // Path 1: post_context.publish_time (parsed node)
        const publishTime = node?.feedback?.post_context?.publish_time;
        if (publishTime) {
            const date = new Date(publishTime * 1000);
            return { publishedAt: date, publishedAtText: date.toLocaleString('vi-VN') };
        }

        // Path 2: creation_time (parsed node)
        const creationTime = node?.feedback?.story?.creation_time;
        if (creationTime) {
            const date = new Date(creationTime * 1000);
            return { publishedAt: date, publishedAtText: date.toLocaleString('vi-VN') };
        }

        // Path 3: Extract from raw text by finding nearest creation_time to this post_id
        if (rawText && node?.post_id) {
            const postId = node.post_id;
            const postIdIdx = rawText.indexOf(`"post_id":"${postId}"`);
            if (postIdIdx > -1) {
                // Search in nearby text (within 5000 chars before and after)
                const searchStart = Math.max(0, postIdIdx - 5000);
                const searchEnd = Math.min(rawText.length, postIdIdx + 5000);
                const searchArea = rawText.substring(searchStart, searchEnd);

                // Find creation_time
                const ctMatch = searchArea.match(/"creation_time":(\d+)/);
                if (ctMatch) {
                    const date = new Date(parseInt(ctMatch[1]) * 1000);
                    return { publishedAt: date, publishedAtText: date.toLocaleString('vi-VN') };
                }

                // Find publish_time
                const ptMatch = searchArea.match(/"publish_time":(\d+)/);
                if (ptMatch) {
                    const date = new Date(parseInt(ptMatch[1]) * 1000);
                    return { publishedAt: date, publishedAtText: date.toLocaleString('vi-VN') };
                }
            }
        }

        return { publishedAtText: '', publishedAt: null };
    } catch {
        return { publishedAtText: '', publishedAt: null };
    }
}

function extractPostData(node, groupName, rawText) {
    if (!node || node.__typename !== 'Story') return null;

    const postId = node.post_id;
    if (!postId) return null;

    const contentStory = node?.comet_sections?.content?.story;
    const text = contentStory?.message?.text || '';
    // Fallback: construct permalink từ post_id nếu không có url
    let permalink = contentStory?.url || node?.comet_sections?.timestamp?.story?.url || '';
    if (!permalink && node?.post_id) {
        // Tìm group ID từ raw text hoặc node
        const groupId = node?.feedback?.associated_group?.id || '';
        if (groupId) {
            permalink = `https://www.facebook.com/groups/${groupId}/posts/${node.post_id}/`;
        }
    }
    const commentCount = extractCommentCount(node);
    const name = groupName || extractGroupName(node) || 'Unknown';
    const { images, videos } = extractMedia(node, rawText);
    const { publishedAt, publishedAtText } = extractTimestamp(node, rawText);

    // Extract author name
    let authorName = '';
    // Path 1: feedback.owning_profile.name
    authorName = node?.feedback?.owning_profile?.name || '';
    // Path 2: comet_sections.content.story.comet_sections.title.story.to.name
    if (!authorName) authorName = node?.comet_sections?.content?.story?.comet_sections?.title?.story?.to?.name || '';
    // Path 3: Find in JSON
    if (!authorName) {
        const nameMatch = JSON.stringify(node).match(/"name":"([^"]+)"/);
        if (nameMatch) authorName = nameMatch[1];
    }

    return { postId, text, permalink, commentCount, groupName: name, authorName, images, videos, publishedAt, publishedAtText };
}

// ==================== FETCH CDN URL FROM FACEBOOK GRAPH API ====================
async function fetchCdnUrlFromGraphApi(videoId, cookies) {
    try {
        const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');

        // Fetch fb_dtsg từ video page
        const videoPageUrl = `https://www.facebook.com/watch/?v=${videoId}`;
        const homeR = await axios.get(videoPageUrl, {
            headers: { 'user-agent': 'Mozilla/5.0', 'cookie': cookieHeader },
            timeout: 15000, responseType: 'text',
        });
        const html = String(homeR.data);
        const dtsgMatch = html.match(/"token":"([A-Za-z0-9:_-]{20,})"/);
        const fbDtsg = dtsgMatch ? dtsgMatch[1] : '';

        // Query video info via GraphQL
        const payload = {
            av: cookies.c_user || '0',
            __user: cookies.c_user || '0',
            __a: '1',
            fb_dtsg: fbDtsg,
            doc_id: '25430544756617998',
            variables: JSON.stringify({ videoID: videoId }),
        };

        const r = await axios.post('https://www.facebook.com/api/graphql/', new URLSearchParams(payload).toString(), {
            headers: {
                'user-agent': 'Mozilla/5.0',
                'content-type': 'application/x-www-form-urlencoded',
                'origin': 'https://www.facebook.com',
                'cookie': cookieHeader,
            },
            timeout: 15000,
            responseType: 'text',
        });

        const text = String(r.data).replace('for (;;);', '');

        // Tìm video URL trong response
        const urlMatch = text.match(/"browser_native_hd_url":"(https?:\/\/[^"]+)"/)
            || text.match(/"browser_native_sd_url":"(https?:\/\/[^"]+)"/)
            || text.match(/"playable_url_quality_hd":"(https?:\/\/[^"]+)"/)
            || text.match(/"playable_url":"(https?:\/\/[^"]+)"/);

        if (urlMatch) {
            return urlMatch[1].replace(/\\\//g, '/');
        }

        // Tìm CDN URL
        const cdnMatch = text.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/);
        if (cdnMatch) {
            return cdnMatch[0];
        }
    } catch (e) {
        console.log(`[Graph API] Failed: ${e.message.substring(0, 80)}`);
    }
    return null;
}

// ==================== DOWNLOAD VIDEO (facebook-video-download-api.py) ====================
async function downloadGroupVideo(videoUrl, saveDir, filename = '', cookies = {}) {
    if (!videoUrl) return null;
    if (!filename) {
        const id = videoUrl.match(/videos?\/(\d+)/)?.[1] || Date.now();
        filename = `video_${id}.mp4`;
    }
    const filepath = path.join(saveDir, filename);
    fs.mkdirSync(saveDir, { recursive: true });

    const pythonScript = path.join(__dirname, '..', 'utils', 'facebook-video-download-api.py');

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (fs.existsSync(filepath)) fs.unlinkSync(filepath);

            console.log(`[Video] Attempt ${attempt}: ${videoUrl.substring(0, 80)}...`);
            const result = execSync(`python "${pythonScript}" "${videoUrl}"`, {
                timeout: 60000,
                stdio: 'pipe'
            }).toString();

            // Parse HD hoặc SD URL từ output
            let videoDownloadUrl = '';
            const hdMatch = result.match(/HD Link:\s*(https?:\/\/\S+)/);
            const sdMatch = result.match(/SD Link:\s*(https?:\/\/\S+)/);
            if (hdMatch) videoDownloadUrl = hdMatch[1].trim();
            else if (sdMatch) videoDownloadUrl = sdMatch[1].trim();

            if (!videoDownloadUrl) {
                console.log(`[Video] No video URL found`);
                continue;
            }

            // Download bằng axios
            console.log(`[Video] Downloading: ${videoDownloadUrl.substring(0, 80)}...`);
            const res = await axios.get(videoDownloadUrl, {
                responseType: 'arraybuffer',
                timeout: 300000,
                headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                maxRedirects: 5,
            });

            if (res.data && res.data.length > 10000) {
                fs.writeFileSync(filepath, Buffer.from(res.data));
                console.log(`[Video] ✓ ${filename} (${(res.data.length / 1024 / 1024).toFixed(1)}MB)`);
                return filepath;
            }
        } catch (e) {
            console.log(`[Video] Attempt ${attempt} failed: ${e.message?.substring(0, 100)}`);
            if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
        }
    }

    console.log(`[Video] ✗ Could not download: ${videoUrl}`);
    return null;
}

// ==================== DOWNLOAD IMAGE ====================
async function downloadImage(url, saveDir, filename) {
    try {
        fs.mkdirSync(saveDir, { recursive: true });
        const ext = url.toLowerCase().includes('.png') ? '.png' : url.toLowerCase().includes('.webp') ? '.webp' : '.jpg';
        const filepath = path.join(saveDir, `${filename}${ext}`);
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
        fs.writeFileSync(filepath, r.data);
        return `/uploads/scraper/${path.basename(saveDir)}/${filename}${ext}`;
    } catch (e) {
        console.error(`[Download] Failed: ${e.message}`);
        return null;
    }
}

// ==================== FETCH FB_DTSG ====================
async function fetchFbDtsg(cookies, groupId) {
    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    // Fetch from group page to get fb_dtsg
    const url = groupId ? `https://www.facebook.com/groups/${groupId}/` : 'https://www.facebook.com/';
    try {
        const r = await axios.get(url, {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'cookie': cookieHeader,
            },
            timeout: 15000,
            maxRedirects: 5,
            responseType: 'text',
        });
        const html = String(r.data);
        const match = html.match(/"token":"([A-Za-z0-9:_-]{20,})"/)
            || html.match(/"DTSGInitialData".*?"token":"([^"]+)"/)
            || html.match(/\["DTSGInitData",\[\],\{"token":"([^"]+)"/);
        if (match) {
            console.log(`[Group Scraper] Found fb_dtsg: ${match[1].substring(0, 10)}...`);
            return match[1];
        }
        console.log(`[Group Scraper] fb_dtsg not found in HTML (length: ${html.length})`);
    } catch (e) {
        console.log(`[Group Scraper] fetchFbDtsg error: ${e.message}`);
    }
    return '';
}

// ==================== SCRAPE GROUP POSTS ====================
async function scrapeGroupPosts({ groupId, cookies, fbDtsg, limit = 10, proxy = null, saveDir = 'uploads/scraper' }) {
    console.log(`[Group Scraper] === START === groupId="${groupId}", limit=${limit}`);

    // Fetch fb_dtsg if not provided
    if (!fbDtsg) {
        console.log(`[Group Scraper] fb_dtsg is empty, fetching from Facebook...`);
        fbDtsg = await fetchFbDtsg(cookies, groupId);
        if (!fbDtsg) {
            console.log(`[Group Scraper] WARNING: Could not fetch fb_dtsg, requests may fail`);
        }
    }

    const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    let allPosts = [];
    let cursor = null;
    let pageNum = 1;
    let groupName = null;

    while (allPosts.length < limit) {
        console.log(`[Group Scraper] Page ${pageNum}...`);

        const variables = {
            count: 20,
            cursor,
            feedLocation: 'GROUP',
            feedType: 'DISCUSSION',
            feedbackSource: 0,
            filterTopicId: null,
            focusCommentID: null,
            privacySelectorRenderLocation: 'COMET_STREAM',
            renderLocation: 'group',
            scale: 2,
            stream_initial_count: 1,
            useDefaultActor: false,
            id: groupId,
        };

        const payload = {
            av: cookies.c_user || '0',
            __user: cookies.c_user || '0',
            __a: '1',
            fb_dtsg: fbDtsg || '',
            doc_id: DOC_ID,
            variables: JSON.stringify(variables),
        };

        let data = [];
        let rawText = '';
        for (let retry = 0; retry < 3; retry++) {
            try {
                const r = await axios.post(GRAPHQL_URL, new URLSearchParams(payload).toString(), {
                    headers: {
                        'user-agent': 'Mozilla/5.0',
                        'content-type': 'application/x-www-form-urlencoded',
                        origin: 'https://www.facebook.com',
                        cookie: cookieHeader,
                    },
                    timeout: 30000,
                    responseType: 'text', // Force raw text response
                });
                console.log(`[Group Scraper] Response status: ${r.status}, type: ${typeof r.data}, length: ${String(r.data).length}`);
                if (r.status !== 200) {
                    console.log(`[Group Scraper] Non-200 status: ${r.status}`);
                    continue;
                }
                // Debug: save first story node structure
                if (pageNum === 1 && retry === 0) {
                    const debugFile = path.join(saveDir, `group_debug_${groupId}.json`);
                    try {
                        const parsed = parseFbResponse(r.data);
                        // Find first Story node with attachments
                        for (const item of parsed) {
                            const story = item?.node?.group_feed?.edges?.[0]?.node || item?.node;
                            if (story?.__typename === 'Story' && story.attachments) {
                                fs.writeFileSync(debugFile, JSON.stringify(story.attachments, null, 2).substring(0, 10000));
                                console.log(`[Group Scraper] Debug saved to ${debugFile}`);
                                break;
                            }
                        }
                    } catch (e) { console.log(`[Group Scraper] Debug save error: ${e.message}`); }
                }
                data = parseFbResponse(r.data);
                // Save raw text for timestamp extraction
                rawText = String(r.data);
                console.log(`[Group Scraper] Parsed ${data.length} blocks`);
                if (data.length > 0) break;
                await sleep(2000);
            } catch (e) {
                console.log(`[Group Scraper] Request error: ${e.message}`);
                await sleep(2000);
            }
        }

        if (!data.length) {
            console.log(`[Group Scraper] No data after retries, stopping`);
            break;
        }

        let nextCursor = null;
        let postsFound = 0;

        for (const item of data) {
            const node = item?.node;

            // Check for page_info at item level (pagination)
            if (item.page_info?.has_next_page && item.page_info?.end_cursor) {
                nextCursor = item.page_info.end_cursor;
            }

            // Check for cursor in Group node
            if (node?.__typename === 'Group') {
                const feedCursor = node.group_feed?.page_info;
                if (feedCursor?.has_next_page) {
                    nextCursor = feedCursor.end_cursor;
                }
            }

            if (!node) continue;

            const storyNodes = [];
            if (node.__typename === 'Story') storyNodes.push(node);
            else if (node.__typename === 'Group') {
                const edges = node.group_feed?.edges || [];
                for (const edge of edges) {
                    if (edge.node?.__typename === 'Story') storyNodes.push(edge.node);
                    // Also check cursor from edge
                    if (edge.cursor) nextCursor = edge.cursor;
                }
            }

            for (const storyNode of storyNodes) {
                if (allPosts.length >= limit) break;
                if (isReelPost(storyNode)) continue;

                if (!groupName) {
                    groupName = extractGroupName(storyNode);
                    if (groupName) console.log(`[Group Scraper] Group: ${groupName}`);
                }

                const postData = extractPostData(storyNode, groupName, rawText);
                if (postData && (postData.images.length > 0 || postData.videos.length > 0 || postData.text.trim())) {
                    allPosts.push(postData);
                    postsFound++;
                    console.log(`[Group Scraper] Post ${allPosts.length}: ${postData.postId} (${postData.images.length} ảnh, ${postData.videos.length} video)`);
                }
            }

            if (allPosts.length >= limit) break;
        }

        console.log(`[Group Scraper] Page ${pageNum}: ${postsFound} posts`);
        if (!nextCursor || allPosts.length >= limit) break;
        cursor = nextCursor;
        pageNum++;
        await sleep(2000);
    }

    console.log(`[Group Scraper] === DONE === ${allPosts.length} posts`);
    return allPosts;
}

// ==================== EXPORTS ====================
module.exports = { scrapeGroupPosts, downloadGroupVideo, downloadImage, extractGroupName, videoDownloadQueue };
