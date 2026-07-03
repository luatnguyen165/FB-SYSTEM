// middlewares/apiAuthMiddleware.js
// API Authentication — hỗ trợ 2 cách:
//   1. Session auth (cookie-based, cho internal app)
//   2. API Key auth (header X-API-Key, cho external integration)
//
// API Key: lưu trong .env → DUBBING_API_KEY
// Hoặc dùng chung OPENAI_API_KEY / JWT_SECRET làm fallback

const SERVER_ADMIN_URL = process.env.SERVER_ADMIN_URL || 'http://localhost:5000';

/**
 * API Auth — accepts session OR API key
 * Nếu dùng API key, set req.apiKeyUser = { _id: 'api-user' }
 */
const requireApiAuth = async (req, res, next) => {
    // === Cách 1: API Key ===
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (apiKey) {
        const validKey = process.env.DUBBING_API_KEY || process.env.JWT_SECRET;
        if (!validKey) {
            return res.status(500).json({ success: false, error: 'Server API key not configured' });
        }
        if (apiKey !== validKey) {
            return res.status(401).json({ success: false, error: 'Invalid API key' });
        }
        // API key auth — dùng user mặc định hoặc tạo dummy user
        req.apiKeyUser = { _id: 'api-user', role: 'admin' };
        return next();
    }

    // === Cách 2: Session auth (cookie) ===
    try {
        if (!req.session?.userId && req.cookies?.remember_token) {
            req.session.userId = req.cookies.remember_token;
        }

        if (!req.session?.userId) {
            return res.status(401).json({ success: false, error: 'Unauthorized — login or use X-API-Key header' });
        }

        const response = await fetch(`${SERVER_ADMIN_URL}/api/auth/profile/${req.session.userId}`);
        const data = await response.json();

        if (!response.ok || !data.success || !data.user) {
            return res.status(401).json({ success: false, error: 'Session expired' });
        }

        req.user = data.user;
        return next();
    } catch (err) {
        console.error('[API Auth] Error:', err.message);
        return res.status(401).json({ success: false, error: 'Authentication failed' });
    }
};

module.exports = { requireApiAuth };
