// controllers/videoBugController.js
const VideoBug = require('../models/VideoBug');
const videoBugService = require('../services/videoBugService');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Multer config for video upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'video-bugs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp4';
        cb(null, `bug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file video (mp4, avi, mov, mkv, webm)'));
        }
    }
}).single('video');

// ============================================================
// PAGE: Video Bugs Dashboard
// ============================================================

exports.showPage = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        if (!userId) return res.redirect('/auth/login');

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = 12;
        const totalItems = await VideoBug.countDocuments({ userId });
        const totalPages = Math.ceil(totalItems / perPage);

        const bugs = await VideoBug.find({ userId })
            .sort({ createdAt: -1 })
            .skip((page - 1) * perPage)
            .limit(perPage)
            .lean();

        const stats = {
            total: totalItems,
            active: await VideoBug.countDocuments({ userId, status: 'active' }),
            verified: await VideoBug.countDocuments({ userId, status: 'verified' }),
        };

        res.render('video-bugs', {
            currentPage: 'video-bugs',
            bugs,
            stats,
            features: res.locals.features || {},
            user: req.session.user || req.user || null,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems,
                baseUrl: '/video-bugs',
                queryParams: {}
            }
        });
    } catch (err) {
        console.error('[VideoBug] Page error:', err.message);
        req.flash?.('error', 'Lỗi tải trang: ' + err.message);
        res.redirect('/dashboard');
    }
};

// ============================================================
// API: Upload + Embed Bug
// ============================================================

exports.embedBug = async (req, res) => {
    upload(req, res, async (err) => {
        try {
            const userId = req.session.userId || req.user?.id;
            if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

            if (err) {
                return res.status(400).json({ success: false, message: err.message });
            }

            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn file video' });
            }

            const videoPath = req.file.path;
            const trackingId = videoBugService.generateTrackingId();

            // Get video info before processing
            const videoInfo = videoBugService.getVideoInfo(videoPath);
            const md5 = videoBugService.computeMD5(videoPath);

            // Run full bug process
            const result = await videoBugService.fullBugProcess(videoPath, trackingId);

            // Save to DB
            const videoBug = new VideoBug({
                userId,
                videoPath: result.finalPath,
                originalName: req.file.originalname,
                trackingId,
                bugs: result.steps.filter(s => s.success).map(s => ({
                    type: s.type,
                    data: s.path || '',
                    verified: false
                })),
                status: 'active',
                fileSize: req.file.size,
                duration: videoInfo?.format?.duration || 0,
                md5Hash: md5
            });

            await videoBug.save();

            console.log(`[VideoBug] Created: ${trackingId} (${req.file.originalname})`);

            res.json({
                success: true,
                message: `Đã embed bug thành công! Tracking ID: ${trackingId}`,
                data: {
                    _id: videoBug._id,
                    trackingId,
                    originalName: req.file.originalname,
                    videoPath: result.finalPath.replace(/\\/g, '/'),
                    steps: result.steps,
                    md5,
                    fileSize: req.file.size,
                    duration: videoInfo?.format?.duration || 0
                }
            });
        } catch (err) {
            console.error('[VideoBug] Embed error:', err.message);
            res.status(500).json({ success: false, message: 'Lỗi embed bug: ' + err.message });
        }
    });
};

// ============================================================
// API: Verify Video
// ============================================================

exports.verifyVideo = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        const { id } = req.params;
        const bug = await VideoBug.findOne({ _id: id, userId });
        if (!bug) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy video bug' });
        }

        if (!fs.existsSync(bug.videoPath)) {
            return res.status(404).json({ success: false, message: 'File video không tồn tại trên server' });
        }

        const result = videoBugService.verifyVideo(bug.videoPath, bug.trackingId);

        // Update status
        if (result.verified) {
            bug.status = 'verified';
            bug.verifiedAt = new Date();
            bug.bugs.forEach(b => b.verified = true);
            await bug.save();
        }

        res.json({
            success: true,
            verified: result.verified,
            data: result
        });
    } catch (err) {
        console.error('[VideoBug] Verify error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi verify: ' + err.message });
    }
};

// ============================================================
// API: Extract Bug from uploaded video
// ============================================================

exports.extractBug = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        upload(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ success: false, message: err.message });
            }

            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn file video' });
            }

            const videoPath = req.file.path;
            const result = videoBugService.extractBug(videoPath);

            // Cleanup uploaded file
            try { fs.unlinkSync(videoPath); } catch (e) {}

            res.json({
                success: true,
                data: result
            });
        });
    } catch (err) {
        console.error('[VideoBug] Extract error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi extract: ' + err.message });
    }
};

// ============================================================
// API: Delete Bug
// ============================================================

exports.deleteBug = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { id } = req.params;

        const bug = await VideoBug.findOneAndDelete({ _id: id, userId });
        if (!bug) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy video bug' });
        }

        // Cleanup file
        if (bug.videoPath && fs.existsSync(bug.videoPath)) {
            try { fs.unlinkSync(bug.videoPath); } catch (e) {}
        }

        res.json({ success: true, message: 'Đã xóa video bug' });
    } catch (err) {
        console.error('[VideoBug] Delete error:', err.message);
        res.status(500).json({ success: false, message: 'Lỗi xóa: ' + err.message });
    }
};

// ============================================================
// API: Get bug details
// ============================================================

exports.getBugDetail = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        const { id } = req.params;

        const bug = await VideoBug.findOne({ _id: id, userId }).lean();
        if (!bug) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        }

        res.json({ success: true, data: bug });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
