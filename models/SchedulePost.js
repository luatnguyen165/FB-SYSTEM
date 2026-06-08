// models/SchedulePost.js
const mongoose = require('mongoose');

const SchedulePostSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['post', 'reels', 'tiktok'], required: true },
    caption: { type: String, default: '' },
    images: [{ type: String }], // URLs ảnh (cho post)
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Video' }, // ID video (cho reels)
    videoPath: { type: String, default: '' }, // Path video local upload riêng cho Reels
    videoTitle: { type: String, default: '' },
    videoSize: { type: String, default: '' },
    shopeeLinks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ShopeeLink' }], // Link affiliate gắn cho reels
    targetGroupSourceChannelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }, // Facebook account dùng để lấy danh sách group
    targetGroupIds: [{ type: String }], // Danh sách nhiều Facebook group IDs/URLs
    targetGroupId: { type: String, default: '' }, // Facebook group key/id (legacy - cho tương thích ngược)
    targetGroupName: { type: String, default: '' },
    targetGroupUrl: { type: String, default: '' },
    publishedUrl: { type: String, default: '' }, // Link reels/post sau khi đăng thành công
    scheduledAt: { type: Date, required: true },
    platforms: [{ type: String }], // ['FB', 'IG', 'TT', 'YT']
    accounts: [{ type: String }], // Tên tài khoản
    status: { type: String, enum: ['pending', 'posted', 'failed'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SchedulePost', SchedulePostSchema);
