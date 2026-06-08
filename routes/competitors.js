// routes/competitors.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const competitorController = require('../controllers/competitorController');

// Trang hiển thị
router.get('/', requireAuth, competitorController.showCompetitors);

// API endpoints
router.get('/api/list', requireAuth, competitorController.getCompetitorsAPI);
router.get('/api/stats', requireAuth, competitorController.getStatsAPI);
router.post('/api/create', requireAuth, competitorController.createCompetitor);
router.patch('/api/:id/update', requireAuth, competitorController.updateCompetitor);
router.delete('/api/:id', requireAuth, competitorController.deleteCompetitor);
 router.patch('/api/:id/toggle', requireAuth, competitorController.toggleCompetitor);
 router.get('/api/:id/status', requireAuth, competitorController.getStatusAPI);
 router.post('/api/:id/scrape', requireAuth, competitorController.scrapeCompetitor);
router.post('/api/compare', requireAuth, competitorController.compareCompetitors);

 // Posts API
 router.get('/api/posts/all', requireAuth, competitorController.getAllPostsAPI);
 router.get('/api/:id/posts', requireAuth, competitorController.getPostsAPI);
 router.post('/api/:id/posts', requireAuth, competitorController.addPost);
 router.patch('/api/posts/:postId', requireAuth, competitorController.updatePost);
 router.delete('/api/posts/:postId', requireAuth, competitorController.deletePost);

// Follower trend
router.get('/api/:id/trend', requireAuth, competitorController.getFollowerTrend);

module.exports = router;