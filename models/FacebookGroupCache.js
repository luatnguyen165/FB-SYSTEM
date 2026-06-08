// models/FacebookGroupCache.js
const mongoose = require('mongoose');

const FacebookGroupSchema = new mongoose.Schema({
    groupId: { type: String, required: true },
    groupUrl: { type: String, default: '' },
    groupName: { type: String, required: true }
}, { _id: false });

const FacebookGroupCacheSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    accountName: { type: String, required: true },
    accountType: { type: String, default: 'Cá nhân' },
    groups: { type: [FacebookGroupSchema], default: [] },
    updatedAt: { type: Date, default: Date.now }
});

FacebookGroupCacheSchema.index({ userId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('FacebookGroupCache', FacebookGroupCacheSchema);