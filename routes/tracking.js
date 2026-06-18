// routes/tracking.js - Theo dõi đối tượng Facebook & TikTok
const express = require('express');
const router = express.Router();
const trackingController = require('../controllers/trackingController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Apply auth middleware to all routes
router.use(requireAuth);

// Trang chính
router.get('/', trackingController.showTracking);

// API CRUD
router.post('/api/create', trackingController.createTracking);
router.put('/api/update/:id', trackingController.updateTracking);
router.delete('/api/delete/:id', trackingController.deleteTracking);
router.post('/api/toggle/:id', trackingController.toggleTracking);
router.get('/api/list', trackingController.listTrackingAPI);
router.get('/api/channels', trackingController.getChannelsByPlatform);

module.exports = router;