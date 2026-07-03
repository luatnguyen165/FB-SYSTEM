// services/videoDubbing/dubbingPipeline.js
// Main pipeline orchestrator — điều phối toàn bộ quy trình dubbing

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { createJob, updateJob, getJob } = require('./jobManager');
const { extractAudio } = require('./audioExtractor');
const { transcribe, writeSrtFile } = require('./sttEngine');
const { translateSegments } = require('./translatorEngine');
const { generateTts } = require('./ttsEngine');
const { mergeTtsSegments, mergeVideoAudio } = require('./videoMerger');

const BASE_DIR = global.USER_DATA_DIR || path.join(__dirname, '..', '..');
const JOBS_OUTPUT_DIR = path.join(BASE_DIR, 'dubbing-output');

// Đảm bảo thư mục output tồn tại
if (!fs.existsSync(JOBS_OUTPUT_DIR)) {
    fs.mkdirSync(JOBS_OUTPUT_DIR, { recursive: true });
}

/**
 * Tạo thư mục output cho job
 */
function createJobDir(jobId) {
    const dir = path.join(JOBS_OUTPUT_DIR, jobId);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

/**
 * Download video bằng yt-dlp
 */
function downloadVideo(url, outputDir) {
    console.log(`[Dubbing] Downloading video: ${url}`);

    // Lấy title
    let title = 'video';
    try {
        const titleCmd = `yt-dlp --print "title" --no-warnings "${url.replace(/"/g, '\\"')}"`;
        title = execSync(titleCmd, { timeout: 30000 }).toString().trim().replace(/[\\/:*?"<>|]/g, '_');
    } catch (_) {}

    const outputPath = path.join(outputDir, `${title}.mp4`);
    const safeUrl = url.replace(/"/g, '\\"');
    const cmd = `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4 --no-warnings -o "${outputPath.replace(/\\/g, '/')}" "${safeUrl}"`;

    execSync(cmd, { timeout: 600000 }); // 10 phút

    // Kiểm tra file (yt-dlp có thể rename)
    if (fs.existsSync(outputPath)) return { path: outputPath, title };

    // Fallback: tìm file mp4 trong outputDir
    const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp4'));
    if (files.length > 0) {
        return { path: path.join(outputDir, files[0]), title: files[0].replace('.mp4', '') };
    }

    throw new Error('Video không được tải xuống thành công');
}

/**
 * Chạy toàn bộ pipeline dubbing
 * @param {string} jobId
 * @param {Object} options - { sttEngine, ttsEngine, ttsVoice, keepOriginalAudio, originalVolume }
 */
async function runPipeline(jobId, options = {}) {
    const job = getJob(jobId);
    if (!job) throw new Error(`Job ${jobId} không tồn tại`);

    const jobDir = createJobDir(jobId);

    try {
        // ====== STEP 1: Download video ======
        updateJob(jobId, { status: 'downloading' });
        const { path: videoPath, title } = downloadVideo(job.url, jobDir);
        updateJob(jobId, {
            videoPath,
            originalTitle: title,
            status: 'extracting',
        });

        // ====== STEP 2: Extract audio ======
        updateJob(jobId, { status: 'extracting' });
        const audioPath = extractAudio(videoPath, jobDir);
        updateJob(jobId, { audioPath, status: 'transcribing' });

        // ====== STEP 3: Speech-to-Text ======
        updateJob(jobId, { status: 'transcribing' });
        const sttResult = await transcribe(audioPath, jobDir, {
            lang: 'zh', // Luôn detect source language là Chinese
            engine: options.sttEngine || 'whisper-cli',
        });
        updateJob(jobId, {
            srtPath: sttResult.srtPath,
            status: 'translating',
        });

        // ====== STEP 4: Translation ======
        updateJob(jobId, { status: 'translating' });
        const translatedSegments = await translateSegments(
            sttResult.segments,
            job.targetLang,
            'zh',
            job.userId
        );

        // Ghi SRT đã dịch
        const translatedSrtPath = path.join(jobDir, 'translated.srt');
        writeSrtFile(translatedSegments, translatedSrtPath);
        updateJob(jobId, {
            translatedSrtPath,
            subtitles: translatedSegments,
            status: 'tts',
        });

        // ====== STEP 5: TTS — Tạo giọng đọc ======
        updateJob(jobId, { status: 'tts' });
        const ttsSegments = await generateTts(translatedSegments, jobDir, {
            lang: job.targetLang,
            voice: job.targetVoice,
            engine: options.ttsEngine || 'edge-tts',
        });

        // ====== STEP 6: Merge TTS segments → single audio ======
        updateJob(jobId, { status: 'merging' });
        const dubbedAudioPath = mergeTtsSegments(ttsSegments, jobDir);
        updateJob(jobId, { dubbedAudioPath });

        // ====== STEP 7: Merge video + audio → final ======
        const resultPath = mergeVideoAudio(videoPath, dubbedAudioPath, jobDir, {
            keepOriginal: options.keepOriginalAudio !== false,
            originalVolume: options.originalVolume || 0.3,
        });

        updateJob(jobId, {
            resultPath,
            status: 'completed',
        });

        console.log(`[Dubbing] Job ${jobId} completed: ${resultPath}`);
        return getJob(jobId);

    } catch (err) {
        console.error(`[Dubbing] Job ${jobId} failed:`, err.message);
        updateJob(jobId, {
            status: 'failed',
            error: err.message,
        });
        throw err;
    }
}

module.exports = { runPipeline, downloadVideo, createJobDir };
