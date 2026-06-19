const path = require('path');

let io = null;

// Store pending AI analysis requests (keyed by requestId)
// Maps requestId -> { resolve, reject, timeout }
const pendingAiAnalysis = new Map();

// Lazy-load models to avoid circular deps
function getModels() {
    return {
        AiScanResult: require('../models/AiScanResult'),
        AiScanConfig: require('../models/AiScanConfig')
    };
}

function initializeSocketIO(socketIoInstance) {
    io = socketIoInstance;
    
    io.on('connection', (socket) => {
        console.log(`[Socket.IO] Client connected: ${socket.id}`);
        
        // Client joins a room based on userId for private updates
        socket.on('join-user', (userId) => {
            if (userId) {
                socket.join(`user:${userId}`);
                console.log(`[Socket.IO] Client ${socket.id} joined room user:${userId}`);
            }
        });
        
        // ============================================================
        // AI SCAN - Puter.js Frontend Analysis
        // ============================================================
        
        // Frontend sends AI analysis result back
        socket.on('scan:analysis-result', (data) => {
            const { requestId, result, error } = data;
            const pending = pendingAiAnalysis.get(requestId);
            if (pending) {
                clearTimeout(pending.timeout);
                pendingAiAnalysis.delete(requestId);
                if (error) {
                    pending.reject(new Error(error));
                } else {
                    pending.resolve(result);
                }
                console.log(`[Socket.IO] AI analysis result received for request: ${requestId}`);
            }
        });

        // Frontend sends scan progress update
        socket.on('scan:progress', (data) => {
            const { userId, configId, status, current, total, message } = data;
            if (userId) {
                emitScanProgress(userId, configId, { status, current, total, message });
            }
        });

        // ============================================================
        // AI SCAN - Load table data via Socket.IO (fast, no page reload)
        // ============================================================
        socket.on('scan:load-table', async (data) => {
            const { userId, page: pageNum, limit } = data || {};
            if (!userId) return;
            try {
                const { AiScanResult, AiScanConfig } = getModels();
                const pageSize = parseInt(limit, 10) || 50;
                const pg = parseInt(pageNum, 10) || 1;
                const skip = (pg - 1) * pageSize;

                const [results, total, totalScanned, totalMatched, totalCommented] = await Promise.all([
                    AiScanResult.find({ userId }).sort({ scannedAt: -1 }).skip(skip).limit(pageSize).lean(),
                    AiScanResult.countDocuments({ userId }),
                    AiScanResult.countDocuments({ userId }),
                    AiScanResult.countDocuments({ userId, isMatching: true }),
                    AiScanResult.countDocuments({ userId, commentSent: true })
                ]);

                const room = `user:${userId}`;
                io.to(room).emit('scan:table-data', {
                    results,
                    total,
                    page: pg,
                    totalPages: Math.ceil(total / pageSize),
                    stats: { totalScanned, totalMatched, totalCommented }
                });
                console.log(`[Socket.IO] Emitted scan:table-data to ${room}: ${results.length}/${total} results`);
            } catch (err) {
                console.error(`[Socket.IO] Error loading table data:`, err.message);
            }
        });
        
        socket.on('disconnect', () => {
            console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
        });

        // ============================================================
        // TRACKING - Real-time scrape updates
        // ============================================================

        // Join tracking room
        socket.on('tracking:join', (trackingId) => {
            if (trackingId) {
                socket.join(`tracking:${trackingId}`);
                console.log(`[Socket.IO] Client ${socket.id} joined tracking:${trackingId}`);
            }
        });

        // Leave tracking room
        socket.on('tracking:leave', (trackingId) => {
            if (trackingId) {
                socket.leave(`tracking:${trackingId}`);
                console.log(`[Socket.IO] Client ${socket.id} left tracking:${trackingId}`);
            }
        });
    });
    
    return io;
}

// ============================================================
// AI SCAN - Request analysis from frontend (Puter.js)
// ============================================================

/**
 * Request AI analysis from frontend via Puter.js
 * @param {string} userId - User ID
 * @param {string} requestId - Unique request ID
 * @param {Object} postData - Post data to analyze
 * @param {string} prompt - Analysis prompt
 * @param {number} timeoutMs - Timeout in ms (default 60s)
 * @returns {Promise<Object>} AI analysis result
 */
function requestAiAnalysis(userId, requestId, postData, prompt, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
        if (!io) {
            return reject(new Error('Socket.IO not initialized'));
        }

        const timeout = setTimeout(() => {
            pendingAiAnalysis.delete(requestId);
            reject(new Error('AI analysis timeout - frontend không phản hồi'));
        }, timeoutMs);

        pendingAiAnalysis.set(requestId, { resolve, reject, timeout });

        // Emit to frontend for analysis
        const room = `user:${userId}`;
        io.to(room).emit('scan:analyze-post', {
            requestId,
            postData: {
                postId: postData.postId,
                postUrl: postData.postUrl,
                postContent: postData.postContent,
                postAuthor: postData.postAuthor,
                images: postData.postImages || []
            },
            prompt
        });

        console.log(`[Socket.IO] AI analysis requested: ${requestId} for user: ${userId}`);
    });
}

/**
 * Emit scan progress update to frontend
 */
function emitScanProgress(userId, configId, data) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('scan:progress', { configId, ...data });
}

/**
 * Emit scan completion to frontend
 */
function emitScanComplete(userId, configId, data) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('scan:complete', { configId, ...data });
}

/**
 * Emit new AI scan results to frontend in real-time
 * @param {string} userId - User ID
 * @param {Array} results - New results to append to the table
 */
function emitNewResults(userId, results) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('scan:new-results', { results });
    console.log(`[Socket.IO] Emitted scan:new-results to ${room}: ${results.length} results`);
}

/**
 * Emit AI analysis result for a single post to frontend in real-time
 * @param {string} userId - User ID
 * @param {Object} result - The analyzed result data
 */
function emitAnalysisResult(userId, result) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('scan:analysis-done', { result });
}

/**
 * Emit stats update to frontend
 * @param {string} userId - User ID
 * @param {Object} stats - Updated stats object
 */
function emitStatsUpdate(userId, stats) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('scan:stats-update', { stats });
}

function emitScheduleUpdate(userId, data) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('schedule-update', data);
    console.log(`[Socket.IO] Emitted schedule-update to ${room}:`, data.status);
}

module.exports = (socketIoInstance) => {
    if (socketIoInstance) {
        return initializeSocketIO(socketIoInstance);
    }
    return { emitScheduleUpdate };
};

// ============================================================
// GROUP SCANNING - Real-time batch streaming
// ============================================================

/**
 * Emit a batch of newly discovered groups to frontend
 * @param {string} userId - User ID
 * @param {Array} allGroups - All groups found so far
 * @param {Array} newGroups - Newly discovered groups in this batch
 * @param {Object} progress - Progress info { found, round, maxRounds, phase }
 */
function emitGroupsBatch(userId, allGroups, newGroups, progress) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('groups:batch', { allGroups, newGroups, progress });
    console.log(`[Socket.IO] Emitted groups:batch to ${room}: +${newGroups.length} new, total: ${allGroups.length}`);
}

/**
 * Emit group scanning progress update
 * @param {string} userId - User ID
 * @param {Object} progress - { phase, message, found, round, maxRounds }
 */
function emitGroupsProgress(userId, progress) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('groups:progress', progress);
}

/**
 * Emit group scanning completion
 * @param {string} userId - User ID
 * @param {Object} data - { totalGroups, source, updatedAt, message }
 */
function emitGroupsComplete(userId, data) {
    if (!io) return;
    const room = `user:${userId}`;
    io.to(room).emit('groups:complete', data);
    console.log(`[Socket.IO] Emitted groups:complete to ${room}: ${data.totalGroups} groups`);
}

module.exports.emitScheduleUpdate = emitScheduleUpdate;
module.exports.requestAiAnalysis = requestAiAnalysis;
module.exports.emitScanProgress = emitScanProgress;
module.exports.emitScanComplete = emitScanComplete;
module.exports.emitNewResults = emitNewResults;
module.exports.emitAnalysisResult = emitAnalysisResult;
module.exports.emitStatsUpdate = emitStatsUpdate;
module.exports.emitGroupsBatch = emitGroupsBatch;
module.exports.emitGroupsProgress = emitGroupsProgress;
module.exports.emitGroupsComplete = emitGroupsComplete;
module.exports.initializeSocketIO = initializeSocketIO;
