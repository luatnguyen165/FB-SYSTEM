// controllers/aiContent/pipelineController.js
const AutoContentPipeline = require('../../models/AutoContentPipeline');
const Product = require('../../models/Product');
const autoContentRunner = require('../../services/autoContentRunner');
const { getUserId, errorResponse } = require('./helpers');

/** POST /ai-content/api/pipelines */
exports.createPipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { productId, writingStyleId, postsPerDay, platforms, accountIds, groupIds, timeSlots, contentDirection } = req.body;
        if (!productId) return res.status(400).json({ error: 'Cần chọn sản phẩm' });
        if (!platforms?.length) return res.status(400).json({ error: 'Cần chọn ít nhất 1 nền tảng' });
        const product = await Product.findOne({ _id: productId, userId, isActive: true });
        if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        const slots = timeSlots?.length > 0 ? timeSlots.slice(0, postsPerDay || 2) : [{ hour: 9, minute: 0 }, { hour: 18, minute: 0 }];
        const pipeline = await AutoContentPipeline.create({ userId, productId, writingStyleId: writingStyleId || product.writingStyleId || null, postsPerDay: postsPerDay || 2, platforms: platforms || ['FB'], accountIds: accountIds || [], groupIds: groupIds || [], timeSlots: slots, contentDirection: contentDirection || product.direction || 'mixed', status: 'active' });
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

/** DELETE /ai-content/api/pipelines/:id */
exports.deletePipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOneAndDelete({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        res.json({ success: true });
    } catch (err) { errorResponse(res, err, 'deletePipeline'); }
};
