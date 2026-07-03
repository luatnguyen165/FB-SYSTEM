// public/js/notification-bell.js
// Icon chuông thông báo trên header — nhận realtime từ Socket.IO
// Lưu localStorage để giữ qua các trang (chuyển trang không mất notif)

(function() {
    const STORAGE_KEY = 'fb_crawler_notifs';
    const MAX_NOTIFS = 20;

    function loadNotifs() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch (e) { return []; }
    }
    function saveNotifs(arr) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, MAX_NOTIFS))); }
        catch (e) { /* quota exceeded - ignore */ }
    }
    function getUnreadCount() {
        return loadNotifs().filter(n => !n.read).length;
    }

    function addNotif({ id, type = 'info', title, message, postUrl, time }) {
        const notifs = loadNotifs();
        // Nếu có id giống → không add trùng
        if (id && notifs.some(n => n.id === id)) return;
        notifs.unshift({ id: id || ('n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)), type, title, message, postUrl, time: time || Date.now(), read: false });
        saveNotifs(notifs);
        renderNotifs();
        shakeBell();
    }

    function markAllRead() {
        const notifs = loadNotifs();
        notifs.forEach(n => n.read = true);
        saveNotifs(notifs);
        renderNotifs();
    }

    function formatTime(ts) {
        const d = new Date(ts);
        const now = new Date();
        const diff = (now - d) / 1000;
        if (diff < 60) return 'Vừa xong';
        if (diff < 3600) return Math.floor(diff / 60) + ' phút trước';
        if (diff < 86400) return Math.floor(diff / 3600) + ' giờ trước';
        return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }

    function renderNotifs() {
        const list = document.getElementById('notifList');
        const empty = document.getElementById('notifEmpty');
        const badge = document.getElementById('notifBadge');
        const subtitle = document.getElementById('notifHeaderSubtitle');
        if (!list || !badge) return;

        const notifs = loadNotifs();
        const unread = notifs.filter(n => !n.read).length;

        // Badge
        if (unread > 0) {
            badge.style.display = 'flex';
            badge.textContent = unread > 99 ? '99+' : unread;
        } else {
            badge.style.display = 'none';
        }

        if (subtitle) {
            subtitle.textContent = unread > 0 ? (unread + ' thông báo mới') : 'Cập nhật realtime';
        }

        if (notifs.length === 0) {
            list.innerHTML = '<div class="notif-empty" id="notifEmpty"><i class="fa-regular fa-bell-slash"></i><div>Chưa có thông báo</div></div>';
            return;
        }

        const typeIcons = {
            success: 'fa-check',
            error: 'fa-xmark',
            running: 'fa-spinner',
            warning: 'fa-triangle-exclamation',
            info: 'fa-info'
        };

        list.innerHTML = notifs.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}" data-post-url="${n.postUrl || ''}" data-id="${n.id}">
                <div class="notif-item-icon ${n.type}">
                    <i class="fa-solid ${typeIcons[n.type] || typeIcons.info} ${n.type === 'running' ? 'fa-spin' : ''}"></i>
                </div>
                <div class="notif-item-content">
                    <div class="notif-item-title">${escapeHtml(n.title || '')}</div>
                    <div class="notif-item-text">${escapeHtml(n.message || '')}</div>
                    <div class="notif-item-time">${formatTime(n.time)}</div>
                </div>
                ${!n.read ? '<div class="notif-item-unread-dot"></div>' : ''}
            </div>
        `).join('');

        // Click vào item → đánh dấu đã đọc, mở postUrl nếu có
        list.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.dataset.id;
                const notifs2 = loadNotifs();
                const n = notifs2.find(x => x.id === id);
                if (n && !n.read) { n.read = true; saveNotifs(notifs2); renderNotifs(); }
                const postUrl = el.dataset.postUrl;
                if (postUrl) window.location.href = '/tracking/comments';
                else document.getElementById('notifDropdown').style.display = 'none';
            });
        });
    }

    function shakeBell() {
        const btn = document.getElementById('notifBellBtn');
        if (!btn) return;
        btn.classList.remove('has-new');
        void btn.offsetWidth; // force reflow
        btn.classList.add('has-new');
        setTimeout(() => btn.classList.remove('has-new'), 700);
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }

    // ===== UI events =====
    const bellBtn = document.getElementById('notifBellBtn');
    const dropdown = document.getElementById('notifDropdown');
    const markAllBtn = document.getElementById('notifMarkAllRead');

    if (bellBtn) {
        bellBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            dropdown.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) renderNotifs();
        });
    }
    if (markAllBtn) {
        markAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            markAllRead();
        });
    }
    // Click ra ngoài → đóng
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#notifBellWrapper')) {
            if (dropdown) dropdown.style.display = 'none';
        }
    });

    // Render lần đầu
    renderNotifs();

    // ===== Socket.IO realtime =====
    if (window.io) {
        const socket = io();

        // Lắng nghe notif:new từ emitNotif() backend - thông báo terminal state
        socket.on('notif:new', (data) => {
            if (!data) return;
            addNotif({
                id: data.id,
                type: data.type,
                title: data.title,
                message: data.message,
                postUrl: data.postUrl,
                time: data.time || Date.now()
            });
            // Hiển thị toast cho người dùng
            if (typeof window.showToast === 'function') {
                const toastType = data.type === 'success' ? 'success' : data.type === 'error' ? 'error' : 'info';
                window.showToast(data.title + ': ' + data.message, toastType);
            }
        });

        socket.on('comment-crawler:progress', (data) => {
            if (!data) return;
            const id = 'job_' + (data.jobId || '');
            const postUrl = data.postUrl || '';

            // CHỈ thông báo terminal state (success/failed) - KHÔNG thông báo running
            if (data.phase === 'success') {
                addNotif({
                    id: id + '_success',
                    type: 'success',
                    title: '✅ Scrape hoàn thành',
                    message: (data.mainComments || 0) + ' main / ' + (data.replies || 0) + ' reply — ' + (postUrl || '').substring(0, 50),
                    postUrl,
                    time: Date.now()
                });
                if (typeof window.showToast === 'function') {
                    window.showToast('Scrape thành công: ' + (data.mainComments || 0) + ' comments', 'success');
                }
            } else if (data.phase === 'failed') {
                addNotif({
                    id: id + '_failed',
                    type: 'error',
                    title: '❌ Scrape thất bại',
                    message: data.error || 'Lỗi không xác định',
                    postUrl,
                    time: Date.now()
                });
                if (typeof window.showToast === 'function') {
                    window.showToast('Scrape thất bại: ' + (data.error || 'Lỗi không xác định'), 'error');
                }
            }
        });
    }
})();
