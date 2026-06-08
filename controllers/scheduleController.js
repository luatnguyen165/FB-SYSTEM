// controllers/scheduleController.js
const fs = require('fs');
const path = require('path');
const SchedulePost = require('../models/SchedulePost');
const Channel = require('../models/Channel');
const ShopeeLink = require('../models/ShopeeLink');
const Video = require('../models/Video');
const { chromium } = require('playwright');
const { getJoinedFacebookGroupsCached, runBotUploadInstantWithAccount } = require('../services/facebookPlaywrightService');
const { getReelsScheduleRunnerStatus, runReelsScheduleRunnerNow, runReelsScheduleByIdNow, pokeReelsScheduleRunner } = require('../services/reelsScheduleRunner');
const { sendTelegramNotification, NOTIFICATION_TYPES } = require('../services/telegramService');
const { emitScheduleUpdate } = require('../services/socketService');

const buildSchedulePopulateOptions = (userId) => [
    {
        path: 'videoId',
        select: 'title filePath thumbnailUrl',
        match: { userId }
    },
    {
        path: 'shopeeLinks',
        select: 'title imageUrl shopeeUrl',
        match: { userId }
    },
    {
        path: 'targetGroupSourceChannelId',
        select: 'accountName accountType platform avatarUrl followers',
        match: { userId }
    }
];

const normalizeIdArray = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value) return [value];
    return [];
};

const validateScheduledAt = (scheduledAt) => {
    if (!scheduledAt) {
        return 'Vui lòng chọn thời gian đăng';
    }

    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) {
        return 'Thời gian đăng không hợp lệ';
    }

    // Cho phép chênh lệch nhỏ theo phút để người dùng chọn "thời gian hiện tại" trên UI
    // mà không bị chặn do seconds đã trôi qua trong lúc submit.
    const SCHEDULE_GRACE_WINDOW_MS = 60 * 1000;
    if (date.getTime() < Date.now() - SCHEDULE_GRACE_WINDOW_MS) {
        return 'Không thể lên lịch vào thời gian trong quá khứ';
    }

    return null;
};

function normalizeScheduleAccounts(accounts = []) {
    if (!Array.isArray(accounts)) return [];
    return accounts.map(value => String(value || '').trim()).filter(Boolean);
}

function normalizeReelsAccountType(value) {
    const type = String(value || '').trim();
    if (type === 'Fanpage') return 'Fanpage';
    if (type === 'Nhà sáng tạo') return 'Nhà sáng tạo';
    return 'Cá nhân';
}

function isFacebookPersonalChannel(channel = {}) {
    return String(channel.platform || '').trim() === 'FB'
        && normalizeReelsAccountType(channel.accountType || 'Cá nhân') === 'Cá nhân';
}

async function getOwnedChannelsByIds(userId, channelIds = []) {
    const normalizedIds = normalizeScheduleAccounts(channelIds);
    if (!normalizedIds.length) return [];

    return Channel.find({ _id: { $in: normalizedIds }, userId })
        .select('_id platform accountType accountName')
        .lean();
}

function normalizeScheduleVideoPath(videoPath = '') {
    const raw = String(videoPath || '').trim();
    if (!raw) return '';

    if (raw.startsWith('/uploads/videos/')) return raw;
    if (raw.startsWith('uploads/videos/')) return `/${raw}`;
    return raw;
}

function isMongoObjectId(value) {
    return /^[a-fA-F0-9]{24}$/.test(String(value || '').trim());
}

async function getActiveFacebookChannelForUser(userId) {
    return Channel.findOne({ userId, platform: 'FB', isEnabled: true })
        .select('_id accountName accountType profileUrl')
        .sort({ createdAt: -1 })
        .lean();
}

async function resolveShopeeLinksForUpload(userId, shopeeLinksInput) {
    const normalized = normalizeIdArray(shopeeLinksInput);
    if (!normalized.length) return [];

    const ids = normalized.filter(isMongoObjectId);
    const directValues = normalized.filter(value => !isMongoObjectId(value));

    let resolvedLinks = [];
    if (ids.length) {
        resolvedLinks = await ShopeeLink.find({ _id: { $in: ids }, userId })
            .select('_id title shopeeUrl')
            .lean();
    }

    const resolvedUrls = resolvedLinks
        .map(link => link?.shopeeUrl || '')
        .filter(Boolean);

    return [
        ...resolvedUrls,
        ...directValues
    ].filter(Boolean);
}

const PLATFORM_LABELS = {
    FB: 'Facebook',
    FR: 'Facebook Reels',
    IG: 'Instagram',
    TT: 'TikTok Video',
    TA: 'TikTok Affiliate',
    YT: 'YouTube',
    YS: 'YouTube Short'
};

function formatDateTimeVi(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

function getScheduleStatusMeta(status) {
    switch (status) {
        case 'posted':
            return { label: 'Đã đăng', className: 'status-posted' };
        case 'failed':
            return { label: 'Thất bại', className: 'status-failed' };
        default:
            return { label: 'Chưa đăng', className: 'status-pending' };
    }
}

function buildScheduleManagerRow(schedule) {
    const platforms = Array.isArray(schedule.platforms) ? schedule.platforms.filter(Boolean) : [];
    const accounts = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    const shopeeLinks = Array.isArray(schedule.shopeeLinks) ? schedule.shopeeLinks : [];
    const shopeeLinkIds = shopeeLinks.map(link => (link && typeof link === 'object') ? String(link._id || '') : String(link || '')).filter(Boolean);
    const videoId = schedule.videoId && typeof schedule.videoId === 'object' ? String(schedule.videoId._id || '') : String(schedule.videoId || '');
    const sourceChannelId = schedule.targetGroupSourceChannelId && typeof schedule.targetGroupSourceChannelId === 'object'
        ? String(schedule.targetGroupSourceChannelId._id || '')
        : String(schedule.targetGroupSourceChannelId || '');
    const platformDetails = platforms.map((code) => ({
        code,
        label: PLATFORM_LABELS[code] || code,
        className: `platform-${String(code || '').toLowerCase()}`
    }));
    const statusMeta = getScheduleStatusMeta(schedule.status);
    const videoTitle = schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId.title || '—' : '—';
    const sourceChannelName = schedule.targetGroupSourceChannelId && typeof schedule.targetGroupSourceChannelId === 'object'
        ? schedule.targetGroupSourceChannelId.accountName || '—'
        : '—';

    const searchText = [
        schedule.caption,
        schedule.type,
        statusMeta.label,
        platforms.join(' '),
        accounts.join(' '),
        schedule.targetGroupName,
        schedule.targetGroupId,
        schedule.targetGroupUrl,
        videoTitle,
        sourceChannelName
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return {
        ...schedule,
        platformDetails,
        statusLabel: statusMeta.label,
        statusClassName: statusMeta.className,
        typeLabel: schedule.type === 'reels' ? 'Reels' : 'Post',
        scheduledAtLabel: formatDateTimeVi(schedule.scheduledAt),
        createdAtLabel: formatDateTimeVi(schedule.createdAt),
        platformFilter: platforms.join(','),
        accountsLabel: accounts.length ? accounts.join(', ') : '—',
        platformLabel: platforms.length ? platforms.map((code) => PLATFORM_LABELS[code] || code).join(', ') : '—',
        videoTitle,
        shopeeLinksCount: shopeeLinks.length,
        shopeeLinkIds,
        videoId,
        sourceChannelId,
        sourceChannelName,
        searchText,
        images: Array.isArray(schedule.images) ? schedule.images : []
    };
}

function buildPublishedArchiveRow(schedule) {
    const row = buildScheduleManagerRow(schedule);
    const publishedAt = schedule.scheduledAt ? new Date(schedule.scheduledAt) : null;
    const publishedAtIso = publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt.toISOString() : '';
    const publishedAtDayKey = publishedAt ? `${publishedAt.getFullYear()}-${String(publishedAt.getMonth() + 1).padStart(2, '0')}-${String(publishedAt.getDate()).padStart(2, '0')}` : '';
    const publishedAtMonthKey = publishedAt ? `${publishedAt.getFullYear()}-${String(publishedAt.getMonth() + 1).padStart(2, '0')}` : '';
    return {
        ...row,
        publishedAtIso,
        publishedAtDayKey,
        publishedAtMonthKey,
        publishedAtLabel: row.scheduledAtLabel,
        archiveTypeLabel: row.typeLabel,
        archiveStatusLabel: 'Đã đăng'
    };
}

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildPublishedArchiveStats(rows = []) {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return {
        total: rows.length,
        posts: rows.filter(item => item.type === 'post').length,
        reels: rows.filter(item => item.type === 'reels').length,
        fb: rows.filter(item => item.platforms?.includes('FB')).length,
        ig: rows.filter(item => item.platforms?.includes('IG')).length,
        tt: rows.filter(item => item.platforms?.includes('TT')).length,
        yt: rows.filter(item => item.platforms?.includes('YT')).length,
        today: rows.filter(item => item.publishedAtDayKey === todayKey).length,
        month: rows.filter(item => item.publishedAtMonthKey === monthKey).length
    };
}

function filterPublishedArchiveRows(rows = [], filters = {}) {
    const keyword = String(filters.q || '').trim().toLowerCase();
    const selectedType = String(filters.type || 'all');
    const selectedPlatform = String(filters.platform || 'all');
    const selectedDay = String(filters.day || '').trim();
    const selectedMonth = String(filters.month || '').trim();

    return rows.filter((row) => {
        const rowPlatforms = String(row.platforms?.join(',') || '').split(',').filter(Boolean);
        const matchesKeyword = !keyword || String(row.searchText || '').includes(keyword);
        const matchesType = selectedType === 'all' || String(row.type || '') === selectedType;
        const matchesPlatform = selectedPlatform === 'all' || rowPlatforms.includes(selectedPlatform);
        const matchesDay = !selectedDay || String(row.publishedAtDayKey || '') === selectedDay;
        const matchesMonth = !selectedMonth || String(row.publishedAtMonthKey || '') === selectedMonth;

        return matchesKeyword && matchesType && matchesPlatform && matchesDay && matchesMonth;
    });
}

async function getPublishedArchiveRows(userId) {
    const schedules = await SchedulePost.find({ userId, status: 'posted' })
        .populate(buildSchedulePopulateOptions(userId))
        .sort({ scheduledAt: -1 })
        .lean();

    return schedules.map(buildPublishedArchiveRow);
}

function buildExportFilename(prefix, ext) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    return `${prefix}-${stamp}.${ext}`;
}

function buildArchiveExportHtml(rows = [], title = 'Thư Viện Đã Đăng') {
    const rowHtml = rows.map((row, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.publishedAtLabel)}</td>
            <td>${escapeHtml(row.typeLabel)}</td>
            <td>${escapeHtml(row.platformLabel)}</td>
            <td>${escapeHtml(row.caption || '—')}</td>
            <td>${escapeHtml(row.accountsLabel || '—')}</td>
            <td>${escapeHtml(row.targetGroupName || row.sourceChannelName || '—')}</td>
            <td>${escapeHtml(row.videoTitle || '—')}</td>
            <td>${escapeHtml(String(row.shopeeLinksCount || 0))}</td>
        </tr>
    `).join('');

    const stats = buildPublishedArchiveStats(rows);

    return `<!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(title)}</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin: 0 0 8px; font-size: 22px; }
            .meta { color: #64748b; margin-bottom: 18px; }
            .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
            .stat { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
            .stat span { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
            .stat strong { font-size: 18px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; }
            th { background: #f8fafc; text-align: left; }
            .small { color: #64748b; font-size: 11px; }
        </style>
    </head>
    <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Xuất lúc: ${escapeHtml(new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()))}</div>
        <div class="stats">
            <div class="stat"><span>Tổng đã đăng</span><strong>${stats.total}</strong></div>
            <div class="stat"><span>Post</span><strong>${stats.posts}</strong></div>
            <div class="stat"><span>Reels</span><strong>${stats.reels}</strong></div>
            <div class="stat"><span>Hôm nay</span><strong>${stats.today}</strong></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Ngày đăng</th>
                    <th>Loại</th>
                    <th>Nền tảng</th>
                    <th>Nội dung</th>
                    <th>Tài khoản</th>
                    <th>Group/Nguồn</th>
                    <th>Video</th>
                    <th>Link</th>
                </tr>
            </thead>
            <tbody>
                ${rowHtml || `<tr><td colspan="9" class="small">Không có dữ liệu</td></tr>`}
            </tbody>
        </table>
    </body>
    </html>`;
}

async function exportPublishedArchive(req, res) {
    try {
        const format = String(req.query.format || 'xls').toLowerCase() === 'pdf' ? 'pdf' : 'xls';
        const rows = filterPublishedArchiveRows(await getPublishedArchiveRows(req.user._id), req.query);
        const html = buildArchiveExportHtml(rows, 'Thư Viện Đã Đăng');

        if (format === 'pdf') {
            const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
            try {
                const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
                await page.setContent(html, { waitUntil: 'load' });
                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    landscape: true,
                    printBackground: true,
                    margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' }
                });

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${buildExportFilename('thu-vien-da-dang', 'pdf')}"`);
                return res.send(pdfBuffer);
            } finally {
                await browser.close().catch(() => {});
            }
        }

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${buildExportFilename('thu-vien-da-dang', 'xls')}"`);
        return res.send(html);
    } catch (error) {
        console.error('Export Published Archive Error:', error);
        return res.status(500).send(`Lỗi export: ${error.message}`);
    }
}

// Hiển thị trang lịch Post
const showSchedulePost = async (req, res) => {
    try {
        const posts = await SchedulePost.find({ userId: req.user._id, type: 'post' }).sort({ scheduledAt: 1 }).lean();
        const channels = await Channel.find({ userId: req.user._id, isEnabled: true }).lean();
        const facebookChannels = await Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true }).sort({ createdAt: -1 }).lean();
        res.render('schedule-post', { user: req.user, posts, channels, facebookChannels });
    } catch (error) {
        console.error('Show Schedule Post Error:', error);
        res.render('schedule-post', { user: req.user, posts: [], channels: [], facebookChannels: [] });
    }
};

// Hiển thị trang quản lý lịch trình
const showScheduleManager = async (req, res) => {
    try {
        const [schedules, channels, facebookChannels, videos, shopeeLinks] = await Promise.all([
            SchedulePost.find({ userId: req.user._id })
                .populate(buildSchedulePopulateOptions(req.user._id))
                .sort({ scheduledAt: -1 })
                .lean(),
            Channel.find({ userId: req.user._id, isEnabled: true })
                .select('_id platform accountName accountType avatarUrl followers')
                .sort({ createdAt: -1 })
                .lean(),
            Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true })
                .select('_id accountName accountType avatarUrl followers')
                .sort({ createdAt: -1 })
                .lean(),
            Video.find({ userId: req.user._id })
                .select('_id title thumbnailUrl status createdAt')
                .sort({ createdAt: -1 })
                .lean(),
            ShopeeLink.find({ userId: req.user._id })
                .select('_id title shopeeUrl imageUrl status createdAt')
                .sort({ createdAt: -1 })
                .lean()
        ]);

        const scheduleRows = schedules.map(buildScheduleManagerRow);
        const stats = {
            total: scheduleRows.length,
            pending: scheduleRows.filter(item => item.status === 'pending').length,
            posted: scheduleRows.filter(item => item.status === 'posted').length,
            failed: scheduleRows.filter(item => item.status === 'failed').length
        };

        res.render('schedule-manager', { user: req.user, schedules: scheduleRows, stats, channels, facebookChannels, videos, shopeeLinks });
    } catch (error) {
        console.error('Show Schedule Manager Error:', error);
        res.render('schedule-manager', {
            user: req.user,
            schedules: [],
            stats: { total: 0, pending: 0, posted: 0, failed: 0 },
            channels: [],
            facebookChannels: [],
            videos: [],
            shopeeLinks: []
        });
    }
};

// Hiển thị thư viện bài viết/reels đã đăng
const showPublishedArchive = async (req, res) => {
    try {
        const schedules = await SchedulePost.find({ userId: req.user._id, status: 'posted' })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .sort({ scheduledAt: -1 })
            .lean();

        const archiveRows = schedules.map(buildPublishedArchiveRow);
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const stats = {
            total: archiveRows.length,
            posts: archiveRows.filter(item => item.type === 'post').length,
            reels: archiveRows.filter(item => item.type === 'reels').length,
            fb: archiveRows.filter(item => item.platforms?.includes('FB')).length,
            ig: archiveRows.filter(item => item.platforms?.includes('IG')).length,
            tt: archiveRows.filter(item => item.platforms?.includes('TT')).length,
            yt: archiveRows.filter(item => item.platforms?.includes('YT')).length,
            today: archiveRows.filter(item => item.publishedAtDayKey === todayKey).length,
            month: archiveRows.filter(item => item.publishedAtMonthKey === monthKey).length
        };

        res.render('schedule-archive', { user: req.user, schedules: archiveRows, stats });
    } catch (error) {
        console.error('Show Published Archive Error:', error);
        res.render('schedule-archive', {
            user: req.user,
            schedules: [],
            stats: { total: 0, posts: 0, reels: 0, fb: 0, ig: 0, tt: 0, yt: 0, today: 0, month: 0 }
        });
    }
};

// Hiển thị trang lịch Reels
const showScheduleReels = async (req, res) => {
    try {
        const posts = await SchedulePost.find({ userId: req.user._id, type: 'reels' }).sort({ scheduledAt: 1 }).lean();
        const channels = await Channel.find({ userId: req.user._id, isEnabled: true }).lean();
        res.render('reels', { user: req.user, posts, channels });
    } catch (error) {
        console.error('Show Schedule Reels Error:', error);
        res.render('reels', { user: req.user, posts: [], channels: [] });
    }
};

// API: Đăng Reels ngay bằng file video + content + shopeeLinks (nếu có)
const uploadInstantReels = async (req, res) => {
    let uploadedFilePath = '';

    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file video' });
        }

        const content = String(req.body.content || req.body.caption || '').trim();
        if (!content) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập content' });
        }

        const facebookChannel = await getActiveFacebookChannelForUser(req.user._id);
        if (!facebookChannel) {
            return res.status(404).json({ success: false, message: 'Bạn chưa có tài khoản Facebook đang bật để đăng Reels' });
        }

        uploadedFilePath = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'videos', req.file.filename);
        if (!fs.existsSync(uploadedFilePath)) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy file video đã upload trên server' });
        }

        const shopeeLinks = await resolveShopeeLinksForUpload(req.user._id, req.body.shopeeLinks);

        const result = await runBotUploadInstantWithAccount({
            userId: req.user._id,
            accountName: facebookChannel.accountName,
            accountType: facebookChannel.accountType || 'Cá nhân',
            post: {
                videoPath: uploadedFilePath,
                content,
                shopeeLinks,
                profileUrl: facebookChannel.profileUrl || ''
            },
            headless: false
        });

        // Gửi Telegram thông báo đăng Reels thành công
        sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.SUCCESS, {
            scheduleTitle: content || '—',
            platform: 'FB',
            time: new Date().toLocaleString('vi-VN'),
            caption: content || ''
        }).catch(() => {});

        return res.json({
            success: true,
            message: result.message,
            data: {
                facebookChannel,
                shopeeLinksUsed: result.shopeeLinksUsed || [],
                videoFilename: req.file.filename
            }
        });
    } catch (error) {
        console.error('Upload Instant Reels Error:', error);

        // Gửi Telegram thông báo thất bại
        sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.ERROR, {
            scheduleTitle: req.body.content || req.body.caption || '—',
            platform: 'FB',
            error: error.message,
            scheduleId: ''
        }).catch(() => {});

        return res.status(500).json({ success: false, message: 'Lỗi upload Reels: ' + error.message });
    }
};

// API: Upload video local riêng cho Reels (không tạo record trong kho video)
const uploadLocalReelsVideo = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file video' });
        }

        const videoPath = `/uploads/videos/${req.file.filename}`;
        return res.json({
            success: true,
            message: 'Đã upload video local cho Reels',
            video: {
                title: req.file.originalname,
                filePath: videoPath,
                fileSize: req.file.size,
                filename: req.file.filename,
                thumbnailUrl: ''
            }
        });
    } catch (error) {
        console.error('Upload Local Reels Video Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi upload video local: ' + error.message });
    }
};

// API: Tạo lịch đăng mới
const createSchedule = async (req, res) => {
    try {
        let platforms = req.body.platforms;
        if (typeof platforms === 'string') {
            platforms = platforms ? [platforms] : [];
        } else if (!Array.isArray(platforms)) {
            platforms = [];
        }

        const { type, caption, scheduledAt, accounts, videoId, videoPath, videoTitle, videoSize, shopeeLinks, targetGroupId, targetGroupIds, targetGroupSourceChannelId } = req.body;
        if (!scheduledAt) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn thời gian đăng' });
        }

        const scheduledAtError = validateScheduledAt(scheduledAt);
        if (scheduledAtError) {
            return res.status(400).json({ success: false, message: scheduledAtError });
        }

        const nextType = type || 'post';
        const requestedVideoId = videoId || undefined;
        const requestedShopeeLinkIds = normalizeIdArray(shopeeLinks);
        const normalizedAccounts = normalizeScheduleAccounts(accounts);

        if (nextType === 'reels' && normalizedAccounts.length) {
            const selectedAccounts = await getOwnedChannelsByIds(req.user._id, normalizedAccounts);
            const selectedAccountIds = new Set(selectedAccounts.map(channel => String(channel._id)));
            const missingAccountIds = normalizedAccounts.filter(channelId => !selectedAccountIds.has(String(channelId)));

            if (missingAccountIds.length) {
                return res.status(404).json({ success: false, message: 'Một số tài khoản đã chọn không tồn tại hoặc không thuộc tài khoản hiện tại' });
            }

            if (selectedAccounts.some(isFacebookPersonalChannel)) {
                return res.status(400).json({ success: false, message: 'Tài khoản Facebook cá nhân không hỗ trợ đăng Reels. Vui lòng chọn Fanpage hoặc Nhà sáng tạo' });
            }
        }

        let ownedVideoId;
        if (nextType === 'reels' && requestedVideoId) {
            const ownedVideo = await Video.findOne({ _id: requestedVideoId, userId: req.user._id }).select('_id').lean();
            if (!ownedVideo) {
                return res.status(404).json({ success: false, message: 'Video không tồn tại hoặc không thuộc tài khoản hiện tại' });
            }
            ownedVideoId = ownedVideo._id;
        }

        const normalizedVideoPath = normalizeScheduleVideoPath(videoPath || '');

        let ownedShopeeLinkIds = [];
        if (requestedShopeeLinkIds.length > 0) {
            ownedShopeeLinkIds = await ShopeeLink.distinct('_id', {
                _id: { $in: requestedShopeeLinkIds },
                userId: req.user._id
            });
        }

        // Xử lý target groups - chỉ áp dụng cho type='post'
        let selectedTargetGroups = [];
        let selectedSourceChannel = null;

        if (nextType === 'post') {
        // Parse targetGroupIds nếu là JSON string
        let targetGroupIdsArray = [];
        if (targetGroupIds) {
            try {
                targetGroupIdsArray = typeof targetGroupIds === 'string' ? JSON.parse(targetGroupIds) : targetGroupIds;
            } catch (e) {
                targetGroupIdsArray = [];
            }
        }

        // Nếu không có targetGroupIds, dùng targetGroupId cũ (tương thích ngược)
        if (targetGroupIdsArray.length === 0 && targetGroupId) {
            targetGroupIdsArray = [targetGroupId];
        }

        const hasTargetGroupSelection = targetGroupIdsArray.length > 0 || targetGroupSourceChannelId;

        if (hasTargetGroupSelection) {
            // Cần có source channel để lấy groups
            if (!targetGroupSourceChannelId) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook nguồn' });
            }

            if (targetGroupIdsArray.length === 0) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một group để đăng bài' });
            }

            selectedSourceChannel = await Channel.findOne({
                _id: targetGroupSourceChannelId,
                userId: req.user._id,
                platform: 'FB',
                isEnabled: true
            }).select('_id accountName accountType').lean();

            if (!selectedSourceChannel) {
                return res.status(404).json({ success: false, message: 'Tài khoản Facebook nguồn không tồn tại hoặc đã bị tắt' });
            }

            const { groups: joinedGroups } = await getJoinedFacebookGroupsCached({
                userId: req.user._id,
                channelId: selectedSourceChannel._id,
                accountName: selectedSourceChannel.accountName,
                accountType: selectedSourceChannel.accountType || 'Cá nhân'
            });

            // Validate từng group được chọn
            for (const groupKey of targetGroupIdsArray) {
                const foundGroup = joinedGroups.find(group =>
                    String(group.groupId) === String(groupKey) ||
                    String(group.groupUrl) === String(groupKey)
                );
                if (foundGroup) {
                    selectedTargetGroups.push(foundGroup);
                }
            }

            if (selectedTargetGroups.length === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy group nào trong danh sách đã chọn' });
            }
        }
        }

        let images = [];
        if (req.files && req.files.length > 0) {
            images = req.files.map(f => '/uploads/images/' + f.filename);
        }
        
        const schedule = await SchedulePost.create({
            userId: req.user._id,
            type: nextType,
            caption: caption || '',
            images,
            videoId: ownedVideoId,
            videoPath: nextType === 'reels' ? normalizedVideoPath : '',
            videoTitle: nextType === 'reels' ? String(videoTitle || '').trim() : '',
            videoSize: nextType === 'reels' ? String(videoSize || '').trim() : '',
            shopeeLinks: ownedShopeeLinkIds,
            targetGroupSourceChannelId: selectedSourceChannel?._id,
            targetGroupIds: selectedTargetGroups.map(g => g.groupUrl || g.groupId), // Lưu nhiều groups
            targetGroupId: selectedTargetGroups[0]?.groupId || '', // Legacy
            targetGroupName: selectedTargetGroups[0]?.groupName || '', // Lấy group đầu tiên làm tên hiển thị
            targetGroupUrl: selectedTargetGroups[0]?.groupUrl || '', // Legacy
            scheduledAt: new Date(scheduledAt),
            platforms: platforms || [],
            accounts: normalizedAccounts
        });

        if (nextType === 'reels' && schedule.shopeeLinks?.length) {
            await ShopeeLink.updateMany(
                { _id: { $in: schedule.shopeeLinks }, userId: req.user._id },
                { $set: { status: 'attached' } }
            );
        }

        if (nextType === 'reels') {
            console.log(`[Schedule API] createSchedule => armed reels wakeup for ${schedule._id} at ${schedule.scheduledAt.toISOString()}`);
            await pokeReelsScheduleRunner().catch(() => {});
        }

        sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.PROGRESS, {
            action: 'Tạo lịch đăng mới',
            scheduleTitle: schedule.caption || schedule.videoTitle || '—',
            platform: Array.isArray(schedule.platforms) ? schedule.platforms[0] : 'FB',
            time: formatDateTimeVi(schedule.scheduledAt)
        }).catch(() => {});

        await schedule.populate(buildSchedulePopulateOptions(req.user._id));
        res.json({ success: true, message: 'Đã lên lịch thành công!', schedule });
    } catch (error) {
        console.error('Create Schedule Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Cập nhật lịch đăng
const updateSchedule = async (req, res) => {
    // console.log('api ', req.body);
    try {
        let platforms = req.body.platforms;
        if (typeof platforms === 'string') {
            platforms = platforms ? [platforms] : [];
        } else if (!Array.isArray(platforms)) {
            platforms = [];
        }

        const { scheduleId, type, status, caption, scheduledAt, accounts, videoId, videoPath, videoTitle, videoSize, shopeeLinks, targetGroupSourceChannelId } = req.body;
        const targetGroupIds = req.body.targetGroupIds || req.body.targetGroupId || [];
        if (!scheduleId) {
            return res.status(400).json({ success: false, message: 'Thiếu scheduleId' });
        }
        if (!/^[0-9a-fA-F]{24}$/.test(scheduleId)) {
            return res.status(400).json({ success: false, message: 'scheduleId không hợp lệ' });
        }
        if (!scheduledAt) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn thời gian đăng' });
        }

        const scheduledAtError = validateScheduledAt(scheduledAt);
        if (scheduledAtError) {
            return res.status(400).json({ success: false, message: scheduledAtError });
        }

        const schedule = await SchedulePost.findOne({ _id: scheduleId, userId: req.user._id });
        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch đăng' });
        }

        if (schedule.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Lịch đã chạy rồi, không thể sửa nữa' });
        }

        const nextType = type || schedule.type;
        const nextShopeeLinkIds = normalizeIdArray(shopeeLinks);
        const normalizedAccounts = normalizeScheduleAccounts(accounts);

        if (nextType === 'reels' && normalizedAccounts.length) {
            const selectedAccounts = await getOwnedChannelsByIds(req.user._id, normalizedAccounts);
            const selectedAccountIds = new Set(selectedAccounts.map(channel => String(channel._id)));
            const missingAccountIds = normalizedAccounts.filter(channelId => !selectedAccountIds.has(String(channelId)));

            if (missingAccountIds.length) {
                return res.status(404).json({ success: false, message: 'Một số tài khoản đã chọn không tồn tại hoặc không thuộc tài khoản hiện tại' });
            }

            if (selectedAccounts.some(isFacebookPersonalChannel)) {
                return res.status(400).json({ success: false, message: 'Tài khoản Facebook cá nhân không hỗ trợ đăng Reels. Vui lòng chọn Fanpage hoặc Nhà sáng tạo' });
            }
        }

        let ownedVideoId = schedule.videoId;
        let nextVideoPath = normalizeScheduleVideoPath(videoPath || schedule.videoPath || '');
        let nextVideoTitle = String(videoTitle || schedule.videoTitle || '').trim();
        let nextVideoSize = String(videoSize || schedule.videoSize || '').trim();
        if (nextType === 'reels') {
            const requestedVideoId = videoId || schedule.videoId;
            if (!requestedVideoId && !nextVideoPath) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn video cho lịch Reels' });
            }

            if (requestedVideoId) {
                const ownedVideo = await Video.findOne({ _id: requestedVideoId, userId: req.user._id }).select('_id').lean();
                if (!ownedVideo) {
                    return res.status(404).json({ success: false, message: 'Video không tồn tại hoặc không thuộc tài khoản hiện tại' });
                }
                ownedVideoId = ownedVideo._id;
                nextVideoPath = '';
                nextVideoTitle = '';
                nextVideoSize = '';
            }
        }

        let ownedShopeeLinkIds = [];
        if (nextShopeeLinkIds.length > 0) {
            ownedShopeeLinkIds = await ShopeeLink.distinct('_id', {
                _id: { $in: nextShopeeLinkIds },
                userId: req.user._id
            });
        }

        let selectedTargetGroups = [];
        let selectedSourceChannel = null;
        const hasTargetGroupSelection = nextType === 'post';   
  
        if (hasTargetGroupSelection) {
            if (!targetGroupSourceChannelId || !targetGroupIds) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook và group đích' });
            }

            selectedSourceChannel = await Channel.findOne({
                _id: targetGroupSourceChannelId,
                userId: req.user._id,
                platform: 'FB',
                isEnabled: true
            }).select('_id accountName accountType').lean();

            if (!selectedSourceChannel) {
                return res.status(404).json({ success: false, message: 'Tài khoản Facebook nguồn không tồn tại hoặc đã bị tắt' });
            }

            const { groups: joinedGroups } = await getJoinedFacebookGroupsCached(
                req.user._id,
                selectedSourceChannel._id
            );

            const targetGroupIdArray = typeof targetGroupIds === 'string' 
                ? (targetGroupIds.startsWith('[') ? JSON.parse(targetGroupIds) : [targetGroupIds])
                : (Array.isArray(targetGroupIds) ? targetGroupIds : [targetGroupIds]);

            selectedTargetGroups = joinedGroups.filter(group => 
                targetGroupIdArray.includes(String(group.groupId)) || 
                targetGroupIdArray.includes(String(group.groupUrl))
            );
            if (!selectedTargetGroups.length) {
                return res.status(404).json({ success: false, message: 'Group được chọn không thuộc danh sách group mà tài khoản này đã tham gia' });
            }
        }

        schedule.type = nextType;
        if (status && ['pending', 'posted', 'failed'].includes(status)) {
            schedule.status = status;
        }
        schedule.caption = caption || '';
        schedule.scheduledAt = new Date(scheduledAt);
        schedule.platforms = platforms || [];
        schedule.accounts = normalizedAccounts;
        schedule.targetGroupSourceChannelId = selectedSourceChannel?._id;
        schedule.targetGroupIds = selectedTargetGroups.map(g => g.groupUrl || g.groupId); // Lưu nhiều groups dạng array
        schedule.targetGroupId = selectedTargetGroups[0]?.groupId || ''; // Legacy
        schedule.targetGroupName = selectedTargetGroups[0]?.groupName || '';
        schedule.targetGroupUrl = selectedTargetGroups[0]?.groupUrl || '';
        schedule.publishedUrl = '';
        if (nextType === 'reels') {
            schedule.videoId = ownedVideoId;
            schedule.videoPath = nextVideoPath;
            schedule.videoTitle = nextVideoTitle;
            schedule.videoSize = nextVideoSize;
            schedule.images = [];
            schedule.shopeeLinks = ownedShopeeLinkIds;
        } else {
            const existingImages = req.body.existingImages ? (Array.isArray(req.body.existingImages) ? req.body.existingImages : [req.body.existingImages]) : [];
            const newImagePaths = req.files && req.files.length > 0 ? req.files.map(f => '/uploads/images/' + f.filename) : [];
            schedule.images = [...existingImages, ...newImagePaths];
            schedule.videoId = undefined;
            schedule.videoPath = '';
            schedule.videoTitle = '';
            schedule.videoSize = '';
            schedule.shopeeLinks = ownedShopeeLinkIds;
        }

        if (nextType === 'reels' && req.file) {
            schedule.videoPath = '/uploads/reels/' + req.file.filename;
        }

        await schedule.save();

        if (schedule.shopeeLinks?.length) {
            await ShopeeLink.updateMany(
                { _id: { $in: schedule.shopeeLinks }, userId: req.user._id },
                { $set: { status: 'attached' } }
            );
        }

        if (schedule.type === 'reels') {
            console.log(`[Schedule API] updateSchedule => armed reels wakeup for ${schedule._id} at ${schedule.scheduledAt.toISOString()}`);
            await pokeReelsScheduleRunner().catch(() => {});
        }

        await schedule.populate(buildSchedulePopulateOptions(req.user._id));
        res.json({ success: true, message: 'Đã cập nhật lịch đăng!', schedule });
    } catch (error) {
        console.error('Update Schedule Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Lấy danh sách lịch đăng theo tháng (JSON)
const getSchedulesAPI = async (req, res) => {
    try {
        const { type, month, year } = req.query;
        const filter = { userId: req.user._id };
        if (type) filter.type = type;
        if (month && year) {
            const start = new Date(year, month - 1, 1);
            const end = new Date(year, month, 0, 23, 59, 59);
            filter.scheduledAt = { $gte: start, $lte: end };
        }
        const schedules = await SchedulePost.find(filter)
            .populate(buildSchedulePopulateOptions(req.user._id))
            .sort({ scheduledAt: 1 })
            .lean();
        res.json({ success: true, schedules });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Lấy chi tiết một lịch đăng theo ID
const getScheduleByIdAPI = async (req, res) => {
    try {
        const schedule = await SchedulePost.findOne({ _id: req.params.id, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();
        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch đăng' });
        }

        res.json({ success: true, schedule });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Xóa lịch đăng
const deleteSchedule = async (req, res) => {
    try {
        const result = await SchedulePost.deleteOne({ _id: req.params.id, userId: req.user._id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        res.json({ success: true, message: 'Đã xóa lịch đăng' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Lấy lịch đăng theo ngày
const getScheduleByDateAPI = async (req, res) => {
    try {
        const { type, date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: 'Thiếu ngày cần tra cứu' });

        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        const filter = {
            userId: req.user._id,
            scheduledAt: { $gte: start, $lte: end }
        };
        if (type) filter.type = type;

        const schedules = await SchedulePost.find(filter)
            .populate(buildSchedulePopulateOptions(req.user._id))
            .sort({ scheduledAt: 1 })
            .lean();
        res.json({ success: true, schedules });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getReelsRunnerStatusAPI = async (req, res) => {
    try {
        return res.json({
            success: true,
            status: getReelsScheduleRunnerStatus()
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const runReelsRunnerNowAPI = async (req, res) => {
    try {
        await runReelsScheduleRunnerNow();
        return res.json({ success: true, message: 'Đã chạy thử worker Reels' });
    } catch (error) {
        console.error('Run Reels Runner Now Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

const runReelsScheduleByIdNowAPI = async (req, res) => {
    try {
        const scheduleId = req.params.id;
        const result = await runReelsScheduleByIdNow(scheduleId, { persistStatus: true, markAsPosted: true });
        const updatedSchedule = await SchedulePost.findOne({ _id: scheduleId, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();

        // Emit socket realtime update với status thực tế từ DB
        if (updatedSchedule) {
            emitScheduleUpdate(req.user._id, {
                _id: updatedSchedule._id,
                status: updatedSchedule.status || (result?.success ? 'posted' : 'failed'),
                publishedUrl: updatedSchedule.publishedUrl || ''
            });
        }

        const isSuccess = result?.success && updatedSchedule?.status === 'posted';
        return res.json({
            success: isSuccess,
            message: isSuccess ? (result?.message || 'Đã đăng thành công') : 'Đăng bài thất bại',
            data: {
                ...result,
                schedule: updatedSchedule
            }
        });
    } catch (error) {
        console.error('Run Reels Schedule By Id Now Error:', error);

        // Emit socket realtime update for failure
        try {
            emitScheduleUpdate(req.user._id, {
                _id: req.params.id,
                status: 'failed',
                publishedUrl: ''
            });
        } catch (emitErr) {
            console.error('Emit failed update error:', emitErr);
        }

        return res.status(500).json({ success: false, message: error.message });
    }
};

const runScheduleByIdNowAPI = async (req, res) => {
    const scheduleId = req.params.id;

    try {
        const result = await runReelsScheduleByIdNow(scheduleId, { persistStatus: true, markAsPosted: true });
        const updatedSchedule = await SchedulePost.findOne({ _id: scheduleId, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();

        // Emit socket realtime update với status thực tế từ DB
        if (updatedSchedule) {
            const actualStatus = updatedSchedule.status || (result?.success ? 'posted' : 'failed');
            emitScheduleUpdate(req.user._id, {
                _id: updatedSchedule._id,
                status: actualStatus,
                publishedUrl: updatedSchedule.publishedUrl || ''
            });

            if (actualStatus === 'posted') {
                sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.SUCCESS, {
                    scheduleTitle: updatedSchedule?.caption || updatedSchedule?.videoTitle || '—',
                    platform: Array.isArray(updatedSchedule?.platforms) ? updatedSchedule.platforms[0] : 'FB',
                    time: formatDateTimeVi(updatedSchedule?.scheduledAt),
                    caption: updatedSchedule?.caption || ''
                }).catch(() => {});
            } else {
                sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.ERROR, {
                    scheduleTitle: updatedSchedule?.caption || updatedSchedule?.videoTitle || '—',
                    platform: Array.isArray(updatedSchedule?.platforms) ? updatedSchedule.platforms[0] : 'FB',
                    error: 'Đăng bài thất bại',
                    scheduleId
                }).catch(() => {});
            }
        }

        const isSuccess = result?.success && updatedSchedule?.status === 'posted';
        return res.json({
            success: isSuccess,
            message: isSuccess ? (result?.message || 'Đã đăng thành công') : 'Đăng bài thất bại',
            data: {
                ...result,
                schedule: updatedSchedule
            }
        });
    } catch (error) {
        console.error('Run Schedule By Id Now Error:', error);
        
        // Emit socket realtime update for failure
        try {
            emitScheduleUpdate(req.user._id, {
                _id: scheduleId,
                status: 'failed',
                publishedUrl: ''
            });
        } catch (emitErr) {
            console.error('Emit failed update error:', emitErr);
        }

        const failedSchedule = await SchedulePost.findOne({ _id: scheduleId, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();

        sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.ERROR, {
            scheduleTitle: failedSchedule?.caption || failedSchedule?.videoTitle || '—',
            platform: Array.isArray(failedSchedule?.platforms) ? failedSchedule.platforms[0] : 'FB',
            error: error.message,
            scheduleId
        }).catch(() => {});

        try {
            await SchedulePost.updateOne(
                { _id: scheduleId, userId: req.user._id },
                { $set: { status: 'failed' } }
            );
        } catch (updateError) {
            console.error('Run Schedule By Id Now Status Update Error:', updateError);
        }

        return res.status(500).json({ success: false, message: error.message });
    }
};

// Hiển thị trang quét Group Facebook
const showScheduleGroups = async (req, res) => {
    try {
        const { channelId } = req.query;
        const facebookChannels = await Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true })
            .select('_id accountName accountType avatarUrl')
            .sort({ createdAt: -1 })
            .lean();

        let currentChannelId = channelId || null;
        let groups = [];
        let groupsStats = {
            total: 0,
            lastScanDate: null,
            source: null
        };
        let currentAccount = null;

        if (currentChannelId) {
            const channel = facebookChannels.find(c => String(c._id) === String(currentChannelId));
            if (channel) {
                currentAccount = channel;
            }
        }

        if (!currentChannelId && facebookChannels.length > 0) {
            currentChannelId = String(facebookChannels[0]._id);
            currentAccount = facebookChannels[0];
        }

        if (currentChannelId) {
            const FacebookGroupCache = require('../models/FacebookGroupCache');
            const cachedGroups = await FacebookGroupCache.findOne({
                userId: req.user._id,
                channelId: currentChannelId
            }).lean();

            if (cachedGroups && cachedGroups.groups) {
                groups = cachedGroups.groups;
                groupsStats = {
                    total: groups.length,
                    lastScanDate: cachedGroups.updatedAt 
                        ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(cachedGroups.updatedAt))
                        : null,
                    source: 'cache'
                };
            }
        }

        res.render('schedule-groups', {
            user: req.user,
            facebookChannels,
            groups,
            groupsStats,
            currentAccount,
            currentChannelId
        });
    } catch (error) {
        console.error('Show Schedule Groups Error:', error);
        res.render('schedule-groups', {
            user: req.user,
            facebookChannels: [],
            groups: [],
            groupsStats: { total: 0, lastScanDate: null, source: null },
            currentAccount: null,
            currentChannelId: null
        });
    }
};

// API: Quét group Facebook
const scanFacebookGroupsAPI = async (req, res) => {
    try {
        const { channelId, scanMode = 'fast' } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook' });
        }

        const channel = await Channel.findOne({
            _id: channelId,
            userId: req.user._id,
            platform: 'FB',
            isEnabled: true
        }).lean();

        if (!channel) {
            return res.status(404).json({ success: false, message: 'Tài khoản Facebook không tồn tại hoặc đã bị tắt' });
        }

        const { getJoinedFacebookGroupsCached: getGroupsCached } = require('../services/facebookPlaywrightService');
        
        const result = await getGroupsCached({
            userId: req.user._id,
            channelId: channel._id,
            accountName: channel.accountName,
            accountType: channel.accountType || 'Cá nhân',
            forceRefresh: true,
            scanMode: scanMode === 'deep' ? 'deep' : 'fast'
        });

        return res.json({
            success: true,
            message: `Đã quét thành công ${result.groups.length} group`,
            groupsCount: result.groups.length,
            source: result.source,
            updatedAt: result.updatedAt
        });
    } catch (error) {
        console.error('Scan Facebook Groups Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// API: Quét group từ 1 group cụ thể - có merge data và lưu ngay
const scrapeGroupMembersAPI = async (req, res) => {
    let context = null;
    let page = null;
    try {
        const { channelId, groupUrl, scanMode = 'fast' } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook' });
        }

        if (!groupUrl) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập link group Facebook' });
        }

        // Validate URL
        let parsedUrl;
        try {
            parsedUrl = new URL(groupUrl);
            if (!/^(www\.)?facebook\.com$/i.test(parsedUrl.hostname)) {
                return res.status(400).json({ success: false, message: 'Link không hợp lệ. Vui lòng nhập link Facebook.' });
            }
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Link không hợp lệ.' });
        }

        const channel = await Channel.findOne({
            _id: channelId,
            userId: req.user._id,
            platform: 'FB',
            isEnabled: true
        }).lean();

        if (!channel) {
            return res.status(404).json({ success: false, message: 'Tài khoản Facebook không tồn tại hoặc đã bị tắt' });
        }

        const { 
            getOrOpenFacebookContext,
            scrapeGroupsFromUrl,
            persistFacebookGroupCache 
        } = require('../services/facebookPlaywrightService');

        const { context: browserContext, sessionKey, isExternal } = await getOrOpenFacebookContext(
            req.user._id,
            channel.accountName,
            channel.accountType || 'Cá nhân',
            { headless: true }
        );

        context = browserContext;

        const existingPages = context.pages();
        if (existingPages.length > 0 && !existingPages[0].isClosed()) {
            page = existingPages[0];
        } else {
            page = await context.newPage();
        }
        
        const isDeepMode = scanMode === 'deep';
        const maxScrollRounds = isDeepMode ? 15 : 5;
        const maxGroups = isDeepMode ? 0 : 500;

        console.log(`[Group Scrape API] Starting scrape from: ${groupUrl}, deep: ${isDeepMode}, maxGroups: ${maxGroups || 'unlimited'}`);

        // Lấy dữ liệu cũ từ DB
        const FacebookGroupCache = require('../models/FacebookGroupCache');
        const existingCache = await FacebookGroupCache.findOne({ userId: req.user._id, channelId: channel._id }).lean();
        const existingGroupsMap = new Map();
        if (existingCache?.groups) {
            existingCache.groups.forEach(g => existingGroupsMap.set(g.groupId, g));
            console.log(`[Group Scrape API] Co ${existingGroupsMap.size} groups trong DB`);
        }

        // Callback lưu groups vào DB ngay khi có groups mới
        const saveGroupsToDB = async (allGroups, newGroups) => {
            try {
                const mergedGroupsMap = new Map(existingGroupsMap);
                allGroups.forEach(g => mergedGroupsMap.set(g.groupId, g));
                
                const mergedGroups = Array.from(mergedGroupsMap.values())
                    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));
                
                await persistFacebookGroupCache({
                    userId: req.user._id,
                    channelId: channel._id,
                    accountName: channel.accountName,
                    accountType: channel.accountType || 'Cá nhân',
                    groups: mergedGroups
                });
                
                console.log(`[Group Scrape API] Da luu ${mergedGroups.length} groups vao DB`);
            } catch (e) {
                console.error(`[Group Scrape API] Loi khi luu vao DB: ${e.message}`);
            }
        };

        // Scrape groups mới từ URL
        const newGroups = await scrapeGroupsFromUrl({
            page,
            targetUrl: groupUrl,
            maxScrollRounds,
            scrollDelayMs: 3000,
            scrollAmount: 3000,
            onGroupsFound: saveGroupsToDB,
            maxGroups
        });

        console.log(`[Group Scrape API] Da quet ${newGroups.length} groups moi tu ${groupUrl}`);

        // Merge dữ liệu lần cuối
        const mergedGroupsMap = new Map(existingGroupsMap);
        newGroups.forEach(g => mergedGroupsMap.set(g.groupId, g));

        const finalGroups = Array.from(mergedGroupsMap.values())
            .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));

        // Lưu final data
        const savedCache = await persistFacebookGroupCache({
            userId: req.user._id,
            channelId: channel._id,
            accountName: channel.accountName,
            accountType: channel.accountType || 'Cá nhân',
            groups: finalGroups
        });

        console.log(`[Group Scrape API] Saved ${finalGroups.length} groups to database`);

        return res.json({
            success: true,
            message: `Đã quét ${newGroups.length} group mới, tổng ${finalGroups.length} group`,
            groupsCount: finalGroups.length,
            newGroupsCount: newGroups.length,
            source: 'scrape-url',
            updatedAt: savedCache?.updatedAt || new Date(),
            groups: finalGroups.slice(0, 10)
        });

    } catch (error) {
        console.error('Scrape Group Members API Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (context) {
            await context.close().catch(() => {});
        }
    }
};

// API: Quét group từ trang joins (nơi show các group để join) - có báo cáo tiến trình
const scrapeGroupsFromJoinsAPI = async (req, res) => {
    let context = null;
    let page = null;
    
    try {
        const { channelId, scanMode = 'fast' } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook' });
        }

        const channel = await Channel.findOne({
            _id: channelId,
            userId: req.user._id,
            platform: 'FB',
            isEnabled: true
        }).lean();

        if (!channel) {
            return res.status(404).json({ success: false, message: 'Tài khoản Facebook không tồn tại hoặc đã bị tắt' });
        }

        const { 
            getOrOpenFacebookContext,
            scrapeGroupsFromJoinsPage,
            persistFacebookGroupCache 
        } = require('../services/facebookPlaywrightService');

        const { context: browserContext, sessionKey, isExternal,userSessionDir } = await getOrOpenFacebookContext(
            req.user._id,
            channel.accountName,
            channel.accountType || 'Cá nhân',
            channel.platform,
            { headless: false } // Để false để dễ debug, có thể đổi thành true khi chạy chính thức
        );
        console.log(`[Group Scrape Joins API>>>>>>>>] Opened userSessionDir context for userSessionDir: ${sessionKey},  userSessionDir: ${userSessionDir}`);
        context = browserContext;

        const existingPages = context.pages();
        if (existingPages.length > 0 && !existingPages[0].isClosed()) {
            page = existingPages[0];
        } else {
            page = await context.newPage();
        }
        
        const isDeepMode = scanMode === 'deep';
        const maxScrollRounds = isDeepMode ? 15 : 5;
        const maxGroups = isDeepMode ? 0 : 500;

        // console.log(`[Group Scrape Joins API] Starting scrape, deep: ${isDeepMode}, maxGroups: ${maxGroups || 'unlimited'}`);

        // Lấy dữ liệu cũ từ DB
        const FacebookGroupCache = require('../models/FacebookGroupCache');
        const existingCache = await FacebookGroupCache.findOne({ userId: req.user._id, channelId: channel._id }).lean();
        const existingGroupsMap = new Map();
        if (existingCache?.groups) {
            existingCache.groups.forEach(g => existingGroupsMap.set(g.groupId, g));
            console.log(`[Group Scrape] Co ${existingGroupsMap.size} groups trong DB`);
        }

        // Callback gửi tiến trình qua console
        let lastFoundCount = 0;
        const sendProgress = (data) => {
            if (data.found !== lastFoundCount) {
                lastFoundCount = data.found;
                console.log(`[Group Scrape Progress] ${data.message} (${data.found} groups)`);
            }
        };

        // Callback lưu groups vào DB ngay khi có groups mới
        const saveGroupsToDB = async (allGroups, newGroups) => {
            try {
                // Merge với dữ liệu cũ
                const mergedGroupsMap = new Map(existingGroupsMap);
                allGroups.forEach(g => mergedGroupsMap.set(g.groupId, g));
                
                const mergedGroups = Array.from(mergedGroupsMap.values())
                    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));
                
                // Lưu vào DB ngay
                await persistFacebookGroupCache({
                    userId: req.user._id,
                    channelId: channel._id,
                    accountName: channel.accountName,
                    accountType: channel.accountType || 'Cá nhân',
                    groups: mergedGroups
                });
                
                console.log(`[Group Scrape] Da luu ${mergedGroups.length} groups vao DB`);
            } catch (e) {
                console.error(`[Group Scrape] Loi khi luu vao DB: ${e.message}`);
            }
        };

        // Quét groups mới
        const newGroups = await scrapeGroupsFromJoinsPage({
            page,
            maxScrollRounds,
            scrollDelayMs: 3000,
            onProgress: sendProgress,
            onGroupsFound: saveGroupsToDB,
            maxGroups
        });

        console.log(`[Group Scrape Joins API] Da quet ${newGroups.length} groups moi`);

        // Merge dữ liệu lần cuối
        const mergedGroupsMap = new Map(existingGroupsMap);
        newGroups.forEach(g => mergedGroupsMap.set(g.groupId, g));

        const finalGroups = Array.from(mergedGroupsMap.values())
            .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));

        // Lưu final data
        const savedCache = await persistFacebookGroupCache({
            userId: req.user._id,
            channelId: channel._id,
            accountName: channel.accountName,
            accountType: channel.accountType || 'Cá nhân',
            groups: finalGroups
        });

        console.log(`[Group Scrape Joins API] Saved ${finalGroups.length} groups to database`);

        return res.json({
            success: true,
            message: `Đã quét ${newGroups.length} group mới, tổng ${finalGroups.length} group`,
            groupsCount: finalGroups.length,
            newGroupsCount: newGroups.length,
            source: 'scrape-joins',
            updatedAt: savedCache?.updatedAt || new Date(),
            groups: finalGroups.slice(0, 10)
        });

    } catch (error) {
        console.error('Scrape Groups From Joins API Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (context) {
            await context.close().catch(() => {});
        }
    }
};

// API: Lấy danh sách groups cho polling
const getGroupsAPI = async (req, res) => {
    try {
        console.log('Get Groups API called with query:', req.query);
        const { channelId } = req.query;
        
        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Thiếu channelId' });
        }

        const FacebookGroupCache = require('../models/FacebookGroupCache');
        const cache = await FacebookGroupCache.findOne({ 
            userId: req.user._id, 
            channelId 
        }).lean();

        if (!cache || !cache.groups) {
            return res.json({ success: true, groups: [] });
        }

        return res.json({ 
            success: true, 
            groups: cache.groups,
            count: cache.groups.length 
        });
    } catch (error) {
        console.error('Get Groups API Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { 
    showSchedulePost, 
    showScheduleReels, 
    showScheduleManager, 
    showPublishedArchive, 
    exportPublishedArchive, 
    uploadInstantReels, 
    uploadLocalReelsVideo, 
    createSchedule, 
    updateSchedule, 
    getSchedulesAPI, 
    getScheduleByIdAPI, 
    getScheduleByDateAPI, 
    getReelsRunnerStatusAPI, 
    runReelsRunnerNowAPI, 
    runReelsScheduleByIdNowAPI, 
    runScheduleByIdNowAPI, 
    deleteSchedule, 
    showScheduleGroups, 
    scanFacebookGroupsAPI,
    scrapeGroupMembersAPI,
    scrapeGroupsFromJoinsAPI,
    getGroupsAPI
};
