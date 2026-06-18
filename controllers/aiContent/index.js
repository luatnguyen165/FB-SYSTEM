// controllers/aiContent/index.js
// Main entry point — gộp tất cả controller modules
const { getUserId, errorResponse, getUserApiConfig } = require('./helpers');
const styleCtrl = require('./styleController');
const scheduleCtrl = require('./scheduleController');
const postCtrl = require('./postController');
const productCtrl = require('./productController');
const pipelineCtrl = require('./pipelineController');

// Re-export tất cả
module.exports = {
    // Helpers
    getUserId, errorResponse, getUserApiConfig,

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
