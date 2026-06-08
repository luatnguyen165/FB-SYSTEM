// models/Settings.js
const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // Cấu hình render
    autoFlip: { type: Boolean, default: true },
    autoMd5Change: { type: Boolean, default: true },
    watermarkPosition: { type: String, default: 'top-right' },
    watermarkUrl: { type: String, default: '' },
    // Cấu hình thời gian & giãn cách đăng tải
    postInterval: { type: Number, default: 30 }, // phút - khoảng nghỉ giữa các bài
    retryDelay: { type: Number, default: 5 }, // phút - thử lại khi lỗi
    maxPostsPerDay: { type: Number, default: 10 }, // giới hạn bài/ngày
    minIntervalBetweenPosts: { type: Number, default: 10 }, // phút - khoảng nghỉ tối thiểu
    randomDelayEnabled: { type: Boolean, default: false }, // bật độ trễ ngẫu nhiên
    randomDelayMin: { type: Number, default: 5 }, // phút - độ trễ ngẫu nhiên tối thiểu
    randomDelayMax: { type: Number, default: 15 }, // phút - độ trễ ngẫu nhiên tối đa
    quietHoursEnabled: { type: Boolean, default: false }, // chế độ yên lặng
    quietHoursStart: { type: String, default: '23:00' }, // giờ bắt đầu yên lặng
    quietHoursEnd: { type: String, default: '07:00' }, // giờ kết thúc yên lặng
    // Telegram
    telegramBotToken: { type: String, default: '' },
    telegramChatId: { type: String, default: '' },
    // Google Drive
    driveClientId: { type: String, default: '' },
    driveApiKey: { type: String, default: '' },
    driveFolderId: { type: String, default: '' },
    driveConnected: { type: Boolean, default: false },
    // OpenAI (cho AI Scan)
    openaiApiKey: { type: String, default: '' },
    // Bảo mật dữ liệu
    dataEncryptionEnabled: { type: Boolean, default: false },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', SettingsSchema);
