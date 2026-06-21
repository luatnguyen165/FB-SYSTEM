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

        // Kick-off backfill groups cho FB accounts chưa có cache
        // - Idempotent: nếu user không có FB account hoặc đã có cache → skip ngay
        // - Fire-and-forget: không block request
        // - Dùng session throttled: chỉ trigger 1 lần / mỗi user / mỗi khoảng thời gian
        try {
            triggerGroupBackfillOncePerSession(req, user._id);
        } catch (_) { /* không để lỗi nhỏ chặn request */ }

        next();
    } catch (error) {
        console.error('Auth Middleware Error:', error);
        res.redirect('/auth/login');
    }
};

// Throttle map: chỉ trigger backfill cho mỗi user 1 lần / N ms
const _backfillThrottle = new Map();
const BACKFILL_THROTTLE_MS = 6 * 60 * 60 * 1000; // 6 giờ
const BACKFILL_THROTTLE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

// Cleanup Map định kỳ — chống tăng đơn điệu entries
let _lastBackfillCleanup = 0;
const BACKFILL_THROTTLE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 giờ cleanup 1 lần

function cleanupBackfillThrottleMap() {
    const now = Date.now();
    const cutoff = now - BACKFILL_THROTTLE_MAX_AGE_MS;
    let removed = 0;
    for (const [key, lastTriggered] of _backfillThrottle) {
        if (typeof lastTriggered !== 'number' || lastTriggered < cutoff) {
            _backfillThrottle.delete(key);
            removed++;
        }
    }
    if (removed > 0) {
        console.log(`[Backfill Throttle] Cleanup: removed ${removed} entries > 7 ngày. Remaining: ${_backfillThrottle.size}`);
    }
    return removed;
}

function triggerGroupBackfillOncePerSession(req, userId) {
    if (!userId) return;
    const now = Date.now();
    // Lazy cleanup mỗi 1 giờ (không tốn interval riêng)
    if (now - _lastBackfillCleanup > BACKFILL_THROTTLE_CLEANUP_INTERVAL_MS) {
        _lastBackfillCleanup = now;
        cleanupBackfillThrottleMap();
    }

    const last = _backfillThrottle.get(String(userId)) || 0;
    if (now - last < BACKFILL_THROTTLE_MS) return;
    _backfillThrottle.set(String(userId), now);

    try {
        const { backfillMissingGroupCaches } = require('../services/facebook/groups');
        // silent=true: không log khi không có gì để làm (user vào trang không liên quan)
        backfillMissingGroupCaches(String(userId), { silent: true });
    } catch (e) {
        console.warn('[Backfill Throttle] Không thể trigger:', e.message);
    }
}

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

module.exports = { requireAuth, requireAdmin, loadFeatureVisibility };