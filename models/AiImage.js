// models/AiImage.js
// Video Project Model - upload ảnh + prompt, không dùng AI
const mongoose = require('mongoose');

const videoEntrySchema = new mongoose.Schema({
    originalImage: {
        filename: { type: String, default: '' },
        path: { type: String, default: '' },
        mimetype: { type: String, default: '' }
    },
    prompt: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    errorMessage: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const videoProjectSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        default: 'Project mới',
        trim: true
    },
    entries: [videoEntrySchema],
    isFavorite: { type: Boolean, default: false }
}, {
    timestamps: true
});

videoProjectSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AiImage', videoProjectSchema);