// routes/aiContent.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/aiContentController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Page
router.get('/', requireAuth, ctrl.renderPage);

// Writing Styles API
router.post('/api/styles', requireAuth, ctrl.createStyle);
router.post('/api/styles/:id/analyze', requireAuth, ctrl.analyzeStyle);
router.put('/api/styles/:id', requireAuth, ctrl.updateStyle);
router.delete('/api/styles/:id', requireAuth, ctrl.deleteStyle);

// Schedules API
router.post('/api/schedules', requireAuth, ctrl.createSchedule);
router.put('/api/schedules/:id', requireAuth, ctrl.updateSchedule);
router.delete('/api/schedules/:id', requireAuth, ctrl.deleteSchedule);
router.post('/api/schedules/:id/generate', requireAuth, ctrl.generateNow);

// Posts API
router.get('/api/posts', requireAuth, ctrl.getPosts);
router.put('/api/posts/:id', requireAuth, ctrl.updatePost);
router.delete('/api/posts/:id', requireAuth, ctrl.deletePost);
router.post('/api/posts/:id/publish', requireAuth, ctrl.publishPost);

// Products API
router.get('/api/products', requireAuth, ctrl.getProducts);
router.get('/api/products/:id', requireAuth, ctrl.getProduct);
router.post('/api/products', requireAuth, ctrl.createProduct);
router.put('/api/products/:id', requireAuth, ctrl.updateProduct);
router.delete('/api/products/:id', requireAuth, ctrl.deleteProduct);
router.post('/api/products/:id/analyze', requireAuth, ctrl.analyzeProduct);

// Generate Topics
router.post('/api/generate-topics', requireAuth, ctrl.generateTopics);

// Training
router.post('/api/styles/:id/retrain', requireAuth, ctrl.retrainStyle);
router.get('/api/styles/:id/training-stats', requireAuth, ctrl.getTrainingStats);

// Settings
router.post('/api/settings/openai-key', requireAuth, ctrl.saveApiKey);
router.get('/api/settings/openai-key', requireAuth, ctrl.checkApiKey);

// Dashboard
router.get('/api/stats', requireAuth, ctrl.getStats);

module.exports = router;