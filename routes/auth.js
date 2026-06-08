// routes/auth.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');

// === PUBLIC ROUTES (Không cần đăng nhập) ===
router.get('/register', (req, res) => res.render('register'));
router.post('/register', authController.register);

router.get('/login', (req, res) => res.render('login'));
router.post('/login', authController.login);

router.get('/forgot-password', (req, res) => res.render('forgot'));
router.post('/forgot-password', authController.forgotPassword);

router.get('/reset-password/:token', (req, res) => res.render('reset-password', { token: req.params.token }));
router.post('/reset-password/:token', authController.resetPassword);

// === PROTECTED ROUTES (Yêu cầu đăng nhập) ===
// Redirect cũ để tương thích (giữ /auth/dashboard -> /dashboard)
router.get('/dashboard', requireAuth, (req, res) => res.redirect('/dashboard'));

// Profile
router.get('/profile', requireAuth, authController.showProfile);
router.post('/profile', requireAuth, authController.updateProfile);

// Change Password
router.get('/change-password', requireAuth, authController.showChangePassword);
router.post('/change-password', requireAuth, authController.changePassword);

// Logout
router.get('/logout', authController.logout);

// === API: Update language ===
router.post('/api/language', requireAuth, authController.updateLanguage);

// === API: Register device (public - called from login page) ===
router.post('/api/device', authController.registerDevice);

// === API: Get user devices ===
router.get('/api/devices', requireAuth, async (req, res) => {
    try {
        const User = require('../models/User');
        const user = await User.findById(req.session.userId).select('devices username email').lean();
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({
            success: true,
            devices: user.devices || [],
            totalDevices: (user.devices || []).length
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════
//  GUI API ROUTES (JSON) - For Python PySide GUI
// ═══════════════════════════════════════════════════════════════

// GUI Login - returns JSON
router.post('/api/gui/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email }).exec();
        if (!user) {
            return res.json({ success: false, message: 'Email không tồn tại!' });
        }
        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            return res.json({ success: false, message: 'Sai mật khẩu!' });
        }
        req.session.userId = user._id;
        req.session.save(() => {
            res.json({
                success: true,
                message: 'Đăng nhập thành công!',
                userId: String(user._id),
                username: user.username,
                email: user.email,
            });
        });
    } catch (error) {
        console.error('[GUI Login Error]', error);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
});

// GUI Register - returns JSON
router.post('/api/gui/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.json({ success: false, message: 'Vui lòng điền đủ thông tin!' });
        }
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.json({ success: false, message: 'Email đã tồn tại!' });
        }
        await User.create({ username, email, password: await hashPassword(password) });
        res.json({ success: true, message: 'Đăng ký thành công!' });
    } catch (error) {
        console.error('[GUI Register Error]', error);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
});

// GUI Forgot Password - returns JSON
router.post('/api/gui/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.json({ success: false, message: 'Email không tồn tại!' });
        }
        const crypto = require('crypto');
        const resetToken = crypto.randomUUID();
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
        await user.save();
        const resetUrl = `http://localhost:5000/auth/reset-password/${resetToken}`;
        console.log(`[GUI Forgot] Reset URL for ${email}: ${resetUrl}`);
        res.json({ success: true, message: 'Link khôi phục đã được gửi!', resetToken });
    } catch (error) {
        console.error('[GUI Forgot Error]', error);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
});

// GUI Reset Password - returns JSON
router.post('/api/gui/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        });
        if (!user) {
            return res.json({ success: false, message: 'Token hết hạn hoặc không hợp lệ!' });
        }
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.json({ success: false, message: 'Mật khẩu phải có ít nhất 6 ký tự!' });
        }
        user.password = await hashPassword(newPassword);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.json({ success: true, message: 'Đặt lại mật khẩu thành công!' });
    } catch (error) {
        console.error('[GUI Reset Error]', error);
        res.status(500).json({ success: false, message: 'Lỗi server!' });
    }
});

// GUI Logout
router.get('/api/gui/logout', (req, res) => {
    res.clearCookie('remember_token');
    req.session.destroy(() => {
        res.json({ success: true, message: 'Đã đăng xuất!' });
    });
});

// GUI Check session
router.get('/api/gui/me', requireAuth, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).select('username email role language').lean();
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
