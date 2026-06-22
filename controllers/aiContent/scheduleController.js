// controllers/aiContent/scheduleController.js
const AiContentSchedule = require('../../models/AiContentSchedule');
const AiGeneratedPost = require('../../models/AiGeneratedPost');
const SchedulePost = require('../../models/SchedulePost');
const WritingStyle = require('../../models/WritingStyle');
const aiContentService = require('../../services/aiContentService');
const { getUserId, errorResponse, deleteImageFiles, getUserApiConfig, normalizeDirection } = require('./helpers');

/** POST /ai-content/api/schedules */
exports.createSchedule = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { name, writingStyleId, productId, direction, dateRange, timeSlots, contentConfig, runImmediately, status } = req.body;
        const aiConfig = await getUserApiConfig(userId);
        if (!name || !writingStyleId || !dateRange?.startDate || !dateRange?.endDate) return res.status(400).json({ error: 'Cần điền đầy đủ thông tin bắt buộc' });
        if (!timeSlots?.length) return res.status(400).json({ error: 'Cần ít nhất 1 khung giờ đăng bài' });
        const style = await WritingStyle.findOne({ _id: writingStyleId, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });
        // Draft mode: status === 'draft' hoặc runImmediately === false → KHÔNG generate ngay
        const isDraft = status === 'draft' || runImmediately === false;
        const scheduleData = {
            userId, name, writingStyleId,
            productId: productId || null,
            direction: normalizeDirection(direction),
            dateRange: { startDate: new Date(dateRange.startDate), endDate: new Date(dateRange.endDate) },
            timeSlots,
            contentConfig: {
                topics: contentConfig?.topics || [],
                minWords: contentConfig?.minWords || 200,
                maxWords: contentConfig?.maxWords || 500,
                customInstructions: contentConfig?.customInstructions || '',
                language: contentConfig?.language || 'vi',
            },
            status: isDraft ? 'draft' : 'active',
        };
        const schedule = await AiContentSchedule.create(scheduleData);
        let generatedCount = 0;
        let warning;
        if (isDraft) {
            warning = 'Đã lưu nháp. Bấm "Tạo bài ngay" để generate.';
        } else if (aiConfig.apiKey?.trim()) {
            try { generatedCount = await aiContentService.generatePostsForSchedule(schedule._id, aiConfig.apiKey, aiConfig); }
            catch (e) { console.error('[AI Content] Auto-generate error:', e.message); warning = 'Lỗi khi generate: ' + e.message; }
        } else {
            warning = 'Chưa cấu hình API Key.';
        }
        res.json({ success: true, schedule, generatedCount, warning });
    } catch (err) { errorResponse(res, err, 'createSchedule'); }
};

/** PUT /ai-content/api/schedules/:id */
exports.updateSchedule = async (req, res) => {
    try {
        const userId = getUserId(req);
        const schedule = await AiContentSchedule.findOne({ _id: req.params.id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });
        const updates = req.body;
        const allowedFields = ['name', 'writingStyleId', 'productId', 'status', 'dateRange', 'timeSlots'];
        for (const field of allowedFields) { if (updates[field] !== undefined) schedule[field] = updates[field]; }
        if (updates.direction !== undefined) schedule.direction = normalizeDirection(updates.direction);
        if (updates.contentConfig !== undefined && typeof updates.contentConfig === 'object') {
            for (const f of ['topics', 'minWords', 'maxWords', 'customInstructions', 'language']) {
                if (updates.contentConfig[f] !== undefined) schedule.contentConfig[f] = updates.contentConfig[f];
            }
        }
        schedule.updatedAt = new Date();
        await schedule.save();
        res.json({ success: true, schedule });
    } catch (err) { errorResponse(res, err, 'updateSchedule'); }
};

/** DELETE /ai-content/api/schedules/:id */
exports.deleteSchedule = async (req, res) => {
    try {
        const userId = getUserId(req);
        const schedule = await AiContentSchedule.findOneAndDelete({ _id: req.params.id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });
        const oldPosts = await AiGeneratedPost.find({ scheduleId: req.params.id, userId }).lean();
        if (oldPosts.length > 0) {
            const schedulePostIds = oldPosts.filter(p => p.schedulePostId).map(p => p.schedulePostId);
            if (schedulePostIds.length > 0) {
                const schedulePosts = await SchedulePost.find({ _id: { $in: schedulePostIds } }).lean();
                for (const sp of schedulePosts) { if (sp.images?.length) deleteImageFiles(sp.images); }
                await SchedulePost.deleteMany({ _id: { $in: schedulePostIds } });
            }
            await AiGeneratedPost.deleteMany({ scheduleId: req.params.id, userId });
        }
        res.json({ success: true });
    } catch (err) { errorResponse(res, err, 'deleteSchedule'); }
};

/** POST /ai-content/api/schedules/:id/generate */
exports.generateNow = async (req, res) => {
    try {
        const userId = getUserId(req);
        const aiConfig = await getUserApiConfig(userId);
        const schedule = await AiContentSchedule.findOne({ _id: req.params.id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });
        if (!aiConfig.apiKey?.trim()) return res.status(400).json({ error: 'Chưa cấu hình API Key.', code: 'MISSING_API_KEY' });
        if (schedule.status === 'draft') { schedule.status = 'active'; await schedule.save(); }

        // keepExisting:true → không xóa posts cũ, chỉ tạo thêm. Default: xóa + tạo lại (giữ behavior cũ).
        const keepExisting = req.body?.keepExisting === true;
        let deletedCount = 0;
        if (!keepExisting) {
            const oldPosts = await AiGeneratedPost.find({ scheduleId: req.params.id, userId }).lean();
            deletedCount = oldPosts.length;
            if (oldPosts.length > 0) {
                const schedulePostIds = oldPosts.filter(p => p.schedulePostId).map(p => p.schedulePostId);
                if (schedulePostIds.length > 0) {
                    const schedulePosts = await SchedulePost.find({ _id: { $in: schedulePostIds } }).lean();
                    for (const sp of schedulePosts) { if (sp.images?.length) deleteImageFiles(sp.images); }
                    await SchedulePost.deleteMany({ _id: { $in: schedulePostIds } });
                }
                await AiGeneratedPost.deleteMany({ scheduleId: req.params.id, userId });
                await AiContentSchedule.findByIdAndUpdate(req.params.id, { postsGenerated: 0 });
            }
        }
        const count = await aiContentService.generatePostsForSchedule(req.params.id, aiConfig.apiKey, aiConfig);
        res.json({
            success: true,
            message: count > 0 ? `Đã tạo ${count} bài mới!` : 'Không có slot nào để tạo bài.',
            count,
            deletedCount,
            keepExisting,
        });
    } catch (err) { errorResponse(res, err, 'generateNow'); }
};
