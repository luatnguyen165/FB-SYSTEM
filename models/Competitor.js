// models/Competitor.js
const mongoose = require('mongoose');

const CompetitorSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    platform: { type: String, enum: ['FB', 'IG', 'TT', 'YT'], required: true },
    profileUrl: { type: String, required: true },
    avatarUrl: { type: String, default: '' },
    description: { type: String, default: '' },
    followers: { type: Number, default: 0 },
    followersHistory: [{
        count: Number,
        date: { type: Date, default: Date.now }
    }],
    postsCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    tags: [{ type: String }],
    notes: { type: String, default: '' },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null },
    postLimit: { type: Number, default: 10 },
    scraping: { type: Boolean, default: false },
    lastCheckedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

CompetitorSchema.index({ userId: 1, platform: 1 });

module.exports = mongoose.model('Competitor', CompetitorSchema);