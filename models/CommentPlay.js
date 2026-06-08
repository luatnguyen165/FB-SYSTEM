// models/CommentPlay.js
const mongoose = require('mongoose');

const CommentPlaySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '' },
    description: { type: String, default: '' },
    status: {
        type: String,
        enum: ['active', 'paused', 'stopped'],
        default: 'active'
    },

    // --- Schedule ---
    schedule: {
        type: {
            type: String,
            enum: ['interval', 'cron'],
            default: 'interval'
        },
        intervalMinutes: { type: Number, default: 30, min: 1 },
        timeRange: {
            start: { type: String, default: '08:00' },  // HH:mm
            end: { type: String, default: '22:00' }      // HH:mm
        },
        maxPerDay: { type: Number, default: 50, min: 1 },
        commentDelay: {
            min: { type: Number, default: 5, min: 0 },   // giây
            max: { type: Number, default: 15, min: 0 }   // giây
        }
    },

    // --- Facebook Account ---
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', default: null },

    // --- Comment Selection ---
    selectedCommentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AiComment', default: null }],
    postAllComments: { type: Boolean, default: false }, // true = post all selected comments to each target post

    // --- Target ---
    target: {
        type: {
            type: String,
            enum: ['group-posts', 'specific-posts', 'ai-scan-results'],
            default: 'group-posts'
        },
        groupIds: [{ type: String }],  // Facebook group IDs
        postUrls: [{ type: String }],  // Specific post URLs
        scanConfigId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiScanConfig', default: null },
        filter: {
            types: [{
                type: String,
                enum: ['text', 'image', 'video']
            }]
        }
    },

    // --- Metrics ---
    metrics: {
        totalCommentsPosted: { type: Number, default: 0 },
        totalToday: { type: Number, default: 0 },
        lastRunAt: { type: Date, default: null },
        nextRunAt: { type: Date, default: null },
        totalErrors: { type: Number, default: 0 }
    },

    // Tracking ngày reset totalToday
    lastResetDate: { type: String, default: '' }, // YYYY-MM-DD

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

CommentPlaySchema.index({ userId: 1, status: 1 });
CommentPlaySchema.index({ userId: 1, 'metrics.nextRunAt': 1 });

module.exports = mongoose.model('CommentPlay', CommentPlaySchema);