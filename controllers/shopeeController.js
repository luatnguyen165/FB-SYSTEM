// controllers/shopeeController.js
const ShopeeLink = require('../models/ShopeeLink');
const SchedulePost = require('../models/SchedulePost');

const PLATFORM_META = {
    shopee:  { label: 'Shopee',      icon: 'fa-solid fa-bag-shopping', color: '#ee4d2d' },
    tiktok:  { label: 'TikTok Shop', icon: 'fa-brands fa-tiktok',       color: '#000000' },
    website: { label: 'Website',      icon: 'fa-solid fa-globe',         color: '#2563eb' },
};

// Hiển thị trang Shopee Links
const showShopeeLinks = async (req, res) => {
    try {
        const links = await ShopeeLink.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        const usedIds = new Set();
        const posts = await SchedulePost.find({ userId: req.user._id, 'shopeeLinks.0': { $exists: true } }, 'shopeeLinks').lean();
        posts.forEach(s => (s.shopeeLinks || []).forEach(id => usedIds.add(String(id))));
        const enriched = links.map(l => ({ ...l, status: usedIds.has(String(l._id)) ? 'attached' : 'pending' }));
        res.render('shopeeLinks', { user: req.user, links: enriched });
    } catch (error) {
        console.error('Show Shopee Links Error:', error);
        res.render('shopeeLinks', { user: req.user, links: [] });
    }
};

// API: Thêm sản phẩm
const createShopeeLink = async (req, res) => {
    try {
        const { title, shopeeUrl, platform } = req.body;
        if (!title || !shopeeUrl) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin sản phẩm' });
        }
        if (!['shopee', 'tiktok', 'website'].includes(platform)) {
            return res.status(400).json({ success: false, message: 'Nền tảng không hợp lệ' });
        }
        let imageUrl = '';
        if (req.file) {
            imageUrl = '/uploads/images/' + req.file.filename;
        }
        const link = await ShopeeLink.create({
            userId: req.user._id,
            title,
            shopeeUrl,
            imageUrl,
            platform
        });
        res.json({ success: true, message: 'Đã thêm sản phẩm!', link });
    } catch (error) {
        console.error('Create Shopee Link Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Cập nhật sản phẩm
const updateShopeeLink = async (req, res) => {
    try {
        const { title, shopeeUrl, platform } = req.body;
        const link = await ShopeeLink.findOne({ _id: req.params.id, userId: req.user._id });
        if (!link) return res.status(404).json({ success: false, message: 'Sản phẩm không tồn tại' });

        if (title) link.title = title;
        if (shopeeUrl) link.shopeeUrl = shopeeUrl;
        if (platform && ['shopee', 'tiktok', 'website'].includes(platform)) link.platform = platform;
        if (req.file) link.imageUrl = '/uploads/images/' + req.file.filename;
        await link.save();

        res.json({ success: true, message: 'Đã cập nhật!', link });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Xóa sản phẩm
const deleteShopeeLink = async (req, res) => {
    try {
        const result = await ShopeeLink.deleteOne({ _id: req.params.id, userId: req.user._id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        res.json({ success: true, message: 'Đã xóa sản phẩm' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Lấy danh sách (JSON)
const getShopeeLinksAPI = async (req, res) => {
    try {
        const { search, status, platform } = req.query;
        const filter = { userId: req.user._id };
        if (search) filter.title = { $regex: search, $options: 'i' };
        if (platform && platform !== 'ALL') filter.platform = platform;
        const links = await ShopeeLink.find(filter).sort({ createdAt: -1 }).lean();

        const usedIds = new Set();
        const posts = await SchedulePost.find({ userId: req.user._id, 'shopeeLinks.0': { $exists: true } }, 'shopeeLinks').lean();
        posts.forEach(s => (s.shopeeLinks || []).forEach(id => usedIds.add(String(id))));
        const enriched = links.map(l => ({ ...l, status: usedIds.has(String(l._id)) ? 'attached' : 'pending' }));

        const filtered = status && status !== 'ALL'
            ? enriched.filter(l => l.status === status.toLowerCase())
            : enriched;
        res.json({ success: true, links: filtered });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { showShopeeLinks, createShopeeLink, updateShopeeLink, deleteShopeeLink, getShopeeLinksAPI, PLATFORM_META };
