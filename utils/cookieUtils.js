const fs = require('fs');

/**
 * Parse Netscape cookie file, trả về expiry Date sớm nhất
 * Format: domain \t includeSubdomains \t path \t secure \t expires \t name \t value
 * @param {string} cookiesPath - Đường dẫn file cookies
 * @returns {Date|null} - Date sớm nhất hoặc null nếu không parse được
 */
function parseCookieExpiry(cookiesPath) {
    try {
        if (!cookiesPath || !fs.existsSync(cookiesPath)) return null;
        const content = fs.readFileSync(cookiesPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
        let earliest = null;
        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length < 5) continue;
            const expires = parseInt(parts[4], 10);
            if (!expires || expires <= 0) continue; // session cookie, skip
            const d = new Date(expires * 1000);
            if (!earliest || d < earliest) earliest = d;
        }
        return earliest;
    } catch {
        return null;
    }
}

module.exports = { parseCookieExpiry };
