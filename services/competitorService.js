// services/competitorService.js
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Competitor = require('../models/Competitor');
const CompetitorPost = require('../models/CompetitorPost');
const { extractUserIdFromUrl } = require('../utils/facebookUrlUtils');

class CompetitorService {
    /**
     * Lấy danh sách đối thủ
     */
    async getCompetitors(userId, filters = {}) {
        const query = { userId };
        if (filters.platform) query.platform = filters.platform;
        if (filters.isActive !== undefined) query.isActive = filters.isActive;
        if (filters.search) {
            query.$or = [
                { name: { $regex: filters.search, $options: 'i' } },
                { description: { $regex: filters.search, $options: 'i' } },
                { tags: { $in: [new RegExp(filters.search, 'i')] } }
            ];
        }
        return Competitor.find(query).sort({ createdAt: -1 });
    }

    /**
     * Lấy đối thủ theo ID
     */
    async getCompetitorById(competitorId, userId) {
        return Competitor.findOne({ _id: competitorId, userId }).lean();
    }

    /**
     * Thêm đối thủ mới
     */
    async createCompetitor(userId, data) {
        const competitor = new Competitor({
            userId,
            name: data.name,
            platform: data.platform || 'FB',
            channelId: data.channelId || null,
            postLimit: data.postLimit || 10,
            profileUrl: data.profileUrl,
            avatarUrl: data.avatarUrl || '',
            description: data.description || '',
            notes: data.notes || ''
        });
        await competitor.save();
        return competitor;
    }

    /**
     * Cập nhật đối thủ
     */
    async updateCompetitor(competitorId, userId, data) {
        const competitor = await Competitor.findOne({ _id: competitorId, userId });
        if (!competitor) return null;

        const allowedFields = ['name', 'platform', 'profileUrl', 'avatarUrl', 'description', 'followers', 'postsCount', 'isActive', 'tags', 'notes'];
        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                competitor[field] = data[field];
            }
        }

        // Theo dõi lịch sử followers
        if (data.followers !== undefined && data.followers !== competitor.followers) {
            competitor.followersHistory.push({ count: data.followers, date: new Date() });
            // Giữ tối đa 365 bản ghi
            if (competitor.followersHistory.length > 365) {
                competitor.followersHistory = competitor.followersHistory.slice(-365);
            }
        }

        competitor.lastCheckedAt = new Date();
        await competitor.save();
        return competitor;
    }

    /**
     * Xóa đối thủ
     */
    async deleteCompetitor(competitorId, userId) {
        const competitor = await Competitor.findOneAndDelete({ _id: competitorId, userId });
        if (competitor) {
            await CompetitorPost.deleteMany({ competitorId });
        }
        return competitor;
    }

    /**
     * Toggle active status
     */
    async toggleCompetitor(competitorId, userId) {
        const competitor = await Competitor.findOne({ _id: competitorId, userId });
        if (!competitor) return null;
        competitor.isActive = !competitor.isActive;
        await competitor.save();
        return competitor;
    }

    /**
     * Lấy bài viết của đối thủ
     */
    async getPosts(competitorId, userId, options = {}) {
        const query = { competitorId, userId };
        if (options.mediaType) query.mediaType = options.mediaType;
        if (options.sentiment) query.sentiment = options.sentiment;

        const page = options.page || 1;
        const limit = options.limit || 20;
        const skip = (page - 1) * limit;

        const [posts, total] = await Promise.all([
            CompetitorPost.find(query).sort({ postedAt: -1 }).skip(skip).limit(limit),
            CompetitorPost.countDocuments(query)
        ]);

        return { posts, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    /**
     * Lấy tất cả bài viết (không filter theo competitor)
     */
    async getAllPosts(userId, options = {}) {
        const query = { userId };
        if (options.mediaType) query.mediaType = options.mediaType;
        if (options.competitorId) query.competitorId = options.competitorId;

        const page = options.page || 1;
        const limit = options.limit || 50;
        const skip = (page - 1) * limit;

        const [posts, total] = await Promise.all([
            CompetitorPost.find(query).sort({ postedAt: -1 }).skip(skip).limit(limit).populate('competitorId', 'name platform avatarUrl'),
            CompetitorPost.countDocuments(query)
        ]);

        return { posts, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    /**
     * Thêm bài viết cho đối thủ
     */
    async addPost(competitorId, userId, data) {
        const post = new CompetitorPost({
            competitorId,
            userId,
            platform: data.platform,
            postUrl: data.postUrl || '',
            content: data.content || '',
            mediaType: data.mediaType || 'unknown',
            mediaUrl: data.mediaUrl || '',
            thumbnailUrl: data.thumbnailUrl || '',
            likes: data.likes || 0,
            comments: data.comments || 0,
            shares: data.shares || 0,
            views: data.views || 0,
            engagementRate: data.engagementRate || 0,
            postedAt: data.postedAt || new Date(),
            tags: data.tags || [],
            sentiment: data.sentiment || ''
        });
        await post.save();
        return post;
    }

    /**
     * Cập nhật bài viết
     */
    async updatePost(postId, userId, data) {
        const post = await CompetitorPost.findOne({ _id: postId, userId });
        if (!post) return null;

        const allowedFields = ['content', 'postUrl', 'mediaType', 'mediaUrl', 'media', 'likes', 'comments', 'shares', 'views', 'engagementRate', 'sentiment', 'postedAt', 'tags'];
        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                post[field] = data[field];
            }
        }
        await post.save();
        return post;
    }

    /**
     * Xóa bài viết
     */
    async deletePost(postId, userId) {
        return CompetitorPost.findOneAndDelete({ _id: postId, userId });
    }

    /**
     * Xóa nhiều bài viết
     */
    async deletePosts(postIds, userId) {
        return CompetitorPost.deleteMany({ _id: { $in: postIds }, userId });
    }

    /**
     * Thống kê tổng quan
     */
    async getStats(userId) {
        const [totalCompetitors, activeCompetitors, platformStats, postStats] = await Promise.all([
            Competitor.countDocuments({ userId }),
            Competitor.countDocuments({ userId, isActive: true }),
            Competitor.aggregate([
                { $match: { userId: mongoose.Types.ObjectId.createFromHexString(userId.toString()) } },
                { $group: { _id: '$platform', count: { $sum: 1 }, totalFollowers: { $sum: '$followers' } } }
            ]),
            CompetitorPost.aggregate([
                { $match: { userId: mongoose.Types.ObjectId.createFromHexString(userId.toString()) } },
                {
                    $group: {
                        _id: '$platform',
                        postCount: { $sum: 1 },
                        totalLikes: { $sum: '$likes' },
                        totalComments: { $sum: '$comments' },
                        totalShares: { $sum: '$shares' },
                        avgEngagement: { $avg: '$engagementRate' }
                    }
                }
            ])
        ]);

        return {
            totalCompetitors,
            activeCompetitors,
            platformStats: platformStats || [],
            postStats: postStats || []
        };
    }

    /**
     * Lấy top bài viết có tương tác cao nhất
     */
    async getTopPosts(userId, limit = 10) {
        return CompetitorPost.find({ userId })
            .sort({ engagementRate: -1 })
            .limit(limit)
            .populate('competitorId', 'name platform avatarUrl');
    }

    /**
     * So sánh đối thủ
     */
    async compareCompetitors(competitorIds, userId) {
        const competitors = await Competitor.find({
            _id: { $in: competitorIds },
            userId
        });

        const postStats = await CompetitorPost.aggregate([
            {
                $match: {
                    competitorId: { $in: competitorIds.map(id => mongoose.Types.ObjectId.createFromHexString(id.toString())) },
                    userId: mongoose.Types.ObjectId.createFromHexString(userId.toString())
                }
            },
            {
                $group: {
                    _id: '$competitorId',
                    totalPosts: { $sum: 1 },
                    totalLikes: { $sum: '$likes' },
                    totalComments: { $sum: '$comments' },
                    totalShares: { $sum: '$shares' },
                    avgEngagement: { $avg: '$engagementRate' }
                }
            }
        ]);

        return competitors.map(c => {
            const stats = postStats.find(s => s._id.toString() === c._id.toString());
            return {
                ...c.toObject(),
                postStats: stats || { totalPosts: 0, totalLikes: 0, totalComments: 0, totalShares: 0, avgEngagement: 0 }
            };
        });
    }

    /**
     * Lấy xu hướng followers theo thời gian
     */
    async getFollowerTrend(competitorId, userId, days = 30) {
        const competitor = await Competitor.findOne({ _id: competitorId, userId }).lean();
        if (!competitor) return null;

        const since = new Date();
        since.setDate(since.getDate() - days);

        const history = (competitor.followersHistory || [])
            .filter(h => h.date >= since)
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        return {
            competitorId: competitor._id,
            name: competitor.name,
            currentFollowers: competitor.followers || 0,
            history,
            days
        };
    }

    /**
     * Scrape bài viết từ page/profile đối thủ
     */
    async scrapeCompetitorPosts(userId, competitor) {
        const Channel = require('../models/Channel');
        const { getOrOpenFacebookContext } = require('../services/facebook/session');
        const { fetchPagePosts } = require('../services/facebookPageScraper');
        const SESSION_ROOT = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'social-sessions');

        console.log(`[Competitor Service] 🚀 scrapeCompetitorPosts started for: ${competitor.name} (userId=${userId})`);
        await Competitor.updateOne({ _id: competitor._id }, { $set: { scraping: true } });
        try {
            const channel = await Channel.findById(competitor.channelId).lean();
            console.log(`[Competitor Service] 📺 Channel:`, channel ? { name: channel.accountName, type: channel.accountType } : 'NOT FOUND');
            if (!channel) throw new Error('Kênh Facebook không tồn tại');

            // ===== PRE-CHECK: Kiểm tra session folder tồn tại =====
            const safeAccountName = String(channel.accountName)
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9\u0e01-\u0e59_-]+/gi, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '') || 'account';
            const sessionDir = path.join(SESSION_ROOT, String(userId), `${safeAccountName}-FB`);

            if (!fs.existsSync(sessionDir)) {
                await Competitor.updateOne({ _id: competitor._id }, { $set: { scraping: false } });
                throw new Error(`❌ Chưa có phiên đăng nhập cho kênh "${channel.accountName}". Vui lòng vào trang Kênh Facebook → đăng nhập trước khi scrape đối thủ.`);
            }

            console.log(`[Competitor Service] 🌐 Opening Playwright context to get cookies + fb_dtsg...`);
            const { context, sessionKey } = await getOrOpenFacebookContext(String(userId), channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: true });

            console.log(`[Competitor Service] ✅ Playwright context opened, sessionKey: ${sessionKey}`);
            console.log(`[Competitor Service] 🔍 PageId: ${channel.profileUrl}`);
            try {
                const pages = context.pages();
                const page = pages[0] || await context.newPage();
                console.log(`[Competitor Service] 🌍 Navigating to facebook.com...`);
                // Try multiple URLs to find one with fb_dtsg
                const targetUrls = [
                    'https://www.facebook.com/',
                    'https://www.facebook.com/me',
                    'https://www.facebook.com/settings',
                    'https://m.facebook.com/'
                ];
                let pageOk = false;
                for (const url of targetUrls) {
                    try {
                        console.log(`[Competitor Service]    → trying ${url}`);
                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
                        pageOk = true;
                        break;
                    } catch (navErr) {
                        console.log(`[Competitor Service]    ⚠️ ${url} failed: ${navErr.message.substring(0, 80)}`);
                    }
                }
                if (!pageOk) console.log(`[Competitor Service] ⚠️ All navigations failed, continuing anyway...`);
                // Wait for JS to render fb_dtsg - Facebook needs more time
                await page.waitForTimeout(8000);
                // Try to wait for the page to be ready
                try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch(e) { }
                const cookies = await context.cookies('https://www.facebook.com');
                const cookieObj = {};
                for (const c of cookies) cookieObj[c.name] = c.value;
                console.log(`[Competitor Service] 🍪 Total cookies: ${cookies.length}, c_user: ${cookieObj.c_user || 'MISSING'}, xs: ${cookieObj.xs ? 'YES' : 'MISSING'}`);
                let fbDtsg = '';
                try {
                    console.log(`[Competitor Service] 🔍 Extracting fb_dtsg from page...`);
                    fbDtsg = await page.evaluate(() => {
                        // Method 1: input[name="fb_dtsg"]
                        const input = document.querySelector('input[name="fb_dtsg"]');
                        if (input && input.value) {
                            window.__fbDtsgMethod = 'input[name=fb_dtsg]';
                            return input.value;
                        }
                        // Method 2: all inputs named fb_dtsg
                        const allInputs = document.querySelectorAll('input[name]');
                        for (const inp of allInputs) {
                            if (inp.name === 'fb_dtsg' && inp.value) {
                                window.__fbDtsgMethod = 'input[name=fb_dtsg]';
                                return inp.value;
                            }
                        }
                        // Method 3: regex on HTML for "fb_dtsg":"..."
                        const html = document.documentElement.innerHTML || '';
                        let m = html.match(/"fb_dtsg"\s*:\s*"([^"]+)"/);
                        if (m && m[1]) {
                            window.__fbDtsgMethod = 'regex:fb_dtsg';
                            return m[1];
                        }
                        // Method 4: DTSGInitialData
                        m = html.match(/DTSGInitialData[^"]*?"value"\s*:\s*"([^"]+)"/);
                        if (m && m[1]) {
                            window.__fbDtsgMethod = 'regex:DTSGInitialData';
                            return m[1];
                        }
                        // Method 5: require("DTSGInitialData") or require("DTSGSharedData")
                        m = html.match(/require\("DTSGInitialData"\)\s*\)\s*\.then\(function\s*\(\s*a\s*\)\s*\{\s*a\s*\(\s*\{[^}]*"token"\s*:\s*"([^"]+)"/);
                        if (m && m[1]) {
                            window.__fbDtsgMethod = 'require:DTSGInitialData';
                            return m[1];
                        }
                        // Method 6: window.__INITIAL_DATA__
                        try {
                            if (typeof window.__INITIAL_DATA__ !== 'undefined') {
                                const s = JSON.stringify(window.__INITIAL_DATA__);
                                m = s.match(/"fb_dtsg"\s*:\s*"([^"]+)"/);
                                if (m && m[1]) return m[1];
                            }
                        } catch (e) { }
                        // Method 7: script tags with various patterns
                        const scripts = document.querySelectorAll('script');
                        for (const script of scripts) {
                            const txt = script.textContent || '';
                            m = txt.match(/"fb_dtsg"\s*:\s*"([^"]+)"/);
                            if (m && m[1]) {
                                window.__fbDtsgMethod = 'script-tag';
                                return m[1];
                            }
                            m = txt.match(/DTSGInitialData[^"]*?"value"\s*:\s*"([^"]+)"/);
                            if (m && m[1]) {
                                window.__fbDtsgMethod = 'script-tag:DTSG';
                                return m[1];
                            }
                            // New pattern: token in async/deferred scripts
                            m = txt.match(/\["fb_dtsg","([^"]+)"\]/);
                            if (m && m[1]) {
                                window.__fbDtsgMethod = 'script-tag:array';
                                return m[1];
                            }
                        }
                        // Method 8: meta tags
                        const meta = document.querySelector('meta[property="al:android:url"][content*="fb_dtsg"]');
                        if (meta) {
                            const match = meta.content.match(/fb_dtsg[=:]([^&]+)/);
                            if (match && match[1]) return decodeURIComponent(match[1]);
                        }
                        return '';
                    });
                    console.log(`[Competitor Service]    fb_dtsg method: ${fbDtsg ? 'found' : 'not found'}`);
                } catch (e) {
                    console.log(`[Competitor Service] ⚠️ fb_dtsg extraction error:`, e.message);
                }

                // Fallback: Try fetching the token via the Facebook API endpoint
                if (!fbDtsg) {
                    try {
                        console.log(`[Competitor Service] 🔍 Trying API fallback for fb_dtsg...`);
                        const apiPage = await context.newPage();
                        await apiPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
                        await apiPage.waitForTimeout(3000);
                        // Try to get it from the JS runtime
                        fbDtsg = await apiPage.evaluate(() => {
                            try {
                                // Modern Facebook stores it in the require module system
                                if (typeof require === 'function') {
                                    try {
                                        const dtsg = require('DTSGInitialData');
                                        if (dtsg && dtsg.token) return dtsg.token;
                                    } catch(e) {}
                                    try {
                                        const dtsg = require('DTSGSharedData');
                                        if (dtsg && dtsg.token) return dtsg.token;
                                    } catch(e) {}
                                }
                                // Try __comet_ssr / __tier / etc
                                const metaEl = document.querySelector('meta[content*="fb_dtsg"]');
                                if (metaEl) return metaEl.getAttribute('content');
                            } catch(e) {}
                            return '';
                        }).catch(() => '');
                        await apiPage.close().catch(() => {});
                    } catch(e) {
                        console.log(`[Competitor Service] ⚠️ API fallback failed: ${e.message}`);
                    }
                }
                console.log(`[Competitor Service] 🔑 fb_dtsg: ${fbDtsg ? fbDtsg.substring(0, 20) + '... (len=' + fbDtsg.length + ')' : 'EMPTY ❌'}`);
                if (!fbDtsg) {
                    console.warn(`[Competitor Service] ⚠️  fbDtsg is empty — request will fail!`);
                }

                // ===== VALIDATION =====
                if (!cookieObj.c_user) {
                    await Competitor.updateOne({ _id: competitor._id }, { $set: { scraping: false } });
                    throw new Error(`❌ Không lấy được c_user cookie. Phiên đăng nhập của kênh "${channel.accountName}" đã hết hạn hoặc chưa đăng nhập. Vui lòng đăng nhập lại.`);
                }
                if (!fbDtsg) {
                    await Competitor.updateOne({ _id: competitor._id }, { $set: { scraping: false } });
                    throw new Error(`❌ Không lấy được fb_dtsg token. Vui lòng đăng nhập lại kênh "${channel.accountName}" để refresh token.`);
                }

                // ====== EXTRACT USER/PAGE ID FROM URL ======
                console.log(`[Competitor Service] 🎯 Extracting USER_ID from competitor URL: ${competitor.profileUrl}`);
                let profileId = null;
                try {
                    profileId = await extractUserIdFromUrl(competitor.profileUrl, { cookies: cookieObj });
                } catch (extractErr) {
                    console.warn(`[Competitor Service] ⚠️ extractUserIdFromUrl failed: ${extractErr.message}`);
                }
                // Fallback: simple regex if extractUserIdFromUrl returned null
                if (!profileId) {
                    profileId = competitor.profileUrl.match(/profile\.php\?id=(\d+)/)?.[1]
                        || competitor.profileUrl.match(/facebook\.com\/([^/?]+)/)?.[1]
                        || competitor.profileUrl;
                    console.log(`[Competitor Service] ⚠️ Using fallback regex extraction: ${profileId}`);
                }
                console.log(`[Competitor Service] ===============================================`);
                console.log(`[Competitor Service] 🎯 Extracted profileId from URL: ${competitor.profileUrl}`);
                console.log(`[Competitor Service]    → pageId (target)  = ${profileId}`);
                console.log(`[Competitor Service]    → c_user (account) = ${cookieObj.c_user || 'MISSING'}`);
                console.log(`[Competitor Service]    → limit            = ${competitor.postLimit || 10}`);
                console.log(`[Competitor Service] ===============================================`);

                // ====== CALL NODE.JS PAGE SCRAPER ======
                const fetchStartTs = Date.now();
                console.log(`[Competitor Service] 🟢 Calling Node.js facebookPageScraper with { pageId: ${profileId}, ... }...`);
                let posts = [];
                try {
                    posts = await fetchPagePosts({
                        pageId: profileId,
                        cookies: cookieObj,
                        fbDtsg: fbDtsg,
                        limit: competitor.postLimit || 10
                    });
                    console.log(`[Competitor Service] 📦 Got ${posts.length} posts from facebookPageScraper (in ${((Date.now() - fetchStartTs) / 1000).toFixed(1)}s)`);
                } catch (scrapeErr) {
                    console.error(`[Competitor Service] ❌ fetchPagePosts THREW after ${((Date.now() - fetchStartTs) / 1000).toFixed(1)}s:`, scrapeErr.message);
                    posts = [];
                }
                let savedCount = 0;
                // ====== DOWNLOAD IMAGES TO uploads/ ======
                        const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..');
                for (const post of posts) {
                    const postId = post.post_id || post.id || post.postId;
                    if (!postId) {
                        console.log(`[Competitor Service] ⏭️ Skip post without id`);
                        continue;
                    }
                    const existing = await CompetitorPost.findOne({ competitorId: competitor._id, postId }).lean();
                    if (existing) {
                        console.log(`[Competitor Service] ⏭️ Skip existing post: ${postId}`);
                        continue;
                    }

                    // Detect mediaType from media array
                    let mediaType = 'unknown';
                    const photos = (post.media || []).filter(m => m.type === 'photo');
                    const videos = (post.media || []).filter(m => m.type === 'video');
                    if (videos.length > 0) mediaType = 'video';
                    else if (photos.length > 0) mediaType = 'image';
                    else if (post.message || post.text || post.content) mediaType = 'text';

                    // Download images to uploads/competitor-posts/{postId}/
                    const localMedia = [];
                    const competitorPostDir = path.join(projectRoot, 'uploads', 'competitor-posts', String(postId));
                    fs.mkdirSync(competitorPostDir, { recursive: true });

                    for (let i = 0; i < photos.length; i++) {
                        const photo = photos[i];
                        const imgUrl = photo.url || '';
                        if (!imgUrl) continue;
                        let ext = '.jpg';
                        if (imgUrl.toLowerCase().includes('.png')) ext = '.png';
                        else if (imgUrl.toLowerCase().includes('.jpeg')) ext = '.jpeg';
                        const filename = i === 0 ? `${postId}${ext}` : `${postId}_${i + 1}${ext}`;
                        const filepath = path.join(competitorPostDir, filename);
                        const webUrl = `/uploads/competitor-posts/${postId}/${filename}`;

                        // Download if not already exists
                        if (!fs.existsSync(filepath)) {
                            try {
                                await new Promise((resolve, reject) => {
                                    const req = https.get(imgUrl, { timeout: 30000 }, (res) => {
                                        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
                                        const chunks = [];
                                        res.on('data', c => chunks.push(c));
                                        res.on('end', () => { fs.writeFileSync(filepath, Buffer.concat(chunks)); resolve(); });
                                        res.on('error', reject);
                                    });
                                    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
                                    req.on('error', reject);
                                });
                                console.log(`  📥 Downloaded: ${filename}`);
                            } catch (dlErr) {
                                console.warn(`  ⚠️ Failed to download image: ${dlErr.message}`);
                            }
                        }

                        localMedia.push({ type: 'photo', url: imgUrl, saved_as: webUrl });
                    }

                    // Add videos (keep original URLs, no local save)
                    for (const video of videos) {
                        localMedia.push({ type: 'video', url: video.url || '' });
                    }

                    // Set mediaUrl from first image or video
                    const firstMedia = localMedia[0];
                    const mediaUrl = firstMedia ? firstMedia.saved_as || firstMedia.url || '' : '';

                    // Use proper postedAt from GraphQL
                    var postedAt = post.posted_at || post.postedAt || new Date();
                    try { postedAt = new Date(postedAt); if (isNaN(postedAt.getTime())) postedAt = new Date(); } catch (e) { postedAt = new Date(); }

                    // Calculate engagement rate
                    const likes = post.likes || post.like_count || 0;
                    const comments = post.comment_count || post.comments || 0;
                    const shares = post.share_count || post.shares || 0;
                    const engagementRate = likes + comments + shares;

                    await CompetitorPost.create({
                        userId,
                        competitorId: competitor._id,
                        postId,
                        platform: competitor.platform,
                        content: post.message || post.text || post.content || '',
                        postUrl: post.postUrl || post.permalink || post.url || '',
                        mediaType,
                        mediaUrl,
                        media: localMedia,
                        likes,
                        comments,
                        shares,
                        engagementRate,
                        postedAt: postedAt,
                        scrapedAt: new Date()
                    });
                    savedCount++;
                    console.log(`[Competitor Service] 💾 Saved post: ${postId} (${mediaType}, ${localMedia.length} media)`);
                }

                console.log(`[Competitor Service] ✅ Scrape completed: ${savedCount}/${posts.length} new posts saved for ${competitor.name}`);
                await Competitor.updateOne({ _id: competitor._id }, { $set: { scraping: false, lastCheckedAt: new Date() } });
                return { saved: savedCount, total: posts.length };

            } catch (innerErr) {
                console.error(`[Competitor Service] ❌ Inner error:`, innerErr.message);
                await Competitor.updateOne({ _id: competitor._id }, { $set: { scraping: false } });
                throw innerErr;
            }

        } catch (err) {
            console.error(`[Competitor Service] ❌ scrapeCompetitorPosts failed:`, err.message);
            await Competitor.updateOne({ _id: competitor._id }, { $set: { scraping: false } });
            throw err;
        }
    }
}

module.exports = new CompetitorService();