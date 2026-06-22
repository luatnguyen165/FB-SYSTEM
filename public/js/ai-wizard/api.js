// public/js/ai-wizard/api.js
// Thin fetch wrappers gọi API cho AI Content Creator wizard
// Throw error với message từ server nếu fail

(function (global) {
    'use strict';

    async function request(url, options = {}) {
        const res = await fetch(url, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options,
        });
        let data;
        try { data = await res.json(); } catch { data = null; }
        if (!res.ok) {
            const msg = data?.error || `HTTP ${res.status}`;
            const err = new Error(msg);
            err.code = data?.code;
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    const api = {
        // Styles
        listStyles: () => request('/ai-content/api/styles'),
        getStyle: (id) => request(`/ai-content/api/styles/${id}`),
        createStyle: (payload) => request('/ai-content/api/styles', { method: 'POST', body: JSON.stringify(payload) }),
        analyzeStyle: (id) => request(`/ai-content/api/styles/${id}/analyze`, { method: 'POST' }),

        // Schedules
        listSchedules: () => request('/ai-content/api/schedules'),
        getSchedule: (id) => request(`/ai-content/api/schedules/${id}`),
        createSchedule: (payload) => request('/ai-content/api/schedules', { method: 'POST', body: JSON.stringify(payload) }),
        updateSchedule: (id, payload) => request(`/ai-content/api/schedules/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
        previewSlots: (payload) => request('/ai-content/api/schedules/preview-slots', { method: 'POST', body: JSON.stringify(payload) }),
        markDraft: (id) => request(`/ai-content/api/schedules/${id}/draft`, { method: 'POST' }),
        generateNow: (id, keepExisting = false) => request(`/ai-content/api/schedules/${id}/generate`, {
            method: 'POST', body: JSON.stringify({ keepExisting }),
        }),

        // Products
        listProducts: () => request('/ai-content/api/products'),
        getProduct: (id) => request(`/ai-content/api/products/${id}`),
        createProduct: (payload) => request('/ai-content/api/products', { method: 'POST', body: JSON.stringify(payload) }),
        analyzeProduct: (id) => request(`/ai-content/api/products/${id}/analyze`, { method: 'POST' }),

        // Posts
        listPosts: (query = {}) => {
            const params = new URLSearchParams();
            Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params.set(k, v); });
            const qs = params.toString();
            return request(`/ai-content/api/posts${qs ? `?${qs}` : ''}`);
        },
        updatePost: (id, payload) => request(`/ai-content/api/posts/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
        publishPost: (id) => request(`/ai-content/api/posts/${id}/publish`, { method: 'POST' }),

        // Pipelines
        listPipelines: () => request('/ai-content/api/pipelines'),
        getPipeline: (id) => request(`/ai-content/api/pipelines/${id}`),
        createPipeline: (payload) => request('/ai-content/api/pipelines', { method: 'POST', body: JSON.stringify(payload) }),
        updatePipeline: (id, payload) => request(`/ai-content/api/pipelines/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
        runPipeline: (id) => request(`/ai-content/api/pipelines/${id}/run`, { method: 'POST' }),
        togglePipeline: (id) => request(`/ai-content/api/pipelines/${id}/toggle`, { method: 'POST' }),
        deletePipeline: (id) => request(`/ai-content/api/pipelines/${id}`, { method: 'DELETE' }),

        // Topics
        generateTopics: (writingStyleId) => request('/ai-content/api/generate-topics', {
            method: 'POST', body: JSON.stringify({ writingStyleId }),
        }),

        // Settings
        checkApiKey: () => request('/ai-content/api/settings/openai-key'),
    };

    global.WizardAPI = api;
})(window);
