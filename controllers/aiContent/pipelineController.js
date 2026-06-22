// controllers/aiContent/pipelineController.js
const AutoContentPipeline = require('../../models/AutoContentPipeline');
const Product = require('../../models/Product');
const WritingStyle = require('../../models/WritingStyle');
const Settings = require('../../models/Settings');
const autoContentRunner = require('../../services/autoContentRunner');
const { getUserId, errorResponse, normalizeDirection } = require('./helpers');

/** POST /ai-content/api/pipelines */
exports.createPipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { productId, writingStyleId, postsPerDay, platforms, accountIds, groupIds, timeSlots, contentDirection } = req.body;
        if (!productId) return res.status(400).json({ error: 'Cần chọn sản phẩm' });
        if (!platforms?.length) return res.status(400).json({ error: 'Cần chọn ít nhất 1 nền tảng' });
        const product = await Product.findOne({ _id: productId, userId, isActive: true });
        if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

        // Fix Bug 3: validate writingStyleId thuộc user (nếu có)
        let validatedStyleId = product.writingStyleId || null;
        if (writingStyleId) {
            const style = await WritingStyle.findOne({ _id: writingStyleId, userId }).lean();
            if (!style) return res.status(404).json({ error: 'Văn phong không tồn tại hoặc không thuộc tài khoản của bạn' });
            validatedStyleId = writingStyleId;
        }

        // Fix Bug 4: KHÔNG cắt timeSlots — lưu hết. BE sẽ dùng Math.min(timeSlots.length, postsPerDay) khi chạy
        // Nhưng nếu timeSlots quá ít (< postsPerDay) thì fallback tạo thêm slot mặc định
        let slots = Array.isArray(timeSlots) && timeSlots.length > 0
            ? timeSlots.filter((s) => Number.isInteger(s.hour) && s.hour >= 0 && s.hour <= 23)
            : [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }];

        const ppd = Math.max(1, Math.min(10, parseInt(postsPerDay) || 2));
        // Pad slots nếu thiếu so với postsPerDay
        while (slots.length < ppd) {
            const baseHour = 9 + slots.length * 4; // 9h, 13h, 17h, 21h...
            slots.push({ hour: Math.min(23, baseHour), minute: 0 });
        }

        // Fix Bug 10: validate API key tồn tại (pipeline cần AI để chạy)
        const settings = await Settings.findOne({ userId }).lean();
        if (!settings?.openaiApiKey?.trim()) {
            return res.status(400).json({ error: 'Chưa cấu hình OpenAI API Key. Vào /settings để thêm.', code: 'MISSING_API_KEY' });
        }

        const pipeline = await AutoContentPipeline.create({
            userId,
            productId,
            writingStyleId: validatedStyleId,
            postsPerDay: ppd,
            platforms: platforms || ['FB'],
            accountIds: accountIds || [],
            groupIds: groupIds || [],
            timeSlots: slots,
            contentDirection: normalizeDirection(contentDirection || product.direction || 'mixed'),
            status: 'active',
        });
        res.json({ success: true, pipeline });
    } catch (err) { errorResponse(res, err, 'createPipeline'); }
};

/** POST /ai-content/api/pipelines/:id/run */
exports.runPipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOne({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        const count = await autoContentRunner.runPipelineNow(pipeline._id);
        res.json({ success: true, message: count > 0 ? `Đã tạo ${count} bài viết!` : 'Không tạo được bài nào.', count });
    } catch (err) { errorResponse(res, err, 'runPipeline'); }
};

/** POST /ai-content/api/pipelines/:id/toggle */
exports.togglePipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOne({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        pipeline.status = pipeline.status === 'active' ? 'paused' : 'active';
        pipeline.updatedAt = new Date();
        await pipeline.save();
        res.json({ success: true, status: pipeline.status, message: pipeline.status === 'active' ? 'Đã bật' : 'Đã tạm dừng' });
    } catch (err) { errorResponse(res, err, 'togglePipeline'); }
};

/** PUT /api/pipelines/:id — cập nhật pipeline */
exports.updatePipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOne({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        const { writingStyleId, postsPerDay, platforms, accountIds, groupIds, timeSlots, contentDirection, status } = req.body;

        // Fix Bug 3: validate writingStyleId thuộc user
        if (writingStyleId !== undefined) {
            if (writingStyleId === null || writingStyleId === '') {
                pipeline.writingStyleId = null;
            } else {
                const style = await WritingStyle.findOne({ _id: writingStyleId, userId }).lean();
                if (!style) return res.status(404).json({ error: 'Văn phong không tồn tại hoặc không thuộc tài khoản của bạn' });
                pipeline.writingStyleId = writingStyleId;
            }
        }
        if (postsPerDay !== undefined) {
            pipeline.postsPerDay = Math.max(1, Math.min(10, parseInt(postsPerDay) || 2));
        }
        if (platforms !== undefined) pipeline.platforms = platforms;
        if (accountIds !== undefined) pipeline.accountIds = accountIds;
        if (groupIds !== undefined) pipeline.groupIds = groupIds;
        if (timeSlots !== undefined) {
            // Fix Bug 4: KHÔNG cắt timeSlots, lưu hết
            const filtered = Array.isArray(timeSlots) ? timeSlots.filter((s) => Number.isInteger(s?.hour) && s.hour >= 0 && s.hour <= 23) : [];
            pipeline.timeSlots = filtered.length > 0 ? filtered : pipeline.timeSlots;
        }
        if (contentDirection !== undefined) pipeline.contentDirection = normalizeDirection(contentDirection);
        if (status !== undefined) pipeline.status = status;
        pipeline.updatedAt = new Date();
        await pipeline.save();
        res.json({ success: true, pipeline });
    } catch (err) { errorResponse(res, err, 'updatePipeline'); }
};

/** POST /ai-content/api/pipelines/:id/run */
exports.runPipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOne({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        const count = await autoContentRunner.runPipelineNow(pipeline._id);
        res.json({ success: true, message: count > 0 ? `Đã tạo ${count} bài viết!` : 'Không tạo được bài nào.', count });
    } catch (err) { errorResponse(res, err, 'runPipeline'); }
};

/** POST /ai-content/api/pipelines/:id/toggle */
exports.togglePipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOne({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        pipeline.status = pipeline.status === 'active' ? 'paused' : 'active';
        pipeline.updatedAt = new Date();
        await pipeline.save();
        res.json({ success: true, status: pipeline.status, message: pipeline.status === 'active' ? 'Đã bật' : 'Đã tạm dừng' });
    } catch (err) { errorResponse(res, err, 'togglePipeline'); }
};

/** DELETE /ai-content/api/pipelines/:id */
exports.deletePipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOneAndDelete({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        res.json({ success: true });
    } catch (err) { errorResponse(res, err, 'deletePipeline'); }
};
