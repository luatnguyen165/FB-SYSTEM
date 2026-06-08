// services/telegramService.js
const Settings = require('../models/Settings');
const { normalizeEncryptedValue } = require('../utils/cryptoVault');

const NOTIFICATION_TYPES = {
    SUCCESS: 'success',
    ERROR: 'error',
    PROGRESS: 'progress'
};

async function sendTelegramNotification(userId, type, data) {
    try {
        const settings = await Settings.findOne({ userId }).lean();
        if (!settings) return;

        // Giải mã token và chat ID nếu đang được mã hóa
        const telegramBotToken = normalizeEncryptedValue(settings.telegramBotToken || '');
        const telegramChatId = normalizeEncryptedValue(settings.telegramChatId || '');

        if (!telegramBotToken || !telegramChatId) return;

        if (type === NOTIFICATION_TYPES.SUCCESS) {
            await sendSuccessNotification(telegramBotToken, telegramChatId, data);
        } else if (type === NOTIFICATION_TYPES.ERROR) {
            await sendErrorNotification(telegramBotToken, telegramChatId, data);
        } else if (type === NOTIFICATION_TYPES.PROGRESS) {
            await sendProgressNotification(telegramBotToken, telegramChatId, data);
        }
    } catch (error) {
        console.error('Telegram notification error:', error.message);
    }
}

async function sendSuccessNotification(botToken, chatId, data) {
    const { scheduleTitle, platform, time, caption } = data;
    const platformIcons = { FB: '📘', TT: '🎵', IG: '📸', YT: '📺' };
    const icon = platformIcons[platform] || '✅';
    const platformNames = { FB: 'Facebook', TT: 'TikTok', IG: 'Instagram', YT: 'YouTube' };

    const message = [
        `${icon} *ĐĂNG BÀI THÀNH CÔNG*`,
        ``,
        `*Nền tảng:* ${platformNames[platform] || platform}`,
        `*Tiêu đề:* ${scheduleTitle || 'Không có tiêu đề'}`,
        `*Thời gian:* ${time || '—'}`,
        caption ? `*Caption:* ${caption.substring(0, 100)}${caption.length > 100 ? '...' : ''}` : '',
        ``,
        `📅 *ReelsFlow AI*`
    ].filter(Boolean).join('\n');

    await sendTelegramMessage(botToken, chatId, message);
}

async function sendErrorNotification(botToken, chatId, data) {
    const { scheduleTitle, platform, error, scheduleId } = data;
    const platformIcons = { FB: '📘', TT: '🎵', IG: '📸', YT: '📺' };
    const icon = platformIcons[platform] || '❌';
    const platformNames = { FB: 'Facebook', TT: 'TikTok', IG: 'Instagram', YT: 'YouTube' };

    const message = [
        `🔴 *ĐĂNG BÀI THẤT BẠI*`,
        ``,
        `*Nền tảng:* ${platformNames[platform] || platform}`,
        `*Tiêu đề:* ${scheduleTitle || 'Không có tiêu đề'}`,
        `*Lỗi:* ${error || 'Lỗi không xác định'}`,
        scheduleId ? `*ID:* \`${scheduleId}\`` : '',
        ``,
        `💡 ReelsFlow AI sẽ tự động thử lại sau.`,
        `📅 *ReelsFlow AI*`
    ].filter(Boolean).join('\n');

    await sendTelegramMessage(botToken, chatId, message);
}

async function sendProgressNotification(botToken, chatId, data) {
    const { action, scheduleTitle, platform, time } = data;
    const platformIcons = { FB: '📘', TT: '🎵', IG: '📸', YT: '📺' };
    const icon = platformIcons[platform] || '🔄';
    const platformNames = { FB: 'Facebook', TT: 'TikTok', IG: 'Instagram', YT: 'YouTube' };

    const message = [
        `🔵 *TIẾN TRÌNH MỚI*`,
        ``,
        `*Hành động:* ${action || 'Cập nhật lịch'}`,
        `*Nền tảng:* ${platformNames[platform] || '—'}`,
        scheduleTitle ? `*Tiêu đề:* ${scheduleTitle}` : '',
        time ? `*Thời gian:* ${time}` : '',
        ``,
        `📅 *ReelsFlow AI*`
    ].filter(Boolean).join('\n');

    await sendTelegramMessage(botToken, chatId, message);
}

async function sendTelegramMessage(botToken, chatId, message) {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const body = new URLSearchParams({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
    });

    console.log(`[Telegram] Sending message to chatId=${chatId} (bot token length=${botToken.length})`);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });

    // Log response status trước khi parse JSON
    console.log(`[Telegram] Response status: ${response.status} ${response.statusText}`);

    // Kiểm tra response status code
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[Telegram] HTTP ${response.status} - ${response.statusText}. Body: ${text.substring(0, 200)}`);
        
        // Nếu 404 Not Found - token hoặc chatId không hợp lệ
        if (response.status === 404) {
            console.error(`[Telegram] LỖI: Bot token không hợp lệ hoặc đã bị thu hồi. Vui lòng kiểm tra lại Telegram Bot Token trong Settings.`);
        } else if (response.status === 400) {
            console.error(`[Telegram] LỖI: Chat ID không hợp lệ. Vui lòng kiểm tra lại Telegram Chat ID trong Settings.`);
        }
        return { ok: false, description: `${response.status} ${response.statusText}` };
    }

    const data = await response.json();
    if (!data.ok) {
        console.error('[Telegram] API error:', data.description);
    }
    return data;
}

module.exports = {
    sendTelegramNotification,
    NOTIFICATION_TYPES
};
