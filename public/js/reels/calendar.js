/* ===================================
   REELS CALENDAR - Calendar rendering, drag-drop, filters
   =================================== */

let reelsCalendarState = {
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    lastSignature: ''
};
let reelsCalendarSchedulesCache = [];
let reelsCalendarOverflowMap = new Map();
let reelsCalendarDragState = { scheduleId: '', sourceDateKey: '' };
let reelsCalendarActivePopover = { scheduleId: '', mode: 'detail' };

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
        // Cho phép kéo-thả lịch pending + failed (failed sẽ reset pending khi save)
        const status = String(schedule.status || 'pending');
        if (status !== 'pending' && status !== 'failed') {
            showToast?.('Chỉ có thể kéo-thả lịch chưa đăng hoặc thất bại', 'warning');
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
    if (!schedule) { event.preventDefault(); return; }
    const status = String(schedule.status || 'pending');
    // Cho phép kéo-thả lịch pending + failed
    if (status !== 'pending' && status !== 'failed') { event.preventDefault(); return; }

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
    if (!schedule) {
        showToast?.('Chỉ có thể kéo-thả lịch chưa đăng hoặc thất bại', 'warning');
        return;
    }
    const status = String(schedule.status || 'pending');
    // Cho phép kéo-thả lịch pending + failed
    if (status !== 'pending' && status !== 'failed') {
        showToast?.('Chỉ có thể kéo-thả lịch chưa đăng hoặc thất bại', 'warning');
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

let reelsRefreshTimer = null;
let reelsRefreshInFlight = false;

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