// models/TrackingPost.js - Bài viết từ đối tượng theo dõi
const mongoose = require('mongoose');

const TrackingPostSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    trackingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tracking', required: true },

    // Post data từ Facebook
    postId: { type: String, required: true },
    text: { type: String, default: '' },
    permalink: { type: String, default: '' },
    commentCount: { type: Number, default: 0 },

    // Media
    images: [{ type: String }], // URLs ảnh đã download
    videos: [{ type: String }], // URLs video đã download

    // Metadata
    authorName: { type: String, default: '' },
    publishedAt: { type: Date }, // Thời gian đăng bài trên Facebook
    publishedAtText: { type: String, default: '' }, // Text gốc từ Facebook
    scrapedAt: { type: Date, default: Date.now },

    // Auto-repost tracking
    repostResults: [{
        platform: { type: String, required: true },   // 'FB','IG','TT','YS','FR','PI','TH'
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
        scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchedulePost' },
        status: { type: String, enum: ['pending', 'posted', 'failed', 'skipped'], default: 'pending' },
        publishedUrl: { type: String, default: '' },
        error: { type: String, default: '' },
        attemptedAt: { type: Date, default: Date.now },
        completedAt: { type: Date }
    }],
    repostEnqueuedAt: { type: Date } // Marker idempotency - lần cuối enqueue
}, { timestamps: true });

TrackingPostSchema.index({ userId: 1, trackingId: 1 });
TrackingPostSchema.index({ trackingId: 1, postId: 1 }, { unique: true });
TrackingPostSchema.index({ userId: 1, scrapedAt: -1 });
TrackingPostSchema.index({ 'repostResults.scheduleId': 1 });

module.exports = mongoose.model('TrackingPost', TrackingPostSchema);
