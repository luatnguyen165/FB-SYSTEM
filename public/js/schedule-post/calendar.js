/* ===================================
   SCHEDULE POST CALENDAR - Calendar rendering, drag & drop, popover
   =================================== */

let currentCalendarDate = new Date();
let scheduleCalendarSchedulesCache = [];
let scheduleCalendarOverflowMap = new Map();
let scheduleCalendarDragState = { scheduleId: '', sourceDateKey: '' };
let scheduleCalendarActivePopover = { scheduleId: '', mode: 'detail' };

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

    if (left + popRect.width + padding > viewportWidth) left = anchorRect.left - popRect.width - padding;
    if (left < padding) left = padding;
    if (top + popRect.height + padding > viewportHeight) top = Math.max(padding, viewportHeight - popRect.height - padding);
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
                            <span class="schedule-popover__overflow-item-badge schedule-popover__overflow-item-badge--${itemStatus.className}"></span>
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

function closeSchedulePopoverIfNeeded() {
    const popover = document.getElementById('scheduleQuickPreviewPopover');
    if (!popover) return;
    popover.classList.remove('open');
    popover.setAttribute('aria-hidden', 'true');
}

function clearCalendarDropIndicators() {
    document.querySelectorAll('.day-cell.is-drop-target').forEach(cell => cell.classList.remove('is-drop-target'));
}

function handleCalendarDragStart(event) {
    const item = event.target.closest?.('.schedule-item[data-schedule-id]');
    if (!item || !item.draggable) return;
    const schedule = getScheduleFromRenderedItemElement(item);
    if (!schedule || String(schedule.status || 'pending') !== 'pending') { event.preventDefault(); return; }

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
    if (!updatedIso) { showToast('Không thể xác định thời gian mới', 'error'); return; }
    if (formatIsoDateKey(schedule.scheduledAt) === dateKey) return;

    await updateScheduleDateById(scheduleId, updatedIso);
}

async function updateScheduleDateById(scheduleId, scheduledAtIso) {
    if (!scheduleId || !scheduledAtIso) return;
    try {
        const detailRes = await fetch(`/schedule/api/${encodeURIComponent(scheduleId)}`);
        const detailData = await detailRes.json();
        if (!detailData.success || !detailData.schedule) { showToast('Không tải được lịch để dời ngày', 'error'); return; }

        const schedule = detailData.schedule;
        if (String(schedule.status || 'pending') !== 'pending') { showToast('Chỉ có thể kéo-thả lịch chưa đăng', 'warning'); return; }

        const updateFormData = getScheduleUpdateFormData(schedule, scheduledAtIso);
        const res = await fetch('/schedule/api/update', { method: 'PUT', body: updateFormData });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Không thể cập nhật lịch', 'error'); return; }

        showToast('Đã dời lịch thành công', 'success');
        await renderCalendar();
    } catch (error) {
        console.error('Update schedule date failed:', error);
        showToast('Lỗi khi dời lịch', 'error');
    }
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
    const firstDay = (start.getDay() + 6) % 7;
    const lastDay = end.getDate();
    const days = [];
    let prevMonthDate = new Date(date.getFullYear(), date.getMonth(), 0).getDate();

    for (let i = firstDay; i > 0; i--) days.push({ day: prevMonthDate - i + 1, otherMonth: true, monthShift: -1 });
    for (let day = 1; day <= lastDay; day++) days.push({ day, otherMonth: false, monthShift: 0 });
    const remaining = 42 - days.length;
    for (let day = 1; day <= remaining; day++) days.push({ day, otherMonth: true, monthShift: 1 });

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
            const truncatedTitle = escapeHtml(title).length > 40 ? escapeHtml(title).substring(0, 40) + '…' : escapeHtml(title);

            return `
                <div class="schedule-item ${platformMeta.className} schedule-item--${String(item.status || 'pending')} ${String(item.type || 'post') === 'reels' ? 'schedule-item--reels' : 'schedule-item--post'}"
                    draggable="${canDrag ? 'true' : 'false'}"
                    data-schedule-id="${escapeHtml(item._id)}"
                    data-status="${escapeHtml(String(item.status || 'pending'))}"
                    data-date-key="${escapeHtml(dateKey)}"
                    title="${escapeHtml(time)} • ${truncatedTitle}">
                    <div class="schedule-item__main">
                        <i class="${platformMeta.icon}"></i>
                        <span class="schedule-item__text" title="${escapeHtml(title)}">${escapeHtml(time)} • ${truncatedTitle}</span>
                    </div>
                    <span class="schedule-item__status-label ${statusMeta.className}">${statusMeta.label}</span>
                </div>`;
        }).join('');

        const moreHtml = remainingCount > 0
            ? `<button type="button" class="schedule-item schedule-item--more" data-date-key="${escapeHtml(dateKey)}" title="Còn ${remainingCount} lịch nữa trong ngày này">
                    <div class="schedule-item__main">
                        <i class="fa-solid fa-ellipsis"></i>
                        <span class="schedule-item__text">+${remainingCount} lịch khác</span>
                    </div>
                    <span class="schedule-item__status-dot status-pending"></span>
               </button>`
            : '';

        const cellContent = otherMonth ? '' : `<div class="day-number">${day}</div>${itemHtml}${moreHtml}`;
        return `
            <div class="day-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''} ${isPast ? 'past-disabled' : ''}" data-date="${otherMonth ? '' : dateKey}" data-day="${otherMonth ? '' : day}">
                ${cellContent}
            </div>`;
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
        if (!schedules.length) { resetScheduleForm(); setScheduleTimeInputValue(`${dateString}T09:00`); return; }

        fillScheduleForm(schedules[0]);
        if (timeInput && schedules[0]?.scheduledAt) timeInput.title = `Đã chọn: ${formatReadableDateTime(schedules[0].scheduledAt)}`;
    } catch (err) {
        console.error('Load schedule by date failed:', err);
        openCreatePostModal(null);
    }
}

async function openScheduleById(scheduleId) {
    try {
        const res = await fetch(`/schedule/api/${encodeURIComponent(scheduleId)}`);
        const data = await res.json();
        if (!data.success || !data.schedule) { resetScheduleForm(); return; }
        const isFailedToday = data.schedule.status === 'failed' && (() => {
            const now = new Date();
            const schedDate = new Date(data.schedule.scheduledAt);
            return schedDate.getFullYear() === now.getFullYear() &&
                   schedDate.getMonth() === now.getMonth() &&
                   schedDate.getDate() === now.getDate();
        })();
        if (String(data.schedule.status || 'pending') !== 'pending' && !isFailedToday) {
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