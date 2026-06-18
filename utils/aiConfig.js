// utils/aiConfig.js
// Shared AI configuration helper — dùng chung cho controller + services
const Settings = require('../models/Settings');
const { normalizeEncryptedValue } = require('./cryptoVault');

/**
 * Lấy cấu hình AI từ Settings của user
 * @param {string} userId
 * @returns {{ apiKey: string, provider: string, model: string, baseUrl: string }}
 */
async function getUserApiConfig(userId) {
    const settings = await Settings.findOne({ userId }).lean();
    if (!settings) {
        return {
            apiKey: process.env.OPENAI_API_KEY || '',
            provider: 'openai',
            model: 'gpt-4o-mini',
            baseUrl: '',
        };
    }

    const provider = settings.aiProvider || 'openai';
    let apiKey = '';
    let model = 'gpt-4o-mini';
    let baseUrl = '';

    if (provider === 'openai') {
        apiKey = settings.openaiApiKey || process.env.OPENAI_API_KEY || '';
        model = settings.openaiModel || 'gpt-4o-mini';
    } else if (provider === 'openai-compatible') {
        apiKey = settings.openaiCompatibleApiKey || settings.openaiApiKey || process.env.OPENAI_API_KEY || '';
        model = settings.openaiCompatibleModel || 'gpt-3.5-turbo';
        baseUrl = settings.openaiCompatibleBaseUrl || '';
    } else if (provider === 'anthropic') {
        apiKey = settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
        model = settings.anthropicModel || 'claude-3-haiku-20240307';
    }

    apiKey = normalizeEncryptedValue(apiKey);
    return { apiKey, provider, model, baseUrl };
}

/**
 * Kiểm tra API key hợp lệ (hỗ trợ tất cả provider)
 */
function isValidApiKey(key) {
    if (!key || !key.trim()) return false;
    const k = key.trim();
    // OpenAI: sk-..., Anthropic: sk-ant-..., OpenAI compatible: có thể format khác
    return k.length > 10;
}

module.exports = { getUserApiConfig, isValidApiKey };
