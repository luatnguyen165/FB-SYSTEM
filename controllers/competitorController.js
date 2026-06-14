// controllers/competitorController.js
const competitorService = require('../services/competitorService');
const Channel = require('../models/Channel');
const { getOrOpenFacebookContext } = require('../services/facebook/session');
const { fetchPagePosts } = require('../services/facebookPageScraper');

/**
 * Hiển thị trang theo dõi đối thủ
 */

const showCompetitors = async (req, res) => {
    try {
        const stats = await competitorService.getStats(req.session.userId);
        const competitors = await competitorService.getCompetitors(req.session.userId);
        const topPosts = await competitorService.getTopPosts(req.session.userId, 5);
        const facebookChannels = await Channel.find({ userId: req.session.userId, platform: 'FB', isEnabled: true })
            .select('_id accountName accountType')
            .sort({ createdAt: -1 })
            .lean();

        res.render('competitors', {
            user: req.session.user || req.user,
            currentPage: 'competitors',
            competitors,
            stats,
            topPosts,
            facebookChannels,
            t: res.locals.t || ((key) => key),
            lang: res.locals.lang || 'vi'
        });
    } catch (err) {
        console.error('[Competitor] Error:', err.message);
        res.status(500).render('error', { message: 'Lỗi tải trang theo dõi đối thủ', user: req.session.user || req.user });
    }
};

/**
 * API: Lấy danh sách đối thủ
 */
const getCompetitorsAPI = async (req, res) => {
    try {
        const filters = {
            platform: req.query.platform || undefined,
            isActive: req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined,
            search: req.query.search || undefined
        };
        const competitors = await competitorService.getCompetitors(req.session.userId, filters);
        res.json({ success: true, data: competitors });
    } catch (err) {
        console.error('[Competitor API] Error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Thêm đối thủ mới
 */
const createCompetitor = async (req, res) => {
    try {
        const { name, platform, channelId, profileUrl, avatarUrl, description, notes, postLimit } = req.body;
        if (!name || !platform || !profileUrl) {
            return res.status(400).json({ success: false, message: 'Tên, nền tảng và URL là bắt buộc' });
        }
        const competitor = await competitorService.createCompetitor(req.session.userId, {
            name, platform, channelId, profileUrl, avatarUrl, description, notes,
            postLimit: parseInt(postLimit) || 10
        });
        res.json({ success: true, data: competitor });
    } catch (err) {
        console.error('[Competitor API] Create error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Cập nhật đối thủ
 */
const updateCompetitor = async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        if (data.tags && typeof data.tags === 'string') {
            data.tags = data.tags.split(',').map(t => t.trim());
        }
        if (data.followers !== undefined) data.followers = parseInt(data.followers) || 0;
        if (data.postsCount !== undefined) data.postsCount = parseInt(data.postsCount) || 0;

        const competitor = await competitorService.updateCompetitor(id, req.session.userId, data);
        if (!competitor) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối thủ' });
        }
        res.json({ success: true, data: competitor });
    } catch (err) {
        console.error('[Competitor API] Update error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Xóa đối thủ
 */
const deleteCompetitor = async (req, res) => {
    try {
        const { id } = req.params;
        const competitor = await competitorService.deleteCompetitor(id, req.session.userId);
        if (!competitor) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối thủ' });
        }
        res.json({ success: true, message: 'Đã xóa đối thủ thành công' });
    } catch (err) {
        console.error('[Competitor API] Delete error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Toggle active status
 */
const toggleCompetitor = async (req, res) => {
    try {
        const { id } = req.params;
        const competitor = await competitorService.toggleCompetitor(id, req.session.userId);
        if (!competitor) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối thủ' });
        }
        res.json({ success: true, data: competitor });
    } catch (err) {
        console.error('[Competitor API] Toggle error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Lấy bài viết của đối thủ
 */
const getPostsAPI = async (req, res) => {
    try {
        const { id } = req.params;
        const options = {
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 20,
            mediaType: req.query.mediaType || undefined,
            sentiment: req.query.sentiment || undefined
        };
        const result = await competitorService.getPosts(id, req.session.userId, options);
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Competitor API] Get posts error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Thêm bài viết cho đối thủ
 */
const addPost = async (req, res) => {
    try {
        const { id } = req.params;
        const post = await competitorService.addPost(id, req.session.userId, req.body);
        res.json({ success: true, data: post });
    } catch (err) {
        console.error('[Competitor API] Add post error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Cập nhật bài viết
 */
const updatePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const post = await competitorService.updatePost(postId, req.session.userId, req.body);
        if (!post) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }
        res.json({ success: true, data: post });
    } catch (err) {
        console.error('[Competitor API] Update post error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Xóa bài viết
 */
const deletePost = async (req, res) => {
    try {
        const { postId } = req.params;
        const post = await competitorService.deletePost(postId, req.session.userId);
        if (!post) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy bài viết' });
        }
        res.json({ success: true, message: 'Đã xóa bài viết' });
    } catch (err) {
        console.error('[Competitor API] Delete post error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: So sánh đối thủ
 */
const compareCompetitors = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length < 2) {
            return res.status(400).json({ success: false, message: 'Cần chọn ít nhất 2 đối thủ để so sánh' });
        }
        const result = await competitorService.compareCompetitors(ids, req.session.userId);
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Competitor API] Compare error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Lấy xu hướng followers
 */
const getFollowerTrend = async (req, res) => {
    try {
        const { id } = req.params;
        const days = parseInt(req.query.days) || 30;
        const trend = await competitorService.getFollowerTrend(id, req.session.userId, days);
        if (!trend) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy đối thủ' });
        }
        res.json({ success: true, data: trend });
    } catch (err) {
        console.error('[Competitor API] Follower trend error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Thống kê tổng quan
 */
const getStatsAPI = async (req, res) => {
    try {
        const stats = await competitorService.getStats(req.session.userId);
        res.json({ success: true, data: stats });
    } catch (err) {
        console.error('[Competitor API] Stats error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Kiểm tra trạng thái scrape
 */
const getStatusAPI = async (req, res) => {
    try {
        const { id } = req.params;
        const competitor = await competitorService.getCompetitorById(id, req.session.userId);
        if (!competitor) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        res.json({ success: true, data: { scraping: competitor.scraping || false, postsCount: competitor.postsCount || 0, lastCheckedAt: competitor.lastCheckedAt } });
    } catch (err) {
        console.error('[Competitor API] Status error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Scrape bài viết từ page/profile đối thủ
 */
const scrapeCompetitor = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[Competitor] 🎯 scrapeCompetitor called — id=${id}, userId=${req.session.userId}`);
        if (!id) return res.status(400).json({ success: false, message: 'Thiếu id' });

        const competitor = await competitorService.getCompetitorById(id, req.session.userId);
        console.log(`[Competitor] 📋 Found competitor:`, competitor ? { name: competitor.name, platform: competitor.platform, profileUrl: competitor.profileUrl, channelId: competitor.channelId, postLimit: competitor.postLimit } : 'NOT FOUND');
        if (!competitor) return res.status(404).json({ success: false, message: 'Không tìm thấy đối thủ' });

        res.json({ success: true, message: 'Đang bắt đầu scrape...' });
        console.log(`[Competitor] ✅ Response sent to client, starting background scrape...`);

        // Run in background
        competitorService.scrapeCompetitorPosts(req.session.userId, competitor).then(result => {
            console.log(`[Competitor] 🎉 Scrape completed: ${competitor.name}`, JSON.stringify(result));
        }).catch(err => {
            console.error(`[Competitor] ❌ Scrape failed: ${competitor.name}`, err.message, err.stack);
        });
    } catch (err) {
        console.error('[Competitor] ❌ Scrape error:', err.message, err.stack);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Lấy tất cả bài viết (không filter theo competitor)
 */
const getAllPostsAPI = async (req, res) => {
    try {
        const options = {
            page: parseInt(req.query.page) || 1,
            limit: parseInt(req.query.limit) || 50,
            mediaType: req.query.mediaType || undefined,
            competitorId: req.query.competitorId || undefined
        };
        const result = await competitorService.getAllPosts(req.session.userId, options);
        console.log(`[Competitor API] getAllPosts: ${result.posts.length} posts (page ${result.page}/${result.totalPages}, total: ${result.total})`);
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[Competitor API] Get all posts error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

module.exports = {
    showCompetitors,
    getCompetitorsAPI,
    createCompetitor,
    updateCompetitor,
    deleteCompetitor,
    toggleCompetitor,
    getPostsAPI,
    getAllPostsAPI,
    addPost,
    updatePost,
    deletePost,
    compareCompetitors,
    getFollowerTrend,
    getStatsAPI,
    getStatusAPI,
    scrapeCompetitor
};
