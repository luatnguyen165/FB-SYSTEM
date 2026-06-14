/**
 * Shared Facebook utilities
 * Used by facebookPostGroupService.js, facebook/utils.js, and others
 */
const fs = require('fs');
const path = require('path');

/**
 * Resolve local image path from various formats
 */
function resolveLocalImagePath(imagePath = '') {
    const rawPath = String(imagePath || '').trim();
    if (!rawPath) return '';

    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
        return rawPath;
    }

    const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..', '..');
    const normalizedRelative = rawPath.replace(/^\/+/, '').replace(/^\.\/+/, '');

    const candidates = [
        path.join(projectRoot, normalizedRelative),
        path.join(projectRoot, 'uploads', 'images', path.basename(normalizedRelative))
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }

    return rawPath;
}

/**
 * Normalize schedule image inputs to array of valid paths
 */
function normalizeScheduleImageInputs(images = []) {
    const values = Array.isArray(images) ? images : [images];
    return values
        .map(resolveLocalImagePath)
        .filter(Boolean)
        .filter((filePath) => fs.existsSync(filePath));
}

/**
 * Check if file is allowed post image
 */
function isAllowedPostImageFile(filePath = '') {
    const ext = path.extname(String(filePath || '').trim()).toLowerCase();
    return ['.jpg', '.jpeg', '.png'].includes(ext);
}

/**
 * Normalize Facebook group URL
 */
function normalizeFacebookGroupUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';

    try {
        const parsed = new URL(raw);
        if (!/^(www\.)?facebook\.com$/i.test(parsed.hostname)) return '';

        const pathname = parsed.pathname.replace(/\/+$/, '/');
        if (!/^\/groups\//i.test(pathname)) return '';

        return `${parsed.origin}${pathname}${parsed.search || ''}`;
    } catch (err) {
        return '';
    }
}

/**
 * Build Facebook group target URL from various inputs
 */
function buildFacebookGroupTargetUrl(groupUrl = '', groupId = '') {
    const normalizedGroupUrl = normalizeFacebookGroupUrl(groupUrl);
    if (normalizedGroupUrl) return normalizedGroupUrl;

    const rawGroupId = String(groupId || '').trim();
    if (!rawGroupId) return '';
    if (/^https?:\/\//i.test(rawGroupId)) return normalizeFacebookGroupUrl(rawGroupId);

    return `https://www.facebook.com/groups/${encodeURIComponent(rawGroupId)}`;
}

module.exports = {
    resolveLocalImagePath,
    normalizeScheduleImageInputs,
    isAllowedPostImageFile,
    normalizeFacebookGroupUrl,
    buildFacebookGroupTargetUrl
};