// models/AiScanConfig.js
const mongoose = require('mongoose');

const AiScanConfigSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true }, // Tên cấu hình
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true }, // FB account
    groupKeys: [{ type: String }], // Mảng các group keys (groupId hoặc groupUrl)
    scanScript: { type: String, default: '' }, // Kịch bản AI analysis
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
    aiProvider: { type: String, default: 'openai', enum: ['openai', 'openai-compatible', 'anthropic', 'puter'] }, // Provider AI
    openaiCompatibleApiKey: { type: String, default: '' },
    openaiCompatibleBaseUrl: { type: String, default: '' },
    openaiCompatibleModel: { type: String, default: 'gpt-3.5-turbo' },
    anthropicApiKey: { type: String, default: '' },
    anthropicModel: { type: String, default: 'claude-3-haiku-20240307' },

    // --- AI Detection Mode (Optional) ---
    // Tắt = lưu bài xong comment luôn (dựa vào keywordFilter)
    // Bật = dùng OpenAI/Puter phân tích nhu cầu trước khi comment
    useAiDetection: { type: Boolean, default: false },
    // Keyword filter khi tắt AI: nếu content chứa 1 trong các keyword → isMatching: true
    keywordFilter: { type: [String], default: [] },
    // Ngưỡng điểm AI tối thiểu (0-100) khi bật AI
    minAiScore: { type: Number, default: 60, min: 0, max: 100 },
    // Nếu true: vẫn lưu bài không match để tham khảo, không xóa
    keepNonMatching: { type: Boolean, default: true },

    commentItems: [{
        name: { type: String, default: '' },
        type: { type: String, enum: ['text', 'image', 'video'], default: 'text' },
        content: { type: String, default: '' },
        caption: { type: String, default: '' },
        selected: { type: Boolean, default: true }
    }],
    isActive: { type: Boolean, default: true },
    lastScanAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Index để tìm nhanh theo userId
AiScanConfigSchema.index({ userId: 1, isActive: 1 });

module.exports = mongoose.model('AiScanConfig', AiScanConfigSchema);