// services/aiScan/aiAnalysis.js
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const socketService = require('../socketService');

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
            console.warn(`[AI Scan] Puter.js failed, trying OpenAI:`, puterErr.message);
        }
    }
    const apiKey = config.openaiApiKey || '';
    if (!apiKey) throw new Error('Không có Puter.js frontend và chưa cấu hình OpenAI API key');
    return await callOpenAi(prompt, apiKey, config.model);
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
    const aiRawResponse = await callAiForAnalysis(config.userId, {
        postId: doc.postId,
        postUrl: doc.postUrl,
        postContent: doc.postContent,
        postAuthor: doc.postAuthor,
        postImages: doc.postImages || [],
        _currentPostIndex: doc._batchIndex || '?',
        _totalPosts: doc._batchTotal || '?'
    }, analysisPrompt, {
        configId: config._id,
        openaiApiKey: apiKey,
        model: config.model,
        usePuter: true
    });
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
    parseAiResponse,
    analyzeDbResult
};