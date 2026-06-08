const express = require('express');
const router = express.Router();
const licenseController = require('../controllers/licenseController');
const { requireAuth, requireAdmin } = require('../middlewares/authMiddleware');

// ======== API ROUTES (JSON) ========

// Activate license key (gọi khi đăng ký / nhập key)
router.post('/api/activate', licenseController.activateKey);

// Check license status (gọi khi login)
router.get('/api/check', requireAuth, licenseController.checkLicense);

// ======== ADMIN ROUTES (Yêu cầu admin) ========

// List all licenses
router.get('/', requireAuth, requireAdmin, licenseController.listLicenses);

// Generate new keys
router.post('/generate', requireAuth, requireAdmin, licenseController.generateKeys);

// Toggle suspend/unsuspend
router.post('/:id/toggle', requireAuth, requireAdmin, licenseController.toggleLicenseStatus);

// Extend license
router.post('/:id/extend', requireAuth, requireAdmin, licenseController.extendLicense);

// Delete license
router.delete('/:id', requireAuth, requireAdmin, licenseController.deleteLicense);

module.exports = router;