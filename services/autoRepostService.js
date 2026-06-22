// services/autoRepostService.js
// Tự động đăng lại TrackingPost mới scrape về sang các nền tảng đã set trong Tracking.targetPlatforms.
// Routing logic:
//   - Post có video → tất cả platforms (TT/IG/YS/TH/PI/FR) đều nhận
//   - Post chỉ có ảnh+text → bỏ qua TikTok (TT) & YouTube (YS); các platform còn lại nhận
//   - Facebook post ảnh cần group mapping (fallback: bỏ qua với log warning)
// Tận dụng reelsScheduleRunner đã có, không tạo worker mới.

const SchedulePost = require('../models/SchedulePost');
const TrackingPost = require('../models/TrackingPost');
const { renderTemplate, parseHashtagInput, parseTagInput } = require('../utils/templateRenderer');

let pokeRunner = null;
try {
    pokeRunner = require('./reelsScheduleRunner').pokeReelsScheduleRunner;
} catch (e) {
    console.warn('[AutoRepost] Không load được pokeReelsScheduleRunner:', e.message);
}

/**
 * Map platform lower-case (Tracking) + media-type sang schedule code:
 *   - facebook + video → FR (Reels)
 *   - facebook + image → FB (Post - yêu cầu group)
 *   - tiktok/youtube + image → null (bỏ qua theo quyết định 1B)
 *   - instagram/threads/pinterest + image → type='post'
 *   - instagram/threads/pinterest + video → type='reels' (cùng code, runner phân biệt theo type)
 */
function resolveSchedulePlan(tp, hasVideo, hasImage) {
    if (!tp.enabled) return null;
    const platform = tp.platform;
    const plan = { type: null, code: null, requiresGroup: false };

    if (hasVideo) {
        if (platform === 'facebook') { plan.type = 'reels'; plan.code = 'FR'; }
        else if (platform === 'tiktok') { plan.type = 'reels'; plan.code = 'TT'; }
        else if (platform === 'youtube') { plan.type = 'reels'; plan.code = 'YS'; }
        else if (platform === 'instagram') { plan.type = 'reels'; plan.code = 'IG'; }
        else if (platform === 'threads') { plan.type = 'reels'; plan.code = 'TH'; }
        else if (platform === 'pinterest') { plan.type = 'reels'; plan.code = 'PI'; }
        return plan;
    }

    if (hasImage) {
        if (platform === 'tiktok' || platform === 'youtube') return null; // 1B: bỏ qua
        if (platform === 'facebook') { plan.type = 'post'; plan.code = 'FB'; plan.requiresGroup = true; }
        else if (platform === 'instagram') { plan.type = 'post'; plan.code = 'IG'; }
        else if (platform === 'threads') { plan.type = 'post'; plan.code = 'TH'; }
        else if (platform === 'pinterest') { plan.type = 'post'; plan.code = 'PI'; }
        return plan;
    }

    return null; // Text-only: skip (hiện không support platform nào đăng text-only thuần)
}

/**
 * Enqueue auto-repost cho 1 TrackingPost. Fire-and-forget (không throw ra ngoài).
 */
async function enqueueAutoRepostForTrackingPost({ trackingPost, tracking, userId }) {
    try {
        if (!trackingPost || !tracking) return;
        if (tracking.isActive === false) {
            console.log(`[AutoRepost] Skip - tracking inactive: trackingId=${tracking._id}`);
            return;
        }
        if (tracking.repostPaused === true) {
            console.log(`[AutoRepost] Skip - repostPaused=true: trackingId=${tracking._id}`);
            return;
        }
        const targets = Array.isArray(tracking.targetPlatforms) ? tracking.targetPlatforms.filter(Boolean) : [];
        if (targets.length === 0) return;

        const hasVideo = Array.isArray(trackingPost.videos) && trackingPost.videos.length > 0;
        const hasImage = Array.isArray(trackingPost.images) && trackingPost.images.length > 0;
        if (!hasVideo && !hasImage) {
            console.log(`[AutoRepost] Skip - post không có media: postId=${trackingPost.postId}`);
            return;
        }

        const postUserId = userId || trackingPost.userId;
        const resultsToAppend = [];
        let enqueuedCount = 0;
        let skippedCount = 0;

        for (const tp of targets) {
            const plan = resolveSchedulePlan(tp, hasVideo, hasImage);
            if (!plan) {
                skippedCount++;
                resultsToAppend.push({
                    platform: tp.platform,
                    accountId: tp.accountId,
                    status: 'skipped',
                    error: `Bỏ qua: post ${hasVideo ? 'có video' : 'chỉ có ảnh'} không phù hợp với ${tp.platform}`,
                    attemptedAt: new Date()
                });
                continue;
            }

            // Dedupe: kiểm tra SchedulePost đã tồn tại cho post này + platform này
            const existing = await SchedulePost.findOne({
                sourceTrackingPostId: trackingPost._id,
                platforms: plan.code,
                status: { $in: ['pending', 'posted', 'processing'] }
            }).select('_id status').lean();

            if (existing) {
                skippedCount++;
                resultsToAppend.push({
                    platform: plan.code,
                    accountId: tp.accountId,
                    scheduleId: existing._id,
                    status: 'skipped',
                    error: `Đã tồn tại schedule (${existing.status})`,
                    attemptedAt: new Date()
                });
                continue;
            }

            // Render template
            const mapping = tp.mapping || {};
            const caption = renderTemplate(mapping.caption || '{{text}}', trackingPost);
            const title = renderTemplate(mapping.title || '{{text|first_100_chars}}', trackingPost);
            const hashtags = Array.isArray(mapping.hashtags) && mapping.hashtags.length > 0
                ? mapping.hashtags
                : parseHashtagInput(mapping.hashtagsRaw || '');
            const tags = Array.isArray(mapping.tags) && mapping.tags.length > 0
                ? mapping.tags
                : parseTagInput(mapping.tagsRaw || '');

            const scheduleData = {
                userId: postUserId,
                type: plan.type,
                caption,
                postTitle: plan.code === 'PI' ? title : '',
                images: plan.type === 'post' ? (trackingPost.images || []).slice(0, 10) : [],
                videoPath: plan.type === 'reels' ? (trackingPost.videos?.[0] || '') : '',
                videoTitle: plan.code === 'YS' ? title : '',
                hashtags,
                tags,
                platforms: [plan.code],
                accounts: tp.accountId ? [String(tp.accountId)] : [],
                scheduledAt: new Date(),
                status: 'pending',
                sourceTrackingPostId: trackingPost._id
            };

            // Fallback: nếu không có accountId cụ thể cho target này → runner tự fallback theo platform
            try {
                const created = await SchedulePost.create(scheduleData);
                enqueuedCount++;
                resultsToAppend.push({
                    platform: plan.code,
                    accountId: tp.accountId,
                    scheduleId: created._id,
                    status: 'pending',
                    attemptedAt: new Date()
                });
                console.log(`[AutoRepost] Enqueued schedule=${created._id} platform=${plan.code} type=${plan.type} for post=${trackingPost.postId}`);
            } catch (err) {
                console.error(`[AutoRepost] Lỗi tạo SchedulePost cho ${plan.code}:`, err.message);
                resultsToAppend.push({
                    platform: plan.code,
                    accountId: tp.accountId,
                    status: 'failed',
                    error: err.message,
                    attemptedAt: new Date()
                });
            }
        }

        // Cập nhật repostResults + repostEnqueuedAt vào TrackingPost
        if (resultsToAppend.length > 0) {
            await TrackingPost.updateOne(
                { _id: trackingPost._id },
                {
                    $push: { repostResults: { $each: resultsToAppend } },
                    $set: { repostEnqueuedAt: new Date() }
                }
            );
        }

        // Update stats.lastReposted nếu có enqueue thành công
        if (enqueuedCount > 0) {
            try {
                const Tracking = require('../models/Tracking');
                await Tracking.updateOne(
                    { _id: tracking._id },
                    {
                        $set: { 'stats.lastReposted': new Date() },
                        $inc: { 'stats.totalReposted': enqueuedCount }
                    }
                );
            } catch (e) { /* non-fatal */ }
        }

        // Kick runner xử lý ngay
        if (enqueuedCount > 0 && typeof pokeRunner === 'function') {
            try { await pokeRunner(); }
            catch (e) { console.error('[AutoRepost] poke runner error:', e.message); }
        }

        return { enqueuedCount, skippedCount };
    } catch (err) {
        console.error('[AutoRepost] enqueueAutoRepostForTrackingPost error:', err.message);
        return null;
    }
}

async function toggleRepostPause(trackingId, userId, paused) {
    try {
        const Tracking = require('../models/Tracking');
        const t = await Tracking.findOneAndUpdate(
            { _id: trackingId, userId },
            { $set: { repostPaused: !!paused } },
            { new: true }
        ).select('repostPaused').lean();
        if (!t) return { success: false, message: 'Không tìm thấy đối tượng theo dõi' };
        return { success: true, repostPaused: t.repostPaused };
    } catch (err) {
        return { success: false, message: err.message };
    }
}

module.exports = {
    enqueueAutoRepostForTrackingPost,
    toggleRepostPause,
    resolveSchedulePlan // exported for testing
};