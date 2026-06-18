// controllers/aiContent/postController.js
const AiGeneratedPost = require('../../models/AiGeneratedPost');
const SchedulePost = require('../../models/SchedulePost');
const { getUserId, errorResponse, deleteImageFiles } = require('./helpers');

/** GET /ai-content/api/posts */
exports.getPosts = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { scheduleId, status, page = 1, limit = 20 } = req.query;
        const query = { userId };
        if (scheduleId) query.scheduleId = scheduleId;
        if (status) query.status = status;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [posts, total] = await Promise.all([
            AiGeneratedPost.find(query).populate('scheduleId', 'name').sort({ scheduledAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
            AiGeneratedPost.countDocuments(query),
        ]);
        res.json({ posts, total, page: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)) });
    } catch (err) { errorResponse(res, err, 'getPosts'); }
};

/** PUT /ai-content/api/posts/:id */
exports.updatePost = async (req, res) => {
    try {
        const userId = getUserId(req);
        const post = await AiGeneratedPost.findOne({ _id: req.params.id, userId });
        if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });
        const { title, content } = req.body;
        if (title !== undefined) post.title = title;
        if (content !== undefined) { post.content = content; if (post.schedulePostId) await SchedulePost.findByIdAndUpdate(post.schedulePostId, { caption: content }); }
        post.updatedAt = new Date();
        await post.save();
        res.json({ success: true, post });
    } catch (err) { errorResponse(res, err, 'updatePost'); }
};

/** DELETE /ai-content/api/posts/:id */
exports.deletePost = async (req, res) => {
    try {
        const userId = getUserId(req);
        const post = await AiGeneratedPost.findOne({ _id: req.params.id, userId });
        if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });
        if (post.schedulePostId) {
            const schedulePost = await SchedulePost.findById(post.schedulePostId).lean();
            if (schedulePost?.images?.length) deleteImageFiles(schedulePost.images);
            await SchedulePost.findByIdAndDelete(post.schedulePostId);
        }
        await AiGeneratedPost.findByIdAndDelete(post._id);
        res.json({ success: true });
    } catch (err) { errorResponse(res, err, 'deletePost'); }
};

/** POST /ai-content/api/posts/:id/publish */
exports.publishPost = async (req, res) => {
    try {
        const userId = getUserId(req);
        const post = await AiGeneratedPost.findOne({ _id: req.params.id, userId });
        if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });
        if (post.schedulePostId) { await SchedulePost.findByIdAndUpdate(post.schedulePostId, { scheduledAt: new Date(), status: 'pending' }); }
        post.status = 'pending';
        post.updatedAt = new Date();
        await post.save();
        res.json({ success: true, message: 'Đã lên lịch đăng bài' });
    } catch (err) { errorResponse(res, err, 'publishPost'); }
};
