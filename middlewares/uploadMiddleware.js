// middlewares/uploadMiddleware.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadErrorHandler = (err, req, res, next) => {
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
        // Multer nhận field không expected — bỏ qua, request tiếp tục
        return next();
    }
    if (err) {
        console.error('[Multer Error]', err.message);
        return res.status(400).json({ success: false, message: 'Lỗi upload file: ' + err.message });
    }
    next();
};

// Tạo thư mục uploads nếu chưa có - dùng USER_DATA_DIR khi chạy qua Electron build
const dataDir = global.USER_DATA_DIR || path.join(__dirname, '..');
const uploadDir = path.join(dataDir, 'uploads');
const videoDir = path.join(uploadDir, 'videos');
const imageDir = path.join(uploadDir, 'images');

[uploadDir, videoDir, imageDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Cấu hình lưu video
const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, videoDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

// Cấu hình lưu ảnh
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, imageDir),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});

const uploadVideo = multer({
    storage: videoStorage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /mp4|mov|avi|mkv|webm/;
        const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mime = file.mimetype.startsWith('video/');
        if (ext && mime) return cb(null, true);
        cb(new Error('Chỉ chấp nhận file video (mp4, mov, avi, mkv, webm)'));
    }
});

// Multer instance gốc cho ảnh (chưa gọi .any/.single/.array)
const _multerImageInstance = multer({
    storage: imageStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mime = file.mimetype.startsWith('image/');
        if (ext && mime) return cb(null, true);
        cb(new Error('Chỉ chấp nhận file ảnh (jpg, png, gif, webp)'));
    }
});

// Alias giữ API cũ: uploadImage.single('avatar') / .array(...) vẫn hoạt động
const uploadImage = _multerImageInstance;

// Wrapper parse TẤT CẢ field (text + file) cho multipart form gửi ảnh kèm data
// Chỉ giữ lại các file có fieldname = 'images' trong req.files cho controller dùng
const uploadImageArray = (req, res, next) => {
    _multerImageInstance.any()(req, res, (err) => {
        if (err) return next(err);
        req.files = (req.files || []).filter(f => f.fieldname === 'images');
        next();
    });
};

module.exports = { uploadVideo, uploadImage, uploadImageArray, uploadErrorHandler };
