/* ===================================
   SCHEDULE ARCHIVE PAGINATION - Filter, paginate, render rows
   Đồng bộ style với schedule-manager (dùng class .schedule-pagination)
   =================================== */

(function () {
    'use strict';

    const PAGE_SIZE = 20;

    function init() {
        console.log('[Archive Pagination] init() called');
        const paginationEl = document.getElementById('archivePagination');
        const searchInput = document.getElementById('archiveSearchInput');
        const typeFilter = document.getElementById('archiveTypeFilter');
        const platformFilter = document.getElementById('archivePlatformFilter');
        const dayFilter = document.getElementById('archiveDayFilter');
        const monthFilter = document.getElementById('archiveMonthFilter');
        const btnClear = document.getElementById('btnClearCalendarFilters');
        const tableBody = document.querySelector('#archiveTable tbody');

        if (!tableBody || !paginationEl) {
            console.warn('[Archive Pagination] Thiếu tableBody hoặc paginationEl — skip');
            return;
        }

        const rows = Array.from(tableBody.querySelectorAll('tr.archive-row'));
        console.log('[Archive Pagination] Found rows:', rows.length);

        if (rows.length === 0) {
            console.warn('[Archive Pagination] KHÔNG CÓ ROWS — check HTML render');
            return;
        }

        // Sample row dataset để debug
        const sample = rows[0];
        console.log('[Archive Pagination] Sample row dataset:', {
            searchText: sample.dataset.searchText?.substring(0, 50),
            platform: sample.dataset.platform,
            type: sample.dataset.type,
            day: sample.dataset.day,
            month: sample.dataset.month
        });

        let filteredRows = rows.slice();
        let currentPage = 1;

        function applyFilters() {
            const keyword = String(searchInput?.value || '').trim().toLowerCase();
            const selectedType = typeFilter?.value || 'all';
            const selectedPlatform = platformFilter?.value || 'all';
            const selectedDay = dayFilter?.value || '';
            const selectedMonth = monthFilter?.value || '';

            filteredRows = rows.filter((row) => {
                const rowText = String(row.dataset.searchText || '').toLowerCase();
                const rowPlatforms = String(row.dataset.platform || '').split(',').filter(Boolean);
                const rowType = String(row.dataset.type || '');
                const rowDay = String(row.dataset.day || '');
                const rowMonth = String(row.dataset.month || '');

                const matchesKeyword = !keyword || rowText.includes(keyword);
                const matchesType = selectedType === 'all' || rowType === selectedType;
                const matchesPlatform = selectedPlatform === 'all' || rowPlatforms.includes(selectedPlatform);
                const matchesDay = !selectedDay || rowDay === selectedDay;
                const matchesMonth = !selectedMonth || rowMonth === selectedMonth;

                return matchesKeyword && matchesType && matchesPlatform && matchesDay && matchesMonth;
            });

            currentPage = 1;
            renderPagination();
            renderVisibleRows();
        }

        function getTotalPages() {
            return Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
        }

        function renderVisibleRows() {
            const startIndex = (currentPage - 1) * PAGE_SIZE;
            const endIndex = startIndex + PAGE_SIZE;

            // Ẩn tất cả rows + empty row
            rows.forEach((row) => { row.style.display = 'none'; });
            const existingEmpty = tableBody.querySelector('tr.archive-empty');
            if (existingEmpty) existingEmpty.style.display = 'none';

            // Hiện rows thuộc trang hiện tại
            const visibleRows = filteredRows.slice(startIndex, endIndex);
            visibleRows.forEach((row) => { row.style.display = ''; });

            // Empty state
            if (filteredRows.length === 0) {
                if (!existingEmpty) {
                    const emptyRow = document.createElement('tr');
                    emptyRow.className = 'archive-empty';
                    emptyRow.innerHTML = `<td colspan="8"><div class="empty-state-table"><i class="fa-regular fa-folder-open"></i><h3>Không có nội dung phù hợp</h3><p>Thử điều chỉnh bộ lọc hoặc từ khóa tìm kiếm.</p></div></td>`;
                    tableBody.appendChild(emptyRow);
                } else {
                    existingEmpty.style.display = '';
                }
            }

            updatePaginationInfo();
        }

        function updatePaginationInfo() {
            const startIndex = filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
            const endIndex = Math.min(currentPage * PAGE_SIZE, filteredRows.length);
            const infoEl = paginationEl.querySelector('[data-pagination-info]');
            if (infoEl) {
                infoEl.textContent = filteredRows.length === 0
                    ? 'Không có lịch sử phù hợp'
                    : `Hiển thị ${startIndex}-${endIndex} / ${filteredRows.length} bài đã đăng`;
            }
        }

        function renderPagination() {
            const totalPages = getTotalPages();
            currentPage = Math.min(Math.max(currentPage, 1), totalPages);
            paginationEl.style.display = filteredRows.length === 0 ? 'none' : '';

            const maxButtons = 5;
            const half = Math.floor(maxButtons / 2);
            let start = Math.max(1, currentPage - half);
            let end = Math.min(totalPages, start + maxButtons - 1);
            start = Math.max(1, end - maxButtons + 1);

            const buttons = [];
            buttons.push(`<button type="button" class="schedule-pagination__btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''} aria-label="Trang trước"><i class="fa-solid fa-chevron-left"></i></button>`);
            for (let page = start; page <= end; page += 1) {
                buttons.push(`<button type="button" class="schedule-pagination__btn ${page === currentPage ? 'is-active' : ''}" data-page="${page}" aria-label="Trang ${page}">${page}</button>`);
            }
            buttons.push(`<button type="button" class="schedule-pagination__btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''} aria-label="Trang sau"><i class="fa-solid fa-chevron-right"></i></button>`);

            paginationEl.innerHTML = `
                <div class="schedule-pagination__info" data-pagination-info></div>
                <div class="schedule-pagination__controls">${buttons.join('')}</div>`;

            paginationEl.querySelectorAll('.schedule-pagination__btn').forEach((button) => {
                button.addEventListener('click', () => {
                    const target = button.dataset.page;
                    const total = getTotalPages();
                    if (target === 'prev') currentPage = Math.max(1, currentPage - 1);
                    else if (target === 'next') currentPage = Math.min(total, currentPage + 1);
                    else currentPage = parseInt(target, 10) || 1;
                    renderPagination();
                    renderVisibleRows();
                });
            });
        }

        // Bind filter events (dùng ?. để không crash nếu element thiếu)
        if (searchInput) searchInput.addEventListener('input', applyFilters);
        if (typeFilter) typeFilter.addEventListener('change', applyFilters);
        if (platformFilter) platformFilter.addEventListener('change', applyFilters);
        if (dayFilter) dayFilter.addEventListener('change', applyFilters);
        if (monthFilter) monthFilter.addEventListener('change', applyFilters);
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                if (searchInput) searchInput.value = '';
                if (typeFilter) typeFilter.value = 'all';
                if (platformFilter) platformFilter.value = 'all';
                if (dayFilter) dayFilter.value = '';
                if (monthFilter) monthFilter.value = '';
                applyFilters();
            });
        }

        // Initial render
        renderPagination();
        renderVisibleRows();
    }

    // Đợi DOM ready (EJS include có thể load sau script nếu bundle)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
