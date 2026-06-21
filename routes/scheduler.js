// routes/scheduler.js
// Health & control endpoints cho admin theo dõi cron/scheduler.
const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/schedulerController');

// Tất cả endpoint dưới đây yêu cầu admin
router.use(requireAuth, requireAdmin);

// Realtime status của tất cả workers, queues, memory, mongo
router.get('/status', ctrl.getSchedulerStatus);

// Force cleanup FB sessions idle ngay (không đợi cron 30 phút)
router.post('/cleanup/now', ctrl.cleanupNow);

// Flush background scan queue (skip các job đang đợi)
router.post('/bg-scan/flush', ctrl.flushBackgroundScanQueue);

module.exports = router;
