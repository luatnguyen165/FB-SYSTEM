// routes/dashboard.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const dashboardController = require('../controllers/dashboardController');

router.get('/', requireAuth, dashboardController.showDashboard);

module.exports = router;
