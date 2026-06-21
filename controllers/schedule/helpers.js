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
        select: 'title filePath thumbnailUrl'
        // Bỏ match userId để populate luôn trả về video (kể cả userId khác)
        // vì video có thể được share giữa các schedule của cùng user
    },
    {
        path: 'shopeeLinks',
        select: 'title imageUrl shopeeUrl'
    },
    {
        path: 'targetGroupSourceChannelId',
        select: 'accountName accountType platform avatarUrl followers'
    }
];

const normalizeIdArray = (value) => {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value) return [value];
    return [];
};

const validateScheduledAt = (scheduledAt, { allowPastForFailed = false } = {}) => {
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
        // Vẫn chặn nếu lịch failed → user phải chọn lại thời gian hiện tại/tương lai
        // để scheduler chạy lại lịch này. Không cho phép giữ thời gian quá khứ.
        return 'Không thể lên lịch vào thời gian trong quá khứ. Vui lòng chọn thời gian hiện tại hoặc tương lai';
    }

    return null;
};

function normalizeScheduleAccounts(accounts = []) {
    // Chấp nhận cả string đơn, array các string, hoặc mảng ObjectId
    if (accounts == null) return [];
    if (!Array.isArray(accounts)) accounts = [accounts];
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

/**
 * Resolve absolute filesystem path từ URL/path tương đối
 * - Nếu là absolute path tồn tại -> giữ nguyên
 * - Nếu là relative path -> join với USER_DATA_DIR
 * @returns {string} absolute path, hoặc '' nếu input rỗng
 */
function resolveLocalVideoPath(videoPath = '') {
    const raw = String(videoPath || '').trim();
    if (!raw) return '';
    const path = require('path');
    const fs = require('fs');

    if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;
    const cleaned = raw.replace(/^\/+/, '');
    const resolved = path.join(global.USER_DATA_DIR || path.join(__dirname, '..', '..'), cleaned);
    return resolved;
}

/**
 * Lấy duration (giây) của video bằng ffprobe (nếu có) hoặc fallback dùng fluent-ffmpeg.
 * @returns {Promise<number>} duration in seconds, hoặc 0 nếu không đọc được
 */
async function getVideoDurationSeconds(videoPath = '') {
    const ffmpeg = require('fluent-ffmpeg');
    const absolutePath = resolveLocalVideoPath(videoPath);
    if (!absolutePath) return 0;
    const fs = require('fs');
    if (!fs.existsSync(absolutePath)) return 0;

    return new Promise((resolve) => {
        try {
            ffmpeg.ffprobe(absolutePath, (err, data) => {
                if (err || !data?.format?.duration) {
                    console.log(`[video-validator] ffprobe lỗi cho ${absolutePath}: ${err?.message || 'no duration'}`);
                    return resolve(0);
                }
                const duration = Number(data.format.duration);
                resolve(Number.isFinite(duration) ? duration : 0);
            });
        } catch (e) {
            console.log(`[video-validator] exception: ${e.message}`);
            resolve(0);
        }
    });
}

/**
 * Validate video theo giới hạn từng nền tảng.
 * - Threads (TH): tối đa 5 phút (300s)
 * - Pinterest Idea Pin (PI): 3-60 giây
 *
 * @param {string[]} platforms - mảng platform codes (VD: ['TH', 'PI'])
 * @param {string} videoPath - URL/path tương đối của video
 * @returns {Promise<{valid: boolean, message?: string, platform?: string, duration?: number}>}
 */
async function validateVideoForPlatforms(platforms = [], videoPath = '') {
    const hasTH = platforms.includes('TH');
    const hasPI = platforms.includes('PI');

    // Chỉ check nếu user chọn TH hoặc PI
    if (!hasTH && !hasPI) return { valid: true };

    if (!videoPath) {
        return { valid: false, message: 'Vui lòng chọn video cho lịch Reels' };
    }

    const duration = await getVideoDurationSeconds(videoPath);
    if (duration === 0) {
        // Không đọc được duration -> bỏ qua check, để scheduler tự phát hiện lỗi khi upload
        return { valid: true };
    }

    if (hasTH && duration > 300) {
        return {
            valid: false,
            platform: 'TH',
            duration,
            message: `Threads chỉ hỗ trợ video tối đa 5 phút (300 giây). Video hiện tại dài ${Math.round(duration)} giây.`
        };
    }

    if (hasPI) {
        if (duration < 3) {
            return {
                valid: false,
                platform: 'PI',
                duration,
                message: `Pinterest Idea Pin yêu cầu video tối thiểu 3 giây. Video hiện tại dài ${Math.round(duration)} giây.`
            };
        }
        if (duration > 60) {
            return {
                valid: false,
                platform: 'PI',
                duration,
                message: `Pinterest Idea Pin chỉ hỗ trợ video tối đa 60 giây. Video hiện tại dài ${Math.round(duration)} giây.`
            };
        }
    }

    return { valid: true, duration };
}

/**
 * Kiểm tra user có tài khoản Pinterest Business (cần thiết cho Idea Pin).
 * @returns {Promise<{valid: boolean, message?: string}>}
 */
async function validatePinterestBusinessAccount(userId, normalizedAccountIds = []) {
    if (!normalizedAccountIds.length) return { valid: true };
    const accounts = await Channel.find({
        _id: { $in: normalizedAccountIds },
        userId,
        platform: 'PI'
    })
        .select('_id accountType accountName')
        .lean();

    if (!accounts.length) return { valid: true };

    const nonBusiness = accounts.filter(ch => {
        const type = String(ch.accountType || '').trim();
        return type && type.toLowerCase() !== 'business';
    });

    if (nonBusiness.length > 0) {
        const names = nonBusiness.map(ch => ch.accountName).join(', ');
        return {
            valid: false,
            message: `Pinterest Idea Pin chỉ hỗ trợ tài khoản Business. Tài khoản "${names}" không phải Business.`
        };
    }
    return { valid: true };
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

    // Build per-platform status từ platformResults (lưu trong DB khi chạy schedule)
    const platformResults = Array.isArray(schedule.platformResults) ? schedule.platformResults : [];
    const platformStatusMap = {};
    platformResults.forEach(r => {
        if (r && r.platform) platformStatusMap[r.platform] = r;
    });
    const platforms = Array.isArray(schedule.platforms) ? schedule.platforms : [];
    const platformDetailsWithStatus = platforms.map((code) => ({
        code,
        label: PLATFORM_LABELS[code] || code,
        className: `platform-${String(code || '').toLowerCase()}`,
        success: platformStatusMap[code] ? platformStatusMap[code].success !== false : true,
        error: platformStatusMap[code]?.error || '',
        publishedUrl: platformStatusMap[code]?.publishedUrl || ''
    }));

    // Tính overall status cho row
    const isFailed = schedule.status === 'failed';
    const isPartial = schedule.status === 'posted' && platformDetailsWithStatus.some(p => !p.success);
    let archiveStatusLabel = 'Đã đăng';
    let archiveStatusClassName = 'status-posted';
    if (isFailed) {
        archiveStatusLabel = 'Thất bại';
        archiveStatusClassName = 'status-failed';
    } else if (isPartial) {
        archiveStatusLabel = 'Một phần';
        archiveStatusClassName = 'status-partial';
    }

    return {
        ...row,
        platformDetails: platformDetailsWithStatus,
        publishedAtIso,
        publishedAtDayKey,
        publishedAtMonthKey,
        publishedAtLabel: row.scheduledAtLabel,
        archiveTypeLabel: row.typeLabel,
        archiveStatusLabel,
        archiveStatusClassName,
        isPartial,
        isFailed,
        platformResults
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
        tiktoks: rows.filter(item => item.type === 'tiktok').length,
        fb: rows.filter(item => item.platforms?.includes('FB') || item.platforms?.includes('FR')).length,
        ig: rows.filter(item => item.platforms?.includes('IG')).length,
        tt: rows.filter(item => item.platforms?.includes('TT')).length,
        yt: rows.filter(item => item.platforms?.includes('YT') || item.platforms?.includes('YS')).length,
        th: rows.filter(item => item.platforms?.includes('TH')).length,
        pi: rows.filter(item => item.platforms?.includes('PI')).length,
        partial: rows.filter(item => item.status === 'posted' && Array.isArray(item.platformResults) && item.platformResults.some(r => !r.success)).length,
        failed: rows.filter(item => item.status === 'failed').length,
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
    const mongoose = require('mongoose');
    const userIdObj = userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(String(userId));
    // CHỈ lấy lịch đã đăng thành công (status='posted')
    const schedules = await SchedulePost.find({ userId: userIdObj, status: 'posted' })
        .populate(buildSchedulePopulateOptions(userIdObj))
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
    resolveLocalVideoPath,
    getVideoDurationSeconds,
    validateVideoForPlatforms,
    validatePinterestBusinessAccount,
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