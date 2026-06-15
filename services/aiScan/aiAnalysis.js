// services/aiScan/aiAnalysis.js
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const socketService = require('../socketService');

/**
 * Gọi AI dựa trên provider được cấu hình
 * @param {string} userId
 * @param {object} postData
 * @param {string} prompt
 * @param {object} config - { configId, openaiApiKey, model, aiProvider, openaiCompatibleApiKey, openaiCompatibleBaseUrl, openaiCompatibleModel, anthropicApiKey, anthropicModel, usePuter }
 */
async function callAiForAnalysis(userId, postData, prompt, config = {}) {
    const usePuter = config.usePuter !== false;
    if (usePuter) {
        try {
            const requestId = uuidv4();
            socketService.emitScanProgress(userId, config.configId, {
                status: 'analyzing',
                current: postData._currentPostIndex || '?',
                total: postData._totalPosts || '?',
                message: `Đang phân tích: ${(postData.postContent || '').substring(0, 50)}...`
            });
            const result = await socketService.requestAiAnalysis(userId, requestId, {
                postId: postData.postId,
                postUrl: postData.postUrl,
                postContent: postData.postContent,
                postAuthor: postData.postAuthor,
                postImages: postData.postImages || []
            }, prompt, 30000);
            return result;
        } catch (puterErr) {
            console.warn(`[AI Scan] Puter.js failed, trying AI provider:`, puterErr.message);
        }
    }

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
    if (!apiKey) throw new Error('Không có Puter.js frontend và chưa cấu hình AI provider');
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
    return response.data?.choices?.[0]?.message?.content || '';
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
        const clean = rawText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(clean);
        return {
            isMatching: Boolean(parsed.isMatching || parsed.is_matching || false),
            score: parseInt(parsed.score || parsed.aiScore || parsed.confidence || 0, 10) || 0,
            analysis: String(parsed.analysis || parsed.aiAnalysis || parsed.explanation || rawText),
            reason: String(parsed.reason || parsed.matchReason || parsed.match_reason || '')
        };
    } catch (e) {
        const text = rawText.toLowerCase();
        return {
            isMatching: text.includes('có nhu cầu') || text.includes('khách hàng tiềm năng') || text.includes('nên comment') || text.includes('match'),
            score: text.includes('có nhu cầu') ? 60 : 20,
            analysis: rawText,
            reason: ''
        };
    }
}

async function analyzeDbResult(doc, config, apiKey) {
    const analysisPrompt = `${config.scanScript}

==== BÀI VIẾT CẦN PHÂN TÍCH ====
Tác giả: ${doc.postAuthor || 'Không rõ'}
Nội dung: ${doc.postContent}

==== HƯỚNG DẪN ====
Trả về JSON: {"isMatching": true/false, "score": 0-100, "analysis": "...", "reason": "..."}`;

    console.log(`[AI] Analyzing DB post: ${doc.postId}`);

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
        anthropicModel: config.anthropicModel,
        usePuter: true
    };

    const aiRawResponse = await callAiForAnalysis(config.userId, {
        postId: doc.postId,
        postUrl: doc.postUrl,
        postContent: doc.postContent,
        postAuthor: doc.postAuthor,
        postImages: doc.postImages || [],
        _currentPostIndex: doc._batchIndex || '?',
        _totalPosts: doc._batchTotal || '?'
    }, analysisPrompt, aiConfig);
    const aiResult = parseAiResponse(aiRawResponse);

    doc.aiAnalysis = aiResult.analysis;
    doc.aiScore = aiResult.score;
    doc.isMatching = true;
    doc.matchReason = aiResult.reason || '';
    doc.aiAnalyzed = true;
    await doc.save();

    console.log(`[AI] Post ${doc.postId}: match=${aiResult.isMatching}, score=${aiResult.score}`);
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