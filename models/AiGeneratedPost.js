// models/AiGeneratedPost.js
const mongoose = require('mongoose');

const AiGeneratedPostSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiContentSchedule' },

    title: { type: String, default: '' },
    content: { type: String, required: true },
    images: [{ type: String }],

    platforms: [{ type: String, enum: ['FB', 'IG', 'TT'] }],
    accounts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],

    scheduledAt: { type: Date, required: true },
    publishedAt: { type: Date },

    status: { type: String, enum: ['draft', 'pending', 'posted', 'failed'], default: 'draft' },
    publishedUrls: [{
        platform: { type: String },
        url: { type: String },
    }],

    // Dữ liệu AI
    aiModel: { type: String, default: 'gpt-4o-mini' },
    aiPrompt: { type: String, default: '' },
    imagePrompt: { type: String, default: '' },
    generationCost: { type: Number, default: 0 },

    // Tham chiếu SchedulePost đã tạo
    schedulePostId: { type: mongoose.Schema.Types.ObjectId, ref: 'SchedulePost' },

    // Liên kết sản phẩm (cho auto content pipeline)
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    direction: { type: String, enum: ['advertising', 'purchase', 'mixed', 'unset'] },

    // Liên kết pipeline tạo ra bài này (mới thêm Bundle D)
    pipelineId: { type: mongoose.Schema.Types.ObjectId, ref: 'AutoContentPipeline' },

    // Engagement tracking
    engagement: {
        likes: { type: Number, default: 0 },
        comments: { type: Number, default: 0 },
        shares: { type: Number, default: 0 },
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

AiGeneratedPostSchema.index({ userId: 1 });
AiGeneratedPostSchema.index({ userId: 1, scheduleId: 1 });
AiGeneratedPostSchema.index({ userId: 1, status: 1 });
AiGeneratedPostSchema.index({ userId: 1, scheduledAt: 1 });
AiGeneratedPostSchema.index({ userId: 1, productId: 1 });
AiGeneratedPostSchema.index({ userId: 1, pipelineId: 1 });

module.exports = mongoose.model('AiGeneratedPost', AiGeneratedPostSchema);