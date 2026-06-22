// services/telegramBotService.js
// Telegraf bot: liên kết user + quản lý AiComment qua Telegram commands.
//
// Commands (sau khi /start <linkToken>):
//   /help                          - Hướng dẫn
//   /addcomment <tên> | <text>     - Thêm comment text
//   /addcomment <tên>              - Sau đó reply ảnh/video để thêm comment image/video
//   /listcomments                  - Liệt kê tất cả comment
//   /deletecomment <id|name>       - Xóa comment
//   /togglecomment <id|name>       - Bật/tắt comment
//   /tags <id|name> <tag1,tag2>    - Gán tag cho comment
//
// Lưu ý: chatId được lưu trên User (telegramChatId). Token bot lấy từ Settings.telegramBotToken.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const Settings = require('../models/Settings');
const User = require('../models/User');
const AiComment = require('../models/AiComment');
const { normalizeEncryptedValue } = require('../utils/cryptoVault');

let botInstance = null;
let lastTokenHash = null;

function getProjectRoot() {
    return global.USER_DATA_DIR || path.join(__dirname, '..');
}

function getUploadDir() {
    const dir = path.join(getProjectRoot(), 'uploads', 'telegram-comments');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
    return dir;
}

async function downloadTelegramFile(fileLink, destAbsPath) {
    const res = await fetch(fileLink);
    if (!res.ok) throw new Error('Telegram file download failed: HTTP ' + res.status);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destAbsPath, buffer);
    return buffer.length;
}

function escapeMd(text) {
    return String(text || '').replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function detectTypeFromMime(mime) {
    if (!mime) return 'text';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    return 'text';
}

async function resolveAiComment(userId, idOrName) {
    if (!idOrName) return null;
    const idStr = String(idOrName).trim();
    // Thử match ObjectId
    if (/^[a-f0-9]{24}$/i.test(idStr)) {
        const c = await AiComment.findOne({ _id: idStr, userId }).lean();
        if (c) return c;
    }
    // Fallback: match theo name (case-insensitive, exact)
    const escaped = idStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return AiComment.findOne({ userId, name: { $regex: '^' + escaped + '$', $options: 'i' } }).lean();
}

// ============================================================
// MIDDLEWARE: yêu cầu user đã link Telegram
// ============================================================
async function requireLinked(ctx, next) {
    const chatId = String(ctx.from?.id || '');
    if (!chatId) return;
    const user = await User.findOne({ telegramChatId: chatId, telegramLinked: true }).lean();
    if (!user) {
        return ctx.replyWithMarkdown(
            '⚠️ *Tài khoản Telegram chưa liên kết.*\n\n' +
            'Vào web → *Settings* → *Telegram* → bấm "Tạo mã liên kết" → copy mã.\n' +
            'Sau đó gửi lại cho bot: `/start <mã>`\n\n' +
            '_(Mã chỉ dùng được 1 lần và hết hạn sau 10 phút)_'
        );
    }
    ctx.state.user = user;
    ctx.state.userId = user._id;
    return next();
}

// ============================================================
// COMMAND HANDLERS
// ============================================================
async function cmdStart(ctx) {
    const text = ctx.message?.text || '';
    const match = text.match(/^\/start(?:\s+(.+))?$/);
    const token = match && match[1] ? match[1].trim() : '';

    if (!token) {
        return ctx.replyWithMarkdown(
            '👋 *Chào mừng đến với ReelsFlow AI Bot!*\n\n' +
            'Để liên kết tài khoản:\n' +
            '1. Vào web → *Settings* → *Telegram*\n' +
            '2. Bấm "Tạo mã liên kết"\n' +
            '3. Gửi mã cho bot: `/start <mã>`\n\n' +
            'Gõ /help để xem các lệnh.'
        );
    }

    const user = await User.findOne({ telegramLinkToken: token });
    if (!user) {
        return ctx.replyWithMarkdown('❌ *Mã liên kết không hợp lệ hoặc đã hết hạn.* Vui lòng tạo mã mới ở web.');
    }

    // One-time use: clear token + link
    user.telegramChatId = String(ctx.from.id);
    user.telegramLinked = true;
    user.telegramUsername = ctx.from.username || '';
    user.telegramLinkedAt = new Date();
    user.telegramLinkToken = '';
    await user.save();

    return ctx.replyWithMarkdown(
        '✅ *Liên kết thành công!*\n\n' +
        'Tài khoản Telegram của bạn đã được liên kết với user *' + escapeMd(user.username) + '*.\n\n' +
        'Gõ /help để xem các lệnh có thể dùng.'
    );
}

async function cmdHelp(ctx) {
    return ctx.replyWithMarkdown(
        '🤖 *ReelsFlow AI - Telegram Bot*\n\n' +
        '*Quản lý Comment:*\n' +
        '• `/addcomment <tên> | <nội dung>` — thêm comment text\n' +
        '• `/addcomment <tên>` rồi reply ảnh/video — thêm comment image/video\n' +
        '• `/listcomments` — xem danh sách\n' +
        '• `/deletecomment <id|tên>` — xóa\n' +
        '• `/togglecomment <id|tên>` — bật/tắt\n' +
        '• `/tags <id|tên> <tag1,tag2>` — gán tag\n\n' +
        '_Mẹo: có thể thay ID bằng tên comment. Ví dụ `/deletecomment BĐS 1`_'
    );
}

async function cmdAddComment(ctx) {
    const userId = ctx.state.userId;
    const text = ctx.message?.text || '';
    const body = text.replace(/^\/addcomment(@\w+)?\s*/i, '').trim();

    if (!body) {
        return ctx.replyWithMarkdown(
            '📝 *Cách dùng:*\n' +
            '• Text: `/addcomment <tên> | <nội dung>`\n' +
            '• Ảnh/Video: `/addcomment <tên>` rồi reply ảnh/video\n\n' +
            '_Ví dụ:_ `/addcomment BĐS Hà Nội | Liên hệ mình để được tư vấn miễn phí!`_'
        );
    }

    // Parse "<tên> | <content>"
    const sepIdx = body.indexOf('|');
    let name, content;
    if (sepIdx > 0) {
        name = body.substring(0, sepIdx).trim();
        content = body.substring(sepIdx + 1).trim();
    } else {
        name = body;
        content = '';
    }

    if (!name) return ctx.reply('❌ Thiếu tên comment.');

    if (content) {
        // Tạo text comment luôn
        const count = await AiComment.countDocuments({ userId });
        const c = await AiComment.create({
            userId, name, type: 'text', content, caption: '', isActive: true, order: count + 1
        });
        return ctx.replyWithMarkdown(
            '✅ *Đã thêm comment text:*\n' +
            '• ID: `' + c._id + '`\n' +
            '• Tên: ' + escapeMd(name) + '\n' +
            '• Nội dung: ' + escapeMd(content.substring(0, 80)) + (content.length > 80 ? '...' : '')
        );
    }

    // Không có content → hỏi reply ảnh/video
    ctx.session = ctx.session || {};
    ctx.session.pendingCommentName = name;
    return ctx.replyWithMarkdown(
        '📎 *Đang chờ file cho comment "' + escapeMd(name) + '"*\n\n' +
        'Reply tin nhắn này bằng ảnh hoặc video để hoàn tất.\n' +
        'Gõ /cancel để hủy.'
    );
}

async function cmdListComments(ctx) {
    const userId = ctx.state.userId;
    const items = await AiComment.find({ userId }).sort({ order: 1 }).lean();
    if (items.length === 0) {
        return ctx.reply('📭 Chưa có comment nào. Gõ /addcomment để thêm.');
    }
    const lines = items.map(function (c, i) {
        const status = c.isActive ? '🟢' : '⚪';
        const typeIcon = c.type === 'text' ? '📝' : (c.type === 'image' ? '🖼' : '🎬');
        const tags = (c.tags && c.tags.length) ? ' [' + c.tags.join(',') + ']' : '';
        return status + ' ' + typeIcon + ' `' + c._id + '` ' + escapeMd(c.name || '(không tên)') + tags;
    });
    const header = '📋 *Danh sách comment (' + items.length + '):*\n\n';
    return ctx.replyWithMarkdown(header + lines.join('\n'));
}

async function cmdDeleteComment(ctx) {
    const userId = ctx.state.userId;
    const text = ctx.message?.text || '';
    const idOrName = text.replace(/^\/deletecomment(@\w+)?\s*/i, '').trim();
    if (!idOrName) return ctx.reply('❌ Cú pháp: `/deletecomment <id|tên>`');
    const c = await resolveAiComment(userId, idOrName);
    if (!c) return ctx.reply('❌ Không tìm thấy comment: ' + idOrName);
    await AiComment.deleteOne({ _id: c._id, userId });
    return ctx.replyWithMarkdown('🗑 *Đã xóa:* ' + escapeMd(c.name || c._id));
}

async function cmdToggleComment(ctx) {
    const userId = ctx.state.userId;
    const text = ctx.message?.text || '';
    const idOrName = text.replace(/^\/togglecomment(@\w+)?\s*/i, '').trim();
    if (!idOrName) return ctx.reply('❌ Cú pháp: `/togglecomment <id|tên>`');
    const c = await resolveAiComment(userId, idOrName);
    if (!c) return ctx.reply('❌ Không tìm thấy comment: ' + idOrName);
    const updated = await AiComment.findOneAndUpdate(
        { _id: c._id, userId },
        [{ $set: { isActive: { $not: '$isActive' } } }],
        { new: true }
    ).lean();
    return ctx.replyWithMarkdown(
        (updated.isActive ? '🟢 *Đã bật:* ' : '⚪ *Đã tắt:* ') + escapeMd(updated.name || updated._id)
    );
}

async function cmdTags(ctx) {
    const userId = ctx.state.userId;
    const text = ctx.message?.text || '';
    const body = text.replace(/^\/tags(@\w+)?\s*/i, '').trim();
    const m = body.match(/^(\S+)\s+(.+)$/);
    if (!m) return ctx.reply('❌ Cú pháp: `/tags <id|tên> <tag1,tag2,...>`');
    const c = await resolveAiComment(userId, m[1]);
    if (!c) return ctx.reply('❌ Không tìm thấy comment: ' + m[1]);
    const tags = m[2].split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    await AiComment.updateOne({ _id: c._id, userId }, { $set: { tags } });
    return ctx.replyWithMarkdown('🏷 *Đã gán tag:* ' + escapeMd(c.name) + ' → [' + tags.join(', ') + ']');
}

async function cmdCancel(ctx) {
    ctx.session = ctx.session || {};
    ctx.session.pendingCommentName = null;
    return ctx.reply('✖️ Đã hủy.');
}

// ============================================================
// PHOTO/VIDEO HANDLER (sau khi /addcomment <tên>)
// ============================================================
async function handleMediaMessage(ctx) {
    const userId = ctx.state.userId;
    if (!ctx.session || !ctx.session.pendingCommentName) {
        return; // Không phải flow addcomment → bỏ qua
    }
    const name = ctx.session.pendingCommentName;
    ctx.session.pendingCommentName = null;

    const message = ctx.message;
    let fileId, mime, ext;
    if (message.photo && message.photo.length > 0) {
        fileId = message.photo[message.photo.length - 1].file_id; // ảnh lớn nhất
        mime = 'image/jpeg';
        ext = '.jpg';
    } else if (message.video) {
        fileId = message.video.file_id;
        mime = message.video.mime_type || 'video/mp4';
        ext = '.' + (mime.split('/')[1] || 'mp4');
    } else if (message.document) {
        const doc = message.document;
        const docMime = doc.mime_type || '';
        if (docMime.startsWith('image/') || docMime.startsWith('video/')) {
            fileId = doc.file_id;
            mime = docMime;
            ext = '.' + (doc.file_name?.split('.').pop() || (mime.split('/')[1] || 'bin'));
        }
    }
    if (!fileId) {
        return ctx.reply('❌ Không nhận diện được ảnh/video. Reply bằng ảnh hoặc video.');
    }

    const caption = message.caption || '';
    const type = detectTypeFromMime(mime);
    const fileName = crypto.randomBytes(8).toString('hex') + ext;
    const destAbs = path.join(getUploadDir(), fileName);
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const size = await downloadTelegramFile(fileLink.href, destAbs);
    const relativePath = '/uploads/telegram-comments/' + fileName;

    const count = await AiComment.countDocuments({ userId });
    const c = await AiComment.create({
        userId, name, type, content: relativePath, caption, isActive: true, order: count + 1
    });
    return ctx.replyWithMarkdown(
        '✅ *Đã thêm comment ' + type + ':*\n' +
        '• ID: `' + c._id + '`\n' +
        '• Tên: ' + escapeMd(name) + '\n' +
        '• File: ' + fileName + ' (' + Math.round(size / 1024) + ' KB)\n' +
        (caption ? '• Caption: ' + escapeMd(caption.substring(0, 80)) : '')
    );
}

// ============================================================
// BOOT
// ============================================================
async function getActiveToken() {
    const settings = await Settings.findOne({ telegramBotToken: { $exists: true, $ne: '' } })
        .sort({ updatedAt: -1 })
        .lean();
    if (!settings) return null;
    const token = normalizeEncryptedValue(settings.telegramBotToken || '');
    return token || null;
}

async function startTelegramBot() {
    const token = await getActiveToken();
    if (!token) {
        console.log('[TG Bot] No bot token configured → skip launch');
        return null;
    }
    if (botInstance && lastTokenHash === hashToken(token)) {
        return botInstance; // đã chạy với token này
    }
    if (botInstance) {
        try { await botInstance.stop(); } catch (e) { /* ignore */ }
        botInstance = null;
    }

    const bot = new Telegraf(token);
    botInstance = bot;
    lastTokenHash = hashToken(token);

    // Session đơn giản trong memory (per chatId)
    const sessions = new Map();
    bot.use(function (ctx, next) {
        const chatId = String(ctx.chat?.id || '');
        if (chatId) {
            ctx.session = sessions.get(chatId) || {};
            // Wrap để auto-save
            const orig = ctx.session;
            Object.defineProperty(ctx, 'session', {
                get() { return orig; },
                set(v) { sessions.set(chatId, v); }
            });
        }
        return next();
    });

    // /start (public - để link user)
    bot.start(cmdStart);
    bot.command('help', requireLinked, cmdHelp);
    bot.command('cancel', requireLinked, cmdCancel);
    bot.command('addcomment', requireLinked, cmdAddComment);
    bot.command('listcomments', requireLinked, cmdListComments);
    bot.command('deletecomment', requireLinked, cmdDeleteComment);
    bot.command('togglecomment', requireLinked, cmdToggleComment);
    bot.command('tags', requireLinked, cmdTags);

    // Photo/Video (sau /addcomment)
    bot.on('photo', requireLinked, handleMediaMessage);
    bot.on('video', requireLinked, handleMediaMessage);
    bot.on('document', requireLinked, handleMediaMessage);

    // Catch-all
    bot.on('text', requireLinked, function (ctx) {
        return ctx.reply('Gõ /help để xem danh sách lệnh.');
    });

    try {
        await bot.launch();
        console.log('[TG Bot] Started. Token hash=' + lastTokenHash.substring(0, 8));
    } catch (e) {
        console.error('[TG Bot] Launch failed:', e.message);
        botInstance = null;
        return null;
    }

    process.once('SIGINT', () => bot.stop('SIGINT').catch(() => {}));
    process.once('SIGTERM', () => bot.stop('SIGTERM').catch(() => {}));

    return bot;
}

function hashToken(t) {
    return crypto.createHash('sha256').update(String(t)).digest('hex');
}

function getBot() {
    return botInstance;
}

module.exports = {
    startTelegramBot,
    getBot
};
