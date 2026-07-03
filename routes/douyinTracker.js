// routes/douyinTracker.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/douyinTrackerController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.use(requireAuth);

// Page
router.get('/', ctrl.showPage);

// Tracking CRUD
router.get('/api/trackings', ctrl.listTrackings);
router.post('/api/trackings', ctrl.createTracking);
router.put('/api/trackings/:id', ctrl.updateTracking);
router.delete('/api/trackings/:id', ctrl.deleteTracking);
router.post('/api/trackings/:id/check', ctrl.checkNow);

// Videos
router.get('/api/videos', ctrl.listVideos);
router.post('/api/videos/:id/crosspost', ctrl.crossPostVideo);
router.post('/api/videos/:id/retry', ctrl.retryDownload);
router.get('/api/videos/:id/preview', ctrl.previewVideo);
router.delete('/api/videos/:id', ctrl.deleteVideo);

// Runner
router.get('/api/runner-status', ctrl.getRunnerStatus);

// Upload cookies file
router.post('/api/upload-cookies', ctrl.uploadCookies);

// Login via browser
router.get('/api/login-status', ctrl.loginStatus);
router.post('/api/login-browser', ctrl.loginViaBrowser);

// Test download
router.post('/api/test-download', ctrl.testDownload);

module.exports = router;
