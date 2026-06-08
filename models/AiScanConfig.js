// models/AiScanConfig.js
const mongoose = require('mongoose');

const CommentItemSchema = new mongoose.Schema({
    type: { type: String, enum: ['text', 'image', 'video'], required: true },
    content: { type: String, default: '' }, // Nội dung text hoặc file path
    caption: { type: String, default: '' }  // Caption đính kèm (cho image/video)
}, { _id: true });

const AiScanConfigSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true }, // Tên cấu hình
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true }, // FB account
    groupKeys: [{ type: String }], // Mảng các group keys (groupId hoặc groupUrl)
    niche: { type: String, default: '' }, // Ngách ngành (bất động sản, xe, công nghệ...)
    scanScript: { type: String, default: '' }, // Kịch bản AI analysis
    commentItems: { type: [CommentItemSchema], default: [] }, // Mảng các comment items (text/image/video)
    scheduleEnabled: { type: Boolean, default: false },
    scheduleHour: { type: Number, default: 8 },
    scheduleMinute: { type: Number, default: 0 },
    scheduleTimeStart: { type: String, default: '06:00' }, // Khung giờ bắt đầu
    scheduleTimeEnd: { type: String, default: '23:00' }, // Khung giờ kết thúc
    maxDaysOld: { type: Number, default: 1 }, // Số ngày tối đa quét bài viết (1 = hôm nay, 2 = 2 ngày, 3 = 3 ngày)
    openaiApiKey: { type: String, default: '' }, // OpenAI API key cho cấu hình này (nếu để trống dùng từ Settings)
    scanIntervalMinutes: { type: Number, default: 60 }, // Khoảng cách giữa các lần quét (phút)
    maxPostsPerScan: { type: Number, default: 10 }, // Số bài tối đa mỗi lần quét
    nextScanAt: { type: Date, default: null }, // Thời gian quét tiếp theo
    model: { type: String, default: 'gpt-4o-mini' }, // Model OpenAI sử dụng
    isActive: { type: Boolean, default: true },
    lastScanAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Index để tìm nhanh theo userId
AiScanConfigSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('AiScanConfig', AiScanConfigSchema);