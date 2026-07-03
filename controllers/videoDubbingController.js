// controllers/videoDubbingController.js
// Pure REST API — Video Dubbing
const path = require('path');
const fs = require('fs');
const { getUserApiConfig } = require('../utils/aiConfig');
const { createJob, getJob, getUserJobs, deleteJob } = require('../services/videoDubbing/jobManager');
const { runPipeline } = require('../services/videoDubbing/dubbingPipeline');
const { getVoicesForLang } = require('../services/videoDubbing/ttsEngine');
const { LANG_NAMES } = require('../services/videoDubbing/translatorEngine');

function getUserId(req) {
    return req.apiKeyUser?._id || req.session?.userId || req.user?._id;
}

/**
 * GET /api/dubbing/languages
 * Danh sách ngôn ngữ hỗ trợ
 */
const getLanguages = (_req, res) => {
    const languages = Object.entries(LANG_NAMES).map(([code, name]) => ({ code, name }));
    return res.json({ success: true, data: languages });
};

/**
 * GET /api/dubbing/voices/:lang
 * Danh sách giọng cho ngôn ngữ
 */
const getVoices = (req, res) => {
    const { lang } = req.params;
    const voices = getVoicesForLang(lang);
    return res.json({ success: true, data: voices });
};

/**
 * POST /api/dubbing/jobs
 * Tạo job mới + chạy pipeline
 * Body: { url, targetLang, targetVoice, sttEngine, ttsEngine, keepOriginalAudio, originalVolume }
 */
const createDubbingJob = async (req, res) => {
    const userId = getUserId(req);
    const { url, targetLang, targetVoice, sttEngine, ttsEngine, keepOriginalAudio, originalVolume } = req.body;

    if (!url) {
        return res.status(400).json({ success: false, error: 'url is required' });
    }

    try {
        const job = createJob(userId, url, targetLang || 'vi', targetVoice || '');

        runPipeline(job.id, {
            sttEngine: sttEngine || 'whisper-cli',
            ttsEngine: ttsEngine || 'edge-tts',
            keepOriginalAudio: keepOriginalAudio !== false,
            originalVolume: parseFloat(originalVolume) || 0.3,
        }).catch(err => {
            console.error(`[Dubbing] Pipeline error for job ${job.id}:`, err.message);
        });

        return res.status(201).json({
            success: true,
            data: {
                id: job.id,
                url: job.url,
                targetLang: job.targetLang,
                targetVoice: job.targetVoice,
                status: job.status,
                createdAt: job.createdAt,
            },
        });
    } catch (err) {
        console.error('[Dubbing] Create error:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/dubbing/jobs
 * Danh sách jobs của user
 */
const listJobs = (req, res) => {
    const userId = getUserId(req);
    const jobs = getUserJobs(userId);

    const data = jobs.map(j => ({
        id: j.id,
        url: j.url,
        originalTitle: j.originalTitle,
        targetLang: j.targetLang,
        targetVoice: j.targetVoice,
        status: j.status,
        progress: j.progress,
        statusText: j.statusText,
        error: j.error,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
    }));

    return res.json({ success: true, data });
};

/**
 * GET /api/dubbing/jobs/:jobId
 * Chi tiết 1 job
 */
const getJobDetail = (req, res) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) {
        return res.status(404).json({ success: false, error: 'Job not found' });
    }

    return res.json({
        success: true,
        data: {
            id: job.id,
            url: job.url,
            originalTitle: job.originalTitle,
            targetLang: job.targetLang,
            targetVoice: job.targetVoice,
            status: job.status,
            progress: job.progress,
            statusText: job.statusText,
            error: job.error,
            subtitles: job.subtitles,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
        },
    });
};

/**
 * GET /api/dubbing/jobs/:jobId/progress
 * SSE progress stream
 */
const getProgress = (req, res) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) {
        return res.status(404).json({ success: false, error: 'Job not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendData = (j) => {
        const payload = {
            id: j.id,
            status: j.status,
            progress: j.progress,
            statusText: j.statusText,
            originalTitle: j.originalTitle,
            error: j.error,
            resultReady: j.status === 'completed' && !!j.resultPath,
            subtitles: j.subtitles,
        };
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendData(job);

    if (job.status === 'completed' || job.status === 'failed') {
        res.end();
        return;
    }

    const interval = setInterval(() => {
        const currentJob = getJob(jobId);
        if (!currentJob) { clearInterval(interval); res.end(); return; }
        sendData(currentJob);
        if (currentJob.status === 'completed' || currentJob.status === 'failed') {
            clearInterval(interval);
            res.end();
        }
    }, 1500);

    req.on('close', () => clearInterval(interval));
};

/**
 * GET /api/dubbing/jobs/:jobId/download
 * Download video kết quả
 */
const downloadResult = (req, res) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    if (job.status !== 'completed' || !job.resultPath) {
        return res.status(400).json({ success: false, error: 'Video not ready' });
    }
    if (!fs.existsSync(job.resultPath)) {
        return res.status(404).json({ success: false, error: 'File not found on disk' });
    }

    const filename = path.basename(job.resultPath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'video/mp4');
    fs.createReadStream(job.resultPath).pipe(res);
};

/**
 * GET /api/dubbing/jobs/:jobId/srt
 * Download SRT đã dịch
 */
const downloadSrt = (req, res) => {
    const { jobId } = req.params;
    const job = getJob(jobId);

    if (!job || !job.translatedSrtPath || !fs.existsSync(job.translatedSrtPath)) {
        return res.status(404).json({ success: false, error: 'SRT not found' });
    }

    const filename = `${job.originalTitle || 'subtitle'}_${job.targetLang}.srt`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    fs.createReadStream(job.translatedSrtPath).pipe(res);
};

/**
 * DELETE /api/dubbing/jobs/:jobId
 * Xóa job + files tạm
 */
const removeJob = (req, res) => {
    const { jobId } = req.params;
    const deleted = deleteJob(jobId);
    if (!deleted) return res.status(404).json({ success: false, error: 'Job not found' });
    return res.json({ success: true });
};

/**
 * GET /api/dubbing/health
 * Health check — kiểm tra dependencies
 */
const healthCheck = (_req, res) => {
    const checks = { 'yt-dlp': false, ffmpeg: false, whisperCli: false, edgeTts: false };

    try {
        const { execSync } = require('child_process');
        execSync('yt-dlp --version', { timeout: 5000, stdio: 'pipe' });
        checks['yt-dlp'] = true;
    } catch (_) {}

    try {
        const { execSync } = require('child_process');
        execSync('ffmpeg -version', { timeout: 5000, stdio: 'pipe' });
        checks.ffmpeg = true;
    } catch (_) {}

    try {
        const { execSync } = require('child_process');
        execSync('whisper-cli --help', { timeout: 5000, stdio: 'pipe' });
        checks.whisperCli = true;
    } catch (_) {}

    try {
        const { execSync } = require('child_process');
        execSync('python -m edge_tts --list-voices', { timeout: 10000, stdio: 'pipe' });
        checks.edgeTts = true;
    } catch (_) {}

    const allOk = Object.values(checks).every(Boolean);

    return res.json({
        success: true,
        data: {
            ready: allOk,
            dependencies: checks,
        },
    });
};

module.exports = {
    getLanguages,
    getVoices,
    createDubbingJob,
    listJobs,
    getJobDetail,
    getProgress,
    downloadResult,
    downloadSrt,
    removeJob,
    healthCheck,
};
