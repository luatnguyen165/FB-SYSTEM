// controllers/storageController.js
const Settings = require('../models/Settings');
const {
    normalizeEncryptedValue,
    prepareSensitiveValue,
    restoreRecordForView
} = require('../utils/cryptoVault');

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'on', 'yes'].includes(String(value).trim().toLowerCase());
}

// Hiển thị trang lưu trữ
const showStorage = async (req, res) => {
    try {
        let settings = await Settings.findOne({ userId: req.user._id }).lean();
        if (!settings) settings = {};
        settings = restoreRecordForView(settings, ['driveClientId', 'driveApiKey', 'driveFolderId']);
        res.render('storage', { user: req.user, settings });
    } catch (error) {
        console.error('Show Storage Error:', error);
        res.render('storage', { user: req.user, settings: {} });
    }
};

// API: Lưu cấu hình Drive
const saveDriveConfig = async (req, res) => {
    try {
        const { driveClientId, driveApiKey, driveFolderId } = req.body;
        let settings = await Settings.findOne({ userId: req.user._id });
        if (!settings) settings = new Settings({ userId: req.user._id });

        const encryptionEnabled = Boolean(settings.dataEncryptionEnabled);

        if (driveClientId !== undefined) {
            settings.driveClientId = prepareSensitiveValue(normalizeEncryptedValue(driveClientId), encryptionEnabled);
        }
        if (driveApiKey !== undefined) {
            settings.driveApiKey = prepareSensitiveValue(normalizeEncryptedValue(driveApiKey), encryptionEnabled);
        }
        if (driveFolderId !== undefined) {
            settings.driveFolderId = prepareSensitiveValue(normalizeEncryptedValue(driveFolderId), encryptionEnabled);
        }
        settings.updatedAt = new Date();
        await settings.save();

        res.json({
            success: true,
            message: 'Đã lưu cấu hình Google Drive!',
            settings: restoreRecordForView(settings.toObject(), ['driveClientId', 'driveApiKey', 'driveFolderId'])
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Kết nối Google Drive (giả lập)
const connectDrive = async (req, res) => {
    try {
        let settings = await Settings.findOne({ userId: req.user._id });
        if (!settings) return res.status(400).json({ success: false, message: 'Chưa cấu hình Drive' });

        if (!settings.driveClientId || !settings.driveApiKey) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập Client ID và API Key trước' });
        }

        settings.driveConnected = true;
        settings.updatedAt = new Date();
        await settings.save();

        res.json({ success: true, message: 'Kết nối Google Drive thành công!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { showStorage, saveDriveConfig, connectDrive };
