/* ===================================
   SCHEDULE POST HELPERS - Utility functions, date/time formatting
   =================================== */

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}

function getCspSafePlaceholderImage(label = 'Preview') {
    const safeLabel = String(label || 'Preview')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');

    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="10" fill="#E2E8F0"/>
            <path d="M15 19.5C15 18.1193 16.1193 17 17.5 17H30.5C31.8807 17 33 18.1193 33 19.5V28.5C33 29.8807 31.8807 31 30.5 31H17.5C16.1193 31 15 29.8807 15 28.5V19.5Z" fill="#94A3B8"/>
            <path d="M19 27L22.25 23.5L25 26L28 22.5L33 28V28.5C33 29.8807 31.8807 31 30.5 31H17.5C16.1193 31 15 29.8807 15 28.5V27.5L19 27Z" fill="#CBD5E1"/>
            <circle cx="21" cy="21" r="2" fill="#64748B"/>
            <text x="24" y="41" text-anchor="middle" font-size="6" font-family="Inter, Arial, sans-serif" fill="#475569">${safeLabel.slice(0, 8)}</text>
        </svg>`;

    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg.trim())}`;
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function toDatetimeLocalValue(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatReadableDateTime(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    return new Intl.DateTimeFormat('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(d);
}

function formatDateForInput(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatIsoDateKey(dateValue) {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatShortDateTime(dateValue) {
    if (!dateValue) return '—';
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(d);
}

function getScheduleStatusMetaClient(status) {
    switch (String(status || 'pending')) {
        case 'posted':
            return { label: 'Thành công', className: 'status-posted', icon: 'fa-circle-check' };
        case 'failed':
            return { label: 'Thất bại', className: 'status-failed', icon: 'fa-triangle-exclamation' };
        default:
            return { label: 'Chờ', className: 'status-pending', icon: 'fa-clock' };
    }
}

function getSchedulePrimaryPlatform(schedule) {
    const platforms = Array.isArray(schedule?.platforms) ? schedule.platforms.filter(Boolean) : [];
    if (platforms.includes('FB')) return 'FB';
    if (platforms.includes('IG')) return 'IG';
    if (platforms.includes('YT')) return 'YT';
    if (platforms.includes('TT')) return 'TT';
    return platforms[0] || (String(schedule?.type || '') === 'reels' ? 'YT' : 'FB');
}

function getSchedulePlatformMeta(platformCode) {
    const code = String(platformCode || 'FB');
    const meta = {
        FB: { label: 'Facebook', icon: 'fa-brands fa-facebook', className: 'item-fb' },
        IG: { label: 'Instagram', icon: 'fa-brands fa-instagram', className: 'item-ig' },
        YT: { label: 'YouTube', icon: 'fa-brands fa-youtube', className: 'item-yt' },
        TT: { label: 'TikTok', icon: 'fa-brands fa-tiktok', className: 'item-tt' }
    };

    return meta[code] || { label: code, icon: 'fa-solid fa-bullhorn', className: 'item-fb' };
}

function getScheduleSearchText(schedule = {}) {
    return [
        schedule.caption,
        schedule.status,
        schedule.type,
        Array.isArray(schedule.platforms) ? schedule.platforms.join(' ') : '',
        Array.isArray(schedule.accounts) ? schedule.accounts.join(' ') : '',
        schedule.targetGroupName,
        schedule.targetGroupId,
        schedule.targetGroupUrl,
        schedule.videoTitle,
        schedule.scheduledAt
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function getCalendarFilterState() {
    return {
        status: document.getElementById('scheduleStatusFilter')?.value || 'all',
        platform: document.getElementById('schedulePlatformFilter')?.value || 'all',
        keyword: String(document.getElementById('scheduleKeywordFilter')?.value || '').trim().toLowerCase(),
        date: document.getElementById('scheduleDateFilter')?.value || ''
    };
}

function updateCalendarStats(allSchedules = [], visibleSchedules = []) {
    const totalEl = document.getElementById('statMonthlyTotal');
    const visibleEl = document.getElementById('statMonthlyVisible');
    const pendingEl = document.getElementById('statMonthlyPending');
    const postedEl = document.getElementById('statMonthlyPosted');
    const failedEl = document.getElementById('statMonthlyFailed');

    const total = allSchedules.length;
    const pending = allSchedules.filter(item => String(item.status || 'pending') === 'pending').length;
    const posted = allSchedules.filter(item => String(item.status || 'pending') === 'posted').length;
    const failed = allSchedules.filter(item => String(item.status || 'pending') === 'failed').length;

    if (totalEl) totalEl.textContent = String(total);
    if (visibleEl) visibleEl.textContent = `Đang hiển thị ${visibleSchedules.length} lịch`;
    if (pendingEl) pendingEl.textContent = String(pending);
    if (postedEl) postedEl.textContent = String(posted);
    if (failedEl) failedEl.textContent = String(failed);
}

function buildSchedulePreviewHtml(schedule = {}) {
    const platformCode = getSchedulePrimaryPlatform(schedule);
    const platformMeta = getSchedulePlatformMeta(platformCode);
    const statusMeta = getScheduleStatusMetaClient(schedule.status);
    const caption = String(schedule.caption || '').trim() || (String(schedule.type || '') === 'reels' ? 'Reels đã lên lịch' : 'Post đã lên lịch');
    const images = Array.isArray(schedule.images) ? schedule.images.filter(Boolean) : [];
    const imagePreview = images.length
        ? `<div class="schedule-popover__media-grid">${images.slice(0, 4).map((url, index) => `<img src="${escapeHtml(url)}" alt="Ảnh ${index + 1}">`).join('')}</div>`
        : `<div class="schedule-popover__empty-media"><i class="fa-regular fa-images"></i><span>Chưa có ảnh</span></div>`;

    return `
        <div class="schedule-popover__meta-line">
            <span class="schedule-popover__badge ${platformMeta.className}"><i class="${platformMeta.icon}"></i> ${escapeHtml(platformMeta.label)}</span>
            <span class="schedule-popover__badge ${statusMeta.className}"><i class="fa-solid ${statusMeta.icon}"></i></span>
        </div>
        <div class="schedule-popover__section">
            <strong>Thời gian</strong>
            <p>${escapeHtml(formatReadableDateTime(schedule.scheduledAt))}</p>
        </div>
        <div class="schedule-popover__section">
            <strong>Caption</strong>
            <p class="schedule-popover__caption">${escapeHtml(caption)}</p>
        </div>
        <div class="schedule-popover__section">
            <strong>Ảnh đã chọn</strong>
            ${imagePreview}
        </div>
        <div class="schedule-popover__section schedule-popover__section--grid">
            <div><strong>Nền tảng</strong><p>${escapeHtml(Array.isArray(schedule.platforms) && schedule.platforms.length ? schedule.platforms.map(code => getSchedulePlatformMeta(code).label).join(', ') : '—')}</p></div>
            <div><strong>Tài khoản</strong><p>${escapeHtml(Array.isArray(schedule.accounts) && schedule.accounts.length ? schedule.accounts.join(', ') : '—')}</p></div>
            <div><strong>Group/Nguồn</strong><p>${escapeHtml(schedule.targetGroupName || schedule.sourceChannelName || '—')}</p></div>
        </div>
    `;
}

function getCalendarFilterSummaryText(filters, schedules) {
    const parts = [];
    if (filters.status !== 'all') parts.push(`trạng thái: ${filters.status}`);
    if (filters.platform !== 'all') parts.push(`nền tảng: ${filters.platform}`);
    if (filters.keyword) parts.push(`caption: ${filters.keyword}`);
    if (filters.date) parts.push(`ngày: ${filters.date}`);
    if (!parts.length) return `Hiển thị ${schedules.length} lịch phù hợp`;
    return `Đã lọc ${schedules.length} lịch • ${parts.join(' • ')}`;
}

function getScheduleUpdateFormData(schedule, scheduledAtIso) {
    const formData = new FormData();
    const platforms = Array.isArray(schedule.platforms) ? schedule.platforms.filter(Boolean) : [];
    const accounts = Array.isArray(schedule.accounts) ? schedule.accounts.filter(Boolean) : [];
    const sourceChannelId = schedule.targetGroupSourceChannelId && typeof schedule.targetGroupSourceChannelId === 'object'
        ? schedule.targetGroupSourceChannelId._id
        : schedule.targetGroupSourceChannelId || '';
    const videoId = schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId._id : schedule.videoId || '';

    formData.append('scheduleId', String(schedule._id || ''));
    formData.append('type', String(schedule.type || 'post'));
    formData.append('caption', String(schedule.caption || ''));
    formData.append('scheduledAt', scheduledAtIso);
    platforms.forEach(p => formData.append('platforms', p));
    accounts.forEach(a => formData.append('accounts', a));
    if (sourceChannelId) formData.append('targetGroupSourceChannelId', String(sourceChannelId));
    if (schedule.targetGroupId) formData.append('targetGroupId', String(schedule.targetGroupId));

    if (String(schedule.type || 'post') === 'reels') {
        if (videoId) formData.append('videoId', String(videoId));
        if (schedule.videoPath) formData.append('videoPath', String(schedule.videoPath));
        if (schedule.videoTitle) formData.append('videoTitle', String(schedule.videoTitle));
        if (schedule.videoSize) formData.append('videoSize', String(schedule.videoSize));
    }

    return formData;
}

function parseDateInputToIso(dateText, timeText = '09:00') {
    if (!dateText) return '';
    const parts = String(dateText).trim().split('/');
    if (parts.length !== 3) return '';

    const [day, month, year] = parts.map(Number);
    if (!day || !month || !year) return '';

    const [hours = '09', minutes = '00'] = String(timeText || '09:00').split(':');
    const normalized = new Date(year, month - 1, day, Number(hours), Number(minutes), 0, 0);
    if (Number.isNaN(normalized.getTime())) return '';
    return normalized.toISOString();
}

function syncSchedulePostTimeInput() {
    const dateInput = document.getElementById('modalDateInput');
    const clockInput = document.getElementById('modalClockInput');
    const hiddenInput = document.getElementById('modalTimeInput');
    if (!hiddenInput) return;

    hiddenInput.value = parseDateInputToIso(dateInput?.value || '', clockInput?.value || '09:00');
}

function setSchedulePostInputs(dateValue, timeValue = '09:00') {
    const dateInput = document.getElementById('modalDateInput');
    const clockInput = document.getElementById('modalClockInput');
    const hiddenInput = document.getElementById('modalTimeInput');

    if (dateInput) dateInput.value = formatDateForInput(dateValue);
    if (clockInput) clockInput.value = timeValue || '09:00';
    if (hiddenInput) hiddenInput.value = parseDateInputToIso(dateInput?.value || '', clockInput?.value || '09:00');
}

function setScheduleTimeInputValue(value) {
    setSchedulePostInputs(value, value ? `${pad2(new Date(value).getHours())}:${pad2(new Date(value).getMinutes())}` : '09:00');
}

function isPastDateTime(dateText, timeText = '09:00') {
    const iso = parseDateInputToIso(dateText, timeText);
    if (!iso) return true;
    return new Date(iso).getTime() < Date.now();
}

function isPastDateKey(dateKey) {
    if (!dateKey) return true;
    const selected = new Date(`${dateKey}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selected < today;
}

function combineDateKeyWithTime(dateKey, sourceDateValue) {
    if (!dateKey || !sourceDateValue) return '';
    const source = new Date(sourceDateValue);
    if (Number.isNaN(source.getTime())) return '';

    const [year, month, day] = String(dateKey).split('-').map(Number);
    if (!year || !month || !day) return '';

    const combined = new Date(year, month - 1, day, source.getHours(), source.getMinutes(), 0, 0);
    return Number.isNaN(combined.getTime()) ? '' : combined.toISOString();
}

function getScheduleFromRenderedItemElement(itemEl) {
    const scheduleId = itemEl?.dataset?.scheduleId || '';
    if (!scheduleId) return null;
    return scheduleCalendarSchedulesCache.find(schedule => String(schedule._id) === String(scheduleId)) || null;
}

function getCalendarType() {
    return window.location.pathname.includes('reels') ? 'reels' : 'post';
}

function formatMonthLabel(date) {
    return date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }).replace(/^(.)/, m => m.toUpperCase());
}

function getCalendarGridDate(date, dayOffset) {
    const d = new Date(date);
    d.setDate(dayOffset);
    return d;
}

function formatLocalDateKey(dateValue) {
    const d = new Date(dateValue);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function highlightSearchTerm(text, term) {
    if (!term) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
    return escaped.replace(regex, '<span class="combobox-search-highlight">$1</span>');
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}