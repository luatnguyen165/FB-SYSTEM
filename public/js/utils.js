/* ===================================
   UTILS.JS - Shared Utilities
   Reusable across all pages
   =================================== */

/* ----- Utility Functions ----- */

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function toDatetimeLocalValue(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDateForInput(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatReadableDateTime(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('vi-VN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(d);
}

function formatShortDateTime(dateValue) {
    if (!dateValue) return '—';
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(d);
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

/* ----- Debounce ----- */

function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/* ----- Channel Platform & Status Meta ----- */

const CHANNEL_META = {
    FB: { label: 'Facebook', icon: 'fa-brands fa-facebook', className: 'item-fb', color: '#1877f2' },
    IG: { label: 'Instagram', icon: 'fa-brands fa-instagram', className: 'item-ig', color: '#e1306c' },
    YT: { label: 'YouTube', icon: 'fa-brands fa-youtube', className: 'item-yt', color: '#ff0000' },
    TT: { label: 'TikTok', icon: 'fa-brands fa-tiktok', className: 'item-tt', color: '#000000' }
};

const STATUS_META = {
    posted:   { label: 'Đã đăng',   className: 'status-posted',   icon: 'fa-circle-check' },
    failed:   { label: 'Thất bại',   className: 'status-failed',   icon: 'fa-triangle-exclamation' },
    pending:  { label: 'Chưa đăng',  className: 'status-pending',  icon: 'fa-clock' },
    cancelled:{ label: 'Đã hủy',     className: 'status-cancelled',icon: 'fa-ban' }
};

function getPlatformMeta(platformCode) {
    const code = String(platformCode || 'FB');
    return CHANNEL_META[code] || { label: code, icon: 'fa-solid fa-bullhorn', className: 'item-fb', color: '#1877f2' };
}

function getStatusMeta(status) {
    const s = String(status || 'pending');
    return STATUS_META[s] || STATUS_META.pending;
}

/* ----- Schedule-specific helpers ----- */

function getSchedulePrimaryPlatform(schedule) {
    const platforms = Array.isArray(schedule?.platforms) ? schedule.platforms.filter(Boolean) : [];
    if (platforms.includes('FB')) return 'FB';
    if (platforms.includes('IG')) return 'IG';
    if (platforms.includes('YT')) return 'YT';
    if (platforms.includes('TT')) return 'TT';
    return platforms[0] || (String(schedule?.type || '') === 'reels' ? 'YT' : 'FB');
}

function getSchedulePlatformMeta(platformCode) {
    return getPlatformMeta(platformCode);
}

function getScheduleStatusMetaClient(status) {
    const s = String(status || 'pending');
    return STATUS_META[s] || STATUS_META.pending;
}

/* ----- Loading & Empty States ----- */

function showLoading(el, text) {
    if (!el) return;
    el.innerHTML = `
        <div class="empty-state" style="padding:40px 20px">
            <i class="fa-solid fa-spinner fa-spin" style="font-size:1.8rem;color:var(--text-muted)"></i>
            <span style="font-size:0.85rem;color:var(--text-muted)">${text || 'Đang tải...'}</span>
        </div>`;
}

function showEmpty(el, iconClass, message, actionEl) {
    if (!el) return;
    let html = `
        <div class="empty-state" style="padding:40px 20px">
            <i class="${iconClass || 'fa-solid fa-inbox'}" style="font-size:2rem;color:var(--border-dark)"></i>
            <span style="font-size:0.85rem;color:var(--text-muted)">${message || 'Không có dữ liệu'}</span>`;
    if (actionEl) html += actionEl;
    html += '</div>';
    el.innerHTML = html;
}

/* ----- Confirm Dialog (replaces native confirm) ----- */

let _pendingConfirmCallback = null;

function showConfirm(message, onConfirm, onCancel) {
    let overlay = document.getElementById('confirmOverlay');
    if (!overlay) {
        const html = `
            <div id="confirmOverlay" style="display:none;position:fixed;inset:0;background:rgba(15,23,42,0.5);backdrop-filter:blur(4px);z-index:3000;align-items:center;justify-content:center;padding:20px">
                <div style="background:var(--bg-card);border-radius:var(--radius-xl);max-width:400px;width:100%;padding:24px;text-align:center;box-shadow:var(--shadow-2xl);animation:modalIn 0.2s ease">
                    <div style="width:56px;height:56px;border-radius:50%;background:var(--warning-light);color:var(--warning);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:1.8rem">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <p id="confirmMessage" style="font-size:0.95rem;color:var(--text-main);margin:0 0 20px;line-height:1.5"></p>
                    <div style="display:flex;gap:10px;justify-content:center">
                        <button id="confirmCancelBtn" style="padding:10px 20px;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-hover);color:var(--text-muted);font-weight:600;cursor:pointer;font-size:0.85rem">Hủy bỏ</button>
                        <button id="confirmOkBtn" style="padding:10px 20px;border:none;border-radius:var(--radius-sm);background:var(--primary-gradient);color:white;font-weight:600;cursor:pointer;font-size:0.85rem;box-shadow:0 4px 12px rgba(37,99,235,0.3)">Xác nhận</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        overlay = document.getElementById('confirmOverlay');
        document.getElementById('confirmCancelBtn').addEventListener('click', () => {
            overlay.style.display = 'none';
            if (_pendingConfirmCallback?.onCancel) _pendingConfirmCallback.onCancel();
            _pendingConfirmCallback = null;
        });
        document.getElementById('confirmOkBtn').addEventListener('click', () => {
            overlay.style.display = 'none';
            if (_pendingConfirmCallback?.onConfirm) _pendingConfirmCallback.onConfirm();
            _pendingConfirmCallback = null;
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
                if (_pendingConfirmCallback?.onCancel) _pendingConfirmCallback.onCancel();
                _pendingConfirmCallback = null;
            }
        });
    }
    document.getElementById('confirmMessage').textContent = message;
    _pendingConfirmCallback = { onConfirm, onCancel };
    overlay.style.display = 'flex';
}
