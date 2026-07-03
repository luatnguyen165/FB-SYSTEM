// utils/videoNormalizer.js - Chuẩn hóa video data về dạng string URL
/**
 * Normalize video data từ group scraper → URL string array
 * Group scraper trả về: [{ url, reelUrl, videoId }]
 * Profile scraper trả về: ["/uploads/...", "https://..."]
 * 
 * @param {Array} videos - raw videos array từ scraper
 * @returns {string[]} - array of URL strings
 */
function normalizeVideos(videos) {
    if (!videos || !Array.isArray(videos)) return [];
    return videos.map(v => {
        if (!v) return null;
        if (typeof v === 'object') {
            return v.reelUrl || v.url || v.videoUrl || v.filepath || null;
        }
        return String(v);
    }).filter(Boolean);
}

module.exports = { normalizeVideos };
