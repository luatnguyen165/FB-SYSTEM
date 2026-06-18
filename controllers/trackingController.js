// controllers/trackingController.js - Theo dõi đối tượng Facebook & TikTok
const Tracking = require('../models/Tracking');
const Channel = require('../models/Channel');

// GET /tracking - Trang chính theo dõi
exports.showTracking = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        if (!userId) return res.redirect('/auth/login');

        const filter = { userId };
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

        // Thống kê nhanh
        const stats = {
            total: await Tracking.countDocuments({ userId }),
            facebook: await Tracking.countDocuments({ userId, sourcePlatform: 'facebook' }),
            tiktok: await Tracking.countDocuments({ userId, sourcePlatform: 'tiktok' }),
            active: await Tracking.countDocuments({ userId, isActive: true })
        };

        res.render('tracking', {
            currentPage: 'tracking',
            trackings,
            channels,
            stats,
            activePlatform: req.query.platform || 'all',
            features: res.locals.features || {},
            user: req.session.user || req.user || null,
            flash: req.flash ? { success: req.flash('success'), error: req.flash('error') } : null,
            t: (key) => key // i18n fallback
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

        const { name, url, sourcePlatform, sourceAccountId, targetPlatforms, cookiesPath } = req.body;

        if (!name || !url || !sourcePlatform) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ: tên, URL, nền tảng' });
        }

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