/* ===================================
   SCHEDULE MANAGER REALTIME - Socket.IO realtime updates
   =================================== */

function initSocketRealtime() {
    const userId = window.__CURRENT_USER_ID || null;
    if (!userId) {
        console.warn('[Socket.IO] No userId found, cannot join user room');
        return;
    }

    if (typeof io !== 'undefined') {
        const socket = io(window.location.origin, {
            transports: ['websocket', 'polling']
        });

        socket.on('connect', () => {
            console.log('[Socket.IO] Connected to realtime server');
            socket.emit('join-user', userId);
        });

        socket.on('schedule-update', (data) => {
            console.log('[Socket.IO] schedule-update received:', data);
            if (!data || !data._id) return;
            updateRowFromScheduleData(data);
            updateStatsFromStatusChange(data.status || '');
            if (data.status === 'posted') showToast('Bài viết đã được đăng thành công!', 'success');
            else if (data.status === 'failed') showToast('Bài viết đăng thất bại!', 'error');
        });

        socket.on('disconnect', () => {
            console.log('[Socket.IO] Disconnected from realtime server');
        });
    }
}

function updateStatsFromStatusChange(status) {
    const statPending = document.querySelector('.stat-card-mini.stat-pending strong');
    const statPosted = document.querySelector('.stat-card-mini.stat-posted strong');
    const statFailed = document.querySelector('.stat-card-mini.stat-failed strong');

    if (status === 'posted') {
        if (statPending) statPending.textContent = Math.max(0, parseInt(statPending.textContent || '0') - 1);
        if (statPosted) statPosted.textContent = parseInt(statPosted.textContent || '0') + 1;
    } else if (status === 'failed') {
        if (statPending) statPending.textContent = Math.max(0, parseInt(statPending.textContent || '0') - 1);
        if (statFailed) statFailed.textContent = parseInt(statFailed.textContent || '0') + 1;
    }
}

function updateRowFromScheduleData(schedule = {}) {
    if (!schedule._id) return;
    const row = document.querySelector(`.schedule-row[data-id="${schedule._id}"]`);
    if (!row) return;

    const payload = getPayloadFromRow(row) || {};
    const nextStatus = String(schedule.status || payload.status || 'pending');
    const nextPublishedUrl = String(schedule.publishedUrl || payload.publishedUrl || '');

    row.dataset.status = nextStatus;
    row.className = row.className.replace(/schedule-row--\w+/g, '').trim();
    row.classList.add(`schedule-row--${nextStatus}`);

    const runBtn = row.querySelector('.btn-run-schedule');
    if (runBtn) runBtn.className = `btn-row-action btn-run-schedule btn-run-schedule--${nextStatus}`;

    const pill = row.querySelector('.status-pill');
    if (pill) {
        pill.className = `status-pill ${nextStatus === 'posted' ? 'status-posted' : nextStatus === 'failed' ? 'status-failed' : 'status-pending'}`;
        pill.textContent = nextStatus === 'posted' ? 'Đã đăng' : nextStatus === 'failed' ? 'Thất bại' : 'Chưa đăng';
    }

    payload.status = nextStatus;
    payload.statusLabel = pill?.textContent || payload.statusLabel || '';
    payload.publishedUrl = nextPublishedUrl;
    row.dataset.row = encodeURIComponent(JSON.stringify(payload));
}

async function refreshManagerRowsFromServer() {
    try {
        const res = await fetch('/schedule/api/list');
        if (!res.ok) throw new Error('fetch failed ' + res.status);
        const data = await res.json();
        if (!data.success || !Array.isArray(data.schedules)) {
            showToast('Không tải được danh sách lịch trình', 'error');
            return;
        }

        const latestById = new Map(data.schedules.map((item) => [String(item._id), item]));
        let changed = false;

        rows.forEach((row) => {
            const current = latestById.get(String(row.dataset.id || ''));
            if (!current) return;

            const payload = getPayloadFromRow(row) || {};
            const nextStatus = String(current.status || payload.status || 'pending');
            const nextPublishedUrl = String(current.publishedUrl || '');

            if (row.dataset.status !== nextStatus) {
                row.dataset.status = nextStatus;
                row.className = row.className.replace(/schedule-row--\w+/g, '').trim();
                row.classList.add(`schedule-row--${nextStatus}`);
                const pill = row.querySelector('.status-pill');
                if (pill) {
                    pill.className = `status-pill ${nextStatus === 'posted' ? 'status-posted' : nextStatus === 'failed' ? 'status-failed' : 'status-pending'}`;
                    pill.textContent = nextStatus === 'posted' ? 'Đã đăng' : nextStatus === 'failed' ? 'Thất bại' : 'Chưa đăng';
                }
                const runBtn = row.querySelector('.btn-run-schedule');
                if (runBtn) runBtn.className = `btn-row-action btn-run-schedule btn-run-schedule--${nextStatus}`;
                changed = true;
            }

            if ((payload.publishedUrl || '') !== nextPublishedUrl) {
                payload.publishedUrl = nextPublishedUrl;
                row.dataset.row = encodeURIComponent(JSON.stringify(payload));
                changed = true;
            }
        });

        if (changed) { applyFilters(); showToast('Đã cập nhật trạng thái lịch trình', 'success'); }
    } catch (error) {
        console.error('Refresh schedule manager rows failed:', error);
    }
}

async function runScheduleById(scheduleId, button) {
    if (!scheduleId) return;
    const originalHtml = button?.innerHTML || '';
    if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; }

    try {
        const res = await fetch(`/schedule/api/run-schedule/${encodeURIComponent(scheduleId)}`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Chạy lịch thất bại', 'error'); return; }
        updateRowFromScheduleData(data.data?.schedule || {});
        showToast(data.message || 'Đã chạy lịch thành công', 'success');
        await refreshManagerRowsFromServer();
    } catch (error) {
        console.error('Run schedule now failed:', error);
        showToast('Lỗi kết nối server', 'error');
    } finally {
        if (button) { button.disabled = false; button.innerHTML = originalHtml || '<i class="fa-solid fa-circle-play"></i>'; }
    }
}