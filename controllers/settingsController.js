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
            openaiApiKey, dataEncryptionEnabled,
            aiProvider, openaiModel,
            openaiCompatibleApiKey, openaiCompatibleBaseUrl, openaiCompatibleModel,
            anthropicApiKey, anthropicModel
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
        if (aiProvider !== undefined) settings.aiProvider = aiProvider;
        if (openaiModel !== undefined) settings.openaiModel = openaiModel;
        if (openaiCompatibleApiKey !== undefined) settings.openaiCompatibleApiKey = prepareSensitiveValue(normalizeEncryptedValue(openaiCompatibleApiKey), encryptionEnabled);
        if (openaiCompatibleBaseUrl !== undefined) settings.openaiCompatibleBaseUrl = openaiCompatibleBaseUrl;
        if (openaiCompatibleModel !== undefined) settings.openaiCompatibleModel = openaiCompatibleModel;
        if (anthropicApiKey !== undefined) settings.anthropicApiKey = prepareSensitiveValue(normalizeEncryptedValue(anthropicApiKey), encryptionEnabled);
        if (anthropicModel !== undefined) settings.anthropicModel = anthropicModel;
        settings.dataEncryptionEnabled = encryptionEnabled;
        if (req.file) settings.watermarkUrl = '/uploads/images/' + req.file.filename;

        const sensitiveFields = [
            'telegramBotToken',
            'telegramChatId',
            'driveClientId',
            'driveApiKey',
            'driveFolderId',
            'openaiApiKey',
            'openaiCompatibleApiKey',
            'anthropicApiKey'
        ];

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

// API: Tạo mã liên kết Telegram (one-time token, hết hạn 10 phút)
const crypto = require('crypto');
const { startTelegramBot } = require('../services/telegramBotService');

const generateTelegramLinkToken = async (req, res) => {
    try {
        const token = crypto.randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await require('../models/User').updateOne(
            { _id: req.user._id },
            { $set: { telegramLinkToken: token } }
        );
        // Reset link state
        const User = require('../models/User');
        await User.updateOne(
            { _id: req.user._id },
            { $set: { telegramChatId: '', telegramLinked: false } }
        );
        res.json({ success: true, token, expiresAt, botUsername: await getBotUsername() });
    } catch (error) {
        console.error('Generate Telegram Link Token Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const getTelegramLinkStatus = async (req, res) => {
    try {
        const User = require('../models/User');
        const user = await User.findById(req.user._id).select('telegramChatId telegramLinked telegramUsername telegramLinkedAt').lean();
        res.json({
            success: true,
            linked: !!(user && user.telegramLinked),
            chatId: user?.telegramChatId || '',
            username: user?.telegramUsername || '',
            linkedAt: user?.telegramLinkedAt || null,
            botUsername: await getBotUsername()
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const unlinkTelegram = async (req, res) => {
    try {
        const User = require('../models/User');
        await User.updateOne(
            { _id: req.user._id },
            { $set: { telegramChatId: '', telegramLinked: false, telegramLinkToken: '' } }
        );
        res.json({ success: true, message: 'Đã hủy liên kết Telegram' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

async function getBotUsername() {
    try {
        const { getBot } = require('../services/telegramBotService');
        const bot = getBot();
        if (bot && bot.botInfo) return bot.botInfo.username;
    } catch (e) { /* ignore */ }
    return null;
}

async function testAiConnection(req, res) {
    try {
        const { provider, apiKey, baseUrl, model } = req.body;
        if (!apiKey) {
            return res.status(400).json({ success: false, message: 'Thiếu API Key' });
        }

        if (provider === 'openai') {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                return res.json({ success: false, message: errData.error?.message || 'API Key không hợp lệ' });
            }
            return res.json({ success: true, message: 'Kết nối OpenAI thành công!' });
        }

        if (provider === 'openai-compatible') {
            if (!baseUrl) {
                return res.status(400).json({ success: false, message: 'Thiếu Base URL' });
            }
            try {
                const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
                    headers: { 'Authorization': `Bearer ${apiKey}` }
                });
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    return res.json({ success: false, message: errData.error?.message || 'Kết nối thất bại' });
                }
                return res.json({ success: true, message: 'Kết nối thành công!' });
            } catch (fetchErr) {
                return res.json({ success: false, message: 'Không thể kết nối tới Base URL: ' + fetchErr.message });
            }
        }

        if (provider === 'anthropic') {
            try {
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: model || 'claude-3-haiku-20240307',
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'Hi' }]
                    })
                });
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    return res.json({ success: false, message: errData.error?.message || 'API Key không hợp lệ' });
                }
                return res.json({ success: true, message: 'Kết nối Anthropic thành công!' });
            } catch (fetchErr) {
                return res.json({ success: false, message: 'Lỗi kết nối: ' + fetchErr.message });
            }
        }

        return res.status(400).json({ success: false, message: 'Provider không hợp lệ' });
    } catch (error) {
        console.error('Test AI Connection Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi server: ' + error.message });
    }
}

module.exports = {
    showSettings,
    saveSettings,
    resetSettings,
    getSecurityConfig,
    testTelegram,
    testAiConnection,
    generateTelegramLinkToken,
    getTelegramLinkStatus,
    unlinkTelegram
};
