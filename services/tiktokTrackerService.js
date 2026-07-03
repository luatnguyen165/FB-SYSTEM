// services/tiktokTrackerService.js
// Theo dõi TikTok channel → download video mới → cross-post lên FB Reels, TH, PI, IG
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const TikTokTracking = require('../models/TikTokTracking');
const TikTokVideo = require('../models/TikTokVideo');
const Channel = require('../models/Channel');
const SchedulePost = require('../models/SchedulePost');

const DOWNLOAD_DIR = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'tiktok-tracker');
const CHECK_INTERVAL_MS = 60 * 1000; // Check mỗi 60s
let _interval = null;
let _isProcessing = false;

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// ============================================================
// COOKIE HELPERS
// ============================================================

async function getCookiesPathForUser(userId, platform = 'TT') {
    try {
        const channel = await Channel.findOne({ userId, platform, isEnabled: true }).sort({ updatedAt: -1 }).lean();
        if (!channel?.storageStatePath) return null;
        const storagePath = path.isAbsolute(channel.storageStatePath)
            ? channel.storageStatePath
            : path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), channel.storageStatePath);
        if (!fs.existsSync(storagePath)) return null;

        const storageState = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
        if (!storageState.cookies?.length) return null;

        const tempCookiesPath = path.join(DOWNLOAD_DIR, `cookies_${userId}_${platform}.txt`);
        const cookieLines = storageState.cookies.map(c => {
            const domain = c.domain || '';
            const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
            return `${domain}\t${includeSub}\t${c.path || '/'}\t${c.secure ? 'TRUE' : 'FALSE'}\t${(typeof c.expires === 'number' && c.expires > 0) ? Math.floor(c.expires) : 0}\t${c.name || ''}\t${c.value || ''}`;
        });
        const header = ['# Netscape HTTP Cookie File', `# Generated for user ${userId} platform ${platform}`, ''];
        fs.writeFileSync(tempCookiesPath, header.join('\n') + cookieLines.join('\n'), 'utf-8');
        return tempCookiesPath;
    } catch (err) {
        console.error(`[TikTok Tracker] Lỗi lấy cookies: ${err.message}`);
        return null;
    }
}

// ============================================================
// YT-DLP: LẤY DANH SÁCH VIDEO TỪ CHANNEL
// ============================================================

/**
 * Lấy metadata 5 video mới nhất từ TikTok channel bằng yt-dlp
 * Trả về array [{id, title, url, thumbnail, duration, viewCount, likeCount, commentCount, description, author, publishedAt}]
 */
async function fetchChannelVideos(channelUrl, cookiesPath) {
    try {
        const cookiesArg = cookiesPath ? `--cookies "${cookiesPath.replace(/\\/g, '/')}"` : '';
        // Lấy JSON metadata của 5 video mới nhất
        const safeUrl = channelUrl.replace(/"/g, '\\"');
        const cmd = `yt-dlp --flat-playlist --playlist-items 1:5 --dump-json --no-warnings ${cookiesArg} "${safeUrl}"`;
        const output = execSync(cmd, { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }).toString().trim();
        const lines = output.split('\n').filter(l => l.trim());
        const videos = [];
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                videos.push({
                    id: data.id || data.webpage_url?.match(/video\/(\d+)/)?.[1] || '',
                    title: data.title || data.fulltitle || '',
                    url: data.webpage_url || data.url || `https://www.tiktok.com/video/${data.id}`,
                    thumbnail: data.thumbnail || data.thumbnails?.[0]?.url || '',
                    duration: data.duration || 0,
                    viewCount: data.view_count || 0,
                    likeCount: data.like_count || 0,
                    commentCount: data.comment_count || 0,
                    description: data.description || '',
                    author: data.uploader || data.channel || '',
                    authorAvatar: data.uploader_avatar || '',
                    publishedAt: data.upload_date ? new Date(`${data.upload_date.slice(0,4)}-${data.upload_date.slice(4,6)}-${data.upload_date.slice(6,8)}`) : null,
                });
            } catch {}
        }
        return videos;
    } catch (err) {
        console.error(`[TikTok Tracker] Lỗi fetch channel videos: ${err.message}`);
        return [];
    }
}

// ============================================================
// YT-DLP: DOWNLOAD VIDEO
// ============================================================

/**
 * Download video TikTok bằng yt-dlp, trả về local file path
 */
async function downloadVideo(videoUrl, videoId, cookiesPath) {
    const filename = `tt_${videoId}_${Date.now()}.mp4`;
    const outputPath = path.join(DOWNLOAD_DIR, filename);
    try {
        const cookiesArg = cookiesPath ? `--cookies "${cookiesPath.replace(/\\/g, '/')}"` : '';
        const safeUrl = videoUrl.replace(/"/g, '\\"');
        const cmd = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4 --no-warnings ${cookiesArg} -o "${outputPath}" "${safeUrl}"`;
        execSync(cmd, { timeout: 300000 }); // 5 phút timeout

        // yt-dlp có thể đổi tên file, tìm file thực tế
        if (fs.existsSync(outputPath)) return outputPath;
        // Tìm file match pattern
        const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => f.startsWith(`tt_${videoId}_`));
        if (files.length) return path.join(DOWNLOAD_DIR, files[files.length - 1]);
        return null;
    } catch (err) {
        console.error(`[TikTok Tracker] Lỗi download video ${videoId}: ${err.message}`);
        return null;
    }
}

// ============================================================
// CHECK & DOWNLOAD CHO MỘT TRACKING
// ============================================================

async function checkAndDownload(tracking) {
    const userId = tracking.userId;
    console.log(`[TikTok Tracker] Checking: ${tracking.channelName || tracking.channelUrl}`);

    // Lấy cookies TikTok - ưu tiên cookies từ tracking config
    let cookiesPath = tracking.cookiesPath || '';
    if (!cookiesPath || !fs.existsSync(cookiesPath)) {
        cookiesPath = await getCookiesPathForUser(userId, 'TT');
    }

    // Fetch video list
    const videos = await fetchChannelVideos(tracking.channelUrl, cookiesPath);
    if (!videos.length) {
        console.log(`[TikTok Tracker] Không tìm thấy video nào từ ${tracking.channelUrl}`);
        return { newCount: 0, downloadCount: 0 };
    }

    // Lấy danh sách video ID đã download
    const existingIds = await TikTokVideo.find({ trackingId: tracking._id }).distinct('tiktokVideoId');
    const existingSet = new Set(existingIds);

    // Lần check đầu tiên (chưa có lastCheckedAt): chỉ ghi nhận ID hiện tại, không download
    const isFirstCheck = !tracking.lastCheckedAt;
    if (isFirstCheck && existingIds.length === 0) {
        const bulkOps = videos.filter(v => v.id).map(v => ({
            insertOne: {
                document: {
                    userId,
                    trackingId: tracking._id,
                    tiktokVideoId: v.id,
                    tiktokUrl: v.url,
                    title: v.title,
                    description: v.description,
                    thumbnail: v.thumbnail,
                    duration: v.duration,
                    viewCount: v.viewCount,
                    likeCount: v.likeCount,
                    commentCount: v.commentCount,
                    author: v.author,
                    authorAvatar: v.authorAvatar,
                    publishedAt: v.publishedAt,
                    status: 'skipped',
                }
            }
        }));
        if (bulkOps.length) await TikTokVideo.bulkWrite(bulkOps, { ordered: false });
        tracking.lastCheckedAt = new Date();
        await tracking.save();
        console.log(`[TikTok Tracker] Lần check đầu tiên — ghi nhận ${videos.length} video hiện có, bỏ qua. Check lại sau để lấy video mới.`);
        return { newCount: 0, downloadCount: 0 };
    }

    // Filter video mới
    const newVideos = videos.filter(v => v.id && !existingSet.has(v.id));
    if (!newVideos.length) {
        console.log(`[TikTok Tracker] Không có video mới từ ${tracking.channelName || tracking.channelUrl}`);
        return { newCount: 0, downloadCount: 0 };
    }

    console.log(`[TikTok Tracker] Tìm thấy ${newVideos.length} video mới từ ${tracking.channelName}`);

    let downloadCount = 0;
    for (const video of newVideos) {
        try {
            // Tạo record trước
            const videoDoc = await TikTokVideo.create({
                userId,
                trackingId: tracking._id,
                tiktokVideoId: video.id,
                tiktokUrl: video.url,
                title: video.title,
                description: video.description,
                thumbnail: video.thumbnail,
                duration: video.duration,
                viewCount: video.viewCount,
                likeCount: video.likeCount,
                commentCount: video.commentCount,
                author: video.author,
                authorAvatar: video.authorAvatar,
                publishedAt: video.publishedAt,
                status: 'downloading',
            });

            // Download (auto-retry 3 lần)
            let localPath = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                localPath = await downloadVideo(video.url, video.id, cookiesPath);
                if (localPath) break;
                if (attempt < 3) {
                    console.log(`[TikTok Tracker] Retry ${attempt}/3 cho video ${video.id}...`);
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
            if (localPath) {
                const stats = fs.statSync(localPath);
                videoDoc.downloadPath = localPath;
                videoDoc.downloadSize = `${(stats.size / (1024 * 1024)).toFixed(1)}MB`;
                videoDoc.status = 'downloaded';
                videoDoc.downloadedAt = new Date();
                await videoDoc.save();

                // Tạo SchedulePost cho cross-post
                await createCrossPostSchedule(videoDoc, tracking);
                downloadCount++;
                console.log(`[TikTok Tracker] Downloaded: ${video.title || video.id}`);
            } else {
                videoDoc.status = 'failed';
                videoDoc.downloadError = 'Download failed';
                await videoDoc.save();
            }
        } catch (err) {
            console.error(`[TikTok Tracker] Lỗi xử lý video ${video.id}: ${err.message}`);
        }
    }

    // Cập nhật tracking stats
    tracking.lastCheckedAt = new Date();
    tracking.totalDownloaded = (tracking.totalDownloaded || 0) + downloadCount;
    await tracking.save();

    return { newCount: newVideos.length, downloadCount };
}

// ============================================================
// TẠO SCHEDULE POST CHO CROSS-POST
// ============================================================

async function createCrossPostSchedule(videoDoc, tracking) {
    // Check Telegram review mode
    if (tracking.telegramReview) {
        const { getTelegramConfig, sendVideoForReview } = require('./telegramService');
        const config = await getTelegramConfig(videoDoc.userId);
        if (config) {
            const result = await sendVideoForReview(config.botToken, config.chatId, videoDoc, 'tiktok');
            if (result.ok) {
                videoDoc.telegramReviewStatus = 'pending';
                videoDoc.telegramMsgId = result.messageId;
                videoDoc.status = 'pending_review';
                await videoDoc.save();
                console.log(`[TikTok Tracker] Sent to Telegram for review: ${videoDoc.title || videoDoc.tiktokVideoId}`);
                return null; // Không tạo schedule post yet, chờ approve
            } else {
                console.warn(`[TikTok Tracker] Telegram review failed, falling back to direct cross-post: ${result.error}`);
            }
        } else {
            console.warn(`[TikTok Tracker] No Telegram config, falling back to direct cross-post`);
        }
    }

    const platforms = tracking.crossPostPlatforms || [];
    const accounts = (tracking.crossPostAccounts || []).map(id => String(id));
    if (!platforms.length || !accounts.length) return;

    // Facebook Auto-Report Bypass: Process video before cross-post
    let processedVideoPath = videoDoc.downloadPath;
    let caption = videoDoc.title || videoDoc.description || '';
    
    try {
        const { processVideoForCrossPost, randomDelay } = require('./facebookBypassService');
        
        // Random delay trước khi xử lý
        await randomDelay('afterDownload');
        
        // Process video: watermark + fingerprint modification
        const processed = await processVideoForCrossPost(videoDoc.downloadPath, {
            platform: platforms[0] || 'FB',
            author: tracking.channelName || '',
            caption: caption,
        });
        
        processedVideoPath = processed.videoPath;
        caption = processed.caption;
        
        console.log(`[TikTok Tracker] Video processed for bypass: ${path.basename(processedVideoPath)}`);
    } catch (err) {
        console.warn(`[TikTok Tracker] Bypass processing failed, using original: ${err.message}`);
    }

    const schedulePost = await SchedulePost.create({
        userId: videoDoc.userId,
        type: 'reels',
        caption,
        videoPath: processedVideoPath,
        videoTitle: videoDoc.title,
        platforms,
        accounts,
        scheduledAt: new Date(), // Đăng ngay khi có video mới
        status: 'pending',
        sourceTrackingPostId: videoDoc._id,
    });

    // Update video doc
    videoDoc.crossPostResults = platforms.map(p => ({
        platform: p,
        accountChannelId: accounts[0] || null,
        status: 'pending',
    }));
    videoDoc.status = 'cross_posting';
    await videoDoc.save();

    // Update tracking stats
    tracking.totalCrossPosted = (tracking.totalCrossPosted || 0) + 1;
    await tracking.save();

    // Poke reels runner để xử lý ngay
    try {
        const { pokeReelsScheduleRunner } = require('./reelsScheduleRunner');
        pokeReelsScheduleRunner();
    } catch {}

    return schedulePost;
}

// ============================================================
// PROCESS: CHECK TẤT CẢ TRACKING ACTIVE
// ============================================================

async function processAllTrackings() {
    if (_isProcessing) return;
    _isProcessing = true;
    try {
        const now = new Date();
        const trackings = await TikTokTracking.find({ status: 'active' });
        for (const tracking of trackings) {
            // Kiểm tra interval
            const lastCheck = tracking.lastCheckedAt;
            const intervalMs = (tracking.checkIntervalMinutes || 15) * 60 * 1000;
            if (lastCheck && (now - lastCheck) < intervalMs) continue;

            try {
                const result = await checkAndDownload(tracking);
                if (result.downloadCount > 0) {
                    console.log(`[TikTok Tracker] ${tracking.channelName}: ${result.downloadCount} video mới`);
                }
            } catch (err) {
                console.error(`[TikTok Tracker] Error checking ${tracking.channelUrl}: ${err.message}`);
                tracking.lastError = err.message;
                await tracking.save();
            }
        }
    } finally {
        _isProcessing = false;
    }
}

// ============================================================
// START / STOP RUNNER
// ============================================================

function startTikTokTrackerRunner() {
    console.log('[TikTok Tracker] Starting runner...');
    // Chạy lần đầu sau 30s
    setTimeout(() => processAllTrackings(), 30000);
    // Sau đó check mỗi 60s
    _interval = setInterval(processAllTrackings, CHECK_INTERVAL_MS);
}

function stopTikTokTrackerRunner() {
    if (_interval) {
        clearInterval(_interval);
        _interval = null;
    }
    console.log('[TikTok Tracker] Stopped runner.');
}

function getRunnerStatus() {
    return {
        running: !!_interval,
        processing: _isProcessing,
    };
}

module.exports = {
    startTikTokTrackerRunner,
    stopTikTokTrackerRunner,
    processAllTrackings,
    getRunnerStatus,
    checkAndDownload,
    fetchChannelVideos,
    downloadVideo,
    getCookiesPathForUser,
    createCrossPostSchedule,
    DOWNLOAD_DIR,
};
