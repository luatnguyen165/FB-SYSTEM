// services/facebook/cookieUtils.js
// Helper trích user ID (c_user cho FB, sessionid cho IG/TT, etc.) từ storage-state.json
// để match channel chính xác — chống duplicate khi user đổi tên hiển thị.

const fs = require('fs');

/**
 * Map cookie name → user ID cho từng platform.
 * User ID là giá trị duy nhất không đổi, dùng để dedup.
 */
const PLATFORM_USER_COOKIES = {
    FB: 'c_user',          // FB: 61550000000000000
    IG: 'ds_user_id',       // IG: 12345678901
    TT: 'uid_tt',           // TT: unique user id (numeric)
    YT: 'LOGIN_INFO',       // YT: dạng encoded, parse uid ra
    ZO: 'zpw_id',           // Zalo: zpwid
    PI: '_auth',            // Pinterest: _auth chứa user_id
    TH: 'ds_user_id'        // Threads: dùng chung IG cookie
};

/**
 * Đọc user ID từ file storageStatePath của Playwright, theo platform.
 *
 * @param {string} storageStatePath - Đường dẫn tuyệt đối tới storage-state.json
 * @param {string} platform - 'FB' | 'IG' | 'TT' | 'YT' | 'ZO' | 'PI' | 'TH'
 * @returns {string|null} - User ID hoặc null nếu không có
 */
function extractUserIdFromStorageState(storageStatePath, platform) {
    if (!storageStatePath || !platform) return null;
    const cookieName = PLATFORM_USER_COOKIES[platform];
    if (!cookieName) return null;

    try {
        if (!fs.existsSync(storageStatePath)) return null;
        const raw = fs.readFileSync(storageStatePath, 'utf8');
        const data = JSON.parse(raw);
        const cookies = Array.isArray(data?.cookies) ? data.cookies : [];

        // 1) Tìm đúng cookie name
        for (const c of cookies) {
            if (c?.name === cookieName && c.value) {
                return extractFromCookieValue(c.value, platform);
            }
        }

        // 2) Fallback: thử cookie khác có chứa user id (một số platform mã hóa)
        // FB: c_user
        // IG: ds_user_id (Instagram GraphQL API)
        // TT: có thể lưu trong 'uid_tt' hoặc parse từ sessionid
        if (platform === 'TT') {
            for (const c of cookies) {
                if (c?.name === 'sessionid' && c.value) {
                    // TikTok sessionid không chứa uid trực tiếp,
                    // cần parse từ cookie khác hoặc scrape page
                    // Trả về null nếu không tìm được → fallback theo accountName
                    return null;
                }
            }
        }

        return null;
    } catch (e) {
        console.warn(`[CookieUtils] Không thể đọc user id từ ${storageStatePath}:`, e.message);
        return null;
    }
}

/**
 * Parse giá trị cookie để lấy user ID sạch.
 */
function extractFromCookieValue(value, platform) {
    if (!value) return null;
    if (platform === 'FB' || platform === 'IG' || platform === 'ZO' || platform === 'PI' || platform === 'TH') {
        return String(value).trim();
    }
    if (platform === 'YT') {
        // LOGIN_INFO thường là chuỗi encoded, lấy phần đầu
        // VD: "GA3AAABC...==|abc123..." → trả về nguyên hoặc hash
        return String(value).substring(0, 100).trim();
    }
    return String(value).trim();
}

/**
 * Đọc c_user cookie ID từ file storageStatePath của Playwright (FB only, backward compat).
 */
function extractCUserFromStorageState(storageStatePath) {
    return extractUserIdFromStorageState(storageStatePath, 'FB');
}

/**
 * Đọc tất cả cookies quan trọng từ file.
 */
function extractFbSessionInfo(storageStatePath) {
    if (!storageStatePath) return { c_user: null, xs: null, hasCookies: false };
    try {
        if (!fs.existsSync(storageStatePath)) return { c_user: null, xs: null, hasCookies: false };
        const data = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
        const cookies = Array.isArray(data?.cookies) ? data.cookies : [];
        let c_user = null;
        let xs = null;
        for (const c of cookies) {
            if (c?.name === 'c_user' && c.value) c_user = String(c.value);
            if (c?.name === 'xs' && c.value) xs = String(c.value);
        }
        return { c_user, xs, hasCookies: cookies.length > 0 };
    } catch (e) {
        return { c_user: null, xs: null, hasCookies: false };
    }
}

/**
 * Đọc tất cả session cookies cho 1 platform.
 * @returns {Object|null} { userId, sessionToken, hasCookies }
 */
function extractSessionInfo(storageStatePath, platform) {
    if (!storageStatePath || !platform) return null;
    try {
        if (!fs.existsSync(storageStatePath)) return null;
        const data = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
        const cookies = Array.isArray(data?.cookies) ? data.cookies : [];
        if (cookies.length === 0) return null;

        const sessionCookies = {
            FB: ['c_user', 'xs'],
            IG: ['sessionid', 'ds_user_id'],
            TT: ['sessionid', 'uid_tt'],
            YT: ['SAPISID', 'LOGIN_INFO'],
            ZO: ['zmp3sz', 'zpw_id'],
            PI: ['_pinterest_sess', '_auth'],
            TH: ['sessionid', 'ds_user_id', 'csrftoken']
        }[platform] || [];

        const result = { userId: null, sessionToken: null, hasCookies: true };
        for (const c of cookies) {
            if (c?.name === PLATFORM_USER_COOKIES[platform]) {
                result.userId = extractFromCookieValue(c.value, platform);
            }
            // sessionid, xs, SAPISID, zmp3sz, _pinterest_sess
            if (platform === 'FB' && c.name === 'xs') result.sessionToken = c.value;
            else if ((platform === 'IG' || platform === 'TT' || platform === 'TH') && c.name === 'sessionid') result.sessionToken = c.value;
            else if (platform === 'YT' && c.name === 'SAPISID') result.sessionToken = c.value;
            else if (platform === 'ZO' && c.name === 'zmp3sz') result.sessionToken = c.value;
            else if (platform === 'PI' && c.name === '_pinterest_sess') result.sessionToken = c.value;
        }
        return result;
    } catch (e) {
        return null;
    }
}

module.exports = {
    PLATFORM_USER_COOKIES,
    extractUserIdFromStorageState,
    extractCUserFromStorageState,
    extractFbSessionInfo,
    extractSessionInfo
};
