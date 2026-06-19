// controllers/aiScanController.js
const AiScanConfig = require('../models/AiScanConfig');
const AiScanResult = require('../models/AiScanResult');
const Channel = require('../models/Channel');
const FacebookGroupCache = require('../models/FacebookGroupCache');
const Settings = require('../models/Settings');
const path = require('path');
const { runAiScan, playCommentForResult } = require('../services/aiScanService');

// ============================================================
// PAGE RENDERING
// ============================================================

// Hiển thị trang Quét AI
const showAiScan = async (req, res) => {
    try {
        const [configs, facebookChannels, settings] = await Promise.all([
            AiScanConfig.find({ userId: req.user._id })
                .sort({ createdAt: -1 })
                .lean(),
            Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true })
                .select('_id accountName accountType avatarUrl')
                .sort({ createdAt: -1 })
                .lean(),
            Settings.findOne({ userId: req.user._id }).select('openaiApiKey').lean()
        ]);

        // Lấy kết quả quét gần đây (30 ngày)
        const recentResults = await AiScanResult.find({ userId: req.user._id })
            .sort({ scannedAt: -1 })
            .limit(50)
            .lean();

        // Stats
        const stats = {
            totalScanned: await AiScanResult.countDocuments({ userId: req.user._id }),
            totalMatched: await AiScanResult.countDocuments({ userId: req.user._id, isMatching: true }),
            totalCommented: await AiScanResult.countDocuments({ userId: req.user._id, commentSent: true }),
            activeConfigs: configs.filter(c => c.isActive).length,
            scheduledConfigs: configs.filter(c => c.isActive && c.scheduleEnabled).length
        };

        res.render('ai-scan', {
            user: req.user,
            configs,
            facebookChannels,
            recentResults,
            stats,
            openaiApiKey: settings?.openaiApiKey || '',
            currentPage: 'ai-scan'
        });
    } catch (error) {
        console.error('Show AI Scan Error:', error);
        res.render('ai-scan', {
            user: req.user,
            configs: [],
            facebookChannels: [],
            recentResults: [],
            stats: { totalScanned: 0, totalMatched: 0, totalCommented: 0, activeConfigs: 0, scheduledConfigs: 0 },
            openaiApiKey: '',
            currentPage: 'ai-scan'
        });
    }
};

// ============================================================
// FILE UPLOAD API
// ============================================================

// Upload file (image/video) cho comment items
const uploadCommentFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn file để upload' });
        }

        const filePath = req.file.path;
        const relativePath = path.relative(global.USER_DATA_DIR || path.join(__dirname, '..'), filePath).replace(/\\/g, '/');
        const fileType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
        const fileName = req.file.originalname;

        return res.json({
            success: true,
            message: 'Upload file thành công',
            data: {
                filePath: relativePath,
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

// ============================================================
// CONFIG API
// ============================================================

// Tạo cấu hình quét mới
const createConfig = async (req, res) => {
    try {
        const {
            name, channelId, scanScript,
            maxPostsPerScan, scanIntervalMinutes,
            scheduleEnabled, scheduleHour, scheduleMinute,
            scheduleTimeStart, scheduleTimeEnd, maxPostsPerScanSchedule,
            maxDaysOld, openaiApiKey, model,
            aiProvider, openaiCompatibleApiKey, openaiCompatibleBaseUrl, openaiCompatibleModel,
            anthropicApiKey, anthropicModel
        } = req.body;

        if (!name || !channelId) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên và chọn tài khoản Facebook' });
        }

        // Validate channel
        const channel = await Channel.findOne({ _id: channelId, userId: req.user._id, platform: 'FB' }).lean();
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Tài khoản Facebook không tồn tại' });
        }

        // Parse groupKeys từ JSON string
        let groupKeys = [];
        try {
            groupKeys = req.body.groupKeys ? JSON.parse(req.body.groupKeys) : [];
        } catch (parseErr) {
            groupKeys = Array.isArray(req.body.groupKeys) ? req.body.groupKeys : (req.body.groupKeys ? [req.body.groupKeys] : []);
        }

        // Parse commentItems từ JSON string
        let parsedCommentItems = [];
        try {
            parsedCommentItems = req.body.commentItems ? JSON.parse(req.body.commentItems) : [];
            if (!Array.isArray(parsedCommentItems)) parsedCommentItems = [];
        } catch (parseErr) {
            parsedCommentItems = [];
        }

        const config = await AiScanConfig.create({
            userId: req.user._id,
            name: String(name).trim(),
            channelId,
            groupKeys,
            scanScript: String(scanScript).trim(),
            commentItems: parsedCommentItems,
            scheduleEnabled: scheduleEnabled === 'true' || scheduleEnabled === true,
            scheduleHour: parseInt(scheduleHour, 10) || 8,
            scheduleMinute: parseInt(scheduleMinute, 10) || 0,
            scheduleTimeStart: scheduleTimeStart || '06:00',
            scheduleTimeEnd: scheduleTimeEnd || '23:00',
            maxDaysOld: parseInt(maxDaysOld, 10) || 1,
            openaiApiKey: String(openaiApiKey || '').trim(),
            scanIntervalMinutes: parseInt(scanIntervalMinutes, 10) || 60,
            maxPostsPerScan: parseInt(maxPostsPerScan || maxPostsPerScanSchedule, 10) || 10,
            model: String(model || 'gpt-4o-mini').trim(),
            aiProvider: aiProvider || 'openai',
            openaiCompatibleApiKey: String(openaiCompatibleApiKey || '').trim(),
            openaiCompatibleBaseUrl: String(openaiCompatibleBaseUrl || '').trim(),
            openaiCompatibleModel: String(openaiCompatibleModel || 'gpt-3.5-turbo').trim(),
            anthropicApiKey: String(anthropicApiKey || '').trim(),
            anthropicModel: String(anthropicModel || 'claude-3-haiku-20240307').trim(),
            isActive: true
        });

        console.log(`[AI Scan] Created config: ${config.name} (${config._id})`);

        return res.json({ success: true, message: 'Đã tạo cấu hình quét AI', config });
    } catch (error) {
        console.error('Create AI Scan Config Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Cập nhật cấu hình
const updateConfig = async (req, res) => {
    try {
        const { configId } = req.body;
        if (!configId) {
            return res.status(400).json({ success: false, message: 'Thiếu configId' });
        }

        const config = await AiScanConfig.findOne({ _id: configId, userId: req.user._id });
        if (!config) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình' });
        }

        const {
            name, channelId, scanScript,
            maxPostsPerScan, maxPostsPerScanSchedule, scanIntervalMinutes,
            scheduleEnabled, scheduleHour, scheduleMinute,
            scheduleTimeStart, scheduleTimeEnd, maxDaysOld,
            openaiApiKey, isActive, model,
            aiProvider, openaiCompatibleApiKey, openaiCompatibleBaseUrl, openaiCompatibleModel,
            anthropicApiKey, anthropicModel
        } = req.body;

        if (name !== undefined) config.name = String(name).trim();
        if (channelId !== undefined) config.channelId = channelId;
        if (scanScript !== undefined) config.scanScript = String(scanScript).trim();
        if (maxPostsPerScan !== undefined || maxPostsPerScanSchedule !== undefined) {
            config.maxPostsPerScan = parseInt(maxPostsPerScan || maxPostsPerScanSchedule, 10) || 10;
        }
        if (scanIntervalMinutes !== undefined) config.scanIntervalMinutes = parseInt(scanIntervalMinutes, 10) || 60;
        if (scheduleEnabled !== undefined) config.scheduleEnabled = scheduleEnabled === 'true' || scheduleEnabled === true;
        if (scheduleHour !== undefined) config.scheduleHour = parseInt(scheduleHour, 10) || 8;
        if (scheduleMinute !== undefined) config.scheduleMinute = parseInt(scheduleMinute, 10) || 0;
        if (scheduleTimeStart !== undefined) config.scheduleTimeStart = scheduleTimeStart || '06:00';
        if (scheduleTimeEnd !== undefined) config.scheduleTimeEnd = scheduleTimeEnd || '23:00';
        if (maxDaysOld !== undefined) config.maxDaysOld = parseInt(maxDaysOld, 10) || 1;
        if (openaiApiKey !== undefined) config.openaiApiKey = String(openaiApiKey || '').trim();
        if (isActive !== undefined) config.isActive = isActive === 'true' || isActive === true;
        if (model !== undefined) config.model = String(model || 'gpt-4o-mini').trim();
        if (aiProvider !== undefined) config.aiProvider = aiProvider;
        if (openaiCompatibleApiKey !== undefined) config.openaiCompatibleApiKey = String(openaiCompatibleApiKey || '').trim();
        if (openaiCompatibleBaseUrl !== undefined) config.openaiCompatibleBaseUrl = String(openaiCompatibleBaseUrl || '').trim();
        if (openaiCompatibleModel !== undefined) config.openaiCompatibleModel = String(openaiCompatibleModel || 'gpt-3.5-turbo').trim();
        if (anthropicApiKey !== undefined) config.anthropicApiKey = String(anthropicApiKey || '').trim();
        if (anthropicModel !== undefined) config.anthropicModel = String(anthropicModel || 'claude-3-haiku-20240307').trim();

        // Parse groupKeys
        try {
            if (req.body.groupKeys) {
                config.groupKeys = typeof req.body.groupKeys === 'string' ? JSON.parse(req.body.groupKeys) : req.body.groupKeys;
            }
        } catch (parseErr) { /* ignore */ }

        // Parse commentItems
        try {
            if (req.body.commentItems !== undefined) {
                const parsed = typeof req.body.commentItems === 'string' ? JSON.parse(req.body.commentItems) : req.body.commentItems;
                if (Array.isArray(parsed)) config.commentItems = parsed;
            }
        } catch (parseErr) { /* ignore */ }

        config.updatedAt = new Date();
        await config.save();

        console.log(`[AI Scan] Updated config: ${config.name} (${config._id})`);

        return res.json({ success: true, message: 'Đã cập nhật cấu hình', config });
    } catch (error) {
        console.error('Update AI Scan Config Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Xóa cấu hình
const deleteConfig = async (req, res) => {
    try {
        const { configId } = req.params;
        const result = await AiScanConfig.deleteOne({ _id: configId, userId: req.user._id });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình' });
        }

        // Xóa cả kết quả liên quan
        await AiScanResult.deleteMany({ configId, userId: req.user._id });

        return res.json({ success: true, message: 'Đã xóa cấu hình và kết quả liên quan' });
    } catch (error) {
        console.error('Delete AI Scan Config Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Bật/tắt cấu hình
const toggleConfig = async (req, res) => {
    try {
        const { configId } = req.params;
        const config = await AiScanConfig.findOne({ _id: configId, userId: req.user._id });
        if (!config) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình' });
        }

        config.isActive = !config.isActive;
        config.updatedAt = new Date();
        await config.save();

        return res.json({
            success: true,
            message: config.isActive ? 'Đã bật cấu hình' : 'Đã tắt cấu hình',
            isActive: config.isActive
        });
    } catch (error) {
        console.error('Toggle AI Scan Config Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Lấy chi tiết cấu hình
const getConfigById = async (req, res) => {
    try {
        const config = await AiScanConfig.findOne({ _id: req.params.configId, userId: req.user._id }).lean();
        if (!config) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình' });
        }
        return res.json({ success: true, config });
    } catch (error) {
        console.error('Get AI Scan Config Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// SCAN EXECUTION API
// ============================================================

// Chạy quét ngay
const runScanNow = async (req, res) => {
    try {
        const { configId } = req.body;

        if (!configId) {
            return res.status(400).json({ success: false, message: 'Thiếu configId' });
        }

        const config = await AiScanConfig.findOne({ _id: configId, userId: req.user._id });
        if (!config) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình' });
        }

        // Chạy quét (không await để không block response - trả về ngay)
        res.json({ success: true, message: 'Đã bắt đầu quét. Hệ thống đang chạy ở background...' });

        // Chạy trong background
        runAiScan(config).then(result => {
            console.log(`[AI Scan] Background scan completed: ${config.name}`, {
                total: result.totalPosts,
                matching: result.matchingPosts,
                commented: result.commentedPosts
            });
        }).catch(error => {
            console.error(`[AI Scan] Background scan failed: ${config.name}`, error.message);
        });

    } catch (error) {
        console.error('Run AI Scan Now Error:', error);
        // Nếu chưa gửi response thì mới gửi lỗi
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
        }
    }
};

// ============================================================
// RESULTS API
// ============================================================

// Lấy danh sách kết quả quét
const getResults = async (req, res) => {
    try {
        const { configId, isMatching, commentSent, page = 1, limit = 20 } = req.query;
        const filter = { userId: req.user._id };

        if (configId) filter.configId = configId;
        if (isMatching !== undefined && isMatching !== '') filter.isMatching = isMatching === 'true';
        if (commentSent !== undefined && commentSent !== '') filter.commentSent = commentSent === 'true';

        const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

        const [results, total] = await Promise.all([
            AiScanResult.find(filter)
                .sort({ scannedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit, 10))
                .lean(),
            AiScanResult.countDocuments(filter)
        ]);

        return res.json({
            success: true,
            results,
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / parseInt(limit, 10))
        });
    } catch (error) {
        console.error('Get AI Scan Results Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Xóa 1 kết quả quét
const deleteOneResult = async (req, res) => {
    try {
        const { resultId } = req.body;
        if (!resultId) return res.status(400).json({ success: false, message: 'Thiếu resultId' });
        const r = await AiScanResult.deleteOne({ _id: resultId, userId: req.user._id });
        if (r.deletedCount === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy kết quả' });
        return res.json({ success: true, message: 'Đã xóa kết quả' });
    } catch (error) {
        console.error('Delete One Result Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Cập nhật kết quả quét
const updateResult = async (req, res) => {
    try {
        const { resultId } = req.body;
        if (!resultId) return res.status(400).json({ success: false, message: 'Thiếu resultId' });

        const result = await AiScanResult.findOne({ _id: resultId, userId: req.user._id });
        if (!result) return res.status(404).json({ success: false, message: 'Không tìm thấy kết quả' });

        const { postContent, postUrl, postAuthor, aiScore, isMatching, matchReason, aiAnalysis } = req.body;
        if (postContent !== undefined) result.postContent = postContent;
        if (postUrl !== undefined) result.postUrl = postUrl;
        if (postAuthor !== undefined) result.postAuthor = postAuthor;
        if (aiScore !== undefined) result.aiScore = parseInt(aiScore, 10) || 0;
        if (isMatching !== undefined) result.isMatching = isMatching === 'true' || isMatching === true;
        if (matchReason !== undefined) result.matchReason = matchReason;
        if (aiAnalysis !== undefined) result.aiAnalysis = aiAnalysis;

        await result.save();
        return res.json({ success: true, message: 'Đã cập nhật kết quả', result });
    } catch (error) {
        console.error('Update Result Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Xóa kết quả quét
const deleteResults = async (req, res) => {
    try {
        const filter = { userId: req.user._id };
        if (req.body && req.body.configId) filter.configId = req.body.configId;

        const result = await AiScanResult.deleteMany(filter);
        return res.json({ success: true, message: `Đã xóa ${result.deletedCount} kết quả`, deletedCount: result.deletedCount });
    } catch (error) {
        console.error('Delete AI Scan Results Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// Lấy danh sách groups của channel
const getChannelGroups = async (req, res) => {
    try {
        const { channelId } = req.query;
        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Thiếu channelId' });
        }

        const cache = await FacebookGroupCache.findOne({
            userId: req.user._id,
            channelId
        }).lean();

        const groups = cache?.groups || [];
        return res.json({ success: true, groups, count: groups.length });
    } catch (error) {
        console.error('Get Channel Groups Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// SETTINGS API
// ============================================================

// Lưu OpenAI key
const saveOpenAiKey = async (req, res) => {
    try {
        const { openaiApiKey } = req.body;

        await Settings.findOneAndUpdate(
            { userId: req.user._id },
            { $set: { openaiApiKey: String(openaiApiKey || '').trim(), updatedAt: new Date() } },
            { upsert: true, returnDocument: "after" }
        );

        return res.json({ success: true, message: 'Đã lưu OpenAI API key' });
    } catch (error) {
        console.error('Save OpenAI Key Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// PLAY COMMENT (Re-trigger gửi comment cho 1 kết quả)
// ============================================================
const playComment = async (req, res) => {
    try {
        const { resultId } = req.params;
        if (!resultId) return res.status(400).json({ success: false, message: 'Thiếu resultId' });

        // Verify result thuộc user
        const result = await AiScanResult.findOne({ _id: resultId, userId: req.user._id }).lean();
        if (!result) return res.status(404).json({ success: false, message: 'Không tìm thấy kết quả' });

        // Trả response ngay vì việc gửi comment mất thời gian (mở browser, navigate, gõ text...)
        res.json({ success: true, message: 'Đã bắt đầu gửi comment. Trình duyệt sẽ mở và xử lý tự động.' });

        // Chạy trong background
        playCommentForResult(resultId).then(playRes => {
            console.log(`[Play] Result for ${resultId}:`, playRes.success ? 'OK' : 'FAILED', playRes.message);
            // Emit socket nếu cần (optional)
            try {
                const io = require('../services/socketService').getIO?.();
                if (io && req.user._id) {
                    io.to('user_' + req.user._id).emit('ai-scan:play-comment-result', {
                        resultId, success: playRes.success, message: playRes.message
                    });
                }
            } catch (e) {}
        }).catch(err => {
            console.error(`[Play] Background error for ${resultId}:`, err.message);
        });
    } catch (error) {
        console.error('Play Comment Error:', error);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
        }
    }
};

// Test OpenAI API key
const testOpenAiKey = async (req, res) => {
    try {
        const { openaiApiKey } = req.body;
        const key = String(openaiApiKey || '').trim();

        if (!key) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập API key' });
        }

        // Gọi API test
        const { callOpenAi } = require('../services/aiScanService');
        const result = await callOpenAi('Trả lời ngắn gọn: "Kết nối OpenAI thành công!"', key);

        return res.json({
            success: true,
            message: 'Kết nối OpenAI thành công!',
            testResponse: result.substring(0, 100)
        });
    } catch (error) {
        console.error('Test OpenAI Key Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi kết nối: ' + error.message });
    }
};

module.exports = {
    // Pages
    showAiScan,

    // Config CRUD
    createConfig,
    updateConfig,
    deleteConfig,
    toggleConfig,
    getConfigById,

    // Scan execution
    runScanNow,

    // Results
    getResults,
    updateResult,
    deleteOneResult,
    deleteResults,

    // Groups
    getChannelGroups,

    // Settings
    saveOpenAiKey,
    testOpenAiKey,

    // File upload
    uploadCommentFile
};