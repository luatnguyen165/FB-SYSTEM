// routes/commentPlay.js
const express = require('express');
const router = express.Router();
const { requireAuth: isAuthenticated } = require('../middlewares/authMiddleware');
const ctrl = require('../controllers/commentPlayController');

// Page
router.get('/', isAuthenticated, ctrl.showCommentPlays);

// CRUD API
router.post('/api/create', isAuthenticated, ctrl.createPlay);
router.put('/api/:playId/update', isAuthenticated, ctrl.updatePlay);
router.delete('/api/:playId', isAuthenticated, ctrl.deletePlay);
router.post('/api/:playId/toggle', isAuthenticated, ctrl.togglePlay);
router.post('/api/:playId/run', isAuthenticated, ctrl.runAutoCommentPlay);

// Logs
router.get('/api/:playId/logs', isAuthenticated, ctrl.getPlayLogs);
router.get('/api/:playId/logs-summary', isAuthenticated, ctrl.getPlayLogsSummary);

module.exports = router;