// services/aiScan/crawler.js
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const AiScanResult = require('../../models/AiScanResult');
const { extractGroupIdFromUrl, normalizeFacebookPostUrl, isTodayTimeString, randomInt } = require('./helpers');
const { downloadGroupVideo, videoDownloadQueue } = require('../facebookGroupScraper');

async function crawlGroupPosts(page, groupUrl, maxPosts = 10, maxDaysOld = 1) {
    console.log(`[Crawl] Scanning: ${groupUrl}, max: ${maxPosts}, maxDaysOld: ${maxDaysOld}`);
    
    const postsUrl = groupUrl.replace(/\/+$/, '') + '/posts/';
    console.log(`[Crawl] Loading posts page: ${postsUrl}`);
    
    await page.goto(postsUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => {
        console.log(`[Crawl] ⚠ Page load warning, continuing:`, e.message);
    });
    await page.waitForTimeout(3000);
    
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

async function downloadImageToLocal(imageUrl, postId, imageIndex = 1, groupFolder = 'group_post') {
    if (!imageUrl || !postId) return null;
    try {
        const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..', '..');
        const postDir = path.join(projectRoot, 'uploads', 'ai-scan', groupFolder, String(postId));
        fs.mkdirSync(postDir, { recursive: true });

        let ext = '.jpg';
        if (imageUrl.toLowerCase().includes('.png')) ext = '.png';
        else if (imageUrl.toLowerCase().includes('.jpeg')) ext = '.jpeg';
        else if (imageUrl.toLowerCase().includes('.webp')) ext = '.webp';

        const filename = imageIndex === 1 ? `${postId}${ext}` : `${postId}_${imageIndex}${ext}`;
        const filepath = path.join(postDir, filename);
        const relativeUrl = `/uploads/ai-scan/${groupFolder}/${postId}/${filename}`;

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

            const localImages = [];
            const photoList = p.photos || [];
            for (let i = 0; i < photoList.length; i++) {
                const ph = photoList[i];
                const url = ph.url || ph.saved_as || '';
                if (!url) continue;
                const localUrl = await downloadImageToLocal(url, postId, i + 1, groupFolder);
                if (localUrl) localImages.push(localUrl);
                else localImages.push(url);
            }

            // Download videos (same pattern as tracking controller)
            const localVideos = [];
            const videoList = p.videos || [];
            if (videoList.length > 0) {
                const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..', '..');
                const postDir = path.join(projectRoot, 'uploads', 'ai-scan', groupFolder, String(postId));
                fs.mkdirSync(postDir, { recursive: true });

                // Get cookies from channel for video download
                const Channel = require('../../models/Channel');
                const channelDoc = config.channelId ? await Channel.findById(config.channelId).lean() : null;
                let cookies = {};
                if (channelDoc?.storageStatePath && fs.existsSync(channelDoc.storageStatePath)) {
                    try {
                        const state = JSON.parse(fs.readFileSync(channelDoc.storageStatePath, 'utf8'));
                        for (const c of (state.cookies || [])) { cookies[c.name] = c.value; }
                    } catch (e) {}
                }

                for (let v = 0; v < videoList.length; v++) {
                    const videoData = videoList[v];
                    let videoUrl = videoData?.reelUrl || videoData?.url || '';
                    if (!videoUrl || typeof videoUrl !== 'string') continue;

                    const videoName = `${postId}_video_${v + 1}.mp4`;
                    const videoPath = `/uploads/ai-scan/${groupFolder}/${postId}/${videoName}`;

                    try {
                        console.log(`[Crawl] Downloading video ${v + 1}: ${videoUrl.substring(0, 80)}...`);
                        const savedPath = await videoDownloadQueue.add(
                            () => downloadGroupVideo(videoUrl, postDir, videoName, cookies),
                            `${postId}_video_${v + 1}`
                        );

                        if (savedPath) {
                            let finalVideoPath = videoPath;
                            if (!savedPath.startsWith('/uploads/')) {
                                const normalized = savedPath.replace(/\\/g, '/');
                                const uploadsIdx = normalized.indexOf('/uploads/');
                                if (uploadsIdx >= 0) finalVideoPath = normalized.substring(uploadsIdx);
                            }
                            localVideos.push(finalVideoPath);
                            console.log(`[Crawl] ✓ Video ${v + 1}: ${finalVideoPath}`);
                        } else {
                            console.log(`[Crawl] ✗ Video ${v + 1} failed`);
                        }
                    } catch (e) {
                        console.error(`[Crawl] ✗ Video ${v + 1} error:`, e.message);
                    }
                }
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
                postVideos: localVideos,
                postAuthor: author,
                postPublishedAt: publishedAt,
                aiAnalyzed: false,
                isMatching: true,
                scannedAt: new Date()
            });
            saved++;
            console.log(`[Crawl] ✓ Saved: ${postId} (${(content || '').substring(0, 50)}...) [${localImages.length} images, ${localVideos.length} videos]`);
        } catch (e) {
            errors++;
            console.error(`[Crawl] ✗ Error saving post:`, e.message);
        }
    }
    console.log(`[Crawl] Summary: ${saved} saved, ${skipped} skipped, ${errors} errors | Group: ${groupUrl}`);
    return saved;
}

module.exports = {
    crawlGroupPosts,
    downloadImageToLocal,
    savePostsToDb
};