// services/aiScan/helpers.js
const path = require('path');
const fs = require('fs');

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function resolveFilePath(filePath = '') {
    const raw = String(filePath || '').trim();
    if (!raw) return '';
    if (path.isAbsolute(raw) && fs.existsSync(raw)) return raw;
    const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..', '..');
    const normalized = raw.replace(/^\/+/, '').replace(/^\.\/+/, '');
    const candidates = [
        path.join(projectRoot, normalized),
        path.join(projectRoot, 'uploads', 'images', path.basename(normalized)),
        path.join(projectRoot, 'uploads', 'videos', path.basename(normalized))
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return raw;
}

function normalizeFacebookPostUrl(postId = '') {
    const id = String(postId).trim();
    if (!id) return '';
    if (id.startsWith('http')) return id;
    return `https://www.facebook.com/${id}`;
}

function extractGroupIdFromUrl(url = '') {
    const match = String(url).match(/\/groups\/([^/?&]+)/);
    return match ? match[1] : '';
}

function isTodayTimeString(timeText, maxDaysOld = 1) {
    if (!timeText) return true;
    const text = timeText.toLowerCase().trim();
    
    if (/vài giây|vừa xong|just now|now|phút trước|mins? ago|minutes? ago|giờ trước|hours? ago|hrs? ago|hôm nay|today/.test(text)) return true;
    if (/\d{1,2}:\d{2}/.test(text) && !/hôm qua|yesterday|thứ\s|ngày/.test(text)) return true;
    
    const hourMatch = text.match(/(\d+)\s*(giờ|hours?|hrs?)/);
    if (hourMatch && parseInt(hourMatch[1]) <= 24) return true;
    
    if (/hôm qua|yesterday/.test(text)) {
        return maxDaysOld >= 2;
    }
    
    if (/tuần|weeks?|năm|years?|tháng\s*\d|month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}\/\d{1,2}\/\d{4}/i.test(text)) return false;
    
    if (/thứ\s+(hai|ba|tư|năm|sáu|bảy|nhật|cn|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(text)) {
        return maxDaysOld >= 2;
    }
    
    const dayMatch = text.match(/(\d+)\s*(ngày|days?)/);
    if (dayMatch) {
        const daysAgo = parseInt(dayMatch[1]);
        return daysAgo < maxDaysOld;
    }
    
    return true;
}

module.exports = {
    wait,
    randomInt,
    resolveFilePath,
    normalizeFacebookPostUrl,
    extractGroupIdFromUrl,
    isTodayTimeString
};