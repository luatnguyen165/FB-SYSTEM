// models/Feedback.js
const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String, default: '' },
    text: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const FeedbackSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    feature: { type: String, required: true },
    type: {
        type: String,
        enum: ['bug', 'feature', 'improvement', 'question'],
        default: 'bug'
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved', 'closed'],
        default: 'open'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    attachments: [{ type: String }],
    adminNote: { type: String, default: '' },
    messages: [MessageSchema],
    resolvedAt: { type: Date },
    closedAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

FeedbackSchema.index({ userId: 1, createdAt: -1 });
FeedbackSchema.index({ status: 1 });
FeedbackSchema.index({ feature: 1 });

module.exports = mongoose.model('Feedback', FeedbackSchema);