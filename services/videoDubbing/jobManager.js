// services/videoDubbing/jobManager.js
// Quản lý jobs dubbing — track progress, status, results

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOBS_DIR = path.join(global.USER_DATA_DIR || __dirname, '..', '..', 'dubbing-jobs');

// Tạo thư mục jobs nếu chưa có
if (!fs.existsSync(JOBS_DIR)) {
    fs.mkdirSync(JOBS_DIR, { recursive: true });
}

/** @type {Map<string, DubbingJob>} */
const activeJobs = new Map();

/**
 * @typedef {Object} DubbingJob
 * @property {string} id
 * @property {string} userId
 * @property {string} url - Video URL gốc
 * @property {string} targetLang - ngôn ngữ đích (vi, en, ja, ko, ...)
 * @property {string} targetVoice - giọng TTS (vd: vi-VN-HoaiMyNeural)
 * @property {string} status - pending|downloading|extracting|transcribing|translating|tts|merging|completed|failed
 * @property {number} progress - 0-100
 * @property {string} statusText - Mô tả step hiện tại
 * @property {string} originalTitle
 * @property {string|null} videoPath - Đường dẫn video gốc
 * @property {string|null} audioPath - Đường dẫn audio extracted
 * @property {string|null} srtPath - Đường dẫn SRT (source)
 * @property {string|null} translatedSrtPath - Đường dẫn SRT (dịch)
 * @property {string|null} dubbedAudioPath - Đường dẫn audio TTS
 * @property {string|null} resultPath - Đường dẫn video kết quả
 * @property {Array} subtitles - [{start, end, text}] - segments đã translate
 * @property {string|null} error
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

const STATUS_MAP = {
    pending: { progress: 0, text: 'Đang chờ...' },
    downloading: { progress: 5, text: 'Đang tải video...' },
    extracting: { progress: 20, text: 'Đang trích xuất audio...' },
    transcribing: { progress: 30, text: 'Đang nhận diện giọng nói...' },
    translating: { progress: 50, text: 'Đang dịch nội dung...' },
    tts: { progress: 70, text: 'Đang tạo giọng đọc...' },
    merging: { progress: 85, text: 'Đang ghép video + audio...' },
    completed: { progress: 100, text: 'Hoàn thành!' },
    failed: { progress: 0, text: 'Thất bại' },
};

/**
 * Tạo job mới
 */
function createJob(userId, url, targetLang = 'vi', targetVoice = '') {
    const id = crypto.randomBytes(8).toString('hex');
    const job = {
        id,
        userId,
        url,
        targetLang,
        targetVoice,
        status: 'pending',
        progress: 0,
        statusText: 'Đang chờ...',
        originalTitle: '',
        videoPath: null,
        audioPath: null,
        srtPath: null,
        translatedSrtPath: null,
        dubbedAudioPath: null,
        resultPath: null,
        subtitles: [],
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    activeJobs.set(id, job);
    saveJob(job);
    return job;
}

/**
 * Cập nhật status job
 */
function updateJob(jobId, updates) {
    const job = activeJobs.get(jobId);
    if (!job) return null;

    Object.assign(job, updates, { updatedAt: new Date() });

    // Auto-update progress từ status nếu không set progress rõ ràng
    if (updates.status && !updates.progress && STATUS_MAP[updates.status]) {
        job.progress = STATUS_MAP[updates.status].progress;
        job.statusText = STATUS_MAP[updates.status].text;
    }

    activeJobs.set(jobId, job);
    saveJob(job);
    return job;
}

/**
 * Lấy job theo ID
 */
function getJob(jobId) {
    return activeJobs.get(jobId) || null;
}

/**
 * Lấy tất cả jobs của user
 */
function getUserJobs(userId) {
    const jobs = [];
    for (const [, job] of activeJobs) {
        if (job.userId === String(userId)) {
            jobs.push(job);
        }
    }
    // Sắp xếp mới nhất lên đầu
    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return jobs;
}

/**
 * Xóa job
 */
function deleteJob(jobId) {
    const job = activeJobs.get(jobId);
    if (!job) return false;

    // Xóa files tạm
    const filesToDelete = [
        job.videoPath, job.audioPath, job.srtPath,
        job.translatedSrtPath, job.dubbedAudioPath,
    ];
    for (const f of filesToDelete) {
        if (f && fs.existsSync(f)) {
            try { fs.unlinkSync(f); } catch (_) {}
        }
    }

    // Xóa job file
    const jobFile = path.join(JOBS_DIR, `${jobId}.json`);
    if (fs.existsSync(jobFile)) {
        try { fs.unlinkSync(jobFile); } catch (_) {}
    }

    activeJobs.delete(jobId);
    return true;
}

/**
 * Lưu job state ra JSON file (persistence)
 */
function saveJob(job) {
    try {
        const jobFile = path.join(JOBS_DIR, `${job.id}.json`);
        fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), 'utf-8');
    } catch (_) {}
}

/**
 * Load tất cả jobs từ disk (khi restart server)
 */
function loadJobsFromDisk() {
    try {
        const files = fs.readdirSync(JOBS_DIR).filter(f => f.endsWith('.json'));
        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, file), 'utf-8'));
                // Reset các job đang chạy về failed (server restart giữa chừng)
                if (['pending', 'downloading', 'extracting', 'transcribing', 'translating', 'tts', 'merging'].includes(data.status)) {
                    data.status = 'failed';
                    data.error = 'Server restart — job bị gián đoạn';
                }
                activeJobs.set(data.id, data);
            } catch (_) {}
        }
        console.log(`[Dubbing] Loaded ${activeJobs.size} jobs from disk`);
    } catch (err) {
        console.error('[Dubbing] Error loading jobs:', err.message);
    }
}

module.exports = {
    createJob,
    updateJob,
    getJob,
    getUserJobs,
    deleteJob,
    loadJobsFromDisk,
};
