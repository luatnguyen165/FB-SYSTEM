// routes/aiImages.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middlewares/authMiddleware');
const { uploadImage } = require('../middlewares/uploadMiddleware');
const controller = require('../controllers/aiImageController');

// Trang hiển thị danh sách projects
router.get('/', requireAuth, controller.showProjects);

// API: Tạo project mới
router.post('/api/project', requireAuth, controller.createProject);

// API: Upload ảnh + lưu prompt
router.post('/api/project/:projectId/upload', requireAuth, uploadImage.single('image'), controller.uploadAndSave);

// API: Lấy trạng thái project
router.get('/api/project/:projectId/status', requireAuth, controller.getProjectStatus);

// API: Cập nhật tên project
router.put('/api/project/:projectId/name', requireAuth, controller.updateProjectName);

// API: Toggle yêu thích
router.post('/api/project/:projectId/favorite', requireAuth, controller.toggleFavorite);

// API: Cập nhật prompt entry
router.put('/api/project/:projectId/entry/:entryId', requireAuth, controller.updateEntryPrompt);

// API: Xóa entry
router.delete('/api/project/:projectId/entry/:entryId', requireAuth, controller.deleteEntry);

// API: Xóa project
router.delete('/api/project/:projectId', requireAuth, controller.deleteProject);

module.exports = router;