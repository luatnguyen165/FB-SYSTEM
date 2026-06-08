// middlewares/authMiddleware.js
const User = require('../models/User');
const { t } = require('../locales/i18n');

const requireAuth = async (req, res, next) => {
    try {
        if (!req.session.userId && req.cookies?.remember_token) {
            req.session.userId = req.cookies.remember_token;
        }

        if (!req.session.userId) {
            return res.redirect('/auth/login');
        }

        const user = await User.findById(req.session.userId).lean();
        if (!user) {
            res.clearCookie('remember_token');
            req.session.destroy();
            return res.redirect('/auth/login');
        }
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

// Middleware to load feature visibility into res.locals
const loadFeatureVisibility = async (req, res, next) => {
    try {
        const FeatureVisibility = require('../models/FeatureVisibility');
        let features = await FeatureVisibility.findOne();
        if (!features) {
            features = await FeatureVisibility.create({});
        }
        res.locals.features = features.toObject();
    } catch (err) {
        console.error('[Feature Visibility] Load error:', err.message);
        res.locals.features = {};
    }
    next();
};

module.exports = { requireAuth, requireAdmin, loadFeatureVisibility };