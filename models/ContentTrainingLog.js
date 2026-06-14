// models/ContentTrainingLog.js
const mongoose = require('mongoose');

const ContentTrainingLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    writingStyleId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingStyle', required: true },

    // Training info
    version: { type: Number, required: true },  // Training version
    type: { type: String, enum: ['initial', 'retrain'], default: 'initial' },

    // Posts used for retraining
    topPosts: [{
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiGeneratedPost' },
        title: { type: String, default: '' },
        content: { type: String, default: '' },
        score: { type: Number, default: 0 },        // Engagement score (likes + comments*2 + shares*3)
        likes: { type: Number, default: 0 },
        comments: { type: Number, default: 0 },
        shares: { type: Number, default: 0 },
        platform: { type: String, default: '' },
    }],

    // Training results
    analysis: {
        tone: String,
        vocabulary: String,
        sentenceStructure: String,
        keywords: [String],
        hookPatterns: [String],
        ctaPatterns: [String],
        emojiPatterns: String,
        writingFormulas: [String],
        summary: String,
    },

    // Stats
    postsEvaluated: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    topScore: { type: Number, default: 0 },

    createdAt: { type: Date, default: Date.now },
});

ContentTrainingLogSchema.index({ userId: 1, writingStyleId: 1 });
ContentTrainingLogSchema.index({ userId: 1, writingStyleId: 1, version: -1 });

module.exports = mongoose.model('ContentTrainingLog', ContentTrainingLogSchema);