/* ===================================
   SCHEDULE-POST.JS - Trang Lịch Đăng Post
   Kết nối API backend
   =================================== */

let uploadedImagesBlobUrls = [];
let selectedSchedulePostImages = [];
let selectedSchedulePostPreviewUrls = [];
let swiperInstance = null;
let schedulePostAvailablePlatforms = new Set();
let currentCalendarDate = new Date();
let currentEditingSchedule = null;
let schedulePostFacebookGroups = [];
let schedulePostFacebookGroupRequestToken = 0;
let scheduleCalendarSchedulesCache = [];
let scheduleCalendarOverflowMap = new Map();
let scheduleCalendarDragState = { scheduleId: '', sourceDateKey: '' };
let scheduleCalendarActivePopover = { scheduleId: '', mode: 'detail' };

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getCspSafePlaceholderImage(label = 'Preview') {
    const safeLabel = String(label || 'Preview')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
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

function clearSchedulePostImagePreview() {
    const thumbContainer = document.getElementById('miniThumbGridContainer');
    const wrapper = document.getElementById('swiperWrapperTarget');
    const placeholder = document.getElementById('feedImagePlaceholder');
    const counter = document.getElementById('phoneCarouselCounterBadge');

    if (thumbContainer) {
        thumbContainer.innerHTML = '';
        thumbContainer.classList.remove('active');
    }
    if (wrapper) wrapper.innerHTML = '';
    if (placeholder) placeholder.style.display = 'flex';
    if (counter) counter.innerText = '1/1';

    if (swiperInstance) {
        swiperInstance.destroy(true, true);
        swiperInstance = null;
    }
}

function revokeSchedulePostPreviewUrls() {
    selectedSchedulePostPreviewUrls.forEach(url => {
        if (typeof url === 'string' && url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
    });
    selectedSchedulePostPreviewUrls = [];
}

function renderSchedulePostImagePreview(imageUrls = []) {
    const thumbContainer = document.getElementById('miniThumbGridContainer');
    const wrapper = document.getElementById('swiperWrapperTarget');
    const placeholder = document.getElementById('feedImagePlaceholder');
    const counter = document.getElementById('phoneCarouselCounterBadge');

    if (!thumbContainer || !wrapper) return;

    thumbContainer.innerHTML = '';
    wrapper.innerHTML = '';

    const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
    if (!urls.length) {
        if (thumbContainer) thumbContainer.classList.remove('active');
        if (placeholder) placeholder.style.display = 'flex';
        if (counter) counter.innerText = '1/1';
        if (swiperInstance) {
            swiperInstance.destroy(true, true);
            swiperInstance = null;
        }
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (thumbContainer) thumbContainer.classList.add('active');

    urls.forEach((url, index) => {
        const thumbItem = document.createElement('div');
        thumbItem.className = 'thumb-preview-item';
        thumbItem.innerHTML = `<img src="${url}" alt="Preview ${index + 1}"><button class="thumb-preview-remove-btn" type="button">&times;</button>`;
        thumbItem.querySelector('button')?.addEventListener('click', () => {
            const nextUrls = urls.filter((_, i) => i !== index);
            revokeSchedulePostPreviewUrls();
            selectedSchedulePostPreviewUrls = nextUrls.filter(Boolean);
            uploadedImagesBlobUrls = nextUrls.filter(u => typeof u === 'string' && u.startsWith('blob:'));
            renderSchedulePostImagePreview(nextUrls);
        });
        thumbContainer.appendChild(thumbItem);

        const slide = document.createElement('div');
        slide.className = 'swiper-slide';
        slide.innerHTML = `<img src="${url}" alt="Preview ${index + 1}">`;
        wrapper.appendChild(slide);
    });

    if (swiperInstance) swiperInstance.destroy(true, true);
    swiperInstance = new Swiper('.mySwiper', {
        pagination: { el: '.swiper-pagination', clickable: true },
        on: {
            slideChange: () => {
                if (counter) counter.innerText = `${swiperInstance.activeIndex + 1}/${urls.length}`;
            }
        }
    });

    if (counter) {
        counter.innerText = `1/${urls.length}`;
        counter.classList.toggle('active', urls.length > 1);
    }
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
            return { label: 'Đã đăng', className: 'status-posted', icon: 'fa-circle-check' };
        case 'failed':
            return { label: 'Thất bại', className: 'status-failed', icon: 'fa-triangle-exclamation' };
        default:
            return { label: 'Chưa đăng', className: 'status-pending', icon: 'fa-clock' };
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
            <span class="schedule-popover__badge ${statusMeta.className}"><i class="fa-solid ${statusMeta.icon}"></i> ${escapeHtml(statusMeta.label)}</span>
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
            <div><strong>Trạng thái</strong><p>${escapeHtml(statusMeta.label)}</p></div>
            <div><strong>Tài khoản</strong><p>${escapeHtml(Array.isArray(schedule.accounts) && schedule.accounts.length ? schedule.accounts.join(', ') : '—')}</p></div>
            <div><strong>Group/Nguồn</strong><p>${escapeHtml(schedule.targetGroupName || schedule.sourceChannelName || '—')}</p></div>
        </div>
    `;
}

function closeSchedulePopover() {
    const popover = document.getElementById('scheduleQuickPreviewPopover');
    if (!popover) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    popover.style.left = '';
    popover.style.top = '';
    scheduleCalendarActivePopover = { scheduleId: '', mode: 'detail' };
}

function positionSchedulePopover(popover, anchorEl) {
    if (!popover || !anchorEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const padding = 12;
    let left = anchorRect.right + padding;
    let top = anchorRect.top;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left + popRect.width + padding > viewportWidth) {
        left = anchorRect.left - popRect.width - padding;
    }
    if (left < padding) left = padding;
    if (top + popRect.height + padding > viewportHeight) {
        top = Math.max(padding, viewportHeight - popRect.height - padding);
    }
    if (top < padding) top = padding;

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

function openSchedulePopover(schedule, anchorEl, mode = 'detail', overflowItems = []) {
    const popover = document.getElementById('scheduleQuickPreviewPopover');
    const body = document.getElementById('schedulePopoverBody');
    const title = document.getElementById('schedulePopoverTitle');
    const eyebrow = document.getElementById('schedulePopoverEyebrow');

    if (!popover || !body || !title || !eyebrow || !schedule) return;

    const platformMeta = getSchedulePlatformMeta(getSchedulePrimaryPlatform(schedule));
    title.textContent = mode === 'overflow' ? 'Danh sách lịch ẩn' : (String(schedule.caption || '').trim() || 'Chi tiết lịch');
    eyebrow.textContent = mode === 'overflow' ? 'Xem thêm trong ngày' : `${platformMeta.label} • ${formatShortDateTime(schedule.scheduledAt)}`;

    if (mode === 'overflow' && Array.isArray(overflowItems) && overflowItems.length) {
        body.innerHTML = `<div class="schedule-popover__overflow-list">${overflowItems.map(item => {
            const itemPlatform = getSchedulePlatformMeta(getSchedulePrimaryPlatform(item));
            const itemStatus = getScheduleStatusMetaClient(item.status);
            const itemTitle = escapeHtml((item.caption || '').trim() || (String(item.type || '') === 'reels' ? 'Reels đã lên lịch' : 'Post đã lên lịch'));
            const timeParts = formatShortDateTime(item.scheduledAt).split(' ');
            const timeOnly = timeParts[1] || timeParts[0] || '';
            return `
                <button type="button" class="schedule-popover__overflow-item" data-schedule-id="${escapeHtml(item._id)}">
                    <div class="schedule-popover__overflow-item-icon schedule-popover__overflow-item-icon--${itemPlatform.className.replace('item-', '')}">
                        <i class="${itemPlatform.icon}"></i>
                    </div>
                    <div class="schedule-popover__overflow-item-main">
                        <span class="schedule-popover__overflow-item-time">${timeOnly}</span>
                        <strong>${itemTitle}</strong>
                        <small>
                            <span class="schedule-popover__overflow-item-badge schedule-popover__overflow-item-badge--${itemStatus.className}">${itemStatus.label}</span>
                        </small>
                    </div>
                    <div class="schedule-popover__overflow-item-arrow">
                        <i class="fa-solid fa-chevron-right"></i>
                    </div>
                </button>`;
        }).join('')}</div>`;
    } else {
        body.innerHTML = `
            ${buildSchedulePreviewHtml(schedule)}
            <div class="schedule-popover__actions">
                <button type="button" class="btn-calendar-secondary" id="btnPopoverEditSchedule" data-schedule-id="${escapeHtml(schedule._id)}">
                    <i class="fa-solid fa-pen-to-square"></i> Mở để chỉnh sửa
                </button>
            </div>
        `;
    }

    popover.dataset.scheduleId = String(schedule._id || '');
    popover.dataset.mode = mode;
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => positionSchedulePopover(popover, anchorEl));
    scheduleCalendarActivePopover = { scheduleId: String(schedule._id || ''), mode };
}

function openScheduleOverflowPopover(dateKey, anchorEl) {
    const items = scheduleCalendarOverflowMap.get(dateKey) || [];
    if (!items.length) return;
    openSchedulePopover(items[0], anchorEl, 'overflow', items);
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

async function updateScheduleDateById(scheduleId, scheduledAtIso) {
    if (!scheduleId || !scheduledAtIso) return;
    try {
        const detailRes = await fetch(`/schedule/api/${encodeURIComponent(scheduleId)}`);
        const detailData = await detailRes.json();
        if (!detailData.success || !detailData.schedule) {
            showToast('Không tải được lịch để dời ngày', 'error');
            return;
        }

        const schedule = detailData.schedule;
        if (String(schedule.status || 'pending') !== 'pending') {
            showToast('Chỉ có thể kéo-thả lịch chưa đăng', 'warning');
            return;
        }

        const updateFormData = getScheduleUpdateFormData(schedule, scheduledAtIso);
        console.log('updateFormData', updateFormData);
        const res = await fetch('/schedule/api/update', { method: 'PUT', body: updateFormData });
        const data = await res.json();
        if (!data.success) {
            showToast(data.message || 'Không thể cập nhật lịch', 'error');
            return;
        }

        showToast('Đã dời lịch thành công', 'success');
        await renderCalendar();
    } catch (error) {
        console.error('Update schedule date failed:', error);
        showToast('Lỗi khi dời lịch', 'error');
    }
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

function closeSchedulePopoverIfNeeded() {
    const popover = document.getElementById('scheduleQuickPreviewPopover');
    if (!popover) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
}

function clearCalendarDropIndicators() {
    document.querySelectorAll('.day-cell.is-drop-target').forEach(cell => {
        cell.classList.remove('is-drop-target');
    });
}

function handleCalendarDragStart(event) {
    const item = event.target.closest?.('.schedule-item[data-schedule-id]');
    if (!item || !item.draggable) return;

    const schedule = getScheduleFromRenderedItemElement(item);
    if (!schedule || String(schedule.status || 'pending') !== 'pending') {
        event.preventDefault();
        return;
    }

    scheduleCalendarDragState = {
        scheduleId: String(schedule._id || ''),
        sourceDateKey: String(item.dataset.dateKey || formatIsoDateKey(schedule.scheduledAt) || '')
    };

    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', scheduleCalendarDragState.scheduleId);
}

function handleCalendarDragEnd(event) {
    const item = event.target.closest?.('.schedule-item[data-schedule-id]');
    item?.classList.remove('is-dragging');
    clearCalendarDropIndicators();
    scheduleCalendarDragState = { scheduleId: '', sourceDateKey: '' };
}

function handleCalendarDragOver(event) {
    const cell = event.target.closest?.('.day-cell[data-date]');
    if (!cell) return;

    const dateKey = String(cell.dataset.date || '');
    if (!dateKey || isPastDateKey(dateKey)) return;
    if (!scheduleCalendarDragState.scheduleId) return;

    event.preventDefault();
    cell.classList.add('is-drop-target');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

async function handleCalendarDrop(event) {
    const cell = event.target.closest?.('.day-cell[data-date]');
    if (!cell) return;

    event.preventDefault();
    clearCalendarDropIndicators();

    const dateKey = String(cell.dataset.date || '');
    if (!dateKey || isPastDateKey(dateKey)) return;

    const scheduleId = scheduleCalendarDragState.scheduleId || event.dataTransfer?.getData('text/plain') || '';
    if (!scheduleId) return;

    const schedule = getScheduleFromRenderedItemElement({ dataset: { scheduleId } });
    if (!schedule || String(schedule.status || 'pending') !== 'pending') {
        showToast('Chỉ có thể kéo-thả lịch chưa đăng', 'warning');
        return;
    }

    const updatedIso = combineDateKeyWithTime(dateKey, schedule.scheduledAt);
    if (!updatedIso) {
        showToast('Không thể xác định thời gian mới', 'error');
        return;
    }

    if (formatIsoDateKey(schedule.scheduledAt) === dateKey) return;

    await updateScheduleDateById(scheduleId, updatedIso);
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

async function refreshSchedulePostPlatformOptions() {
    try {
        const res = await fetch('/channels/api/list');
        const data = await res.json();
        if (!data.success) throw new Error('Không tải được danh sách tài khoản');

        const channels = Array.isArray(data.channels) ? data.channels : [];
        schedulePostAvailablePlatforms = new Set(channels.map(ch => ch.platform).filter(Boolean));

        const chips = Array.from(document.querySelectorAll('.platform-chip'));
        chips.forEach(chip => {
            const input = chip.querySelector('.platform-check');
            if (!input) return;

            const hasAccount = schedulePostAvailablePlatforms.has(input.value);
            chip.style.display = hasAccount ? '' : 'none';
            input.disabled = !hasAccount;

            if (!hasAccount) input.checked = false;
        });

        const visibleChecked = Array.from(document.querySelectorAll('.platform-check:checked'))
            .filter(cb => !cb.disabled);

        if (!visibleChecked.length) {
            const firstAvailable = Array.from(document.querySelectorAll('.platform-check'))
                .find(cb => !cb.disabled);
            if (firstAvailable) firstAvailable.checked = true;
        }

        renderAccountList();
        toggleFacebookGroupSelectionForSchedulePost();
    } catch (err) {
        console.error('Refresh schedule post platform options failed:', err);
    }
}

function toggleFacebookGroupSelectionForSchedulePost() {
    const groupWrapper = document.getElementById('facebookGroupSelectWrapper');
    const selectedPlatform = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value)[0] || '';

    const shouldShow = selectedPlatform === 'FB';
    if (groupWrapper) groupWrapper.style.display = shouldShow ? '' : 'none';
    
    // Khi bật FB, đợi renderAccountList xong rồi mới load groups
    if (shouldShow) {
        // Đợi 1 chút để renderAccountList hoàn tất
        setTimeout(() => {
            // Selector đúng với class acc-pick-item
            const checkedFBAccounts = document.querySelectorAll('.acc-pick-item input:checked');
            const fbAccounts = [];
            checkedFBAccounts.forEach(cb => {
                if (cb.closest('.acc-pick-item')?.querySelector('i.fa-facebook')) {
                    fbAccounts.push(cb);
                }
            });
            
            if (fbAccounts.length > 0) {
                const accountId = fbAccounts[0].value;
                void loadSchedulePostFacebookGroups(accountId);
            } else {
                // Chưa có tài khoản FB nào được chọn, chọn tài khoản đầu tiên
                const allCheckboxes = document.querySelectorAll('.acc-pick-item input');
                for (const cb of allCheckboxes) {
                    const icon = cb.closest('.acc-pick-item')?.querySelector('i.fa-facebook');
                    if (icon) {
                        cb.checked = true;
                        const accountId = cb.value;
                        void loadSchedulePostFacebookGroups(accountId);
                        break;
                    }
                }
            }
        }, 300);
    }
}

let selectedGroupKeys = []; // Lưu các group đã chọn
let currentGroupSourceChannelId = ''; // Lưu channel ID hiện tại đang load groups

let schedulePostGroupsLoading = false;

async function loadSchedulePostFacebookGroups(sourceChannelId, preferredGroupKeys = [], forceRefresh = false, scanMode = 'fast') {
    console.log('[DEBUG] loadSchedulePostFacebookGroups called with:', sourceChannelId);
    
    // Disable submit button while loading groups
    const submitBtn = document.getElementById('btnSubmitPostSchedule');
    if (submitBtn) submitBtn.disabled = true;
    schedulePostGroupsLoading = true;
    
    // Lưu source channel ID
    currentGroupSourceChannelId = sourceChannelId;
    
    const combobox = document.getElementById('groupCombobox');
    const dropdown = document.getElementById('groupComboboxDropdown');
    const list = document.getElementById('groupComboboxList');
    const loading = document.getElementById('groupComboboxLoading');
    const empty = document.getElementById('groupComboboxEmpty');
    const hint = document.getElementById('groupComboboxHint');
    const searchInput = document.getElementById('groupSearchInput');
    const selectedCount = document.getElementById('comboboxSelectedCount');

    if (!combobox) {
        console.log('[DEBUG] Combobox not found!');
        schedulePostGroupsLoading = false;
        if (submitBtn) submitBtn.disabled = false;
        return;
    }

    // Reset state
    selectedGroupKeys = preferredGroupKeys ? [...preferredGroupKeys] : [];
    if (searchInput) searchInput.value = '';

    if (!sourceChannelId) {
        list.innerHTML = '';
        empty.style.display = 'none';
        loading.style.display = 'none';
        dropdown.classList.remove('open');
        hint.textContent = 'Chọn tài khoản Facebook bên trên để hiển thị danh sách group.';
        updateSelectedCountDisplay();
        schedulePostFacebookGroups = [];
        schedulePostGroupsLoading = false;
        if (submitBtn) submitBtn.disabled = false;
        return;
    }

    // Show loading
    dropdown.classList.add('open');
    loading.style.display = 'block';
    empty.style.display = 'none';
    list.innerHTML = '';
    hint.textContent = 'Đang tải danh sách group...';

    try {
        const refreshQuery = forceRefresh ? `?refresh=1&mode=${encodeURIComponent(scanMode)}` : '';
        console.log('[DEBUG] Fetching groups from:', `/channels/api/${encodeURIComponent(sourceChannelId)}/facebook-groups${refreshQuery}`);
        const res = await fetch(`/channels/api/${encodeURIComponent(sourceChannelId)}/facebook-groups${refreshQuery}`);
        const data = await res.json();
        console.log('[DEBUG] API response:', data.success ? `OK (${data.groups?.length || 0} groups)` : data.message);
        if (!data.success) throw new Error(data.message || 'Không tải được group');

        schedulePostFacebookGroups = Array.isArray(data.groups) ? data.groups : [];
        
        if (schedulePostFacebookGroups.length === 0) {
            loading.style.display = 'none';
            empty.style.display = 'block';
            hint.textContent = 'Chưa có group nào. Vui lòng vào trang "Quét Group Facebook" để quét.';
            schedulePostGroupsLoading = false;
            if (submitBtn) submitBtn.disabled = false;
            return;
        }

        loading.style.display = 'none';
        hint.textContent = `${schedulePostFacebookGroups.length} groups có sẵn. Chọn một hoặc nhiều group để đăng bài.`;
        renderGroupComboboxList(schedulePostFacebookGroups);
        updateSelectedCountDisplay();
        schedulePostGroupsLoading = false;
        if (submitBtn) submitBtn.disabled = false;
        
        // Dropdown is already open from loading state

    } catch (err) {
        console.error('Load Facebook groups failed:', err);
        loading.style.display = 'none';
        empty.style.display = 'block';
        empty.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Không tải được group. Vui lòng thử lại.';
        hint.textContent = 'Lỗi khi tải danh sách group.';
        schedulePostGroupsLoading = false;
        if (submitBtn) submitBtn.disabled = false;
    }
}

function renderGroupComboboxList(groups, searchTerm = '') {
    const list = document.getElementById('groupComboboxList');
    if (!list) return;

    if (!searchTerm) {
        // Không có từ khóa, hiển thị tất cả
        list.innerHTML = groups.map(group => createGroupItemHTML(group)).join('');
        attachGroupItemListeners();
        return;
    }

    // Sử dụng Fuse.js cho fuzzy search
    const fuse = new Fuse(groups, {
        keys: [
            { name: 'groupName', weight: 0.7 },
            { name: 'groupId', weight: 0.3 }
        ],
        threshold: 0.4,
        distance: 100,
        minMatchCharLength: 1,
        ignoreLocation: true,
        includeScore: true,
        shouldSort: true
    });

    const results = fuse.search(searchTerm);
    const filtered = results.map(r => r.item);

    if (filtered.length === 0) {
        list.innerHTML = `
            <div style="padding: 20px; text-align: center; color: var(--text-muted);">
                <i class="fa-solid fa-search"></i>
                <p style="margin-top: 8px;">Không tìm thấy group nào</p>
            </div>`;
        return;
    }

    list.innerHTML = filtered.map(group => createGroupItemHTML(group)).join('');
    attachGroupItemListeners();
}

function createGroupItemHTML(group) {
    const isSelected = selectedGroupKeys.includes(group.groupUrl || group.groupId);
    return `
        <div class="combobox-item ${isSelected ? 'selected' : ''}" data-group-id="${group.groupId || ''}" data-group-url="${group.groupUrl || group.groupId}">
            <div class="combobox-item-checkbox">${isSelected ? '✓' : ''}</div>
            <div class="combobox-item-content">
                <div class="combobox-item-avatar">${(group.groupName || 'G').charAt(0).toUpperCase()}</div>
                <div class="combobox-item-info">
                    <div class="combobox-item-name">${escapeHtml(group.groupName || 'Unknown')}</div>
                    <div class="combobox-item-id">ID: ${(group.groupId || '').substring(0, 12)}...</div>
                </div>
            </div>
        </div>
    `;
}

function attachGroupItemListeners() {
    const list = document.getElementById('groupComboboxList');
    if (!list) return;
    
    list.querySelectorAll('.combobox-item').forEach(item => {
        item.addEventListener('click', () => {
            const groupUrl = item.dataset.groupUrl;
            const isCurrentlySelected = item.classList.contains('selected');
            
            toggleGroupSelection(groupUrl);
            item.classList.toggle('selected');
            
            const checkbox = item.querySelector('.combobox-item-checkbox');
            checkbox.textContent = isCurrentlySelected ? '' : '✓';
        });
    });
}

function toggleGroupSelection(groupUrl) {
    const index = selectedGroupKeys.indexOf(groupUrl);
    if (index === -1) {
        selectedGroupKeys.push(groupUrl);
    } else {
        selectedGroupKeys.splice(index, 1);
    }
    updateSelectedCountDisplay();
}

function updateSelectedCountDisplay() {
    const selectedCount = document.getElementById('comboboxSelectedCount');
    if (selectedCount) {
        if (selectedGroupKeys.length > 0) {
            selectedCount.textContent = `${selectedGroupKeys.length}`;
        } else {
            selectedCount.textContent = '0';
        }
    }
    updateGroupSelectedBadge();
    renderSelectedGroupTags();
}

function updateGroupSelectedBadge() {
    const badge = document.getElementById('groupSelectedBadge');
    if (!badge) return;
    badge.textContent = `${selectedGroupKeys.length} đã chọn`;
}

function renderSelectedGroupTags() {
    const container = document.getElementById('selectedGroupTags');
    if (!container) return;
    
    container.innerHTML = selectedGroupKeys.map(key => {
        const group = schedulePostFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
        const name = group?.groupName || key;
        const initial = name.charAt(0).toUpperCase();
        
        return `
            <div class="selected-tag" data-key="${escapeHtml(key)}">
                <span>${escapeHtml(name.substring(0, 20))}${name.length > 20 ? '...' : ''}</span>
                <span class="selected-tag__remove" data-action="remove-group" data-key="${escapeHtml(key)}">
                    <i class="fa-solid fa-xmark"></i>
                </span>
            </div>
        `;
    }).join('');
}

// Remove group via event delegation
document.addEventListener('click', function(e) {
    const removeBtn = e.target.closest('.selected-tag__remove[data-action="remove-group"]');
    if (removeBtn) {
        removeSelectedGroup(removeBtn.dataset.key);
    }
});

function removeSelectedGroup(key) {
    const index = selectedGroupKeys.indexOf(key);
    if (index > -1) {
        selectedGroupKeys.splice(index, 1);
        
        // Uncheck in combobox list
        const items = document.querySelectorAll('.combobox-item');
        items.forEach(item => {
            if (item.dataset.groupUrl === key) {
                item.classList.remove('selected');
                const checkbox = item.querySelector('.combobox-item-checkbox');
                if (checkbox) checkbox.textContent = '';
            }
        });
        
        updateSelectedCountDisplay();
    }
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

function getSelectedGroups() {
    return selectedGroupKeys.map(key => {
        const group = schedulePostFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
        return {
            groupId: group?.groupId || '',
            groupUrl: key,
            groupName: group?.groupName || ''
        };
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function fillScheduleForm(schedule) {
    if (!schedule) return;

    currentEditingSchedule = schedule;
    
    // Update form header
    const modalFormTitle = document.getElementById('modalFormTitle');
    const modalFormSubtitle = document.getElementById('modalFormSubtitle');
    const submitButton = document.getElementById('btnSubmitPostSchedule');
    const deleteButton = document.getElementById('btnDeleteSchedule');
    
    if (modalFormTitle) modalFormTitle.textContent = 'Cập nhật bài viết';
    if (modalFormSubtitle) modalFormSubtitle.textContent = 'Chỉnh sửa lịch đăng bài';
    const submitBtnSpan2 = submitButton?.querySelector('span');
    if (submitBtnSpan2) submitBtnSpan2.textContent = 'Cập nhật lịch';
    if (submitButton) submitButton.textContent = 'Cập nhật lịch';
    if (deleteButton) deleteButton.style.display = 'inline-flex';

    const captionInput = document.getElementById('modalCaptionInput');
    if (captionInput) captionInput.value = schedule.caption || '';
    setScheduleTimeInputValue(schedule.scheduledAt);

    const existingImages = Array.isArray(schedule.images) ? schedule.images : [];
    uploadedImagesBlobUrls = existingImages.filter(url => String(url).startsWith('blob:'));
    renderSchedulePostImagePreview(existingImages);

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (schedule.platforms || [])[0] === cb.value);
    renderAccountList();
    toggleFacebookGroupSelectionForSchedulePost();

    // Lấy source channel ID và các group đã chọn từ schedule
    const sourceChannelId = schedule.targetGroupSourceChannelId?._id || schedule.targetGroupSourceChannelId || '';
    
    // Lấy các group đã chọn trước đó (có thể là mảng hoặc string đơn)
    let preferredGroupKeys = [];
    if (schedule.targetGroupIds) {
        // Nhiều groups
        preferredGroupKeys = Array.isArray(schedule.targetGroupIds) ? schedule.targetGroupIds : [schedule.targetGroupIds];
    } else if (schedule.targetGroupUrl || schedule.targetGroupId) {
        // 1 group (legacy)
        preferredGroupKeys = [schedule.targetGroupUrl || schedule.targetGroupId];
    }
    
    // Tự động load groups từ source channel và check các groups đã chọn
    if (sourceChannelId) {
        currentGroupSourceChannelId = sourceChannelId; // Set trước để submit có thể dùng
        void loadSchedulePostFacebookGroups(String(sourceChannelId), preferredGroupKeys);
    } else {
        // Không có source channel, thử load groups từ kênh FB đầu tiên
        const firstFBAccount = document.querySelector('.acc-pick-item input');
        if (firstFBAccount) {
            const icon = firstFBAccount.closest('.acc-pick-item')?.querySelector('i.fa-facebook');
            if (icon) {
                currentGroupSourceChannelId = firstFBAccount.value;
                void loadSchedulePostFacebookGroups(firstFBAccount.value, preferredGroupKeys);
            }
        }
    }

    const firstVisibleAvailable = Array.from(document.querySelectorAll('.platform-check'))
        .find(cb => !cb.disabled && cb.checked);
    if (!firstVisibleAvailable) {
        const fallback = Array.from(document.querySelectorAll('.platform-check'))
            .find(cb => !cb.disabled);
        if (fallback) {
            document.querySelectorAll('.platform-check').forEach(cb => cb.checked = false);
            fallback.checked = true;
            renderAccountList();
        }
    }

    const accChecks = schedule.accounts || [];
    setTimeout(() => {
        document.querySelectorAll('input[name="modalAccSelect"]').forEach(cb => {
            cb.checked = accChecks.includes(cb.value);
        });
    }, 150);
}

function resetScheduleForm() {
    currentEditingSchedule = null;
    selectedGroupKeys = [];
    currentGroupSourceChannelId = '';
    
    // Reset form header
    const modalFormTitle = document.getElementById('modalFormTitle');
    const modalFormSubtitle = document.getElementById('modalFormSubtitle');
    const submitButton = document.getElementById('btnSubmitPostSchedule');
    const deleteButton = document.getElementById('btnDeleteSchedule');
    
    if (modalFormTitle) modalFormTitle.textContent = 'Tạo bài viết mới';
    if (modalFormSubtitle) modalFormSubtitle.textContent = 'Đăng album ảnh lên các nhóm Facebook';
    const submitBtnSpan = submitButton?.querySelector('span');
    if (submitBtnSpan) submitBtnSpan.textContent = 'Xác nhận lên lịch';
    if (submitButton) submitButton.textContent = 'Xác nhận lên lịch';
    if (deleteButton) deleteButton.style.display = 'none';

    revokeSchedulePostPreviewUrls();
    uploadedImagesBlobUrls = [];
    selectedSchedulePostImages = [];

    const captionInput = document.getElementById('modalCaptionInput');
    const imageInput = document.getElementById('actualImageInput');

    if (captionInput) captionInput.value = '';
    if (imageInput) imageInput.value = '';
    setScheduleTimeInputValue('');
    clearSchedulePostImagePreview();

    void loadSchedulePostFacebookGroups('');

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (cb.value === 'FB'));
    toggleFacebookGroupSelectionForSchedulePost();

    // Reset selected tags
    const selectedTagsContainer = document.getElementById('selectedGroupTags');
    if (selectedTagsContainer) selectedTagsContainer.innerHTML = '';
    updateGroupSelectedBadge();
    
    const counter = document.getElementById('phoneCarouselCounterBadge');
    if (counter) counter.innerText = '1/1';

    if (swiperInstance) {
        swiperInstance.destroy(true, true);
        swiperInstance = null;
    }
    renderAccountList();
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

async function loadCalendarSchedules() {
    const month = currentCalendarDate.getMonth() + 1;
    const year = currentCalendarDate.getFullYear();
    const type = getCalendarType();
    const res = await fetch(`/schedule/api/list?type=${type}&month=${month}&year=${year}`);
    const data = await res.json();
    return data.success ? data.schedules || [] : [];
}

function buildCalendarDays(container, date) {
    if (!container) return [];
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const firstDay = (start.getDay() + 6) % 7; // Monday first
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

async function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    const monthLabel = document.querySelector('.current-month');
    if (!grid || !monthLabel) return;

    monthLabel.textContent = formatMonthLabel(currentCalendarDate);

    const allSchedules = await loadCalendarSchedules();
    scheduleCalendarSchedulesCache = Array.isArray(allSchedules) ? allSchedules : [];

    const filters = getCalendarFilterState();
    const filteredSchedules = scheduleCalendarSchedulesCache.filter((schedule) => {
        const matchesStatus = filters.status === 'all' || String(schedule.status || 'pending') === filters.status;
        const matchesPlatform = filters.platform === 'all' || (Array.isArray(schedule.platforms) && schedule.platforms.includes(filters.platform));
        const matchesKeyword = !filters.keyword || getScheduleSearchText(schedule).includes(filters.keyword);
        const matchesDate = !filters.date || formatIsoDateKey(schedule.scheduledAt) === filters.date;
        return matchesStatus && matchesPlatform && matchesKeyword && matchesDate;
    });

    scheduleCalendarOverflowMap = new Map();
    filteredSchedules.forEach((schedule) => {
        const key = formatIsoDateKey(schedule.scheduledAt);
        if (!scheduleCalendarOverflowMap.has(key)) scheduleCalendarOverflowMap.set(key, []);
        scheduleCalendarOverflowMap.get(key).push(schedule);
    });

    updateCalendarStats(scheduleCalendarSchedulesCache, filteredSchedules);

    const weekdayLabels = Array.from(grid.querySelectorAll('.weekday-label')).map(el => el.outerHTML);
    const dayCells = buildCalendarDays(grid, currentCalendarDate).map(({ day, otherMonth, monthShift }) => {
        const date = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + monthShift, day);
        const isToday = date.toDateString() === new Date().toDateString();
        const dateKey = formatIsoDateKey(date);
        const isPast = isPastDateKey(dateKey);
        const items = monthShift === 0 ? (scheduleCalendarOverflowMap.get(dateKey) || []) : [];
        const visibleItems = items.slice(0, 3);
        const remainingCount = Math.max(0, items.length - visibleItems.length);

        const itemHtml = visibleItems.map(item => {
            const platformCode = getSchedulePrimaryPlatform(item);
            const platformMeta = getSchedulePlatformMeta(platformCode);
            const statusMeta = getScheduleStatusMetaClient(item.status);
            const title = String(item.caption || '').trim() || (String(item.type || '') === 'reels' ? 'Reels đã lên lịch' : 'Post đã lên lịch');
            const time = formatShortDateTime(item.scheduledAt).split(' ')[1] || formatShortDateTime(item.scheduledAt);
            const canDrag = String(item.status || 'pending') === 'pending';

            return `
                <div class="schedule-item ${platformMeta.className} schedule-item--${String(item.status || 'pending')} ${String(item.type || 'post') === 'reels' ? 'schedule-item--reels' : 'schedule-item--post'}"
                    draggable="${canDrag ? 'true' : 'false'}"
                    data-schedule-id="${escapeHtml(item._id)}"
                    data-status="${escapeHtml(String(item.status || 'pending'))}"
                    data-date-key="${escapeHtml(dateKey)}"
                    title="${escapeHtml(time)} • ${escapeHtml(title)} • ${escapeHtml(statusMeta.label)}">
                    <div class="schedule-item__main">
                        <i class="${platformMeta.icon}"></i>
                        <span class="schedule-item__text" title="${escapeHtml(title)}">${escapeHtml(time)} • ${escapeHtml(title)}</span>
                    </div>
                    <span class="schedule-item__status ${statusMeta.className}">${escapeHtml(statusMeta.label)}</span>
                </div>`;
        }).join('');

        const moreHtml = remainingCount > 0
            ? `<button type="button" class="schedule-item schedule-item--more" data-date-key="${escapeHtml(dateKey)}" title="Còn ${remainingCount} lịch nữa trong ngày này">
                    <div class="schedule-item__main">
                        <i class="fa-solid fa-ellipsis"></i>
                        <span class="schedule-item__text">+${remainingCount} lịch khác</span>
                    </div>
                    <span class="schedule-item__status status-pending">Xem thêm</span>
               </button>`
            : '';

        const cellContent = otherMonth ? '' : `<div class="day-number">${day}</div>${itemHtml}${moreHtml}`;

        return `
            <div class="day-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isPast ? 'past-disabled' : ''}" data-date="${otherMonth ? '' : dateKey}" data-day="${otherMonth ? '' : day}">
                ${cellContent}
            </div>
        `;
    }).join('');

    grid.innerHTML = weekdayLabels.join('') + dayCells;

    const calendarSummaryEl = document.getElementById('statMonthlyVisible');
    if (calendarSummaryEl) calendarSummaryEl.textContent = getCalendarFilterSummaryText(filters, filteredSchedules);
}

async function openScheduleFromDay(dateString) {
    const type = getCalendarType();
    try {
        const res = await fetch(`/schedule/api/by-date?type=${type}&date=${encodeURIComponent(dateString)}`);
        const data = await res.json();
        openCreatePostModal(null);

        setScheduleTimeInputValue(`${dateString}T09:00`);
        const timeInput = document.getElementById('modalTimeInput');
        if (timeInput) timeInput.title = `Ngày đã chọn: ${formatReadableDateTime(`${dateString}T09:00`)}`;

        const schedules = data.success ? (data.schedules || []) : [];
        if (!schedules.length) {
            resetScheduleForm();
            setScheduleTimeInputValue(`${dateString}T09:00`);
            return;
        }

        fillScheduleForm(schedules[0]);
        if (timeInput && schedules[0]?.scheduledAt) {
            timeInput.title = `Đã chọn: ${formatReadableDateTime(schedules[0].scheduledAt)}`;
        }
    } catch (err) {
        console.error('Load schedule by date failed:', err);
        openCreatePostModal(null);
    }
}

async function openScheduleById(scheduleId) {
    try {
        const res = await fetch(`/schedule/api/${encodeURIComponent(scheduleId)}`);
        const data = await res.json();

        if (!data.success || !data.schedule) {
            resetScheduleForm();
            return;
        }

        if (String(data.schedule.status || 'pending') !== 'pending') {
            showToast('Lịch đã chạy rồi, không thể sửa nữa', 'warning');
            return;
        }

        openCreatePostModal(null);

        fillScheduleForm(data.schedule);
    } catch (err) {
        console.error('Load schedule by id failed:', err);
        openCreatePostModal(null);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Nút tạo post mới
    const btnCreate = document.getElementById('btnCreatePost');
    if (btnCreate) btnCreate.addEventListener('click', () => {
        resetScheduleForm();
        openCreatePostModal(null);
    });

    const calendarGrid = document.getElementById('calendarGrid');
    calendarGrid?.addEventListener('click', (e) => {
        const item = e.target.closest('.schedule-item[data-schedule-id]');
        const moreItem = e.target.closest('.schedule-item--more[data-date-key]');
        const cell = e.target.closest('.day-cell[data-date]');

        if (item) {
            const schedule = getScheduleFromRenderedItemElement(item);
            if (!schedule) return;
            e.stopPropagation();
            closeSchedulePopoverIfNeeded();
            openSchedulePopover(schedule, item, 'detail');
            return;
        }

        if (moreItem) {
            const dateKey = moreItem.dataset.dateKey || '';
            if (!dateKey) return;
            const dayCell = moreItem.closest('.day-cell[data-date]');
            const items = scheduleCalendarOverflowMap.get(dateKey) || [];
            if (!items.length) return;
            closeSchedulePopoverIfNeeded();
            openSchedulePopover(items[0], moreItem, 'overflow', items);
            if (dayCell) dayCell.classList.remove('is-drop-target');
            return;
        }

        if (cell) {
            const dateString = cell.getAttribute('data-date');
            if (!dateString) return;
            const selected = new Date(`${dateString}T00:00:00`);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (selected < today) return;
            openScheduleFromDay(dateString);
        }
    });

    calendarGrid?.addEventListener('dragstart', handleCalendarDragStart);
    calendarGrid?.addEventListener('dragend', handleCalendarDragEnd);
    calendarGrid?.addEventListener('dragover', handleCalendarDragOver);
    calendarGrid?.addEventListener('drop', handleCalendarDrop);

    document.addEventListener('click', (event) => {
        const popover = document.getElementById('scheduleQuickPreviewPopover');
        if (!popover?.classList.contains('open')) return;
        if (event.target.closest('#scheduleQuickPreviewPopover')) return;
        if (event.target.closest('.schedule-item') || event.target.closest('.day-cell')) return;
        closeSchedulePopoverIfNeeded();
    });

    document.getElementById('btnCloseSchedulePopover')?.addEventListener('click', closeSchedulePopoverIfNeeded);
    document.getElementById('scheduleQuickPreviewPopover')?.addEventListener('click', (event) => {
        const editBtn = event.target.closest('#btnPopoverEditSchedule');
        const overflowBtn = event.target.closest('.schedule-popover__overflow-item[data-schedule-id]');
        if (editBtn?.dataset?.scheduleId) {
            const schedule = scheduleCalendarSchedulesCache.find(item => String(item._id) === String(editBtn.dataset.scheduleId));
            if (schedule) {
                closeSchedulePopoverIfNeeded();
                openScheduleById(String(schedule._id));
            }
            return;
        }

        if (overflowBtn?.dataset?.scheduleId) {
            const schedule = scheduleCalendarSchedulesCache.find(item => String(item._id) === String(overflowBtn.dataset.scheduleId));
            if (schedule) {
                closeSchedulePopoverIfNeeded();
                openScheduleById(String(schedule._id));
            }
        }
    });

    document.getElementById('btnPrevMonth')?.addEventListener('click', async () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
        await renderCalendar();
    });

    document.getElementById('btnNextMonth')?.addEventListener('click', async () => {
        currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
        await renderCalendar();
    });

    document.getElementById('btnCalendarToday')?.addEventListener('click', async () => {
        currentCalendarDate = new Date();
        await renderCalendar();
    });

    document.getElementById('btnClearCalendarFilters')?.addEventListener('click', async () => {
        const status = document.getElementById('scheduleStatusFilter');
        const platform = document.getElementById('schedulePlatformFilter');
        const keyword = document.getElementById('scheduleKeywordFilter');
        const date = document.getElementById('scheduleDateFilter');
        if (status) status.value = 'all';
        if (platform) platform.value = 'all';
        if (keyword) keyword.value = '';
        if (date) date.value = '';
        closeSchedulePopoverIfNeeded();
        await renderCalendar();
    });

    ['scheduleStatusFilter', 'schedulePlatformFilter', 'scheduleKeywordFilter', 'scheduleDateFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
        el.addEventListener(evt, () => {
            closeSchedulePopoverIfNeeded();
            void renderCalendar();
        });
    });

    // Upload ảnh - Upload zone click & drag & drop
    const uploadZone = document.getElementById('uploadZone');
    const actualImageInput = document.getElementById('actualImageInput');
    
    if (uploadZone && actualImageInput) {
        // Click to upload
        uploadZone.addEventListener('click', () => actualImageInput.click());
        
        // Drag & drop
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });
        
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const files = e.dataTransfer?.files;
            if (files?.length) {
                handleMultipleImagesPicked(files);
            }
        });
    }
    
    actualImageInput?.addEventListener('change', (e) => handleMultipleImagesPicked(e.target.files));

    // Close buttons
    document.getElementById('btnClosePostModal')?.addEventListener('click', closeCreatePostModal);
    document.getElementById('btnCancelPostSchedule')?.addEventListener('click', closeCreatePostModal);

    // Caption preview
    document.getElementById('modalCaptionInput')?.addEventListener('input', updateLiveFeedPreview);
    document.getElementById('modalDateInput')?.addEventListener('input', syncSchedulePostTimeInput);
    document.getElementById('modalClockInput')?.addEventListener('input', syncSchedulePostTimeInput);
    document.getElementById('modalDateInput')?.addEventListener('change', syncSchedulePostTimeInput);
    document.getElementById('modalClockInput')?.addEventListener('change', syncSchedulePostTimeInput);
    
    // Load groups when FB account is selected (single-select per platform)
    document.getElementById('dynamicAccountBox')?.addEventListener('click', (e) => {
        const accItem = e.target.closest('.acc-pick-item');
        if (!accItem) return;
        
        const checkbox = accItem.querySelector('input[type="checkbox"]');
        if (!checkbox) return;
        
        // FIX: Chỉ cho chọn 1 tài khoản mỗi platform
        // Nếu đang check -> uncheck tất cả account cùng platform khác
        if (!checkbox.checked) {
            checkbox.checked = true;
            const platform = [...accItem.classList].find(c => c.startsWith('acc-platform-'))?.replace('acc-platform-', '');
            // Uncheck các account khác cùng platform
            document.querySelectorAll('.acc-pick-item input:checked').forEach(otherCb => {
                if (otherCb !== checkbox && otherCb.closest('.acc-pick-item')?.classList.contains('acc-platform-' + platform)) {
                    otherCb.checked = false;
                }
            });
            // Load groups cho account được chọn
            const icon = accItem.querySelector('i.fa-facebook');
            if (icon) {
                console.log('[DEBUG] FB account selected:', checkbox.value);
                void loadSchedulePostFacebookGroups(checkbox.value);
            }
        } else {
            // Nếu đang checked mà click lại -> uncheck (cho phép bỏ chọn)
            checkbox.checked = false;
            // Nếu là FB account, load groups từ account đầu tiên còn lại
            const icon = accItem.querySelector('i.fa-facebook');
            if (icon) {
                const remainingFB = document.querySelector('.acc-pick-item.acc-platform-FB input:checked');
                if (remainingFB) {
                    void loadSchedulePostFacebookGroups(remainingFB.value);
                }
            }
        }
    });

    // Group combobox events
    const groupCombobox = document.getElementById('groupCombobox');
    const groupDropdown = document.getElementById('groupComboboxDropdown');
    const groupSearchInput = document.getElementById('groupSearchInput');

    if (groupSearchInput) {
        groupSearchInput.addEventListener('focus', () => {
            if (schedulePostFacebookGroups.length > 0) {
                groupDropdown.classList.add('open');
            }
        });

        groupSearchInput.addEventListener('click', () => {
            if (schedulePostFacebookGroups.length > 0) {
                groupDropdown.classList.add('open');
            }
        });

        groupSearchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value;
            // Mở dropdown khi bắt đầu gõ
            if (schedulePostFacebookGroups.length > 0) {
                groupDropdown.classList.add('open');
            }
            renderGroupComboboxList(schedulePostFacebookGroups, searchTerm);
        });

        groupSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                groupDropdown.classList.remove('open');
                groupSearchInput.blur();
            }
        });
    }

    // Click on combobox wrapper to open dropdown
    document.querySelector('.combobox-input-wrapper')?.addEventListener('click', () => {
        if (schedulePostFacebookGroups.length > 0) {
            groupDropdown?.classList.toggle('open');
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!groupCombobox?.contains(e.target)) {
            groupDropdown?.classList.remove('open');
        }
    });

    // Submit & Close
    document.getElementById('btnSubmitPostSchedule')?.addEventListener('click', submitPostSchedule);
    document.getElementById('btnDeleteSchedule')?.addEventListener('click', async () => {
        await deleteCurrentSchedulePost();
    });

    // Platform
    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.disabled) return;
            renderAccountList();
            toggleFacebookGroupSelectionForSchedulePost();
        });
    });

    window.addEventListener('resize', () => {
        const popover = document.getElementById('scheduleQuickPreviewPopover');
        if (popover?.classList.contains('open')) {
            const scheduleId = popover.dataset.scheduleId || '';
            const schedule = scheduleCalendarSchedulesCache.find(item => String(item._id) === String(scheduleId));
            const anchor = document.querySelector(`.schedule-item[data-schedule-id="${CSS?.escape ? CSS.escape(scheduleId) : scheduleId}"]`);
            if (schedule && anchor) {
                positionSchedulePopover(popover, anchor);
            }
        }
    });

    refreshSchedulePostPlatformOptions();

    renderCalendar();
});

function renderAccountList() {
    const checkedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const boxContainer = document.getElementById('dynamicAccountBox');
    if (!boxContainer) return;

    const typeOrder = { 'Fanpage': 0, 'Nhà sáng tạo': 1, 'Cá nhân': 2 };
    const typeMeta = (accountType = '') => {
        const normalized = String(accountType || '').trim() || 'Cá nhân';
        if (normalized === 'Fanpage') return { label: 'Fanpage', className: 'account-type-pill--fanpage', icon: 'fa-solid fa-flag' };
        if (normalized === 'Nhà sáng tạo') return { label: 'Nhà sáng tạo', className: 'account-type-pill--creator', icon: 'fa-solid fa-pen-nib' };
        return { label: 'Cá nhân', className: 'account-type-pill--personal', icon: 'fa-regular fa-user' };
    };

    fetch('/channels/api/list')
        .then(res => res.json())
        .then(data => {
            if (!data.success) return;
            boxContainer.innerHTML = '';
            const filtered = data.channels
                .filter(ch => checkedPlatforms.includes(ch.platform))
                .slice()
                .sort((a, b) => {
                    if (a.platform !== b.platform) return String(a.platform).localeCompare(String(b.platform), 'vi');
                    return (typeOrder[String(a.accountType || 'Cá nhân').trim()] ?? 99) - (typeOrder[String(b.accountType || 'Cá nhân').trim()] ?? 99);
                });

            filtered.forEach(ch => {
                const icons = { FB: 'fa-brands fa-facebook', IG: 'fa-brands fa-instagram', TT: 'fa-brands fa-tiktok', YT: 'fa-brands fa-youtube' };
                const colors = { FB: '#1877f2', IG: '#e1306c', TT: '#000', YT: '#ff0000' };
                const meta = typeMeta(ch.accountType);
                const label = document.createElement('label');
                label.className = `acc-pick-item acc-platform-${ch.platform}`;
                label.innerHTML = `
                    <input type="checkbox" name="modalAccSelect" value="${ch._id}">
                    <i class="${icons[ch.platform]}" style="color:${colors[ch.platform]}"></i>
                    <span class="acc-pick-item__content">
                        <span class="acc-pick-item__title">${ch.accountName}</span>
                        <span class="acc-pick-item__meta">
                            <span class="account-type-pill ${meta.className}"><i class="${meta.icon}"></i> ${meta.label}</span>
                        </span>
                    </span>`;
                boxContainer.appendChild(label);
            });
        })
        .catch(err => console.error('Load channels error:', err));
}

function updateLiveFeedPreview() {
    const inputText = document.getElementById('modalCaptionInput')?.value;
    const previewDisplay = document.getElementById('liveFeedTextPreview');
    if (previewDisplay) previewDisplay.innerText = inputText?.trim() !== "" ? inputText : "Nội dung bài viết sẽ hiển thị tại đây.";
}

function handleMultipleImagesPicked(files) {
    const thumbContainer = document.getElementById('miniThumbGridContainer');
    const wrapper = document.getElementById('swiperWrapperTarget');
    if (!thumbContainer || !wrapper) return;

    thumbContainer.innerHTML = "";
    wrapper.innerHTML = "";
    revokeSchedulePostPreviewUrls();
    uploadedImagesBlobUrls = [];
    selectedSchedulePostImages = Array.from(files || []).filter(Boolean);

    if (!selectedSchedulePostImages.length) {
        clearSchedulePostImagePreview();
        return;
    }

    selectedSchedulePostPreviewUrls = selectedSchedulePostImages.map(file => URL.createObjectURL(file));

    selectedSchedulePostPreviewUrls.forEach((blobUrl, index) => {
        uploadedImagesBlobUrls.push(blobUrl);
        const thumbItem = document.createElement('div');
        thumbItem.className = "thumb-preview-item";
        thumbItem.innerHTML = `<img src="${blobUrl}"><button class="thumb-preview-remove-btn">&times;</button>`;
        thumbItem.querySelector('button').addEventListener('click', () => {
            const nextFiles = selectedSchedulePostImages.filter((_, i) => i !== index);
            selectedSchedulePostImages = nextFiles;
            revokeSchedulePostPreviewUrls();
            uploadedImagesBlobUrls = [];
            selectedSchedulePostPreviewUrls = selectedSchedulePostImages.map(file => URL.createObjectURL(file));
            renderSchedulePostImagePreview(selectedSchedulePostPreviewUrls);
        });
        thumbContainer.appendChild(thumbItem);

        const slide = document.createElement('div');
        slide.className = "swiper-slide";
        slide.innerHTML = `<img src="${blobUrl}" alt="Preview">`;
        wrapper.appendChild(slide);
    });

    const placeholder = document.getElementById('feedImagePlaceholder');
    if (placeholder) placeholder.style.display = 'none';
    thumbContainer.classList.add('active');

    if (swiperInstance) swiperInstance.destroy(true, true);
    swiperInstance = new Swiper(".mySwiper", {
        pagination: { el: ".swiper-pagination", clickable: true },
        on: {
            slideChange: () => {
                const counter = document.getElementById('phoneCarouselCounterBadge');
                if (counter) counter.innerText = `${swiperInstance.activeIndex + 1}/${uploadedImagesBlobUrls.length}`;
            }
        }
    });

    const counter = document.getElementById('phoneCarouselCounterBadge');
    if (counter) {
        counter.innerText = `1/${uploadedImagesBlobUrls.length}`;
        counter.classList.toggle('active', uploadedImagesBlobUrls.length > 1);
    }
}

function openCreatePostModal(dayNumber) {
    const now = new Date();
    const submitButton = document.getElementById('btnSubmitPostSchedule');
    if (submitButton) submitButton.textContent = 'Xác nhận lên lịch';
    setSchedulePostInputs(now, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    const timeInput = document.getElementById('modalTimeInput');
    if (timeInput) timeInput.title = `Thời gian hiện tại: ${formatReadableDateTime(now)}`;
    document.getElementById('createPostModal')?.classList.add('open');
}

function closeCreatePostModal() {
    document.getElementById('createPostModal')?.classList.remove('open');
}

async function deleteCurrentSchedulePost() {
    if (!currentEditingSchedule?._id) {
        showToast('Chưa có lịch để xóa', 'warning');
        return;
    }

    showConfirm('Bạn có chắc muốn xóa lịch này?', async () => {
        try {
            const res = await fetch(`/schedule/api/${encodeURIComponent(currentEditingSchedule._id)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                currentEditingSchedule = null;
                closeCreatePostModal();
                location.reload();
            } else {
                showToast('Lỗi: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
        }
    });
}

async function submitPostSchedule() {
    const caption = document.getElementById('modalCaptionInput')?.value || '';
    syncSchedulePostTimeInput();
    const scheduledAt = document.getElementById('modalTimeInput')?.value;
    const platforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const accounts = Array.from(document.querySelectorAll('input[name="modalAccSelect"]:checked')).map(cb => cb.value);

    // Get selected groups
    const selectedGroups = getSelectedGroups();
    const targetGroupIds = selectedGroups.map(g => g.groupUrl || g.groupId);

    if (schedulePostGroupsLoading) {
        showToast('Đang tải danh sách group, vui lòng chờ...', 'warning');
        return;
    }

    if (!scheduledAt) {
        showToast('Vui lòng chọn thời gian đăng!', 'warning');
        return;
    }

    const dateInput = document.getElementById('modalDateInput')?.value || '';
    const timeValue = document.getElementById('modalClockInput')?.value || '09:00';

    if (isPastDateTime(dateInput, timeValue)) {
        showToast('Không thể lên lịch vào thời gian trong quá khứ!', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('type', 'post');
    formData.append('caption', caption);
    formData.append('scheduledAt', parseDateInputToIso(dateInput, timeValue) || scheduledAt);
    if (platforms.includes('FB')) {
        if (targetGroupIds.length === 0) {
            showToast('Vui lòng chọn ít nhất một group Facebook để đăng bài!', 'warning');
            return;
        }

        if (!currentGroupSourceChannelId) {
            showToast('Vui lòng chọn tài khoản Facebook nguồn!', 'warning');
            return;
        }

        // Lưu thông tin group source channel
        formData.append('targetGroupSourceChannelId', currentGroupSourceChannelId);
        
        // Lưu nhiều group IDs
        formData.append('targetGroupIds', JSON.stringify(targetGroupIds));
    }
    platforms.forEach(p => formData.append('platforms', p));
    accounts.forEach(a => formData.append('accounts', a));
    const filesToUpload = selectedSchedulePostImages.length
        ? selectedSchedulePostImages
        : Array.from(document.getElementById('actualImageInput')?.files || []);

    if (filesToUpload.length) {
        for (const file of filesToUpload) {
            formData.append('images', file);
        }
    }

    try {
        if (currentEditingSchedule) {
            formData.append('scheduleId', currentEditingSchedule._id);
        }

        const res = await fetch(currentEditingSchedule ? '/schedule/api/update' : '/schedule/api/create', {
            method: currentEditingSchedule ? 'PUT' : 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            currentEditingSchedule = null;
            closeCreatePostModal();
            location.reload();
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}
