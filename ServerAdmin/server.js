/**
 * ServerAdmin - Quản lý tài khoản người dùng
 * Chạy trên port 5000
 */
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const bcrypt = require('bcryptjs');
const session = require('express-session');

// User Schema (mirror from main app)
const DeviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    userAgent: { type: String, default: '' },
    platform: { type: String, default: '' },
    lastLogin: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    ipAddress: { type: String, default: '' }
}, { _id: false });

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true,unique: false },
    email: { type: String, required: true, unique: true },
    phoneNumber: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    password: { type: String, required: true },
    role: { type: String, default: 'user', enum: ['user', 'admin'] },
    devices: { type: [DeviceSchema], default: [] },
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    language: { type: String, enum: ['vi', 'en'], default: 'vi' },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// Drop unique index on username if exists (allow duplicate usernames)
User.collection.dropIndex('username_1').catch(() => {});

// FeatureVisibility Schema (mirror from main app - full list)
const FeatureVisibilitySchema = new mongoose.Schema({
    dashboard: { type: Boolean, default: true },
    channels: { type: Boolean, default: true },
    storage: { type: Boolean, default: true },
    storeVideo: { type: Boolean, default: true },
    shopeeLink: { type: Boolean, default: true },
    'schedule-manager': { type: Boolean, default: true },
    'schedule-post': { type: Boolean, default: true },
    'schedule-reels': { type: Boolean, default: true },
    'schedule-archive': { type: Boolean, default: true },
    'schedule-groups': { type: Boolean, default: true },
    'ai-scan': { type: Boolean, default: true },
    'ai-comments': { type: Boolean, default: true },
    'comment-play': { type: Boolean, default: true },
    'ai-reply-messenger': { type: Boolean, default: true },
    'competitors': { type: Boolean, default: true },
    'trend-music': { type: Boolean, default: true },
    profile: { type: Boolean, default: true },
    settings: { type: Boolean, default: true },
    'analytics': { type: Boolean, default: true },
    'hashtag-manager': { type: Boolean, default: true },
    'telegram-notifications': { type: Boolean, default: true },
}, { timestamps: true });

const FeatureVisibility = mongoose.model('FeatureVisibility', FeatureVisibilitySchema);

const app = express();
const PORT = process.env.ADMIN_PORT || 5000;
const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/reelsflow';

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'admin-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24, // 24 hours
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Auth middleware
function requireAdmin(req, res, next) {
    if (req.session && req.session.adminId) {
        return next();
    }
    if (req.xhr || req.headers.accept?.includes('application/json') || req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Chưa đăng nhập' });
    }
    return res.redirect('/login');
}

// ========================
// PUBLIC AUTH API (called by FB-SYSTEM)
// ========================

// POST /api/auth/register - Đăng ký user mới
app.post('/api/auth/register', async (req, res) => {
    console.log('[ServerAdmin] Register request:', req.body);
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng điền đủ thông tin!' });
        }
        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Email đã tồn tại!' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword, role: 'user' });
        await user.save();
        console.log('[ServerAdmin] User registered:', user._id);
        res.status(201).json({ success: true, message: 'Đăng ký thành công!' });
    } catch (err) {
        console.error('[ServerAdmin] Register error:', err);
        res.status(500).json({ success: false, message: 'Lỗi Server: ' + err.message });
    }
});

// POST /api/auth/login - Đăng nhập
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password, deviceId } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập email và mật khẩu!' });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Email không tồn tại!' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Sai mật khẩu!' });
        }
        if (deviceId) {
            const existingDevice = user.devices.find(d => d.deviceId === deviceId);
            if (existingDevice) {
                existingDevice.lastLogin = new Date();
                existingDevice.userAgent = req.headers['user-agent'] || '';
                existingDevice.platform = req.body.platform || '';
                existingDevice.ipAddress = req.ip || '';
            } else {
                user.devices.push({ deviceId, userAgent: req.headers['user-agent'] || '', platform: req.body.platform || '', lastLogin: new Date(), isActive: true, ipAddress: req.ip || '' });
            }
            await user.save();
        }
        console.log('[ServerAdmin] User logged in:', user._id);
        res.json({ success: true, message: 'Đăng nhập thành công!', user: { _id: user._id, username: user.username, email: user.email, role: user.role, avatarUrl: user.avatarUrl, phoneNumber: user.phoneNumber, language: user.language, createdAt: user.createdAt } });
    } catch (err) {
        console.error('[ServerAdmin] Login error:', err);
        res.status(500).json({ success: false, message: 'Lỗi Server: ' + err.message });
    }
});

// POST /api/auth/forgot-password, POST /api/auth/reset-password, PUT /api/auth/change-password, GET/PUT /api/auth/profile/:id, POST /api/auth/device
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, message: 'Vui lòng nhập email!' });
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ success: false, message: 'Email không tồn tại!' });
        const crypto = require('crypto');
        const resetToken = crypto.randomUUID();
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
        await user.save();
        const resetUrl = `http://localhost:4000/auth/reset-password/${resetToken}`;
        console.log('[ServerAdmin] Reset URL:', resetUrl);
        res.json({ success: true, message: 'Link khôi phục đã được tạo!', resetUrl });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi Server: ' + err.message });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Thiếu token hoặc mật khẩu mới!' });
        const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) return res.status(400).json({ success: false, message: 'Token hết hạn hoặc không hợp lệ!' });
        user.password = await bcrypt.hash(newPassword, 10);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();
        res.json({ success: true, message: 'Đặt lại mật khẩu thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi Server: ' + err.message });
    }
});

app.put('/api/auth/change-password', async (req, res) => {
    try {
        const { userId, currentPassword, newPassword } = req.body;
        if (!userId || !currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Thiếu thông tin!' });
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Người dùng không tồn tại!' });
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Mật khẩu hiện tại không đúng!' });
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi Server: ' + err.message });
    }
});

app.get('/api/auth/profile/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -resetPasswordToken -resetPasswordExpires');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/auth/profile/:id', async (req, res) => {
    try {
        const { username, phoneNumber, avatarUrl, language } = req.body;
        const updateData = {};
        if (username) updateData.username = username;
        if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
        if (avatarUrl) updateData.avatarUrl = avatarUrl;
        if (language) updateData.language = language;
        const user = await User.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true, runValidators: true }).select('-password');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/auth/device', async (req, res) => {
    try {
        const { userId, deviceId, platform } = req.body;
        if (!userId || !deviceId) return res.status(400).json({ success: false, message: 'Missing userId or deviceId' });
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const existingDevice = user.devices.find(d => d.deviceId === deviceId);
        if (existingDevice) {
            existingDevice.lastLogin = new Date();
            existingDevice.userAgent = req.headers['user-agent'] || '';
            existingDevice.platform = platform || '';
            existingDevice.ipAddress = req.ip || '';
        } else {
            user.devices.push({ deviceId, userAgent: req.headers['user-agent'] || '', platform: platform || '', lastLogin: new Date(), isActive: true, ipAddress: req.ip || '' });
        }
        await user.save();
        res.json({ success: true, deviceCount: user.devices.length });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ========================
// AUTH ROUTES (Admin login for ServerAdmin panel)
// ========================
app.get('/login', (req, res) => {
    if (req.session && req.session.adminId) return res.redirect('/');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.render('login', { error: 'Vui lòng nhập email và mật khẩu' });
        const user = await User.findOne({ email });
        if (!user) return res.render('login', { error: 'Email hoặc mật khẩu không đúng' });
        if (user.role !== 'admin') return res.render('login', { error: 'Tài khoản không có quyền admin' });
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.render('login', { error: 'Email hoặc mật khẩu không đúng' });
        req.session.adminId = user._id;
        req.session.adminName = user.username;
        req.session.adminEmail = user.email;
        res.redirect('/');
    } catch (err) {
        res.render('login', { error: 'Lỗi hệ thống: ' + err.message });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// ========================
// FEATURE VISIBILITY API (must be BEFORE /api/users/:id to avoid route conflict)
// ========================

// GET /api/features - Lấy trạng thái hiển thị tính năng (public)
app.get('/api/features', async (req, res) => {
    try {
        let features = await FeatureVisibility.findOne();
        if (!features) features = await FeatureVisibility.create({});
        res.json(features);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/features - Cập nhật hiển thị tính năng (admin only)
app.put('/api/features', requireAdmin, async (req, res) => {
    try {
        let features = await FeatureVisibility.findOne();
        if (!features) features = new FeatureVisibility();
        const updates = req.body;
        Object.keys(updates).forEach(key => {
            if (features.schema.paths[key]) {
                features[key] = updates[key] === true || updates[key] === 'true';
            }
        });
        await features.save();
        res.json({ message: 'Cập nhật thành công', features });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Feedback Schema
const MessageSchema = new mongoose.Schema({
    text: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    userName: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
}, { _id: false });

const FeedbackSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    feature: { type: String, required: true },
    type: { type: String, enum: ['bug', 'feature', 'improvement', 'question'], default: 'bug' },
    title: { type: String, required: true },
    description: { type: String, required: true },
    status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    attachments: [{ type: String }],
    adminNote: { type: String, default: '' },
    messages: { type: [MessageSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Feedback = mongoose.model('Feedback', FeedbackSchema);

// ========================
// FEEDBACK API
// ========================

// POST /api/feedback - Tạo feedback mới (called by FB-SYSTEM)
app.post('/api/feedback', async (req, res) => {
    try {
        const { userId, feature, type, title, description, priority } = req.body;
        if (!userId || !title || !description) {
            return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' });
        }
        const feedback = new Feedback({ userId, feature, type, title, description, priority });
        await feedback.save();
        console.log('[ServerAdmin] Feedback created:', feedback._id);
        res.status(201).json({ success: true, feedback });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// PUT /api/feedback/sync/:id - Đồng bộ cập nhật từ FB-SYSTEM
app.put('/api/feedback/sync/:id', async (req, res) => {
    try {
        const { title, description, type, priority, feature, status } = req.body;
        const updates = { updatedAt: new Date() };
        if (title) updates.title = title;
        if (description) updates.description = description;
        if (type) updates.type = type;
        if (priority) updates.priority = priority;
        if (feature) updates.feature = feature;
        if (status) updates.status = status;
        const feedback = await Feedback.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
        if (!feedback) return res.status(404).json({ success: false, error: 'Feedback not found' });
        console.log('[ServerAdmin] Feedback synced:', feedback._id);
        res.json({ success: true, feedback });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// DELETE /api/feedback/sync/:id - Đồng bộ xóa từ FB-SYSTEM
app.delete('/api/feedback/sync/:id', async (req, res) => {
    try {
        const feedback = await Feedback.findByIdAndDelete(req.params.id);
        if (!feedback) return res.status(404).json({ success: false, error: 'Feedback not found' });
        console.log('[ServerAdmin] Feedback deleted (sync):', req.params.id);
        res.json({ success: true, message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/feedback - Danh sách feedback (protected)
app.get('/api/feedback', requireAdmin, async (req, res) => {
    try {
        const search = req.query.search || '';
        const status = req.query.status || '';
        const type = req.query.type || '';
        const priority = req.query.priority || '';
        const filter = {};
        if (search) filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
        if (status) filter.status = status;
        if (type) filter.type = type;
        if (priority) filter.priority = priority;
        const feedbacks = await Feedback.find(filter).populate('userId', 'email username').sort({ createdAt: -1 });
        res.json({ feedbacks });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/feedback/detail/:id - Chi tiết feedback
app.get('/api/feedback/detail/:id', requireAdmin, async (req, res) => {
    try {
        const feedback = await Feedback.findById(req.params.id).populate('userId', 'email username');
        if (!feedback) return res.status(404).json({ error: 'Feedback not found' });
        res.json(feedback);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/feedback/:id - Cập nhật feedback (admin)
app.put('/api/feedback/:id', requireAdmin, async (req, res) => {
    try {
        const { status, priority, adminNote } = req.body;
        const updates = { updatedAt: new Date() };
        if (status) updates.status = status;
        if (priority) updates.priority = priority;
        if (adminNote !== undefined) updates.adminNote = adminNote;
        const feedback = await Feedback.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
        if (!feedback) return res.status(404).json({ error: 'Feedback not found' });
        res.json({ message: 'Cập nhật thành công', feedback });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/feedback/:id - Xóa feedback (admin)
app.delete('/api/feedback/:id', requireAdmin, async (req, res) => {
    try {
        const feedback = await Feedback.findByIdAndDelete(req.params.id);
        if (!feedback) return res.status(404).json({ error: 'Feedback not found' });
        res.json({ message: 'Xóa thành công' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================
// API ROUTES (protected)
// ========================

// GET /api/stats - Thống kê tổng quan
app.get('/api/stats', requireAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const adminCount = await User.countDocuments({ role: 'admin' });
        const userCount = await User.countDocuments({ role: 'user' });
        const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const newUsersWeek = await User.countDocuments({ createdAt: { $gte: sevenDaysAgo } });
        const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newUsersMonth = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
        const deviceStats = await User.aggregate([{ $unwind: '$devices' }, { $match: { 'devices.isActive': true } }, { $count: 'total' }]);
        const activeDevices = deviceStats.length > 0 ? deviceStats[0].total : 0;
        const registrationChart = await User.aggregate([{ $match: { createdAt: { $gte: thirtyDaysAgo } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
        res.json({ totalUsers, adminCount, userCount, newUsersWeek, newUsersMonth, activeDevices, registrationChart });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/users - Danh sách users
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const role = req.query.role || '';
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const filter = {};
        if (search) filter.$or = [{ username: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }, { phoneNumber: { $regex: search, $options: 'i' } }];
        if (role) filter.role = role;
        const total = await User.countDocuments(filter);
        const users = await User.find(filter).select('-password -resetPasswordToken -resetPasswordExpires').sort({ [sortBy]: sortOrder }).skip((page - 1) * limit).limit(limit);
        res.json({ users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/users/:id - Chi tiết 1 user
app.get('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select('-password -resetPasswordToken -resetPasswordExpires');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/users/:id - Cập nhật user
app.put('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const { username, email, phoneNumber, role, language } = req.body;
        const updateData = {};
        if (username) updateData.username = username;
        if (email) updateData.email = email;
        if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
        if (role) updateData.role = role;
        if (language) updateData.language = language;
        const user = await User.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true, runValidators: true }).select('-password -resetPasswordToken -resetPasswordExpires');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Cập nhật thành công', user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/users/:id/password - Đổi mật khẩu
app.put('/api/users/:id/password', requireAdmin, async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const user = await User.findByIdAndUpdate(req.params.id, { $set: { password: hashedPassword } }, { new: true }).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Đổi mật khẩu thành công' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/users/:id - Xóa user
app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Xóa user thành công' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/users - Tạo user mới
app.post('/api/users', requireAdmin, async (req, res) => {
    try {
        const { username, email, password, phoneNumber, role } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'Vui lòng điền đầy đủ thông tin' });
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: 'Email đã tồn tại' });
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ username, email, password: hashedPassword, phoneNumber: phoneNumber || '', role: role || 'user' });
        await user.save();
        const userResponse = user.toObject();
        delete userResponse.password;
        res.status(201).json({ message: 'Tạo user thành công', user: userResponse });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/users/:id/devices/:deviceId - Xóa device
app.delete('/api/users/:id/devices/:deviceId', requireAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, { $pull: { devices: { deviceId: req.params.deviceId } } }, { new: true }).select('-password');
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'Xóa device thành công', user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================
// LANDING PAGE ROUTES (public - no auth required)
// ========================

// GET / - Landing page (công ty quảng cáo FB-SYSTEM)
app.get('/', (req, res) => {
    // Nếu admin đã đăng nhập, chuyển đến dashboard
    if (req.session && req.session.adminId) {
        return res.render('dashboard', {
            adminName: req.session.adminName || 'Admin',
            adminEmail: req.session.adminEmail || ''
        });
    }
    // Hiển thị landing page cho khách
    res.render('landing/index');
});

// ========================
// FEATURE PAGES (public)
// ========================
app.get('/features/schedule', (req, res) => { res.render('landing/features/schedule'); });
app.get('/features/ai-content', (req, res) => { res.render('landing/features/ai-content'); });
app.get('/features/auto-comment', (req, res) => { res.render('landing/features/auto-comment'); });
app.get('/features/ai-scan', (req, res) => { res.render('landing/features/ai-scan'); });
app.get('/features/competitor', (req, res) => { res.render('landing/features/competitor'); });
app.get('/features/analytics', (req, res) => { res.render('landing/features/analytics'); });

// ========================
// LANDING SUBPAGES (public)
// ========================
app.get('/about', (req, res) => { res.render('landing/about'); });
app.get('/blog', (req, res) => { res.render('landing/blog'); });
app.get('/careers', (req, res) => { res.render('landing/careers'); });
app.get('/privacy', (req, res) => { res.render('landing/privacy'); });
app.get('/terms', (req, res) => { res.render('landing/terms'); });
app.get('/download', (req, res) => { res.render('landing/download'); });
app.get('/pricing', (req, res) => { res.render('landing/pricing'); });
app.get('/docs', (req, res) => { res.render('landing/docs'); });

// ========================
// PAGE ROUTES (protected)
// ========================
app.get('/dashboard', requireAdmin, (req, res) => {
    res.render('dashboard', {
        adminName: req.session.adminName || 'Admin',
        adminEmail: req.session.adminEmail || ''
    });
});

app.get('/feedback', requireAdmin, (req, res) => {
    res.render('feedback', {
        adminName: req.session.adminName || 'Admin',
        adminEmail: req.session.adminEmail || ''
    });
});

// ========================
// START SERVER
// ========================
mongoose.connect(DB_URI, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000 }).then(() => {
    console.log('✅ [ServerAdmin] Đã kết nối MongoDB');
    app.listen(PORT, () => { console.log(`🚀 [ServerAdmin] Đang chạy tại http://localhost:${PORT}`); });
}).catch(err => {
    console.error('❌ [ServerAdmin] Lỗi kết nối MongoDB:', err.message);
    app.listen(PORT, () => { console.log(`⚠️ [ServerAdmin] Đang chạy tại http://localhost:${PORT} (KHÔNG CÓ DATABASE)`); });
});