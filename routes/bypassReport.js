// routes/bypassReport.js
const express = require('express');
const router = express.Router();
const { showReport } = require('../controllers/bypassReportController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.use(requireAuth);
router.get('/', showReport);

module.exports = router;
