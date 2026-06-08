// models/AiComment.js
const mongoose = require('mongoose');

const AiCommentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '' }, // Tên gợi nhớ cho comment
    type: { type: String, enum: ['text', 'image', 'video'], required: true },
    content: { type: String, default: '' }, // Nội dung text hoặc file path
    caption: { type: String, default: '' }, // Caption (cho image/video)
    isActive: { type: Boolean, default: true }, // Bật/tắt - tắt = bỏ qua
    order: { type: Number, default: 0 }, // Thứ tự sắp xếp
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

AiCommentSchema.index({ userId: 1, isActive: 1 });
AiCommentSchema.index({ userId: 1, order: 1 });

module.exports = mongoose.model('AiComment', AiCommentSchema);