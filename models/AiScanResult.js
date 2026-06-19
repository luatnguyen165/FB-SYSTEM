// models/AiScanResult.js
const mongoose = require('mongoose');

const CommentResultSchema = new mongoose.Schema({
    type: { type: String, enum: ['text', 'image', 'video'], default: 'text' },
    content: { type: String, default: '' },
    caption: { type: String, default: '' },
    sent: { type: Boolean, default: false },
    error: { type: String, default: '' },
    sentAt: { type: Date, default: null }
}, { _id: true });

const AiScanResultSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    configId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiScanConfig', required: true },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    groupId: { type: String, default: '' },
    groupName: { type: String, default: '' },
    groupUrl: { type: String, default: '' },
    postId: { type: String, default: '' },
    postUrl: { type: String, default: '' },
    postContent: { type: String, default: '' },
    postImages: [{ type: String }],
    postVideos: [{ type: String }],
    postAuthor: { type: String, default: '' },
    postPublishedAt: { type: String, default: '' },
    // Flag: đã được AI phân tích hay chưa? Post mới crawl sẽ là false
    aiAnalyzed: { type: Boolean, default: false },
    aiAnalysis: { type: String, default: '' },
    aiScore: { type: Number, default: 0 },
    isMatching: { type: Boolean, default: false },
    matchReason: { type: String, default: '' },
    comments: { type: [CommentResultSchema], default: [] },
    // Legacy fields
    commentSent: { type: Boolean, default: false },
    commentContent: { type: String, default: '' },
    commentImage: { type: String, default: '' },
    commentError: { type: String, default: '' },
    commentedAt: { type: Date, default: null },
    scannedAt: { type: Date, default: Date.now }
});

AiScanResultSchema.virtual('anyCommentSent').get(function() {
    if (this.commentSent) return true;
    return this.comments && this.comments.some(c => c.sent);
});

AiScanResultSchema.index({ userId: 1, configId: 1 });
AiScanResultSchema.index({ userId: 1, isMatching: 1 });
AiScanResultSchema.index({ userId: 1, commentSent: 1 });
AiScanResultSchema.index({ userId: 1, scannedAt: -1 });
AiScanResultSchema.index({ userId: 1, configId: 1, aiAnalyzed: 1 }); // Index for finding unscanned posts
AiScanResultSchema.index({ postId: 1, configId: 1 }, { unique: true });

module.exports = mongoose.model('AiScanResult', AiScanResultSchema);