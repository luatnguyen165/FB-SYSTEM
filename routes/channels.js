// routes/channels.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { uploadImage } = require('../middlewares/uploadMiddleware');
const channelController = require('../controllers/channelController');

// ─── Page ─────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, channelController.showChannels);

// ─── Platform connect (single generic handler for all 5 platforms) ────────────
// :platform accepts FB | TT | IG | YT | ZO
router.post('/api/:platform/connect', requireAuth, uploadImage.single('avatar'), channelController.openPlatformConnect);

// ─── Channel CRUD ─────────────────────────────────────────────────────────────
router.post  ('/api/create',              requireAuth, uploadImage.single('avatar'), channelController.createChannel);
router.patch ('/api/:id/update',          requireAuth, uploadImage.single('avatar'), channelController.updateChannel);
router.patch ('/api/:id/toggle',          requireAuth, channelController.toggleChannel);
router.delete('/api/:id',                 requireAuth, channelController.deleteChannel);

// ─── Misc ─────────────────────────────────────────────────────────────────────
router.get   ('/api/list',                requireAuth, channelController.getChannelsAPI);
router.get   ('/api/:id/facebook-groups', requireAuth, channelController.getFacebookGroupsAPI);
router.post  ('/api/:id/open',            requireAuth, channelController.openChannelBrowser);

module.exports = router;
