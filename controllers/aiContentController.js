// controllers/aiContentController.js
const WritingStyle = require('../models/WritingStyle');
const AiContentSchedule = require('../models/AiContentSchedule');
const AiGeneratedPost = require('../models/AiGeneratedPost');
const SchedulePost = require('../models/SchedulePost');
const Channel = require('../models/Channel');
const Settings = require('../models/Settings');
const FacebookGroupCache = require('../models/FacebookGroupCache');
const aiContentService = require('../services/aiContentService');

/**
 * Helper: Lấy OpenAI API key từ Settings của user
 */
async function getUserApiKey(userId) {
    const settings = await Settings.findOne({ userId }).lean();
    return settings?.openaiApiKey || process.env.OPENAI_API_KEY || '';
}

// ==================== PAGE ====================

/**
 * GET /ai-content - Trang chính
 */
exports.renderPage = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const [styles, schedules, posts, channels, settings, groupCaches] = await Promise.all([
            WritingStyle.find({ userId }).sort({ createdAt: -1 }).lean(),
            AiContentSchedule.find({ userId })
                .populate('writingStyleId', 'name')
                .sort({ createdAt: -1 }).lean(),
            AiGeneratedPost.find({ userId })
                .sort({ createdAt: -1 }).limit(50).lean(),
            Channel.find({ userId, isEnabled: true }).sort({ platform: 1 }).lean(),
            Settings.findOne({ userId }).lean(),
            FacebookGroupCache.find({ userId }).lean(),
        ]);

        res.render('ai-content', {
            user: req.session.user || req.user,
            styles,
            schedules,
            posts,
            channels,
            openaiApiKey: settings?.openaiApiKey || '',
            groupCaches,
            currentPage: 'ai-content',
        });
    } catch (err) {
        console.error('[AI Content] renderPage error:', err.message);
        req.session.flash = { error: 'Lỗi tải trang: ' + err.message };
        res.redirect('/dashboard');
    }
};

// ==================== WRITING STYLES API ====================

/**
 * POST /ai-content/api/styles - Tạo văn phong mới
 */
exports.createStyle = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { name, sampleArticles, topics } = req.body;

        if (!name || !sampleArticles || !sampleArticles.length) {
            return res.status(400).json({ error: 'Cần tên văn phong và ít nhất 1 bài viết mẫu' });
        }

        // Validate articles have content
        const validArticles = sampleArticles.filter(a => a.content && a.content.trim());
        if (!validArticles.length) {
            return res.status(400).json({ error: 'Cần ít nhất 1 bài viết mẫu có nội dung' });
        }

        const style = await WritingStyle.create({
            userId,
            name,
            sampleArticles: validArticles,
            topics: topics || [],
        });

        res.json({ success: true, style });
    } catch (err) {
        console.error('[AI Content] createStyle error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /ai-content/api/styles/:id/analyze - Phân tích văn phong bằng AI
 */
exports.analyzeStyle = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const apiKey = await getUserApiKey(userId);

        const style = await WritingStyle.findOne({ _id: id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        if (!style.sampleArticles || !style.sampleArticles.length) {
            return res.status(400).json({ error: 'Cần ít nhất 1 bài viết mẫu' });
        }

        const analysis = await aiContentService.analyzeWritingStyle(userId, style.sampleArticles, apiKey);

        style.styleAnalysis = analysis;
        style.updatedAt = new Date();
        await style.save();

        res.json({ success: true, analysis });
    } catch (err) {
        console.error('[AI Content] analyzeStyle error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * PUT /ai-content/api/styles/:id - Cập nhật văn phong
 */
exports.updateStyle = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const { name, sampleArticles, topics, styleAnalysis } = req.body;

        const style = await WritingStyle.findOne({ _id: id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        if (name !== undefined) style.name = name;
        if (sampleArticles !== undefined) style.sampleArticles = sampleArticles;
        if (topics !== undefined) style.topics = topics;
        if (styleAnalysis !== undefined) style.styleAnalysis = styleAnalysis;
        style.updatedAt = new Date();

        await style.save();
        res.json({ success: true, style });
    } catch (err) {
        console.error('[AI Content] updateStyle error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE /ai-content/api/styles/:id - Xóa văn phong
 */
exports.deleteStyle = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;

        const style = await WritingStyle.findOneAndDelete({ _id: id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        res.json({ success: true });
    } catch (err) {
        console.error('[AI Content] deleteStyle error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== SCHEDULES API ====================

/**
 * POST /ai-content/api/schedules - Tạo lịch mới
 */
exports.createSchedule = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { name, writingStyleId, dateRange, timeSlots, contentConfig } = req.body;
        const apiKey = await getUserApiKey(userId);

        if (!name || !writingStyleId || !dateRange?.startDate || !dateRange?.endDate) {
            return res.status(400).json({ error: 'Cần điền đầy đủ thông tin bắt buộc' });
        }

        if (!timeSlots || !timeSlots.length) {
            return res.status(400).json({ error: 'Cần ít nhất 1 khung giờ đăng bài' });
        }

        // Validate writing style exists
        const style = await WritingStyle.findOne({ _id: writingStyleId, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        const schedule = await AiContentSchedule.create({
            userId,
            name,
            writingStyleId,
            dateRange: {
                startDate: new Date(dateRange.startDate),
                endDate: new Date(dateRange.endDate),
            },
            timeSlots,
            contentConfig: {
                topics: contentConfig?.topics || [],
                minWords: contentConfig?.minWords || 200,
                maxWords: contentConfig?.maxWords || 500,
                customInstructions: contentConfig?.customInstructions || '',
                language: contentConfig?.language || 'vi',
            },
            status: 'active',
        });

        // Auto-generate posts immediately
        let generatedCount = 0;
        try {
            generatedCount = await aiContentService.generatePostsForSchedule(schedule._id, apiKey);
        } catch (genErr) {
            console.error('[AI Content] Auto-generate after create error:', genErr.message);
        }

        res.json({ success: true, schedule, generatedCount });
    } catch (err) {
        console.error('[AI Content] createSchedule error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * PUT /ai-content/api/schedules/:id - Cập nhật lịch
 */
exports.updateSchedule = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const updates = req.body;

        const schedule = await AiContentSchedule.findOne({ _id: id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });

        if (updates.name !== undefined) schedule.name = updates.name;
        if (updates.writingStyleId !== undefined) schedule.writingStyleId = updates.writingStyleId;
        if (updates.status !== undefined) schedule.status = updates.status;
        if (updates.dateRange !== undefined) schedule.dateRange = updates.dateRange;
        if (updates.timeSlots !== undefined) schedule.timeSlots = updates.timeSlots;
        if (updates.contentConfig !== undefined) {
            Object.assign(schedule.contentConfig, updates.contentConfig);
        }
        schedule.updatedAt = new Date();

        await schedule.save();
        res.json({ success: true, schedule });
    } catch (err) {
        console.error('[AI Content] updateSchedule error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE /ai-content/api/schedules/:id - Xóa lịch
 */
exports.deleteSchedule = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;

        const schedule = await AiContentSchedule.findOneAndDelete({ _id: id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });

        // Xóa tất cả bài viết liên quan
        await AiGeneratedPost.deleteMany({ scheduleId: id });

        res.json({ success: true });
    } catch (err) {
        console.error('[AI Content] deleteSchedule error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /ai-content/api/schedules/:id/generate - Tạo bài ngay lập tức
 */
exports.generateNow = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const apiKey = await getUserApiKey(userId);

        const schedule = await AiContentSchedule.findOne({ _id: id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });

        // Activate if draft
        if (schedule.status === 'draft') {
            schedule.status = 'active';
            await schedule.save();
        }

        const count = await aiContentService.generatePostsForSchedule(id, apiKey);

        res.json({
            success: true,
            message: `Đã tạo ${count} bài viết`,
            count
        });
    } catch (err) {
        console.error('[AI Content] generateNow error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== POSTS API ====================

/**
 * GET /ai-content/api/posts - Danh sách bài viết
 */
exports.getPosts = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { scheduleId, status, page = 1, limit = 20 } = req.query;

        const query = { userId };
        if (scheduleId) query.scheduleId = scheduleId;
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [posts, total] = await Promise.all([
            AiGeneratedPost.find(query)
                .populate('scheduleId', 'name')
                .sort({ scheduledAt: -1 })
                .skip(skip).limit(parseInt(limit)).lean(),
            AiGeneratedPost.countDocuments(query),
        ]);

        res.json({
            posts,
            total,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
        });
    } catch (err) {
        console.error('[AI Content] getPosts error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * PUT /ai-content/api/posts/:id - Chỉnh sửa bài viết
 */
exports.updatePost = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const { title, content } = req.body;

        const post = await AiGeneratedPost.findOne({ _id: id, userId });
        if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });

        if (title !== undefined) post.title = title;
        if (content !== undefined) {
            post.content = content;
            // Cập nhật SchedulePost liên quan
            if (post.schedulePostId) {
                await SchedulePost.findByIdAndUpdate(post.schedulePostId, { caption: content });
            }
        }
        post.updatedAt = new Date();

        await post.save();
        res.json({ success: true, post });
    } catch (err) {
        console.error('[AI Content] updatePost error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE /ai-content/api/posts/:id - Xóa bài viết
 */
exports.deletePost = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;

        const post = await AiGeneratedPost.findOne({ _id: id, userId });
        if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });

        // Xóa SchedulePost liên quan
        if (post.schedulePostId) {
            await SchedulePost.findByIdAndDelete(post.schedulePostId);
        }

        await AiGeneratedPost.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (err) {
        console.error('[AI Content] deletePost error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /ai-content/api/posts/:id/publish - Đăng bài ngay
 */
exports.publishPost = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;

        const post = await AiGeneratedPost.findOne({ _id: id, userId });
        if (!post) return res.status(404).json({ error: 'Không tìm thấy bài viết' });

        // Kích hoạt SchedulePost liên quan
        if (post.schedulePostId) {
            await SchedulePost.findByIdAndUpdate(post.schedulePostId, {
                scheduledAt: new Date(),
                status: 'pending',
            });
        }

        post.status = 'pending';
        post.updatedAt = new Date();
        await post.save();

        res.json({ success: true, message: 'Đã lên lịch đăng bài' });
    } catch (err) {
        console.error('[AI Content] publishPost error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== GENERATE TOPICS ====================

/**
 * POST /ai-content/api/generate-topics - Tạo chủ đề hot bằng AI
 */
exports.generateTopics = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { writingStyleId } = req.body;
        const apiKey = await getUserApiKey(userId);

        const topics = await aiContentService.generateTopics(userId, writingStyleId, apiKey);
        res.json({ success: true, topics });
    } catch (err) {
        console.error('[AI Content] generateTopics error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== TRAINING API ====================

/**
 * POST /ai-content/api/styles/:id/retrain - Train lại từ bài tốt nhất
 */
exports.retrainStyle = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const apiKey = await getUserApiKey(userId);

        const style = await WritingStyle.findOne({ _id: id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        const result = await aiContentService.retrainFromBestPosts(userId, id, apiKey);

        res.json({
            success: true,
            message: `Đã train lại thành công! Version ${result.version}. Đánh giá ${result.topPosts} bài, điểm TB: ${result.avgScore}`,
            ...result,
        });
    } catch (err) {
        console.error('[AI Content] retrainStyle error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /ai-content/api/styles/:id/training-stats - Lấy thống kê training
 */
exports.getTrainingStats = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;

        const stats = await aiContentService.getTrainingStats(userId, id);
        if (!stats) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        res.json({ success: true, ...stats });
    } catch (err) {
        console.error('[AI Content] getTrainingStats error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

// ==================== SETTINGS API ====================

/**
 * POST /ai-content/api/settings/openai-key - Lưu OpenAI API key
 */
exports.saveApiKey = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { apiKey } = req.body;

        if (!apiKey || !apiKey.trim()) {
            return res.status(400).json({ error: 'API key không được để trống' });
        }

        await Settings.findOneAndUpdate(
            { userId },
            { openaiApiKey: apiKey.trim(), updatedAt: new Date() },
            { upsert: true }
        );

        res.json({ success: true, message: 'Đã lưu OpenAI API key' });
    } catch (err) {
        console.error('[AI Content] saveApiKey error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /ai-content/api/settings/openai-key - Kiểm tra đã có API key chưa
 */
exports.checkApiKey = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const settings = await Settings.findOne({ userId }).lean();
        const hasKey = !!(settings?.openaiApiKey);
        res.json({ hasKey });
    } catch (err) {
        res.json({ hasKey: false });
    }
};

// ==================== DASHBOARD API ====================

/**
 * GET /ai-content/api/stats - Thống kê
 */
exports.getStats = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;

        const [totalStyles, totalSchedules, totalPosts, postedCount, failedCount, pendingCount] = await Promise.all([
            WritingStyle.countDocuments({ userId }),
            AiContentSchedule.countDocuments({ userId }),
            AiGeneratedPost.countDocuments({ userId }),
            AiGeneratedPost.countDocuments({ userId, status: 'posted' }),
            AiGeneratedPost.countDocuments({ userId, status: 'failed' }),
            AiGeneratedPost.countDocuments({ userId, status: 'pending' }),
        ]);

        res.json({
            totalStyles,
            totalSchedules,
            totalPosts,
            postedCount,
            failedCount,
            pendingCount,
        });
    } catch (err) {
        console.error('[AI Content] getStats error:', err.message);
        res.status(500).json({ error: err.message });
    }
};