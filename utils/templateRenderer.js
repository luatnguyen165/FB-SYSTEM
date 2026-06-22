// utils/templateRenderer.js - Render template {{text|first_N_chars}} từ TrackingPost
// Hỗ trợ cú pháp:
//   {{text}}           → toàn bộ text
//   {{text|first_N}}   → cắt N ký tự đầu
//   {{permalink}}      → link gốc
//   {{authorName}}     → tên tác giả
//   {{postId}}         → FB post id
// Nếu template rỗng → trả về toàn bộ text.

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_]+)(?:\|(\d+))?\s*\}\}/g;

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderTemplate(template, post) {
    if (!template || typeof template !== 'string') return post?.text || '';
    return template.replace(TEMPLATE_RE, (_match, field, limit) => {
        let value = '';
        switch (field) {
            case 'text': value = post.text || ''; break;
            case 'permalink': value = post.permalink || ''; break;
            case 'authorName': value = post.authorName || ''; break;
            case 'postId': value = post.postId || ''; break;
            default: value = '';
        }
        if (limit) {
            const n = parseInt(limit, 10);
            if (!isNaN(n) && n > 0) value = String(value).slice(0, n);
        }
        return value;
    });
}

// Tách chuỗi hashtags/tags thành mảng (input comma-separated hoặc space-separated)
function parseHashtagInput(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input.map(s => String(s).trim()).filter(Boolean);
    return String(input)
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
        // Tự thêm # nếu user quên
        .map(s => s.startsWith('#') ? s : '#' + s);
}

function parseTagInput(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input.map(s => String(s).trim()).filter(Boolean);
    return String(input)
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

module.exports = { renderTemplate, parseHashtagInput, parseTagInput };