// routes/channels.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { uploadImage } = require('../middlewares/uploadMiddleware');
const channelController = require('../controllers/channelController');

// Trang hiển thị
router.get('/', requireAuth, channelController.showChannels);

// API endpoints - Platform-specific connect (create mode) - 5 Platforms (using uppercase platform codes)
router.post('/api/FB/connect', requireAuth, uploadImage.single('avatar'), channelController.openFacebookConnect);
router.post('/api/TT/connect', requireAuth, uploadImage.single('avatar'), channelController.openTiktokConnect);
router.post('/api/IG/connect', requireAuth, uploadImage.single('avatar'), channelController.openInstagramConnect);
router.post('/api/YT/connect', requireAuth, uploadImage.single('avatar'), channelController.openYoutubeConnect);
router.post('/api/ZO/connect', requireAuth, uploadImage.single('avatar'), channelController.openZaloConnect);

// API endpoints - Shared endpoints for all platforms
router.post('/api/create', requireAuth, uploadImage.single('avatar'), channelController.createChannel);
router.patch('/api/:id/update', requireAuth, uploadImage.single('avatar'), channelController.updateChannel);
router.get('/api/list', requireAuth, channelController.getChannelsAPI);
router.get('/api/:id/facebook-groups', requireAuth, channelController.getFacebookGroupsAPI);
router.post('/api/:id/open', requireAuth, channelController.openChannelBrowser);
router.patch('/api/:id/toggle', requireAuth, channelController.toggleChannel);
router.delete('/api/:id', requireAuth, channelController.deleteChannel);

module.exports = router;
