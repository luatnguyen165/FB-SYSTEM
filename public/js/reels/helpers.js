/* ===================================
   REELS HELPERS - Utility functions
   =================================== */

function logReelsUiStep(step, details = '') {
    const suffix = details ? ` | ${details}` : '';
    console.log(`[Reels UI] ${step}${suffix}`);
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

function isPastReelsDateTime(dateText, timeText = '09:00') {
    const iso = parseDateInputToIso(dateText, timeText);
    if (!iso) return true;
    return new Date(iso).getTime() < Date.now();
}

function syncReelsScheduleTimeInput() {
    const dateInput = document.getElementById('modalDateInput');
    const timeInput = document.getElementById('modalClockInput');
    const hiddenInput = document.getElementById('modalTimeInput');
    if (!hiddenInput) return;
    hiddenInput.value = parseDateInputToIso(dateInput?.value || '', timeInput?.value || '09:00');
}

function setReelsScheduleInputs(dateValue, timeValue = '09:00') {
    const dateInput = document.getElementById('modalDateInput');
    const timeInput = document.getElementById('modalClockInput');
    const hiddenInput = document.getElementById('modalTimeInput');
    if (dateInput) dateInput.value = formatDateForInput(dateValue);
    if (timeInput) timeInput.value = timeValue || '09:00';
    if (hiddenInput) hiddenInput.value = parseDateInputToIso(dateInput?.value || '', timeInput?.value || '09:00');
}

function formatLocalDateKey(dateValue) {
    const d = new Date(dateValue);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatIsoDateKey(dateValue) {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function formatReelsMonthLabel(date) {
    return date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }).replace(/^(.)/, m => m.toUpperCase());
}

function getReelsStatusMeta(status) {
    switch (String(status || 'pending')) {
        case 'posted':
            return { label: 'Thành công', className: 'reels-status-posted', icon: 'fa-solid fa-check' };
        case 'failed':
            return { label: 'Thất bại', className: 'reels-status-failed', icon: 'fa-solid fa-xmark' };
        default:
            return { label: 'Chờ', className: 'reels-status-pending', icon: 'fa-solid fa-clock' };
    }
}

function getReelsPrimaryPlatform(schedule) {
    const platforms = Array.isArray(schedule?.platforms) ? schedule.platforms.filter(Boolean) : [];
    if (platforms.includes('YS')) return 'YS';
    if (platforms.includes('TT')) return 'TT';
    if (platforms.includes('FR')) return 'FR';
    if (platforms.includes('IG')) return 'IG';
    return platforms[0] || 'FR';
}

function getReelsPlatformMeta(platformCode) {
    const code = String(platformCode || 'FR');
    const meta = {
        FR: { label: 'Facebook Reels', icon: 'fa-brands fa-facebook', className: 'item-fb' },
        IG: { label: 'Instagram', icon: 'fa-brands fa-instagram', className: 'item-ig' },
        YS: { label: 'YouTube Short', icon: 'fa-brands fa-youtube', className: 'item-yt' },
        TT: { label: 'TikTok Video', icon: 'fa-brands fa-tiktok', className: 'item-tt' }
    };
    return meta[code] || { label: code, icon: 'fa-solid fa-bullhorn', className: 'item-fb' };
}

function getReelsSearchText(schedule = {}) {
    return [
        schedule.caption,
        schedule.status,
        schedule.type,
        Array.isArray(schedule.platforms) ? schedule.platforms.join(' ') : '',
        Array.isArray(schedule.accounts) ? schedule.accounts.join(' ') : '',
        schedule.videoTitle,
        schedule.videoName,
        schedule.videoPath,
        schedule.videoUrl,
        schedule.scheduledAt
    ].filter(Boolean).join(' ').toLowerCase();
}

function getReelsCalendarFilterState() {
    return {
        status: document.getElementById('scheduleStatusFilter')?.value || 'all',
        platform: document.getElementById('schedulePlatformFilter')?.value || 'all',
        keyword: String(document.getElementById('scheduleKeywordFilter')?.value || '').trim().toLowerCase(),
        date: document.getElementById('scheduleDateFilter')?.value || ''
    };
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

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function normalizeReelsAccountType(value) {
    const type = String(value || '').trim();
    if (type === 'Fanpage') return 'Fanpage';
    if (type === 'Nhà sáng tạo') return 'Nhà sáng tạo';
    return 'Cá nhân';
}

function reelsPlatformToChannel(platformCode) {
    const map = { FR: 'FB', YS: 'YT', IG: 'IG', TT: 'TT' };
    return map[platformCode] || platformCode;
}

function isFacebookPersonalAccount(channel = {}) {
    const p = String(channel.platform || '').trim();
    return p === 'FB' && normalizeReelsAccountType(channel.accountType || 'Cá nhân') === 'Cá nhân';
}

function buildReelsCalendarDays(date) {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const firstDay = (start.getDay() + 6) % 7;
    const lastDay = end.getDate();
    const days = [];
    let prevMonthDate = new Date(date.getFullYear(), date.getMonth(), 0).getDate();
    for (let i = firstDay; i > 0; i--) {
        days.push({ day: prevMonthDate - i + 1, otherMonth: true, monthShift: -1 });
    }
    for (let day = 1; day <= lastDay; day++) {
        days.push({ day, otherMonth: false, monthShift: 0 });
    }
    const totalCells = 42;
    const remaining = totalCells - days.length;
    for (let day = 1; day <= remaining; day++) {
        days.push({ day, otherMonth: true, monthShift: 1 });
    }
    return days;
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

function isReelsDateSelectable(dateString) {
    if (!dateString) return false;
    const selected = new Date(`${dateString}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selected >= today;
}

function buildDateFromCell(cell) {
    const day = cell?.getAttribute('data-day');
    if (!day) return '';
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const dayNum = String(day).padStart(2, '0');
    return `${year}-${month}-${dayNum}`;
}