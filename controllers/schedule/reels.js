// controllers/schedule/reels.js
const fs = require('fs');
const path = require('path');
const { getReelsScheduleRunnerStatus, runReelsScheduleRunnerNow, runReelsScheduleByIdNow, pokeReelsScheduleRunner } = require('../../services/reelsScheduleRunner');
const { sendTelegramNotification, NOTIFICATION_TYPES } = require('../../services/telegramService');
const { emitScheduleUpdate } = require('../../services/socketService');
const { runBotUploadInstantWithAccount } = require('../../services/facebook/reels');
const {
    buildSchedulePopulateOptions,
    getActiveFacebookChannelForUser,
    resolveShopeeLinksForUpload,
    formatDateTimeVi
} = require('./helpers');

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

        uploadedFilePath = path.join(global.USER_DATA_DIR || path.join(__dirname, '..', '..'), 'uploads', 'videos', req.file.filename);
        if (!fs.existsSync(uploadedFilePath)) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy file video đã upload trên server' });
        }

        const shopeeLinks = await resolveShopeeLinksForUpload(req.user._id, req.body.shopeeLinks);

        const result = await runBotUploadInstantWithAccount({
            userId: req.user._id,
            accountName: facebookChannel.accountName,
            accountType: facebookChannel.accountType || 'Cá nhân',
            existingSessionDir: facebookChannel.storageStatePath ? path.dirname(facebookChannel.storageStatePath) : '',
            post: {
                videoPath: uploadedFilePath,
                content,
                shopeeLinks,
                profileUrl: facebookChannel.profileUrl || ''
            },
            headless: false
        });

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

        sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.ERROR, {
            scheduleTitle: req.body.content || req.body.caption || '—',
            platform: 'FB',
            error: error.message,
            scheduleId: ''
        }).catch(() => {});

        return res.status(500).json({ success: false, message: 'Lỗi upload Reels: ' + error.message });
    }
};

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
        const updatedSchedule = await require('../../models/SchedulePost').findOne({ _id: scheduleId, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();

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
        const updatedSchedule = await require('../../models/SchedulePost').findOne({ _id: scheduleId, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();

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
        
        try {
            emitScheduleUpdate(req.user._id, {
                _id: scheduleId,
                status: 'failed',
                publishedUrl: ''
            });
        } catch (emitErr) {
            console.error('Emit failed update error:', emitErr);
        }

        const failedSchedule = await require('../../models/SchedulePost').findOne({ _id: scheduleId, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();

        sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.ERROR, {
            scheduleTitle: failedSchedule?.caption || failedSchedule?.videoTitle || '—',
            platform: Array.isArray(failedSchedule?.platforms) ? failedSchedule.platforms[0] : 'FB',
            error: error.message,
            scheduleId
        }).catch(() => {});

        try {
            await require('../../models/SchedulePost').updateOne(
                { _id: scheduleId, userId: req.user._id },
                { $set: { status: 'failed' } }
            );
        } catch (updateError) {
            console.error('Run Schedule By Id Now Status Update Error:', updateError);
        }

        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    uploadInstantReels,
    uploadLocalReelsVideo,
    getReelsRunnerStatusAPI,
    runReelsRunnerNowAPI,
    runReelsScheduleByIdNowAPI,
    runScheduleByIdNowAPI
};