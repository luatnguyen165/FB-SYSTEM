// controllers/videoController.js
const Video = require('../models/Video');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');

if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
}

const generateVideoThumbnail = (inputPath, thumbnailPath) => new Promise((resolve, reject) => {
    ffmpeg(inputPath)
        .on('end', () => resolve(thumbnailPath))
        .on('error', reject)
        .screenshots({
            count: 1,
            timemarks: ['1'],
            filename: path.basename(thumbnailPath),
            folder: path.dirname(thumbnailPath),
            size: '480x?'
        });
});

const validateScheduleDateTime = (dateTime) => {
    if (!dateTime) {
        return 'Vui lòng chọn thời gian đăng!';
    }

    const scheduleDate = new Date(dateTime);
    if (Number.isNaN(scheduleDate.getTime())) {
        return 'Thời gian đăng không hợp lệ';
    }

    // Không cho đặt lịch ở quá khứ hoặc ngay tại thời điểm hiện tại
    if (scheduleDate.getTime() < Date.now()) {
        return 'Không thể lên lịch video trong quá khứ';
    }

    return null;
};

// Hiển thị trang Kho Video
const showVideos = async (req, res) => {
    try {
        const videos = await Video.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        res.render('videos', { user: req.user, videos });
    } catch (error) {
        console.error('Show Videos Error:', error);
        res.render('videos', { user: req.user, videos: [] });
    }
};

// API: Upload video
const uploadVideos = async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file video!' });
        }
        const savedVideos = [];
        for (const file of req.files) {
            const thumbFilename = `${path.parse(file.filename).name}-thumb.jpg`;
            const thumbnailAbsPath = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'images', thumbFilename);
            const videoAbsPath = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'videos', file.filename);

            try {
                await generateVideoThumbnail(videoAbsPath, thumbnailAbsPath);
            } catch (thumbError) {
                console.error('Thumbnail generation failed:', thumbError.message);
            }

            const video = await Video.create({
                userId: req.user._id,
                title: file.originalname,
                originalName: file.originalname,
                filename: file.filename,
                filePath: '/uploads/videos/' + file.filename,
                fileSize: file.size,
                thumbnailUrl: fs.existsSync(thumbnailAbsPath) ? '/uploads/images/' + thumbFilename : '/uploads/videos/' + file.filename
            });
            savedVideos.push(video);
        }
        res.json({ success: true, message: `Đã upload ${savedVideos.length} video`, videos: savedVideos });
    } catch (error) {
        console.error('Upload Video Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi upload video: ' + error.message });
    }
};

// API: Lên lịch đăng video
const scheduleVideo = async (req, res) => {
    try {
        const { videoId, caption, dateTime, accounts } = req.body;
        const video = await Video.findOne({ _id: videoId, userId: req.user._id });
        if (!video) return res.status(404).json({ success: false, message: 'Video không tồn tại' });

        const scheduleDateError = validateScheduleDateTime(dateTime);
        if (scheduleDateError) {
            return res.status(400).json({ success: false, message: scheduleDateError });
        }

        video.status = 'scheduled';
        video.scheduleDate = new Date(dateTime);
        video.scheduleCaption = caption || '';
        video.scheduleAccounts = accounts || [];
        await video.save();

        res.json({ success: true, message: 'Đã lên lịch thành công!', video });
    } catch (error) {
        console.error('Schedule Video Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Xóa video
const deleteVideo = async (req, res) => {
    try {
        const video = await Video.findOne({ _id: req.params.id, userId: req.user._id });
        if (!video) return res.status(404).json({ success: false, message: 'Video không tồn tại' });

        // Xóa file trên server
        const filePath = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'videos', video.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        await Video.deleteOne({ _id: video._id });
        res.json({ success: true, message: 'Đã xóa video' });
    } catch (error) {
        console.error('Delete Video Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Xóa nhiều video
const deleteMultipleVideos = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, message: 'Chưa chọn video' });

        const videos = await Video.find({ _id: { $in: ids }, userId: req.user._id });
        for (const video of videos) {
            const filePath = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'videos', video.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await Video.deleteMany({ _id: { $in: ids }, userId: req.user._id });
        res.json({ success: true, message: `Đã xóa ${videos.length} video` });
    } catch (error) {
        console.error('Delete Multiple Videos Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Lấy danh sách video (JSON)
const getVideosAPI = async (req, res) => {
    try {
        const { status, search } = req.query;
        const filter = { userId: req.user._id };
        if (status && status !== 'all') filter.status = status;
        if (search) filter.title = { $regex: search, $options: 'i' };

        const videos = await Video.find(filter).sort({ createdAt: -1 }).lean();
        res.json({ success: true, videos });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { showVideos, uploadVideos, scheduleVideo, deleteVideo, deleteMultipleVideos, getVideosAPI };
