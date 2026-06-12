/* ===================================
   REELS.JS - Lịch Đăng Reels
   Kết nối API backend
   =================================== */

function logReelsUiStep(step, details = '') {
    const suffix = details ? ` | ${details}` : '';
    console.log(`[Reels UI] ${step}${suffix}`);
}

document.addEventListener('DOMContentLoaded', () => {
    logReelsUiStep('DOMContentLoaded', 'initialize reels page');

    const phoneMockup = document.getElementById('phoneMockupContainer');
    const phoneVideo = document.getElementById('phoneMockupVideoTag');
    const phonePlayIcon = document.getElementById('phoneCenterPlayIcon');
    const phonePlayPauseBtn = document.getElementById('phonePlayPauseBtn');
    const phoneVideoTitle = document.getElementById('phoneVideoTitle');
    const phoneVideoDuration = document.getElementById('phoneVideoDuration');

    if (phoneMockup && phoneVideo) {
        phoneMockup.addEventListener('click', () => {
            if (phoneVideo.paused) {
                phoneVideo.play().catch(() => {});
                phoneVideo.classList.add('playing');
                phonePlayIcon?.classList.add('hidden-status');
                updatePlayPauseIcon(true);
                showVideoControls(true);
            } else {
                phoneVideo.pause();
                phoneVideo.currentTime = phoneVideo.currentTime;
                phoneVideo.load();
                phoneVideo.classList.remove('playing');
                phonePlayIcon?.classList.remove('hidden-status');
                updatePlayPauseIcon(false);
                showVideoControls(false);
            }
        });
    }

    // Event listener cho nút play/pause trong controls
    if (phonePlayPauseBtn && phoneVideo) {
        phonePlayPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (phoneVideo.paused) {
                phoneVideo.play().catch(() => {});
                phoneVideo.classList.add('playing');
                phonePlayIcon?.classList.add('hidden-status');
                updatePlayPauseIcon(true);
                showVideoControls(true);
            } else {
                phoneVideo.pause();
                phoneVideo.currentTime = phoneVideo.currentTime;
                phoneVideo.load();
                phoneVideo.classList.remove('playing');
                phonePlayIcon?.classList.remove('hidden-status');
                updatePlayPauseIcon(false);
                showVideoControls(false);
            }
        });
    }

    // Cập nhật duration khi video load
    phoneVideo?.addEventListener('loadedmetadata', () => {
        updateVideoDuration();
    });

    // Cập nhật duration mỗi giây khi đang phát
    phoneVideo?.addEventListener('timeupdate', () => {
        updateVideoDuration();
    });

    // Nút tạo reels mới
    const btnCreate = document.getElementById('btnCreatePost');
    if (btnCreate) btnCreate.addEventListener('click', () => {
        logReelsUiStep('open-create-modal', 'clicked create reels');
        resetReelsForm();
        openCreatePostModal(null);
    });

    // Nút hôm nay
    document.querySelector('.btn-today')?.addEventListener('click', () => {
        logReelsUiStep('open-create-modal', 'clicked today button');
        resetReelsForm();
        openCreatePostModal(null);
    });

    document.querySelector('.month-nav .btn-nav:first-child')?.addEventListener('click', async () => {
        logReelsUiStep('calendar-prev-month', `before=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        reelsCalendarState.month -= 1;
        if (reelsCalendarState.month < 1) {
            reelsCalendarState.month = 12;
            reelsCalendarState.year -= 1;
        }
        logReelsUiStep('calendar-prev-month', `after=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        await refreshReelsCalendarFallback();
    });

    document.querySelector('.month-nav .btn-nav:last-child')?.addEventListener('click', async () => {
        logReelsUiStep('calendar-next-month', `before=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        reelsCalendarState.month += 1;
        if (reelsCalendarState.month > 12) {
            reelsCalendarState.month = 1;
            reelsCalendarState.year += 1;
        }
        logReelsUiStep('calendar-next-month', `after=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        await refreshReelsCalendarFallback();
    });

    document.getElementById('btnTodayReels')?.addEventListener('click', async () => {
        const now = new Date();
        logReelsUiStep('jump-today', now.toISOString());
        reelsCalendarState.month = now.getMonth() + 1;
        reelsCalendarState.year = now.getFullYear();
        reelsCalendarState.date = now;
        await refreshReelsCalendarFallback();
    });

    const calendarGrid = document.getElementById('calendarGrid');

    // Calendar click
    calendarGrid?.addEventListener('click', (e) => {
        const scheduleItem = e.target.closest('.schedule-item[data-schedule-id]');
        const moreItem = e.target.closest('.schedule-item--more[data-date-key]');
        const cell = e.target.closest('.day-cell[data-date]');

        if (scheduleItem) {
            const schedule = getReelsScheduleFromRenderedItemElement(scheduleItem);
            if (!schedule) return;
            e.stopPropagation();
            closeReelsPopoverIfNeeded();
            openReelsPopover(schedule, scheduleItem, 'detail');
            return;
        }

        if (moreItem) {
            const dateKey = moreItem.dataset.dateKey || '';
            const items = reelsCalendarOverflowMap.get(dateKey) || [];
            if (!items.length) return;
            closeReelsPopoverIfNeeded();
            openReelsOverflowPopover(dateKey, moreItem);
            return;
        }

        if (!cell || !isReelsDateSelectable(cell.getAttribute('data-date') || buildDateFromCell(cell))) return;
        const dateString = cell.getAttribute('data-date') || buildDateFromCell(cell);
        logReelsUiStep('open-create-from-day', dateString);
        openReelsFromDay(dateString);
    });

    calendarGrid?.addEventListener('dragstart', handleReelsCalendarDragStart);
    calendarGrid?.addEventListener('dragend', handleReelsCalendarDragEnd);
    calendarGrid?.addEventListener('dragover', handleReelsCalendarDragOver);
    calendarGrid?.addEventListener('drop', handleReelsCalendarDrop);

    document.addEventListener('click', (event) => {
        const popover = document.getElementById('reelsQuickPreviewPopover');
        if (!popover?.classList.contains('open')) return;
        if (event.target.closest('#reelsQuickPreviewPopover')) return;
        if (event.target.closest('.schedule-item') || event.target.closest('.day-cell')) return;
        closeReelsPopoverIfNeeded();
    });

    document.getElementById('btnCloseReelsPopover')?.addEventListener('click', closeReelsPopoverIfNeeded);
    document.getElementById('reelsQuickPreviewPopover')?.addEventListener('click', (event) => {
        const editBtn = event.target.closest('#btnPopoverEditReels');
        const overflowBtn = event.target.closest('.schedule-popover__overflow-item[data-schedule-id]');

        if (editBtn?.dataset?.scheduleId) {
            const schedule = reelsCalendarSchedulesCache.find(item => String(item._id) === String(editBtn.dataset.scheduleId));
            if (schedule) {
                closeReelsPopoverIfNeeded();
                openReelsScheduleById(String(schedule._id));
            }
            return;
        }

        if (overflowBtn?.dataset?.scheduleId) {
            const schedule = reelsCalendarSchedulesCache.find(item => String(item._id) === String(overflowBtn.dataset.scheduleId));
            if (schedule) {
                closeReelsPopoverIfNeeded();
                openReelsScheduleById(String(schedule._id));
            }
        }
    });

    // Upload video local
    const btnUploadLocal = document.getElementById('btnUploadLocal');
    const videoFileInput = document.getElementById('modalVideoFileSelector');
    if (btnUploadLocal && videoFileInput) {
        btnUploadLocal.addEventListener('click', () => videoFileInput.click());
        videoFileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                logReelsUiStep('local-video-selected', `${e.target.files[0].name} (${e.target.files[0].size} bytes)`);
                handleVideoSelected(e.target.files[0]).catch((err) => {
                    console.error('Handle video selected failed:', err);
                    showToast?.('Không thể xử lý video vừa chọn', 'error');
                });
            }
        });
    }

    // Chọn từ kho
    const btnOpenLib = document.getElementById('btnOpenLibrary');
    if (btnOpenLib) btnOpenLib.addEventListener('click', openMiniLibrary);

    const btnCloseMiniLib = document.getElementById('btnCloseMiniLib');
    if (btnCloseMiniLib) btnCloseMiniLib.addEventListener('click', closeMiniLibrary);

    const btnSubmitReelsSchedule = document.getElementById('btnSubmitReelsSchedule');
    if (btnSubmitReelsSchedule) btnSubmitReelsSchedule.addEventListener('click', async () => {
        logReelsUiStep('submit-schedule-click');
        const saved = await submitReelsSchedule();
        if (saved) {
            logReelsUiStep('submit-schedule-success');
            stopReelsPlayback();
            closeCreatePostModal();
        }
    });

    document.getElementById('btnDeleteReels')?.addEventListener('click', async () => {
        await deleteCurrentReelsSchedule();
    });

    // Đóng modal
    document.querySelector('.btn-close-modal')?.addEventListener('click', () => {
        stopReelsPlayback();
        closeCreatePostModal();
    });
    document.getElementById('btnCloseReelsModal')?.addEventListener('click', () => {
        stopReelsPlayback();
        closeCreatePostModal();
    });
    document.getElementById('btnCancelReels')?.addEventListener('click', (e) => {
        e.preventDefault();
        resetReelsForm();
        stopReelsPlayback();
        closeCreatePostModal();
    });

    // Submit is bound only once above to prevent duplicate schedule creation

    // Caption preview
    // Platform
    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.addEventListener('change', () => {
            renderAccountList();
            syncSelectedPlatformPreview();
            toggleShopeeLinkSectionForReels();
        });
    });

    document.getElementById('modalCaptionInput')?.addEventListener('input', updateLiveMobilePreview);

    document.getElementById('miniLibSearchInput')?.addEventListener('input', searchVideoInMiniLibrary);

    document.getElementById('dynamicShopeeLinkBox')?.addEventListener('change', () => {
        syncSelectedShopeeLinksPreview();
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
        closeReelsPopoverIfNeeded();
        await refreshReelsCalendarFallback();
    });

    ['scheduleStatusFilter', 'schedulePlatformFilter', 'scheduleKeywordFilter', 'scheduleDateFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
        el.addEventListener(evt, () => {
            closeReelsPopoverIfNeeded();
            applyReelsFilters();
        });
    });

    window.addEventListener('resize', () => {
        const popover = document.getElementById('reelsQuickPreviewPopover');
        if (!popover?.classList.contains('open')) return;
        const scheduleId = popover.dataset.scheduleId || '';
        const schedule = reelsCalendarSchedulesCache.find(item => String(item._id) === String(scheduleId));
        const anchor = document.querySelector(`.schedule-item[data-schedule-id="${scheduleId}"]`);
        if (schedule && anchor) {
            positionReelsPopover(popover, anchor);
        }
    });

    document.getElementById('miniLibGridContainer')?.addEventListener('click', (e) => {
        const item = e.target.closest('.mini-lib-item');
        if (!item) return;
        selectVideoFromMiniLib(item.dataset.videoTitle, item.dataset.videoSize, item.dataset.videoUrl);
    });

    const btnMockDriveSync = document.getElementById('btnMockDriveSync');
    if (btnMockDriveSync) {
        btnMockDriveSync.addEventListener('click', () => showToast('Đồng bộ ảnh mẫu áo từ Google Drive thành công!', 'success'));
    }

    loadShopeeLinksForReels();
    initReelsAutoRefresh();

    // Load dữ liệu Reels ngay khi mở trang thay vì phụ thuộc vào calendar của màn Post.
    refreshReelsCalendarFallback();

    // Auto refresh to keep reels schedule calendar in sync with latest data
});

let currentEditingReels = null;
let reelsRefreshTimer = null;
let reelsRefreshInFlight = false;
let reelsMiniLibraryCache = [];
let reelsMiniLibrarySearch = '';
let reelsShopeeLinksCache = [];
let currentSelectedReelsVideo = {
    id: '',
    url: '',
    poster: '',
    title: '',
    size: ''
};
let currentReelsVideoUploadPromise = null;
let isReelsVideoUploading = false;
let reelsCalendarState = {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    lastSignature: ''
};

let reelsAvailablePlatforms = new Set();
let reelsCalendarSchedulesCache = [];
let reelsCalendarOverflowMap = new Map();
let reelsCalendarDragState = { scheduleId: '', sourceDateKey: '' };
let reelsCalendarActivePopover = { scheduleId: '', mode: 'detail' };
let reelsAccountOptionsCache = [];
let reelsRealtimeSocket = null;
let reelsRealtimeRefreshTimer = null;

function updateReelsSubmitButtonState() {
    const btnSubmit = document.getElementById('btnSubmitReelsSchedule');
    if (!btnSubmit) return;

    if (currentEditingReels?._id) {
        btnSubmit.textContent = 'Cập nhật lịch';
        btnSubmit.setAttribute('data-mode', 'edit');
    } else {
        btnSubmit.textContent = 'Xác nhận lên lịch';
        btnSubmit.setAttribute('data-mode', 'create');
    }
}

async function refreshReelsPlatformOptions() {
    try {
        logReelsUiStep('refresh-platform-options-start');
        const res = await fetch('/channels/api/list');
        const data = await res.json();
        if (!data.success) throw new Error('Không tải được danh sách tài khoản');

        const channels = Array.isArray(data.channels) ? data.channels : [];
        reelsAvailablePlatforms = new Set(channels.map(ch => ch.platform).filter(Boolean));

        const platformChips = Array.from(document.querySelectorAll('.platform-chip'));
        platformChips.forEach(chip => {
            const input = chip.querySelector('.platform-check');
            if (!input) return;

            const platform = input.value;
            const channelPlatform = reelsPlatformToChannel(platform);
            const hasAccount = reelsAvailablePlatforms.has(channelPlatform);
            chip.style.display = hasAccount ? '' : 'none';
            input.disabled = !hasAccount;

            if (!hasAccount) {
                input.checked = false;
            }
        });

        const visibleSelected = Array.from(document.querySelectorAll('.platform-check:checked'))
            .filter(cb => !cb.disabled);

        if (!visibleSelected.length) {
            const firstAvailable = Array.from(document.querySelectorAll('.platform-check'))
                .find(cb => !cb.disabled);
            if (firstAvailable) firstAvailable.checked = true;
        }

        syncSelectedPlatformPreview();
        renderAccountList();
        toggleShopeeLinkSectionForReels();
        logReelsUiStep('refresh-platform-options-done', `available=${Array.from(reelsAvailablePlatforms).join(',') || 'none'}`);
    } catch (err) {
        console.error('Refresh reels platform options failed:', err);
    }
}

function setReelsVideoPreview({ id = '', url = '', poster = '', title = '', size = '' } = {}) {
    currentSelectedReelsVideo = { id, url, poster, title, size };

    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const posterEl = document.getElementById('phoneMockupPosterTag');
    const badge = document.getElementById('filePickedBadge');
    const nameEl = document.getElementById('filePickedName');
    const sizeEl = document.getElementById('filePickedSize');
    const titleEl = document.getElementById('phoneVideoTitle');

    if (badge) badge.style.display = url ? 'flex' : 'none';
    if (nameEl) nameEl.textContent = title || 'Đã chọn video';
    if (sizeEl) sizeEl.textContent = size || '';
    if (titleEl) titleEl.textContent = title || 'Video Preview';

    if (posterEl) {
        if (poster) {
            posterEl.src = poster;
            posterEl.classList.add('active');
        } else {
            posterEl.removeAttribute('src');
            posterEl.classList.remove('active');
        }
    }

    if (!videoPlayer) return;

    if (poster) videoPlayer.poster = poster;
    else videoPlayer.removeAttribute('poster');

    if (url) {
        videoPlayer.src = url;
        videoPlayer.load();
        videoPlayer.pause();
        videoPlayer.classList.add('active');
        showVideoControls(false);
        updatePlayPauseIcon(false);
    } else {
        videoPlayer.removeAttribute('src');
        videoPlayer.removeAttribute('poster');
        videoPlayer.load();
        videoPlayer.classList.remove('active');
        showVideoControls(false);
        updatePlayPauseIcon(false);
    }
}

function updateReelsRunNowButtonState() {
    const btn = document.getElementById('btnRunReelsNow');
    if (!btn) return;

    const hasSchedule = Boolean(currentEditingReels?._id);
    btn.disabled = !hasSchedule;
    btn.style.opacity = hasSchedule ? '1' : '0.55';
    btn.title = hasSchedule
        ? 'Chạy ngay lịch Reels này trên Chrome'
        : 'Hãy mở một lịch Reels đã tạo để dùng nút này';
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

function getReelsCalendarDateFromCell(cell) {
    return cell?.dataset?.date || '';
}

function formatReelsMonthLabel(date) {
    return date.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' }).replace(/^(.)/, m => m.toUpperCase());
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

function formatLocalDateKey(dateValue) {
    const d = new Date(dateValue);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

function getReelsPrimaryPlatform(schedule) {
    const platforms = Array.isArray(schedule?.platforms) ? schedule.platforms.filter(Boolean) : [];
    if (platforms.includes('TA')) return 'TA';
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
        TT: { label: 'TikTok Video', icon: 'fa-brands fa-tiktok', className: 'item-tt' },
        TA: { label: 'TikTok Affiliate', icon: 'fa-solid fa-link', className: 'item-ta' }
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
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function getReelsCalendarFilterState() {
    return {
        status: document.getElementById('scheduleStatusFilter')?.value || 'all',
        platform: document.getElementById('schedulePlatformFilter')?.value || 'all',
        keyword: String(document.getElementById('scheduleKeywordFilter')?.value || '').trim().toLowerCase(),
        date: document.getElementById('scheduleDateFilter')?.value || ''
    };
}

function updateReelsCalendarStats(allSchedules = [], visibleSchedules = []) {
    const totalEl = document.getElementById('statMonthlyTotal');
    const visibleEl = document.getElementById('statMonthlyVisible');
    const pendingEl = document.getElementById('statMonthlyPending');
    const postedEl = document.getElementById('statMonthlyPosted');
    const failedEl = document.getElementById('statMonthlyFailed');

    const total = allSchedules.length;
    const pending = allSchedules.filter(item => String(item.status || 'pending') === 'pending').length;
    const posted = allSchedules.filter(item => String(item.status || 'posted') === 'posted').length;
    const failed = allSchedules.filter(item => String(item.status || 'failed') === 'failed').length;

    if (totalEl) totalEl.textContent = String(total);
    if (visibleEl) visibleEl.textContent = `Đang hiển thị ${visibleSchedules.length} lịch`;
    if (pendingEl) pendingEl.textContent = String(pending);
    if (postedEl) postedEl.textContent = String(posted);
    if (failedEl) failedEl.textContent = String(failed);
}

function closeReelsPopover() {
    const popover = document.getElementById('reelsQuickPreviewPopover');
    if (!popover) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
    reelsCalendarActivePopover = { scheduleId: '', mode: 'detail' };
}

function closeReelsPopoverIfNeeded() {
    closeReelsPopover();
}

function positionReelsPopover(popover, anchorEl) {
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

function buildReelsPreviewHtml(schedule = {}) {
    const platformMeta = getReelsPlatformMeta(getReelsPrimaryPlatform(schedule));
    const statusMeta = getReelsStatusMeta(schedule.status);
    const rawTitle = String(schedule.caption || '').trim() || 'Reels đã lên lịch';
    const title = rawTitle.length > 80 ? rawTitle.substring(0, 77) + '...' : rawTitle;
    const videoTitle = schedule.videoTitle || schedule.videoName || (schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId.title : '') || '—';
    const videoSize = schedule.videoSize || (schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId.fileSize : '') || '—';
    const poster = schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId.thumbnailUrl : '';

    return `
        <div class="schedule-popover__meta-line">
            <span class="schedule-popover__badge ${platformMeta.className}"><i class="${platformMeta.icon}"></i> ${platformMeta.label}</span>
            <span class="schedule-popover__badge ${statusMeta.className}"><i class="${statusMeta.icon}"></i></span>
        </div>
        <div class="schedule-popover__section">
            <strong>Thời gian</strong>
            <p>${formatReadableDateTime(schedule.scheduledAt) || '—'}</p>
        </div>
        <div class="schedule-popover__section">
            <strong>Caption</strong>
            <p class="schedule-popover__caption">${title}</p>
        </div>
        <div class="schedule-popover__section">
            <strong>Video</strong>
            ${poster ? `<div class="schedule-popover__media-grid"><img src="${poster}" alt="Xem trước video"></div>` : '<div class="schedule-popover__empty-media"><i class="fa-regular fa-circle-play"></i><span>Chưa có ảnh xem trước</span></div>'}
        </div>
        <div class="schedule-popover__section schedule-popover__section--grid">
            <div><strong>Nền tảng</strong><p>${Array.isArray(schedule.platforms) && schedule.platforms.length ? schedule.platforms.map(code => getReelsPlatformMeta(code).label).join(', ') : '—'}</p></div>
            <div><strong>Trạng thái</strong><p>${statusMeta.label}</p></div>
            <div><strong>Tài khoản</strong><p>${Array.isArray(schedule.accounts) && schedule.accounts.length ? schedule.accounts.join(', ') : '—'}</p></div>
            <div><strong>Video</strong><p>${videoTitle}${videoSize && videoSize !== '—' ? ` • ${videoSize}` : ''}</p></div>
        </div>
    `;
}

function openReelsPopover(schedule, anchorEl, mode = 'detail', overflowItems = []) {
    const popover = document.getElementById('reelsQuickPreviewPopover');
    const body = document.getElementById('reelsPopoverBody');
    const titleEl = document.getElementById('reelsPopoverTitle');
    const eyebrowEl = document.getElementById('reelsPopoverEyebrow');
    if (!popover || !body || !titleEl || !eyebrowEl || !schedule) return;

    const platformMeta = getReelsPlatformMeta(getReelsPrimaryPlatform(schedule));
    titleEl.textContent = mode === 'overflow' ? 'Danh sách lịch ẩn' : (String(schedule.caption || '').trim() || 'Chi tiết Reels');
    eyebrowEl.textContent = mode === 'overflow' ? 'Xem thêm trong ngày' : `${platformMeta.label} • ${formatShortDateTime(schedule.scheduledAt)}`;

    if (mode === 'overflow' && Array.isArray(overflowItems) && overflowItems.length) {
        body.innerHTML = `<div class="schedule-popover__overflow-list">${overflowItems.map(item => {
            const itemPlatform = getReelsPlatformMeta(getReelsPrimaryPlatform(item));
            const itemStatus = getReelsStatusMeta(item.status);
            const itemTitle = String(item.caption || '').trim() || 'Reels đã lên lịch';
            const timeParts = formatShortDateTime(item.scheduledAt).split(' ');
            const timeOnly = timeParts[1] || timeParts[0] || '';
            return `
                <button type="button" class="schedule-popover__overflow-item" data-schedule-id="${item._id}">
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
            ${buildReelsPreviewHtml(schedule)}
            <div class="schedule-popover__actions">
                <button type="button" class="btn-calendar-secondary" id="btnPopoverEditReels" data-schedule-id="${schedule._id}">
                    <i class="fa-solid fa-pen-to-square"></i> Mở để chỉnh sửa
                </button>
            </div>
        `;
    }

    popover.dataset.scheduleId = String(schedule._id || '');
    popover.dataset.mode = mode;
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => positionReelsPopover(popover, anchorEl));
    reelsCalendarActivePopover = { scheduleId: String(schedule._id || ''), mode };
}

function openReelsOverflowPopover(dateKey, anchorEl) {
    const items = reelsCalendarOverflowMap.get(dateKey) || [];
    if (!items.length) return;
    openReelsPopover(items[0], anchorEl, 'overflow', items);
}

function getReelsScheduleFromRenderedItemElement(itemEl) {
    const scheduleId = itemEl?.dataset?.scheduleId || '';
    if (!scheduleId) return null;
    return reelsCalendarSchedulesCache.find(schedule => String(schedule._id) === String(scheduleId)) || null;
}

function clearReelsCalendarDropIndicators() {
    document.querySelectorAll('.day-cell.is-drop-target').forEach(cell => cell.classList.remove('is-drop-target'));
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

function getReelsUpdatePayload(schedule, scheduledAtIso) {
    return {
        scheduleId: String(schedule._id || ''),
        type: String(schedule.type || 'reels'),
        caption: String(schedule.caption || ''),
        scheduledAt: scheduledAtIso,
        platforms: Array.isArray(schedule.platforms) ? schedule.platforms : [],
        accounts: Array.isArray(schedule.accounts) ? schedule.accounts : [],
        videoId: schedule.videoId && typeof schedule.videoId === 'object' ? String(schedule.videoId._id || '') : String(schedule.videoId || ''),
        videoPath: String(schedule.videoPath || ''),
        videoTitle: String(schedule.videoTitle || ''),
        videoSize: String(schedule.videoSize || ''),
        shopeeLinks: Array.isArray(schedule.shopeeLinks)
            ? schedule.shopeeLinks.map(link => (link && typeof link === 'object') ? String(link._id || '') : String(link || '')).filter(Boolean)
            : []
    };
}

async function updateReelsScheduleDateById(scheduleId, scheduledAtIso) {
    if (!scheduleId || !scheduledAtIso) return;
    try {
        const detailRes = await fetch(`/schedule/api/${encodeURIComponent(scheduleId)}`);
        const detailData = await detailRes.json();
        if (!detailData.success || !detailData.schedule) {
            showToast?.('Không tải được lịch để dời ngày', 'error');
            return;
        }

        const schedule = detailData.schedule;
        if (String(schedule.status || 'pending') !== 'pending') {
            showToast?.('Chỉ có thể kéo-thả lịch chưa đăng', 'warning');
            return;
        }

        const payload = getReelsUpdatePayload(schedule, scheduledAtIso);
        const res = await fetch('/schedule/api/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) {
            showToast?.(data.message || 'Không thể cập nhật lịch', 'error');
            return;
        }

        showToast?.('Đã dời lịch Reels thành công', 'success');
        await refreshReelsCalendarFallback();
    } catch (err) {
        console.error('Update reels schedule date failed:', err);
        showToast?.('Lỗi khi dời lịch', 'error');
    }
}

function handleReelsCalendarDragStart(event) {
    const item = event.target.closest?.('.schedule-item[data-schedule-id]');
    if (!item || !item.draggable) return;
    const schedule = getReelsScheduleFromRenderedItemElement(item);
    if (!schedule || String(schedule.status || 'pending') !== 'pending') {
        event.preventDefault();
        return;
    }

    reelsCalendarDragState = {
        scheduleId: String(schedule._id || ''),
        sourceDateKey: String(item.dataset.dateKey || formatIsoDateKey(schedule.scheduledAt) || '')
    };
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', reelsCalendarDragState.scheduleId);
}

function handleReelsCalendarDragEnd(event) {
    const item = event.target.closest?.('.schedule-item[data-schedule-id]');
    item?.classList.remove('is-dragging');
    clearReelsCalendarDropIndicators();
    reelsCalendarDragState = { scheduleId: '', sourceDateKey: '' };
}

function handleReelsCalendarDragOver(event) {
    const cell = event.target.closest?.('.day-cell[data-date]');
    if (!cell) return;
    const dateKey = String(cell.dataset.date || '');
    if (!dateKey || isPastDateKey(dateKey) || !reelsCalendarDragState.scheduleId) return;
    event.preventDefault();
    cell.classList.add('is-drop-target');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
}

async function handleReelsCalendarDrop(event) {
    const cell = event.target.closest?.('.day-cell[data-date]');
    if (!cell) return;
    event.preventDefault();
    clearReelsCalendarDropIndicators();

    const dateKey = String(cell.dataset.date || '');
    if (!dateKey || isPastDateKey(dateKey)) return;

    const scheduleId = reelsCalendarDragState.scheduleId || event.dataTransfer?.getData('text/plain') || '';
    if (!scheduleId) return;

    const schedule = getReelsScheduleFromRenderedItemElement({ dataset: { scheduleId } });
    if (!schedule || String(schedule.status || 'pending') !== 'pending') {
        showToast?.('Chỉ có thể kéo-thả lịch chưa đăng', 'warning');
        return;
    }

    const updatedIso = combineDateKeyWithTime(dateKey, schedule.scheduledAt);
    if (!updatedIso) {
        showToast?.('Không thể xác định thời gian mới', 'error');
        return;
    }

    if (formatIsoDateKey(schedule.scheduledAt) === dateKey) return;

    await updateReelsScheduleDateById(scheduleId, updatedIso);
}

function renderReelsCalendar(schedules = []) {
    const grid = document.getElementById('calendarGrid');
    const monthLabel = document.querySelector('.current-month');
    if (!grid || !monthLabel) return;

    monthLabel.textContent = formatReelsMonthLabel(reelsCalendarState.date || new Date(reelsCalendarState.year, reelsCalendarState.month - 1, 1));

    reelsCalendarSchedulesCache = Array.isArray(schedules) ? schedules : [];

    const filters = getReelsCalendarFilterState();
    const filteredSchedules = reelsCalendarSchedulesCache.filter((schedule) => {
        const matchesStatus = filters.status === 'all' || String(schedule.status || 'pending') === filters.status;
        const matchesPlatform = filters.platform === 'all' || (Array.isArray(schedule.platforms) && schedule.platforms.includes(filters.platform));
        const matchesKeyword = !filters.keyword || getReelsSearchText(schedule).includes(filters.keyword);
        const matchesDate = !filters.date || formatIsoDateKey(schedule.scheduledAt) === filters.date;
        return matchesStatus && matchesPlatform && matchesKeyword && matchesDate;
    });

    reelsCalendarOverflowMap = new Map();
    filteredSchedules.forEach((schedule) => {
        const key = formatIsoDateKey(schedule.scheduledAt);
        if (!reelsCalendarOverflowMap.has(key)) reelsCalendarOverflowMap.set(key, []);
        reelsCalendarOverflowMap.get(key).push(schedule);
    });

    updateReelsCalendarStats(reelsCalendarSchedulesCache, filteredSchedules);

    const weekdayLabels = Array.from(grid.querySelectorAll('.weekday-label')).map(el => el.outerHTML);
    const baseDate = reelsCalendarState.date || new Date(reelsCalendarState.year, reelsCalendarState.month - 1, 1);
    const dayCells = buildReelsCalendarDays(baseDate).map(({ day, otherMonth, monthShift }) => {
        const date = new Date(baseDate.getFullYear(), baseDate.getMonth() + monthShift, day);
        const isToday = date.toDateString() === new Date().toDateString();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dateKey = formatIsoDateKey(date);
        const isPast = date < today;
        const items = monthShift === 0 ? (reelsCalendarOverflowMap.get(dateKey) || []) : [];
        const visibleItems = items.slice(0, 3);
        const remainingCount = Math.max(0, items.length - visibleItems.length);

        const itemHtml = visibleItems.map(item => {
            const platformMeta = getReelsPlatformMeta(getReelsPrimaryPlatform(item));
            const statusMeta = getReelsStatusMeta(item.status);
            const time = formatShortDateTime(item.scheduledAt).split(' ')[1] || formatShortDateTime(item.scheduledAt);
            const rawTitle = String(item.caption || '').trim() || 'Reels đã lên lịch';
            const title = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
            const canDrag = String(item.status || 'pending') === 'pending';
            return `<div class="schedule-item ${platformMeta.className} ${statusMeta.className} ${String(item.type || 'reels') === 'reels' ? 'schedule-item--reels' : 'schedule-item--post'}" draggable="${canDrag ? 'true' : 'false'}" data-schedule-id="${item._id}" data-date-key="${dateKey}" title="${time} • ${rawTitle}"><i class="${platformMeta.icon}"></i><span class="schedule-item-body"><span class="schedule-item__text" title="${rawTitle}">${time} • ${title}</span></span><span class="schedule-item__status-label ${statusMeta.className}">${statusMeta.label}</span></div>`;
        }).join('');

        const moreHtml = remainingCount > 0
            ? `<button type="button" class="schedule-item schedule-item--more" data-date-key="${dateKey}" title="Còn ${remainingCount} lịch nữa trong ngày này"><div class="schedule-item__main"><i class="fa-solid fa-ellipsis"></i><span class="schedule-item__text">+${remainingCount} lịch khác</span></div><span class="schedule-item__status status-pending">Xem thêm</span></button>`
            : '';

        const cellContent = otherMonth ? '' : `<div class="day-number">${day}</div>${itemHtml}${moreHtml}`;

        return `
            <div class="day-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isPast ? 'past-disabled' : ''}" data-date="${otherMonth ? '' : dateKey}" data-day="${otherMonth ? '' : day}">
                ${cellContent}
            </div>
        `;
    }).join('');

    grid.innerHTML = weekdayLabels.join('') + dayCells;
}

window.renderReelsCalendar = renderReelsCalendar;

function fillReelsForm(schedule) {
    if (!schedule) return;

    currentEditingReels = schedule;
    const captionInput = document.getElementById('modalCaptionInput');
    const videoPlayer = document.getElementById('phoneMockupVideoTag');

    if (captionInput) captionInput.value = schedule.caption || '';
    updateLiveMobilePreview();
    const timeInput = document.getElementById('modalTimeInput');
    if (schedule.scheduledAt) {
        const scheduled = new Date(schedule.scheduledAt);
        setReelsScheduleInputs(schedule.scheduledAt, `${pad2(scheduled.getHours())}:${pad2(scheduled.getMinutes())}`);
        if (timeInput) timeInput.title = `Đã chọn: ${formatReadableDateTime(schedule.scheduledAt)}`;
    }

    const populatedVideo = schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId : null;
    const hasVideo = !!(schedule.videoUrl || schedule.videoPath || populatedVideo?.filePath);
    setReelsVideoPreview({
        id: populatedVideo?._id || (typeof schedule.videoId === 'string' ? schedule.videoId : ''),
        url: schedule.videoUrl || schedule.videoPath || populatedVideo?.filePath || '',
        poster: populatedVideo?.thumbnailUrl || '',
        title: schedule.videoTitle || schedule.videoName || populatedVideo?.title || 'Đã chọn video',
        size: schedule.videoSize || ''
    });

    if (videoPlayer && hasVideo) {
        videoPlayer.classList.add('active');
    }

    const placeholder = document.getElementById('phoneCenterPlayIcon');
    if (placeholder) placeholder.classList.toggle('hidden-status', hasVideo);

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (schedule.platforms || []).includes(cb.value));
    renderAccountList();
    syncSelectedPlatformPreview();
    updateReelsSubmitButtonState();

    const accChecks = schedule.accounts || [];
    setTimeout(() => {
        document.querySelectorAll('input[name="modalAccSelect"]').forEach(cb => {
            cb.checked = accChecks.includes(cb.value);
        });
    }, 150);

    updateReelsRunNowButtonState();
}

function resetReelsForm() {
    currentEditingReels = null;
    currentSelectedReelsVideo = { id: '', url: '', poster: '', title: '', size: '' };
    currentReelsVideoUploadPromise = null;
    isReelsVideoUploading = false;
    const captionInput = document.getElementById('modalCaptionInput');
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const posterEl = document.getElementById('phoneMockupPosterTag');

    if (captionInput) captionInput.value = '';
    updateLiveMobilePreview();
    const dateInput = document.getElementById('modalDateInput');
    const clockInput = document.getElementById('modalClockInput');
    const timeInput = document.getElementById('modalTimeInput');
    if (dateInput) dateInput.value = '';
    if (clockInput) clockInput.value = '09:00';
    if (timeInput) {
        timeInput.value = '';
        timeInput.title = '';
    }
    setReelsVideoPreview();
    if (videoPlayer) videoPlayer.classList.remove('active');
    if (posterEl) {
        posterEl.removeAttribute('src');
        posterEl.classList.remove('active');
    }

    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (playIcon) playIcon.classList.remove('hidden-status');

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (cb.value === 'FR'));
    renderAccountList();
    syncSelectedPlatformPreview();
    renderShopeeLinkList();
    syncSelectedShopeeLinksPreview();
    toggleShopeeLinkSectionForReels();
    updateReelsRunNowButtonState();
    updateReelsSubmitButtonState();
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

function isReelsDateSelectable(dateString) {
    if (!dateString) return false;
    const selected = new Date(`${dateString}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return selected >= today;
}

async function openReelsFromDay(dateString) {
    try {
        logReelsUiStep('load-day-schedule-start', dateString);
        const res = await fetch(`/schedule/api/by-date?type=reels&date=${encodeURIComponent(dateString)}`);
        const data = await res.json();

        openCreatePostModal(null);

        setReelsScheduleInputs(new Date(`${dateString}T00:00:00`), '09:00');
        const timeInput = document.getElementById('modalTimeInput');
        if (timeInput) timeInput.title = `Ngày đã chọn: ${formatReadableDateTime(`${dateString}T09:00`)}`;

        const schedules = data.success ? (data.schedules || []) : [];
        logReelsUiStep('load-day-schedule-result', `count=${schedules.length}`);
        if (!schedules.length) {
            resetReelsForm();
            setReelsScheduleInputs(new Date(`${dateString}T00:00:00`), '09:00');
            if (timeInput) timeInput.title = `Ngày đã chọn: ${formatReadableDateTime(`${dateString}T09:00`)}`;
            return;
        }

        fillReelsForm(schedules[0]);
    } catch (err) {
        console.error('Load reels by date failed:', err);
        openCreatePostModal(null);
    }
}

async function openReelsScheduleById(scheduleId) {
    try {
        logReelsUiStep('load-schedule-by-id-start', scheduleId);
        const res = await fetch(`/schedule/api/${encodeURIComponent(scheduleId)}`);
        const data = await res.json();
        openCreatePostModal(null);

        if (!data.success || !data.schedule) {
            logReelsUiStep('load-schedule-by-id-empty', scheduleId);
            resetReelsForm();
            return;
        }

        fillReelsForm(data.schedule);
        logReelsUiStep('load-schedule-by-id-done', `status=${data.schedule.status || 'pending'}`);

        const populatedVideo = data.schedule.videoId && typeof data.schedule.videoId === 'object' ? data.schedule.videoId : null;
        if (populatedVideo || data.schedule.videoUrl || data.schedule.videoPath) {
            setReelsVideoPreview({
                id: populatedVideo?._id || (typeof data.schedule.videoId === 'string' ? data.schedule.videoId : ''),
                url: data.schedule.videoUrl || data.schedule.videoPath || populatedVideo?.filePath || '',
                poster: populatedVideo?.thumbnailUrl || '',
                title: data.schedule.videoTitle || data.schedule.videoName || populatedVideo?.title || 'Đã chọn video',
                size: data.schedule.videoSize || ''
            });
        }
    } catch (err) {
        console.error('Load reels schedule by id failed:', err);
        openCreatePostModal(null);
    }
}

function initReelsAutoRefresh() {
    if (reelsRefreshTimer) return;

    const triggerRefresh = () => {
        const refreshFn = typeof window.refreshReelsCalendar === 'function'
            ? window.refreshReelsCalendar
            : null;

        if (refreshFn) {
            refreshFn();
            return;
        }

        refreshReelsCalendarFallback();
    };

    logReelsUiStep('auto-refresh-start', '15s interval');
    triggerRefresh();
    reelsRefreshTimer = setInterval(triggerRefresh, 15000);
}

async function refreshReelsCalendarFallback() {
    if (reelsRefreshInFlight) return;
    reelsRefreshInFlight = true;

    try {
        const { month, year } = reelsCalendarState;
        logReelsUiStep('calendar-refresh-start', `${month}/${year}`);
        const res = await fetch(`/schedule/api/list?type=reels&month=${month}&year=${year}`);
        const data = await res.json();

        if (!data.success || !Array.isArray(data.schedules)) return;

        const signature = JSON.stringify(
            data.schedules.map(item => [item._id, item.scheduledAt, item.caption, item.status].join('|'))
        );

        if (signature === reelsCalendarState.lastSignature) return;
        reelsCalendarState.lastSignature = signature;

        if (typeof window.renderReelsCalendar === 'function') {
            window.renderReelsCalendar(data.schedules);
        }
        logReelsUiStep('calendar-refresh-done', `count=${data.schedules.length}`);
    } catch (err) {
        console.error('Refresh reels calendar failed:', err);
    } finally {
        reelsRefreshInFlight = false;
    }
}

window.refreshReelsCalendar = refreshReelsCalendarFallback;

function applyReelsFilters() {
    if (!reelsCalendarSchedulesCache.length) return;

    const filters = getReelsCalendarFilterState();
    const filteredSchedules = reelsCalendarSchedulesCache.filter((schedule) => {
        const matchesStatus = filters.status === 'all' || String(schedule.status || 'pending') === filters.status;
        const matchesPlatform = filters.platform === 'all' || (Array.isArray(schedule.platforms) && schedule.platforms.includes(filters.platform));
        const matchesKeyword = !filters.keyword || getReelsSearchText(schedule).includes(filters.keyword);
        const matchesDate = !filters.date || formatIsoDateKey(schedule.scheduledAt) === filters.date;
        return matchesStatus && matchesPlatform && matchesKeyword && matchesDate;
    });

    reelsCalendarOverflowMap = new Map();
    filteredSchedules.forEach((schedule) => {
        const key = formatIsoDateKey(schedule.scheduledAt);
        if (!reelsCalendarOverflowMap.has(key)) reelsCalendarOverflowMap.set(key, []);
        reelsCalendarOverflowMap.get(key).push(schedule);
    });

    updateReelsCalendarStats(reelsCalendarSchedulesCache, filteredSchedules);

    const grid = document.getElementById('calendarGrid');
    if (!grid) return;

    const weekdayLabels = Array.from(grid.querySelectorAll('.weekday-label')).map(el => el.outerHTML);
    const baseDate = reelsCalendarState.date || new Date(reelsCalendarState.year, reelsCalendarState.month - 1, 1);
    const dayCells = buildReelsCalendarDays(baseDate).map(({ day, otherMonth, monthShift }) => {
        const date = new Date(baseDate.getFullYear(), baseDate.getMonth() + monthShift, day);
        const isToday = date.toDateString() === new Date().toDateString();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dateKey = formatIsoDateKey(date);
        const isPast = date < today;
        const items = monthShift === 0 ? (reelsCalendarOverflowMap.get(dateKey) || []) : [];
        const visibleItems = items.slice(0, 3);
        const remainingCount = Math.max(0, items.length - visibleItems.length);

        const itemHtml = visibleItems.map(item => {
            const platformMeta = getReelsPlatformMeta(getReelsPrimaryPlatform(item));
            const statusMeta = getReelsStatusMeta(item.status);
            const time = formatShortDateTime(item.scheduledAt).split(' ')[1] || formatShortDateTime(item.scheduledAt);
            const rawTitle = String(item.caption || '').trim() || 'Reels đã lên lịch';
            const title = rawTitle.length > 40 ? rawTitle.substring(0, 37) + '...' : rawTitle;
            const canDrag = String(item.status || 'pending') === 'pending';
            return `<div class="schedule-item ${platformMeta.className} ${statusMeta.className} ${String(item.type || 'reels') === 'reels' ? 'schedule-item--reels' : 'schedule-item--post'}" draggable="${canDrag ? 'true' : 'false'}" data-schedule-id="${item._id}" data-date-key="${dateKey}" title="${time} • ${rawTitle}"><i class="${platformMeta.icon}"></i><span class="schedule-item-body"><span class="schedule-item__text" title="${rawTitle}">${time} • ${title}</span></span><span class="schedule-item__status-label ${statusMeta.className}">${statusMeta.label}</span></div>`;
        }).join('');

        const moreHtml = remainingCount > 0
            ? `<button type="button" class="schedule-item schedule-item--more" data-date-key="${dateKey}" title="Còn ${remainingCount} lịch nữa trong ngày này"><div class="schedule-item__main"><i class="fa-solid fa-ellipsis"></i><span class="schedule-item__text">+${remainingCount} lịch khác</span></div><span class="schedule-item__status status-pending">Xem thêm</span></button>`
            : '';

        const cellContent = otherMonth ? '' : `<div class="day-number">${day}</div>${itemHtml}${moreHtml}`;

        return `
            <div class="day-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isPast ? 'past-disabled' : ''}" data-date="${otherMonth ? '' : dateKey}" data-day="${otherMonth ? '' : day}">
                ${cellContent}
            </div>
        `;
    }).join('');

    const weekdayRow = grid.querySelector('.weekday-row');
    grid.innerHTML = (weekdayRow ? weekdayRow.outerHTML : '') + dayCells;
}

let selectedVideoUrl = '';

function openCreatePostModal(dayNumber) {
    const now = new Date();
    const dateInput = document.getElementById('modalDateInput');
    const clockInput = document.getElementById('modalClockInput');
    const timeInput = document.getElementById('modalTimeInput');

    if (dateInput && !dateInput.value) {
        setReelsScheduleInputs(now, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
        if (timeInput) timeInput.title = `Thời gian hiện tại: ${formatReadableDateTime(now)}`;
    } else if (clockInput && !clockInput.value) {
        setReelsScheduleInputs(dateInput?.value ? new Date(`${dateInput.value.split('/').reverse().join('-')}T00:00:00`) : now, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    }
    logReelsUiStep('open-modal', `currentSchedule=${currentEditingReels?._id || 'new'}`);
    document.getElementById('createPostModal')?.classList.add('open');
    updateReelsRunNowButtonState();
    updateReelsSubmitButtonState();
}

function refreshReelsModalUI() {
    const preview = document.getElementById('livePreviewCaption');
    const caption = document.getElementById('modalCaptionInput')?.value || '';
    if (preview) preview.textContent = caption.trim() || 'Nội dung Reels sẽ hiển thị tại đây.';
}

function closeCreatePostModal() {
    document.getElementById('createPostModal')?.classList.remove('open');
}

async function runCurrentReelsScheduleNow() {
    if (!currentEditingReels?._id) {
        showToast?.('Hãy chọn một lịch Reels đã có trước khi chạy ngay', 'warning');
        return;
    }

    const btn = document.getElementById('btnRunReelsNow');
    if (btn) btn.disabled = true;

    try {
        showToast?.('Đang mở Chrome để chạy lịch Reels...', 'info');
        logReelsUiStep('run-now-start', `scheduleId=${currentEditingReels._id}`);
        const res = await fetch(`/schedule/api/reels-runner/run-schedule/${encodeURIComponent(currentEditingReels._id)}`, {
            method: 'POST'
        });
        const data = await res.json();

        logReelsUiStep('run-now-response', `success=${Boolean(data.success)} message=${data.message || ''}`);

        if (data.success) {
            showToast?.(data.message || 'Đã chạy Chrome cho lịch Reels', 'success');
        } else {
            showToast?.(data.message || 'Không thể chạy lịch Reels', 'error');
        }
    } catch (error) {
        console.error('Run current reels schedule now failed:', error);
        showToast?.('Lỗi kết nối khi chạy lịch Reels', 'error');
    } finally {
        updateReelsRunNowButtonState();
    }
}

async function deleteCurrentReelsSchedule() {
    if (!currentEditingReels?._id) {
        showToast('Chưa có lịch để xóa', 'warning');
        return;
    }

    showConfirm('Bạn có chắc muốn xóa lịch này?', async () => {
        logReelsUiStep('delete-schedule-confirmed', currentEditingReels._id);

        try {
            const res = await fetch(`/schedule/api/${encodeURIComponent(currentEditingReels._id)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                currentEditingReels = null;
                closeCreatePostModal();
                await refreshReelsCalendarFallback();
            } else {
                showToast('Lỗi: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
        }
    });
}

function stopReelsPlayback() {
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const posterEl = document.getElementById('phoneMockupPosterTag');
    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (!videoPlayer) return;

    videoPlayer.pause();
    videoPlayer.currentTime = 0;
    videoPlayer.removeAttribute('src');
    videoPlayer.removeAttribute('poster');
    videoPlayer.load();
    videoPlayer.classList.remove('playing');
    if (posterEl) {
        posterEl.removeAttribute('src');
        posterEl.classList.remove('active');
    }
    playIcon?.classList.remove('hidden-status');
    showVideoControls(false);
    updatePlayPauseIcon(false);
}

function updatePlayPauseIcon(isPlaying) {
    const playPauseBtn = document.getElementById('phonePlayPauseBtn');
    if (!playPauseBtn) return;

    const icon = playPauseBtn.querySelector('i');
    if (!icon) return;

    if (isPlaying) {
        icon.classList.remove('fa-play');
        icon.classList.add('fa-pause');
    } else {
        icon.classList.remove('fa-pause');
        icon.classList.add('fa-play');
    }
}

function showVideoControls(show) {
    const controls = document.getElementById('phoneVideoControls');
    if (!controls) return;

    if (show) {
        controls.classList.add('visible');
    } else {
        controls.classList.remove('visible');
    }
}

function updateVideoDuration() {
    const durationEl = document.getElementById('phoneVideoDuration');
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    if (!durationEl || !videoPlayer) return;

    const duration = videoPlayer.duration;
    if (!duration || Number.isNaN(duration)) return;

    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    durationEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateLiveMobilePreview() {
    const text = document.getElementById('modalCaptionInput')?.value;
    const preview = document.getElementById('livePreviewCaption');
    if (preview) preview.textContent = text?.trim() || 'Nội dung Reels sẽ hiển thị tại đây.';
}

function syncSelectedPlatformPreview() {
    const selected = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const preview = document.getElementById('phonePreviewPlatformName');
    if (!preview) return;

    const labelMap = {
        FB: 'Facebook Reels',
        TT: 'TikTok Reels',
        IG: 'Instagram Reels',
        YT: 'YouTube Shorts'
    };
    preview.textContent = selected.length ? selected.map(v => labelMap[v] || v).join(' • ') : 'Xem trước Reels';
}

function normalizeReelsAccountType(value) {
    const type = String(value || '').trim();
    if (type === 'Fanpage') return 'Fanpage';
    if (type === 'Nhà sáng tạo') return 'Nhà sáng tạo';
    return 'Cá nhân';
}

function reelsPlatformToChannel(platformCode) {
    const map = { FR: 'FB', YS: 'YT', IG: 'IG', TT: 'TT', TA: 'TT' };
    return map[platformCode] || platformCode;
}

function isFacebookPersonalAccount(channel = {}) {
    const p = String(channel.platform || '').trim();
    return p === 'FB' && normalizeReelsAccountType(channel.accountType || 'Cá nhân') === 'Cá nhân';
}

function renderAccountList() {
    const checkedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const boxContainer = document.getElementById('dynamicAccountBox');
    if (!boxContainer) return;

    console.log('[Reels] renderAccountList - checkedPlatforms:', checkedPlatforms);

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
            console.log('[Reels] channels API response:', data);
            if (!data.success) return;
            boxContainer.innerHTML = '';
            reelsAccountOptionsCache = Array.isArray(data.channels) ? data.channels : [];

            console.log('[Reels] channels loaded:', reelsAccountOptionsCache.length, 'channels');

            const channelPlatforms = checkedPlatforms.map(reelsPlatformToChannel);
            const filtered = reelsAccountOptionsCache
                .filter(ch => channelPlatforms.includes(String(ch.platform || '').trim()))
                .filter(ch => {
                    const p = String(ch.platform || '').trim();
                    if (p === 'FB') return !isFacebookPersonalAccount(ch);
                    return true;
                })
                .slice()
                .sort((a, b) => {
                    if (a.platform !== b.platform) return String(a.platform).localeCompare(String(b.platform), 'vi');
                    return (typeOrder[String(a.accountType || 'Cá nhân').trim()] ?? 99) - (typeOrder[String(b.accountType || 'Cá nhân').trim()] ?? 99);
                });

            console.log('[Reels] filtered accounts:', filtered.length, 'accounts');

            if (!filtered.length) {
                const hasBlockedFacebookPersonal = reelsAccountOptionsCache.some(ch => channelPlatforms.includes(String(ch.platform || '').trim()) && isFacebookPersonalAccount(ch));
                boxContainer.innerHTML = `
                    <div style="grid-column:1/-1; padding:12px 14px; border:1px dashed var(--border-dark); border-radius:14px; background:#f8fafc; color:var(--text-muted); font-size:0.84rem; line-height:1.45;">
                        ${hasBlockedFacebookPersonal
                            ? 'Không có tài khoản hợp lệ cho Reels. Tài khoản Facebook cá nhân không hỗ trợ đăng Reels, hãy chọn Fanpage hoặc Nhà sáng tạo.'
                            : 'Chưa có tài khoản phù hợp với nền tảng đang chọn.'}
                    </div>`;
                return;
            }

            filtered.forEach(ch => {
                const platformIcons = { FB: 'fa-brands fa-facebook', TT: 'fa-brands fa-tiktok', IG: 'fa-brands fa-instagram', YT: 'fa-brands fa-youtube' };
                const platformColors = { FB: '#1877f2', TT: '#000', IG: '#e1306c', YT: '#ff0000' };
                const meta = typeMeta(ch.accountType);
                const label = document.createElement('label');
                label.className = 'acc-pick-item';
                label.innerHTML = `
                    <input type="checkbox" name="modalAccSelect" value="${ch._id}">
                    <i class="${platformIcons[ch.platform]}" style="color:${platformColors[ch.platform]}"></i>
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

function applyScheduleToForm(schedule) {
    if (!schedule) return;
    fillReelsForm(schedule);
    openCreatePostModal(null);
}

function getScheduleDateFromCell(cell) {
    return cell?.dataset?.date || '';
}

async function uploadReelsVideoToServer(file) {
    if (!file) throw new Error('Thiếu file video');

    logReelsUiStep('upload-video-start', `${file.name} (${file.size} bytes)`);

    const formData = new FormData();
    formData.append('video', file);

    console.log('[Reels] Uploading selected local video to /schedule/api/upload-local-reels-video ...');
    const res = await fetch('/schedule/api/upload-local-reels-video', { method: 'POST', body: formData });
    const data = await res.json();

    if (!data.success || !data.video) {
        throw new Error(data.message || 'Không upload được video local cho Reels');
    }

    logReelsUiStep('upload-video-done', `path=${data.video.filePath || ''}`);

    return data.video;
}

async function handleVideoSelected(file) {
    logReelsUiStep('handle-video-selected-start', file.name);
    const badge = document.getElementById('filePickedBadge');
    const nameEl = document.getElementById('filePickedName');
    const sizeEl = document.getElementById('filePickedSize');

    if (badge) badge.style.display = 'flex';
    if (nameEl) nameEl.textContent = file.name;
    if (sizeEl) sizeEl.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';

    // Preview tạm bằng blob URL trong khi upload.
    if (selectedVideoUrl && String(selectedVideoUrl).startsWith('blob:')) {
        try { URL.revokeObjectURL(selectedVideoUrl); } catch (e) {}
    }

    selectedVideoUrl = URL.createObjectURL(file);
    setReelsVideoPreview({
        id: '',
        url: selectedVideoUrl,
        poster: '',
        title: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1) + ' MB'
    });

    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    if (videoPlayer) {
        videoPlayer.src = selectedVideoUrl;
        videoPlayer.classList.add('active');
        videoPlayer.play().catch(() => {});
    }

    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (playIcon) playIcon.classList.add('hidden-status');

    isReelsVideoUploading = true;
    const uploadPromise = uploadReelsVideoToServer(file);
    currentReelsVideoUploadPromise = uploadPromise;

    try {
        const uploadedVideo = await uploadPromise;

        currentSelectedReelsVideo = {
            id: uploadedVideo._id || '',
            url: uploadedVideo.filePath || '',
            poster: uploadedVideo.thumbnailUrl || '',
            title: uploadedVideo.title || file.name,
            size: formatFileSize(uploadedVideo.fileSize || file.size)
        };

        selectedVideoUrl = uploadedVideo.filePath || selectedVideoUrl;
        setReelsVideoPreview({
            id: currentSelectedReelsVideo.id,
            url: currentSelectedReelsVideo.url,
            poster: currentSelectedReelsVideo.poster,
            title: currentSelectedReelsVideo.title,
            size: currentSelectedReelsVideo.size
        });

        if (videoPlayer && currentSelectedReelsVideo.url) {
            videoPlayer.src = currentSelectedReelsVideo.url;
            if (currentSelectedReelsVideo.poster) videoPlayer.poster = currentSelectedReelsVideo.poster;
            videoPlayer.classList.add('active');
        }

        showToast?.('Đã upload video local cho Reels, sẵn sàng lên lịch', 'success');
        logReelsUiStep('handle-video-selected-done', `resolvedVideoId=${currentSelectedReelsVideo.id || 'local-only'}`);
        console.log('[Reels] Selected video uploaded and bound to currentSelectedReelsVideo:', currentSelectedReelsVideo);
    } finally {
        isReelsVideoUploading = false;
        currentReelsVideoUploadPromise = null;
    }
}

async function submitReelsSchedule() {
    logReelsUiStep('submit-schedule-start');
    const caption = document.getElementById('modalCaptionInput')?.value || '';
    syncReelsScheduleTimeInput();
    const scheduledAt = document.getElementById('modalTimeInput')?.value;
    const platforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const accounts = Array.from(document.querySelectorAll('input[name="modalAccSelect"]:checked')).map(cb => cb.value);
    const shopeeLinks = Array.from(document.querySelectorAll('input[name="modalShopeeLinkSelect"]:checked')).map(cb => cb.value);
    const selectedAccountDetails = reelsAccountOptionsCache.filter(ch => accounts.includes(String(ch._id || '')));

    if (isReelsVideoUploading && currentReelsVideoUploadPromise) {
        logReelsUiStep('submit-schedule-wait-upload');
        showToast('Đang upload video lên kho, vui lòng đợi một chút...', 'info');
        try {
            await currentReelsVideoUploadPromise;
        } catch (err) {
            showToast('Upload video thất bại, vui lòng chọn lại video', 'error');
            return false;
        }
    }

    const resolvedVideoId = currentSelectedReelsVideo.id || (currentEditingReels?.videoId && typeof currentEditingReels.videoId === 'object' ? currentEditingReels.videoId._id : currentEditingReels?.videoId) || '';
    const resolvedVideoPath = currentSelectedReelsVideo.url && !resolvedVideoId
        ? currentSelectedReelsVideo.url
        : (currentEditingReels?.videoPath || '');
    const resolvedVideoTitle = currentSelectedReelsVideo.title || currentEditingReels?.videoTitle || '';
    const resolvedVideoSize = currentSelectedReelsVideo.size || currentEditingReels?.videoSize || '';

    if (!scheduledAt) {
        logReelsUiStep('submit-schedule-invalid', 'missing scheduledAt');
        showToast('Vui lòng chọn thời gian đăng!', 'warning');
        return false;
    }

    const dateInput = document.getElementById('modalDateInput')?.value || '';
    const timeValue = document.getElementById('modalClockInput')?.value || '09:00';

    if (isPastReelsDateTime(dateInput, timeValue)) {
        logReelsUiStep('submit-schedule-invalid', `past-time=${dateInput} ${timeValue}`);
        showToast('Không thể lên lịch vào thời gian trong quá khứ!', 'warning');
        return false;
    }

    if (selectedAccountDetails.some(isFacebookPersonalAccount)) {
        showToast('Tài khoản Facebook cá nhân không hỗ trợ đăng Reels. Vui lòng chọn Fanpage hoặc Nhà sáng tạo.', 'warning');
        return false;
    }

    try {
        const payload = {
            type: 'reels',
            caption,
            scheduledAt: parseDateInputToIso(dateInput, timeValue) || scheduledAt,
            platforms,
            accounts,
            shopeeLinks,
            videoId: resolvedVideoId,
            videoPath: resolvedVideoPath,
            videoTitle: resolvedVideoTitle,
            videoSize: resolvedVideoSize
        };

        console.log('[Reels] submit payload =', JSON.stringify({
            ...payload,
            shopeeLinksCount: shopeeLinks.length,
            videoResolved: Boolean(resolvedVideoId)
        }));
        logReelsUiStep('submit-schedule-payload', `videoId=${payload.videoId || 'none'}; videoPath=${payload.videoPath || 'none'}; links=${shopeeLinks.length}; mode=${currentEditingReels ? 'update' : 'create'}`);

        if (!payload.videoId && !payload.videoPath) {
            showToast('Vui lòng chọn video local hoặc video từ kho trước khi lên lịch!', 'warning');
            return false;
        }

        const method = currentEditingReels ? 'PUT' : 'POST';
        const url = currentEditingReels ? '/schedule/api/update' : '/schedule/api/create';

        if (currentEditingReels) payload.scheduleId = currentEditingReels._id;

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            logReelsUiStep('submit-schedule-success', `scheduleId=${data.schedule?._id || currentEditingReels?._id || 'new'}`);
            currentEditingReels = null;
            closeCreatePostModal();
            if (typeof window.refreshReelsCalendar === 'function') {
                await window.refreshReelsCalendar(true);
            } else {
                await refreshReelsCalendarFallback();
            }
            return true;
        } else {
            showToast('Lỗi: ' + data.message, 'error');
            return false;
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
        return false;
    }
}

// Mini Library
function openMiniLibrary() {
    loadAvailableVideosForReels();
    document.getElementById('miniLibraryModal')?.classList.add('open');
}

async function loadShopeeLinksForReels() {
    const box = document.getElementById('dynamicShopeeLinkBox');
    if (!box) return;

    box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Đang tải link affiliate...</div>';

    try {
        const res = await fetch('/shopee/api/list?status=ALL');
        const data = await res.json();

        if (!data.success) throw new Error('Không tải được link Shopee');

        reelsShopeeLinksCache = data.links || [];
        renderShopeeLinkList();
    } catch (err) {
        console.error('Load Shopee links failed:', err);
        box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Không tải được link affiliate</div>';
    }
}

function renderShopeeLinkList() {
    const box = document.getElementById('dynamicShopeeLinkBox');
    if (!box) return;

    const selectedPlatform = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value)[0] || '';

    if (selectedPlatform === 'TT') {
        box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">TikTok Video không có link affiliate</div>';
        return;
    }

    const keyword = (document.getElementById('miniLibSearchInput')?.value || '').toLowerCase();
    const list = reelsShopeeLinksCache.filter(link => !keyword || (link.title || '').toLowerCase().includes(keyword));

    if (!list.length) {
        box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Không có link phù hợp</div>';
        return;
    }

    box.innerHTML = list.map(link => `
        <label class="acc-pick-item" style="align-items:flex-start;">
            <input type="checkbox" name="modalShopeeLinkSelect" value="${link._id}">
            <img src="${link.imageUrl || getCspSafePlaceholderImage(link.title)}" alt="${link.title}" style="width:44px; height:44px; object-fit:cover; border-radius:8px; border:1px solid var(--border); flex-shrink:0;">
            <span style="display:flex; flex-direction:column; gap:2px;">
                <strong style="font-size:0.85rem; color:var(--text-main);">${link.title}</strong>
                <small style="font-size:0.72rem; color:var(--text-muted); word-break:break-all;">${link.shopeeUrl}</small>
            </span>
        </label>
    `).join('');
}

function syncSelectedShopeeLinksPreview() {
    // Placeholder for future preview count/summary if needed.
}

function toggleShopeeLinkSectionForReels() {
    const section = document.getElementById('dynamicShopeeLinkBox')?.closest('.form-section');
    if (!section) return;
    const selectedPlatform = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value)[0] || '';
    const showFor = ['FR', 'YS', 'IG', 'TA'];
    section.style.display = showFor.includes(selectedPlatform) ? '' : 'none';
    if (showFor.includes(selectedPlatform)) {
        renderShopeeLinkList();
    }
}

function closeMiniLibrary() {
    document.getElementById('miniLibraryModal')?.classList.remove('open');
}

async function loadAvailableVideosForReels() {
    const grid = document.getElementById('miniLibGridContainer');
    if (!grid) return;

    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Đang tải video từ kho...</div>';

    try {
        const [videoRes, scheduleRes] = await Promise.all([
            fetch('/videos/api/list?status=all'),
            fetch('/schedule/api/list?type=reels&month=' + (reelsCalendarState.month) + '&year=' + (reelsCalendarState.year))
        ]);

        const videoData = await videoRes.json();
        const scheduleData = await scheduleRes.json();

        if (!videoData.success) throw new Error('Không tải được video');

        const scheduledVideoIds = new Set(
            (scheduleData.success ? scheduleData.schedules || [] : [])
                .map(item => item.videoId && typeof item.videoId === 'object' ? item.videoId._id : item.videoId)
                .filter(Boolean)
                .map(String)
        );

        const availableVideos = (videoData.videos || []).filter(v => !scheduledVideoIds.has(String(v._id)));
        reelsMiniLibraryCache = availableVideos;

        renderAvailableVideosForReels();
    } catch (err) {
        console.error('Load available reels videos failed:', err);
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Không tải được video từ kho</div>';
    }
}

function renderAvailableVideosForReels() {
    const grid = document.getElementById('miniLibGridContainer');
    if (!grid) return;

    const keyword = reelsMiniLibrarySearch.trim().toLowerCase();
    const filteredVideos = reelsMiniLibraryCache.filter(v => {
        const title = (v.title || '').toLowerCase();
        return !keyword || title.includes(keyword);
    });

    if (!filteredVideos.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Không tìm thấy video phù hợp</div>';
        return;
    }

    grid.innerHTML = filteredVideos.map(v => `
        <div class="mini-lib-item" data-video-id="${v._id}" data-filename="${v.title}" data-video-title="${v.title}" data-video-size="${formatFileSize(v.fileSize)}" data-video-url="${v.filePath}" data-video-thumb="${v.thumbnailUrl || v.thumbnailPath || ''}">
            <div style="width:100%; height:100px; background:#e2e8f0; display:flex; align-items:center; justify-content:center; color:var(--text-muted); overflow:hidden;">
                ${v.thumbnailUrl || v.thumbnailPath
                    ? `<img src="${v.thumbnailUrl || v.thumbnailPath}" alt="${v.title}" style="width:100%; height:100%; object-fit:cover; display:block;">`
                    : '<i class="fa-solid fa-clapperboard" style="font-size:1.5rem;"></i>'}
            </div>
            <div style="padding:8px; font-size:0.775rem; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" class="lib-file-title">${v.title}</div>
        </div>
    `).join('');
}

  function selectVideoFromMiniLib(filename, size, videoUrl) {
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const gridItem = document.querySelector(`.mini-lib-item[data-video-url="${CSS.escape(videoUrl)}"]`);
    const videoId = gridItem?.dataset?.videoId || '';
    const poster = gridItem?.dataset?.videoThumb || '';

    selectedVideoUrl = videoUrl;
    setReelsVideoPreview({
      id: videoId,
      url: videoUrl,
      poster,
      title: filename,
      size
    });
    if (videoPlayer) {
      videoPlayer.classList.add('active');
      videoPlayer.play().catch(() => {
        // Nếu không thể tự động phát (có thể do trình duyệt chặn autoplay),
        // cho phép người dùng play thủ công
        console.log('Autoplay blocked, waiting for user interaction');
      });
    }
    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (playIcon) playIcon.classList.add('hidden-status');
    closeMiniLibrary();
  }

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function searchVideoInMiniLibrary() {
    reelsMiniLibrarySearch = document.getElementById('miniLibSearchInput')?.value || '';
    renderAvailableVideosForReels();
    renderShopeeLinkList();
}

// ============================================================
// REALTIME SOCKET - Listen for schedule status updates
// ============================================================

function reelsCalendarRefreshFromRealtime(data = {}) {
    if (reelsRealtimeRefreshTimer) {
        clearTimeout(reelsRealtimeRefreshTimer);
    }

    reelsRealtimeRefreshTimer = setTimeout(async () => {
        try {
            await refreshReelsCalendarFallback();
            const status = String(data.status || '').trim();
            if (status === 'posted') {
                showToast('Lịch Reels đã đăng thành công và được cập nhật.', 'success');
            } else if (status === 'failed') {
                showToast('Lịch Reels đăng thất bại. Vui lòng kiểm tra lại.', 'error');
            } else if (status === 'processing') {
                const message = data.progress?.message || 'Đang xử lý đăng bài...';
                showToast(message, 'info');
            }
        } catch (error) {
            console.error('[Reels Socket] Refresh calendar failed:', error);
        }
    }, 250);
}

function initReelsRealtimeSocket() {
    const userId = window.__CURRENT_USER_ID || null;
    if (!userId || typeof io === 'undefined' || reelsRealtimeSocket) return;

    reelsRealtimeSocket = io(window.location.origin, {
        transports: ['websocket', 'polling']
    });

    reelsRealtimeSocket.on('connect', () => {
        reelsRealtimeSocket.emit('join-user', userId);
        console.log('[Reels Socket] Connected:', reelsRealtimeSocket.id);
    });

    reelsRealtimeSocket.on('schedule-update', (data) => {
        if (!data || !data._id) return;

        // Only handle reels type updates
        if (data.type && String(data.type) !== 'reels') return;

        console.log('[Reels Socket] schedule-update received:', data);
        reelsCalendarRefreshFromRealtime(data);
    });

    reelsRealtimeSocket.on('connect_error', (error) => {
        console.error('[Reels Socket] Connection error:', error?.message || error);
    });
}

// Initialize socket on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    initReelsRealtimeSocket();
});
