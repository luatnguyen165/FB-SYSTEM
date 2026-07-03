// controllers/tiktokTrackerController.js
const fs = require('fs');
const path = require('path');
const TikTokTracking = require('../models/TikTokTracking');
const TikTokVideo = require('../models/TikTokVideo');
const Channel = require('../models/Channel');
const tiktokTrackerService = require('../services/tiktokTrackerService');

// ============================================================
// PAGE
// ============================================================

exports.showPage = async (req, res) => {
    try {
        const userId = req.user._id;
        const [trackings, videos, channels] = await Promise.all([
            TikTokTracking.find({ userId }).sort({ createdAt: -1 }).lean(),
            TikTokVideo.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
            Channel.find({ userId, isEnabled: true }).sort({ platform: 1 }).lean(),
        ]);

        const stats = {
            totalTrackings: trackings.length,
            activeTrackings: trackings.filter(t => t.status === 'active').length,
            totalDownloaded: trackings.reduce((sum, t) => sum + (t.totalDownloaded || 0), 0),
            totalCrossPosted: trackings.reduce((sum, t) => sum + (t.totalCrossPosted || 0), 0),
        };

        const runnerStatus = tiktokTrackerService.getRunnerStatus();

        res.render('tiktok-tracker', {
            user: req.session.user || req.user,
            trackings,
            videos,
            channels,
            stats,
            runnerStatus,
            currentPage: 'tiktok-tracker',
        });
    } catch (err) {
        console.error('[TikTok Tracker] showPage error:', err.message);
        req.session.flash = { error: 'Lỗi tải trang.' };
        res.redirect('/dashboard');
    }
};

// ============================================================
// API: TRACKING CRUD
// ============================================================

/** POST /tiktok-tracker/api/trackings — thêm channel cần theo dõi */
exports.createTracking = async (req, res) => {
    try {
        const userId = req.user._id;
        let { channelUrl, crossPostPlatforms, crossPostAccounts, checkIntervalMinutes, cookiesPath: cookiesPathFromBody, cookiesExpiresAt, telegramReview } = req.body;

        if (!channelUrl?.trim()) return res.status(400).json({ error: 'Cần URL channel TikTok' });

        // Normalize URL
        channelUrl = channelUrl.trim();
        if (!channelUrl.startsWith('http')) {
            channelUrl = 'https://www.tiktok.com/' + channelUrl;
        }
        // Extract @username if needed
        const usernameMatch = channelUrl.match(/@([\w.-]+)/);
        if (usernameMatch) {
            channelUrl = `https://www.tiktok.com/@${usernameMatch[1]}`;
        }

        // Check duplicate
        const existing = await TikTokTracking.findOne({ userId, channelUrl });
        if (existing) return res.status(400).json({ error: 'Channel này đang được theo dõi rồi' });

        // Fetch channel info
        const cookiesPath = await tiktokTrackerService.getCookiesPathForUser(userId, 'TT');
        let channelName = '';
        let channelAvatar = '';
        try {
            const videos = await tiktokTrackerService.fetchChannelVideos(channelUrl, cookiesPath);
            if (videos.length) {
                channelName = videos[0].author || usernameMatch?.[1] || '';
                channelAvatar = videos[0].authorAvatar || '';
            }
        } catch {}

        const tracking = await TikTokTracking.create({
            userId,
            channelUrl,
            channelName,
            channelAvatar,
            crossPostPlatforms: crossPostPlatforms || ['FB'],
            crossPostAccounts: crossPostAccounts || [],
            checkIntervalMinutes: checkIntervalMinutes || 15,
            cookiesPath: cookiesPathFromBody || '',
            cookiesExpiresAt: cookiesExpiresAt || null,
            telegramReview: !!telegramReview,
        });

        res.json({ success: true, tracking });
    } catch (err) {
        console.error('[TikTok Tracker] createTracking error:', err.message);
        res.status(500).json({ error: 'Lỗi: ' + err.message });
    }
};

/** GET /tiktok-tracker/api/trackings — danh sách tracking */
exports.listTrackings = async (req, res) => {
    try {
        const trackings = await TikTokTracking.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        res.json({ success: true, trackings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** PUT /tiktok-tracker/api/trackings/:id — cập nhật tracking */
exports.updateTracking = async (req, res) => {
    try {
        const tracking = await TikTokTracking.findOne({ _id: req.params.id, userId: req.user._id });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy' });

        const { status, crossPostPlatforms, crossPostAccounts, checkIntervalMinutes, telegramReview } = req.body;
        if (status !== undefined) tracking.status = status;
        if (crossPostPlatforms !== undefined) tracking.crossPostPlatforms = crossPostPlatforms;
        if (crossPostAccounts !== undefined) tracking.crossPostAccounts = crossPostAccounts;
        if (checkIntervalMinutes !== undefined) tracking.checkIntervalMinutes = Math.max(5, Math.min(1440, checkIntervalMinutes));
        if (telegramReview !== undefined) tracking.telegramReview = !!telegramReview;
        tracking.updatedAt = new Date();
        await tracking.save();

        res.json({ success: true, tracking });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** DELETE /tiktok-tracker/api/trackings/:id — xóa tracking */
exports.deleteTracking = async (req, res) => {
    try {
        const tracking = await TikTokTracking.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy' });
        // Xóa tất cả video liên quan
        await TikTokVideo.deleteMany({ trackingId: tracking._id });
        res.json({ success: true, message: 'Đã xóa' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** POST /tiktok-tracker/api/trackings/:id/check — check ngay lập tức */
exports.checkNow = async (req, res) => {
    try {
        const tracking = await TikTokTracking.findOne({ _id: req.params.id, userId: req.user._id });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy' });

        const result = await tiktokTrackerService.checkAndDownload(tracking);
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// API: VIDEOS
// ============================================================

/** GET /tiktok-tracker/api/videos — danh sách video đã download */
exports.listVideos = async (req, res) => {
    try {
        const { trackingId, status } = req.query;
        const filter = { userId: req.user._id };
        if (trackingId) filter.trackingId = trackingId;
        if (status) filter.status = status;

        const videos = await TikTokVideo.find(filter)
            .populate('trackingId', 'channelName channelUrl')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        res.json({ success: true, videos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** POST /tiktok-tracker/api/videos/:id/crosspost — cross-post một video */
exports.crossPostVideo = async (req, res) => {
    try {
        const video = await TikTokVideo.findOne({ _id: req.params.id, userId: req.user._id });
        if (!video) return res.status(404).json({ error: 'Không tìm thấy video' });

        const tracking = await TikTokTracking.findOne({ _id: video.trackingId });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy tracking' });

        const schedulePost = await tiktokTrackerService.createCrossPostSchedule(video, tracking);
        if (schedulePost) {
            res.json({ success: true, message: 'Đã tạo lịch đăng', schedulePostId: schedulePost._id });
        } else {
            res.status(400).json({ error: 'Chưa cấu hình nền tảng hoặc tài khoản cross-post' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** GET /tiktok-tracker/api/videos/:id/preview — stream video for preview */
exports.previewVideo = async (req, res) => {
    try {
        const video = await TikTokVideo.findOne({ _id: req.params.id, userId: req.user._id });
        if (!video || !video.downloadPath || !fs.existsSync(video.downloadPath)) {
            return res.status(404).json({ error: 'Video chưa được tải hoặc không tìm thấy' });
        }
        const stat = fs.statSync(video.downloadPath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
            });
            fs.createReadStream(video.downloadPath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes',
            });
            fs.createReadStream(video.downloadPath).pipe(res);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** DELETE /tiktok-tracker/api/videos/:id — xóa video */
exports.deleteVideo = async (req, res) => {
    try {
        const video = await TikTokVideo.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!video) return res.status(404).json({ error: 'Không tìm thấy' });
        // Xóa file local
        if (video.downloadPath && fs.existsSync(video.downloadPath)) {
            try { fs.unlinkSync(video.downloadPath); } catch {}
        }
        res.json({ success: true, message: 'Đã xóa' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** POST /tiktok-tracker/api/videos/:id/retry — retry download for failed/skipped video */
exports.retryDownload = async (req, res) => {
    try {
        const video = await TikTokVideo.findOne({ _id: req.params.id, userId: req.user._id });
        if (!video) return res.status(404).json({ error: 'Không tìm thấy' });
        if (!['failed', 'skipped'].includes(video.status)) {
            return res.status(400).json({ error: 'Chỉ retry video failed hoặc skipped' });
        }

        // Lấy tracking để có cookies
        const tracking = await TikTokTracking.findById(video.trackingId);
        if (!tracking) return res.status(404).json({ error: 'Tracking không tồn tại' });

        let cookiesPath = tracking.cookiesPath || '';
        if (!cookiesPath || !fs.existsSync(cookiesPath)) {
            cookiesPath = await tiktokTrackerService.getCookiesPathForUser(req.user._id, 'TT');
        }

        video.status = 'downloading';
        await video.save();

        // Download async với auto-retry 3 lần, không block response
        (async () => {
            let localPath = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                localPath = await tiktokTrackerService.downloadVideo(video.tiktokUrl, video.tiktokVideoId, cookiesPath);
                if (localPath) break;
                if (attempt < 3) {
                    console.log(`[TikTok Tracker] Retry ${attempt}/3 cho video ${video.tiktokVideoId}...`);
                    await new Promise(r => setTimeout(r, 3000));
                }
            }
            if (localPath) {
                const stats = fs.statSync(localPath);
                video.downloadPath = localPath;
                video.downloadSize = `${(stats.size / (1024 * 1024)).toFixed(1)}MB`;
                video.status = 'downloaded';
                video.downloadedAt = new Date();
                video.downloadError = '';
                await video.save();
                console.log(`[TikTok Tracker] Retry downloaded: ${video.title || video.tiktokVideoId}`);
            } else {
                video.status = 'failed';
                video.downloadError = 'Download failed';
                await video.save();
            }
        }).catch(async (err) => {
            video.status = 'failed';
            video.downloadError = err.message;
            await video.save();
        });

        res.json({ success: true, message: 'Đang tải lại...' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// API: RUNNER STATUS
// ============================================================

exports.getRunnerStatus = async (req, res) => {
    res.json(tiktokTrackerService.getRunnerStatus());
};

// ============================================================
// UPLOAD COOKIES FILE
// ============================================================

const COOKIES_DIR = path.join(tiktokTrackerService.DOWNLOAD_DIR || path.join(__dirname, '..', 'uploads', 'tiktok-tracker'), 'cookies');
if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });

const multer = require('multer');
const cookiesStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, COOKIES_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.txt';
        cb(null, `tt_cookies_${req.user._id}_${Date.now()}${ext}`);
    },
});
const { parseCookieExpiry } = require('../utils/cookieUtils');

const uploadCookiesMulter = multer({
    storage: cookiesStorage,
    fileFilter: (req, file, cb) => {
        const allowed = ['.txt', '.cookie', '.cookies', '.json'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext) || file.mimetype === 'application/json') {
            cb(null, true);
        } else {
            cb(new Error('Chỉ chấp nhận file .txt, .cookie, .json'));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 },
});

exports.uploadCookies = [
    uploadCookiesMulter.single('cookiesFile'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'Không có file nào được tải lên' });
            }
            const expiresAt = parseCookieExpiry(req.file.path);
            res.json({
                success: true,
                cookiesPath: req.file.path,
                fileName: req.file.originalname,
                size: req.file.size,
                expiresAt: expiresAt ? expiresAt.toISOString() : null,
            });
        } catch (err) {
            console.error('[TikTok Tracker] uploadCookies error:', err.message);
            res.status(500).json({ error: err.message });
        }
    },
];
