// routes/videoDubbing.js
// REST API — Video Dubbing
//
// Auth: Session cookie (internal) hoặc X-API-Key header (external)
// Base: /api/dubbing
//
// Endpoints:
//   GET    /api/dubbing/health              Health check (public)
//   GET    /api/dubbing/languages           Danh sách ngôn ngữ hỗ trợ
//   GET    /api/dubbing/voices/:lang        Danh sách giọng cho ngôn ngữ
//   POST   /api/dubbing/jobs                Tạo job dubbing mới
//   GET    /api/dubbing/jobs                Danh sách jobs
//   GET    /api/dubbing/jobs/:jobId         Chi tiết job
//   GET    /api/dubbing/jobs/:jobId/progress SSE progress stream
//   GET    /api/dubbing/jobs/:jobId/download Download video kết quả
//   GET    /api/dubbing/jobs/:jobId/srt      Download SRT đã dịch
//   DELETE /api/dubbing/jobs/:jobId          Xóa job

const express = require('express');
const router = express.Router();
const { requireApiAuth } = require('../middlewares/apiAuthMiddleware');
const ctrl = require('../controllers/videoDubbingController');

// Health check — không cần auth
router.get('/health', ctrl.healthCheck);

// Public endpoints (ít nhất auth)
router.get('/languages', requireApiAuth, ctrl.getLanguages);
router.get('/voices/:lang', requireApiAuth, ctrl.getVoices);

// Jobs CRUD
router.post('/jobs', requireApiAuth, ctrl.createDubbingJob);
router.get('/jobs', requireApiAuth, ctrl.listJobs);
router.get('/jobs/:jobId', requireApiAuth, ctrl.getJobDetail);

// Progress SSE
router.get('/jobs/:jobId/progress', requireApiAuth, ctrl.getProgress);

// Download
router.get('/jobs/:jobId/download', requireApiAuth, ctrl.downloadResult);
router.get('/jobs/:jobId/srt', requireApiAuth, ctrl.downloadSrt);

// Delete
router.delete('/jobs/:jobId', requireApiAuth, ctrl.removeJob);

module.exports = router;
