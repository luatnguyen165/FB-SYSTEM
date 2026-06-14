/* ===================================
   SCHEDULE POST REALTIME - Socket.IO realtime updates
   =================================== */

let schedulePostRealtimeSocket = null;
let schedulePostRealtimeRefreshTimer = null;

function schedulePostCalendarRefreshFromRealtime(data = {}) {
    if (schedulePostRealtimeRefreshTimer) clearTimeout(schedulePostRealtimeRefreshTimer);

    schedulePostRealtimeRefreshTimer = setTimeout(async () => {
        try {
            await renderCalendar();
            const status = String(data.status || '').trim();
            if (status === 'posted') showToast('Lịch Post ảnh đã đăng thành công và được cập nhật.', 'success');
            else if (status === 'failed') showToast('Lịch Post ảnh đăng thất bại. Vui lòng kiểm tra lại.', 'error');
        } catch (error) {
            console.error('[Schedule Post Socket] Refresh calendar failed:', error);
        }
    }, 250);
}

function initSchedulePostRealtimeSocket() {
    const userId = window.__CURRENT_USER_ID || null;
    if (!userId || typeof io === 'undefined' || schedulePostRealtimeSocket) return;

    schedulePostRealtimeSocket = io(window.location.origin, { transports: ['websocket', 'polling'] });

    schedulePostRealtimeSocket.on('connect', () => {
        schedulePostRealtimeSocket.emit('join-user', userId);
        console.log('[Schedule Post Socket] Connected:', schedulePostRealtimeSocket.id);
    });

    schedulePostRealtimeSocket.on('schedule-update', (data) => {
        if (!data || !data._id) return;
        const currentType = getCalendarType();
        if (data.type && String(data.type) !== currentType) return;
        console.log('[Schedule Post Socket] schedule-update received:', data);
        schedulePostCalendarRefreshFromRealtime(data);
    });

    schedulePostRealtimeSocket.on('connect_error', (error) => {
        console.error('[Schedule Post Socket] Connection error:', error?.message || error);
    });
}