// models/SchedulePost.js
const mongoose = require('mongoose');

const PlatformResultSchema = new mongoose.Schema({
    platform: { type: String, required: true },         // 'FB', 'IG', 'TT', 'YT', 'FR', 'YS', 'PI', 'TH'
    success: { type: Boolean, default: false },
    publishedUrl: { type: String, default: '' },
    error: { type: String, default: '' },
    completedAt: { type: Date, default: Date.now }
}, { _id: false });

const SchedulePostSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['post', 'reels', 'tiktok'], required: true },
    caption: { type: String, default: '' },
    postTitle: { type: String, default: '' }, // Tiêu đề bài viết (bắt buộc cho Pinterest)
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
    platformResults: [PlatformResultSchema], // Kết quả per-platform sau khi chạy schedule
    sourceTrackingPostId: { type: mongoose.Schema.Types.ObjectId, ref: 'TrackingPost', index: true, sparse: true }, // Link về TrackingPost (nếu được tạo từ auto-repost)
    createdAt: { type: Date, default: Date.now }
});

SchedulePostSchema.index({ sourceTrackingPostId: 1, platforms: 1 }); // Dedupe per-platform cho auto-repost

module.exports = mongoose.model('SchedulePost', SchedulePostSchema);
