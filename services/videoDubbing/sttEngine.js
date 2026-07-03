// services/videoDubbing/sttEngine.js
// Speech-to-Text engine — pluggable interface
// Default: gọi whisper CLI (whisper.cpp hoặc faster-whisper)
//
// TÙY CHỌN CẤU HÌNH:
//   1. whisper.cpp: whisper-cli -m models/ggml-base.bin -f audio.wav --output-srt
//   2. faster-whisper: python -m faster_whisper ... (hoặc script Python)
//   3. OpenAI Whisper API: gọi HTTP trực tiếp (sử dụng OPENAI_API_KEY)
//
// Để chuyển engine, sửa hàm transcribe() bên dưới

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

/**
 * Parse SRT content thành array segments
 * @param {string} srtContent
 * @returns {Array<{index: number, start: string, end: string, startTimeMs: number, endTimeMs: number, text: string}>}
 */
function parseSrt(srtContent) {
    const segments = [];
    const blocks = srtContent.trim().split(/\n\n+/);

    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 3) continue;

        const index = parseInt(lines[0], 10);
        const timeLine = lines[1];
        const text = lines.slice(2).join(' ').trim();

        // Parse timestamp: "00:01:23,456 --> 00:01:25,789"
        const timeMatch = timeLine.match(
            /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
        );
        if (!timeMatch) continue;

        const startTimeMs =
            parseInt(timeMatch[1]) * 3600000 +
            parseInt(timeMatch[2]) * 60000 +
            parseInt(timeMatch[3]) * 1000 +
            parseInt(timeMatch[4]);

        const endTimeMs =
            parseInt(timeMatch[5]) * 3600000 +
            parseInt(timeMatch[6]) * 60000 +
            parseInt(timeMatch[7]) * 1000 +
            parseInt(timeMatch[8]);

        segments.push({
            index,
            start: timeLine.split('-->')[0].trim(),
            end: timeLine.split('-->')[1].trim(),
            startTimeMs,
            endTimeMs,
            text,
        });
    }

    return segments;
}

/**
 * Convert ms → SRT timestamp "HH:MM:SS,mmm"
 */
function msToSrtTimestamp(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mill = ms % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mill).padStart(3, '0')}`;
}

/**
 * Ghi SRT file từ segments array
 */
function writeSrtFile(segments, outputPath) {
    const content = segments.map((seg, i) => {
        return `${i + 1}\n${seg.start} --> ${seg.end}\n${seg.text}\n`;
    }).join('\n');
    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`[Dubbing] SRT written: ${outputPath} (${segments.length} segments)`);
}

/**
 * Main transcribe function — nhận audio, trả về SRT segments
 * @param {string} audioPath - Đường dẫn file audio (WAV)
 * @param {string} outputDir - Thư mục để lưu SRT
 * @param {Object} options - { lang: 'zh', engine: 'whisper-cli|openai-api' }
 * @returns {Array<{start, end, startTimeMs, endTimeMs, text}>}
 */
async function transcribe(audioPath, outputDir, options = {}) {
    const lang = options.lang || 'zh';
    const engine = options.engine || 'whisper-cli';

    if (engine === 'openai-api') {
        return await transcribeWithOpenAI(audioPath, lang);
    }

    // Default: whisper CLI (whisper.cpp / faster-whisper CLI)
    return await transcribeWithWhisperCli(audioPath, outputDir, lang);
}

/**
 * Transcribe bằng whisper CLI (whisper.cpp hoặc faster-whisper)
 * Output: generates .srt file in outputDir
 */
async function transcribeWithWhisperCli(audioPath, outputDir, lang) {
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const srtPath = path.join(outputDir, `${baseName}.srt`);

    // Thử whisper-cli trước (whisper.cpp)
    // Nếu bạn dùng faster-whisper, đổi command bên dưới
    const whisperModel = process.env.WHISPER_MODEL_PATH || 'models/ggml-base.bin';
    const cmd = `whisper-cli -m "${whisperModel}" -f "${audioPath.replace(/\\/g, '/')}" --language ${lang} --output-srt --output-dir "${outputDir.replace(/\\/g, '/')}"`;

    console.log(`[Dubbing] Running STT: whisper-cli (lang=${lang})`);

    try {
        execSync(cmd, { timeout: 600000, stdio: 'pipe' }); // 10 phút timeout
    } catch (err) {
        // Fallback: thử python faster-whisper
        console.log(`[Dubbing] whisper-cli failed, trying faster-whisper fallback...`);
        const pyCmd = `python -c "
import sys
sys.stdout.reconfigure(encoding='utf-8')
from faster_whisper import WhisperModel
model = WhisperModel('base', device='cpu', compute_type='int8')
segments, info = model.transcribe('${audioPath.replace(/\\/g, '/')}', language='${lang}', beam_size=5)
with open('${srtPath.replace(/\\/g, '/')}', 'w', encoding='utf-8') as f:
    for i, seg in enumerate(segments, 1):
        start_h, start_m = divmod(int(seg.start), 3600)
        start_m, start_s = divmod(start_m, 60)
        start_ms = int((seg.start % 1) * 1000)
        end_h, end_m = divmod(int(seg.end), 3600)
        end_m, end_s = divmod(end_m, 60)
        end_ms = int((seg.end % 1) * 1000)
        f.write(f'{i}\n')
        f.write(f'{start_h:02d}:{start_m:02d}:{start_s:02d},{start_ms:03d} --> {end_h:02d}:{end_m:02d}:{end_s:02d},{end_ms:03d}\n')
        f.write(f'{seg.text.strip()}\n\n')
"`;
        try {
            execSync(pyCmd, { timeout: 600000, stdio: 'pipe' });
        } catch (pyErr) {
            throw new Error(`STT failed (both whisper-cli and faster-whisper): ${pyErr.message}`);
        }
    }

    // Đọc SRT result
    if (!fs.existsSync(srtPath)) {
        throw new Error('SRT file không được tạo ra sau khi transcribe');
    }

    const srtContent = fs.readFileSync(srtPath, 'utf-8');
    const segments = parseSrt(srtContent);
    console.log(`[Dubbing] Transcribed ${segments.length} segments from audio`);

    return { segments, srtPath };
}

/**
 * Transcribe bằng OpenAI Whisper API
 * @param {string} audioPath
 * @param {string} lang
 * @returns {{segments: Array, srtPath: string|null}}
 */
async function transcribeWithOpenAI(audioPath, lang) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Cần OPENAI_API_KEY để dùng OpenAI Whisper API');

    console.log(`[Dubbing] Running STT: OpenAI Whisper API (lang=${lang})`);

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', 'whisper-1');
    form.append('language', lang);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');

    const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            ...form.getHeaders(),
        },
        timeout: 300000, // 5 phút
        maxContentLength: 25 * 1024 * 1024,
    });

    const data = response.data;
    // Convert verbose_json segments → SRT format
    const segments = (data.segments || []).map((seg) => {
        const startMs = Math.round(seg.start * 1000);
        const endMs = Math.round(seg.end * 1000);
        return {
            index: 0,
            start: msToSrtTimestamp(startMs),
            end: msToSrtTimestamp(endMs),
            startTimeMs: startMs,
            endTimeMs: endMs,
            text: seg.text.trim(),
        };
    });

    // Also save as SRT file
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const srtPath = path.join(path.dirname(audioPath), `${baseName}_openai.srt`);
    writeSrtFile(segments, srtPath);

    return { segments, srtPath };
}

module.exports = { transcribe, parseSrt, writeSrtFile, msToSrtTimestamp };
