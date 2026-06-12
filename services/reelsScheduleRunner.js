const fs = require('fs');
const path = require('path');
const SchedulePost = require('../models/SchedulePost');
const Channel = require('../models/Channel');
const { runBotUploadInstantWithAccount } = require('./facebookPlaywrightService');
const { runBotPostGroupInstantWithAccount } = require('./facebookPostGroupService');
const { uploadVideoToTikTok } = require('./tiktokPlaywrightService');
const { uploadVideoToInstagram, uploadImagesToInstagram } = require('./instagramPlaywrightService');
const { emitScheduleUpdate } = require('./socketService');
const { sendTelegramNotification, NOTIFICATION_TYPES } = require('./telegramService');

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
            .select('_id accountName accountType platform profileUrl')
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
        .select('_id accountName accountType platform profileUrl')
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
            .select('_id accountName accountType platform profileUrl')
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
            .select('_id accountName accountType platform profileUrl')
            .lean();

        if (matchedSource) return matchedSource;
    }

    console.log('[Reels Scheduler] resolveFacebookAccountForSchedule fallback: latest active FB account');
    return Channel.findOne({
        userId: schedule.userId,
        platform: 'FB',
        isEnabled: true
    })
        .select('_id accountName accountType platform profileUrl')
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
        groupUrls = schedule.targetGroupIds.map(g => {
            if (typeof g === 'object' && g.groupUrl) return g.groupUrl;
            return g;
        });
        groupIds = schedule.targetGroupIds.map(g => {
            if (typeof g === 'object' && g.groupId) return g.groupId;
            return '';
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
    if (platforms.includes('TT') || platforms.includes('TA')) return true;
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
            .select('_id accountName accountType platform profileUrl')
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
        .select('_id accountName accountType platform profileUrl')
        .sort({ createdAt: -1 })
        .lean();
}

/**
 * Thực thi một schedule với timeout bảo vệ
 * Nếu schedule chạy quá lâu, nó sẽ bị hủy và đánh dấu failed
 */
async function executeSchedule(schedule, { persistStatus = true, markAsPosted = true } = {}) {
    console.log(`[Schedule Runner] executeSchedule start schedule=${schedule._id} type=${schedule.type} persistStatus=${persistStatus} markAsPosted=${markAsPosted}`);

    // Tạo một Promise với timeout để bảo vệ
    const executeWithTimeout = async () => {
        let account;
        const isTT = await isTikTokSchedule(schedule);
        if (isTT) {
            account = await resolveTikTokAccountForSchedule(schedule);
            if (!account?.accountName) {
                if (persistStatus) {
                    await SchedulePost.updateOne(
                        { _id: schedule._id },
                        { $set: { status: 'failed' } }
                    );
                }
                throw new Error('Không tìm thấy tài khoản TikTok để chạy lịch');
            }
        } else {
            account = await resolveFacebookAccountForSchedule(schedule);
            if (!account?.accountName) {
                if (persistStatus) {
                    await SchedulePost.updateOne(
                        { _id: schedule._id },
                        { $set: { status: 'failed' } }
                    );
                }
                throw new Error('Không tìm thấy tài khoản Facebook để chạy Reels');
            }
        }

        let result;
        const isIG = await isInstagramSchedule(schedule);
        
        if (isTT) {
            const tiktokPayload = await buildTikTokUploadPayload(schedule);
            console.log(`[Schedule Runner] Processing TIKTOK schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'})`);

            result = await uploadVideoToTikTok({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                videoPath: tiktokPayload.videoPath,
                title: tiktokPayload.title,
                hashtags: tiktokPayload.hashtags,
                headless: false
            });
        } else if (schedule.type === 'post' && isIG) {
            const images = Array.isArray(schedule.images) ? schedule.images.filter(Boolean) : [];
            const caption = String(schedule.caption || '').trim();
            
            if (!images.length && !caption) {
                throw new Error('Thiếu nội dung hoặc ảnh cho lịch Instagram Post');
            }
            
            account = await resolveInstagramAccountForSchedule(schedule);
            if (!account?.accountName) {
                if (persistStatus) {
                    await SchedulePost.updateOne({ _id: schedule._id }, { $set: { status: 'failed' } });
                }
                throw new Error('Không tìm thấy tài khoản Instagram để chạy lịch');
            }
            
            console.log(`[Schedule Runner] Processing INSTAGRAM POST schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'}), ${images.length} ảnh`);

            result = await uploadImagesToInstagram({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                images: images,
                caption: caption,
                headless: false
            });
        } else if (isIG) {
            const post = await buildReelsUploadPayload(schedule);
            account = await resolveInstagramAccountForSchedule(schedule);
            if (!account?.accountName) {
                if (persistStatus) {
                    await SchedulePost.updateOne(
                        { _id: schedule._id },
                        { $set: { status: 'failed' } }
                    );
                }
                throw new Error('Không tìm thấy tài khoản Instagram để chạy lịch');
            }
            
            console.log(`[Schedule Runner] Processing INSTAGRAM REELS schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Personal'})`);

            result = await uploadVideoToInstagram({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Personal',
                videoPath: post.videoPath,
                caption: post.content,
                headless: false
            });
        } else if (schedule.type === 'post') {
            const post = await buildPostUploadPayload(schedule);
            const MAX_CONCURRENT = 4;
            const totalGroups = post.groups.length;
            console.log(`[Schedule Runner] Processing POST schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Cá nhân'}), ${totalGroups} groups to post (max ${MAX_CONCURRENT} parallel)`);

            // Socket: bắt đầu đăng post
            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                status: 'processing',
                progress: { phase: 'post_start', message: `Đang đăng bài lên ${totalGroups} group (tối đa ${MAX_CONCURRENT} song song)...`, current: 0, total: totalGroups }
            });

            const results = [];
            let firstSuccessUrl = '';
            let completedCount = 0;

            // Helper: đăng bài lên 1 group
            const postToGroup = async (group, index) => {
                console.log(`[Schedule Runner] Posting to group ${index + 1}/${totalGroups}: ${group.groupUrl || group.groupId}`);
                try {
                    const groupResult = await runBotPostGroupInstantWithAccount({
                        userId: schedule.userId,
                        accountName: account.accountName,
                        accountType: account.accountType || 'Cá nhân',
                        post: {
                            groupUrl: group.groupUrl,
                            groupId: group.groupId,
                            content: post.content,
                            images: post.images,
                            profileUrl: account.profileUrl || ''
                        },
                        headless: false
                    });

                    const success = groupResult?.success || false;
                    completedCount++;
                    if (success && !firstSuccessUrl) firstSuccessUrl = groupResult.publishedUrl || '';

                    emitScheduleUpdate(schedule.userId, {
                        _id: schedule._id,
                        status: 'processing',
                        progress: {
                            phase: 'post_to_group',
                            message: `Đã đăng ${completedCount}/${totalGroups} group${success ? '' : ' (một nhóm thất bại)'}`,
                            current: completedCount,
                            total: totalGroups
                        }
                    });

                    return {
                        group,
                        success,
                        publishedUrl: groupResult?.publishedUrl || ''
                    };
                } catch (err) {
                    console.error(`[Schedule Runner] Failed to post to group ${group.groupUrl}:`, err.message);
                    completedCount++;

                    emitScheduleUpdate(schedule.userId, {
                        _id: schedule._id,
                        status: 'processing',
                        progress: {
                            phase: 'post_to_group',
                            message: `Đã đăng ${completedCount}/${totalGroups} group (một nhóm lỗi)`,
                            current: completedCount,
                            total: totalGroups
                        }
                    });

                    return {
                        group,
                        success: false,
                        error: err.message
                    };
                }
            };

            // Chia thành các batch tối đa 4 groups, chạy song song từng batch
            for (let batchStart = 0; batchStart < totalGroups; batchStart += MAX_CONCURRENT) {
                const batch = post.groups.slice(batchStart, batchStart + MAX_CONCURRENT);
                const batchIndices = batch.map((_, i) => batchStart + i);
                const batchNumber = Math.floor(batchStart / MAX_CONCURRENT) + 1;
                const totalBatches = Math.ceil(totalGroups / MAX_CONCURRENT);

                console.log(`[Schedule Runner] Batch ${batchNumber}/${totalBatches}: posting to ${batch.length} groups in parallel`);

                emitScheduleUpdate(schedule.userId, {
                    _id: schedule._id,
                    status: 'processing',
                    progress: {
                        phase: 'post_batch',
                        message: `Batch ${batchNumber}/${totalBatches}: đang đăng ${batch.length} group song song...`,
                        current: completedCount,
                        total: totalGroups
                    }
                });

                const batchResults = await Promise.all(
                    batch.map((group, i) => postToGroup(group, batchIndices[i]))
                );

                results.push(...batchResults);

                // Delay giữa các batch để tránh quá tải resource
                if (batchStart + MAX_CONCURRENT < totalGroups) {
                    const batchDelay = 3000 + Math.floor(Math.random() * 2000);
                    console.log(`[Schedule Runner] Waiting ${batchDelay}ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, batchDelay));
                }
            }

            const successCount = results.filter(r => r.success).length;
            const allSuccess = successCount === totalGroups;

            result = {
                success: allSuccess,
                publishedUrl: firstSuccessUrl,
                groupResults: results
            };

            // Socket: đã đăng xong post
            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                status: allSuccess ? 'posted' : 'failed',
                publishedUrl: firstSuccessUrl || '',
                progress: { phase: 'post_complete', message: allSuccess ? 'Đã đăng bài thành công' : `Đăng bài hoàn tất: ${successCount}/${totalGroups} groups thành công`, current: totalGroups, total: totalGroups }
            });

            console.log(`[Schedule Runner] Post schedule ${schedule._id} completed: ${successCount}/${totalGroups} groups posted successfully (parallel mode, max ${MAX_CONCURRENT} concurrent)`);
        } else {
            const post = await buildReelsUploadPayload(schedule);
            console.log(`[Schedule Runner] Processing REELS schedule ${schedule._id} using ${account.accountName} (${account.accountType || 'Cá nhân'})`);

            // Socket: bắt đầu đăng reels
            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: 'processing',
                progress: { phase: 'reels_start', message: `Đang đăng reels lên Facebook với tài khoản ${account.accountName}...`, current: 0, total: 1 }
            });

            result = await runBotUploadInstantWithAccount({
                userId: schedule.userId,
                accountName: account.accountName,
                accountType: account.accountType || 'Cá nhân',
                post: {
                    ...post,
                    profileUrl: account.profileUrl || ''
                },
                headless: false
            });

            // Socket: đã đăng xong reels
            emitScheduleUpdate(schedule.userId, {
                _id: schedule._id,
                type: 'reels',
                status: result?.success ? 'posted' : 'failed',
                publishedUrl: result?.publishedUrl || '',
                progress: { phase: 'reels_complete', message: result?.success ? 'Đã đăng reels thành công' : 'Đăng reels thất bại', current: 1, total: 1 }
            });
        }

        return { result, account };
    };

    // Chạy với timeout
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Schedule execution timed out after ${SCHEDULE_TIMEOUT_MS / 1000}s`)), SCHEDULE_TIMEOUT_MS);
    });

    try {
        const { result, account } = await Promise.race([executeWithTimeout(), timeoutPromise]);

        console.log(`[Schedule Runner] executeSchedule done schedule=${schedule._id} success=${Boolean(result?.success)} publishedUrl=${result?.publishedUrl || ''}`);

        if (persistStatus) {
            if (result?.success && markAsPosted) {
                await SchedulePost.updateOne(
                    { _id: schedule._id },
                    { $set: { status: 'posted', publishedUrl: result?.publishedUrl || '' } }
                );
            } else if (result?.success && result?.publishedUrl) {
                await SchedulePost.updateOne(
                    { _id: schedule._id },
                    { $set: { publishedUrl: result.publishedUrl } }
                );
            } else {
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

                if (result?.success) {
                    lastProcessedCount += 1;
                    lastSuccessAt = new Date();
                    console.log(`[Schedule Runner] Đã đăng lịch ${schedule._id}: ${result.message}`);

                    sendTelegramNotification(schedule.userId, NOTIFICATION_TYPES.SUCCESS, {
                        scheduleTitle: schedule.caption || schedule.videoId?.title || '—',
                        platform: Array.isArray(schedule.platforms) ? schedule.platforms[0] : 'FB',
                        time: schedule.scheduledAt ? new Date(schedule.scheduledAt).toLocaleString('vi-VN') : '—',
                        caption: schedule.caption || ''
                    }).catch(() => {});
                } else {
                    console.error(`[Schedule Runner] Đăng lịch ${schedule._id} thất bại: không thể đăng bài`);

                    sendTelegramNotification(schedule.userId, NOTIFICATION_TYPES.ERROR, {
                        scheduleTitle: schedule.caption || schedule.videoId?.title || '—',
                        platform: Array.isArray(schedule.platforms) ? schedule.platforms[0] : 'FB',
                        error: 'Đăng bài thất bại',
                        scheduleId: schedule._id
                    }).catch(() => {});
                }

                emitScheduleUpdate(schedule.userId, {
                    _id: schedule._id,
                    status: finalStatus,
                    publishedUrl: finalUrl
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
                    platform: Array.isArray(schedule.platforms) ? schedule.platforms[0] : 'FB',
                    error: error.message || 'Lỗi không xác định',
                    scheduleId: schedule._id
                }).catch(() => {});

                emitScheduleUpdate(schedule.userId, {
                    _id: schedule._id,
                    status: 'failed',
                    publishedUrl: ''
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