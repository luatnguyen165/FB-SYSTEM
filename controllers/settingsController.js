// controllers/settingsController.js
const Settings = require('../models/Settings');
const {
    getPublicKey,
    normalizeEncryptedValue,
    prepareSensitiveValue,
    restoreRecordForView
} = require('../utils/cryptoVault');

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'on', 'yes'].includes(String(value).trim().toLowerCase());
}

// Hiển thị trang cấu hình
const showSettings = async (req, res) => {
    try {
        let settings = await Settings.findOne({ userId: req.user._id }).lean();
        if (!settings) {
            settings = await Settings.create({ userId: req.user._id });
            settings = settings.toObject();
        }

        settings = restoreRecordForView(settings, [
            'telegramBotToken',
            'telegramChatId',
            'driveClientId',
            'driveApiKey',
            'driveFolderId',
            'openaiApiKey'
        ]);

        res.render('settings', { user: req.user, settings });
    } catch (error) {
        console.error('Show Settings Error:', error);
        res.render('settings', { user: req.user, settings: {} });
    }
};

const getSecurityConfig = async (req, res) => {
    try {
        const settings = await Settings.findOne({ userId: req.user._id }).lean();
        res.json({
            success: true,
            publicKey: getPublicKey(),
            dataEncryptionEnabled: Boolean(settings?.dataEncryptionEnabled)
        });
    } catch (error) {
        console.error('Get Security Config Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Lưu cấu hình
const saveSettings = async (req, res) => {
    try {
        const {
            autoFlip, autoMd5Change, watermarkPosition,
            postInterval, retryDelay, maxPostsPerDay,
            minIntervalBetweenPosts, randomDelayEnabled,
            randomDelayMin, randomDelayMax,
            quietHoursEnabled, quietHoursStart, quietHoursEnd,
            telegramBotToken, telegramChatId,
            driveClientId, driveApiKey, driveFolderId,
            openaiApiKey, dataEncryptionEnabled
        } = req.body;

        let settings = await Settings.findOne({ userId: req.user._id });
        if (!settings) {
            settings = new Settings({ userId: req.user._id });
        }

        const encryptionEnabled = toBoolean(dataEncryptionEnabled, Boolean(settings.dataEncryptionEnabled));

        if (autoFlip !== undefined) settings.autoFlip = toBoolean(autoFlip, settings.autoFlip);
        if (autoMd5Change !== undefined) settings.autoMd5Change = toBoolean(autoMd5Change, settings.autoMd5Change);
        if (watermarkPosition) settings.watermarkPosition = watermarkPosition;
        if (postInterval !== undefined) settings.postInterval = Math.max(5, Number(postInterval));
        if (retryDelay !== undefined) settings.retryDelay = Math.max(1, Number(retryDelay));
        if (maxPostsPerDay !== undefined) settings.maxPostsPerDay = Math.max(1, Number(maxPostsPerDay));
        if (minIntervalBetweenPosts !== undefined) settings.minIntervalBetweenPosts = Math.max(1, Number(minIntervalBetweenPosts));
        if (randomDelayEnabled !== undefined) settings.randomDelayEnabled = toBoolean(randomDelayEnabled, false);
        if (randomDelayMin !== undefined) settings.randomDelayMin = Math.max(1, Number(randomDelayMin));
        if (randomDelayMax !== undefined) settings.randomDelayMax = Math.max(1, Number(randomDelayMax));
        if (quietHoursEnabled !== undefined) settings.quietHoursEnabled = toBoolean(quietHoursEnabled, false);
        if (quietHoursStart !== undefined) settings.quietHoursStart = quietHoursStart;
        if (quietHoursEnd !== undefined) settings.quietHoursEnd = quietHoursEnd;
        if (telegramBotToken !== undefined) settings.telegramBotToken = prepareSensitiveValue(normalizeEncryptedValue(telegramBotToken), encryptionEnabled);
        if (telegramChatId !== undefined) settings.telegramChatId = prepareSensitiveValue(normalizeEncryptedValue(telegramChatId), encryptionEnabled);
        if (driveClientId !== undefined) settings.driveClientId = prepareSensitiveValue(normalizeEncryptedValue(driveClientId), encryptionEnabled);
        if (driveApiKey !== undefined) settings.driveApiKey = prepareSensitiveValue(normalizeEncryptedValue(driveApiKey), encryptionEnabled);
        if (driveFolderId !== undefined) settings.driveFolderId = prepareSensitiveValue(normalizeEncryptedValue(driveFolderId), encryptionEnabled);
        if (openaiApiKey !== undefined) settings.openaiApiKey = prepareSensitiveValue(normalizeEncryptedValue(openaiApiKey), encryptionEnabled);
        settings.dataEncryptionEnabled = encryptionEnabled;
        if (req.file) settings.watermarkUrl = '/uploads/images/' + req.file.filename;

        const sensitiveFields = [
            'telegramBotToken',
            'telegramChatId',
            'driveClientId',
            'driveApiKey',
            'driveFolderId',
            'openaiApiKey'
        ];

        sensitiveFields.forEach((field) => {
            settings[field] = prepareSensitiveValue(settings[field], encryptionEnabled);
        });

        settings.updatedAt = new Date();
        await settings.save();

        const safeSettings = restoreRecordForView(settings.toObject(), [
            'telegramBotToken',
            'telegramChatId',
            'driveClientId',
            'driveApiKey',
            'driveFolderId',
            'openaiApiKey'
        ]);

        res.json({ success: true, message: 'Đã lưu cấu hình!', settings: safeSettings });
    } catch (error) {
        console.error('Save Settings Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Reset cấu hình
const resetSettings = async (req, res) => {
    try {
        await Settings.deleteOne({ userId: req.user._id });
        const settings = await Settings.create({ userId: req.user._id });
        res.json({ success: true, message: 'Đã đặt lại mặc định!', settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Test Telegram connection
const testTelegram = async (req, res) => {
    try {
        const { telegramBotToken, telegramChatId } = req.body;
        if (!telegramBotToken || !telegramChatId) {
            return res.status(400).json({ success: false, message: 'Thiếu Token hoặc Chat ID' });
        }

        const message = `✅ *ReelsFlow AI - Kết nối thành công!*\n\nBot đã được kết nối với hệ thống của bạn.\nTừ giờ bạn sẽ nhận được thông báo khi có tiến trình đăng bài.`;
        const encodedMsg = encodeURIComponent(message);
        const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage?chat_id=${telegramChatId}&text=${encodedMsg}&parse_mode=Markdown`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.ok) {
            res.json({ success: true, message: 'Kết nối Telegram thành công!' });
        } else {
            const errMsg = data.description || 'Token hoặc Chat ID không hợp lệ';
            res.json({ success: false, message: errMsg });
        }
    } catch (error) {
        console.error('Telegram test error:', error);
        res.status(500).json({ success: false, message: 'Không thể kết nối Telegram. Vui lòng kiểm tra lại Token và Chat ID.' });
    }
};

module.exports = { showSettings, saveSettings, resetSettings, getSecurityConfig, testTelegram };
