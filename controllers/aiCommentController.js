// controllers/aiCommentController.js
const AiComment = require('../models/AiComment');
const path = require('path');

// ============================================================
// PAGE RENDERING
// ============================================================

const showAiComments = async (req, res) => {
    try {
        const comments = await AiComment.find({ userId: req.user._id })
            .sort({ order: 1, createdAt: -1 })
            .lean();

        const stats = {
            total: comments.length,
            active: comments.filter(c => c.isActive).length,
            inactive: comments.filter(c => !c.isActive).length,
            text: comments.filter(c => c.type === 'text').length,
            image: comments.filter(c => c.type === 'image').length,
            video: comments.filter(c => c.type === 'video').length
        };

        res.render('ai-comments', {
            user: req.user,
            comments,
            stats,
            currentPage: 'ai-comments'
        });
    } catch (error) {
        console.error('Show AI Comments Error:', error);
        res.render('ai-comments', {
            user: req.user,
            comments: [],
            stats: { total: 0, active: 0, inactive: 0, text: 0, image: 0, video: 0 },
            currentPage: 'ai-comments'
        });
    }
};

// ============================================================
// CRUD API
// ============================================================

const createComment = async (req, res) => {
    try {
        const { name, type, content, caption, tags } = req.body;

        if (!type || !content) {
            return res.status(400).json({ success: false, message: 'Thiếu type hoặc content' });
        }

        // Đếm số lượng để set order
        const count = await AiComment.countDocuments({ userId: req.user._id });

        // Parse & normalize tags
        let normalizedTags = [];
        if (Array.isArray(tags)) {
            normalizedTags = tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
        } else if (typeof tags === 'string' && tags.trim()) {
            try {
                const parsed = JSON.parse(tags);
                if (Array.isArray(parsed)) normalizedTags = parsed.map(t => String(t).trim().toLowerCase()).filter(Boolean);
            } catch (e) {
                normalizedTags = tags.split(',').map(t => String(t).trim().toLowerCase()).filter(Boolean);
            }
        }

        const comment = await AiComment.create({
            userId: req.user._id,
            name: String(name || '').trim(),
            type,
            content: String(content).trim(),
            caption: String(caption || '').trim(),
            isActive: true,
            tags: normalizedTags,
            order: count + 1
        });

        return res.json({ success: true, message: 'Đã tạo comment', comment });
    } catch (error) {
        console.error('Create AI Comment Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const updateComment = async (req, res) => {
    try {
        const { commentId } = req.body;
        if (!commentId) {
            return res.status(400).json({ success: false, message: 'Thiếu commentId' });
        }

        const comment = await AiComment.findOne({ _id: commentId, userId: req.user._id });
        if (!comment) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy comment' });
        }

        const { name, type, content, caption, isActive, order, tags } = req.body;

        if (name !== undefined) comment.name = String(name).trim();
        if (type !== undefined) comment.type = type;
        if (content !== undefined) comment.content = String(content).trim();
        if (caption !== undefined) comment.caption = String(caption || '').trim();
        if (isActive !== undefined) comment.isActive = isActive === true || isActive === 'true';
        if (order !== undefined) comment.order = parseInt(order, 10) || 0;

        if (tags !== undefined) {
            let normalizedTags = [];
            if (Array.isArray(tags)) {
                normalizedTags = tags.map(t => String(t).trim().toLowerCase()).filter(Boolean);
            } else if (typeof tags === 'string' && tags.trim()) {
                try {
                    const parsed = JSON.parse(tags);
                    if (Array.isArray(parsed)) normalizedTags = parsed.map(t => String(t).trim().toLowerCase()).filter(Boolean);
                } catch (e) {
                    normalizedTags = tags.split(',').map(t => String(t).trim().toLowerCase()).filter(Boolean);
                }
            }
            comment.tags = normalizedTags;
        }

        comment.updatedAt = new Date();
        await comment.save();

        return res.json({ success: true, message: 'Đã cập nhật comment', comment });
    } catch (error) {
        console.error('Update AI Comment Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const deleteComment = async (req, res) => {
    try {
        const { commentId } = req.params;
        const result = await AiComment.deleteOne({ _id: commentId, userId: req.user._id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy comment' });
        }
        return res.json({ success: true, message: 'Đã xóa comment' });
    } catch (error) {
        console.error('Delete AI Comment Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const toggleComment = async (req, res) => {
    try {
        const { commentId } = req.params;
        const comment = await AiComment.findOne({ _id: commentId, userId: req.user._id });
        if (!comment) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy comment' });
        }

        comment.isActive = !comment.isActive;
        comment.updatedAt = new Date();
        await comment.save();

        return res.json({
            success: true,
            message: comment.isActive ? 'Đã bật comment' : 'Đã tắt comment (bỏ qua)',
            isActive: comment.isActive
        });
    } catch (error) {
        console.error('Toggle AI Comment Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// API: Get active comments for scan service
// ============================================================

const getActiveComments = async (req, res) => {
    try {
        const comments = await AiComment.find({
            userId: req.user._id,
            isActive: true
        }).sort({ order: 1 }).lean();

        return res.json({ success: true, comments, count: comments.length });
    } catch (error) {
        console.error('Get Active Comments Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Get all comments for picker (used in AI Scan config)
const getAllCommentsForPicker = async (req, res) => {
    try {
        const comments = await AiComment.find({ userId: req.user._id })
            .sort({ order: 1, createdAt: -1 })
            .lean();

        return res.json({ success: true, comments, count: comments.length });
    } catch (error) {
        console.error('Get All Comments For Picker Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Upload file cho comment
const uploadCommentFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file để upload' });
        }

        const filePath = req.file.path;
        const dataDir = global.USER_DATA_DIR || path.join(__dirname, '..');
        const relativePath = path.relative(dataDir, filePath).replace(/\\/g, '/');
        const publicPath = '/' + relativePath;
        const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
        const fileName = req.file.originalname;

        return res.json({
            success: true,
            message: 'Upload file thành công',
            data: {
                filePath: publicPath,
                fullPath: filePath,
                type: fileType,
                fileName
            }
        });
    } catch (error) {
        console.error('Upload Comment File Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi upload: ' + error.message });
    }
};

module.exports = {
    showAiComments,
    createComment,
    updateComment,
    deleteComment,
    toggleComment,
    getActiveComments,
    getAllCommentsForPicker,
    uploadCommentFile
};
