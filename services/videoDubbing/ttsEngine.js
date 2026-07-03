// services/videoDubbing/ttsEngine.js
// Text-to-Speech engine — pluggable interface
// Default: edge-tts (Microsoft Edge TTS, miễn phí, 300+ giọng)
//
// TÙY CHỌN CẤU HÌNH:
//   1. edge-tts: python -m edge_tts --text "..." --voice "vi-VN-HoaiMyNeural" --write-media output.mp3
//   2. gTTS: gtts-cli "text" --lang vi --output output.mp3
//   3. Script custom: gọi Python script riêng
//
// Để chuyển engine, sửa hàm generateTts() bên dưới

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/** Danh sách giọng theo ngôn ngữ (edge-tts) */
const VOICE_MAP = {
    vi: [
        { id: 'vi-VN-HoaiMyNeural', name: 'Hồ Mai (Nữ)', gender: 'female' },
        { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Nam)', gender: 'male' },
    ],
    en: [
        { id: 'en-US-JennyNeural', name: 'Jenny (Nữ, US)', gender: 'female' },
        { id: 'en-US-GuyNeural', name: 'Guy (Nam, US)', gender: 'male' },
        { id: 'en-GB-SoniaNeural', name: 'Sonia (Nữ, UK)', gender: 'female' },
        { id: 'en-GB-RyanNeural', name: 'Ryan (Nam, UK)', gender: 'male' },
    ],
    zh: [
        { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao (Nữ)', gender: 'female' },
        { id: 'zh-CN-YunxiNeural', name: 'Yunxi (Nam)', gender: 'male' },
    ],
    ja: [
        { id: 'ja-JP-NanamiNeural', name: 'Nanami (Nữ)', gender: 'female' },
        { id: 'ja-JP-KeitaNeural', name: 'Keita (Nam)', gender: 'male' },
    ],
    ko: [
        { id: 'ko-KR-SunHiNeural', name: 'SunHi (Nữ)', gender: 'female' },
        { id: 'ko-KR-InJoonNeural', name: 'InJoon (Nam)', gender: 'male' },
    ],
    th: [
        { id: 'th-TH-PremwadeeNeural', name: 'Premwadee (Nữ)', gender: 'female' },
        { id: 'th-TH-PattaraNeural', name: 'Pattara (Nam)', gender: 'male' },
    ],
    fr: [
        { id: 'fr-FR-DeniseNeural', name: 'Denise (Nữ)', gender: 'female' },
        { id: 'fr-FR-HenriNeural', name: 'Henri (Nam)', gender: 'male' },
    ],
    de: [
        { id: 'de-DE-KatjaNeural', name: 'Katja (Nữ)', gender: 'female' },
        { id: 'de-DE-ConradNeural', name: 'Conrad (Nam)', gender: 'male' },
    ],
    es: [
        { id: 'es-ES-ElviraNeural', name: 'Elvira (Nữ)', gender: 'female' },
        { id: 'es-ES-AlvaroNeural', name: 'Alvaro (Nam)', gender: 'male' },
    ],
    id: [
        { id: 'id-ID-GadisNeural', name: 'Gadis (Nữ)', gender: 'female' },
        { id: 'id-ID-ArdiNeural', name: 'Ardi (Nam)', gender: 'male' },
    ],
};

/**
 * Lấy danh sách giọng cho ngôn ngữ
 */
function getVoicesForLang(lang) {
    return VOICE_MAP[lang] || VOICE_MAP['en'];
}

/**
 * Tạo audio từ text segments bằng TTS
 * Mỗi segment tạo 1 file audio riêng → sau đó merge
 *
 * @param {Array} segments - [{start, end, startTimeMs, endTimeMs, text}]
 * @param {string} outputDir - Thư mục output
 * @param {Object} options - { lang: 'vi', voice: 'vi-VN-HoaiMyNeural', engine: 'edge-tts' }
 * @returns {Array} segments với field audioPath được thêm vào
 */
async function generateTts(segments, outputDir, options = {}) {
    const lang = options.lang || 'vi';
    const voice = options.voice || getDefaultVoice(lang);
    const engine = options.engine || 'edge-tts';

    if (engine === 'gtts') {
        return await generateWithGtts(segments, outputDir, lang);
    }

    // Default: edge-tts
    return await generateWithEdgeTts(segments, outputDir, voice);
}

/**
 * Lấy giọng mặc định cho ngôn ngữ
 */
function getDefaultVoice(lang) {
    const voices = VOICE_MAP[lang];
    return voices && voices[0] ? voices[0].id : 'en-US-JennyNeural';
}

/**
 * Tạo audio bằng edge-tts (Microsoft Edge TTS)
 * Tạo file audio cho từng segment riêng biệt
 */
async function generateWithEdgeTts(segments, outputDir, voice) {
    console.log(`[Dubbing] TTS: edge-tts, voice=${voice}, ${segments.length} segments`);

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg.text || !seg.text.trim()) continue;

        const audioPath = path.join(outputDir, `tts_segment_${String(i).padStart(4, '0')}.mp3`);

        // Escape text cho shell
        const escapedText = seg.text.replace(/"/g, '\\"').replace(/'/g, "\\'");

        const cmd = `python -m edge_tts --text "${escapedText}" --voice "${voice}" --write-media "${audioPath.replace(/\\/g, '/')}"`;

        try {
            execSync(cmd, { timeout: 30000, stdio: 'pipe' });
            seg.audioPath = audioPath;
        } catch (err) {
            console.warn(`[Dubbing] TTS failed for segment ${i}: ${err.message}`);
            seg.audioPath = null;
        }

        // Progress mỗi 10 segments
        if ((i + 1) % 10 === 0 || i === segments.length - 1) {
            console.log(`[Dubbing] TTS progress: ${i + 1}/${segments.length}`);
        }
    }

    return segments;
}

/**
 * Tạo audio bằng gTTS (Google TTS) — fallback
 */
async function generateWithGtts(segments, outputDir, lang) {
    console.log(`[Dubbing] TTS: gtts, lang=${lang}, ${segments.length} segments`);

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg.text || !seg.text.trim()) continue;

        const audioPath = path.join(outputDir, `tts_segment_${String(i).padStart(4, '0')}.mp3`);
        const escapedText = seg.text.replace(/"/g, '\\"');

        const cmd = `python -c "from gtts import gTTS; gTTS('${escapedText.replace(/'/g, "\\'")}', lang='${lang}').save('${audioPath.replace(/\\/g, '/')}')"`;

        try {
            execSync(cmd, { timeout: 30000, stdio: 'pipe' });
            seg.audioPath = audioPath;
        } catch (err) {
            console.warn(`[Dubbing] gTTS failed for segment ${i}: ${err.message}`);
            seg.audioPath = null;
        }
    }

    return segments;
}

module.exports = { generateTts, getVoicesForLang, getDefaultVoice, VOICE_MAP };
