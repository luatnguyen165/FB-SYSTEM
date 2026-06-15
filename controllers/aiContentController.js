// controllers/aiContentController.js
const fs = require('fs');
const path = require('path');
const WritingStyle = require('../models/WritingStyle');
const AiContentSchedule = require('../models/AiContentSchedule');
const AiGeneratedPost = require('../models/AiGeneratedPost');
const SchedulePost = require('../models/SchedulePost');
const Channel = require('../models/Channel');
const Settings = require('../models/Settings');
const FacebookGroupCache = require('../models/FacebookGroupCache');
const aiContentService = require('../services/aiContentService');
const { isValidApiKey } = aiContentService;
const { normalizeEncryptedValue } = require('../utils/cryptoVault');

const DATA_DIR = global.USER_DATA_DIR || path.join(__dirname, '..');
const UPLOAD_IMAGE_DIR = path.join(DATA_DIR, 'uploads', 'images');

/**
 * Helper: Xóa file ảnh trên đĩa từ đường dẫn URL
 */
function deleteImageFiles(imagePaths) {
    if (!imagePaths || !imagePaths.length) return;
    for (const img of imagePaths) {
        try {
            // Image paths are stored as URLs like "/uploads/images/filename.jpg"
            const filename = path.basename(img);
            const filePath = path.join(UPLOAD_IMAGE_DIR, filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[AI Content] Đã xóa file ảnh: ${filePath}`);
            }
        } catch (err) {
            console.error(`[AI Content] Lỗi xóa file ảnh ${img}:`, err.message);
        }
    }
}

/**
 * Helper: Lấy cấu hình AI từ Settings của user
 */
async function getUserApiConfig(userId) {
    const settings = await Settings.findOne({ userId }).lean();
    if (!settings) {
        return {
            apiKey: process.env.OPENAI_API_KEY || '',
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: '',
        };
    }

    const provider = settings.aiProvider || 'openai';
    let apiKey = '';
    let model = 'gpt-4o-mini';
    let baseUrl = '';

    if (provider === 'openai') {
        apiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY || '';
        model = settings.openaiModel || 'gpt-4o-mini';
    } else if (provider === 'openai-compatible') {
        apiKey = settings.openaiCompatibleApiKey || settings.openaiApiKey || process.env.OPENAI_API_KEY || '';
        model = settings.openaiCompatibleModel || 'gpt-3.5-turbo';
        baseUrl = settings.openaiCompatibleBaseUrl || '';
    } else if (provider === 'anthropic') {
        apiKey = settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
        model = settings.anthropicModel || 'claude-3-haiku-20240307';
    }

    // Giải mã API key nếu đã được mã hóa (dataEncryptionEnabled = true)
    apiKey = normalizeEncryptedValue(apiKey);

    return { apiKey, provider, model, baseUrl };
}

/**
 * Helper: Lấy OpenAI API key từ Settings của user (giữ nguyên cho tương thích)
 */
async function getUserApiKey(userId) {
    const config = await getUserApiConfig(userId);
    return config.apiKey;
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
        const aiConfig = await getUserApiConfig(userId);

        const style = await WritingStyle.findOne({ _id: id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        if (!style.sampleArticles || !style.sampleArticles.length) {
            return res.status(400).json({ error: 'Cần ít nhất 1 bài viết mẫu' });
        }

        // Kiểm tra API key trước khi gọi AI
        if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) {
            return res.status(400).json({
                error: 'Chưa cấu hình API Key. Vào Cài đặt > Cấu hình AI để nhập API key.',
                code: 'MISSING_API_KEY'
            });
        }

        // Kiểm tra định dạng API key (chỉ với OpenAI keys)
        if (aiConfig.provider === 'openai' && !aiConfig.apiKey.startsWith('sk-')) {
            return res.status(400).json({
                error: 'API Key không hợp lệ. OpenAI key phải bắt đầu bằng "sk-".',
                code: 'INVALID_API_KEY_FORMAT'
            });
        }

        const analysis = await aiContentService.analyzeWritingStyle(userId, style.sampleArticles, aiConfig.apiKey, aiConfig);

        style.styleAnalysis = analysis;
        style.updatedAt = new Date();
        await style.save();

        res.json({ success: true, analysis });
    } catch (err) {
        console.error('[AI Content] analyzeStyle error:', err.message);
        
        // Phân loại lỗi để trả về thông báo phù hợp
        if (err.response?.status === 401) {
            return res.status(400).json({
                error: 'API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại API key trong Cài đặt.',
                code: 'UNAUTHORIZED_API_KEY'
            });
        }
        if (err.response?.status === 429) {
            return res.status(429).json({
                error: 'Đã vượt quá giới hạn API. Vui lòng thử lại sau ít phút.',
                code: 'RATE_LIMITED'
            });
        }
        if (err.code === 'ECONNABORTED') {
            return res.status(504).json({
                error: 'Kết nối AI quá thời gian. Vui lòng thử lại.',
                code: 'TIMEOUT'
            });
        }
        
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
        const aiConfig = await getUserApiConfig(userId);

        if (!name || !writingStyleId || !dateRange?.startDate || !dateRange?.endDate) {
            return res.status(400).json({ error: 'Cần điền đầy đủ thông tin bắt buộc' });
        }

        if (!timeSlots || !timeSlots.length) {
            return res.status(400).json({ error: 'Cần ít nhất 1 khung giờ đăng bài' });
        }

        // Validate writing style exists
        const style = await WritingStyle.findOne({ _id: writingStyleId, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        // Kiểm tra API key trước khi tạo bài auto
        if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) {
            const scheduleNoGen = await AiContentSchedule.create({
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
            return res.json({ success: true, schedule: scheduleNoGen, generatedCount: 0, warning: 'Chưa cấu hình API Key. Vào Cài đặt > Cấu hình AI để nhập API key, sau đó bấm "Tạo bài" để sinh nội dung.' });
        }

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
            generatedCount = await aiContentService.generatePostsForSchedule(schedule._id, aiConfig.apiKey, aiConfig);
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

        // Xóa tất cả bài viết liên quan (gồm cả file ảnh và SchedulePost)
        const oldPosts = await AiGeneratedPost.find({ scheduleId: id, userId }).lean();
        if (oldPosts.length > 0) {
            const schedulePostIds = oldPosts.filter(p => p.schedulePostId).map(p => p.schedulePostId);
            if (schedulePostIds.length > 0) {
                const schedulePosts = await SchedulePost.find({ _id: { $in: schedulePostIds } }).lean();
                for (const sp of schedulePosts) {
                    if (sp.images && sp.images.length > 0) {
                        deleteImageFiles(sp.images);
                    }
                }
                await SchedulePost.deleteMany({ _id: { $in: schedulePostIds } });
            }
            await AiGeneratedPost.deleteMany({ scheduleId: id, userId });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[AI Content] deleteSchedule error:', err.message);
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /ai-content/api/schedules/:id/generate - Tạo bài ngay lập tức
 * Nếu đã có bài viết cũ, sẽ xóa hết và tạo lại theo văn phong hiện tại
 */
exports.generateNow = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?._id;
        const { id } = req.params;
        const aiConfig = await getUserApiConfig(userId);

        const schedule = await AiContentSchedule.findOne({ _id: id, userId });
        if (!schedule) return res.status(404).json({ error: 'Không tìm thấy lịch' });

        // Kiểm tra API key trước khi gọi AI
        if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) {
            return res.status(400).json({
                error: 'Chưa cấu hình API Key. Vào Cài đặt > Cấu hình AI để nhập API key trước khi tạo bài.',
                code: 'MISSING_API_KEY'
            });
        }

        // Activate if draft
        if (schedule.status === 'draft') {
            schedule.status = 'active';
            await schedule.save();
        }

        // Xóa bài viết cũ của schedule này (nếu có) để tạo lại theo văn phong hiện tại
        const oldPosts = await AiGeneratedPost.find({ scheduleId: id, userId }).lean();
        if (oldPosts.length > 0) {
            // Xóa file ảnh trên đĩa của các SchedulePost liên quan
            const schedulePostIds = oldPosts.filter(p => p.schedulePostId).map(p => p.schedulePostId);
            if (schedulePostIds.length > 0) {
                const schedulePosts = await SchedulePost.find({ _id: { $in: schedulePostIds } }).lean();
                for (const sp of schedulePosts) {
                    if (sp.images && sp.images.length > 0) {
                        deleteImageFiles(sp.images);
                    }
                }
                await SchedulePost.deleteMany({ _id: { $in: schedulePostIds } });
            }
            // Xóa AiGeneratedPost cũ
            await AiGeneratedPost.deleteMany({ scheduleId: id, userId });
            // Reset counter
            await AiContentSchedule.findByIdAndUpdate(id, { postsGenerated: 0 });
            console.log(`[AI Content] Đã xóa ${oldPosts.length} bài cũ (gồm cả file ảnh) của schedule ${id} trước khi tạo lại`);
        }

        const count = await aiContentService.generatePostsForSchedule(id, aiConfig.apiKey, aiConfig);

        res.json({
            success: true,
            message: count > 0
                ? `Đã xóa ${oldPosts.length || 0} bài cũ và tạo ${count} bài mới theo văn phong hiện tại!`
                : `Đã xóa ${oldPosts.length || 0} bài cũ. Không có slot nào để tạo bài mới.`,
            count,
            deletedCount: oldPosts.length || 0
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

        // Xóa file ảnh trên đĩa và SchedulePost liên quan
        if (post.schedulePostId) {
            const schedulePost = await SchedulePost.findById(post.schedulePostId).lean();
            if (schedulePost && schedulePost.images && schedulePost.images.length > 0) {
                deleteImageFiles(schedulePost.images);
            }
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
        const aiConfig = await getUserApiConfig(userId);

        // Kiểm tra API key trước khi gọi AI
        if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) {
            return res.status(400).json({
                error: 'Chưa cấu hình API Key. Vào Cài đặt > Cấu hình AI để nhập API key.',
                code: 'MISSING_API_KEY'
            });
        }
        if (aiConfig.provider === 'openai' && !aiConfig.apiKey.startsWith('sk-')) {
            return res.status(400).json({
                error: 'API Key không hợp lệ. OpenAI key phải bắt đầu bằng "sk-".',
                code: 'INVALID_API_KEY_FORMAT'
            });
        }

        const topics = await aiContentService.generateTopics(userId, writingStyleId, aiConfig.apiKey, aiConfig);
        res.json({ success: true, topics });
    } catch (err) {
        console.error('[AI Content] generateTopics error:', err.message);
        if (err.response?.status === 401) {
            return res.status(400).json({
                error: 'API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại API key trong Cài đặt.',
                code: 'UNAUTHORIZED_API_KEY'
            });
        }
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
        const aiConfig = await getUserApiConfig(userId);

        const style = await WritingStyle.findOne({ _id: id, userId });
        if (!style) return res.status(404).json({ error: 'Không tìm thấy văn phong' });

        // Kiểm tra API key trước khi gọi AI
        if (!aiConfig.apiKey || !aiConfig.apiKey.trim()) {
            return res.status(400).json({
                error: 'Chưa cấu hình API Key. Vào Cài đặt > Cấu hình AI để nhập API key.',
                code: 'MISSING_API_KEY'
            });
        }

        const result = await aiContentService.retrainFromBestPosts(userId, id, aiConfig.apiKey, aiConfig);

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