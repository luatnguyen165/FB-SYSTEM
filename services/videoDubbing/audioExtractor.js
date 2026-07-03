// services/videoDubbing/audioExtractor.js
// Trích xuất audio từ video bằng ffmpeg

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Extract audio từ video file → WAV 16kHz mono (tối ưu cho Whisper STT)
 * @param {string} videoPath - Đường dẫn video
 * @param {string} outputDir - Thư mục output
 * @returns {string} Đường dẫn file audio
 */
function extractAudio(videoPath, outputDir) {
    if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file không tồn tại: ${videoPath}`);
    }

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const audioPath = path.join(outputDir, `${baseName}_audio.wav`);

    // ffmpeg: extract audio, convert to WAV 16kHz mono (Whisper optimal format)
    const cmd = `ffmpeg -y -i "${videoPath.replace(/\\/g, '/')}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${audioPath.replace(/\\/g, '/')}"`;

    try {
        execSync(cmd, { timeout: 120000 }); // 2 phút timeout
    } catch (err) {
        throw new Error(`Lỗi extract audio: ${err.message}`);
    }

    if (!fs.existsSync(audioPath)) {
        throw new Error('File audio không được tạo ra sau khi extract');
    }

    console.log(`[Dubbing] Extracted audio: ${audioPath}`);
    return audioPath;
}

/**
 * Extract audio từ video → MP3 (dùng cho dubbed audio merge)
 * @param {string} videoPath
 * @param {string} outputDir
 * @returns {string}
 */
function extractAudioMp3(videoPath, outputDir) {
    if (!fs.existsSync(videoPath)) {
        throw new Error(`Video file không tồn tại: ${videoPath}`);
    }

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const audioPath = path.join(outputDir, `${baseName}_audio.mp3`);

    const cmd = `ffmpeg -y -i "${videoPath.replace(/\\/g, '/')}" -vn -acodec libmp3lame -ar 44100 -ac 2 "${audioPath.replace(/\\/g, '/')}"`;

    try {
        execSync(cmd, { timeout: 120000 });
    } catch (err) {
        throw new Error(`Lỗi extract audio MP3: ${err.message}`);
    }

    return audioPath;
}

module.exports = { extractAudio, extractAudioMp3 };
