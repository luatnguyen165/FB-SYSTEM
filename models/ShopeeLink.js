// models/ShopeeLink.js
const mongoose = require('mongoose');

const ShopeeLinkSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    shopeeUrl: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    platform: {
        type: String,
        enum: ['shopee', 'tiktok', 'website'],
        default: 'shopee'
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ShopeeLink', ShopeeLinkSchema);
