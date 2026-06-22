// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DeviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    userAgent: { type: String, default: '' },
    platform: { type: String, default: '' },
    lastLogin: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    ipAddress: { type: String, default: '' }
}, { _id: false });

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    password: { type: String, required: true },
    role: { type: String, default: 'user', enum: ['user', 'admin'] },
    devices: { type: [DeviceSchema], default: [] },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    language: { type: String, enum: ['vi', 'en'], default: 'vi' },

    // Telegram linking
    telegramChatId: { type: String, default: '', index: true },
    telegramLinked: { type: Boolean, default: false },
    telegramLinkToken: { type: String, default: '' }, // one-time token để user gõ /start <token>
    telegramUsername: { type: String, default: '' },   // @username từ Telegram (optional, để hiển thị)
    telegramLinkedAt: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);