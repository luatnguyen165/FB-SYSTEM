// models/FeatureVisibility.js - Lưu cấu hình hiển thị tính năng
const mongoose = require('mongoose');

const FeatureVisibilitySchema = new mongoose.Schema({
    // Mỗi tính năng là một key, value là true/false
    // Chỉ có 1 document duy nhất trong collection (singleton pattern)
    channels: { type: Boolean, default: true },
    dashboard: { type: Boolean, default: true },
    storage: { type: Boolean, default: true },
    storeVideo: { type: Boolean, default: true },
    'schedule-manager': { type: Boolean, default: true },
    'schedule-post': { type: Boolean, default: true },
    'schedule-reels': { type: Boolean, default: true },
    'schedule-archive': { type: Boolean, default: true },
    'schedule-groups': { type: Boolean, default: true },
    'ai-scan': { type: Boolean, default: true },
    'ai-comments': { type: Boolean, default: true },
    shopeeLink: { type: Boolean, default: true },
    profile: { type: Boolean, default: true },
    settings: { type: Boolean, default: true },
    // Tính năng mới
    'ai-reply-messenger': { type: Boolean, default: true },
    'analytics': { type: Boolean, default: true },
    'hashtag-manager': { type: Boolean, default: true },
    'telegram-notifications': { type: Boolean, default: true },
    'competitors': { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('FeatureVisibility', FeatureVisibilitySchema);