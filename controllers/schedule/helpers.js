// controllers/schedule/helpers.js
const SchedulePost = require('../../models/SchedulePost');
const Channel = require('../../models/Channel');
const ShopeeLink = require('../../models/ShopeeLink');
const { restoreRecordForView } = require('../../utils/cryptoVault');

const PLATFORM_LABELS = {
    FB: 'Facebook',
    FR: 'Facebook Reels',
    IG: 'Instagram',
    TT: 'TikTok Video',
    YT: 'YouTube',
    YS: 'YouTube Short'
};

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
    const channel = await Channel.findOne({ userId, platform: 'FB', isEnabled: true })
        .select('_id accountName accountType profileUrl storageStatePath')
        .sort({ createdAt: -1 })
        .lean();
    if (!channel) return null;
    return restoreRecordForView(channel, ['accountName', 'accountType', 'profileUrl', 'storageStatePath']);
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

module.exports = {
    PLATFORM_LABELS,
    buildSchedulePopulateOptions,
    normalizeIdArray,
    validateScheduledAt,
    normalizeScheduleAccounts,
    normalizeReelsAccountType,
    isFacebookPersonalChannel,
    getOwnedChannelsByIds,
    normalizeScheduleVideoPath,
    isMongoObjectId,
    getActiveFacebookChannelForUser,
    resolveShopeeLinksForUpload,
    formatDateTimeVi,
    getScheduleStatusMeta,
    buildScheduleManagerRow,
    buildPublishedArchiveRow,
    escapeHtml,
    buildPublishedArchiveStats,
    filterPublishedArchiveRows,
    getPublishedArchiveRows,
    buildExportFilename
};