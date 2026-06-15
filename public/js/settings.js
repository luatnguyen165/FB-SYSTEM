/* ===================================
   SETTINGS.JS - Cấu hình hệ thống
   Xử lý Lưu & Reset cấu hình
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
    const btnSave = document.querySelector('.btn-save-all');
    if (btnSave) btnSave.addEventListener('click', saveAllSettingsData);

    const btnReset = document.querySelector('.btn-reset');
    if (btnReset) btnReset.addEventListener('click', resetAllSettings);

    const btnTestTg = document.getElementById('btnTestTelegram');
    if (btnTestTg) btnTestTg.addEventListener('click', testTelegramConnection);

    const btnTestAi = document.getElementById('btnTestOpenAiKey');
    if (btnTestAi) btnTestAi.addEventListener('click', testOpenAiConnection);

    const btnTestOpenaiCompatible = document.getElementById('btnTestOpenaiCompatible');
    if (btnTestOpenaiCompatible) btnTestOpenaiCompatible.addEventListener('click', testOpenaiCompatibleConnection);

    const btnTestAnthropic = document.getElementById('btnTestAnthropic');
    if (btnTestAnthropic) btnTestAnthropic.addEventListener('click', testAnthropicConnection);

    // Live update OpenAI status when typing key
    const openaiKeyInput = document.getElementById('openaiApiKey');
    if (openaiKeyInput) {
        openaiKeyInput.addEventListener('input', updateOpenAiStatus);
    }

    // AI Provider toggle
    const aiProviderSelect = document.getElementById('aiProvider');
    if (aiProviderSelect) {
        aiProviderSelect.addEventListener('change', toggleAiProviderFields);
        toggleAiProviderFields();
    }

    // Live update OpenAI Compatible status
    const openaiCompatibleKeyInput = document.getElementById('openaiCompatibleApiKey');
    const openaiCompatibleUrlInput = document.getElementById('openaiCompatibleBaseUrl');
    if (openaiCompatibleKeyInput) openaiCompatibleKeyInput.addEventListener('input', updateOpenaiCompatibleStatus);
    if (openaiCompatibleUrlInput) openaiCompatibleUrlInput.addEventListener('input', updateOpenaiCompatibleStatus);

    // Live update Anthropic status
    const anthropicKeyInput = document.getElementById('anthropicApiKey');
    if (anthropicKeyInput) anthropicKeyInput.addEventListener('input', updateAnthropicStatus);

    initTelegramStatus();
    initIntervalToggles();
    updateIntervalSummary();
    updateOpenAiStatus();
    updateOpenaiCompatibleStatus();
    updateAnthropicStatus();
});

function toggleAiProviderFields() {
    const provider = document.getElementById('aiProvider')?.value || 'openai';
    const openaiFields = document.getElementById('aiOpenaiFields');
    const openaiCompatibleFields = document.getElementById('aiOpenaiCompatibleFields');
    const anthropicFields = document.getElementById('aiAnthropicFields');

    if (openaiFields) openaiFields.style.display = provider === 'openai' ? '' : 'none';
    if (openaiCompatibleFields) openaiCompatibleFields.style.display = provider === 'openai-compatible' ? '' : 'none';
    if (anthropicFields) anthropicFields.style.display = provider === 'anthropic' ? '' : 'none';
}

function initIntervalToggles() {
    const randomToggle = document.getElementById('randomDelayEnabled');
    const quietToggle = document.getElementById('quietHoursEnabled');

    if (randomToggle) {
        randomToggle.addEventListener('change', () => {
        const rangeGroup = document.getElementById('randomDelayRangeGroup');
        const maxGroup = document.getElementById('randomDelayMaxGroup');
        if (rangeGroup) rangeGroup.classList.toggle('is-active', randomToggle.checked);
        if (maxGroup) maxGroup.classList.toggle('is-active', randomToggle.checked);
        updateIntervalSummary();
        });
        // init state
        const rangeGroup = document.getElementById('randomDelayRangeGroup');
        const maxGroup = document.getElementById('randomDelayMaxGroup');
        if (rangeGroup) rangeGroup.classList.toggle('is-active', randomToggle.checked);
        if (maxGroup) maxGroup.classList.toggle('is-active', randomToggle.checked);
    }

    if (quietToggle) {
        quietToggle.addEventListener('change', () => {
        const startGroup = document.getElementById('quietHoursStartGroup');
        const endGroup = document.getElementById('quietHoursEndGroup');
        if (startGroup) startGroup.classList.toggle('is-active', quietToggle.checked);
        if (endGroup) endGroup.classList.toggle('is-active', quietToggle.checked);
        updateIntervalSummary();
        });
        // init state
        const startGroup = document.getElementById('quietHoursStartGroup');
        const endGroup = document.getElementById('quietHoursEndGroup');
        if (startGroup) startGroup.classList.toggle('is-active', quietToggle.checked);
        if (endGroup) endGroup.classList.toggle('is-active', quietToggle.checked);
    }
}

function updateIntervalSummary() {
    const summaryText = document.getElementById('intervalSummaryDesc');
    if (!summaryText) return;

    const randomEnabled = document.getElementById('randomDelayEnabled')?.checked;
    const quietEnabled = document.getElementById('quietHoursEnabled')?.checked;
    const interval = document.getElementById('postInterval')?.value || '30';
    const maxPerDay = document.getElementById('maxPostsPerDay')?.value || '10';
    const minInterval = document.getElementById('minIntervalBetweenPosts')?.value || '10';

    let desc = '';
    if (randomEnabled) {
        const minD = document.getElementById('randomDelayMin')?.value || '5';
        const maxD = document.getElementById('randomDelayMax')?.value || '15';
        desc = `Trễ ngẫu nhiên ${minD}–${maxD} phút. Tối đa ${maxPerDay} bài/ngày, nghỉ tối thiểu ${minInterval} phút.`;
    } else {
        desc = `Nghỉ ${interval} phút giữa các bài. Tối đa ${maxPerDay} bài/ngày, nghỉ tối thiểu ${minInterval} phút.`;
    }

    if (quietEnabled) {
        const start = document.getElementById('quietHoursStart')?.value || '23:00';
        const end = document.getElementById('quietHoursEnd')?.value || '07:00';
        desc += ` Yên lặng ${start}–${end}.`;
    }

    summaryText.textContent = desc;
}

// Live update summary on input changes
document.addEventListener('DOMContentLoaded', () => {
    const intervalInputs = ['postInterval', 'maxPostsPerDay', 'minIntervalBetweenPosts', 'randomDelayMin', 'randomDelayMax', 'quietHoursStart', 'quietHoursEnd'];
    intervalInputs.forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateIntervalSummary);
    });
});

function initTelegramStatus() {
    const tgToken = document.getElementById('tgToken')?.value?.trim();
    const tgChatId = document.getElementById('tgChatId')?.value?.trim();
    updateTelegramStatus(tgToken && tgChatId);
}

function updateTelegramStatus(connected) {
    const dot = document.getElementById('telegramStatusDot');
    const text = document.getElementById('telegramStatusText');
    const sub = document.getElementById('telegramStatusSub');

    if (!dot || !text || !sub) return;

    if (connected) {
        dot.className = 'telegram-status-dot connected';
        text.textContent = 'Đã kết nối Telegram';
        sub.textContent = 'Nhấn "Kiểm tra" để xác nhận';
    } else {
        dot.className = 'telegram-status-dot disconnected';
        text.textContent = 'Chưa kết nối';
        sub.textContent = 'Nhập token và chat ID để bắt đầu nhận thông báo';
    }
}

async function testTelegramConnection() {
    const btn = document.getElementById('btnTestTelegram');
    const dot = document.getElementById('telegramStatusDot');
    const text = document.getElementById('telegramStatusText');
    const sub = document.getElementById('telegramStatusSub');

    const tgToken = document.getElementById('tgToken')?.value?.trim();
    const tgChatId = document.getElementById('tgChatId')?.value?.trim();

    if (!tgToken || !tgChatId) {
        showToast('Vui lòng nhập đầy đủ Token và Chat ID', 'warning');
        return;
    }

    btn.classList.add('testing');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra...';

    try {
        const res = await fetch('/settings/api/telegram-test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramBotToken: tgToken, telegramChatId: tgChatId })
        });
        const data = await res.json();

        if (data.success) {
            dot.className = 'telegram-status-dot connected';
            text.textContent = 'Kết nối thành công!';
            sub.textContent = 'Tin nhắn đã được gửi đến Telegram của bạn';
            showToast('Đã gửi tin nhắn kiểm tra đến Telegram!', 'success');
        } else {
            dot.className = 'telegram-status-dot disconnected';
            text.textContent = 'Kết nối thất bại';
            sub.textContent = data.message || 'Vui lòng kiểm tra lại Token và Chat ID';
            showToast(data.message || 'Kết nối Telegram thất bại', 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    } finally {
        btn.classList.remove('testing');
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Kiểm tra ngay';
    }
}

async function saveAllSettingsData() {
    const autoFlip = document.getElementById('cfgFlip')?.checked;
    const autoMd5Change = document.getElementById('cfgMd5')?.checked;
    const dataEncryptionEnabled = document.getElementById('cfgDataEncryption')?.checked;
    const watermarkPosition = document.getElementById('watermarkPosition')?.value || '';
    const postInterval = document.getElementById('postInterval')?.value || '30';
    const retryDelay = document.getElementById('retryDelay')?.value || '5';
    const maxPostsPerDay = document.getElementById('maxPostsPerDay')?.value || '10';
    const minIntervalBetweenPosts = document.getElementById('minIntervalBetweenPosts')?.value || '10';
    const randomDelayEnabled = document.getElementById('randomDelayEnabled')?.checked || false;
    const randomDelayMin = document.getElementById('randomDelayMin')?.value || '5';
    const randomDelayMax = document.getElementById('randomDelayMax')?.value || '15';
    const quietHoursEnabled = document.getElementById('quietHoursEnabled')?.checked || false;
    const quietHoursStart = document.getElementById('quietHoursStart')?.value || '23:00';
    const quietHoursEnd = document.getElementById('quietHoursEnd')?.value || '07:00';
    const telegramBotToken = document.getElementById('tgToken')?.value?.trim() || '';
    const telegramChatId = document.getElementById('tgChatId')?.value?.trim() || '';
    const openaiApiKey = document.getElementById('openaiApiKey')?.value?.trim() || '';
    const aiProvider = document.getElementById('aiProvider')?.value || 'openai';
    const openaiModel = document.getElementById('openaiModel')?.value?.trim() || 'gpt-4o-mini';
    const openaiCompatibleApiKey = document.getElementById('openaiCompatibleApiKey')?.value?.trim() || '';
    const openaiCompatibleBaseUrl = document.getElementById('openaiCompatibleBaseUrl')?.value?.trim() || '';
    const openaiCompatibleModel = document.getElementById('openaiCompatibleModel')?.value?.trim() || '';
    const anthropicApiKey = document.getElementById('anthropicApiKey')?.value?.trim() || '';
    const anthropicModel = document.getElementById('anthropicModel')?.value?.trim() || 'claude-3-haiku-20240307';

    try {
        const payload = {
            autoFlip,
            autoMd5Change,
            dataEncryptionEnabled,
            watermarkPosition,
            postInterval,
            retryDelay,
            maxPostsPerDay,
            minIntervalBetweenPosts,
            randomDelayEnabled,
            randomDelayMin,
            randomDelayMax,
            quietHoursEnabled,
            quietHoursStart,
            quietHoursEnd,
            telegramBotToken,
            telegramChatId,
            openaiApiKey,
            aiProvider,
            openaiModel,
            openaiCompatibleApiKey,
            openaiCompatibleBaseUrl,
            openaiCompatibleModel,
            anthropicApiKey,
            anthropicModel
        };

        let finalPayload = { ...payload };
        if (dataEncryptionEnabled && window.cryptoVault?.encryptText) {
            const security = await window.cryptoVault.getSecurityConfig();
            if (security?.publicKey) {
                finalPayload.telegramBotToken = telegramBotToken
                    ? await window.cryptoVault.encryptText(telegramBotToken, security.publicKey)
                    : '';
                finalPayload.telegramChatId = telegramChatId
                    ? await window.cryptoVault.encryptText(telegramChatId, security.publicKey)
                    : '';
            }
        } else if (window.cryptoVault?.encryptPayload) {
            finalPayload = await window.cryptoVault.encryptPayload(payload, ['telegramBotToken', 'telegramChatId']);
        }

        const res = await fetch('/settings/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}

async function resetAllSettings() {
    showConfirm('Đặt lại toàn bộ cấu hình hệ thống về trạng thái mặc định?', async () => {
        try {
            const res = await fetch('/settings/api/reset', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                location.reload();
            } else {
                showToast('Lỗi: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
        }
    });
}

// ============================================================
// OPENAI API KEY
// ============================================================

function updateOpenAiStatus() {
    const key = document.getElementById('openaiApiKey')?.value?.trim();
    const dot = document.getElementById('openaiStatusDot');
    const text = document.getElementById('openaiStatusText');
    const card = document.getElementById('openaiStatusCard');

    if (!dot || !text || !card) return;

    if (key && key.startsWith('sk-')) {
        dot.style.background = '#10b981';
        text.textContent = 'Đã cấu hình OpenAI API Key (' + key.substring(0, 10) + '...)';
        card.style.background = 'rgba(16, 185, 129, 0.08)';
    } else if (key) {
        dot.style.background = '#f59e0b';
        text.textContent = 'Key không hợp lệ (phải bắt đầu bằng sk-)';
        card.style.background = 'rgba(245, 158, 11, 0.08)';
    } else {
        dot.style.background = '#94a3b8';
        text.textContent = 'Chưa cấu hình OpenAI API Key';
        card.style.background = 'rgba(148, 163, 184, 0.08)';
    }
}

async function testOpenAiConnection() {
    const btn = document.getElementById('btnTestOpenAiKey');
    const key = document.getElementById('openaiApiKey')?.value?.trim();

    if (!key) {
        showToast('Vui lòng nhập OpenAI API Key', 'warning');
        return;
    }

    if (!key.startsWith('sk-')) {
        showToast('API Key không hợp lệ (phải bắt đầu bằng sk-)', 'error');
        return;
    }

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang test...';
    btn.disabled = true;

    try {
        const res = await fetch('/settings/api/test-ai-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'openai', apiKey: key })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Kết nối OpenAI thành công! ✓', 'success');
            const dot = document.getElementById('openaiStatusDot');
            const text = document.getElementById('openaiStatusText');
            const card = document.getElementById('openaiStatusCard');
            if (dot) dot.style.background = '#10b981';
            if (text) text.textContent = 'Kết nối thành công! Key hoạt động tốt.';
            if (card) card.style.background = 'rgba(16, 185, 129, 0.12)';
        } else {
            showToast(data.message || 'Kết nối thất bại', 'error');
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, 'error');
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

// ============================================================
// OPENAI COMPATIBLE
// ============================================================

function updateOpenaiCompatibleStatus() {
    const key = document.getElementById('openaiCompatibleApiKey')?.value?.trim();
    const baseUrl = document.getElementById('openaiCompatibleBaseUrl')?.value?.trim();
    const dot = document.getElementById('openaiCompatibleStatusDot');
    const text = document.getElementById('openaiCompatibleStatusText');
    const card = document.getElementById('openaiCompatibleStatusCard');

    if (!dot || !text || !card) return;

    if (key && baseUrl) {
        dot.style.background = '#10b981';
        text.textContent = 'Đã cấu hình (' + baseUrl + ')';
        card.style.background = 'rgba(16, 185, 129, 0.08)';
    } else if (key || baseUrl) {
        dot.style.background = '#f59e0b';
        text.textContent = 'Thiếu Base URL hoặc API Key';
        card.style.background = 'rgba(245, 158, 11, 0.08)';
    } else {
        dot.style.background = '#94a3b8';
        text.textContent = 'Chưa cấu hình';
        card.style.background = 'rgba(148, 163, 184, 0.08)';
    }
}

async function testOpenaiCompatibleConnection() {
    const btn = document.getElementById('btnTestOpenaiCompatible');
    const apiKey = document.getElementById('openaiCompatibleApiKey')?.value?.trim();
    const baseUrl = document.getElementById('openaiCompatibleBaseUrl')?.value?.trim();
    const model = document.getElementById('openaiCompatibleModel')?.value?.trim() || 'gpt-3.5-turbo';

    if (!apiKey || !baseUrl) {
        showToast('Vui lòng nhập đầy đủ API Key và Base URL', 'warning');
        return;
    }

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang test...';
    btn.disabled = true;

    try {
        const res = await fetch('/settings/api/test-ai-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'openai-compatible', apiKey, baseUrl, model })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Kết nối thành công! ✓', 'success');
            const dot = document.getElementById('openaiCompatibleStatusDot');
            const text = document.getElementById('openaiCompatibleStatusText');
            const card = document.getElementById('openaiCompatibleStatusCard');
            if (dot) dot.style.background = '#10b981';
            if (text) text.textContent = 'Kết nối thành công!';
            if (card) card.style.background = 'rgba(16, 185, 129, 0.12)';
        } else {
            showToast(data.message || 'Kết nối thất bại', 'error');
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, 'error');
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

// ============================================================
// ANTHROPIC
// ============================================================

function updateAnthropicStatus() {
    const key = document.getElementById('anthropicApiKey')?.value?.trim();
    const dot = document.getElementById('anthropicStatusDot');
    const text = document.getElementById('anthropicStatusText');
    const card = document.getElementById('anthropicStatusCard');

    if (!dot || !text || !card) return;

    if (key && key.startsWith('sk-ant-')) {
        dot.style.background = '#10b981';
        text.textContent = 'Đã cấu hình Anthropic API Key (' + key.substring(0, 12) + '...)';
        card.style.background = 'rgba(16, 185, 129, 0.08)';
    } else if (key) {
        dot.style.background = '#f59e0b';
        text.textContent = 'Key không hợp lệ (phải bắt đầu bằng sk-ant-)';
        card.style.background = 'rgba(245, 158, 11, 0.08)';
    } else {
        dot.style.background = '#94a3b8';
        text.textContent = 'Chưa cấu hình Anthropic API Key';
        card.style.background = 'rgba(148, 163, 184, 0.08)';
    }
}

async function testAnthropicConnection() {
    const btn = document.getElementById('btnTestAnthropic');
    const apiKey = document.getElementById('anthropicApiKey')?.value?.trim();
    const model = document.getElementById('anthropicModel')?.value?.trim() || 'claude-3-haiku-20240307';

    if (!apiKey) {
        showToast('Vui lòng nhập Anthropic API Key', 'warning');
        return;
    }

    if (!apiKey.startsWith('sk-ant-')) {
        showToast('API Key không hợp lệ (phải bắt đầu bằng sk-ant-)', 'error');
        return;
    }

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang test...';
    btn.disabled = true;

    try {
        const res = await fetch('/settings/api/test-ai-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', apiKey, model })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Kết nối Anthropic thành công! ✓', 'success');
            const dot = document.getElementById('anthropicStatusDot');
            const text = document.getElementById('anthropicStatusText');
            const card = document.getElementById('anthropicStatusCard');
            if (dot) dot.style.background = '#10b981';
            if (text) text.textContent = 'Kết nối thành công! Key hoạt động tốt.';
            if (card) card.style.background = 'rgba(16, 185, 129, 0.12)';
        } else {
            showToast(data.message || 'Kết nối thất bại', 'error');
        }
    } catch (err) {
        showToast('Lỗi: ' + err.message, 'error');
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}