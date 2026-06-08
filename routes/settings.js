// routes/settings.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { uploadImage } = require('../middlewares/uploadMiddleware');
const settingsController = require('../controllers/settingsController');

// Trang hiển thị
router.get('/', requireAuth, settingsController.showSettings);

// API: Trả về public key + trạng thái mã hoá cho client
router.get('/api/security', requireAuth, settingsController.getSecurityConfig);

// API endpoints
router.post('/api/save', requireAuth, uploadImage.single('watermark'), settingsController.saveSettings);
router.post('/api/reset', requireAuth, settingsController.resetSettings);
router.post('/api/telegram-test', requireAuth, settingsController.testTelegram);

module.exports = router;
