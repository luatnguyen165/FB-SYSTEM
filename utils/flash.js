// utils/flash.js - Flash message helper using Express session

/**
 * Set success flash message in session
 */
function setSuccess(req, message) {
    if (req.session) {
        req.session.flash = { type: 'success', message };
    }
}

/**
 * Set error flash message in session
 */
function setError(req, message) {
    if (req.session) {
        req.session.flash = { type: 'error', message };
    }
}

/**
 * Set warning flash message in session
 */
function setWarning(req, message) {
    if (req.session) {
        req.session.flash = { type: 'warning', message };
    }
}

/**
 * Get flash message from session and clear it
 */
function getFlash(req) {
    return req.session?.flash || null;
}

/**
 * Get flash and reflash (keep for next request too)
 */
function peekFlash(req) {
    return req.session?.flash || null;
}

/**
 * Middleware: pass flash data to res.locals so views / API can use it
 */
function flashMiddleware(req, res, next) {
    if (req.session?.flash) {
        res.locals.flash = req.session.flash;
        delete req.session.flash;
    }
    next();
}

module.exports = { setSuccess, setError, setWarning, getFlash, peekFlash, flashMiddleware };
