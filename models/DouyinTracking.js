// models/DouyinTracking.js
const mongoose = require('mongoose');

const DouyinTrackingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // Channel info
    channelUrl: { type: String, required: true },     // https://www.douyin.com/user/MS4wLjABAAAA...
    channelName: { type: String, default: '' },
    channelAvatar: { type: String, default: '' },
    channelSecUid: { type: String, default: '' },     // Douyin sec_uid (user ID)

    // Tracking config
    status: { type: String, enum: ['active', 'paused', 'error'], default: 'active' },
    checkIntervalMinutes: { type: Number, default: 15, min: 5, max: 1440 },
    lastCheckedAt: { type: Date },
    lastError: { type: String, default: '' },
    cookiesPath: { type: String, default: '' },       // Path to Douyin cookies file
    cookiesExpiresAt: { type: Date },                 // Ngày hết hạn cookies (tự parse từ file)

    // Telegram review (optional)
    telegramReview: { type: Boolean, default: false }, // Gửi Telegram duyệt trước khi cross-post

    // Cross-post config
    crossPostPlatforms: [{ type: String, enum: ['FB', 'FR', 'IG', 'TH', 'PI', 'YS', 'TT', 'YT'] }],
    crossPostAccounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],

    // Stats
    totalDownloaded: { type: Number, default: 0 },
    totalCrossPosted: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

DouyinTrackingSchema.index({ userId: 1 });
DouyinTrackingSchema.index({ userId: 1, status: 1 });
DouyinTrackingSchema.index({ userId: 1, channelUrl: 1 }, { unique: true });

module.exports = mongoose.model('DouyinTracking', DouyinTrackingSchema);
