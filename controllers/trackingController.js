// controllers/trackingController.js - Theo dõi đối tượng Facebook
const Tracking = require('../models/Tracking');
const TrackingPost = require('../models/TrackingPost');
const Channel = require('../models/Channel');
const { scrapeProfilePosts } = require('../services/facebookProfileScraper');
const path = require('path');

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

        res.status(201).json({ success: true, message: 'Đã thêm đối tượng theo dõi thành công!', data: tracking });
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
            { new: true }
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
        const tracking = await Tracking.findOne({ _id: req.params.id, userId });
        if (!tracking) return res.status(404).json({ success: false, message: 'Không tìm thấy đối tượng' });

        // Lấy cookies từ channel
        const channel = await Channel.findById(tracking.sourceAccountId);
        if (!channel) return res.status(400).json({ success: false, message: 'Chưa liên kết tài khoản Facebook' });

        // Parse profile ID từ URL
        const url = tracking.url;
        let profileId = '';
        const idMatch = url.match(/profile\.php\?id=(\d+)/);
        if (idMatch) profileId = idMatch[1];
        else {
            const userMatch = url.match(/facebook\.com\/([a-zA-Z0-9.]+)\/?/);
            if (userMatch) profileId = userMatch[1];
        }
        if (!profileId) return res.status(400).json({ success: false, message: 'Không parse được profile ID từ URL' });

        // Lấy cookies từ storage state
        const fs = require('fs');
        let cookies = {};
        let fbDtsg = '';
        if (channel.storageStatePath && fs.existsSync(channel.storageStatePath)) {
            try {
                const state = JSON.parse(fs.readFileSync(channel.storageStatePath, 'utf8'));
                for (const c of (state.cookies || [])) {
                    cookies[c.name] = c.value;
                    if (c.name === 'fb_dtsg') fbDtsg = c.value;
                }
            } catch (e) { console.error('[Tracking] Lỗi đọc cookies:', e.message); }
        }

        if (!cookies.c_user) return res.status(400).json({ success: false, message: 'Tài khoản Facebook chưa đăng nhập' });

        const saveDir = path.join(global.USER_DATA_DIR || __dirname, '..', 'uploads', 'tracking');

        // Scrape
        const posts = await scrapeProfilePosts({
            profileId, cookies, fbDtsg,
            limit: parseInt(req.body.limit) || 10,
            saveDir,
        });

        // Lưu vào DB
        let saved = 0;
        for (const post of posts) {
            try {
                await TrackingPost.findOneAndUpdate(
                    { trackingId: tracking._id, postId: post.postId },
                    { userId, trackingId: tracking._id, postId: post.postId, text: post.text, permalink: post.permalink, commentCount: post.commentCount, authorName: post.authorName, images: post.images, scrapedAt: new Date() },
                    { upsert: true, new: true }
                );
                saved++;
            } catch (e) {
                if (e.code !== 11000) console.error('[Tracking] Lỗi lưu post:', e.message);
            }
        }

        // Cập nhật stats
        await Tracking.findByIdAndUpdate(tracking._id, {
            'stats.totalPosts': await TrackingPost.countDocuments({ trackingId: tracking._id }),
            'stats.lastChecked': new Date(),
        });

        res.json({ success: true, message: `Đã scrape ${saved} bài viết`, data: { scraped: posts.length, saved } });
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
                .sort({ scrapedAt: -1 })
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