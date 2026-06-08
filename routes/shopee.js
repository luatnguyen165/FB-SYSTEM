// routes/shopee.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { uploadImage } = require('../middlewares/uploadMiddleware');
const shopeeController = require('../controllers/shopeeController');

// Trang hiển thị
router.get('/', requireAuth, shopeeController.showShopeeLinks);

// API endpoints
router.post('/api/create', requireAuth, uploadImage.single('image'), shopeeController.createShopeeLink);
router.get('/api/list', requireAuth, shopeeController.getShopeeLinksAPI);
router.put('/api/:id', requireAuth, uploadImage.single('image'), shopeeController.updateShopeeLink);
router.delete('/api/:id', requireAuth, shopeeController.deleteShopeeLink);

module.exports = router;
