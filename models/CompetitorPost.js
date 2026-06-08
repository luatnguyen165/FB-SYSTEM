// models/CompetitorPost.js
const mongoose = require('mongoose');

const CompetitorPostSchema = new mongoose.Schema({
    competitorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Competitor', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    postId: { type: String, default: '' },           // Facebook post ID for dedup
    platform: { type: String, enum: ['FB', 'IG', 'TT', 'YT'], required: true },
    postUrl: { type: String, default: '' },
    content: { type: String, default: '' },
    mediaType: { type: String, enum: ['image', 'video', 'text', 'link', 'reel', 'unknown'], default: 'unknown' },
    mediaUrl: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' },
    media: [{ type: mongoose.Schema.Types.Mixed }],  // Scraped media array [{type, url, saved_as}]
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    engagementRate: { type: Number, default: 0 },
    postedAt: { type: Date },
    scrapedAt: { type: Date },                        // When scraped
    tags: [{ type: String }],
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative', ''], default: '' },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index for fast lookup
CompetitorPostSchema.index({ competitorId: 1, createdAt: -1 });
CompetitorPostSchema.index({ userId: 1, platform: 1 });

module.exports = mongoose.model('CompetitorPost', CompetitorPostSchema);