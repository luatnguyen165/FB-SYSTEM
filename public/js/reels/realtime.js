/* ===================================
   REELS REALTIME - Socket.IO realtime updates
   =================================== */

let reelsRealtimeSocket = null;
let reelsRealtimeRefreshTimer = null;

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

        if (data.type && String(data.type) !== 'reels') return;

        console.log('[Reels Socket] schedule-update received:', data);
        reelsCalendarRefreshFromRealtime(data);
    });

    reelsRealtimeSocket.on('connect_error', (error) => {
        console.error('[Reels Socket] Connection error:', error?.message || error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initReelsRealtimeSocket();
});