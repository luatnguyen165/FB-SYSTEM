// routes/videos.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { uploadVideo } = require('../middlewares/uploadMiddleware');
const videoController = require('../controllers/videoController');

// Trang hiển thị
router.get('/', requireAuth, videoController.showVideos);

// API endpoints
router.post('/upload', requireAuth, uploadVideo.array('videos', 20), videoController.uploadVideos);
router.get('/api/list', requireAuth, videoController.getVideosAPI);
router.post('/api/schedule', requireAuth, videoController.scheduleVideo);
router.delete('/api/:id', requireAuth, videoController.deleteVideo);
router.post('/api/delete-multiple', requireAuth, videoController.deleteMultipleVideos);

module.exports = router;
