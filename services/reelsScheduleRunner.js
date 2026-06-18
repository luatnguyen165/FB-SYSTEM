const fs = require('fs');
const path = require('path');
const SchedulePost = require('../models/SchedulePost');
const Channel = require('../models/Channel');
const { runBotUploadInstantWithAccount } = require('./facebook/reels');
const { runBotPostGroupInstantWithAccount } = require('./facebookPostGroupService');
const { uploadVideoToTikTok } = require('./tiktokPlaywrightService');
const { uploadVideoToInstagram, uploadImagesToInstagram } = require('./instagramPlaywrightService');
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

async function buildPostUploadPayload(schedule) {
    const caption = String(schedule.caption || '').trim();
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

    if (groupUrls.length === 0 && groupIds.length === 0) {
        throw new Error('Thiếu group đích cho lịch Post');
    }

    if (!caption && !images.length) {
        throw new Error('Thiếu nội dung hoặc ảnh cho lịch Post');
    }

    const groups = groupUrls.map((groupUrl, i) => ({
        groupUrl,
        groupId: groupIds[i] || ''
    }));

    console.log(`[Schedule Runner] buildPostUploadPayload schedule=${schedule._id} groupsCount=${groups.length} captionLength=${caption.length} images=${images.length}`);

    return {
        groups,
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
 * Thực thi một schedule với timeout bảo vệ
 * Nếu schedule chạy quá lâu, nó sẽ bị hủy và đánh dấu failed
 */
const ALL_PLATFORMS = ['TT', 'IG', 'FR', 'YS', 'FB'];

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
        case 'FR':
        case 'YS': {
            const account = await resolveFacebookAccountForSchedule(schedule);
            if (!account?.accountName) {
                throw new Error('Không tìm thấy tài khoản Facebook để chạy Reels');
            }
            const payload = await buildReelsUploadPayload(schedule);
            const platformLabel = platform === 'FR' ? 'Facebook Reels' : 'YouTube Short';
            console.log(`[Schedule Runner] Processing ${platformLabel} schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Cá nhân'})`);

            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_start', message: `Đang đăng ${platformLabel} với tài khoản ${account.accountName}...`, current: 0, total: 1 }
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
                progress: { phase: 'reels_complete', message: result?.success ? `Đã đăng ${platformLabel} thành công` : `Đăng ${platformLabel} thất bại`, current: 1, total: 1 }
            });

            return result;
        }
        default:
            throw new Error(`Nền tảng không được hỗ trợ: ${platform}`);
    }
}

async function executeSinglePostPlatform(schedule, platform) {
    const post = await buildPostUploadPayload(schedule);

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
                console.log(`[Schedule Runner] ${typeLabel} platform ${platform} completed: success=${Boolean(platformResult?.success)}`);
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
            if (result?.success) {
                // Upload thành công - luôn set status = 'posted'
                console.log(`[Schedule Runner] Updating status to 'posted' for schedule ${schedule._id}`);
                const updateResult = await SchedulePost.updateOne(
                    { _id: schedule._id },
                    { $set: {
                        status: 'posted',
                        publishedUrl: result?.publishedUrl || ''
                    } }
                );
                console.log(`[Schedule Runner] Status update result: matched=${updateResult.matchedCount} modified=${updateResult.modifiedCount}`);
            } else {
                // Upload thất bại
                console.log(`[Schedule Runner] Updating status to 'failed' for schedule ${schedule._id}`);
                await SchedulePost.updateOne(
                    { _id: schedule._id },
                    { $set: { status: 'failed' } }
                );
            }
        }

        return { result, account };
    } catch (error) {
        console.error(`[Schedule Runner] executeSchedule timeout/error schedule=${schedule._id}:`, error.message);
        
        if (persistStatus) {
            await SchedulePost.updateOne(
                { _id: schedule._id },
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