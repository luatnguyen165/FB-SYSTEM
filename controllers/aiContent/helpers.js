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

/** Normalize direction: alias 'hybrid' -> 'mixed', giữ các giá trị hợp lệ khác */
function normalizeDirection(value) {
    if (value === 'hybrid') return 'mixed';
    const allowed = ['advertising', 'purchase', 'mixed', 'unset'];
    return allowed.includes(value) ? value : 'unset';
}

/** Map product input từ frontend alias -> model field names (dùng cho create + update) */
function mapProductInput(body = {}) {
    const out = {};
    if (body.name !== undefined) out.name = body.name;
    if (body.description !== undefined) out.description = body.description;
    if (body.category !== undefined) out.category = body.category;
    if (body.price !== undefined) out.price = body.price;
    if (body.audience !== undefined) out.targetAudience = body.audience;
    if (body.targetAudience !== undefined) out.targetAudience = body.targetAudience;
    if (body.sellingPoints !== undefined) {
        out.keySellingPoints = Array.isArray(body.sellingPoints) ? body.sellingPoints : [];
    } else if (body.keySellingPoints !== undefined) {
        out.keySellingPoints = Array.isArray(body.keySellingPoints) ? body.keySellingPoints : [];
    }
    if (body.competitors !== undefined) {
        out.competitorProducts = Array.isArray(body.competitors) ? body.competitors.join(', ') : (body.competitors || '');
    } else if (body.competitorProducts !== undefined) {
        out.competitorProducts = Array.isArray(body.competitorProducts) ? body.competitorProducts.join(', ') : body.competitorProducts;
    }
    if (body.writingStyleId !== undefined) out.writingStyleId = body.writingStyleId || null;
    if (body.direction !== undefined) out.direction = normalizeDirection(body.direction);
    if (body.isActive !== undefined) out.isActive = body.isActive;
    return out;
}

module.exports = {
    getUserId, errorResponse, deleteImageFiles, isValidObjectId,
    getUserApiConfig, isValidApiKey,
    normalizeDirection, mapProductInput,
};
