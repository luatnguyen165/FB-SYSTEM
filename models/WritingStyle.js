// models/WritingStyle.js
const mongoose = require('mongoose');

const WritingStyleSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true }, // Tên văn phong (VD: "Văn phong bán hàng")
    sampleArticles: [{
        title: { type: String, default: '' },
        content: { type: String, required: true },
        category: { type: String, default: '' }, // Chủ đề: bán hàng, chia sẻ, review...
    }],
    styleAnalysis: {
        tone: { type: String, default: '' },
        vocabulary: { type: String, default: '' },
        sentenceStructure: { type: String, default: '' },
        keywords: [{ type: String }],
        avgLength: { type: Number, default: 0 },
        summary: { type: String, default: '' },
        rawAnalysis: { type: String, default: '' },
        // Mới: phân tích sâu cho self-learning
        hookPatterns: [{ type: String }],
        ctaPatterns: [{ type: String }],
        emojiPatterns: { type: String, default: '' },
        writingFormulas: [{ type: String }],
        bestExamples: [{
            postId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiGeneratedPost' },
            score: { type: Number, default: 0 },
            reasons: [{ type: String }],
        }],
    },
    // Self-learning tracking
    trainingVersion: { type: Number, default: 0 },
    lastTrainedAt: { type: Date },
    topics: [{ type: String }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

WritingStyleSchema.index({ userId: 1 });
WritingStyleSchema.index({ userId: 1, name: 1 });

module.exports = mongoose.model('WritingStyle', WritingStyleSchema);