const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireLocalAuth } = require('../middlewares/authMiddleware');
const { uploadVideo } = require('../middlewares/uploadMiddleware');

// Trang test upload video Instagram
router.get('/', requireLocalAuth, (req, res) => {
    const Channel = require('../models/Channel');
    Channel.find({ platform: 'IG' }).lean().then(channels => {
        res.render('test-instagram-upload', {
            user: req.user,
            currentPage: 'test-instagram-upload',
            channels
        });
    }).catch(() => {
        res.render('test-instagram-upload', {
            user: req.user,
            currentPage: 'test-instagram-upload',
            channels: []
        });
    });
});

// API test upload video Instagram
router.post('/api/test-upload', requireLocalAuth, uploadVideo.single('video'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file video' });
        }

        const { accountName, accountType, caption, headless } = req.body;
        if (!accountName) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Instagram' });
        }

        const videoPath = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'videos', req.file.filename);
        if (!fs.existsSync(videoPath)) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy file video' });
        }

        const { uploadVideoToInstagram } = require('../services/instagramPlaywrightService');
        const Channel = require('../models/Channel');

        // Tìm channel IG theo accountName
        const channel = await Channel.findOne({ platform: 'IG', accountName }).lean();
        const existingSessionDir = channel?.storageStatePath ? path.dirname(channel.storageStatePath) : '';

        const result = await uploadVideoToInstagram({
            userId: req.user._id,
            accountName,
            accountType: accountType || 'Personal',
            existingSessionDir,
            videoPath,
            caption: caption || `Test IG Upload - ${new Date().toLocaleString('vi-VN')}`,
            headless: headless === 'true'
        });

        return res.json(result);
    } catch (error) {
        console.error('[IG Test Upload] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// API test upload ảnh Instagram
const { uploadImageArray } = require('../middlewares/uploadMiddleware');
router.post('/api/test-upload-images', requireLocalAuth, uploadImageArray, async (req, res) => {
    try {
        const pathMod = require('path');

        const uploadedFiles = req.files || [];
        if (!uploadedFiles.length) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file ảnh' });
        }

        const { accountName, accountType, caption, headless } = req.body;
        if (!accountName) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Instagram' });
        }

        const dataDir = global.USER_DATA_DIR || pathMod.join(__dirname, '..');
        const imageDir = pathMod.join(dataDir, 'uploads', 'images');
        const imagePaths = uploadedFiles.map(f => pathMod.join(imageDir, f.filename));

        const { uploadImagesToInstagram } = require('../services/instagramPlaywrightService');
        const Channel = require('../models/Channel');

        const channel = await Channel.findOne({ platform: 'IG', accountName }).lean();
        const existingSessionDir = channel?.storageStatePath ? path.dirname(channel.storageStatePath) : '';

        const result = await uploadImagesToInstagram({
            userId: req.user._id,
            accountName,
            accountType: accountType || 'Personal',
            existingSessionDir,
            images: imagePaths,
            caption: caption || `Test IG Post - ${new Date().toLocaleString('vi-VN')}`,
            headless: headless === 'true'
        });

        return res.json(result);
    } catch (error) {
        console.error('[IG Test Upload Images] Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
