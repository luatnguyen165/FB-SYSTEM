// controllers/trackingController.js - Theo dõi đối tượng Facebook
const Tracking = require('../models/Tracking');
const TrackingPost = require('../models/TrackingPost');
const Channel = require('../models/Channel');
const { scrapeProfilePosts, imageDownloadQueue } = require('../services/facebookProfileScraper');
const { scrapeGroupPosts, downloadGroupVideo, videoDownloadQueue } = require('../services/facebookGroupScraper');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

/**
 * Parse Facebook ID từ URL (profile, page, group)
 * Hỗ trợ: profile.php?id=, /username/, /pages/Page-Name/123456, /groups/123456/
 */
function parseFacebookId(url) {
    if (!url) return '';
    // profile.php?id=123456
    const idMatch = url.match(/profile\.php\?id=(\d+)/);
    if (idMatch) return idMatch[1];
    // /pages/Page-Name/123456
    const pageMatch = url.match(/\/pages\/[^/]+\/(\d+)/);
    if (pageMatch) return pageMatch[1];
    // /groups/123456/ hoặc /groups/123456
    const groupMatch = url.match(/\/groups\/(\d+)/);
    if (groupMatch) return groupMatch[1];
    // /groups/groupname/ (group name-based URL)
    const groupNameMatch = url.match(/\/groups\/([a-zA-Z0-9._-]+)\/?$/);
    if (groupNameMatch && !groupNameMatch[1].match(/^\d+$/)) return groupNameMatch[1];
    // /username/ hoặc /pagename/
    const userMatch = url.match(/facebook\.com\/([a-zA-Z0-9.]+)\/?/);
    if (userMatch) return userMatch[1];
    return '';
}

// GET /tracking - Trang chính theo dõi
exports.showTracking = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        if (!userId) return res.redirect('/auth/login');

        const filter = { userId };
        const trackingType = req.query.type || 'profile';

        // Query cả data cũ (không có field type) và data mới
        if (trackingType === 'profile') {
            filter.$or = [{ type: 'profile' }, { type: { $exists: false } }];
        } else {
            filter.type = trackingType;
        }

        // Filter by platform tab if specified
        if (req.query.platform) {
            filter.sourcePlatform = req.query.platform;
        }

        const trackings = await Tracking.find(filter)
            .populate('sourceAccountId', 'accountName platform accountType')
            .populate('targetPlatforms.accountId', 'accountName platform')
            .sort({ createdAt: -1 })
            .lean();

        // Lấy danh sách tài khoản channels để chọn trong modal
        const channels = await Channel.find({ userId, isEnabled: true })
            .select('accountName platform accountType')
            .sort('platform')
            .lean();

        // Thống kê nhanh theo type
        const stats = {
            total: await Tracking.countDocuments({ userId, type: trackingType }),
            facebook: await Tracking.countDocuments({ userId, type: trackingType, sourcePlatform: 'facebook' }),
            active: await Tracking.countDocuments({ userId, type: trackingType, isActive: true })
        };

        // currentPage cho sidebar active
        const pageMap = { profile: 'tracking-profile', page: 'tracking-page', group: 'tracking-group' };
        const currentPage = pageMap[trackingType] || 'tracking-profile';

        res.render('tracking', {
            currentPage,
            trackings,
            channels,
            stats,
            trackingType,
            activePlatform: req.query.platform || 'all',
            features: res.locals.features || {},
            user: req.session.user || req.user || null,
            flash: req.flash ? { success: req.flash('success'), error: req.flash('error') } : null,
            t: (key) => key
        });
    } catch (err) {
        console.error('[Tracking] Error loading page:', err.message);
        req.flash('error', 'Lỗi tải trang theo dõi: ' + err.message);
        res.redirect('/dashboard');
    }
};

// POST /tracking/api/create - Thêm đối tượng theo dõi mới
exports.createTracking = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        const { name, url, sourcePlatform, sourceAccountId, targetPlatforms, cookiesPath, type } = req.body;

        if (!name || !url || !sourcePlatform) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ: tên, URL, nền tảng' });
        }

        // Validate type
        const trackingType = ['profile', 'page', 'group'].includes(type) ? type : 'profile';

        // Parse targetPlatforms từ JSON string nếu gửi từ form
        let parsedTargets = [];
        if (targetPlatforms) {
            try {
                parsedTargets = typeof targetPlatforms === 'string' ? JSON.parse(targetPlatforms) : targetPlatforms;
            } catch (e) {
                parsedTargets = [];
            }
        }

        const tracking = new Tracking({
            userId,
            name,
            url,
            type: trackingType,
            sourcePlatform,
            sourceAccountId: sourceAccountId || undefined,
            targetPlatforms: parsedTargets,
            cookiesPath: cookiesPath || ''
        });

        await tracking.save();

        // Auto-scrape bài viết sau khi tạo
        let scrapeResult = { scraped: 0 };
        try {
            console.log(`[Tracking] Auto-scrape: trackingId=${tracking._id}, sourceAccountId=${tracking.sourceAccountId}`);
            const channel = await Channel.findById(tracking.sourceAccountId);
            console.log(`[Tracking] Auto-scrape: channel=${channel ? channel.accountName : 'null'}, storageStatePath=${channel?.storageStatePath || 'null'}`);

            if (channel) {
                let cookies = {};
                let fbDtsg = '';
                if (channel.storageStatePath && fs.existsSync(channel.storageStatePath)) {
                    const state = JSON.parse(fs.readFileSync(channel.storageStatePath, 'utf8'));
                    for (const c of (state.cookies || [])) {
                        cookies[c.name] = c.value;
                        if (c.name === 'fb_dtsg') fbDtsg = c.value;
                    }
                    console.log(`[Tracking] Auto-scrape: loaded ${Object.keys(cookies).length} cookies, c_user=${cookies.c_user || 'null'}, fb_dtsg=${fbDtsg ? 'yes' : 'no'}`);
                } else {
                    console.log(`[Tracking] Auto-scrape: storageStatePath not found or doesn't exist`);
                }

                if (cookies.c_user) {
                    // Parse ID từ URL (profile hoặc page)
                    let profileId = parseFacebookId(url);
                    console.log(`[Tracking] Auto-scrape: parsed profileId="${profileId}" from url="${url}"`);

                    if (profileId) {
                        const saveDir = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'scraper');
                        console.log(`[Tracking] Auto-scrape: starting scrape, saveDir=${saveDir}`);
                        const posts = await scrapeProfilePosts({ profileId, cookies, fbDtsg, limit: 10, saveDir });
                        console.log(`[Tracking] Auto-scrape: scraped ${posts.length} posts`);

                        let saved = 0;
                        for (const post of posts) {
                            try {
                                // Download images
                                const downloadedImages = [];
                                const postDir = path.join(saveDir, String(post.postId));
                                fs.mkdirSync(postDir, { recursive: true });

                                for (let i = 0; i < (post.images || []).length; i++) {
                                    const imgUrl = post.images[i];
                                    try {
                                        const ext = imgUrl.toLowerCase().includes('.png') ? '.png' : imgUrl.toLowerCase().includes('.webp') ? '.webp' : '.jpg';
                                        const filename = `${post.postId}_${i + 1}${ext}`;
                                        const filepath = path.join(postDir, filename);
                                        const r = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 });
                                        fs.writeFileSync(filepath, r.data);
                                        downloadedImages.push(`/uploads/scraper/${post.postId}/${filename}`);
                                    } catch (e) { console.error('[Download] Failed:', e.message); }
                                }

                                // Videos đã download sẵn từ scraper
                                const downloadedVideos = (post.videos || []).map(v => {
                                    if (!v) return null;
                                    if (v.startsWith('/uploads/')) return v;
                                    // Convert absolute path → relative URL
                                    const normalized = v.replace(/\\/g, '/');
                                    const idx = normalized.indexOf('/uploads/');
                                    return idx >= 0 ? normalized.substring(idx) : null;
                                }).filter(Boolean);

                                await TrackingPost.findOneAndUpdate(
                                    { trackingId: tracking._id, postId: post.postId },
                                    { userId, trackingId: tracking._id, postId: post.postId, text: post.text, permalink: post.permalink, commentCount: post.commentCount, authorName: post.authorName, images: downloadedImages, videos: downloadedVideos, publishedAt: post.publishedAt, publishedAtText: post.publishedAtText || '', scrapedAt: new Date() },
                                    { upsert: true, returnDocument: "after" }
                                );
                                saved++;
                            } catch (e) { if (e.code !== 11000) console.error('[Tracking] Save post error:', e.message); }
                        }

                        await Tracking.findByIdAndUpdate(tracking._id, {
                            'stats.totalPosts': saved,
                            'stats.lastChecked': new Date(),
                        });

                        scrapeResult = { scraped: saved };
                    }
                }
            }
        } catch (e) {
            console.error('[Tracking] Auto-scrape error:', e.message);
        }

        res.status(201).json({
            success: true,
            message: scrapeResult.scraped > 0
                ? `Đã thêm và scrape ${scrapeResult.scraped} bài viết!`
                : 'Đã thêm đối tượng. Nhấn nút 📥 để scrape bài viết.',
            data: tracking,
            scraped: scrapeResult.scraped
        });
    } catch (err) {
        console.error('[Tracking] Create error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi tạo theo dõi: ' + err.message });
    }
};

// PUT /tracking/api/update/:id - Cập nhật đối tượng theo dõi
exports.updateTracking = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { id } = req.params;

        const updateData = {};
        const allowedFields = ['name', 'url', 'sourceAccountId', 'targetPlatforms', 'cookiesPath', 'isActive'];
        
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                if (field === 'targetPlatforms') {
                    try {
                        updateData[field] = typeof req.body[field] === 'string' ? JSON.parse(req.body[field]) : req.body[field];
                    } catch (e) {
                        updateData[field] = [];
                    }
                } else {
                    updateData[field] = req.body[field];
                }
            }
        });

        const tracking = await Tracking.findOneAndUpdate(
            { _id: id, userId },
            { $set: updateData },
            { returnDocument: "after" }
        );

        if (!tracking) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối tượng theo dõi' });
        }

        res.json({ success: true, message: 'Đã cập nhật thành công!', data: tracking });
    } catch (err) {
        console.error('[Tracking] Update error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi cập nhật: ' + err.message });
    }
};

// DELETE /tracking/api/delete/:id - Xóa đối tượng theo dõi
exports.deleteTracking = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { id } = req.params;

        const tracking = await Tracking.findOneAndDelete({ _id: id, userId });
        if (!tracking) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối tượng theo dõi' });
        }

        res.json({ success: true, message: 'Đã xóa đối tượng theo dõi!' });
    } catch (err) {
        console.error('[Tracking] Delete error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi xóa: ' + err.message });
    }
};

// POST /tracking/api/toggle/:id - Bật/tắt theo dõi
exports.toggleTracking = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { id } = req.params;

        const tracking = await Tracking.findOne({ _id: id, userId });
        if (!tracking) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối tượng theo dõi' });
        }

        tracking.isActive = !tracking.isActive;
        await tracking.save();

        res.json({ success: true, message: tracking.isActive ? 'Đã bật theo dõi' : 'Đã tạm dừng theo dõi', data: tracking });
    } catch (err) {
        console.error('[Tracking] Toggle error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi chuyển trạng thái: ' + err.message });
    }
};

// GET /tracking/api/list - API lấy danh sách theo dõi (JSON)
exports.listTrackingAPI = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const filter = { userId };
        if (req.query.platform) filter.sourcePlatform = req.query.platform;
        if (req.query.active === 'true') filter.isActive = true;

        const trackings = await Tracking.find(filter)
            .populate('sourceAccountId', 'accountName platform accountType')
            .populate('targetPlatforms.accountId', 'accountName platform')
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, data: trackings });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// GET /tracking/api/channels - API lấy channels theo platform
exports.getChannelsByPlatform = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { platform } = req.query;
        
        const filter = { userId, isEnabled: true };
        if (platform) filter.platform = platform.toUpperCase();

        const channels = await Channel.find(filter)
            .select('accountName platform accountType')
            .sort('accountName')
            .lean();

        res.json({ success: true, data: channels });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// POST /tracking/api/scrape/:id - Scrape bài viết từ đối tượng
exports.scrapeTracking = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        console.log(`[Scrape] Bắt đầu: userId=${userId}, trackingId=${req.params.id}`);

        const tracking = await Tracking.findOne({ _id: req.params.id, userId });
        if (!tracking) {
            console.log(`[Scrape] Không tìm thấy tracking`);
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối tượng' });
        }
        console.log(`[Scrape] Tracking: name=${tracking.name}, url=${tracking.url}, sourceAccountId=${tracking.sourceAccountId}`);

        // Lấy cookies từ channel
        const channel = await Channel.findById(tracking.sourceAccountId);
        if (!channel) {
            console.log(`[Scrape] Không tìm thấy channel`);
            return res.status(400).json({ success: false, message: 'Chưa liên kết tài khoản Facebook' });
        }
        console.log(`[Scrape] Channel: ${channel.accountName}, storageStatePath=${channel.storageStatePath || 'null'}`);

        // Parse ID từ URL (profile, page, hoặc group)
        const url = tracking.url;
        const trackingType = tracking.type || 'profile';
        const targetId = parseFacebookId(url);
        console.log(`[Scrape] Parsed targetId="${targetId}" from url="${url}", type="${trackingType}"`);
        if (!targetId) return res.status(400).json({ success: false, message: 'Không parse được ID từ URL' });

        // Lấy cookies từ storage state
        let cookies = {};
        let fbDtsg = '';
        if (channel.storageStatePath && fs.existsSync(channel.storageStatePath)) {
            try {
                const state = JSON.parse(fs.readFileSync(channel.storageStatePath, 'utf8'));
                for (const c of (state.cookies || [])) {
                    cookies[c.name] = c.value;
                    if (c.name === 'fb_dtsg') fbDtsg = c.value;
                }
                console.log(`[Scrape] Loaded ${Object.keys(cookies).length} cookies, c_user=${cookies.c_user || 'null'}`);
            } catch (e) { console.error('[Scrape] Lỗi đọc cookies:', e.message); }
        } else {
            console.log(`[Scrape] storageStatePath không tồn tại: ${channel.storageStatePath}`);
        }

        if (!cookies.c_user) {
            console.log(`[Scrape] Không có c_user cookie`);
            return res.status(400).json({ success: false, message: 'Tài khoản Facebook chưa đăng nhập' });
        }

        const saveDir = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'scraper');
        console.log(`[Scrape] Bắt đầu scrape, saveDir=${saveDir}`);

        // Lấy số lượng bài viết cần scrape (ưu tiên body, sau đó settings)
        const scrapeLimit = parseInt(req.body.limit) || tracking.scrapeSettings?.limit || 10;

        // Lấy danh sách postId đã scrape rồi để skip
        const existingPosts = await TrackingPost.find({ trackingId: tracking._id }).select('postId').lean();
        const existingPostIds = new Set(existingPosts.map(p => p.postId));
        console.log(`[Scrape] Đã có ${existingPostIds.size} bài viết cũ, sẽ skip`);

        // Scrape theo type
        let posts = [];
        if (trackingType === 'group') {
            posts = await scrapeGroupPosts({
                groupId: targetId, cookies, fbDtsg,
                limit: scrapeLimit + existingPostIds.size,
                saveDir,
            });
        } else {
            posts = await scrapeProfilePosts({
                profileId: targetId, cookies, fbDtsg,
                limit: scrapeLimit + existingPostIds.size,
                saveDir,
            });
        }
        console.log(`[Scrape] Scrape xong: ${posts.length} posts`);

        // Filter bỏ bài đã scrape rồi VÀ bỏ bài không có ảnh/video/nội dung
        const newPosts = posts.filter(p => {
            if (existingPostIds.has(p.postId)) return false;
            const hasImages = p.images && p.images.length > 0;
            const hasVideos = p.videos && p.videos.length > 0;
            const hasText = p.text && p.text.trim().length > 0;
            return hasImages || hasVideos || hasText;
        }).sort((a, b) => {
            // Group: bài mới scrape lên đầu (theo scrapedAt), Profile/Page: mới nhất lên đầu
            if (trackingType === 'group') {
                const scrapedA = a.scrapedAt ? new Date(a.scrapedAt).getTime() : 0;
                const scrapedB = b.scrapedAt ? new Date(b.scrapedAt).getTime() : 0;
                return scrapedB - scrapedA;
            }
            const dateA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const dateB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            return dateB - dateA;
        });
        console.log(`[Scrape] Còn ${newPosts.length} bài mới (đã filter bỏ bài trống, sort mới nhất)`);

        // Lấy Socket.IO instance
        const io = req.app.get('io');
        const trackingId = tracking._id;

        // Emit开始 scrape
        if (io) {
            io.to(`tracking:${trackingId}`).emit('scrape:start', {
                trackingId,
                total: newPosts.length,
                message: `Bắt đầu scrape ${newPosts.length} bài viết...`
            });
        }

        // Download images trước khi lưu DB
        let saved = 0;
        let skipped = 0;
        let filtered = posts.length - newPosts.length - existingPostIds.size;

        for (let i = 0; i < newPosts.length; i++) {
            const post = newPosts[i];

            // Emit progress
            if (io) {
                io.to(`tracking:${trackingId}`).emit('scrape:progress', {
                    trackingId,
                    current: i + 1,
                    total: newPosts.length,
                    postId: post.postId,
                    text: (post.text || '').substring(0, 50)
                });
            }

            try {
                const downloadedImages = [];
                const downloadedVideos = [];
                const postDir = path.join(saveDir, String(post.postId));
                fs.mkdirSync(postDir, { recursive: true });

                // Download images
                for (let j = 0; j < (post.images || []).length; j++) {
                    const imgUrl = post.images[j];
                    if (imgUrl && imgUrl.startsWith('/uploads/')) {
                        downloadedImages.push(imgUrl);
                        continue;
                    }
                    if (!imgUrl || !imgUrl.startsWith('http')) continue;
                    try {
                        const ext = imgUrl.toLowerCase().includes('.png') ? '.png' : imgUrl.toLowerCase().includes('.webp') ? '.webp' : '.jpg';
                        const filename = `${post.postId}_${j + 1}${ext}`;
                        const filepath = path.join(postDir, filename);
                        const r = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 });
                        fs.writeFileSync(filepath, r.data);
                        downloadedImages.push(`/uploads/scraper/${post.postId}/${filename}`);
                        console.log(`[Download] Saved: ${filename} (${r.data.length} bytes)`);
                    } catch (e) {
                        console.error(`[Download] Failed: ${e.message}`);
                    }
                }

                // Download videos (dùng queue để đảm bảo hoàn thành trước khi lưu DB)
                if (trackingType === 'group') {
                    const groupId = tracking.url?.match(/groups\/(\d+)/)?.[1] || '';
                    const postPermalink = post.permalink || `https://www.facebook.com/groups/${groupId}/posts/${post.postId}/`;

                    for (let v = 0; v < (post.videos || []).length; v++) {
                        const videoData = post.videos[v];
                        let videoUrl = videoData?.reelUrl || videoData?.url || postPermalink;
                        if (!videoUrl || typeof videoUrl !== 'string') continue;

                        const videoName = `${post.postId}_video_${v + 1}.mp4`;
                        const videoPath = `/uploads/scraper/${post.postId}/${videoName}`;
                        const videoIndex = v + 1;

                        console.log(`[Download] Video ${videoIndex}: ${videoUrl.substring(0, 80)}...`);
                        const savedPath = await videoDownloadQueue.add(
                            () => downloadGroupVideo(videoUrl, postDir, videoName, cookies),
                            `${post.postId}_video_${videoIndex}`
                        );

                        if (savedPath) {
                            let finalVideoPath = videoPath;
                            if (!savedPath.startsWith('/uploads/')) {
                                const normalized = savedPath.replace(/\\/g, '/');
                                const uploadsIdx = normalized.indexOf('/uploads/');
                                if (uploadsIdx >= 0) finalVideoPath = normalized.substring(uploadsIdx);
                            }
                            downloadedVideos.push(finalVideoPath);
                            console.log(`[Download] ✓ Video ${videoIndex}: ${finalVideoPath}`);
                        } else {
                            console.log(`[Download] ✗ Video ${videoIndex} thất bại`);
                        }
                    }
                } else {
                    // Profile/Page: video đã download sẵn từ scraper
                    for (let v = 0; v < (post.videos || []).length; v++) {
                        const videoUrl = post.videos[v];
                        if (!videoUrl) continue;

                        // Đã download rồi → dùng luôn
                        if (videoUrl.startsWith('/uploads/')) {
                            downloadedVideos.push(videoUrl);
                            continue;
                        }

                        // Chưa download → dùng facebook.py fallback
                        if (videoUrl.startsWith('http')) {
                            const videoName = `${post.postId}_video_${v + 1}.mp4`;
                            console.log(`[Download] Fallback video ${v + 1}: ${videoUrl.substring(0, 80)}...`);
                            const savedPath = await videoDownloadQueue.add(
                                () => downloadGroupVideo(videoUrl, postDir, videoName),
                                `${post.postId}_video_${v + 1}`
                            );
                            if (savedPath) {
                                let finalPath = `/uploads/scraper/${post.postId}/${videoName}`;
                                if (!savedPath.startsWith('/uploads/')) {
                                    const normalized = savedPath.replace(/\\/g, '/');
                                    const idx = normalized.indexOf('/uploads/');
                                    if (idx >= 0) finalPath = normalized.substring(idx);
                                }
                                downloadedVideos.push(finalPath);
                                console.log(`[Download] ✓ Fallback video ${v + 1}: ${finalPath}`);
                            }
                        }
                    }
                }

                const newPost = await TrackingPost.findOneAndUpdate(
                    { trackingId: tracking._id, postId: post.postId },
                    { userId, trackingId: tracking._id, postId: post.postId, text: post.text, permalink: post.permalink, commentCount: post.commentCount, authorName: post.authorName, images: downloadedImages, videos: downloadedVideos, publishedAt: post.publishedAt, publishedAtText: post.publishedAtText || '', scrapedAt: new Date() },
                    { upsert: true, returnDocument: "after" }
                );
                saved++;

                // Emit新 post saved
                if (io) {
                    io.to(`tracking:${trackingId}`).emit('scrape:newpost', {
                        trackingId,
                        post: {
                            _id: newPost._id,
                            postId: newPost.postId,
                            text: newPost.text,
                            images: newPost.images,
                            videos: newPost.videos,
                            permalink: newPost.permalink,
                            publishedAtText: newPost.publishedAtText,
                            scrapedAt: newPost.scrapedAt
                        },
                        saved,
                        total: newPosts.length
                    });
                }
            } catch (e) {
                if (e.code !== 11000) console.error('[Tracking] Lỗi lưu post:', e.message);
            }
        }

        skipped = existingPostIds.size;

        // Cập nhật stats
        const totalPosts = await TrackingPost.countDocuments({ trackingId: tracking._id });
        await Tracking.findByIdAndUpdate(tracking._id, {
            'stats.totalPosts': totalPosts,
            'stats.lastChecked': new Date(),
        });

        // Emit完 thàng
        if (io) {
            io.to(`tracking:${trackingId}`).emit('scrape:done', {
                trackingId,
                saved,
                skipped,
                filtered,
                totalPosts,
                message: saved > 0
                    ? `Đã scrape ${saved} bài viết mới`
                    : `Không có bài viết mới`
            });
        }

        const message = saved > 0
            ? `Đã scrape ${saved} bài viết mới${skipped > 0 ? ` (bỏ qua ${skipped} bài cũ)` : ''}${filtered > 0 ? ` (loại bỏ ${filtered} bài trống)` : ''}`
            : `Không có bài viết mới${skipped > 0 ? ` (đã có ${skipped} bài)` : ''}`;

        res.json({ success: true, message, data: { scraped: posts.length, saved, skipped, filtered, newPosts: newPosts.length, totalPosts } });
    } catch (err) {
        console.error('[Tracking] Scrape error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi scrape: ' + err.message });
    }
};

// GET /tracking/api/posts/:trackingId - Lấy danh sách bài viết
exports.getTrackingPosts = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [posts, total] = await Promise.all([
            TrackingPost.find({ userId, trackingId: req.params.trackingId })
                .sort({ publishedAt: -1, scrapedAt: -1 })
                .skip(skip).limit(parseInt(limit)).lean(),
            TrackingPost.countDocuments({ userId, trackingId: req.params.trackingId }),
        ]);

        res.json({ success: true, posts, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// DELETE /tracking/api/posts/:id - Xóa bài viết
exports.deleteTrackingPost = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const post = await TrackingPost.findOneAndDelete({ _id: req.params.id, userId });
        if (!post) return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// PUT /tracking/api/posts/:id - Cập nhật bài viết
exports.updateTrackingPost = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { text } = req.body;
        const post = await TrackingPost.findOneAndUpdate(
            { _id: req.params.id, userId },
            { $set: { text: text || '' } },
            { returnDocument: "after" }
        );
        if (!post) return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        res.json({ success: true, data: post });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// PUT /tracking/api/schedule/:id - Cài đặt lịch trình scrape
exports.updateSchedule = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { scheduleEnabled, intervalMinutes, scrapeLimit } = req.body;

        const tracking = await Tracking.findOne({ _id: req.params.id, userId });
        if (!tracking) return res.status(404).json({ success: false, message: 'Không tìm thấy đối tượng' });

        // Cập nhật cài đặt
        if (scrapeLimit !== undefined) {
            tracking.scrapeSettings.limit = parseInt(scrapeLimit) || 10;
        }

        if (scheduleEnabled !== undefined) {
            tracking.schedule.enabled = scheduleEnabled;
        }

        if (intervalMinutes !== undefined) {
            tracking.schedule.intervalMinutes = parseInt(intervalMinutes) || 60;
        }

        // Tính nextRun nếu bật lịch trình
        if (tracking.schedule.enabled) {
            tracking.schedule.nextRun = new Date(Date.now() + tracking.schedule.intervalMinutes * 60 * 1000);
        } else {
            tracking.schedule.nextRun = null;
        }

        await tracking.save();

        res.json({
            success: true,
            message: tracking.schedule.enabled
                ? `Đã bật lịch trình: mỗi ${tracking.schedule.intervalMinutes} phút`
                : 'Đã tắt lịch trình',
            data: {
                scrapeLimit: tracking.scrapeSettings.limit,
                schedule: tracking.schedule
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// GET /tracking/api/schedule/:id - Lấy cài đặt lịch trình
exports.getSchedule = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const tracking = await Tracking.findOne({ _id: req.params.id, userId }).select('scrapeSettings schedule').lean();
        if (!tracking) return res.status(404).json({ success: false, message: 'Không tìm thấy đối tượng' });

        res.json({
            success: true,
            data: {
                scrapeLimit: tracking.scrapeSettings?.limit || 10,
                schedule: tracking.schedule || { enabled: false, intervalMinutes: 60 }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// POST /tracking/api/fix-paths - Migration: fix absolute paths → relative URLs
exports.fixVideoPaths = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const posts = await TrackingPost.find({ userId, videos: { $exists: true, $ne: [] } }).lean();
        let fixed = 0;

        for (const post of posts) {
            const newVideos = post.videos.map(v => {
                if (!v) return v;
                // Convert absolute Windows path → relative URL
                if (v.includes('\\') || (v.includes(':') && v.includes('uploads'))) {
                    const normalized = v.replace(/\\/g, '/');
                    const idx = normalized.indexOf('/uploads/');
                    if (idx >= 0) return normalized.substring(idx);
                }
                return v;
            });

            const changed = newVideos.some((v, i) => v !== post.videos[i]);
            if (changed) {
                await TrackingPost.updateOne({ _id: post._id }, { $set: { videos: newVideos } });
                fixed++;
            }
        }

        res.json({ success: true, message: `Đã fix ${fixed}/${posts.length} bài viết`, fixed, total: posts.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};