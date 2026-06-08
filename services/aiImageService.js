// services/aiImageService.js
// Service cho Tạo Video - chỉ xử lý file local, không gọi API AI nào
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'video-projects');

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

/**
 * Xóa file local
 */
function deleteLocalImage(filePath) {
    try {
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
    } catch (err) {
        console.error('[Video Project] Lỗi xóa file:', err.message);
    }
    return false;
}

module.exports = {
    deleteLocalImage,
    OUTPUT_DIR
};