// controllers/douyinTrackerController.js
const fs = require('fs');
const path = require('path');
const DouyinTracking = require('../models/DouyinTracking');
const DouyinVideo = require('../models/DouyinVideo');
const Channel = require('../models/Channel');
const douyinTrackerService = require('../services/douyinTrackerService');

// ============================================================
// PAGE
// ============================================================

exports.showPage = async (req, res) => {
    try {
        const userId = req.user._id;
        const [trackings, videos, channels] = await Promise.all([
            DouyinTracking.find({ userId }).sort({ createdAt: -1 }).lean(),
            DouyinVideo.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
            Channel.find({ userId, isEnabled: true }).sort({ platform: 1 }).lean(),
        ]);

        const stats = {
            totalTrackings: trackings.length,
            activeTrackings: trackings.filter(t => t.status === 'active').length,
            totalDownloaded: trackings.reduce((sum, t) => sum + (t.totalDownloaded || 0), 0),
            totalCrossPosted: trackings.reduce((sum, t) => sum + (t.totalCrossPosted || 0), 0),
        };

        const runnerStatus = douyinTrackerService.getRunnerStatus();

        res.render('douyin-tracker', {
            user: req.session.user || req.user,
            trackings,
            videos,
            channels,
            stats,
            runnerStatus,
            currentPage: 'douyin-tracker',
        });
    } catch (err) {
        console.error('[Douyin Tracker] showPage error:', err.message);
        req.session.flash = { error: 'Lỗi tải trang.' };
        res.redirect('/dashboard');
    }
};

// ============================================================
// API: TRACKING CRUD
// ============================================================

exports.createTracking = async (req, res) => {
    try {
        const userId = req.user._id;
        let { channelUrl, crossPostPlatforms, crossPostAccounts, checkIntervalMinutes, cookiesPath, cookiesExpiresAt, telegramReview } = req.body;

        if (!channelUrl?.trim()) return res.status(400).json({ error: 'Cần URL channel Douyin' });

        channelUrl = channelUrl.trim();
        if (!channelUrl.startsWith('http')) {
            channelUrl = 'https://www.douyin.com/' + channelUrl;
        }

        // Validate Douyin URL
        if (!channelUrl.includes('douyin.com')) {
            return res.status(400).json({ error: 'URL phải là douyin.com' });
        }

        const existing = await DouyinTracking.findOne({ userId, channelUrl });
        if (existing) return res.status(400).json({ error: 'Channel này đang được theo dõi rồi' });

        // Extract sec_uid từ URL
        const secUidMatch = channelUrl.match(/user\/([\w.-]+)/);
        const channelSecUid = secUidMatch ? secUidMatch[1] : '';

        // Extract channel name
        let channelName = '';
        let channelAvatar = '';
        try {
            const result = await douyinTrackerService.fetchUserPageVideos(channelUrl, cookiesPath || null);
            const videos = result.videos || [];
            if (videos.length) {
                channelName = videos[0].author || secUidMatch?.[1]?.substring(0, 20) || '';
            }
        } catch {}

        const tracking = await DouyinTracking.create({
            userId,
            channelUrl,
            channelName,
            channelAvatar,
            channelSecUid,
            crossPostPlatforms: crossPostPlatforms || ['FB'],
            crossPostAccounts: crossPostAccounts || [],
            checkIntervalMinutes: checkIntervalMinutes || 15,
            cookiesPath: cookiesPath || '',
            telegramReview: !!telegramReview,
        });

        res.json({ success: true, tracking });
    } catch (err) {
        console.error('[Douyin Tracker] createTracking error:', err.message);
        res.status(500).json({ error: 'Lỗi: ' + err.message });
    }
};

exports.listTrackings = async (req, res) => {
    try {
        const trackings = await DouyinTracking.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        res.json({ success: true, trackings });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateTracking = async (req, res) => {
    try {
        const tracking = await DouyinTracking.findOne({ _id: req.params.id, userId: req.user._id });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy' });

        const { status, crossPostPlatforms, crossPostAccounts, checkIntervalMinutes, cookiesPath, telegramReview } = req.body;
        if (status !== undefined) tracking.status = status;
        if (crossPostPlatforms !== undefined) tracking.crossPostPlatforms = crossPostPlatforms;
        if (crossPostAccounts !== undefined) tracking.crossPostAccounts = crossPostAccounts;
        if (checkIntervalMinutes !== undefined) tracking.checkIntervalMinutes = Math.max(5, Math.min(1440, checkIntervalMinutes));
        if (cookiesPath !== undefined) tracking.cookiesPath = cookiesPath;
        if (telegramReview !== undefined) tracking.telegramReview = !!telegramReview;
        tracking.updatedAt = new Date();
        await tracking.save();

        res.json({ success: true, tracking });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteTracking = async (req, res) => {
    try {
        const tracking = await DouyinTracking.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy' });
        await DouyinVideo.deleteMany({ trackingId: tracking._id });
        res.json({ success: true, message: 'Đã xóa' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.checkNow = async (req, res) => {
    try {
        const tracking = await DouyinTracking.findOne({ _id: req.params.id, userId: req.user._id });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy' });

        const result = await douyinTrackerService.checkAndDownload(tracking);
        if (result.needsLogin) {
            return res.json({ success: true, ...result, message: 'Cần upload cookies.txt để truy cập channel này' });
        }
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// API: VIDEOS
// ============================================================

exports.listVideos = async (req, res) => {
    try {
        const { trackingId, status } = req.query;
        const filter = { userId: req.user._id };
        if (trackingId) filter.trackingId = trackingId;
        if (status) filter.status = status;

        const videos = await DouyinVideo.find(filter)
            .populate('trackingId', 'channelName channelUrl')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        res.json({ success: true, videos });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.crossPostVideo = async (req, res) => {
    try {
        const video = await DouyinVideo.findOne({ _id: req.params.id, userId: req.user._id });
        if (!video) return res.status(404).json({ error: 'Không tìm thấy video' });

        const tracking = await DouyinTracking.findOne({ _id: video.trackingId });
        if (!tracking) return res.status(404).json({ error: 'Không tìm thấy tracking' });

        const schedulePost = await douyinTrackerService.createCrossPostSchedule(video, tracking);
        if (schedulePost) {
            res.json({ success: true, message: 'Đã tạo lịch đăng', schedulePostId: schedulePost._id });
        } else {
            res.status(400).json({ error: 'Chưa cấu hình nền tảng hoặc tài khoản cross-post' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** GET /douyin-tracker/api/videos/:id/preview — stream video for preview */
exports.previewVideo = async (req, res) => {
    try {
        const video = await DouyinVideo.findOne({ _id: req.params.id, userId: req.user._id });
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

exports.deleteVideo = async (req, res) => {
    try {
        const video = await DouyinVideo.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
        if (!video) return res.status(404).json({ error: 'Không tìm thấy' });
        if (video.downloadPath && fs.existsSync(video.downloadPath)) {
            try { fs.unlinkSync(video.downloadPath); } catch {}
        }
        res.json({ success: true, message: 'Đã xóa' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/** POST /douyin-tracker/api/videos/:id/retry — retry download for failed/skipped video */
exports.retryDownload = async (req, res) => {
    try {
        const video = await DouyinVideo.findOne({ _id: req.params.id, userId: req.user._id });
        if (!video) return res.status(404).json({ error: 'Không tìm thấy' });
        if (!['failed', 'skipped'].includes(video.status)) {
            return res.status(400).json({ error: 'Chỉ retry video failed hoặc skipped' });
        }

        const tracking = await DouyinTracking.findById(video.trackingId);
        if (!tracking) return res.status(404).json({ error: 'Tracking không tồn tại' });

        let cookiesPath = await douyinTrackerService.getCookiesPath(req.user._id, tracking);

        video.status = 'downloading';
        await video.save();

        douyinTrackerService.downloadVideo(video.douyinUrl, video.douyinVideoId, cookiesPath).then(async (localPath) => {
            if (localPath) {
                const stats = fs.statSync(localPath);
                video.downloadPath = localPath;
                video.downloadSize = `${(stats.size / (1024 * 1024)).toFixed(1)}MB`;
                video.status = 'downloaded';
                video.downloadedAt = new Date();
                video.downloadError = '';
                await video.save();
                console.log(`[Douyin Tracker] Retry downloaded: ${video.title || video.douyinVideoId}`);
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

exports.getRunnerStatus = async (req, res) => {
    res.json(douyinTrackerService.getRunnerStatus());
};

// ============================================================
// UPLOAD COOKIES FILE
// ============================================================

const COOKIES_DIR = path.join(douyinTrackerService.DOWNLOAD_DIR, 'cookies');
if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });

const multer = require('multer');
const { parseCookieExpiry } = require('../utils/cookieUtils');
const cookiesStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, COOKIES_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.txt';
        cb(null, `dy_cookies_${req.user._id}_${Date.now()}${ext}`);
    },
});
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
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
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
            console.error('[Douyin Tracker] uploadCookies error:', err.message);
            res.status(500).json({ error: err.message });
        }
    },
];

// ============================================================
// LOGIN VIA BROWSER
// ============================================================

exports.loginStatus = async (req, res) => {
    try {
        const userId = req.user._id;
        const status = await douyinTrackerService.checkLoginStatus(userId);
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.loginViaBrowser = async (req, res) => {
    try {
        const userId = req.user._id;
        const timeout = Math.min(parseInt(req.body.timeout) || 300000, 600000); // max 10 phút

        // Trả response ngay, login chạy async
        res.json({ ok: true, message: 'Đang mở browser để login Douyin. Vui lòng login trong cửa sổ trình duyệt.' });

        // Chạy login async
        douyinTrackerService.loginViaBrowser(userId, timeout)
            .then(result => {
                console.log(`[Douyin Tracker] Login result for user ${userId}:`, result.ok ? 'SUCCESS' : result.error);
            })
            .catch(err => {
                console.error(`[Douyin Tracker] Login async error:`, err.message);
            });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ============================================================
// TEST DOWNLOAD - Test download video/channel từ UI
// ============================================================

exports.testDownload = async (req, res) => {
    try {
        const userId = req.user._id;
        const { url, type } = req.body;

        if (!url?.trim()) return res.status(400).json({ error: 'Cần URL' });

        const targetUrl = url.trim();
        console.log(`[Douyin Tracker] Test download: ${targetUrl} (type: ${type || 'auto'})`);

        // Trả response ngay, chạy async
        res.json({ ok: true, message: 'Đang test download... Mở Chrome để xem.' });

        // Chạy test async
        (async () => {
            try {
                let videoIds = [];
                let channelName = '';

                if (type === 'video' || (!type && targetUrl.includes('/video/'))) {
                    // Test download 1 video
                    const awemeMatch = targetUrl.match(/video\/(\d+)/);
                    if (awemeMatch) videoIds = [awemeMatch[1]];
                } else {
                    // Test download từ channel - tìm channel URL trước
                    let channelUrl = targetUrl;
                    if (!channelUrl.includes('/user/')) {
                        // Có thể là video URL, tìm channel từ đó
                        const result = await douyinTrackerService.fetchUserPageVideos(targetUrl, null);
                        // Nếu fetchUserPageVideos fail, thử extract channel
                    }

                    const result = await douyinTrackerService.fetchUserPageVideos(channelUrl, null);
                    const videos = result.videos || [];
                    if (videos.length) {
                        channelName = videos[0].author || '';
                        videoIds = videos.slice(0, 3).map(v => v.id); // Download 3 video mới nhất
                    }
                }

                if (!videoIds.length) {
                    console.log(`[Douyin Tracker] Test: Không tìm thấy video nào`);
                    return;
                }

                console.log(`[Douyin Tracker] Test: Downloading ${videoIds.length} videos...`);

                for (const vid of videoIds) {
                    const videoUrl = `https://www.douyin.com/video/${vid}`;
                    console.log(`[Douyin Tracker] Test: ${videoUrl}`);

                    const result = await douyinTrackerService.downloadVideo(videoUrl, vid, null, userId);
                    if (result) {
                        console.log(`[Douyin Tracker] Test: SUCCESS ${vid} (${result.method})`);
                    } else {
                        console.log(`[Douyin Tracker] Test: FAILED ${vid}`);
                    }
                }

                console.log(`[Douyin Tracker] Test download hoàn tất!`);
            } catch (err) {
                console.error(`[Douyin Tracker] Test download error:`, err.message);
            }
        })();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
