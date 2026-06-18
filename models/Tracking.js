// models/Tracking.js - Theo dõi đối tượng trên Facebook & TikTok
const mongoose = require('mongoose');

const TrackingSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // Tên đối tượng theo dõi
    name: { type: String, required: true, trim: true },
    
    // URL đối tượng (profile/group/page)
    url: { type: String, required: true, trim: true },
    
    // Nền tảng gốc: 'facebook' | 'tiktok'
    sourcePlatform: { type: String, enum: ['facebook', 'tiktok'], required: true },
    
    // Tài khoản nguồn dùng để lấy dữ liệu (Channel._id)
    sourceAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    
    // Các nền tảng đích để đăng (có thể chọn nhiều)
    targetPlatforms: [{
        platform: { type: String, enum: ['facebook', 'tiktok', 'instagram', 'youtube', 'pinterest', 'threads'], required: true },
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' }
    }],
    
    // Cookies file path (riêng cho TikTok)
    cookiesPath: { type: String, default: '' },
    
    // Trạng thái
    isActive: { type: Boolean, default: true },
    
    // Thống kê theo dõi
    stats: {
        totalPosts: { type: Number, default: 0 },
        totalReposted: { type: Number, default: 0 },
        lastChecked: { type: Date },
        lastReposted: { type: Date }
    }
}, { timestamps: true });

// Index cho tìm kiếm nhanh
TrackingSchema.index({ userId: 1, sourcePlatform: 1 });
TrackingSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('Tracking', TrackingSchema);