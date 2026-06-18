// models/Channel.js
const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
    userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    platform:         { type: String, enum: ['FB', 'TT', 'IG', 'YT', 'ZO', 'PI', 'TH'], required: true },
    accountName:      { type: String, required: true },
    accountType:      { type: String, default: 'Cá nhân' },
    profileUrl:       { type: String, default: '' },
    avatarUrl:        { type: String, default: '' },
    followers:        { type: String, default: '0' },
    apiStatus:        { type: String, enum: ['active', 'inactive', 'error'], default: 'active' },
    isEnabled:        { type: Boolean, default: true },
    accessToken:      { type: String, default: '' },
    storageStatePath: { type: String, default: '' },
    createdAt:        { type: Date, default: Date.now }
});

// Indexes for common query patterns
ChannelSchema.index({ userId: 1, platform: 1 });
ChannelSchema.index({ userId: 1, isEnabled: 1 });
ChannelSchema.index({ userId: 1, platform: 1, accountName: 1, accountType: 1 });

module.exports = mongoose.model('Channel', ChannelSchema);
