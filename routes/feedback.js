// routes/feedback.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/feedbackController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Page
router.get('/', requireAuth, ctrl.renderPage);

// User API
router.post('/api/create', requireAuth, ctrl.createFeedback);
router.put('/api/update/:id', requireAuth, ctrl.updateFeedback);
router.get('/api/get/:id', requireAuth, ctrl.getFeedback);
router.delete('/api/delete/:id', requireAuth, ctrl.deleteFeedback);

// Admin API
router.get('/api/admin', requireAuth, ctrl.getAllFeedback);
router.put('/api/admin/:id', requireAuth, ctrl.adminUpdateFeedback);

module.exports = router;
