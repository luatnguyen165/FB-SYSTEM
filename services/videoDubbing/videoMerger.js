// services/videoDubbing/videoMerger.js
// Ghép video gốc + dubbed audio thành video hoàn chỉnh

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Tạo dubbed audio track từ các TTS segments
 * Ghép tất cả audio segments thành 1 file audio duy nhất,
 * đặt đúng vị trí thời gian (silence padding theo segment timeline)
 *
 * @param {Array} segments - [{startTimeMs, endTimeMs, audioPath}]
 * @param {string} outputDir
 * @returns {string} Đường dẫn file audio đã merge
 */
function mergeTtsSegments(segments, outputDir) {
    const segmentsWithAudio = segments.filter(s => s.audioPath && fs.existsSync(s.audioPath));
    if (segmentsWithAudio.length === 0) {
        throw new Error('Không có audio segment nào để merge');
    }

    const mergedAudioPath = path.join(outputDir, 'dubbed_audio_full.mp3');

    // Tạo ffmpeg filter_complex để đặt mỗi segment đúng vị trí timeline
    const inputs = [];
    const filterParts = [];

    for (let i = 0; i < segmentsWithAudio.length; i++) {
        const seg = segmentsWithAudio[i];
        inputs.push(`-i "${seg.audioPath.replace(/\\/g, '/')}"`);

        const delayMs = seg.startTimeMs;
        // Delay audio segment về đúng vị trí timeline
        filterParts.push(`[${i}]adelay=${delayMs}|${delayMs},aresample=44100[a${i}]`);
    }

    // Merge tất cả delayed audio streams
    const mergeInputs = segmentsWithAudio.map((_, i) => `[a${i}]`).join('');
    filterParts.push(`${mergeInputs}amix=inputs=${segmentsWithAudio.length}:duration=longest:dropout_transition=0[out]`);

    const filterComplex = filterParts.join(';');

    const cmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex.replace(/"/g, '\\"')}" -map "[out]" -ar 44100 -ac 2 "${mergedAudioPath.replace(/\\/g, '/')}"`;

    console.log(`[Dubbing] Merging ${segmentsWithAudio.length} TTS segments into single audio track...`);

    try {
        execSync(cmd, { timeout: 300000 }); // 5 phút
    } catch (err) {
        throw new Error(`Lỗi merge TTS segments: ${err.message}`);
    }

    if (!fs.existsSync(mergedAudioPath)) {
        throw new Error('File merged audio không được tạo ra');
    }

    console.log(`[Dubbing] Merged audio: ${mergedAudioPath}`);
    return mergedAudioPath;
}

/**
 * Ghép video gốc + dubbed audio → video kết quả
 *
 * @param {string} videoPath - Video gốc
 * @param {string} dubbedAudioPath - Audio đã merge
 * @param {string} outputDir
 * @param {Object} options - { keepOriginal: true, originalVolume: 0.3 }
 * @returns {string} Đường dẫn video kết quả
 */
function mergeVideoAudio(videoPath, dubbedAudioPath, outputDir, options = {}) {
    if (!fs.existsSync(videoPath)) {
        throw new Error(`Video gốc không tồn tại: ${videoPath}`);
    }
    if (!fs.existsSync(dubbedAudioPath)) {
        throw new Error(`Dubbed audio không tồn tại: ${dubbedAudioPath}`);
    }

    const baseName = path.basename(videoPath, path.extname(videoPath));
    const outputPath = path.join(outputDir, `${baseName}_dubbed.mp4`);

    const keepOriginal = options.keepOriginal !== false; // mặc định giữ audio gốc
    const originalVolume = options.originalVolume || 0.3; // volume audio gốc (0-1)

    let cmd;

    if (keepOriginal) {
        // Mix: audio gốc (volume thấp) + dubbed audio
        // -map 0:v:0 = video track từ input 0 (video gốc)
        // -map 2:a:0 = audio track từ input 2 (dubbed audio merged)
        // -filter_complex: lấy audio gốc từ input 0, giảm volume, rồi mix với dubbed
        cmd = `ffmpeg -y -i "${videoPath.replace(/\\/g, '/')}" -i "${dubbedAudioPath.replace(/\\/g, '/')}" -filter_complex "[0:a]volume=${originalVolume}[bg];[bg][1:a]amix=inputs=2:duration=first:dropout_transition=2[outa]" -map 0:v -map "[outa]" -c:v copy -c:a aac -b:a 192k -shortest "${outputPath.replace(/\\/g, '/')}"`;
    } else {
        // Chỉ dùng dubbed audio, bỏ audio gốc
        cmd = `ffmpeg -y -i "${videoPath.replace(/\\/g, '/')}" -i "${dubbedAudioPath.replace(/\\/g, '/')}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest "${outputPath.replace(/\\/g, '/')}"`;
    }

    console.log(`[Dubbing] Merging video + audio: ${keepOriginal ? 'mix mode' : 'replace mode'}`);

    try {
        execSync(cmd, { timeout: 600000 }); // 10 phút timeout
    } catch (err) {
        throw new Error(`Lỗi merge video+audio: ${err.message}`);
    }

    if (!fs.existsSync(outputPath)) {
        throw new Error('File video kết quả không được tạo ra');
    }

    const stats = fs.statSync(outputPath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[Dubbing] Final video: ${outputPath} (${sizeMB} MB)`);

    return outputPath;
}

module.exports = { mergeTtsSegments, mergeVideoAudio };
