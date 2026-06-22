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
router.post('/api/test-ai-connection', requireAuth, settingsController.testAiConnection);

// API: Telegram link (one-time token)
router.post('/api/telegram/generate-link-token', requireAuth, settingsController.generateTelegramLinkToken);
router.get('/api/telegram/link-status', requireAuth, settingsController.getTelegramLinkStatus);
router.post('/api/telegram/unlink', requireAuth, settingsController.unlinkTelegram);

module.exports = router;
