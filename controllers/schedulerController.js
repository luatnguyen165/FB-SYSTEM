// controllers/schedulerController.js
// Health & status endpoint cho tất cả cron/scheduler đang chạy trong app.
// Chỉ admin mới truy cập được.

const isAutoContentProcessing = false;

/**
 * GET /admin/scheduler/api/status
 * Trả về trạng thái realtime của tất cả workers + memory + queue stats.
 */
exports.getSchedulerStatus = async (req, res) => {
    try {
        // Memory usage
        const memUsage = process.memoryUsage();

        // Auto content runner status (đã xóa module)
        const autoContentStatus = { started: false, processing: false };

        // Reels schedule runner status
        let reelsStatus = { started: false, processing: false };
        try {
            const rs = require('../services/reelsScheduleRunner');
            reelsStatus = {
                started: rs.isWorkerStarted || false,
                processing: rs.isProcessing || false,
                lastRunAt: rs.lastRunAt || null,
                lastSuccessAt: rs.lastSuccessAt || null,
                lastError: rs.lastError || null,
                lastCheckedCount: rs.lastCheckedCount || 0,
                lastProcessedCount: rs.lastProcessedCount || 0
            };
        } catch (_) {}

        // AI Scan scheduler status
        let aiScanStatus = { processing: false };
        try {
            const aisc = require('../services/aiScan/scheduler');
            aiScanStatus = {
                processing: aisc.isScanSchedulerProcessing ? aisc.isScanSchedulerProcessing() : false
            };
        } catch (_) {}

        // Group backfill + queue stats
        let groupBackfill = { active: 0, pending: 0 };
        try {
            const fbg = require('../services/facebook/groups');
            groupBackfill = fbg.getBgScanQueueStats ? fbg.getBgScanQueueStats() : groupBackfill;
        } catch (_) {}

        // FB active sessions count
        let fbSessions = { count: 0, keys: [] };
        try {
            const fbsess = require('../services/facebook/session');
            fbSessions.count = fbsess.ACTIVE_FB_SESSIONS.size;
            fbSessions.keys = Array.from(fbsess.ACTIVE_FB_SESSIONS.keys()).slice(0, 20);
        } catch (_) {}

        // Download queue stats
        let queues = {};
        try {
            const fps = require('../services/facebookProfileScraper');
            queues.imageDownload = fps.imageDownloadQueue.getStats();
        } catch (_) {}
        try {
            const fgs = require('../services/facebookGroupScraper');
            queues.videoDownload = fgs.videoDownloadQueue.getStats();
        } catch (_) {}

        // Database connection
        const db = {
            connected: global.dbConnected === true,
            type: 'sqlite'
        };

        // Uptime
        const uptime = process.uptime();
        const uptimeHuman = formatUptime(uptime);

        res.json({
            success: true,
            uptime: { seconds: Math.round(uptime), human: uptimeHuman },
            memory: {
                rss: formatBytes(memUsage.rss),
                heapTotal: formatBytes(memUsage.heapTotal),
                heapUsed: formatBytes(memUsage.heapUsed),
                external: formatBytes(memUsage.external),
                rssBytes: memUsage.rss,
                heapUsedBytes: memUsage.heapUsed
            },
            db,
            schedulers: {
                reelsSchedule: reelsStatus,
                autoContent: autoContentStatus,
                aiScan: aiScanStatus
            },
            queues: {
                ...queues,
                groupBackfill
            },
            fbSessions
        });
    } catch (err) {
        console.error('[Scheduler Status] Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /admin/scheduler/api/cleanup/now
 * Chạy cleanup FB sessions ngay (force, không cần đợi cron 30 phút).
 */
exports.cleanupNow = async (req, res) => {
    try {
        const { cleanupStaleFbSessions } = require('../services/facebook/utils');
        const result = cleanupStaleFbSessions();
        res.json({ success: true, message: 'Cleanup done', ...result });
    } catch (err) {
        console.error('[Scheduler Cleanup] Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * POST /admin/scheduler/api/bg-scan/flush
 * Flush hết các job scan groups đang đợi trong semaphore queue (skip hết).
 * Hữu ích khi user muốn dừng hàng loạt job backlog.
 */
exports.flushBackgroundScanQueue = async (req, res) => {
    try {
        const fbg = require('../services/facebook/groups');
        if (typeof fbg.flushBgScanQueue === 'function') {
            const flushed = fbg.flushBgScanQueue();
            return res.json({ success: true, message: 'Queue flushed', flushed });
        }
        res.json({ success: false, message: 'flushBgScanQueue không khả dụng' });
    } catch (err) {
        console.error('[Scheduler Flush] Error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
};

// ===== Helpers =====

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}
