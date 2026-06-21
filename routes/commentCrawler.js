// routes/commentCrawler.js - Routes cho tính năng FB Comment Crawler
// Mount tại /tracking/comments (gắn vào menu Tracking trong sidebar)
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/commentCrawlerController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.use(requireAuth);

// Trang chính
router.get('/', ctrl.showCommentCrawler);

// API
router.post('/api/scrape', ctrl.startScrape);
router.get('/api/list', ctrl.listScrapes);
router.get('/api/job/:id', ctrl.getJob);
router.get('/api/job/:id/export', ctrl.exportJob);
router.delete('/api/job/:id', ctrl.deleteJob);

module.exports = router;
