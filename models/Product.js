// models/Product.js
const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    name: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: '' },
    price: { type: String, default: '' }, // Can be "Liên hệ" or a number
    images: [{ type: String }],

    // Marketing
    targetAudience: { type: String, default: '' },
    keySellingPoints: [{ type: String }],
    competitorProducts: { type: String, default: '' },
    direction: { type: String, enum: ['advertising', 'purchase', 'mixed', 'unset'], default: 'unset' },

    // AI Analysis
    aiAnalysis: {
        suggestedDirection: { type: String, default: '' },
        recommendedAngles: [{ type: String }],
        hookIdeas: [{ type: String }],
        targetEmotions: [{ type: String }],
        keywords: [{ type: String }],
        summary: { type: String, default: '' },
    },

    // Related writing style
    writingStyleId: { type: mongoose.Schema.Types.ObjectId, ref: 'WritingStyle' },

    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

ProductSchema.index({ userId: 1 });
ProductSchema.index({ userId: 1, isActive: 1 });
ProductSchema.index({ userId: 1, category: 1 });

module.exports = mongoose.model('Product', ProductSchema);