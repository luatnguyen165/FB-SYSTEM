// controllers/aiContent/index.js
// Main entry point — gộp tất cả controller modules
const { getUserId, errorResponse, getUserApiConfig, normalizeDirection } = require('./helpers');
const styleCtrl = require('./styleController');
const scheduleCtrl = require('./scheduleController');
const postCtrl = require('./postController');
const productCtrl = require('./productController');
const pipelineCtrl = require('./pipelineController');

const WritingStyle = require('../../models/WritingStyle');
const AiContentSchedule = require('../../models/AiContentSchedule');
const AiGeneratedPost = require('../../models/AiGeneratedPost');
const AutoContentPipeline = require('../../models/AutoContentPipeline');

// ============== READ ENDPOINTS cho wizard (Bundle B) ==============

/** GET /ai-content/api/styles — danh sách style cho wizard Step 2 */
const listStyles = async (req, res) => {
    try {
        const userId = getUserId(req);
        const styles = await WritingStyle.find({ userId })
            .select('name topics styleAnalysis trainingVersion createdAt')
            .sort({ createdAt: -1 })
            .lean();
        // Thêm hasAnalysis để wizard biết style nào đã sẵn sàng dùng
        const enriched = styles.map(s => ({
            _id: s._id,
            name: s.name,
            topics: s.topics || [],
            hasAnalysis: !!(s.styleAnalysis?.summary || s.styleAnalysis?.tone),
            trainingVersion: s.trainingVersion || 0,
            createdAt: s.createdAt,
        }));
        res.json({ success: true, styles: enriched });
    } catch (err) { errorResponse(res, err, 'listStyles'); }
};

/** GET /ai-content/api/styles/:id — chi tiết style cho edit-mode */
const getStyle = async (req, res) => {
    try {
        const userId = getUserId(req);
        const style = await WritingStyle.findOne({ _id: req.params.id, userId }).lean();
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });
        res.json({ success: true, style });
    } catch (err) { errorResponse(res, err, 'getStyle'); }
};

/** GET /ai-content/api/schedules — danh sách schedule cho wizard */
const listSchedules = async (req, res) => {
    try {
        const userId = getUserId(req);
        const schedules = await AiContentSchedule.find({ userId })
            .populate('writingStyleId', 'name')
            .populate('productId', 'name')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ success: true, schedules });
    } catch (err) { errorResponse(res, err, 'listSchedules'); }
};

/** GET /ai-content/api/schedules/:id — chi tiết schedule cho edit-mode */
const getSchedule = async (req, res) => {
    try {
        const userId = getUserId(req);
        const schedule = await AiContentSchedule.findOne({ _id: req.params.id, userId })
            .populate('writingStyleId', 'name')
            .populate('productId', 'name')
            .lean();
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });
        // Trả về 5 posts gần nhất để wizard review thấy luôn
        const recentPosts = await AiGeneratedPost.find({ scheduleId: req.params.id, userId })
            .sort({ scheduledAt: -1 })
            .limit(5)
            .lean();
        res.json({ success: true, schedule, recentPosts });
    } catch (err) { errorResponse(res, err, 'getSchedule'); }
};

/** POST /ai-content/api/schedules/preview-slots — tính slot trước khi save */
const previewSlots = async (req, res) => {
    try {
        const aiContentService = require('../../services/aiContentService');
        const userId = getUserId(req);
        const { dateRange, timeSlots, contentConfig } = req.body;
        if (!dateRange?.startDate || !dateRange?.endDate) {
            return res.status(400).json({ error: 'Cần dateRange.startDate và dateRange.endDate' });
        }
        if (!timeSlots?.length) {
            return res.status(400).json({ error: 'Cần ít nhất 1 timeSlot' });
        }
        // Fake schedule object để dùng calculateScheduleSlots
        const fakeSchedule = {
            dateRange: { startDate: new Date(dateRange.startDate), endDate: new Date(dateRange.endDate) },
            timeSlots,
            contentConfig: { topics: contentConfig?.topics || ['Chung'] },
            postsGenerated: 0,
        };
        const slots = aiContentService.calculateScheduleSlots(fakeSchedule, 0);
        // Cap sample ở 20 để tránh payload lớn
        const sampleSlots = slots.slice(0, 20);
        res.json({ success: true, count: slots.length, sampleSlots });
    } catch (err) { errorResponse(res, err, 'previewSlots'); }
};

/** POST /ai-content/api/schedules/:id/draft — chuyển schedule sang status draft */
const markDraft = async (req, res) => {
    try {
        const userId = getUserId(req);
        const schedule = await AiContentSchedule.findOne({ _id: req.params.id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });
        schedule.status = 'draft';
        schedule.updatedAt = new Date();
        await schedule.save();
        res.json({ success: true, schedule, message: 'Đã chuyển sang nháp.' });
    } catch (err) { errorResponse(res, err, 'markDraft'); }
};

/** GET /ai-content/api/pipelines — danh sách pipeline cho wizard */
const listPipelines = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipelines = await AutoContentPipeline.find({ userId })
            .populate('productId', 'name category price')
            .populate('writingStyleId', 'name')
            .sort({ createdAt: -1 })
            .lean();
        res.json({ success: true, pipelines });
    } catch (err) { errorResponse(res, err, 'listPipelines'); }
};

/** GET /ai-content/api/pipelines/:id — chi tiết pipeline cho edit-mode */
const getPipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOne({ _id: req.params.id, userId })
            .populate('productId', 'name category price direction')
            .populate('writingStyleId', 'name')
            .lean();
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        const recentPosts = await AiGeneratedPost.find({ pipelineId: req.params.id, userId })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();
        res.json({ success: true, pipeline, recentPosts });
    } catch (err) { errorResponse(res, err, 'getPipeline'); }
};

/** PUT /api/pipelines/:id — cập nhật pipeline */
const updatePipeline = async (req, res) => {
    try {
        const userId = getUserId(req);
        const pipeline = await AutoContentPipeline.findOne({ _id: req.params.id, userId });
        if (!pipeline) return res.status(404).json({ error: 'Không tìm thấy pipeline' });
        const { writingStyleId, postsPerDay, platforms, accountIds, groupIds, timeSlots, contentDirection, status } = req.body;
        if (writingStyleId !== undefined) pipeline.writingStyleId = writingStyleId || null;
        if (postsPerDay !== undefined) pipeline.postsPerDay = postsPerDay;
        if (platforms !== undefined) pipeline.platforms = platforms;
        if (accountIds !== undefined) pipeline.accountIds = accountIds;
        if (groupIds !== undefined) pipeline.groupIds = groupIds;
        if (timeSlots !== undefined) pipeline.timeSlots = timeSlots;
        if (contentDirection !== undefined) pipeline.contentDirection = normalizeDirection(contentDirection);
        if (status !== undefined) pipeline.status = status;
        pipeline.updatedAt = new Date();
        await pipeline.save();
        res.json({ success: true, pipeline });
    } catch (err) { errorResponse(res, err, 'updatePipeline'); }
};

// Re-export tất cả
module.exports = {
    // Helpers
    getUserId, errorResponse, getUserApiConfig, normalizeDirection,

    // Style
    ...styleCtrl,

    // Schedule
    ...scheduleCtrl,

    // Post
    ...postCtrl,

    // Product
    ...productCtrl,

    // Pipeline
    ...pipelineCtrl,

    // Wizard read endpoints (Bundle B)
    listStyles, getStyle, listSchedules, getSchedule, previewSlots, markDraft,
    listPipelines, getPipeline, updatePipeline,

    // Settings
    saveApiKey: async (req, res) => {
        try {
            const userId = getUserId(req);
            const { apiKey } = req.body;
            if (!apiKey?.trim()) return res.status(400).json({ error: 'API key không được để trống' });
            const Settings = require('../../models/Settings');
            await Settings.findOneAndUpdate({ userId }, { openaiApiKey: apiKey.trim(), updatedAt: new Date() }, { upsert: true });
            res.json({ success: true, message: 'Đã lưu OpenAI API key' });
        } catch (err) { errorResponse(res, err, 'saveApiKey'); }
    },

    checkApiKey: async (req, res) => {
        try {
            const userId = getUserId(req);
            const Settings = require('../../models/Settings');
            const settings = await Settings.findOne({ userId }).lean();
            res.json({ hasKey: !!settings?.openaiApiKey });
        } catch (err) { res.json({ hasKey: false }); }
    },

    // Stats
    getStats: async (req, res) => {
        try {
            const userId = getUserId(req);
            const WritingStyle = require('../../models/WritingStyle');
            const AiContentSchedule = require('../../models/AiContentSchedule');
            const AiGeneratedPost = require('../../models/AiGeneratedPost');
            const AutoContentPipeline = require('../../models/AutoContentPipeline');
            const [totalStyles, totalSchedules, totalPosts, postedCount, failedCount, pendingCount, totalPipelines, activePipelines] = await Promise.all([
                WritingStyle.countDocuments({ userId }),
                AiContentSchedule.countDocuments({ userId }),
                AiGeneratedPost.countDocuments({ userId }),
                AiGeneratedPost.countDocuments({ userId, status: 'posted' }),
                AiGeneratedPost.countDocuments({ userId, status: 'failed' }),
                AiGeneratedPost.countDocuments({ userId, status: 'pending' }),
                AutoContentPipeline.countDocuments({ userId }),
                AutoContentPipeline.countDocuments({ userId, status: 'active' }),
            ]);
            res.json({ totalStyles, totalSchedules, totalPosts, postedCount, failedCount, pendingCount, totalPipelines, activePipelines });
        } catch (err) { errorResponse(res, err, 'getStats'); }
    },

    // Page
    renderPage: async (req, res) => {
        try {
            const userId = getUserId(req);
            const WritingStyle = require('../../models/WritingStyle');
            const AiContentSchedule = require('../../models/AiContentSchedule');
            const AiGeneratedPost = require('../../models/AiGeneratedPost');
            const Channel = require('../../models/Channel');
            const Settings = require('../../models/Settings');
            const FacebookGroupCache = require('../../models/FacebookGroupCache');
            const Product = require('../../models/Product');
            const AutoContentPipeline = require('../../models/AutoContentPipeline');

            const [styles, schedules, posts, channels, settings, groupCaches, products, pipelines] = await Promise.all([
                WritingStyle.find({ userId }).sort({ createdAt: -1 }).lean(),
                AiContentSchedule.find({ userId }).populate('writingStyleId', 'name').sort({ createdAt: -1 }).lean(),
                AiGeneratedPost.find({ userId }).sort({ createdAt: -1 }).limit(50).lean(),
                Channel.find({ userId, isEnabled: true }).sort({ platform: 1 }).lean(),
                Settings.findOne({ userId }).lean(),
                FacebookGroupCache.find({ userId }).lean(),
                Product.find({ userId }).sort({ createdAt: -1 }).lean(),
                AutoContentPipeline.find({ userId }).populate('productId', 'name category price').populate('writingStyleId', 'name').sort({ createdAt: -1 }).lean(),
            ]);

            res.render('ai-content', { user: req.session.user || req.user, styles, schedules, posts, channels, products, pipelines, openaiApiKey: settings?.openaiApiKey || '', groupCaches, currentPage: 'ai-content' });
        } catch (err) {
            console.error('[AI Content] renderPage error:', err.message);
            req.session.flash = { error: 'Lỗi tải trang.' };
            res.redirect('/dashboard');
        }
    },
};
