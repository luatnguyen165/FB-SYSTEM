// controllers/commentPlayController.js
const commentPlayService = require('../services/commentPlayService');
const AiScanConfig = require('../models/AiScanConfig');
const AiComment = require('../models/AiComment');
const Channel = require('../models/Channel');

// ============================================================
// PAGE RENDERING
// ============================================================

const showCommentPlays = async (req, res) => {
    try {
        const [plays, stats, scanConfigs, allComments, fbChannels] = await Promise.all([
            commentPlayService.getAll(req.user._id),
            commentPlayService.getStats(req.user._id),
            AiScanConfig.find({ userId: req.user._id }).sort({ name: 1 }).lean(),
            AiComment.find({ userId: req.user._id }).sort({ order: 1 }).lean(),
            Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true }).sort({ accountName: 1 }).lean()
        ]);

        res.render('comment-play', {
            user: req.user,
            plays,
            stats,
            scanConfigs,
            allComments,
            fbChannels,
            currentPage: 'comment-play'
        });
    } catch (error) {
        console.error('Show Comment Plays Error:', error);
        res.render('comment-play', {
            user: req.user,
            plays: [],
            stats: { total: 0, active: 0, paused: 0, todayPosted: 0 },
            scanConfigs: [],
            currentPage: 'comment-play'
        });
    }
};

// ============================================================
// CRUD API
// ============================================================

const createPlay = async (req, res) => {
    try {
        const play = await commentPlayService.create(req.user._id, req.body);
        return res.json({ success: true, message: 'Đã tạo kịch bản!', play });
    } catch (error) {
        console.error('Create Play Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const updatePlay = async (req, res) => {
    try {
        const { playId } = req.params;
        const play = await commentPlayService.update(req.user._id, playId, req.body);
        if (!play) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy kịch bản' });
        }
        return res.json({ success: true, message: 'Đã cập nhật kịch bản!', play });
    } catch (error) {
        console.error('Update Play Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const deletePlay = async (req, res) => {
    try {
        const { playId } = req.params;
        const deleted = await commentPlayService.delete(req.user._id, playId);
        if (!deleted) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy kịch bản' });
        }
        return res.json({ success: true, message: 'Đã xóa kịch bản!' });
    } catch (error) {
        console.error('Delete Play Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const togglePlay = async (req, res) => {
    try {
        const { playId } = req.params;
        const play = await commentPlayService.toggleStatus(req.user._id, playId);
        if (!play) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy kịch bản' });
        }
        const msg = play.status === 'active' ? 'Đã bật kịch bản' : 'Đã tạm dừng kịch bản';
        return res.json({ success: true, message: msg, status: play.status });
    } catch (error) {
        console.error('Toggle Play Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const runPlayNow = async (req, res) => {
    try {
        const { playId } = req.params;
        const result = await commentPlayService.runPlay(req.user._id, playId);
        return res.json({ success: true, message: 'Đã chạy kịch bản!', result });
    } catch (error) {
        console.error('Run Play Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// LOGS
// ============================================================

const getPlayLogs = async (req, res) => {
    try {
        const { playId } = req.params;
        const logs = await commentPlayService.getLogs(req.user._id, playId);
        return res.json({ success: true, logs, count: logs.length });
    } catch (error) {
        console.error('Get Play Logs Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const getPlayLogsSummary = async (req, res) => {
    try {
        const { playId } = req.params;
        const summary = await commentPlayService.getLogsSummary(req.user._id, playId);
        if (!summary) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy kịch bản' });
        }
        return res.json({ success: true, summary });
    } catch (error) {
        console.error('Get Logs Summary Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

module.exports = {
    showCommentPlays,
    createPlay,
    updatePlay,
    deletePlay,
    togglePlay,
    runPlayNow,
    getPlayLogs,
    getPlayLogsSummary
};