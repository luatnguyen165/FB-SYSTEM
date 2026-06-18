// models/AutoContentPipeline.js
const mongoose = require('mongoose');

const AutoContentPipelineSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    writingStyleId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingStyle' },

    // Cấu hình đăng
    postsPerDay: { type: Number, default: 2, min: 1, max: 10 },
    platforms: [{ type: String, enum: ['FB', 'TT', 'IG'] }],
    accountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],
    groupIds: [{ type: String }],
    timeSlots: [{
        hour: { type: Number, required: true, min: 0, max: 23 },
        minute: { type: Number, default: 0, min: 0, max: 59 },
    }],
    contentDirection: { type: String, enum: ['advertising', 'purchase', 'mixed', 'unset'], default: 'mixed' },

    // Cấu hình nội dung
    contentConfig: {
        minWords: { type: Number, default: 200 },
        maxWords: { type: Number, default: 500 },
        customInstructions: { type: String, default: '' },
        language: { type: String, default: 'vi' },
    },

    // Nguồn research
    researchSources: [{
        type: { type: String, enum: ['fb_group', 'competitor', 'tiktok', 'manual'] },
        url: String,
        platform: String,
        name: String,
    }],

    // Trạng thái
    status: { type: String, enum: ['active', 'paused', 'completed'], default: 'active' },

    // Stats
    totalPosts: { type: Number, default: 0 },
    totalEngagement: { type: Number, default: 0 },
    lastRunAt: Date,
    nextRunAt: Date,
    lastError: String,

    // AI learning
    learningData: {
        bestHooks: [{ type: String }],
        bestCTAs: [{ type: String }],
        bestTopics: [{ type: String }],
        avgEngagement: { type: Number, default: 0 },
        improvementRate: { type: Number, default: 0 },
        lastUpdated: Date,
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

AutoContentPipelineSchema.index({ userId: 1 });
AutoContentPipelineSchema.index({ userId: 1, status: 1 });
AutoContentPipelineSchema.index({ status: 1, nextRunAt: 1 });

module.exports = mongoose.model('AutoContentPipeline', AutoContentPipelineSchema);
