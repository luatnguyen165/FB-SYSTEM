const express = require('express');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { uploadImage } = require('../middlewares/uploadMiddleware');

const SERVER_ADMIN_URL = process.env.SERVER_ADMIN_URL || 'http://localhost:5000';

const register = async (req, res) => {
    console.log('--- [Register Request] ---');
    try {
        const { username, email, password } = req.body;
        console.log('Data received:', { username, email });

        if (!username || !email || !password) {
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Vui lòng điền đủ thông tin!' };
                req.session.save();
            }
            return res.redirect('/register');
        }

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            console.log('Register failed:', data.message);
            if (req.session) {
                req.session.flash = { type: 'error', message: data.message || 'Đăng ký thất bại!' };
                req.session.save();
            }
            return res.redirect('/register');
        }

        console.log('User registered successfully via ServerAdmin');
        if (req.session) {
            req.session.flash = { type: 'success', message: 'Đăng ký thành công! Hãy đăng nhập.' };
            req.session.save();
        }
        res.redirect('/login');
    } catch (error) {
        console.error('--- [Register Error] ---', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi kết nối ServerAdmin: ' + error.message };
            req.session.save();
        }
        res.redirect('/register');
    }
};

const login = async (req, res) => {
    console.log('--- [Login Request] ---');
    try {
        const { email, password, deviceId } = req.body;
        console.log('Attempting login for:', email);

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, deviceId, platform: req.body.platform })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            console.log('Login failed:', data.message);
            if (req.session) {
                req.session.flash = { type: 'error', message: data.message || 'Đăng nhập thất bại!' };
                req.session.save();
            }
            return res.redirect('/login');
        }

        console.log('Login successful via ServerAdmin for ID:', data.user._id);
        req.session.userId = data.user._id;
        req.session.user = data.user;
        res.cookie('remember_token', String(data.user._id), {
            maxAge: 1000 * 60 * 60 * 24 * 30,
            httpOnly: true,
            sameSite: 'lax'
        });

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ message: "Lỗi lưu phiên đăng nhập!" });
            }
            res.redirect('/dashboard');
        });
        return;
    } catch (error) {
        console.error('--- [Login Error] ---', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi kết nối ServerAdmin: ' + error.message };
            req.session.save();
        }
        res.redirect('/login');
    }
};

const logout = async (req, res) => {
    try {
        res.clearCookie('remember_token');
        req.session.destroy(() => {
            res.redirect('/login');
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.clearCookie('remember_token');
        res.redirect('/login');
    }
};

const forgotPassword = async (req, res) => {
    console.log('--- [Forgot Password Request] ---');
    const { email } = req.body;
    try {
        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            console.log('Forgot Password failed:', data.message);
            if (req.session) {
                req.session.flash = { type: 'error', message: data.message || 'Lỗi khôi phục mật khẩu!' };
                req.session.save();
            }
            return res.redirect('/forgot-password');
        }

        console.log('Reset URL generated via ServerAdmin:', data.resetUrl);
        if (req.session) {
            req.session.flash = { type: 'success', message: 'Link khôi phục đã được tạo! Hãy kiểm tra email.' };
            req.session.save();
        }
        res.redirect('/login');
    } catch (error) {
        console.error('--- [Forgot Password Error] ---', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi kết nối ServerAdmin: ' + error.message };
            req.session.save();
        }
        res.redirect('/forgot-password');
    }
};

const resetPassword = async (req, res) => {
    console.log('--- [Reset Password Request] ---');
    try {
        console.log('Token provided:', req.params.token);

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: req.params.token, newPassword: req.body.newPassword })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            console.log('Reset Password failed:', data.message);
            if (req.session) {
                req.session.flash = { type: 'error', message: data.message || 'Token hết hạn hoặc không hợp lệ!' };
                req.session.save();
            }
            return res.redirect('/forgot-password');
        }

        console.log('Password reset successfully via ServerAdmin');
        if (req.session) {
            req.session.flash = { type: 'success', message: 'Đặt lại mật khẩu thành công!' };
            req.session.save();
        }
        res.redirect('/login');
    } catch (error) {
        console.error('--- [Reset Password Error] ---', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi kết nối ServerAdmin: ' + error.message };
            req.session.save();
        }
        res.redirect('/forgot-password');
    }
};

const showChangePassword = (req, res) => {
    res.render('change-password', { user: req.user });
};

const changePassword = async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) {
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Mật khẩu mới không khớp!' };
            req.session.save();
        }
        return res.redirect('/change-password');
    }
    try {
        console.info(`User ${req.session.userId} is attempting to change password.`);

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/change-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: req.session.userId, currentPassword, newPassword })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            if (req.session) {
                req.session.flash = { type: 'error', message: data.message || 'Đổi mật khẩu thất bại!' };
                req.session.save();
            }
            return res.redirect('/change-password');
        }

        if (req.session) {
            req.session.flash = { type: 'success', message: 'Đổi mật khẩu thành công!' };
            req.session.save();
        }
        res.redirect('/profile');
    } catch (error) {
        console.error('Change Password Error', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi kết nối ServerAdmin!' };
            req.session.save();
        }
        res.redirect('/change-password');
    }
};

const showProfile = async (req, res) => {
    try {
        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/profile/${req.session.userId}`);
        const data = await response.json();

        if (!response.ok || !data.success) {
            return res.redirect('/login');
        }
        res.render('profile', { user: data.user });
    } catch (error) {
        console.error('Show Profile Error', error);
        res.status(500).json({ message: "Lỗi server!" });
    }
};

const updateProfile = async (req, res) => {
    const { username, phoneNumber } = req.body;
    try {
        const updateData = {};
        if (username) updateData.username = username;
        if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;

        if (req.file) {
            updateData.avatarUrl = `/uploads/images/${req.file.filename}`;
        }

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/profile/${req.session.userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            if (req.session) {
                req.session.flash = { type: 'error', message: data.message || 'Cập nhật thất bại!' };
                req.session.save();
            }
            return res.redirect('/profile');
        }

        if (req.session) {
            req.session.flash = { type: 'success', message: 'Cập nhật hồ sơ thành công!' };
            req.session.save();
        }
        res.redirect('/profile');
    } catch (error) {
        console.error('Update Profile Error', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi server!' };
            req.session.save();
        }
        res.redirect('/profile');
    }
};

const updateProfileUpload = [uploadImage.single('avatar'), updateProfile];

const updateLanguage = async (req, res) => {
    try {
        const { language } = req.body;
        if (!['vi', 'en'].includes(language)) {
            return res.status(400).json({ success: false, message: 'Invalid language' });
        }

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/profile/${req.session.userId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (req.session && req.session.user) {
            req.session.user.language = language;
        }
        return res.json({ success: true, message: 'Language updated', language });
    } catch (error) {
        console.error('Update Language Error', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Register or update device for current user
 * Called from frontend after login to track which device the user is using
 */
const registerDevice = async (req, res) => {
    try {
        const userId = req.body.userId || req.session?.userId;
        const { deviceId } = req.body;

        if (!userId || !deviceId) {
            return res.status(400).json({ success: false, message: 'Missing userId or deviceId' });
        }

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/device`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, deviceId, platform: req.body.platform })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            return res.status(400).json({ success: false, message: data.message || 'Device registration failed' });
        }

        console.log(`[Device] Registered device ${deviceId.substring(0, 12)}... for user ${userId}`);
        return res.json({
            success: true,
            message: 'Device registered',
            deviceCount: data.deviceCount
        });
    } catch (error) {
        console.error('[Device] Register error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = { register, login, forgotPassword, resetPassword, showChangePassword, changePassword, showProfile, updateProfile: updateProfileUpload, logout, updateLanguage, registerDevice };