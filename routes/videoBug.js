// routes/videoBug.js
const express = require('express');
const router = express.Router();
const videoBugController = require('../controllers/videoBugController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.use(requireAuth);

// Page
router.get('/', videoBugController.showPage);

// API
router.post('/api/embed', videoBugController.embedBug);
router.post('/api/verify/:id', videoBugController.verifyVideo);
router.post('/api/extract', videoBugController.extractBug);
router.get('/api/detail/:id', videoBugController.getBugDetail);
router.delete('/api/delete/:id', videoBugController.deleteBug);

module.exports = router;
