const path = require('path');

let io = null;

// Store pending AI analysis requests (keyed by requestId)
// Maps requestId -> { resolve, reject, timeout }
const pendingAiAnalysis = new Map();

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
        
        socket.on('disconnect', () => {
            console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
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

module.exports.emitScheduleUpdate = emitScheduleUpdate;
module.exports.requestAiAnalysis = requestAiAnalysis;
module.exports.emitScanProgress = emitScanProgress;
module.exports.emitScanComplete = emitScanComplete;
module.exports.emitNewResults = emitNewResults;
module.exports.emitAnalysisResult = emitAnalysisResult;
module.exports.emitStatsUpdate = emitStatsUpdate;
module.exports.initializeSocketIO = initializeSocketIO;
