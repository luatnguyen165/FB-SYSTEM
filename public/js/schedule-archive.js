document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('archiveSearchInput');
    const platformFilter = document.getElementById('archivePlatformFilter');
    const typeFilter = document.getElementById('archiveTypeFilter');
    const dayFilter = document.getElementById('archiveDayFilter');
    const monthFilter = document.getElementById('archiveMonthFilter');
    const rows = Array.from(document.querySelectorAll('.archive-row'));
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

    const PAGE_SIZE = 10;
    let currentPage = 1;
    let filteredRows = [...rows];

    function applyFilters() {
        const keyword = String(searchInput?.value || '').trim().toLowerCase();
        const selectedPlatform = platformFilter?.value || 'all';
        const selectedType = typeFilter?.value || 'all';
        const selectedDay = dayFilter?.value || '';
        const selectedMonth = monthFilter?.value || '';

        filteredRows = rows.filter((row) => {
            const rowText = String(row.dataset.searchText || '').toLowerCase();
            const rowPlatforms = String(row.dataset.platform || '').split(',').filter(Boolean);
            const rowType = String(row.dataset.type || '');
            const rowDay = String(row.dataset.day || '');
            const rowMonth = String(row.dataset.month || '');

            const matchesKeyword = !keyword || rowText.includes(keyword);
            const matchesPlatform = selectedPlatform === 'all' || rowPlatforms.includes(selectedPlatform);
            const matchesType = selectedType === 'all' || rowType === selectedType;
            const matchesDay = !selectedDay || rowDay === selectedDay;
            const matchesMonth = !selectedMonth || rowMonth === selectedMonth;

            return matchesKeyword && matchesPlatform && matchesType && matchesDay && matchesMonth;
        });

        currentPage = 1;
        renderPagination();
    }

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

    function renderPagination() {
        const totalItems = filteredRows.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
        currentPage = Math.min(currentPage, totalPages);

        // Show/hide rows
        rows.forEach((row) => row.style.display = 'none');
        filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).forEach((row) => {
            row.style.display = '';
        });

        // Update pagination UI
        const infoEl = document.getElementById('archivePaginationInfo');
        const controlsEl = document.getElementById('archivePaginationControls');

        if (infoEl) {
            if (totalItems === 0) {
                infoEl.textContent = 'Không có lịch trình nào';
            } else {
                const start = (currentPage - 1) * PAGE_SIZE + 1;
                const end = Math.min(currentPage * PAGE_SIZE, totalItems);
                infoEl.textContent = `Hiển thị ${start}-${end} / ${totalItems} lịch`;
            }
        }

        if (controlsEl) {
            let btns = '';
            btns += `<button class="archive-pagination__btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`;

            const maxBtns = 5;
            const half = Math.floor(maxBtns / 2);
            let startPage = Math.max(1, currentPage - half);
            let endPage = Math.min(totalPages, startPage + maxBtns - 1);
            startPage = Math.max(1, endPage - maxBtns + 1);

            for (let p = startPage; p <= endPage; p++) {
                btns += `<button class="archive-pagination__btn ${p === currentPage ? 'is-active' : ''}" data-page="${p}">${p}</button>`;
            }

            btns += `<button class="archive-pagination__btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`;
            controlsEl.innerHTML = btns;

            controlsEl.querySelectorAll('.archive-pagination__btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const target = btn.dataset.page;
                    if (target === 'prev') { currentPage = Math.max(1, currentPage - 1); }
                    else if (target === 'next') { currentPage = Math.min(totalPages, currentPage + 1); }
                    else { currentPage = parseInt(target); }
                    renderPagination();
                });
            });
        }
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

    searchInput?.addEventListener('input', applyFilters);
    platformFilter?.addEventListener('change', applyFilters);
    typeFilter?.addEventListener('change', applyFilters);
    dayFilter?.addEventListener('change', applyFilters);
    monthFilter?.addEventListener('change', applyFilters);

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

    modal?.querySelectorAll('[data-archive-modal-close]').forEach((el) => {
        el.addEventListener('click', closeModal);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeModal();
    });

    viewButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('.archive-row');
            openModalFromRow(row);
        });
    });

    // cập nhật link export khi tải trang để đảm bảo URL chuẩn
    if (exportExcelBtn) exportExcelBtn.href = `/schedule/archive/export?format=xls`;
    if (exportPdfBtn) exportPdfBtn.href = `/schedule/archive/export?format=pdf`;

    applyFilters();
});