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

    // Metadata
    authorName: { type: String, default: '' },
    scrapedAt: { type: Date, default: Date.now },
}, { timestamps: true });

TrackingPostSchema.index({ userId: 1, trackingId: 1 });
TrackingPostSchema.index({ trackingId: 1, postId: 1 }, { unique: true });
TrackingPostSchema.index({ userId: 1, scrapedAt: -1 });

module.exports = mongoose.model('TrackingPost', TrackingPostSchema);
