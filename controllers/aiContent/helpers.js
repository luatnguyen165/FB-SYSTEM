// controllers/aiContent/helpers.js
const fs = require('fs');
const path = require('path');
const { getUserApiConfig, isValidApiKey } = require('../../utils/aiConfig');

const DATA_DIR = global.USER_DATA_DIR || path.join(__dirname, '..', '..');
const UPLOAD_IMAGE_DIR = path.join(DATA_DIR, 'uploads', 'images');

/** Lấy userId từ request */
function getUserId(req) {
    return req.session.userId || req.user?._id;
}

/** Safe error response — không lộ internal details */
function errorResponse(res, err, context = '') {
    console.error(`[AI Content] ${context}:`, err.message);
    return res.status(500).json({ error: 'Đã xảy ra lỗi. Vui lòng thử lại.' });
}

/** Xóa file ảnh trên đĩa */
function deleteImageFiles(imagePaths) {
    if (!imagePaths || !imagePaths.length) return;
    for (const img of imagePaths) {
        try {
            const filePath = path.join(UPLOAD_IMAGE_DIR, path.basename(img));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (err) {
            console.error('[AI Content] Lỗi xóa file ảnh:', err.message);
        }
    }
}

/** Validate MongoDB ObjectId */
function isValidObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id));
}

module.exports = { getUserId, errorResponse, deleteImageFiles, isValidObjectId, getUserApiConfig, isValidApiKey };
