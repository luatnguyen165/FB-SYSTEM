/* ===================================
   SCHEDULE ARCHIVE — Main JS
   - Filter + pagination (delegated to pagination.js)
   - Modal xem nhanh + Export
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('archiveSearchInput');
    const platformFilter = document.getElementById('archivePlatformFilter');
    const typeFilter = document.getElementById('archiveTypeFilter');
    const dayFilter = document.getElementById('archiveDayFilter');
    const monthFilter = document.getElementById('archiveMonthFilter');
    const btnClear = document.getElementById('btnClearCalendarFilters');
    const viewButtons = Array.from(document.querySelectorAll('.btn-archive-view'));
    const modal = document.getElementById('archiveDetailModal');
    const modalFields = {
        type: document.getElementById('modalType'),
        status: document.getElementById('modalStatus'),
        publishedAt: document.getElementById('modalPublishedAt'),
        platforms: document.getElementById('modalPlatforms'),
        accounts: document.getElementById('modalAccounts'),
        group: document.getElementById('modalGroup'),
        video: document.getElementById('modalVideo'),
        caption: document.getElementById('modalCaption')
    };

    const exportExcelBtn = document.getElementById('btnExportExcel');
    const exportPdfBtn = document.getElementById('btnExportPdf');

    function getCurrentFilterParams() {
        const params = new URLSearchParams();
        const q = String(searchInput?.value || '').trim();
        const type = String(typeFilter?.value || 'all');
        const platform = String(platformFilter?.value || 'all');
        const day = String(dayFilter?.value || '');
        const month = String(monthFilter?.value || '');

        if (q) params.set('q', q);
        if (type && type !== 'all') params.set('type', type);
        if (platform && platform !== 'all') params.set('platform', platform);
        if (day) params.set('day', day);
        if (month) params.set('month', month);

        return params.toString();
    }

    function openModalFromRow(row) {
        if (!modal || !row) return;

        let payload = null;
        try {
            payload = JSON.parse(decodeURIComponent(row.dataset.row || '{}'));
        } catch (error) {
            payload = null;
        }

        if (!payload) return;

        if (modalFields.type) modalFields.type.textContent = payload.typeLabel || '—';
        if (modalFields.status) modalFields.status.textContent = payload.statusLabel || '—';
        if (modalFields.publishedAt) modalFields.publishedAt.textContent = payload.publishedAtLabel || '—';
        if (modalFields.platforms) modalFields.platforms.textContent = payload.platformLabel || '—';
        if (modalFields.accounts) modalFields.accounts.textContent = payload.accountsLabel || '—';
        if (modalFields.group) modalFields.group.textContent = payload.targetGroupName || payload.sourceChannelName || '—';
        if (modalFields.video) modalFields.video.textContent = payload.videoTitle || '—';
        if (modalFields.caption) modalFields.caption.textContent = payload.caption || '—';

        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
        if (!modal) return;
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    }

    // Export buttons
    exportExcelBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        const query = getCurrentFilterParams();
        window.location.href = `/schedule/archive/export?format=xls${query ? `&${query}` : ''}`;
    });

    exportPdfBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        const query = getCurrentFilterParams();
        window.location.href = `/schedule/archive/export?format=pdf${query ? `&${query}` : ''}`;
    });

    // Modal close handlers
    modal?.querySelectorAll('[data-archive-modal-close]').forEach((el) => {
        el.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
    });

    // View detail buttons (delegated)
    document.addEventListener('click', (event) => {
        const viewBtn = event.target.closest('.btn-archive-view');
        if (viewBtn) {
            const row = viewBtn.closest('.archive-row');
            if (row) openModalFromRow(row);
        }
    });

    // Export links default
    if (exportExcelBtn) exportExcelBtn.href = `/schedule/archive/export?format=xls`;
    if (exportPdfBtn) exportPdfBtn.href = `/schedule/archive/export?format=pdf`;
});
