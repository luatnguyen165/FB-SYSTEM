// middlewares/authMiddleware.js
const { t } = require('../locales/i18n');

const SERVER_ADMIN_URL = process.env.SERVER_ADMIN_URL || 'http://localhost:5000';

const requireAuth = async (req, res, next) => {
    try {
        if (!req.session.userId && req.cookies?.remember_token) {
            req.session.userId = req.cookies.remember_token;
        }

        if (!req.session.userId) {
            return res.redirect('/auth/login');
        }

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/profile/${req.session.userId}`);
        const data = await response.json();

        if (!response.ok || !data.success || !data.user) {
            res.clearCookie('remember_token');
            req.session.destroy();
            return res.redirect('/auth/login');
        }

        const user = data.user;
        req.user = user;
        res.locals.user = user;
        // Inject the correct t() function based on user's language preference
        const lang = user.language || 'vi';
        res.locals.lang = lang;
        res.locals.t = function(key, fallback) {
            return t(key, lang, fallback);
        };
        res.locals.tr = function(key, fallback) {
            return t(key, lang, fallback);
        };

        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        res.redirect('/auth/login');
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).send('Truy cập bị từ chối. Chỉ admin mới có quyền truy cập.');
    }
    next();
};

// Middleware to load feature visibility from ServerAdmin API
const loadFeatureVisibility = async (req, res, next) => {
    try {
        const response = await fetch(`${SERVER_ADMIN_URL}/api/features`);
        if (response.ok) {
            const features = await response.json();
            res.locals.features = features;
        } else {
            console.warn('[Feature Visibility] ServerAdmin API returned', response.status);
            res.locals.features = {};
        }
    } catch (err) {
        console.error('[Feature Visibility] Load error (fallback to local DB):', err.message);
        // Fallback to local DB if ServerAdmin is unreachable
        try {
            const FeatureVisibility = require('../models/FeatureVisibility');
            let features = await FeatureVisibility.findOne();
            if (!features) {
                features = await FeatureVisibility.create({});
            }
            res.locals.features = features.toObject();
        } catch (dbErr) {
            console.error('[Feature Visibility] Fallback error:', dbErr.message);
            res.locals.features = {};
        }
    }
    next();
};

const requireLocalAuth = async (req, res, next) => {
    try {
        if (!req.session.userId && req.cookies?.remember_token) {
            req.session.userId = req.cookies.remember_token;
        }
        if (!req.session.userId) {
            return res.redirect('/auth/login');
        }

        const User = require('../models/User');
        const user = await User.findById(req.session.userId).lean();
        if (!user) {
            res.clearCookie('remember_token');
            req.session.destroy();
            return res.redirect('/auth/login');
        }

        req.user = user;
        res.locals.user = user;
        const lang = user.language || 'vi';
        res.locals.lang = lang;
        res.locals.t = function(key, fallback) { return t(key, lang, fallback); };
        res.locals.tr = function(key, fallback) { return t(key, lang, fallback); };
        next();
    } catch (error) {
        console.error('[requireLocalAuth] Error:', error);
        res.redirect('/auth/login');
    }
};

module.exports = { requireAuth, requireLocalAuth, requireAdmin, loadFeatureVisibility };