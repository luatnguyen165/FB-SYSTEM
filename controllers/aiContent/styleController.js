// controllers/aiContent/styleController.js
const WritingStyle = require('../../models/WritingStyle');
const aiContentService = require('../../services/aiContentService');
const writingStyleResearch = require('../../services/writingStyleResearch');
const { getUserId, errorResponse, getUserApiConfig } = require('./helpers');

/** POST /ai-content/api/styles */
exports.createStyle = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { name, sampleArticles, topics } = req.body;
        if (!name || !sampleArticles?.length) return res.status(400).json({ error: 'Cần tên văn phong và ít nhất 1 bài viết mẫu' });
        const validArticles = sampleArticles.filter(a => a.content?.trim());
        if (!validArticles.length) return res.status(400).json({ error: 'Cần ít nhất 1 bài viết mẫu có nội dung' });
        const style = await WritingStyle.create({ userId, name, sampleArticles: validArticles, topics: topics || [] });
        res.json({ success: true, style });
    } catch (err) { errorResponse(res, err, 'createStyle'); }
};

/** POST /ai-content/api/styles/:id/analyze */
exports.analyzeStyle = async (req, res) => {
    try {
        const userId = getUserId(req);
        const aiConfig = await getUserApiConfig(userId);
        const style = await WritingStyle.findOne({ _id: req.params.id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });
        if (!style.sampleArticles?.length) return res.status(400).json({ error: 'Cần ít nhất 1 bài viết mẫu' });
        if (!aiConfig.apiKey?.trim()) return res.status(400).json({ error: 'Chưa cấu hình API Key.', code: 'MISSING_API_KEY' });
        if (aiConfig.provider === 'openai' && !aiConfig.apiKey.startsWith('sk-')) return res.status(400).json({ error: 'API Key không hợp lệ.', code: 'INVALID_API_KEY_FORMAT' });
        const analysis = await aiContentService.analyzeWritingStyle(userId, style.sampleArticles, aiConfig.apiKey, aiConfig);
        style.styleAnalysis = analysis;
        style.updatedAt = new Date();
        await style.save();
        res.json({ success: true, analysis });
    } catch (err) {
        if (err.response?.status === 401) return res.status(400).json({ error: 'API Key không hợp lệ.', code: 'UNAUTHORIZED_API_KEY' });
        if (err.response?.status === 429) return res.status(429).json({ error: 'Đã vượt quá giới hạn API.', code: 'RATE_LIMITED' });
        if (err.code === 'ECONNABORTED') return res.status(504).json({ error: 'Kết nối AI quá thời gian.', code: 'TIMEOUT' });
        errorResponse(res, err, 'analyzeStyle');
    }
};

/** PUT /ai-content/api/styles/:id */
exports.updateStyle = async (req, res) => {
    try {
        const userId = getUserId(req);
        const style = await WritingStyle.findOne({ _id: req.params.id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });
        const { name, sampleArticles, topics, styleAnalysis } = req.body;
        if (name !== undefined) style.name = name;
        if (sampleArticles !== undefined) style.sampleArticles = sampleArticles;
        if (topics !== undefined) style.topics = topics;
        if (styleAnalysis !== undefined) style.styleAnalysis = styleAnalysis;
        style.updatedAt = new Date();
        await style.save();
        res.json({ success: true, style });
    } catch (err) { errorResponse(res, err, 'updateStyle'); }
};

/** DELETE /ai-content/api/styles/:id */
exports.deleteStyle = async (req, res) => {
    try {
        const userId = getUserId(req);
        const style = await WritingStyle.findOneAndDelete({ _id: req.params.id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });
        res.json({ success: true });
    } catch (err) { errorResponse(res, err, 'deleteStyle'); }
};

/** POST /ai-content/api/styles/:id/retrain */
exports.retrainStyle = async (req, res) => {
    try {
        const userId = getUserId(req);
        const aiConfig = await getUserApiConfig(userId);
        const style = await WritingStyle.findOne({ _id: req.params.id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });
        if (!aiConfig.apiKey?.trim()) return res.status(400).json({ error: 'Chưa cấu hình API Key.', code: 'MISSING_API_KEY' });
        const result = await aiContentService.retrainFromBestPosts(userId, req.params.id, aiConfig.apiKey, aiConfig);
        res.json({ success: true, message: `Đã train lại! Version ${result.version}.`, ...result });
    } catch (err) { errorResponse(res, err, 'retrainStyle'); }
};

/** GET /ai-content/api/styles/:id/training-stats */
exports.getTrainingStats = async (req, res) => {
    try {
        const userId = getUserId(req);
        const stats = await aiContentService.getTrainingStats(userId, req.params.id);
        if (!stats) return res.status(404).json({ error: 'Không tìm thấy văn phong' });
        res.json({ success: true, ...stats });
    } catch (err) { errorResponse(res, err, 'getTrainingStats'); }
};

/** POST /ai-content/api/generate-topics */
exports.generateTopics = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { writingStyleId } = req.body;
        const aiConfig = await getUserApiConfig(userId);
        if (!aiConfig.apiKey?.trim()) return res.status(400).json({ error: 'Chưa cấu hình API Key.', code: 'MISSING_API_KEY' });
        if (aiConfig.provider === 'openai' && !aiConfig.apiKey.startsWith('sk-')) return res.status(400).json({ error: 'API Key không hợp lệ.', code: 'INVALID_API_KEY_FORMAT' });
        const topics = await aiContentService.generateTopics(userId, writingStyleId, aiConfig.apiKey, aiConfig);
        res.json({ success: true, topics });
    } catch (err) {
        if (err.response?.status === 401) return res.status(400).json({ error: 'API Key không hợp lệ.', code: 'UNAUTHORIZED_API_KEY' });
        errorResponse(res, err, 'generateTopics');
    }
};

/** POST /ai-content/api/research */
exports.researchStyle = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { type, url, accountName, styleName, maxPosts } = req.body;
        const aiConfig = await getUserApiConfig(userId);
        if (!type || !url) return res.status(400).json({ error: 'Cần chọn loại nguồn và nhập URL' });
        if (!aiConfig.apiKey?.trim()) return res.status(400).json({ error: 'Chưa cấu hình API Key.', code: 'MISSING_API_KEY' });
        let crawlAccount = accountName;
        if (!crawlAccount) {
            const Channel = require('../../models/Channel');
            const fbAccount = await Channel.findOne({ userId, platform: 'FB', isEnabled: true }).sort({ createdAt: -1 }).lean();
            crawlAccount = fbAccount?.accountName || '';
        }
        if (!crawlAccount) return res.status(400).json({ error: 'Chưa có tài khoản Facebook.', code: 'NO_FB_ACCOUNT' });
        const result = await writingStyleResearch.researchAndCreateStyle({ userId, type, url, accountName: crawlAccount, styleName: styleName || '', maxPosts: parseInt(maxPosts) || 20, apiKey: aiConfig.apiKey, aiConfig });
        res.json({ success: true, style: result.style, postsCount: result.postsCount, analysis: result.analysis, message: `Đã học văn phong từ ${result.postsCount} bài viết.` });
    } catch (err) { errorResponse(res, err, 'researchStyle'); }
};
