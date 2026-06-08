const LicenseKey = require('../models/LicenseKey');
const User = require('../models/User');
const crypto = require('crypto');

// ======== GENERATE KEYS ========
const generateKeys = async (req, res) => {
    try {
        const { count = 1, productType = 'standard', maxDevices = 1, maxAccounts = 5, daysValid = 365 } = req.body;
        const keys = [];
        
        for (let i = 0; i < count; i++) {
            const key = 'FB-' + crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
            keys.push({
                key,
                productType,
                maxDevices,
                maxAccounts,
                expiresAt: new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000),
                createdBy: req.session?.userId || 'admin'
            });
        }
        
        await LicenseKey.insertMany(keys);
        
        if (req.headers.accept?.includes('json')) {
            return res.json({ success: true, count, keys: keys.map(k => k.key) });
        }
        
        req.session.flash = { type: 'success', message: `Đã tạo ${count} key thành công!` };
        res.redirect('/admin/licenses');
    } catch (error) {
        console.error('[License] Generate error:', error);
        if (req.headers.accept?.includes('json')) {
            return res.status(500).json({ success: false, message: error.message });
        }
        req.session.flash = { type: 'error', message: 'Lỗi: ' + error.message };
        res.redirect('/admin/licenses');
    }
};

// ======== ACTIVATE KEY (khi user nhập key để đăng ký) ========
const activateKey = async (req, res) => {
    try {
        const { key, email } = req.body;
        
        if (!key || !email) {
            return res.json({ success: false, message: 'Thiếu key hoặc email!' });
        }
        
        const license = await LicenseKey.findOne({ key: key.toUpperCase() });
        if (!license) {
            return res.json({ success: false, message: 'License key không tồn tại!' });
        }
        
        if (license.status === 'suspended') {
            return res.json({ success: false, message: 'License key đã bị khóa!' });
        }
        
        if (license.status === 'expired') {
            return res.json({ success: false, message: 'License key đã hết hạn!' });
        }
        
        if (license.expiresAt && license.expiresAt < new Date()) {
            license.status = 'expired';
            await license.save();
            return res.json({ success: false, message: 'License key đã hết hạn!' });
        }
        
        if (license.isUsed && license.assignedTo.email !== email) {
            return res.json({ success: false, message: 'License key đã được sử dụng bởi email khác!' });
        }
        
        // Nếu key chưa dùng, gán cho user này
        if (!license.isUsed) {
            license.isUsed = true;
            license.assignedTo.email = email;
            license.activatedAt = new Date();
            await license.save();
        }
        
        return res.json({
            success: true,
            message: 'Kích hoạt license thành công!',
            data: {
                productType: license.productType,
                maxDevices: license.maxDevices,
                maxAccounts: license.maxAccounts,
                expiresAt: license.expiresAt
            }
        });
    } catch (error) {
        console.error('[License] Activate error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
};

// ======== CHECK LICENSE STATUS (khi login) ========
const checkLicense = async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }
        
        const license = await LicenseKey.findOne({ 'assignedTo.email': user.email });
        if (!license) {
            return res.json({ 
                success: false, 
                message: 'Tài khoản chưa có license!',
                hasLicense: false
            });
        }
        
        // Check expiry
        if (license.expiresAt && license.expiresAt < new Date()) {
            license.status = 'expired';
            await license.save();
            return res.json({ 
                success: false, 
                message: 'License đã hết hạn!',
                hasLicense: true,
                isExpired: true,
                expiresAt: license.expiresAt
            });
        }
        
        if (license.status === 'suspended') {
            return res.json({ 
                success: false, 
                message: 'License đã bị khóa! Liên hệ admin.',
                hasLicense: true,
                isSuspended: true
            });
        }
        
        return res.json({
            success: true,
            hasLicense: true,
            message: 'License còn hiệu lực',
            data: {
                productType: license.productType,
                maxDevices: license.maxDevices,
                maxAccounts: license.maxAccounts,
                expiresAt: license.expiresAt,
                features: license.features
            }
        });
    } catch (error) {
        console.error('[License] Check error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
};

// ======== LIST ALL LICENSES (Admin) ========
const listLicenses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;
        
        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.search) {
            filter.$or = [
                { key: { $regex: req.query.search, $options: 'i' } },
                { 'assignedTo.email': { $regex: req.query.search, $options: 'i' } }
            ];
        }
        
        const [licenses, total] = await Promise.all([
            LicenseKey.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
            LicenseKey.countDocuments(filter)
        ]);
        
        const totalPages = Math.ceil(total / limit);
        
        if (req.headers.accept?.includes('json')) {
            return res.json({ success: true, licenses, total, page, totalPages });
        }
        
        res.render('admin-licenses', { 
            licenses, 
            currentPage: page, 
            totalPages,
            total,
            query: req.query,
            user: req.user 
        });
    } catch (error) {
        console.error('[License] List error:', error);
        res.status(500).send('Lỗi server!');
    }
};

// ======== SUSPEND / UNSUSPEND LICENSE ========
const toggleLicenseStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const license = await LicenseKey.findById(id);
        if (!license) {
            return res.json({ success: false, message: 'License not found' });
        }
        
        license.status = license.status === 'suspended' ? 'active' : 'suspended';
        await license.save();
        
        res.json({ 
            success: true, 
            message: `License ${license.status === 'active' ? 'đã mở khóa' : 'đã khóa'}!`,
            status: license.status
        });
    } catch (error) {
        console.error('[License] Toggle error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
};

// ======== EXTEND LICENSE ========
const extendLicense = async (req, res) => {
    try {
        const { id } = req.params;
        const { days } = req.body;
        
        const license = await LicenseKey.findById(id);
        if (!license) {
            return res.json({ success: false, message: 'License not found' });
        }
        
        // Nếu đã hết hạn, set từ now
        if (!license.expiresAt || license.expiresAt < new Date()) {
            license.expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        } else {
            license.expiresAt = new Date(license.expiresAt.getTime() + days * 24 * 60 * 60 * 1000);
        }
        license.status = 'active';
        await license.save();
        
        res.json({ 
            success: true, 
            message: `Đã gia hạn ${days} ngày! Hết hạn: ${license.expiresAt.toLocaleDateString()}`,
            expiresAt: license.expiresAt
        });
    } catch (error) {
        console.error('[License] Extend error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
};

// ======== DELETE LICENSE ========
const deleteLicense = async (req, res) => {
    try {
        const { id } = req.params;
        await LicenseKey.findByIdAndDelete(id);
        res.json({ success: true, message: 'Đã xóa license!' });
    } catch (error) {
        console.error('[License] Delete error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
};

module.exports = { generateKeys, activateKey, checkLicense, listLicenses, toggleLicenseStatus, extendLicense, deleteLicense };