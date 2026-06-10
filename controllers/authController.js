const express = require('express');
const User = require('../models/User'); 
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { hashPassword, comparePassword } = require('../utils/authUtils');
const nodemailer = require('nodemailer');
const crypto = require('crypto'); // Nhớ import crypto ở đây nhé
const { uploadImage } = require('../middlewares/uploadMiddleware');

const register = async (req, res) => {
    console.log('--- [Register Request] ---');
    try {
        const { username, email, password } = req.body;
        console.log('Data received:', { username, email });

        if (!username || !email || !password) {
            console.log('Validation failed: Missing fields');
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Vui lòng điền đủ thông tin!' };
                req.session.save();
            }
            return res.redirect('/auth/register');
        }

        const userExists = await User.findOne({ email });
        if (userExists) {
            console.log('Validation failed: Email already exists');
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Email đã tồn tại!' };
                req.session.save();
            }
            return res.redirect('/auth/register');
        }

        // Tạo user
        const user = await User.create({ username, email, password: await hashPassword(password) });
        console.log('User created successfully, ID:', user._id);

        if (req.session) {
            req.session.flash = { type: 'success', message: 'Đăng ký thành công! Hãy đăng nhập.' };
            req.session.save();
        }
        res.redirect('/auth/login');
    } catch (error) {
        console.error('--- [Register Error] ---', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi Server: ' + error.message };
            req.session.save();
        }
        res.redirect('/auth/register');
    }
};

const login = async (req, res) => {
    console.log('--- [Login Request] ---');
    try {
        const { email, password, deviceId } = req.body;
        console.log('Attempting login for:', email);

        const user = await User.findOne({ email }).exec();
        if (!user) {
            console.log('Login failed: Email not found');
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Email không tồn tại!' };
                req.session.save();
            }
            return res.redirect('/auth/login');
        }

        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) {
            console.log('Login failed: Incorrect password');
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Sai mật khẩu!' };
                req.session.save();
            }
            return res.redirect('/auth/login');
        }

        // Save deviceId if provided from login form
        if (deviceId && user._id) {
            const existingDevice = user.devices.find(d => d.deviceId === deviceId);
            if (existingDevice) {
                existingDevice.lastLogin = new Date();
                existingDevice.userAgent = req.headers['user-agent'] || '';
                existingDevice.platform = req.body.platform || '';
                existingDevice.ipAddress = req.ip || '';
            } else {
                user.devices.push({
                    deviceId,
                    userAgent: req.headers['user-agent'] || '',
                    platform: req.body.platform || '',
                    lastLogin: new Date(),
                    isActive: true,
                    ipAddress: req.ip || ''
                });
            }
            await user.save();
            console.log(`[Device] Saved deviceId for user ${user._id}`);
        }

        console.log('Login successful for ID:', user._id);
        req.session.userId = user._id;
        res.cookie('remember_token', String(user._id), {
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
            req.session.flash = { type: 'error', message: 'Lỗi Server: ' + error.message };
            req.session.save();
        }
        res.redirect('/auth/login');
    }
};

const logout = async (req, res) => {
    try {
        res.clearCookie('remember_token');
        req.session.destroy(() => {
            res.redirect('/auth/login');
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.clearCookie('remember_token');
        res.redirect('/auth/login');
    }
};

const forgotPassword = async (req, res) => {
    console.log('--- [Forgot Password Request] ---');
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            console.log('Forgot Password failed: Email not found');
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Email không tồn tại!' };
                req.session.save();
            }
            return res.redirect('/auth/forgot-password');
        }

        const resetToken = crypto.randomUUID();
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
        await user.save();

        const resetUrl = `http://localhost:5000/auth/reset-password/${resetToken}`;
        console.log('Generated Reset URL:', resetUrl);

        if (req.session) {
            req.session.flash = { type: 'success', message: 'Link khôi phục đã được tạo! Hãy kiểm tra email.' };
            req.session.save();
        }
        res.redirect('/auth/login');
    } catch (error) {
        console.error('--- [Forgot Password Error] ---', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi Server: ' + error.message };
            req.session.save();
        }
        res.redirect('/auth/forgot-password');
    }
};

const resetPassword = async (req, res) => {
    console.log('--- [Reset Password Request] ---');
    try {
        console.log('Token provided:', req.params.token);
        
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            console.log('Reset Password failed: Invalid or expired token');
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Token hết hạn hoặc không hợp lệ!' };
                req.session.save();
            }
            return res.redirect('/auth/forgot-password');
        }

        user.password = req.body.newPassword; 
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        
        console.log('Password updated successfully for ID:', user._id);
        if (req.session) {
            req.session.flash = { type: 'success', message: 'Đặt lại mật khẩu thành công!' };
            req.session.save();
        }
        res.redirect('/auth/login');
    } catch (error) {
        console.error('--- [Reset Password Error] ---', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi Server: ' + error.message };
            req.session.save();
        }
        res.redirect('/auth/forgot-password');
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
        return res.redirect('/auth/change-password');
    }
    try {
        console.info(`User ${req.session.userId} is attempting to change password.`);
        const user = await User.findById(req.session.userId);
        if (!user) {
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Người dùng không tồn tại!' };
                req.session.save();
            }
            return res.redirect('/auth/login');
        }
        const isMatch = await comparePassword(currentPassword, user.password);
        if (!isMatch) {
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Mật khẩu hiện tại không đúng!' };
                req.session.save();
            }
            return res.redirect('/auth/change-password');
        }
        user.password = await hashPassword(newPassword);
        await user.save();
        if (req.session) {
            req.session.flash = { type: 'success', message: 'Đổi mật khẩu thành công!' };
            req.session.save();
        }
        res.redirect('/auth/profile');
    } catch (error) {
        console.error('Change Password Error', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi server!' };
            req.session.save();
        }
        res.redirect('/auth/change-password');
    }
};

const showProfile = async (req, res) => {
    try {
        const user = await User.findById(req.session.userId).lean();
        if (!user) {
            return res.redirect('/auth/login');
        }
        res.render('profile', { user });
    } catch (error) {
        console.error('Show Profile Error', error);
        res.status(500).json({ message: "Lỗi server!" });
    }
};

const updateProfile = async (req, res) => {
    const { username, phoneNumber } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (!user) {
            if (req.session) {
                req.session.flash = { type: 'error', message: 'Người dùng không tồn tại!' };
                req.session.save();
            }
            return res.redirect('/auth/login');
        }
        user.username = username;
        user.phoneNumber = phoneNumber;

        if (req.file) {
            user.avatarUrl = `/uploads/images/${req.file.filename}`;
        }

        await user.save();
        if (req.session) {
            req.session.flash = { type: 'success', message: 'Cập nhật hồ sơ thành công!' };
            req.session.save();
        }
        res.redirect('/auth/profile');
    } catch (error) {
        console.error('Update Profile Error', error);
        if (req.session) {
            req.session.flash = { type: 'error', message: 'Lỗi server!' };
            req.session.save();
        }
        res.redirect('/auth/profile');
    }
};

const updateProfileUpload = [uploadImage.single('avatar'), updateProfile];

const updateLanguage = async (req, res) => {
    try {
        const { language } = req.body;
        if (!['vi', 'en'].includes(language)) {
            return res.status(400).json({ success: false, message: 'Invalid language' });
        }
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        user.language = language;
        await user.save();
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

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Check if this device already registered
        const existingDevice = user.devices.find(d => d.deviceId === deviceId);

        if (existingDevice) {
            // Update last login time
            existingDevice.lastLogin = new Date();
            existingDevice.userAgent = req.headers['user-agent'] || '';
            existingDevice.platform = req.body.platform || '';
            existingDevice.ipAddress = req.ip || req.connection?.remoteAddress || '';
        } else {
            // Add new device
            user.devices.push({
                deviceId,
                userAgent: req.headers['user-agent'] || '',
                platform: req.body.platform || '',
                lastLogin: new Date(),
                isActive: true,
                ipAddress: req.ip || req.connection?.remoteAddress || ''
            });
        }

        await user.save();
        console.log(`[Device] Registered device ${deviceId.substring(0, 12)}... for user ${userId}`);

        return res.json({
            success: true,
            message: 'Device registered',
            deviceCount: user.devices.length
        });
    } catch (error) {
        console.error('[Device] Register error:', error);
        return res.status(500).json({ success: false, message: 'Server error' });
    }
};

module.exports = { register, login, forgotPassword, resetPassword, showChangePassword, changePassword, showProfile, updateProfile: updateProfileUpload, logout, updateLanguage, registerDevice };
