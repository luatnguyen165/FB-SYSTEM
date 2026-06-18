// utils/aiResponse.js
// Shared AI response parser — dùng chung cho tất cả services

/**
 * Parse JSON từ AI response, tự động clean markdown code blocks
 * @param {string} raw - Raw response từ AI
 * @returns {Object|null} Parsed object hoặc null nếu fail
 */
function parseAIJsonResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        return null;
    }
}

/**
 * Parse JSON từ AI response với fallback
 * @param {string} raw - Raw response
 * @param {Object} defaultValue - Giá trị mặc định nếu parse fail
 * @returns {Object}
 */
function parseAIJsonWithFallback(raw, defaultValue = {}) {
    const parsed = parseAIJsonResponse(raw);
    return parsed || defaultValue;
}

module.exports = { parseAIJsonResponse, parseAIJsonWithFallback };
