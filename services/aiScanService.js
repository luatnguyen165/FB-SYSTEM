// services/aiScanService.js
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getOrOpenFacebookContext } = require('./facebookPlaywrightService');
const { fetchGroupPosts } = require('./facebookGraphqlScraper');
const AiScanConfig = require('../models/AiScanConfig');
const AiScanResult = require('../models/AiScanResult');
const Channel = require('../models/Channel');
const Settings = require('../models/Settings');
const AiComment = require('../models/AiComment');
const socketService = require('./socketService');
const axios = require('axios');

// ============================================================
// HELPERS
// ============================================================
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function resolveFilePath(filePath = '') {
    const raw = String(filePath || '').trim();
    if (!raw) return '';
    if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;
const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..');
    const normalized = raw.replace(/^\/+/, '').replace(/^\.\/+/, '');
    const candidates = [
        path.join(projectRoot, normalized),
        path.join(projectRoot, 'uploads', 'images', path.basename(normalized)),
        path.join(projectRoot, 'uploads', 'videos', path.basename(normalized))
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return raw;
}

function normalizeFacebookPostUrl(postId = '') {
    const id = String(postId).trim();
    if (!id) return '';
    if (id.startsWith('http')) return id;
    return `https://www.facebook.com/${id}`;
}

function extractGroupIdFromUrl(url = '') {
    const match = String(url).match(/\/groups\/([^/?&]+)/);
    return match ? match[1] : '';
}

function isTodayTimeString(timeText, maxDaysOld = 1) {
    if (!timeText) return true; // Không có timestamp -> giữ lại
    const text = timeText.toLowerCase().trim();
    
    // Pattern chắc chắn hôm nay
    if (/vài giây|vừa xong|just now|now|phút trước|mins? ago|minutes? ago|giờ trước|hours? ago|hrs? ago|hôm nay|today/.test(text)) return true;
    
    // Time format "14:30" hoặc "lúc 14:30" - chỉ giữ nếu không có dấu hiệu cũ
    if (/\d{1,2}:\d{2}/.test(text) && !/hôm qua|yesterday|thứ\s|ngày/.test(text)) return true;
    
    // "5 giờ trước", "10 hours ago" (<=24h) - always keep for today
    const hourMatch = text.match(/(\d+)\s*(giờ|hours?|hrs?)/);
    if (hourMatch && parseInt(hourMatch[1]) <= 24) return true;
    
    // "hôm qua", "yesterday" - keep if maxDaysOld >= 2
    if (/hôm qua|yesterday/.test(text)) {
        return maxDaysOld >= 2;
    }
    
    // Pattern chắc chắn là bài cũ
    if (/tuần|weeks?|năm|years?|tháng\s*\d|month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2}\/\d{4}/i.test(text)) return false;
    
    // "Thứ Hai", "Thứ Ba" etc -> bài cũ trong tuần (Facebook format)
    if (/thứ\s+(hai|ba|tư|năm|sáu|bảy|nhật|cn|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text)) {
        return maxDaysOld >= 2;
    }
    
    // Số ngày >= 1: "2 ngày trước", "3 days ago" - check against maxDaysOld
    const dayMatch = text.match(/(\d+)\s*(ngày|days?)/);
    if (dayMatch) {
        const daysAgo = parseInt(dayMatch[1]);
        return daysAgo < maxDaysOld;
    }
    
    return true; // Không xác định được -> giữ lại
}

// ============================================================
// AI ANALYSIS - Puter.js (Frontend) + OpenAI (Backend fallback)
// ============================================================

async function callAiForAnalysis(userId, postData, prompt, config = {}) {
    const usePuter = config.usePuter !== false;
    if (usePuter) {
        try {
            const requestId = uuidv4();
            socketService.emitScanProgress(userId, config.configId, {
                status: 'analyzing',
                current: postData._currentPostIndex || '?',
                total: postData._totalPosts || '?',
                message: `Đang phân tích: ${(postData.postContent || '').substring(0, 50)}...`
            });
            const result = await socketService.requestAiAnalysis(userId, requestId, {
                postId: postData.postId,
                postUrl: postData.postUrl,
                postContent: postData.postContent,
                postAuthor: postData.postAuthor,
                postImages: postData.postImages || []
            }, prompt, 30000);
            return result;
        } catch (puterErr) {
            console.warn(`[AI Scan] Puter.js failed, trying OpenAI:`, puterErr.message);
        }
    }
    const apiKey = config.openaiApiKey || '';
    if (!apiKey) throw new Error('Không có Puter.js frontend và chưa cấu hình OpenAI API key');
    return await callOpenAi(prompt, apiKey, config.model);
}

async function callOpenAi(prompt, apiKey, modelName = 'gpt-4o-mini') {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: String(modelName || 'gpt-4o-mini').trim(),
        messages: [
            { role: 'system', content: 'Bạn là trợ lý phân tích nhu cầu khách hàng. Trả về JSON hợp lệ.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
    }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });
    return response.data?.choices?.[0]?.message?.content || '';
}

function parseAiResponse(rawText = '') {
    try {
        const clean = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(clean);
        return {
            isMatching: Boolean(parsed.isMatching || parsed.is_matching || false),
            score: parseInt(parsed.score || parsed.aiScore || parsed.confidence || 0, 10) || 0,
            analysis: String(parsed.analysis || parsed.aiAnalysis || parsed.explanation || rawText),
            reason: String(parsed.reason || parsed.matchReason || parsed.match_reason || '')
        };
    } catch (e) {
        const text = rawText.toLowerCase();
        return {
            isMatching: text.includes('có nhu cầu') || text.includes('khách hàng tiềm năng') || text.includes('nên comment') || text.includes('match'),
            score: text.includes('có nhu cầu') ? 60 : 20,
            analysis: rawText,
            reason: ''
        };
    }
}

// ============================================================
// PHASE 1: CRAWL POSTS FROM FACEBOOK → SAVE RAW TO DB
// ============================================================

async function crawlGroupPosts(page, groupUrl, maxPosts = 10, maxDaysOld = 1) {
    console.log(`[Crawl] Scanning: ${groupUrl}, max: ${maxPosts}, maxDaysOld: ${maxDaysOld}`);
    
    // Vào tab bài viết của group (không phải discussion/chat)
    const postsUrl = groupUrl.replace(/\/+$/, '') + '/posts/';
    console.log(`[Crawl] Loading posts page: ${postsUrl}`);
    
    await page.goto(postsUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => {
        console.log(`[Crawl] ⚠ Page load warning, continuing:`, e.message);
    });
    await page.waitForTimeout(3000);
    
    // Kiểm tra xem đã vào đúng feed chưa
    const pageTitle = await page.title().catch(() => '');
    console.log(`[Crawl] Page title: "${pageTitle}"`);
    
    const feedSelector = 'div[role="feed"], div.x1hc1fzr.x1unhpq9, [data-pagelet="GroupFeed"]';
    const hasFeed = await page.$(feedSelector).catch(() => null);
    console.log(`[Crawl] Feed found: ${!!hasFeed}`);

    const posts = [];
    let scrollAttempts = 0;
    const maxScrolls = Math.ceil(maxPosts / 3) + 5;

    while (posts.length < maxPosts && scrollAttempts < maxScrolls) {
        scrollAttempts++;
        const newPosts = await page.evaluate(() => {
            const articles = Array.from(document.querySelectorAll('div[role="article"]'));
            return articles.map(article => {
                const textSelectors = [
                    'div[data-ad-preview="message"]',
                    'div[data-ad-comet-preview="message"]',
                    'div.xdj266r.x11i5rnm.xat24cr.x1mh8g0r',
                    'span.x193iq5w.xeuugli.x13faqbe.x1vvkbs.xlh3980.xvmahel.x1n0sxbx.x6prxxf.xvq8zen.xo1l8bm.xzsf02u'
                ];
                let content = '';
                for (const sel of textSelectors) {
                    const el = article.querySelector(sel);
                    if (el && el.innerText.trim().length > 5) { content = el.innerText.trim(); break; }
                }
                if (!content) content = article.innerText.trim().substring(0, 2000);

                const links = Array.from(article.querySelectorAll('a[href*="/posts/"], a[href*="/photo/"], a[href*="/permalink/"], a[href*="/story.php"]'));
                let postUrl = '', postId = '';
                for (const link of links) {
                    const href = link.getAttribute('href') || '';
                    const m = href.match(/\/posts?\/([^/?&]+)/) || href.match(/story_fbid=(\d+)/) || href.match(/permalink\/(\d+)/);
                    if (m) { postId = m[1]; postUrl = href.startsWith('http') ? href : 'https://www.facebook.com' + href; break; }
                }
                const authorEl = article.querySelector('a[href*="/user/"], a[href*="/profile.php"], strong span, h3 span, span.x193iq5w');
                const author = authorEl ? authorEl.innerText.trim() : '';
                const imgs = Array.from(article.querySelectorAll('img.x1ey2m1c.xds687c.x5yr21d.x10l6tqk.x17qophe.x13vifvy.xh8yej3'));
                const images = imgs.map(img => img.src).filter(src => src && !src.includes('emoji') && !src.includes('avatar'));
                const timeEl = article.querySelector('a[href*="/posts/"] span, a[href*="/photo/"] span');
                const publishedAt = timeEl ? timeEl.innerText.trim() : '';
                return { content, postUrl, postId, author, images, publishedAt };
            }).filter(p => p.content.length > 10 || p.images.length > 0);
        });

        for (const p of newPosts) {
            if (posts.length >= maxPosts) break;
            if (!isTodayTimeString(p.publishedAt, maxDaysOld)) { console.log(`[Crawl] Skip old: ${p.postId || p.postUrl} (${p.publishedAt})`); continue; }
            // Dùng postUrl làm fallback ID nếu postId rỗng
            const pid = p.postId || p.postUrl || ('gen_' + Date.now() + '_' + posts.length);
            if (!posts.find(x => (x.postId && x.postId === pid) || (x.postUrl && x.postUrl === p.postUrl))) {
                p.postId = pid;
                posts.push(p);
            }
        }
        console.log(`[Crawl] Scroll ${scrollAttempts}: ${posts.length}/${maxPosts} posts (today)`);
        await page.mouse.wheel(0, randomInt(600, 1200));
        await page.waitForTimeout(randomInt(600, 1200));
    }
    return posts.slice(0, maxPosts);
}

/**
 * Save scraped posts to DB (dedup by postId + configId)
 */
/**
 * Download image to local disk and return relative URL
 */
async function downloadImageToLocal(imageUrl, postId, imageIndex = 1, groupFolder = 'group_post') {
    if (!imageUrl || !postId) return null;
    try {
                    const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..');
        const postDir = path.join(projectRoot, 'uploads', 'ai-scan', groupFolder, String(postId));
        fs.mkdirSync(postDir, { recursive: true });

        let ext = '.jpg';
        if (imageUrl.toLowerCase().includes('.png')) ext = '.png';
        else if (imageUrl.toLowerCase().includes('.jpeg')) ext = '.jpeg';
        else if (imageUrl.toLowerCase().includes('.webp')) ext = '.webp';

        const filename = imageIndex === 1 ? `${postId}${ext}` : `${postId}_${imageIndex}${ext}`;
        const filepath = path.join(postDir, filename);
        const relativeUrl = `/uploads/ai-scan/${groupFolder}/${postId}/${filename}`;

        // If already downloaded, skip
        if (fs.existsSync(filepath)) return relativeUrl;

        const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
        fs.writeFileSync(filepath, response.data);
        return relativeUrl;
    } catch (e) {
        console.log(`  ❌ Download failed: ${e.message}`);
        return null;
    }
}

async function savePostsToDb(posts, config, groupUrl) {
    if (!posts.length) {
        console.log(`[Crawl] ⚠ No posts to save for group: ${groupUrl}`);
        return 0;
    }

    // Sanitize group folder name
    let groupFolder = 'unknown';
    if (posts[0] && posts[0].group_name) {
        groupFolder = String(posts[0].group_name).replace(/[^a-zA-Z0-9\s\-_]/g, '').trim().replace(/\s+/g, '-').substring(0, 50) || 'unknown';
    } else {
        const urlMatch = String(groupUrl).match(/\/groups\/([^/?&]+)/);
        if (urlMatch) groupFolder = urlMatch[1].substring(0, 30);
    }

    let saved = 0;
    let skipped = 0;
    let errors = 0;
    for (const p of posts) {
        try {
            const postId = p.post_id || p.postId || '';
            const postUrl = p.postUrl || p.permalink || normalizeFacebookPostUrl(postId);
            const content = p.message || p.content || '';
            const author = p.author || '';
            const publishedAt = p.publishedAt || '';

            if (!postId) continue;

            // Download images locally & convert to local URLs
            const localImages = [];
            const photoList = p.photos || [];
            for (let i = 0; i < photoList.length; i++) {
                const ph = photoList[i];
                const url = ph.url || ph.saved_as || '';
                if (!url) continue;
                const localUrl = await downloadImageToLocal(url, postId, i + 1, groupFolder);
                if (localUrl) localImages.push(localUrl);
                else localImages.push(url); // fallback to original URL
            }

            const groupName = p.group_name || p.groupName || '';

            const existing = await AiScanResult.findOne({ configId: config._id, postId }).lean();
            if (existing) {
                console.log(`[Crawl] ⏭ Already exists: ${postId}`);
                skipped++;
                continue;
            }
            await AiScanResult.create({
                userId: config.userId,
                configId: config._id,
                channelId: config.channelId,
                groupId: extractGroupIdFromUrl(groupUrl),
                groupUrl,
                groupName,
                postId,
                postUrl,
                postContent: content,
                postImages: localImages,
                postAuthor: author,
                postPublishedAt: publishedAt,
                aiAnalyzed: false,
                scannedAt: new Date()
            });
            saved++;
            console.log(`[Crawl] ✓ Saved: ${postId} (${(content || '').substring(0, 50)}...) [${localImages.length} images]`);
        } catch (e) {
            errors++;
            console.error(`[Crawl] ✗ Error saving post:`, e.message);
        }
    }
    console.log(`[Crawl] Summary: ${saved} saved, ${skipped} skipped, ${errors} errors | Group: ${groupUrl}`);
    return saved;
}

// ============================================================
// REAL-TIME EMIT HELPERS
// ============================================================

/**
 * Emit new results + updated stats to frontend via Socket.IO
 */
async function emitRealtimeResults(userId, configId) {
    try {
        const socketService = require('./socketService');
        
        // Emit updated stats
        const AiScanResult = require('../models/AiScanResult');
        const AiScanConfig = require('../models/AiScanConfig');
        
        const [totalScanned, totalMatched, totalCommented] = await Promise.all([
            AiScanResult.countDocuments({ userId }),
            AiScanResult.countDocuments({ userId, isMatching: true }),
            AiScanResult.countDocuments({ userId, commentSent: true })
        ]);
        
        socketService.emitStatsUpdate(userId, {
            totalScanned,
            totalMatched,
            totalCommented
        });
        
        // Emit new results (latest 5)
        const latestResults = await AiScanResult.find({ userId, configId })
            .sort({ scannedAt: -1 })
            .limit(5)
            .lean();
        
        if (latestResults.length > 0) {
            socketService.emitNewResults(userId, latestResults);
        }
    } catch (e) {
        console.error('[Realtime] Error emitting results:', e.message);
    }
}

// ============================================================
// EXPORTED MAIN FUNCTIONS
// ============================================================

/**
 * Extract cookies and fb_dtsg from Playwright context (used for GraphQL API)
 */
async function analyzeDbResult(doc, config, apiKey) {
    const analysisPrompt = `${config.scanScript}

==== BÀI VIẾT CẦN PHÂN TÍCH ====
Tác giả: ${doc.postAuthor || 'Không rõ'}
Nội dung: ${doc.postContent}

==== HƯỚNG DẪN ====
Trả về JSON: {"isMatching": true/false, "score": 0-100, "analysis": "...", "reason": "..."}`;

    console.log(`[AI] Analyzing DB post: ${doc.postId}`);
    const aiRawResponse = await callAiForAnalysis(config.userId, {
        postId: doc.postId,
        postUrl: doc.postUrl,
        postContent: doc.postContent,
        postAuthor: doc.postAuthor,
        postImages: doc.postImages || [],
        _currentPostIndex: doc._batchIndex || '?',
        _totalPosts: doc._batchTotal || '?'
    }, analysisPrompt, {
        configId: config._id,
        openaiApiKey: apiKey,
        model: config.model,
        usePuter: true
    });
    const aiResult = parseAiResponse(aiRawResponse);

    doc.aiAnalysis = aiResult.analysis;
    doc.aiScore = aiResult.score;
    doc.isMatching = aiResult.isMatching;
    doc.matchReason = aiResult.reason || '';
    doc.aiAnalyzed = true;
    await doc.save();

    console.log(`[AI] Post ${doc.postId}: match=${aiResult.isMatching}, score=${aiResult.score}`);
    return doc;
}

/**
 * Process comments for all matching DB results
 */
async function commentOnMatchingResults(page, results, config) {
    for (const doc of results) {
        if (!doc.isMatching) continue;

        let bankComments = await AiComment.find({ userId: config.userId, isActive: true }).sort({ order: 1 }).lean();
        let itemsToSend = [];

        if (bankComments && bankComments.length > 0) {
            itemsToSend = bankComments.map(bc => ({ type: bc.type, content: bc.content, caption: bc.caption || '' }));
        } else if (config.commentItems && config.commentItems.length > 0) {
            itemsToSend = config.commentItems.map(ci => ({ type: ci.type, content: ci.content, caption: ci.caption || '' }));
        } else if (config.commentScripts && config.commentScripts.length > 0) {
            const script = config.commentScripts[randomInt(0, config.commentScripts.length - 1)];
            const img = (config.commentImages && config.commentImages.length > 0) ? config.commentImages[randomInt(0, config.commentImages.length - 1)] : '';
            let comment = script.replace(/\{ten_sp\}/g, config.niche || 'sản phẩm').replace(/\{gia\}/g, 'Liên hệ').replace(/\{nganh\}/g, config.niche || '');
            try {
                const ok = await commentOnPostLegacy(page, doc.postUrl, comment, img);
                doc.commentSent = ok;
                doc.commentContent = comment;
                doc.commentImage = img;
                doc.commentedAt = ok ? new Date() : null;
                const legacy = [];
                if (comment) legacy.push({ type: 'text', content: comment, sent: ok, error: ok ? '' : 'Không tìm thấy ô comment', sentAt: ok ? new Date() : null });
                if (img) legacy.push({ type: 'image', content: img, caption: comment, sent: ok, error: ok ? '' : 'Không tìm thấy ô comment', sentAt: ok ? new Date() : null });
                doc.comments = legacy;
                if (!ok) doc.commentError = 'Không tìm thấy ô comment';
            } catch (err) { doc.commentError = err.message; }
            await doc.save();
            await wait(randomInt(1500, 3000));
            continue;
        }

        if (itemsToSend.length === 0) continue;

        await page.goto(doc.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const commentResults = await sendMultipleComments(page, itemsToSend);
        const anySent = commentResults.some(r => r.sent);
        doc.comments = commentResults;
        doc.commentSent = anySent;
        doc.commentContent = commentResults.filter(r => r.type === 'text').map(r => r.content).join(' | ');
        doc.commentImage = commentResults.find(r => r.type === 'image')?.content || '';
        doc.commentError = commentResults.find(r => r.error)?.error || '';
        doc.commentedAt = anySent ? new Date() : null;
        await doc.save();
        await wait(randomInt(1500, 4000));
    }
}

// ============================================================
// COMMENT UTILS
// ============================================================

async function humanLikeTyping(page, text) {
    for (const char of text) {
        await page.keyboard.type(char, { delay: randomInt(20, 60) });
        if (Math.random() < 0.01) await wait(randomInt(300, 700));
    }
}

async function uploadFileToComment(page, filePath) {
    try {
        const resolvedPath = resolveFilePath(filePath);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) return false;
        const selectors = ['input[type="file"][accept*="image"]', 'input[type="file"][accept*="video"]', 'input[type="file"][accept*="media"]', 'form input[type="file"]'];
        for (const sel of selectors) {
            const input = page.locator(sel).first();
            if (await input.count().catch(() => 0) > 0) { await input.setInputFiles(resolvedPath); await page.waitForTimeout(2000); return true; }
        }
        const attachBtns = ['div[aria-label="Đính kèm ảnh"]', 'div[aria-label="Attach a photo"]', 'div[aria-label="Ảnh/video"]'];
        for (const sel of attachBtns) {
            const btn = page.locator(sel).first();
            if (await btn.count().catch(() => 0) > 0) {
                await btn.click({ force: true }); await page.waitForTimeout(1000);
                const fi = page.locator('input[type="file"]').first();
                if (await fi.count().catch(() => 0) > 0) { await fi.setInputFiles(resolvedPath); await page.waitForTimeout(2000); return true; }
                break;
            }
        }
        return false;
    } catch (e) { return false; }
}

async function sendTextComment(page, text) {
    if (!text) return { sent: false, error: 'Empty text' };
    const selectors = ['div[aria-label="Viết bình luận"]', 'div[aria-label="Write a comment"]', 'div[role="textbox"][contenteditable="true"]'];
    for (const sel of selectors) {
        const loc = page.locator(sel).first();
        if (await loc.count().catch(() => 0) > 0) {
            try {
                await loc.click({ force: true }); await page.waitForTimeout(400);
                await humanLikeTyping(page, text); await page.waitForTimeout(800);
                await page.keyboard.press('Enter'); await page.waitForTimeout(2500);
                return { sent: true, error: '' };
            } catch (e) { /* try next */ }
        }
    }
    return { sent: false, error: 'Không tìm thấy ô comment' };
}

async function sendMediaComment(page, filePath, caption, mediaType) {
    if (!filePath) return { sent: false, error: 'Missing file path' };
    const resolvedPath = resolveFilePath(filePath);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) return { sent: false, error: 'File not found' };
    try {
        const selectors = ['div[aria-label="Viết bình luận"]', 'div[aria-label="Write a comment"]', 'div[role="textbox"][contenteditable="true"]'];
        let focused = false;
        for (const sel of selectors) {
            const loc = page.locator(sel).first();
            if (await loc.count().catch(() => 0) > 0) { await loc.click({ force: true }); await page.waitForTimeout(400); focused = true; break; }
        }
        if (!focused) return { sent: false, error: 'Không tìm thấy ô comment' };
        if (!await uploadFileToComment(page, resolvedPath)) return { sent: false, error: 'Không thể upload file' };
        await page.waitForTimeout(randomInt(1500, 3000));
        if (caption) {
            for (const sel of selectors) {
                const loc = page.locator(sel).first();
                if (await loc.count().catch(() => 0) > 0) { await loc.click({ force: true }); await page.waitForTimeout(200); await humanLikeTyping(page, ' ' + caption); await page.waitForTimeout(400); break; }
            }
        }
        await page.keyboard.press('Enter'); await page.waitForTimeout(3500);
        return { sent: true, error: '' };
    } catch (e) { return { sent: false, error: e.message }; }
}

async function sendCommentItem(page, item) {
    if (item.type === 'text') return sendTextComment(page, item.content);
    if (item.type === 'image') return sendMediaComment(page, item.content, item.caption, 'image');
    if (item.type === 'video') return sendMediaComment(page, item.content, item.caption, 'video');
    return { sent: false, error: 'Unknown type' };
}

async function sendMultipleComments(page, items) {
    const results = [];
    for (const item of items) {
        const r = await sendCommentItem(page, item);
        results.push({ type: item.type, content: item.content, caption: item.caption || '', sent: r.sent, error: r.error, sentAt: r.sent ? new Date() : null });
        if (items.length > 1) await wait(randomInt(1500, 4000));
    }
    return results;
}

async function commentOnPostLegacy(page, postUrl, commentText, imagePath = '') {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const items = [];
    if (commentText && imagePath) items.push({ type: 'image', content: imagePath, caption: commentText });
    else if (imagePath) items.push({ type: 'image', content: imagePath, caption: '' });
    else if (commentText) items.push({ type: 'text', content: commentText, caption: '' });
    if (items.length === 0) return false;
    const results = await sendMultipleComments(page, items);
    return results.some(r => r.sent);
}

// ============================================================
// EXPORTED MAIN FUNCTIONS
// ============================================================

/**
 * Extract cookies and fb_dtsg from Playwright context (used for GraphQL API)
 */
async function extractFbSessionFromPlaywright(channel) {
    console.log(`[Crawl] Opening Playwright to extract session cookies + fb_dtsg...`);

    const { context, sessionKey } = await getOrOpenFacebookContext(
        channel.userId || '', channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: true }
    );

    try {
        const page = context.pages()[0] || await context.newPage();

        // Navigate to Facebook to ensure cookies are loaded
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        // Extract cookies
        const browserCookies = await context.cookies('https://www.facebook.com');
        const cookies = {};
        for (const c of browserCookies) {
            cookies[c.name] = c.value;
        }
        console.log(`[Crawl] ✓ Extracted ${Object.keys(cookies).length} cookies`);

        // Wait for page to fully load
        await page.waitForTimeout(5000);

        // Extract fb_dtsg token - try multiple methods
        let fbDtsg = '';
        try {
            fbDtsg = await page.evaluate(() => {
                // Method 1: From hidden input
                const input = document.querySelector('input[name="fb_dtsg"]');
                if (input) return input.value || '';

                // Method 2: From meta tag
                const meta = document.querySelector('meta[name="csrf-token"]');
                if (meta) return meta.getAttribute('content') || '';

                // Method 3: From page source - multiple regex patterns
                const html = document.documentElement.innerHTML;
                
                // Pattern: "fb_dtsg":"xxx"
                const m1 = html.match(/"fb_dtsg"\s*:\s*"([^"]+)"/);
                if (m1) return m1[1];
                
                // Pattern: name="fb_dtsg" value="xxx"
                const m2 = html.match(/name="fb_dtsg"[^>]*value="([^"]+)"/);
                if (m2) return m2[1];
                
                // Pattern: DTSGInitialData...token
                const m3 = html.match(/"DTSGInitialData".*?"token"\s*:\s*"([^"]+)"/);
                if (m3) return m3[1];
                
                // Pattern: token in data-content
                const m4 = html.match(/data-content='[^']*"token":"([^"]+)"/);
                if (m4) return m4[1];

                return '';
            });
        } catch (e) {
            console.log(`[Crawl] ⚠ Could not extract fb_dtsg via evaluate: ${e.message}`);
        }

        // Fallback: extract from page HTML content
        if (!fbDtsg) {
            try {
                const content = await page.content();
                const patterns = [
                    /"fb_dtsg"\s*:\s*"([^"]+)"/,
                    /name="fb_dtsg"[^>]*value="([^"]+)"/,
                    /"DTSGInitialData".*?"token"\s*:\s*"([^"]+)"/,
                    /fb_dtsg=([^&"]+)/
                ];
                for (const pattern of patterns) {
                    const match = content.match(pattern);
                    if (match) { fbDtsg = match[1]; break; }
                }
            } catch (e) {}
        }

        // Fallback: try to find fb_dtsg in cookies
        if (!fbDtsg) {
            try {
                const allCookies = await context.cookies('https://www.facebook.com');
                for (const c of allCookies) {
                    if (c.name === 'fb_dtsg') { fbDtsg = c.value; break; }
                }
            } catch (e) {}
        }

        console.log(`[Crawl] ✓ fb_dtsg: ${fbDtsg ? fbDtsg.substring(0, 20) + '...' : '(empty - GraphQL may fail!)'}`);

        return { cookies, fbDtsg, sessionKey, context };
    } catch (e) {
        // Close context on error
        try { await context.close(); } catch (ex) {}
        throw e;
    }
}

/**
 * Phase 1: Crawl posts từ Facebook bằng GraphQL API, lưu raw vào DB
 * Uses GraphQL API directly (much faster than Playwright scrolling)
 */
async function crawlPhase(config) {
    console.log(`\n[Crawl] ===== START CRAWL PHASE (GraphQL API) =====`);
    console.log(`[Crawl] Config: ${config.name} (ID: ${config._id})`);
    console.log(`[Crawl] UserID: ${config.userId}, ChannelID: ${config.channelId}`);
    console.log(`[Crawl] GroupKeys: ${JSON.stringify(config.groupKeys || [])}`);
    console.log(`[Crawl] MaxPostsPerScan: ${config.maxPostsPerScan || 10}`);
    console.log(`[Crawl] MaxDaysOld: ${config.maxDaysOld || 1}`);

    const channel = await Channel.findById(config.channelId).lean();
    if (!channel) { console.error(`[Crawl] ❌ Channel not found: ${config.channelId}`); throw new Error('Tài khoản Facebook không tồn tại'); }
    console.log(`[Crawl] ✓ Channel found: ${channel.accountName} (${channel.accountType})`);

    // Step 1: Extract session cookies + fb_dtsg via Playwright (quick, just to get auth)
    let fbSession;
    try {
        fbSession = await extractFbSessionFromPlaywright({ ...channel, userId: config.userId });
        console.log(`[Crawl] ✓ FB session extracted`);
    } catch (fbErr) {
        console.error(`[Crawl] ❌ Failed to extract FB session:`, fbErr.message);
        throw fbErr;
    }

    let totalCrawled = 0;

    try {
        const groupKeys = config.groupKeys || [];
        console.log(`[Crawl] Will scan ${groupKeys.length} groups via GraphQL API`);

        for (const groupKey of groupKeys) {
            try {
                // Extract groupId from URL or key
                let groupId = groupKey;
                const urlMatch = String(groupKey).match(/\/groups\/([^/?&]+)/);
                if (urlMatch) groupId = urlMatch[1];

                const groupUrl = groupKey.startsWith('http') ? groupKey : `https://www.facebook.com/groups/${groupId}`;
                console.log(`\n[Crawl] --- Crawling group: ${groupUrl} (ID: ${groupId}) ---`);

                // Use GraphQL scraper
                console.log(`[Crawl] Calling fetchGroupPosts with: groupId=${groupId}, cookies=${Object.keys(fbSession.cookies).length}, fbDtsg=${fbSession.fbDtsg ? 'yes' : 'empty'}`);
                
                let rawPosts = [];
                try {
                    rawPosts = await fetchGroupPosts({
                        groupId,
                        cookies: fbSession.cookies,
                        fbDtsg: fbSession.fbDtsg,
                        limit: config.maxPostsPerScan || 10,
                        minComments: 0,
                        maxRetries: 5
                    });
                } catch (fetchErr) {
                    console.error(`[Crawl] ❌ fetchGroupPosts threw error:`, fetchErr.message);
                    console.error(`[Crawl] ❌ Stack:`, fetchErr.stack);
                }

                console.log(`[Crawl] Got ${rawPosts.length} posts from GraphQL API`);

                // Save to DB
                const saved = await savePostsToDb(rawPosts, config, groupUrl);
                totalCrawled += saved;
                console.log(`[Crawl] Group done: ${saved} saved, total so far: ${totalCrawled}`);
            } catch (e) {
                console.error(`[Crawl] ❌ Error crawling group:`, e.message);
            }
        }

        await AiScanConfig.updateOne({ _id: config._id }, { $set: { lastScanAt: new Date(), updatedAt: new Date() } });
        console.log(`\n[Crawl] ===== CRAWL COMPLETE: ${totalCrawled} total posts =====\n`);
        
        // Emit real-time results to frontend
        if (totalCrawled > 0) {
            try {
                await emitRealtimeResults(config.userId, config._id);
            } catch (e) {
                console.error('[Crawl] Error emitting realtime results:', e.message);
            }
        }
        
        return { success: true, totalCrawled };
    } finally {
        // Close Playwright context used for session extraction
        try {
            if (fbSession?.context) await fbSession.context.close();
            const sessions = global.__facebookPlaywrightSessions;
            if (sessions && fbSession?.sessionKey) sessions.delete(fbSession.sessionKey);
            console.log(`[Crawl] Context closed, session cleaned up`);
        } catch (e) {}
    }
}

/**
 * Phase 2: Lấy posts chưa phân tích từ DB, chạy AI (song song batch 5), comment nếu match
 */
async function aiAnalyzePhase(config) {
    const settings = await Settings.findOne({ userId: config.userId }).lean();
    const apiKey = config.openaiApiKey || (settings?.openaiApiKey || '');

    // Lấy posts chưa được AI phân tích
    const unscannedDocs = await AiScanResult.find({
        configId: config._id,
        aiAnalyzed: false
    }).limit(config.maxPostsPerScan || 50).exec();

    if (unscannedDocs.length === 0) {
        console.log(`[AI] No unscanned posts for config: ${config.name}`);
        return { success: true, totalAnalyzed: 0, matchingPosts: 0, commentedPosts: 0 };
    }

    const BATCH_SIZE = 5;
    const total = unscannedDocs.length;
    unscannedDocs.forEach((d, i) => { d._batchIndex = i + 1; d._batchTotal = total; });
    const allResults = [];

    // AI analysis - không cần Facebook context
    for (let i = 0; i < unscannedDocs.length; i += BATCH_SIZE) {
        const batch = unscannedDocs.slice(i, i + BATCH_SIZE);
        console.log(`[AI] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(total / BATCH_SIZE)}: ${batch.length} posts`);
        const batchResults = await Promise.all(batch.map(doc => analyzeDbResult(doc, config, apiKey)));
        for (const r of batchResults) allResults.push(r);
        await wait(randomInt(300, 800));
    }

    // Sau khi AI phân tích xong, nếu có matching thì comment (cần Facebook context)
    const matchingResults = allResults.filter(r => r.isMatching);
    if (matchingResults.length > 0) {
        const channel = await Channel.findById(config.channelId).lean();
        if (channel) {
            const { context, sessionKey } = await getOrOpenFacebookContext(
                config.userId, channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: false }
            );
            const page = context.pages()[0] || await context.newPage();
            try {
                await commentOnMatchingResults(page, matchingResults, config);
            } finally {
                try { await context.close(); const sessions = global.__facebookPlaywrightSessions; if (sessions) sessions.delete(sessionKey); } catch (e) {}
            }
        }
    }

    await AiScanConfig.updateOne({ _id: config._id }, { $set: { lastScanAt: new Date(), updatedAt: new Date() } });
    console.log(`[AI] Done. Analyzed: ${allResults.length}, Matched: ${matchingResults.length}`);

    // Emit real-time results to frontend after AI analysis + commenting
    try {
        if (allResults.length > 0) {
            await emitRealtimeResults(config.userId, config._id);
        }
    } catch (e) {
        console.error('[AI] Error emitting realtime results:', e.message);
    }

    return {
        success: true,
        totalAnalyzed: allResults.length,
        matchingPosts: matchingResults.length,
        commentedPosts: matchingResults.filter(r => r.commentSent || (r.comments && r.comments.some(c => c.sent))).length
    };
}

/**
 * Full flow: Crawl + AI (gọi lần lượt)
 */
async function runAiScan(config) {
    console.log(`[Full Scan] Starting for: ${config.name}`);
    const crawlResult = await crawlPhase(config);
    console.log(`[Full Scan] Crawl done: ${crawlResult.totalCrawled} posts`);
    
    // Kiểm tra xem có API key để chạy AI không
    const settings = await Settings.findOne({ userId: config.userId }).lean();
    const apiKey = config.openaiApiKey || (settings?.openaiApiKey || '');
    
    let aiResult = { totalAnalyzed: 0, matchingPosts: 0, commentedPosts: 0 };
    if (apiKey && apiKey.trim()) {
        try {
            aiResult = await aiAnalyzePhase(config);
            console.log(`[Full Scan] AI done: ${aiResult.totalAnalyzed} analyzed, ${aiResult.matchingPosts} matched`);
        } catch (err) {
            console.error(`[Full Scan] AI phase failed, but crawl succeeded:`, err.message);
        }
    } else {
        console.log(`[Full Scan] ⏭ Skipping AI analysis (no API key configured). Posts saved to DB.`);
    }
    
    return { ...crawlResult, ...aiResult };
}

function isInTimeRange(config) {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentMinutes = hour * 60 + minute;
    
    const timeStart = config.scheduleTimeStart || '06:00';
    const timeEnd = config.scheduleTimeEnd || '23:00';
    
    const [startH, startM] = timeStart.split(':').map(Number);
    const [endH, endM] = timeEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

async function runScheduledScans() {
    const now = new Date();
    const configs = await AiScanConfig.find({ 
        isActive: true, 
        scheduleEnabled: true 
    }).lean();
    
    const toRun = configs.filter(c => {
        // Kiểm tra khung giờ
        if (!isInTimeRange(c)) return false;
        
        // Kiểm tra interval: lần quét cuối + interval > now => skip
        if (c.lastScanAt) {
            const elapsed = (now - new Date(c.lastScanAt)) / 60000; // phút
            if (elapsed < (c.scanIntervalMinutes || 60)) return false;
        }
        
        // Nếu có nextScanAt, kiểm tra đã đến giờ chưa
        if (c.nextScanAt && new Date(c.nextScanAt) > now) return false;
        
        return true;
    });
    
    console.log(`[Scheduler] Running ${toRun.length} configs`);
    const results = [];
    for (const cfg of toRun) {
        try {
            // Tạo config với maxPostsPerScan từ schedule settings
            const scanConfig = { ...cfg, maxPostsPerScan: cfg.maxPostsPerScan || 10 };
            await runAiScan(scanConfig);
            
            // Cập nhật lastScanAt và nextScanAt
            await AiScanConfig.updateOne({ _id: cfg._id }, {
                $set: {
                    lastScanAt: new Date(),
                    nextScanAt: new Date(now.getTime() + (cfg.scanIntervalMinutes || 60) * 60000),
                    updatedAt: new Date()
                }
            });
            results.push({ configId: cfg._id, name: cfg.name, success: true });
        } catch (e) {
            console.error(`[Scheduler] Error ${cfg.name}:`, e.message);
            results.push({ configId: cfg._id, name: cfg.name, success: false, error: e.message });
        }
        await wait(randomInt(3000, 8000));
    }
    return results;
}

/**
 * Play comment thủ công cho 1 kết quả cụ thể (re-trigger commenting)
 * - Lấy AiScanResult theo resultId
 * - Lấy AiScanConfig + Channel tương ứng
 * - Mở Playwright context của channel, navigate tới postUrl
 * - Gửi comments (ưu tiên AiComment bank > config.commentItems > legacy)
 * - Update lại kết quả trong DB
 */
async function playCommentForResult(resultId) {
    console.log(`[Play] ▶ Re-running comment for result: ${resultId}`);
    const AiScanResultModel = require('../models/AiScanResult');

    const doc = await AiScanResultModel.findById(resultId);
    if (!doc) return { success: false, message: 'Không tìm thấy kết quả' };

    if (!doc.postUrl) return { success: false, message: 'Bài viết không có URL' };

    const config = await AiScanConfig.findById(doc.configId).lean();
    if (!config) return { success: false, message: 'Không tìm thấy cấu hình quét' };

    const channel = await Channel.findById(doc.channelId || config.channelId).lean();
    if (!channel) return { success: false, message: 'Không tìm thấy tài khoản Facebook' };

    // Mở Playwright context
    let context = null;
    let sessionKey = null;
    try {
        const ctx = await getOrOpenFacebookContext(
            config.userId, channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: false }
        );
        context = ctx.context;
        sessionKey = ctx.sessionKey;
    } catch (e) {
        console.error(`[Play] ❌ Cannot open FB context:`, e.message);
        return { success: false, message: 'Không mở được trình duyệt Facebook: ' + e.message };
    }

    let page = null;
    try {
        page = context.pages()[0] || await context.newPage();

        // Lấy comment items: ưu tiên AiComment bank > config.commentItems > legacy
        const bankComments = await AiComment.find({ userId: config.userId, isActive: true })
            .sort({ order: 1 }).lean();

        let itemsToSend = [];
        if (bankComments && bankComments.length > 0) {
            itemsToSend = bankComments.map(bc => ({ type: bc.type, content: bc.content, caption: bc.caption || '' }));
        } else if (config.commentItems && config.commentItems.length > 0) {
            itemsToSend = config.commentItems.map(ci => ({ type: ci.type, content: ci.content, caption: ci.caption || '' }));
        } else if (config.commentScripts && config.commentScripts.length > 0) {
            const script = config.commentScripts[randomInt(0, config.commentScripts.length - 1)];
            const img = (config.commentImages && config.commentImages.length > 0)
                ? config.commentImages[randomInt(0, config.commentImages.length - 1)] : '';
            const text = script
                .replace(/\{ten_sp\}/g, config.niche || 'sản phẩm')
                .replace(/\{gia\}/g, 'Liên hệ')
                .replace(/\{nganh\}/g, config.niche || '');
            itemsToSend = [];
            if (text && img) itemsToSend.push({ type: 'image', content: img, caption: text });
            else if (img) itemsToSend.push({ type: 'image', content: img, caption: '' });
            else if (text) itemsToSend.push({ type: 'text', content: text, caption: '' });
        }

        if (itemsToSend.length === 0) {
            return { success: false, message: 'Cấu hình không có comment nào để gửi' };
        }

        // Navigate tới post
        console.log(`[Play] Navigating to: ${doc.postUrl}`);
        await page.goto(doc.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        // Gửi comment
        const commentResults = await sendMultipleComments(page, itemsToSend);
        const anySent = commentResults.some(r => r.sent);
        const firstError = commentResults.find(r => r.error)?.error || '';

        // Update DB
        doc.comments = commentResults;
        doc.commentSent = anySent;
        doc.commentContent = commentResults.filter(r => r.type === 'text').map(r => r.content).join(' | ');
        doc.commentImage = commentResults.find(r => r.type === 'image')?.content || '';
        doc.commentError = firstError;
        doc.commentedAt = anySent ? new Date() : (doc.commentedAt || null);
        await doc.save();

        console.log(`[Play] ✓ Done. Sent: ${anySent}, Error: ${firstError || 'none'}`);
        return {
            success: anySent,
            message: anySent ? 'Đã gửi comment thành công!' : ('Gửi comment thất bại: ' + (firstError || 'không rõ lỗi')),
            result: doc
        };
    } catch (err) {
        console.error(`[Play] ❌ Error:`, err.message);
        try {
            doc.commentError = err.message;
            await doc.save();
        } catch (e) {}
        return { success: false, message: 'Lỗi: ' + err.message };
    } finally {
        try {
            if (context) await context.close();
            const sessions = global.__facebookPlaywrightSessions;
            if (sessions && sessionKey) sessions.delete(sessionKey);
        } catch (e) {}
    }
}

module.exports = {
    runAiScan,
    runScheduledScans,
    crawlPhase,
    aiAnalyzePhase,
    callOpenAi,
    parseAiResponse,
    scanGroupPosts: crawlGroupPosts, // backward compat
    commentOnPost: commentOnPostLegacy, // backward compat
    sendCommentItem,
    sendMultipleComments,
    playCommentForResult
};
