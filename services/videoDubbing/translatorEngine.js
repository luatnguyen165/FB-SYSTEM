// services/videoDubbing/translatorEngine.js
// Dịch subtitle từ source language → target language bằng AI

const { getUserApiConfig } = require('../../utils/aiConfig');
const { callAiForAnalysis } = require('../aiScan/aiAnalysis');

const LANG_NAMES = {
    zh: 'Chinese',
    vi: 'Vietnamese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    th: 'Thai',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    pt: 'Portuguese',
    id: 'Indonesian',
    ms: 'Malay',
    ar: 'Arabic',
    hi: 'Hindi',
    ru: 'Russian',
};

/**
 * Dịch array segments từ sourceLang → targetLang
 * Xử lý batch để tránh exceed token limit
 *
 * @param {Array} segments - [{start, end, startTimeMs, endTimeMs, text}]
 * @param {string} targetLang - mã ngôn ngữ đích (vi, en, ...)
 * @param {string} sourceLang - mã ngôn ngữ nguồn (mặc định: zh)
 * @param {string} userId - để lấy API config
 * @returns {Array} segments đã dịch, giữ nguyên timeline
 */
async function translateSegments(segments, targetLang = 'vi', sourceLang = 'zh', userId = null) {
    if (!segments || segments.length === 0) {
        throw new Error('Không có segment nào để dịch');
    }

    const targetName = LANG_NAMES[targetLang] || targetLang;
    const sourceName = LANG_NAMES[sourceLang] || sourceLang;

    // Lấy API config từ user settings
    let apiConfig = { apiKey: process.env.OPENAI_API_KEY, provider: 'openai', model: 'gpt-4o-mini' };
    if (userId) {
        try {
            apiConfig = await getUserApiConfig(userId);
        } catch (_) {}
    }

    // Batch size: mỗi batch ~30 segments (để tránh token limit)
    const BATCH_SIZE = 30;
    const translatedSegments = [];

    for (let i = 0; i < segments.length; i += BATCH_SIZE) {
        const batch = segments.slice(i, i + BATCH_SIZE);
        const batchText = batch.map((seg, idx) => `[${idx}] ${seg.text}`).join('\n');

        const systemPrompt = `You are a professional subtitle translator. Translate the following ${sourceName} subtitle segments into ${targetName}.

Rules:
- Translate naturally and accurately, maintaining the original meaning
- Keep the numbering [0], [1], etc. intact
- Output ONLY the translated lines in the same format: [number] translated text
- Do NOT add explanations, notes, or any extra text
- Each line must correspond to the same line number in input
- Preserve proper nouns, brand names as-is if commonly used in ${targetName}`;

        const prompt = systemPrompt + '\n\n' + batchText;

        console.log(`[Dubbing] Translating batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(segments.length / BATCH_SIZE)} (${batch.length} segments)`);

        const result = await callAiForAnalysis(userId, {}, prompt, {
            openaiApiKey: apiConfig.apiKey,
            model: apiConfig.model,
            aiProvider: apiConfig.provider || 'openai',
        });

        // Parse kết quả
        const lines = result.split('\n').filter(l => l.trim());
        for (const seg of batch) {
            const pattern = new RegExp(`^\\[?${batch.indexOf(seg)}\\]?[.:]?\\s*(.+)`);
            const matched = lines.find(l => l.match(pattern));
            const translatedText = matched
                ? matched.replace(/^\[?\d+\]?\s*[.:]?\s*/, '').trim()
                : seg.text; // Fallback: giữ text gốc nếu không match

            translatedSegments.push({
                ...seg,
                text: translatedText,
            });
        }
    }

    console.log(`[Dubbing] Translated ${translatedSegments.length} segments`);
    return translatedSegments;
}

module.exports = { translateSegments, LANG_NAMES };
