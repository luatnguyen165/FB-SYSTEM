// middlewares/channelMiddleware.js
const Channel = require('../models/Channel');
const { restoreRecordForView } = require('../utils/cryptoVault');

// Only load the fields the sidebar actually needs — avoids returning
// large encrypted blobs (storageStatePath, accessToken) on every request.
const SIDEBAR_PROJECTION = {
    _id: 1,
    platform: 1,
    accountName: 1,
    accountType: 1,
    apiStatus: 1,
    isEnabled: 1,
    avatarUrl: 1,
    profileUrl: 1
};

// Fields that may be encrypted and need decryption for sidebar display
const SIDEBAR_DECRYPT_FIELDS = ['platform', 'accountName', 'accountType'];

const loadUserChannels = async (req, res, next) => {
    if (!req.user) {
        res.locals.channels = [];
        return next();
    }
    try {
        // Uses index { userId, platform } — fetches only sidebar-relevant fields
        const rawChannels = await Channel
            .find({ userId: req.user._id }, SIDEBAR_PROJECTION)
            .sort({ platform: 1, createdAt: -1 })
            .lean();

        // Decrypt fields so sidebar always sees plain text platform codes (FB, TT, etc.)
        res.locals.channels = rawChannels.map(ch => restoreRecordForView(ch, SIDEBAR_DECRYPT_FIELDS));
    } catch (err) {
        console.error('[channelMiddleware] load error:', err.message);
        res.locals.channels = [];
    }
    next();
};

module.exports = { loadUserChannels };
