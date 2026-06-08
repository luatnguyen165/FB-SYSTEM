const mongoose = require('mongoose');

const LicenseKeySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true },
    productType: { 
        type: String, 
        enum: ['standard', 'premium', 'enterprise'], 
        default: 'standard' 
    },
    status: { 
        type: String, 
        enum: ['active', 'suspended', 'expired'], 
        default: 'active' 
    },
    isUsed: { type: Boolean, default: false },
    assignedTo: {
        email: { type: String, default: '' },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
    },
    maxDevices: { type: Number, default: 1 },
    maxAccounts: { type: Number, default: 5 },
    features: { type: [String], default: [] }, // ['ai_comment', 'ai_scan', 'schedule', ...]
    activatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    createdBy: { type: String, default: 'admin' }
});

// Tự động set expiresAt = 1 year nếu không có
LicenseKeySchema.pre('save', function(next) {
    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }
    next();
});

module.exports = mongoose.model('LicenseKey', LicenseKeySchema);