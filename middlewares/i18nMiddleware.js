// middlewares/i18nMiddleware.js - Inject t() and lang into all views
// This is a SYNCHRONOUS helper - it just sets defaults.
// The actual language resolution happens in requireAuth (authMiddleware.js)
// which updates res.locals.t and res.locals.lang after loading req.user.
const { t } = require('../locales/i18n');

function i18nMiddleware(req, res, next) {
    // Default: Vietnamese (for non-auth pages like landing, login)
    res.locals.lang = 'vi';
    res.locals.t = function(key, fallback) {
        return t(key, 'vi', fallback);
    };
    res.locals.tr = function(key, fallback) {
        return t(key, 'vi', fallback);
    };
    next();
}

module.exports = i18nMiddleware;