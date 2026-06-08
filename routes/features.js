// routes/features.js - Quản lý hiển thị tính năng (Admin only)
const express = require('express');
const router = express.Router();
const FeatureVisibility = require('../models/FeatureVisibility');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

// Trang quản lý tính năng
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        let features = await FeatureVisibility.findOne();
        if (!features) {
            features = await FeatureVisibility.create({});
        }
        res.render('feature-visibility', {
            currentPage: 'feature-visibility',
            features: features.toObject()
        });
    } catch (err) {
        console.error('[Feature Visibility] Error:', err);
        res.status(500).send('Lỗi server');
    }
});

// API: Cập nhật tính năng
router.post('/api/update', requireAuth, requireAdmin, async (req, res) => {
    try {
        const updates = req.body;
        let features = await FeatureVisibility.findOne();
        if (!features) {
            features = new FeatureVisibility();
        }
        Object.keys(updates).forEach(key => {
            if (features.schema.paths[key]) {
                features[key] = updates[key] === 'true' || updates[key] === true;
            }
        });
        await features.save();
        res.json({ success: true, message: 'Đã cập nhật hiển thị tính năng' });
    } catch (err) {
        console.error('[Feature Visibility] Update error:', err);
        res.status(500).json({ success: false, message: 'Lỗi cập nhật' });
    }
});

module.exports = router;