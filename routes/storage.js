// routes/storage.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const storageController = require('../controllers/storageController');

// Trang hiển thị
router.get('/', requireAuth, storageController.showStorage);

// API endpoints
router.post('/api/drive-config', requireAuth, storageController.saveDriveConfig);
router.post('/api/connect-drive', requireAuth, storageController.connectDrive);

module.exports = router;
