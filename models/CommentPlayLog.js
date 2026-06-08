// models/CommentPlayLog.js
const mongoose = require('mongoose');

const CommentPlayLogSchema = new mongoose.Schema({
    playId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommentPlay', required: true },
    commentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiComment', required: true },
    commentText: { type: String, default: '' },
    commentType: { type: String, enum: ['text', 'image', 'video'], default: 'text' },
    targetUrl: { type: String, default: '' },
    targetGroupId: { type: String, default: '' },
    status: {
        type: String,
        enum: ['success', 'error', 'skipped'],
        default: 'success'
    },
    errorMessage: { type: String, default: '' },
    postedAt: { type: Date, default: Date.now }
});

CommentPlayLogSchema.index({ playId: 1, postedAt: -1 });
CommentPlayLogSchema.index({ playId: 1, status: 1 });

module.exports = mongoose.model('CommentPlayLog', CommentPlayLogSchema);