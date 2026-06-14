// models/AiContentSchedule.js
const mongoose = require('mongoose');

const AiContentScheduleSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true }, // Tên lịch (VD: "Bài viết tuần 1")
    writingStyleId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingStyle', required: true },

    // Cấu hình lịch
    dateRange: {
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true },
    },
    timeSlots: [{
        hour: { type: Number, required: true, min: 0, max: 23 },
        minute: { type: Number, required: true, min: 0, max: 59 },
        platforms: [{ type: String, enum: ['FB', 'IG', 'TT'] }],
        accountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }],
    }],

    // Cấu hình bài viết
    contentConfig: {
        topics: [{ type: String }],
        minWords: { type: Number, default: 200 },
        maxWords: { type: Number, default: 500 },
        customInstructions: { type: String, default: '' },
        language: { type: String, default: 'vi' },
    },

    // Trạng thái
    status: { type: String, enum: ['active', 'paused', 'completed', 'draft'], default: 'draft' },
    postsGenerated: { type: Number, default: 0 },
    postsPublished: { type: Number, default: 0 },
    lastGeneratedAt: { type: Date },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

AiContentScheduleSchema.index({ userId: 1 });
AiContentScheduleSchema.index({ userId: 1, status: 1 });
AiContentScheduleSchema.index({ userId: 1, status: 1, 'dateRange.startDate': 1 });

module.exports = mongoose.model('AiContentSchedule', AiContentScheduleSchema);