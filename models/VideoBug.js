// models/VideoBug.js
const mongoose = require('mongoose');

const BugSchema = new mongoose.Schema({
    type: { type: String, enum: ['metadata', 'audio', 'frame', 'watermark'], required: true },
    data: { type: String, default: '' },
    embeddedAt: { type: Date, default: Date.now },
    verified: { type: Boolean, default: false }
}, { _id: false });

const VideoBugSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    videoPath: { type: String, required: true },
    originalName: { type: String, default: '' },
    trackingId: { type: String, required: true, unique: true },
    bugs: [BugSchema],
    status: { type: String, enum: ['active', 'verified', 'expired'], default: 'active' },
    fileSize: { type: Number, default: 0 },
    duration: { type: Number, default: 0 },
    md5Hash: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    verifiedAt: { type: Date }
});

VideoBugSchema.index({ userId: 1, trackingId: 1 }, { unique: true });

module.exports = mongoose.model('VideoBug', VideoBugSchema);
