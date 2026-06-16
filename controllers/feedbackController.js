// controllers/feedbackController.js
const Feedback = require('../models/Feedback');
const FeatureVisibility = require('../models/FeatureVisibility');
const https = require('https');
const http = require('http');

const SERVER_ADMIN_URL = process.env.SERVER_ADMIN_URL || 'http://localhost:5000';

/**
 * Sync feedback to ServerAdmin
 */
function syncToServerAdmin(method, path, data) {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(path, SERVER_ADMIN_URL);
            const postData = data ? JSON.stringify(data) : '';
            const lib = SERVER_ADMIN_URL.startsWith('https') ? https : http;
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname,
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 3000
            };
            const req = lib.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try { resolve(JSON.parse(body)); } catch { resolve(null); }
                });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
            if (postData) req.write(postData);
            req.end();
        } catch { resolve(null); }
    });
}

// ==================== PAGE ====================
exports.renderPage = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const feedbacks = await Feedback.find({ userId }).sort({ createdAt: -1 }).lean();
        
        const feat = await FeatureVisibility.findOne().lean() || {};
        
        res.render('feedback', {
            user: req.session.user || req.user,
            feedbacks,
            features: feat,
            currentPage: 'feedback'
        });
    } catch (err) {
        console.error('[Feedback] renderPage error:', err.message);
        req.session.flash = { error: 'Lỗi tải trang: ' + err.message };
        res.redirect('/dashboard');
    }
};

// ==================== API: CREATE ====================
exports.createFeedback = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { feature, type, title, description, priority } = req.body;

        if (!feature || !title || !description) {
            return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin: Tính năng, Tiêu đề, Mô tả' });
        }

        const feedback = await Feedback.create({
            userId,
            feature: feature.trim(),
            type: type || 'bug',
            title: title.trim(),
            description: description.trim(),
            priority: priority || 'medium'
        });

        // Sync to ServerAdmin
        syncToServerAdmin('POST', '/api/feedback', {
            userId: String(userId),
            feature: feature.trim(),
            type: type || 'bug',
            title: title.trim(),
            description: description.trim(),
            priority: priority || 'medium'
        });

        res.json({ success: true, message: 'Đã gửi góp ý thành công!', feedback });
    } catch (err) {
        console.error('[Feedback] create error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== API: UPDATE (user can edit their own) ====================
exports.updateFeedback = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const { title, description, type, priority } = req.body;

        const feedback = await Feedback.findOne({ _id: id, userId });
        if (!feedback) return res.status(404).json({ error: 'Không tìm thấy góp ý' });

        if (title !== undefined) feedback.title = title.trim();
        if (description !== undefined) feedback.description = description.trim();
        if (type !== undefined) feedback.type = type;
        if (priority !== undefined) feedback.priority = priority;
        feedback.updatedAt = new Date();

        await feedback.save();

        // Sync to ServerAdmin
        syncToServerAdmin('PUT', '/api/feedback/sync/' + id, {
            title: feedback.title,
            description: feedback.description,
            type: feedback.type,
            priority: feedback.priority
        });

        res.json({ success: true, message: 'Đã cập nhật góp ý!', feedback });
    } catch (err) {
        console.error('[Feedback] update error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== API: DELETE ====================
exports.deleteFeedback = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;

        const result = await Feedback.deleteOne({ _id: id, userId });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Không tìm thấy góp ý' });

        // Sync to ServerAdmin
        syncToServerAdmin('DELETE', '/api/feedback/sync/' + id);

        res.json({ success: true, message: 'Đã xóa góp ý!' });
    } catch (err) {
        console.error('[Feedback] delete error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== API: ADMIN - GET ALL ====================
exports.getAllFeedback = async (req, res) => {
    try {
        const { status, type, feature } = req.query;
        const filter = {};
        if (status) filter.status = status;
        if (type) filter.type = type;
        if (feature) filter.feature = feature;

        const feedbacks = await Feedback.find(filter)
            .populate('userId', 'email')
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, feedbacks });
    } catch (err) {
        console.error('[Feedback] admin get all error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== API: GET SINGLE FEEDBACK ====================
exports.getFeedback = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const feedback = await Feedback.findOne({ _id: id, userId }).lean();
        if (!feedback) return res.status(404).json({ error: 'Không tìm thấy góp ý' });
        res.json({ success: true, feedback });
    } catch (err) {
        console.error('[Feedback] get error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== API: ADMIN - UPDATE STATUS ====================
exports.adminUpdateFeedback = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, priority, adminNote } = req.body;

        const feedback = await Feedback.findById(id);
        if (!feedback) return res.status(404).json({ error: 'Không tìm thấy góp ý' });

        if (status !== undefined) feedback.status = status;
        if (priority !== undefined) feedback.priority = priority;
        if (adminNote !== undefined) feedback.adminNote = adminNote;
        feedback.updatedAt = new Date();

        // Track resolved/closed timestamps
        if (status === 'resolved' && !feedback.resolvedAt) feedback.resolvedAt = new Date();
        if (status === 'closed') feedback.closedAt = new Date();

        await feedback.save();

        // Sync to ServerAdmin
        syncToServerAdmin('PUT', '/api/feedback/sync/' + id, {
            status: feedback.status,
            priority: feedback.priority
        });

        res.json({ success: true, message: 'Đã cập nhật góp ý!', feedback });
    } catch (err) {
        console.error('[Feedback] admin update error:', err.message);
        res.status(500).json({ error: err.message });
    }
};
