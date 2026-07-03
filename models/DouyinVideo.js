// models/DouyinVideo.js
const mongoose = require('mongoose');

const CrossPostResultSchema = new mongoose.Schema({
    platform: { type: String, required: true },
    accountChannelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    status: { type: String, enum: ['pending', 'posting', 'posted', 'failed'], default: 'pending' },
    publishedUrl: { type: String, default: '' },
    error: { type: String, default: '' },
    postedAt: { type: Date },
}, { _id: false });

const DouyinVideoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    trackingId: { type: mongoose.Schema.Types.ObjectId, ref: 'DouyinTracking', required: true },

    // Douyin video info
    douyinVideoId: { type: String, required: true },   // aweme_id (19 digits)
    douyinUrl: { type: String, required: true },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    thumbnail: { type: String, default: '' },
    duration: { type: Number, default: 0 },             // seconds
    viewCount: { type: Number, default: 0 },
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    author: { type: String, default: '' },
    authorAvatar: { type: String, default: '' },

    // Download info
    downloadPath: { type: String, default: '' },        // Local file path
    downloadSize: { type: String, default: '' },
    status: { type: String, enum: ['new', 'downloading', 'downloaded', 'pending_review', 'cross_posting', 'done', 'failed', 'skipped'], default: 'new' },
    downloadError: { type: String, default: '' },
    downloadMethod: { type: String, enum: ['ytdlp', 'playwright'], default: 'ytdlp' },

    // Telegram review
    telegramReviewStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    telegramMsgId: { type: Number, default: 0 },       // Telegram message_id for callback

    // Cross-post results
    crossPostResults: [CrossPostResultSchema],

    // Timestamps
    publishedAt: { type: Date },                        // Douyin publish date
    downloadedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

DouyinVideoSchema.index({ userId: 1 });
DouyinVideoSchema.index({ trackingId: 1 });
DouyinVideoSchema.index({ douyinVideoId: 1 }, { unique: true });
DouyinVideoSchema.index({ userId: 1, status: 1 });
DouyinVideoSchema.index({ trackingId: 1, douyinVideoId: 1 });

module.exports = mongoose.model('DouyinVideo', DouyinVideoSchema);
