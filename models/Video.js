// models/Video.js
const mongoose = require('mongoose');

const VideoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    originalName: { type: String },
    filename: { type: String, required: true },
    filePath: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    thumbnailUrl: { type: String, default: '' },
    status: { type: String, enum: ['ready', 'scheduled', 'posted'], default: 'ready' },
    scheduleDate: { type: Date },
    scheduleCaption: { type: String, default: '' },
    scheduleAccounts: [{ type: String }],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Video', VideoSchema);
