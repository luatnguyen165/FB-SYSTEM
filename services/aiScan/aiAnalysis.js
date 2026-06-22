// services/aiScan/aiAnalysis.js
const axios = require('axios');

/**
 * Gọi AI dựa trên provider được cấu hình trong config.
 * Provider hỗ trợ: 'openai' | 'openai-compatible' | 'anthropic'.
 * Puter.js đã bỏ - chỉ gọi backend provider đã chọn.
 *
 * @param {string} userId
 * @param {object} postData
 * @param {string} prompt
 * @param {object} config - { configId, openaiApiKey, model, aiProvider, openaiCompatibleApiKey, openaiCompatibleBaseUrl, openaiCompatibleModel, anthropicApiKey, anthropicModel }
 */
async function callAiForAnalysis(userId, postData, prompt, config = {}) {
    const aiProvider = config.aiProvider || 'openai';

    if (aiProvider === 'openai') {
        const apiKey = config.openaiApiKey || '';
        if (!apiKey) throw new Error('Chưa cấu hình OpenAI API key');
        return await callOpenAi(prompt, apiKey, config.model || 'gpt-4o-mini');
    }

    if (aiProvider === 'openai-compatible') {
        const apiKey = config.openaiCompatibleApiKey || '';
        const baseUrl = config.openaiCompatibleBaseUrl || '';
        const model = config.openaiCompatibleModel || config.model || 'gpt-3.5-turbo';
        if (!apiKey) throw new Error('Chưa cấu hình API key cho OpenAI Compatible');
        if (!baseUrl) throw new Error('Chưa cấu hình Base URL cho OpenAI Compatible');
        return await callOpenAiCompatible(prompt, apiKey, baseUrl, model);
    }

    if (aiProvider === 'anthropic') {
        const apiKey = config.anthropicApiKey || '';
        const model = config.anthropicModel || config.model || 'claude-3-haiku-20240307';
        if (!apiKey) throw new Error('Chưa cấu hình Anthropic API key');
        return await callAnthropic(prompt, apiKey, model);
    }

    // Fallback to OpenAI
    const apiKey = config.openaiApiKey || '';
    if (!apiKey) throw new Error('Chưa chọn AI provider hoặc chưa cấu hình API key');
    return await callOpenAi(prompt, apiKey, config.model || 'gpt-4o-mini');
}

async function callOpenAi(prompt, apiKey, modelName = 'gpt-4o-mini') {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: String(modelName || 'gpt-4o-mini').trim(),
        messages: [
            { role: 'system', content: 'Bạn là trợ lý phân tích nhu cầu khách hàng. Trả về JSON hợp lệ.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
    }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });
    return response.data?.choices?.[0]?.message?.content || '';
}

async function callOpenAiCompatible(prompt, apiKey, baseUrl, modelName = 'gpt-3.5-turbo') {
    const cleanBaseUrl = String(baseUrl).replace(/\/+$/, '');
    console.log(`[AI Compatible] POST ${cleanBaseUrl}/chat/completions | model=${modelName}`);
    const response = await axios.post(`${cleanBaseUrl}/chat/completions`, {
        model: String(modelName).trim(),
        messages: [
            { role: 'system', content: 'Bạn là trợ lý phân tích nhu cầu khách hàng. Trả về JSON hợp lệ.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500
    }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 30000
    });
    const raw = response.data?.choices?.[0]?.message?.content || '';
    console.log(`[AI Compatible] Response (first 200 chars): ${String(raw).substring(0, 200)}`);
    return raw;
}

async function callAnthropic(prompt, apiKey, modelName = 'claude-3-haiku-20240307') {
    const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: String(modelName).trim(),
        max_tokens: 500,
        system: 'Bạn là trợ lý phân tích nhu cầu khách hàng. Trả về JSON hợp lệ. KHÔNG thêm markup hay giải thích, chỉ trả về JSON thuần.',
        messages: [
            { role: 'user', content: prompt }
        ]
    }, {
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        timeout: 30000
    });
    // Anthropic returns content in a different structure
    const content = response.data?.content?.[0]?.text || '';
    return content;
}

function parseAiResponse(rawText = '') {
    try {
        const clean = String(rawText).replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(clean);
        return {
            isMatching: Boolean(parsed.isMatching || parsed.is_matching || false),
            score: parseInt(parsed.score || parsed.aiScore || parsed.confidence || 0, 10) || 0,
            analysis: String(parsed.analysis || parsed.aiAnalysis || parsed.explanation || rawText),
            reason: String(parsed.reason || parsed.matchReason || parsed.match_reason || '')
        };
    } catch (e) {
        // Lưu raw response để debug
        console.warn('[AI] parseAiResponse FAILED, raw text:', String(rawText).substring(0, 500));
        const text = String(rawText).toLowerCase();
        // Tìm "isMatching": true / "match" / "phù hợp"
        const explicitTrue = /"ismatching"\s*:\s*true/.test(text) || /"is_matching"\s*:\s*true/.test(text);
        const explicitFalse = /"ismatching"\s*:\s*false/.test(text) || /"is_matching"\s*:\s*false/.test(text);
        const matchHint = /"có nhu cầu"|"phù hợp"|"tiềm năng"|"should match"|"match"|"yes"/i.test(text);
        const noMatchHint = /"không phù hợp"|"không có nhu cầu"|"should not"|"no match"|"not match"|"no"/i.test(text);
        return {
            isMatching: explicitTrue || (!explicitFalse && matchHint && !noMatchHint),
            score: matchHint ? 60 : 20,
            analysis: rawText,
            reason: 'parse-fallback'
        };
    }
}

async function analyzeDbResult(doc, config, apiKey) {
    const analysisPrompt = `${config.scanScript}

==== BÀI VIẾT CẦN PHÂN TÍCH ====
Tác giả: ${doc.postAuthor || 'Không rõ'}
Nội dung: ${doc.postContent}

==== HƯỚNG DẪN ====
Trả về JSON thuần: {"isMatching": true/false, "score": 0-100, "analysis": "...", "reason": "..."}
KHÔNG thêm markdown, KHÔNG thêm giải thích ngoài JSON.`;

    console.log(`[AI] Analyzing DB post: ${doc.postId} | provider=${config.aiProvider || 'openai'} | model=${config.openaiCompatibleModel || config.anthropicModel || config.model || 'gpt-4o-mini'}`);

    // Build AI config with all possible provider fields
    const aiConfig = {
        configId: config._id,
        openaiApiKey: apiKey || config.openaiApiKey,
        model: config.model,
        aiProvider: config.aiProvider || 'openai',
        openaiCompatibleApiKey: config.openaiCompatibleApiKey,
        openaiCompatibleBaseUrl: config.openaiCompatibleBaseUrl,
        openaiCompatibleModel: config.openaiCompatibleModel,
        anthropicApiKey: config.anthropicApiKey,
        anthropicModel: config.anthropicModel
    };

    let aiRawResponse = '';
    try {
        aiRawResponse = await callAiForAnalysis(config.userId, {
            postId: doc.postId,
            postUrl: doc.postUrl,
            postContent: doc.postContent,
            postAuthor: doc.postAuthor,
            postImages: doc.postImages || [],
            _currentPostIndex: doc._batchIndex || '?',
            _totalPosts: doc._batchTotal || '?'
        }, analysisPrompt, aiConfig);
    } catch (err) {
        console.error(`[AI] Call FAILED for post ${doc.postId}:`, err.message);
        // Lưu lỗi vào doc để user debug
        doc.aiAnalysis = '[AI Error] ' + err.message;
        doc.aiScore = 0;
        doc.isMatching = false;
        doc.matchReason = 'ai-error: ' + err.message;
        doc.aiAnalyzed = true;
        await doc.save();
        return doc;
    }

    const aiResult = parseAiResponse(aiRawResponse);
    console.log(`[AI] Post ${doc.postId}: raw="${String(aiRawResponse).substring(0, 100)}" → match=${aiResult.isMatching} score=${aiResult.score}`);

    doc.aiAnalysis = aiResult.analysis;
    doc.aiScore = aiResult.score;
    doc.isMatching = aiResult.isMatching;
    doc.matchReason = aiResult.reason || '';
    doc.aiAnalyzed = true;
    await doc.save();

    return doc;
}

module.exports = {
    callAiForAnalysis,
    callOpenAi,
    callOpenAiCompatible,
    callAnthropic,
    parseAiResponse,
    analyzeDbResult
};