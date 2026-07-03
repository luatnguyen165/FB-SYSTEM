// services/aiScanService.js
// Re-exports from sub-modules for backward compatibility

const { wait, randomInt, resolveFilePath, normalizeFacebookPostUrl, extractGroupIdFromUrl, isTodayTimeString } = require('./aiScan/helpers');
const { callAiForAnalysis, callOpenAi, parseAiResponse, analyzeDbResult } = require('./aiScan/aiAnalysis');
const { crawlGroupPosts, downloadImageToLocal, savePostsToDb } = require('./aiScan/crawler');
const { humanLikeTyping, uploadFileToComment, sendTextComment, sendMediaComment, sendCommentItem, sendMultipleComments, commentOnPostLegacy, commentOnMatchingResults } = require('./aiScan/comments');
const { emitRealtimeResults, extractFbSessionFromPlaywright, crawlPhase, aiAnalyzePhase, runAiScan, isInTimeRange, runScheduledScans, playCommentForResult, enqueueScan, getQueueStatus, processQueue } = require('./aiScan/scheduler');

module.exports = {
    runAiScan,
    runScheduledScans,
    crawlPhase,
    aiAnalyzePhase,
    callOpenAi,
    parseAiResponse,
    scanGroupPosts: crawlGroupPosts, // backward compat
    commentOnPost: commentOnPostLegacy, // backward compat
    sendCommentItem,
    sendMultipleComments,
    playCommentForResult,
    enqueueScan,
    getQueueStatus,
    processQueue
};