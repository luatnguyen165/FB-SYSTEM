// routes/schedule.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { uploadImage, uploadImageArray, uploadVideo } = require('../middlewares/uploadMiddleware');
const { uploadErrorHandler } = require('../middlewares/uploadMiddleware');
const scheduleController = require('../controllers/scheduleController');
const aiScanController = require('../controllers/aiScanController');
const aiCommentController = require('../controllers/aiCommentController');

// Trang hiển thị
router.get('/manager', requireAuth, scheduleController.showScheduleManager);
router.get('/archive', requireAuth, scheduleController.showPublishedArchive);
router.get('/archive/export', requireAuth, scheduleController.exportPublishedArchive);
router.get('/post', requireAuth, scheduleController.showSchedulePost);
router.get('/reels', requireAuth, scheduleController.showScheduleReels);
router.get('/groups', requireAuth, scheduleController.showScheduleGroups);

// API endpoints
// Dùng uploadImageArray (wrap multer.any + filter images) thay vì multer.array() cũ,
// để multer parse TẤT CẢ field text (accounts, platforms, ...) kèm theo images.
router.post('/api/create', requireAuth, uploadImageArray, uploadErrorHandler, scheduleController.createSchedule);
router.put('/api/update', requireAuth, uploadImageArray, uploadErrorHandler, scheduleController.updateSchedule);
router.post('/api/upload-local-reels-video', requireAuth, uploadVideo.single('video'), scheduleController.uploadLocalReelsVideo);
router.post('/api/upload-instant-reels', requireAuth, uploadVideo.single('video'), scheduleController.uploadInstantReels);
router.get('/api/list', requireAuth, scheduleController.getSchedulesAPI);
router.get('/api/by-date', requireAuth, scheduleController.getScheduleByDateAPI);
router.get('/api/reels-runner/status', requireAuth, scheduleController.getReelsRunnerStatusAPI);
router.post('/api/reels-runner/run-now', requireAuth, scheduleController.runReelsRunnerNowAPI);
router.post('/api/reels-runner/run-schedule/:id', requireAuth, scheduleController.runReelsScheduleByIdNowAPI);
router.post('/api/run-schedule/:id', requireAuth, scheduleController.runScheduleByIdNowAPI);
router.post('/api/scan-groups', requireAuth, scheduleController.scanFacebookGroupsAPI);
router.post('/api/scrape-group', requireAuth, scheduleController.scrapeGroupMembersAPI);
router.post('/api/scrape-joins', requireAuth, scheduleController.scrapeGroupsFromJoinsAPI);
router.get('/api/groups', requireAuth, scheduleController.getGroupsAPI); // API lấy groups cho polling
router.get('/api/:id', requireAuth, scheduleController.getScheduleByIdAPI);
router.delete('/api/:id', requireAuth, scheduleController.deleteSchedule);

// ========================
// AI SCAN ROUTES
// ========================
router.get('/ai-scan', requireAuth, aiScanController.showAiScan);

// Config API
router.post('/ai-scan/api/config/create', requireAuth, aiScanController.createConfig);
router.put('/ai-scan/api/config/update', requireAuth, aiScanController.updateConfig);
router.delete('/ai-scan/api/config/:configId', requireAuth, aiScanController.deleteConfig);
router.post('/ai-scan/api/config/:configId/toggle', requireAuth, aiScanController.toggleConfig);
router.get('/ai-scan/api/config/:configId', requireAuth, aiScanController.getConfigById);

// Scan execution
router.post('/ai-scan/api/scan-now', requireAuth, aiScanController.runScanNow);

// Results
router.get('/ai-scan/api/results', requireAuth, aiScanController.getResults);
router.put('/ai-scan/api/result/update', requireAuth, aiScanController.updateResult);
router.delete('/ai-scan/api/result/delete', requireAuth, aiScanController.deleteOneResult);
router.delete('/ai-scan/api/results', requireAuth, aiScanController.deleteResults);

// Groups for config
router.get('/ai-scan/api/channel-groups', requireAuth, aiScanController.getChannelGroups);

// Upload file for comment items (image/video)
router.post('/ai-scan/api/upload-comment-file', requireAuth, (req, res, next) => {
    // Determine which upload middleware to use based on file type hint
    const { uploadImage } = require('../middlewares/uploadMiddleware');
    uploadImage.single('file')(req, res, (err) => {
        if (err) {
            // Try video upload if image fails
            const { uploadVideo } = require('../middlewares/uploadMiddleware');
            uploadVideo.single('file')(req, res, next);
        } else {
            next();
        }
    });
}, aiScanController.uploadCommentFile);

// OpenAI settings
router.post('/ai-scan/api/settings/openai-key', requireAuth, aiScanController.saveOpenAiKey);
router.post('/ai-scan/api/settings/test-openai-key', requireAuth, aiScanController.testOpenAiKey);

// ========================
// AI COMMENT BANK ROUTES
// ========================
router.get('/ai-comments', requireAuth, aiCommentController.showAiComments);

// Comment CRUD
router.post('/ai-comment/api/create', requireAuth, aiCommentController.createComment);
router.put('/ai-comment/api/update', requireAuth, aiCommentController.updateComment);
router.delete('/ai-comment/api/:commentId', requireAuth, aiCommentController.deleteComment);
router.post('/ai-comment/api/:commentId/toggle', requireAuth, aiCommentController.toggleComment);

// Comment API for scan service
router.get('/ai-comment/api/active', requireAuth, aiCommentController.getActiveComments);
router.get('/ai-comment/api/all', requireAuth, aiCommentController.getAllCommentsForPicker);

// Upload file for comment (image or video)
router.post('/ai-comment/api/upload-file', requireAuth, (req, res, next) => {
    const multer = require('multer');
    const path = require('path');
    const fs = require('fs');

    const dataDir = global.USER_DATA_DIR || path.join(__dirname, '..');
    const uploadDir = path.join(dataDir, 'uploads', 'comment-files');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
            cb(null, uniqueName);
        }
    });

    const upload = multer({
        storage,
        limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
        fileFilter: (req, file, cb) => {
            const isImage = file.mimetype.startsWith('image/');
            const isVideo = file.mimetype.startsWith('video/');
            if (isImage || isVideo) return cb(null, true);
            cb(new Error('Chỉ chấp nhận file ảnh hoặc video'));
        }
    });

    upload.single('file')(req, res, next);
}, aiCommentController.uploadCommentFile);

// ========================
// AI TỰ REPLY MESSENGER
// ========================
router.get('/ai-reply-messenger', requireAuth, (req, res) => {
    const features = require('../models/FeatureVisibility').schema.paths;
    const FeatureVisibility = require('../models/FeatureVisibility');
    FeatureVisibility.findOne().lean().then(featureVisibility => {
        const feat = featureVisibility || {};
        res.render('ai-reply-messenger', {
            user: req.user,
            currentPage: 'ai-reply-messenger',
            features: feat,
        });
    }).catch(() => {
        res.render('ai-reply-messenger', {
            user: req.user,
            currentPage: 'ai-reply-messenger',
            features: {},
        });
    });
});

module.exports = router;
