// middlewares/rateLimiter.js
// Simple in-memory rate limiter to prevent API abuse

const requestCounts = new Map();

// Cleanup old entries every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of requestCounts.entries()) {
        if (now - entry.resetAt > 60000) {
            requestCounts.delete(key);
        }
    }
}, 60000).unref();

/**
 * Rate limiter middleware
 * @param {number} maxRequests - Maximum requests allowed within the window
 * @param {number} windowMs - Time window in milliseconds
 */
function rateLimiter(maxRequests = 60, windowMs = 60000) {
    return (req, res, next) => {
        // Skip rate limiting for non-API routes
        if (!req.path.startsWith('/api/') && !req.path.startsWith('/schedule/')) {
            return next();
        }

        // Use userId if authenticated, otherwise use IP
        const key = req.user?._id?.toString() || req.ip || 'unknown';
        const now = Date.now();

        let entry = requestCounts.get(key);
        if (!entry || now - entry.resetAt > windowMs) {
            entry = { count: 0, resetAt: now + windowMs };
            requestCounts.set(key, entry);
        }

        entry.count++;

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
        res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

        if (entry.count > maxRequests) {
            const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
            res.setHeader('Retry-After', retryAfter);
            return res.status(429).json({
                success: false,
                message: `Quá nhiều yêu cầu. Vui lòng thử lại sau ${retryAfter} giây.`
            });
        }

        next();
    };
}

module.exports = { rateLimiter };