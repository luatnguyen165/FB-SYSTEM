const fs = require('fs');
const path = require('path');
const SchedulePost = require('../models/SchedulePost');
const Channel = require('../models/Channel');
const { runBotUploadInstantWithAccount } = require('./facebook/reels');
const { runBotPostGroupInstantWithAccount } = require('./facebookPostGroupService');
const { uploadVideoToTikTok } = require('./tiktokPlaywrightService');
const { uploadVideoToInstagram, uploadImagesToInstagram } = require('./instagramPlaywrightService');
const { postImagesToThreads, uploadVideoToThreads } = require('./threadsPlaywrightService');
const { pinImageToPinterest, uploadVideoToPinterest } = require('./pinterestPlaywrightService');
const { uploadVideoToYouTubeShort } = require('./youtubePlaywrightService');
const { emitScheduleUpdate } = require('./socketService');
const { sendTelegramNotification, NOTIFICATION_TYPES } = require('./telegramService');
const { normalizeEncryptedValue } = require('../utils/cryptoVault');
const { buildFacebookGroupTargetUrl } = require('./common/facebook');

const CHECK_INTERVAL_MS = 15 * 1000;
const SCHEDULE_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút timeout cho mỗi schedule

let isWorkerStarted = false;
let isProcessing = false;
let timer = null;
let nextWakeupTimer = null;
let lastRunAt = null;
let lastSuccessAt = null;
let lastError = null;
let lastCheckedCount = 0;
let lastProcessedCount = 0;

function clearNextReelsWakeup() {
    if (nextWakeupTimer) {
        clearTimeout(nextWakeupTimer);
        nextWakeupTimer = null;
    }
}

async function armNextScheduleWakeup() {
    clearNextReelsWakeup();

    if (!isWorkerStarted) return;

    const now = new Date();
    const nextDue = await SchedulePost.findOne({
        type: { $in: ['reels', 'post', 'tiktok'] },
        status: 'pending',
        scheduledAt: { $gt: now }
    })
        .sort({ scheduledAt: 1 })
        .select('_id scheduledAt')
        .lean();

    if (!nextDue?.scheduledAt) {
        console.log('[Schedule Runner] No future pending schedule to arm');
        return;
    }

    const delayMs = Math.max(0, new Date(nextDue.scheduledAt).getTime() - Date.now());
    console.log(`[Schedule Runner] Next wakeup armed for schedule=${nextDue._id} at=${new Date(nextDue.scheduledAt).toISOString()} in ${delayMs}ms`);

    nextWakeupTimer = setTimeout(() => {
        processDueSchedules().catch((error) => {
            console.error('[Schedule Runner] Wakeup process error:', error);
        });
    }, delayMs);
}

async function pokeReelsScheduleRunner() {
    if (!isWorkerStarted) return;
    return processDueSchedules();
}

async function resolveTikTokAccountForSchedule(schedule) {
    const accountIds = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    console.log(`[TikTok Scheduler] resolveTikTokAccountForSchedule schedule=${schedule._id} accounts=${accountIds.length}`);

    if (accountIds.length) {
        const matchedChannel = await Channel.findOne({
            _id: { $in: accountIds },
            userId: schedule.userId,
            platform: 'TT',
            isEnabled: true
        })
            .select('_id accountName accountType platform profileUrl storageStatePath')
            .sort({ createdAt: -1 })
            .lean();

        if (matchedChannel) return matchedChannel;
    }

    console.log('[TikTok Scheduler] Fallback: latest active TT account');
    return Channel.findOne({
        userId: schedule.userId,
        platform: 'TT',
        isEnabled: true
    })
        .select('_id accountName accountType platform profileUrl storageStatePath')
        .sort({ createdAt: -1 })
        .lean();
}

function resolveVideoPathToAbsolute(videoPath) {
    if (!videoPath) return '';
    if (path.isAbsolute(videoPath) && /^[A-Za-z]:[/\\]/.test(videoPath)) {
        return videoPath;
    }
    const cleaned = videoPath.replace(/^\/+/, '');
    return path.join(__dirname, '..', cleaned);
}

async function buildTikTokUploadPayload(schedule) {
    const video = schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId : null;
    const rawVideoPath = video?.filePath || schedule.videoPath || '';
    const caption = String(schedule.caption || '').trim();

    const { title, hashtags } = parseTikTokCaption(caption);

    if (!rawVideoPath) {
        throw new Error('Thiếu video cho lịch TikTok');
    }

    const videoPath = resolveVideoPathToAbsolute(rawVideoPath);

    if (!fs.existsSync(videoPath)) {
        throw new Error(`File video không tồn tại: ${videoPath}`);
    }

    console.log(`[TikTok Scheduler] buildTikTokUploadPayload schedule=${schedule._id} videoPath=${videoPath} titleLength=${title.length} hashtags=${hashtags.length}`);

    return { videoPath, title, hashtags };
}

function parseTikTokCaption(caption) {
    const lines = caption.split('\n');
    const titleLines = [];
    const hashtags = [];

    for (const line of lines) {
        const words = line.split(/\s+/);
        for (const word of words) {
            if (word.startsWith('#')) {
                const tag = word.replace(/^#+/, '').trim();
                if (tag) hashtags.push(tag);
            } else if (word) {
                titleLines.push(word);
            }
        }
    }

    return {
        title: titleLines.join(' ').trim(),
        hashtags
    };
}

async function resolveFacebookAccountForSchedule(schedule) {
    const accountIds = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    console.log(`[Reels Scheduler] resolveFacebookAccountForSchedule schedule=${schedule._id} accounts=${accountIds.length}`);

    if (accountIds.length) {
        const matchedChannel = await Channel.findOne({
            _id: { $in: accountIds },
            userId: schedule.userId,
            platform: 'FB',
            isEnabled: true
        })
            .select('_id accountName accountType platform profileUrl storageStatePath')
            .sort({ createdAt: -1 })
            .lean();

        if (matchedChannel) return matchedChannel;
    }

    if (schedule.targetGroupSourceChannelId) {
        console.log(`[Reels Scheduler] resolveFacebookAccountForSchedule using targetGroupSourceChannelId=${schedule.targetGroupSourceChannelId}`);
        const matchedSource = await Channel.findOne({
            _id: schedule.targetGroupSourceChannelId,
            userId: schedule.userId,
            platform: 'FB',
            isEnabled: true
        })
            .select('_id accountName accountType platform profileUrl storageStatePath')
            .lean();

        if (matchedSource) return matchedSource;
    }

    console.log('[Reels Scheduler] resolveFacebookAccountForSchedule fallback: latest active FB account');
    return Channel.findOne({
        userId: schedule.userId,
        platform: 'FB',
        isEnabled: true
    })
        .select('_id accountName accountType platform profileUrl storageStatePath')
        .sort({ createdAt: -1 })
        .lean();
}

async function buildReelsUploadPayload(schedule) {
    const video = schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId : null;
    const videoPath = video?.filePath || schedule.videoPath || '';
    const caption = String(schedule.caption || '').trim();
    const shopeeLinks = Array.isArray(schedule.shopeeLinks)
        ? schedule.shopeeLinks.map((item) => {
            if (item && typeof item === 'object') return item.shopeeUrl || item.title || '';
            return String(item || '').trim();
        }).filter(Boolean)
        : [];

    if (!videoPath) {
        throw new Error('Thiếu video cho lịch Reels');
    }

    console.log(`[Reels Scheduler] buildReelsUploadPayload schedule=${schedule._id} videoPath=${videoPath} captionLength=${caption.length} shopeeLinks=${shopeeLinks.length}`);

    return {
        videoPath,
        content: caption,
        shopeeLinks
    };
}

async function buildPostUploadPayload(schedule, platform = 'FB') {
    const caption = String(schedule.caption || '').trim();
    const postTitle = String(schedule.postTitle || '').trim();
    const images = Array.isArray(schedule.images) ? schedule.images.filter(Boolean) : [];

    let groupUrls = [];
    let groupIds = [];

    if (schedule.targetGroupIds && Array.isArray(schedule.targetGroupIds) && schedule.targetGroupIds.length > 0) {
        schedule.targetGroupIds.forEach(g => {
            if (typeof g === 'object' && g.groupUrl) {
                groupUrls.push(g.groupUrl);
                groupIds.push(g.groupId || '');
            } else {
                // Plain group ID string — build Facebook URL from it
                const plainId = String(g || '').trim();
                groupUrls.push(buildFacebookGroupTargetUrl('', plainId));
                groupIds.push(plainId);
            }
        });
    } else {
        const groupUrl = String(schedule.targetGroupUrl || '').trim();
        const groupId = String(schedule.targetGroupId || '').trim();
        if (groupUrl) groupUrls = [groupUrl];
        if (groupId) groupIds = [groupId];
    }

    // Chỉ Facebook Post mới bắt buộc có group đích.
    // Threads/Pinterest/Instagram Post đăng lên feed/board của tài khoản, không cần group.
    if (platform === 'FB' && groupUrls.length === 0 && groupIds.length === 0) {
        throw new Error('Thiếu group đích cho lịch Post');
    }

    // Pinterest Post bắt buộc phải có tiêu đề (postTitle từ frontend)
    if (platform === 'PI' && !postTitle) {
        throw new Error('Pinterest yêu cầu phải có tiêu đề bài viết (postTitle)');
    }

    if (!caption && !images.length) {
        throw new Error('Thiếu nội dung hoặc ảnh cho lịch Post');
    }

    const groups = groupUrls.map((groupUrl, i) => ({
        groupUrl,
        groupId: groupIds[i] || ''
    }));

    console.log(`[Schedule Runner] buildPostUploadPayload schedule=${schedule._id} platform=${platform} groupsCount=${groups.length} captionLength=${caption.length} postTitleLength=${postTitle.length} images=${images.length}`);

    return {
        groups,
        title: postTitle,
        content: caption,
        images
    };
}

async function isTikTokSchedule(schedule) {
    if (schedule.type === 'tiktok') return true;
    const platforms = Array.isArray(schedule.platforms) ? schedule.platforms.map(p => String(p || '').toUpperCase()) : [];
    if (platforms.includes('TT')) return true;
    return false;
}

async function isInstagramSchedule(schedule) {
    const platforms = Array.isArray(schedule.platforms) ? schedule.platforms.map(p => String(p || '').toUpperCase()) : [];
    return platforms.includes('IG');
}

async function resolveInstagramAccountForSchedule(schedule) {
    const accountIds = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    console.log(`[Instagram Scheduler] resolveInstagramAccountForSchedule schedule=${schedule._id} accounts=${accountIds.length}`);

    if (accountIds.length) {
        const matchedChannel = await Channel.findOne({
            _id: { $in: accountIds },
            userId: schedule.userId,
            platform: 'IG',
            isEnabled: true
        })
            .select('_id accountName accountType platform profileUrl storageStatePath')
            .sort({ createdAt: -1 })
            .lean();

        if (matchedChannel) return matchedChannel;
    }

    console.log('[Instagram Scheduler] Fallback: latest active IG account');
    return Channel.findOne({
        userId: schedule.userId,
        platform: 'IG',
        isEnabled: true
    })
        .select('_id accountName accountType platform profileUrl storageStatePath')
        .sort({ createdAt: -1 })
        .lean();
}

/**
 * Resolve Threads account tương tự Instagram nhưng platform='TH'
 */
async function resolveThreadsAccountForSchedule(schedule) {
    const accountIds = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    console.log(`[Threads Scheduler] resolveThreadsAccountForSchedule schedule=${schedule._id} accounts=${accountIds.length}`);

    if (accountIds.length) {
        const matchedChannel = await Channel.findOne({
            _id: { $in: accountIds },
            userId: schedule.userId,
            platform: 'TH',
            isEnabled: true
        })
            .select('_id accountName accountType platform profileUrl storageStatePath')
            .sort({ createdAt: -1 })
            .lean();
        if (matchedChannel) return matchedChannel;
    }

    return Channel.findOne({
        userId: schedule.userId,
        platform: 'TH',
        isEnabled: true
    })
        .select('_id accountName accountType platform profileUrl storageStatePath')
        .sort({ createdAt: -1 })
        .lean();
}

/**
 * Resolve Pinterest account tương tự nhưng platform='PI'
 */
async function resolvePinterestAccountForSchedule(schedule) {
    const accountIds = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    console.log(`[Pinterest Scheduler] resolvePinterestAccountForSchedule schedule=${schedule._id} accounts=${accountIds.length}`);

    if (accountIds.length) {
        const matchedChannel = await Channel.findOne({
            _id: { $in: accountIds },
            userId: schedule.userId,
            platform: 'PI',
            isEnabled: true
        })
            .select('_id accountName accountType platform profileUrl storageStatePath')
            .sort({ createdAt: -1 })
            .lean();
        if (matchedChannel) return matchedChannel;
    }

    return Channel.findOne({
        userId: schedule.userId,
        platform: 'PI',
        isEnabled: true
    })
        .select('_id accountName accountType platform profileUrl storageStatePath')
        .sort({ createdAt: -1 })
        .lean();
}

/**
 * Resolve YouTube account cho schedule (platform='YT')
 * Được tách riêng khỏi resolveFacebookAccountForSchedule để tránh nhầm platform
 */
async function resolveYoutubeAccountForSchedule(schedule) {
    const accountIds = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    console.log(`[YouTube Scheduler] resolveYoutubeAccountForSchedule schedule=${schedule._id} accounts=${accountIds.length}`);

    if (accountIds.length) {
        const matchedChannel = await Channel.findOne({
            _id: { $in: accountIds },
            userId: schedule.userId,
            platform: 'YT',
            isEnabled: true
        })
            .select('_id accountName accountType platform profileUrl storageStatePath')
            .sort({ createdAt: -1 })
            .lean();
        if (matchedChannel) return matchedChannel;
    }

    console.log('[YouTube Scheduler] Fallback: latest active YT account');
    return Channel.findOne({
        userId: schedule.userId,
        platform: 'YT',
        isEnabled: true
    })
        .select('_id accountName accountType platform profileUrl storageStatePath')
        .sort({ createdAt: -1 })
        .lean();
}

/**
 * Thực thi một schedule với timeout bảo vệ
 * Nếu schedule chạy quá lâu, nó sẽ bị hủy và đánh dấu failed
 */
const ALL_PLATFORMS = ['TT', 'IG', 'FR', 'YS', 'FB', 'TH', 'PI'];

async function executeSinglePlatform(schedule, platform, { persistStatus } = {}) {
    switch (platform) {
        case 'TT': {
            const account = await resolveTikTokAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản TikTok để chạy lịch');
            }
            const payload = await buildTikTokUploadPayload(schedule);
            console.log(`[Schedule Runner] Processing TIKTOK schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'})`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_start', message: `Đang đăng TikTok với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await uploadVideoToTikTok({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                videoPath: payload.videoPath,
                title: payload.title,
                hashtags: payload.hashtags,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                platform,
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'reels_complete', message: result?.success ? `Đã đăng TikTok thành công` : 'Đăng TikTok thất bại', current: 1, total: 1 }
            });

            return result;
        }
        case 'IG': {
            const account = await resolveInstagramAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Instagram để chạy lịch');
            }
            const payload = await buildReelsUploadPayload(schedule);
            console.log(`[Schedule Runner] Processing INSTAGRAM REELS schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'})`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_start', message: `Đang đăng Instagram với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await uploadVideoToInstagram({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                videoPath: payload.videoPath,
                caption: payload.content,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                platform,
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'reels_complete', message: result?.success ? `Đã đăng Instagram thành công` : 'Đăng Instagram thất bại', current: 1, total: 1 }
            });

            return result;
        }
        case 'TH': {
            const account = await resolveThreadsAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Threads để chạy Reels');
            }
            const payload = await buildReelsUploadPayload(schedule);
            console.log(`[Schedule Runner] Processing THREADS REELS schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'})`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_th_start', message: `Đang đăng Threads Reels với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await uploadVideoToThreads({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                videoPath: payload.videoPath,
                title: payload.title,
                caption: payload.content,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                platform,
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'reels_th_complete', message: result?.success ? `Đã đăng Threads Reels thành công` : 'Đăng Threads Reels thất bại', current: 1, total: 1 }
            });

            return result;
        }
        case 'PI': {
            const account = await resolvePinterestAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Pinterest để chạy Reels');
            }
            // Pinterest Idea Pin cho phép cả Personal + Business. Không check accountType.
            const payload = await buildReelsUploadPayload(schedule);
            console.log(`[Schedule Runner] Processing PINTEREST IDEA PIN schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'})`);

            // Pinterest board name lưu trong targetGroupName
            const boardName = String(schedule.targetGroupName || '').trim();

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_pi_start', message: `Đang đăng Pinterest Idea Pin với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await uploadVideoToPinterest({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                videoPath: payload.videoPath,
                caption: payload.content,
                boardName,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                platform,
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'reels_pi_complete', message: result?.success ? `Đã đăng Pinterest Idea Pin thành công` : 'Đăng Pinterest Idea Pin thất bại', current: 1, total: 1 }
            });

            return result;
        }
        case 'FR': {
            const account = await resolveFacebookAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Facebook để chạy Reels');
            }
            const payload = await buildReelsUploadPayload(schedule);
            console.log(`[Schedule Runner] Processing Facebook Reels schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Cá nhân'})`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_start', message: `Đang đăng Facebook Reels với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await runBotUploadInstantWithAccount({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Cá nhân',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                post: {
                    ...payload,
                    profileUrl: account.profileUrl || ''
                },
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                platform,
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'reels_complete', message: result?.success ? 'Đã đăng Facebook Reels thành công' : 'Đăng Facebook Reels thất bại', current: 1, total: 1 }
            });

            return result;
        }
        case 'YS': {
            const account = await resolveYoutubeAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản YouTube để chạy Shorts');
            }
            if (account.platform !== 'YT') {
                // Phòng trường hợp user chọn nhầm account Facebook làm Shorts → fail rõ ràng
                throw new Error(`Tài khoản ${account.accountName} không thuộc nền tảng YouTube (platform=${account.platform || 'unknown'}). Vui lòng chọn đúng tài khoản YouTube.`);
            }
            const payload = await buildReelsUploadPayload(schedule);
            const titleInput = String(schedule.videoTitle || '').trim();
            if (!titleInput) {
                throw new Error('YouTube Shorts yêu cầu phải có tiêu đề video. Vui lòng cập nhật lịch và nhập tiêu đề.');
            }
            console.log(`[Schedule Runner] Processing YouTube Short schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'})`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_ys_start', message: `Đang đăng YouTube Short với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await uploadVideoToYouTubeShort({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                videoPath: payload.videoPath,
                title: titleInput,
                caption: payload.content,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                platform,
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'reels_ys_complete', message: result?.success ? 'Đã đăng YouTube Short thành công' : 'Đăng YouTube Short thất bại', current: 1, total: 1 }
            });

            return result;
        }
        default:
            throw new Error(`Nền tảng không được hỗ trợ: ${platform}`);
    }
}

async function executeSinglePostPlatform(schedule, platform) {
    const post = await buildPostUploadPayload(schedule, platform);

    switch (platform) {
        case 'FB': {
            const account = await resolveFacebookAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Facebook để đăng Post');
            }
            console.log(`[Schedule Runner] Processing POST-FB schedule ${schedule._id} using ${account.accountName}, ${post.groups.length} groups`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                status: 'processing',
                progress: { phase: 'post_fb_start', message: `Đang đăng Facebook với tài khoản ${account.accountName}...`, current: 0, total: post.groups.length }
            });

            const fbResults = [];
            let firstSuccessUrl = '';
            let allSuccess = true;

            for (let i = 0; i < post.groups.length; i++) {
                const group = post.groups[i];
                console.log(`[Schedule Runner] Post FB group ${i + 1}/${post.groups.length}: ${group.groupUrl || group.groupId}`);

                emitScheduleUpdate(schedule.userId, {
                    _id: schedule._id,
                    status: 'processing',
                    progress: { phase: 'post_fb_group', message: `Đăng nhóm ${i + 1}/${post.groups.length}: ${group.groupUrl?.substring(0, 50) || group.groupId}`, current: i + 1, total: post.groups.length }
                });

                try {
                    const groupResult = await runBotPostGroupInstantWithAccount({
                        userId: schedule.userId,
                        accountName: account.accountName,
                        accountType: account.accountType || 'Cá nhân',
                        existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                        post: {
                            groupUrl: group.groupUrl,
                            groupId: group.groupId,
                            content: post.content,
                            images: post.images,
                            profileUrl: account.profileUrl || ''
                        },
                        headless: false
                    });

                    fbResults.push({ group, success: groupResult?.success || false, publishedUrl: groupResult?.publishedUrl || '' });
                    if (groupResult?.success && !firstSuccessUrl) firstSuccessUrl = groupResult.publishedUrl || '';
                    if (!groupResult?.success) allSuccess = false;
                } catch (err) {
                    console.error(`[Schedule Runner] Failed FB group ${group.groupUrl}:`, err.message);
                    fbResults.push({ group, success: false, error: err.message });
                    allSuccess = false;
                }
            }

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                platform: 'FB',
                status: allSuccess ? 'posted' : 'failed',
                publishedUrl: firstSuccessUrl || '',
                progress: { phase: 'post_fb_complete', message: allSuccess ? 'Đã đăng Facebook thành công' : 'Đăng Facebook thất bại', current: post.groups.length, total: post.groups.length }
            });

            return { success: allSuccess, publishedUrl: firstSuccessUrl, groupResults: fbResults };
        }
        case 'IG': {
            const account = await resolveInstagramAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Instagram để đăng Post');
            }
            if (!post.images?.length) {
                throw new Error('Thiếu ảnh để đăng Instagram');
            }
            console.log(`[Schedule Runner] Processing POST-IG schedule ${schedule._id} using ${account.accountName}, ${post.images.length} images`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                status: 'processing',
                progress: { phase: 'post_ig_start', message: `Đang đăng Instagram với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await uploadImagesToInstagram({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                images: post.images,
                caption: post.content,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                platform: 'IG',
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'post_ig_complete', message: result?.success ? 'Đã đăng Instagram thành công' : 'Đăng Instagram thất bại', current: 1, total: 1 }
            });

            return result;
        }
        case 'TH': {
            const account = await resolveThreadsAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Threads để đăng Post');
            }
            if (!post.images?.length) {
                throw new Error('Threads yêu cầu phải có ít nhất 1 hình ảnh');
            }
            console.log(`[Schedule Runner] Processing POST-TH schedule ${schedule._id} using ${account.accountName}, ${post.images.length} images`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                status: 'processing',
                progress: { phase: 'post_th_start', message: `Đang đăng Threads với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            const result = await postImagesToThreads({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                images: post.images,
                caption: post.content,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                platform: 'TH',
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'post_th_complete', message: result?.success ? 'Đã đăng Threads thành công' : 'Đăng Threads thất bại', current: 1, total: 1 }
            });

            return result;
        }
        case 'PI': {
            const account = await resolvePinterestAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Pinterest để đăng Post');
            }
            if (!post.images?.length) {
                throw new Error('Pinterest yêu cầu phải có ít nhất 1 hình ảnh');
            }
            console.log(`[Schedule Runner] Processing POST-PI schedule ${schedule._id} using ${account.accountName}, ${post.images.length} images`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                status: 'processing',
                progress: { phase: 'post_pi_start', message: `Đang đăng Pinterest với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            // Pinterest options: boardName lưu trong schedule.targetGroupName hoặc caption
            const boardName = String(schedule.targetGroupName || '').trim();

            const result = await pinImageToPinterest({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                existingSessionDir: account.storageStatePath ? path.dirname(normalizeEncryptedValue(account.storageStatePath)) : '',
                images: post.images,
                caption: post.content,   // caption = mô tả chi tiết (description)
                title: post.title,        // postTitle = tiêu đề Pin (title)
                boardName,
                headless: false
            });

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                platform: 'PI',
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'post_pi_complete', message: result?.success ? 'Đã đăng Pinterest thành công' : 'Đăng Pinterest thất bại', current: 1, total: 1 }
            });

            return result;
        }
        default:
            throw new Error(`Nền tảng không hỗ trợ đăng bài ảnh: ${platform}`);
    }
}

async function executeSchedule(schedule, { persistStatus = true, markAsPosted = true } = {}) {
    console.log(`[Schedule Runner] executeSchedule start schedule=${schedule._id} type=${schedule.type} persistStatus=${persistStatus} markAsPosted=${markAsPosted}`);

    // Tạo một Promise với timeout để bảo vệ
    const executeWithTimeout = async () => {
        let allResults = [];
        let anySuccess = false;

        const platforms = Array.isArray(schedule.platforms) ? schedule.platforms.filter(p => ALL_PLATFORMS.includes(p)) : (schedule.type === 'post' ? ['FB'] : ['FR']);

        if (!platforms.length) {
            throw new Error('Không có nền tảng nào được chọn');
        }

        const typeLabel = schedule.type === 'post' ? 'post' : 'reels';
        console.log(`[Schedule Runner] Processing ${typeLabel} schedule ${schedule._id}, platforms: ${platforms.join(', ')}`);

        emitScheduleUpdate(schedule.userId, {
            _id: schedule._id,
            type: typeLabel,
            status: 'processing',
            progress: { phase: 'multi_platform_start', message: `Đang xử lý song song ${platforms.length} nền tảng: ${platforms.join(', ')}...`, current: 0, total: platforms.length }
        });

        // Run all platforms concurrently — mỗi nền tảng mở 1 instance trình duyệt riêng
        const platformPromises = platforms.map(async (platform) => {
            console.log(`[Schedule Runner] Starting ${typeLabel} platform ${platform} in parallel for schedule ${schedule._id}`);
            try {
                let platformResult;
                if (schedule.type === 'post') {
                    platformResult = await executeSinglePostPlatform(schedule, platform);
                } else {
                    platformResult = await executeSinglePlatform(schedule, platform, { persistStatus });
                }
                // success CHỈ true khi platformResult thực sự success
                const ok = Boolean(platformResult?.success);
                console.log(`[Schedule Runner] ${typeLabel} platform ${platform} completed: success=${ok}`);
                if (!ok) {
                    return { platform, success: false, result: platformResult, error: platformResult?.message || 'Service returned success=false' };
                }
                return { platform, success: true, result: platformResult };
            } catch (err) {
                console.error(`[Schedule Runner] ${typeLabel} platform ${platform} failed:`, err.message);
                return { platform, success: false, error: err.message };
            }
        });

        const settledResults = await Promise.allSettled(platformPromises);
        for (const settled of settledResults) {
            if (settled.status === 'fulfilled') {
                allResults.push(settled.value);
                if (settled.value.success) anySuccess = true;
            } else {
                const errPlatform = '?';
                console.error(`[Schedule Runner] Unexpected rejection for platform:`, settled.reason);
                allResults.push({ platform: errPlatform, success: false, error: settled.reason?.message || 'Unknown error' });
            }
        }

        const successCount = allResults.filter(r => r.success).length;
        const result = {
            success: anySuccess || successCount === platforms.length,
            publishedUrl: allResults.find(r => r.success)?.result?.publishedUrl || '',
            platformResults: allResults
        };

        emitScheduleUpdate(schedule.userId, {
            _id: schedule._id,
            type: typeLabel,
            status: anySuccess ? 'posted' : 'failed',
            publishedUrl: result.publishedUrl || '',
            final: true,
            progress: { phase: 'multi_platform_complete', message: `Đã xử lý song song ${successCount}/${platforms.length} nền tảng thành công`, current: platforms.length, total: platforms.length }
        });

        console.log(`[Schedule Runner] ${typeLabel} schedule ${schedule._id} completed: ${successCount}/${platforms.length} platforms succeeded (parallel)`);
        return { result, account: null };
    };

    // Chạy với timeout
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`Schedule execution timed out after ${SCHEDULE_TIMEOUT_MS / 1000}s`)), SCHEDULE_TIMEOUT_MS);
    });

    try {
        const { result, account } = await Promise.race([executeWithTimeout(), timeoutPromise]);
        clearTimeout(timeoutId);

        console.log(`[Schedule Runner] executeSchedule done schedule=${schedule._id} success=${Boolean(result?.success)} publishedUrl=${result?.publishedUrl || ''}`);

        if (persistStatus) {
            // Normalize platformResults để lưu vào DB
            const platformResultsToSave = (result?.platformResults || []).map(r => ({
                platform: r.platform,
                success: Boolean(r.success),
                publishedUrl: r.result?.publishedUrl || '',
                error: r.error || r.result?.message || '',
                completedAt: new Date()
            }));

            // Xác định overall status:
            // - Tất cả platforms success → 'posted'
            // - Tất cả platforms fail → 'failed'
            // - Một số pass một số fail → 'posted' (để hiển thị trong archive) nhưng có platformResults để biết chi tiết
            const allPlatformResults = platformResultsToSave.length ? platformResultsToSave : [];
            const allSuccess = allPlatformResults.length > 0 && allPlatformResults.every(r => r.success);
            const anySuccess = allPlatformResults.some(r => r.success);
            let finalStatus;
            if (allPlatformResults.length === 0) {
                finalStatus = result?.success ? 'posted' : 'failed';
            } else if (allSuccess) {
                finalStatus = 'posted';
            } else if (anySuccess) {
                finalStatus = 'posted'; // partial — nhưng có platformResults để biết
            } else {
                finalStatus = 'failed';
            }

            console.log(`[Schedule Runner] Updating status to '${finalStatus}' for schedule ${schedule._id} (${allPlatformResults.filter(r => r.success).length}/${allPlatformResults.length} success)`);
            const updateResult = await SchedulePost.updateOne(
                { _id: schedule._id },
                { $set: {
                    status: finalStatus,
                    publishedUrl: result?.publishedUrl || '',
                    platformResults: platformResultsToSave
                } }
            );
            console.log(`[Schedule Runner] Status update result: matched=${updateResult.matchedCount} modified=${updateResult.modifiedCount}`);
        }

        return { result, account };
    } catch (error) {
        console.error(`[Schedule Runner] executeSchedule timeout/error schedule=${schedule._id}:`, error.message);

        if (persistStatus) {
            await SchedulePost.updateOne(
                { _id: schedule._id, status: 'pending' },
                { $set: { status: 'failed' } }
            );
        }

        throw error;
    }
}

async function processDueSchedules() {
    if (isProcessing) {
        console.log('[Schedule Runner] processDueSchedules skipped - already processing');
        return;
    }
    isProcessing = true;
    lastRunAt = new Date();
    lastError = null;
    lastCheckedCount = 0;
    lastProcessedCount = 0;

    try {
        const now = new Date();
        console.log(`[Schedule Runner] processDueSchedules tick at ${now.toISOString()}`);

    const dueSchedules = await SchedulePost.find({
        type: { $in: ['reels', 'post', 'tiktok'] },
        status: 'pending',
        scheduledAt: { $lte: now }
    })
            .sort({ scheduledAt: 1 })
            .populate('videoId', 'title filePath thumbnailUrl')
            .populate('targetGroupSourceChannelId', 'accountName accountType platform profileUrl')
            .populate('shopeeLinks', 'title shopeeUrl imageUrl')
            .lean();

        lastCheckedCount = dueSchedules.length;
        console.log(`[Schedule Runner] Found ${dueSchedules.length} due schedule(s)`);

        for (const schedule of dueSchedules) {
            console.log(`[Schedule Runner] Inspect schedule ${schedule._id} type=${schedule.type} scheduledAt=${schedule.scheduledAt?.toISOString?.() || schedule.scheduledAt}`);
            const fresh = await SchedulePost.findOne({ _id: schedule._id, status: 'pending' }).lean();
            if (!fresh) {
                console.log(`[Schedule Runner] Skip ${schedule._id} because status changed`);
                continue;
            }

            try {
                const { result } = await executeSchedule(schedule, { persistStatus: true, markAsPosted: true });

                const updatedSchedule = await SchedulePost.findOne({ _id: schedule._id }).select('status publishedUrl').lean();
                const finalStatus = updatedSchedule?.status || (result?.success ? 'posted' : 'failed');
                const finalUrl = updatedSchedule?.publishedUrl || result?.publishedUrl || '';

                const allPlatforms = Array.isArray(schedule.platforms) ? schedule.platforms.join(', ') : 'FB';
                const platformResults = result?.platformResults;
                const successCount = platformResults ? platformResults.filter(r => r.success).length : (result?.success ? 1 : 0);
                const totalPlatforms = platformResults ? platformResults.length : 1;

                if (result?.success) {
                    lastProcessedCount += 1;
                    lastSuccessAt = new Date();
                    console.log(`[Schedule Runner] Đã đăng lịch ${schedule._id}: ${successCount}/${totalPlatforms} nền tảng thành công`);

                    sendTelegramNotification(schedule.userId, NOTIFICATION_TYPES.SUCCESS, {
                        scheduleTitle: schedule.caption || schedule.videoId?.title || '—',
                        platform: allPlatforms,
                        time: schedule.scheduledAt ? new Date(schedule.scheduledAt).toLocaleString('vi-VN') : '—',
                        caption: schedule.caption || ''
                    }).catch(() => {});
                } else {
                    console.error(`[Schedule Runner] Đăng lịch ${schedule._id} thất bại: ${successCount}/${totalPlatforms} nền tảng thành công`);

                    sendTelegramNotification(schedule.userId, NOTIFICATION_TYPES.ERROR, {
                        scheduleTitle: schedule.caption || schedule.videoId?.title || '—',
                        platform: allPlatforms,
                        error: `Đăng thất bại (${successCount}/${totalPlatforms} nền tảng)`,
                        scheduleId: schedule._id
                    }).catch(() => {});
                }

                emitScheduleUpdate(schedule.userId, {
                    _id: schedule._id,
                    type: schedule.type || 'reels',
                    status: finalStatus,
                    publishedUrl: finalUrl,
                    final: true
                });
            } catch (error) {
                const failedSchedule = await SchedulePost.findOne({ _id: schedule._id }).select('status publishedUrl').lean();
                if (failedSchedule?.status !== 'failed') {
                    await SchedulePost.updateOne(
                        { _id: schedule._id, status: 'pending' },
                        { $set: { status: 'failed' } }
                    );
                }
                console.error(`[Schedule Runner] Lỗi đăng lịch ${schedule._id}:`, error);

                sendTelegramNotification(schedule.userId, NOTIFICATION_TYPES.ERROR, {
                    scheduleTitle: schedule.caption || schedule.videoId?.title || '—',
                    platform: Array.isArray(schedule.platforms) ? schedule.platforms.join(', ') : 'FB',
                    error: error.message || 'Lỗi không xác định',
                    scheduleId: schedule._id
                }).catch(() => {});

                emitScheduleUpdate(schedule.userId, {
                    _id: schedule._id,
                    status: 'failed',
                    publishedUrl: '',
                    final: true
                });
            }
        }
        console.log(`[Schedule Runner] processDueSchedules finished checked=${lastCheckedCount} processed=${lastProcessedCount}`);
    } catch (error) {
        lastError = error?.message || String(error);
        console.error('[Schedule Runner] Worker error:', error);
    } finally {
        isProcessing = false;
        armNextScheduleWakeup().catch((error) => {
            console.error('[Schedule Runner] Failed to arm next wakeup:', error);
        });
    }
}

async function runReelsScheduleByIdNow(scheduleId, { persistStatus = true, markAsPosted = true } = {}) {
    if (!scheduleId) {
        throw new Error('Thiếu scheduleId');
    }

    const schedule = await SchedulePost.findOne({ _id: scheduleId, type: { $in: ['reels', 'post', 'tiktok'] } })
        .populate('videoId', 'title filePath thumbnailUrl')
        .populate('targetGroupSourceChannelId', 'accountName accountType platform profileUrl')
        .populate('shopeeLinks', 'title shopeeUrl imageUrl')
        .lean();

    if (!schedule) {
        throw new Error('Không tìm thấy lịch đăng bài');
    }

    console.log(`[Schedule Runner] runReelsScheduleByIdNow schedule=${scheduleId} type=${schedule.type} title=${schedule.videoId?.title || schedule.videoTitle || schedule.caption || ''}`);

    const { result } = await executeSchedule(schedule, { persistStatus, markAsPosted });

    console.log(`[Schedule Runner] runReelsScheduleByIdNow done schedule=${scheduleId} success=${Boolean(result?.success)} publishedUrl=${result?.publishedUrl || ''}`);

    return result;
}

function startReelsScheduleRunner() {
    if (isWorkerStarted) return;
    isWorkerStarted = true;

    processDueSchedules().catch(() => {});
    timer = setInterval(() => {
        processDueSchedules().catch(() => {});
    }, CHECK_INTERVAL_MS);

    armNextScheduleWakeup().catch((error) => {
        console.error('[Schedule Runner] Failed to arm initial wakeup:', error);
    });

    console.log('[Schedule Runner] Started');
}

function stopReelsScheduleRunner() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    clearNextReelsWakeup();
    isWorkerStarted = false;
    isProcessing = false;
}

function getReelsScheduleRunnerStatus() {
    return {
        started: isWorkerStarted,
        processing: isProcessing,
        lastRunAt,
        lastSuccessAt,
        lastError,
        lastCheckedCount,
        lastProcessedCount
    };
}

async function runReelsScheduleRunnerNow() {
    return processDueSchedules();
}

module.exports = {
    startReelsScheduleRunner,
    stopReelsScheduleRunner,
    processDueSchedules,
    getReelsScheduleRunnerStatus,
    runReelsScheduleRunnerNow,
    runReelsScheduleByIdNow,
    pokeReelsScheduleRunner
};