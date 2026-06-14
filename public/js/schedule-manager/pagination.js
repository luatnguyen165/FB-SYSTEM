/* ===================================
   SCHEDULE MANAGER PAGINATION - Filter, paginate, render rows
   =================================== */

function applyFilters() {
    const keyword = String(searchInput?.value || '').trim().toLowerCase();
    const selectedPlatform = platformFilter?.value || 'all';
    const selectedStatus = statusFilter?.value || 'all';

    filteredRows = rows.filter((row) => {
        const rowText = String(row.dataset.searchText || '').toLowerCase();
        const rowPlatforms = String(row.dataset.platform || '').split(',').filter(Boolean);
        const rowStatus = String(row.dataset.status || '');
        const matchesKeyword = !keyword || rowText.includes(keyword);
        const matchesPlatform = selectedPlatform === 'all' || rowPlatforms.includes(selectedPlatform);
        const matchesStatus = selectedStatus === 'all' || rowStatus === selectedStatus;
        return matchesKeyword && matchesPlatform && matchesStatus;
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

    rows.forEach((row) => { row.style.display = 'none'; });
    filteredRows.slice(startIndex, endIndex).forEach((row) => { row.style.display = ''; });
    updatePaginationInfo();
}

function updatePaginationInfo() {
    if (!paginationEl) return;
    const startIndex = filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
    const endIndex = Math.min(currentPage * PAGE_SIZE, filteredRows.length);
    const infoEl = paginationEl.querySelector('[data-pagination-info]');
    if (infoEl) {
        infoEl.textContent = filteredRows.length === 0
            ? 'Không có lịch trình nào phù hợp'
            : `Hiển thị ${startIndex}-${endIndex} / ${filteredRows.length} lịch trình`;
    }
}

function renderPagination() {
    if (!paginationEl) return;
    const totalPages = getTotalPages();
    currentPage = Math.min(currentPage, totalPages);

    const maxButtons = 5;
    const half = Math.floor(maxButtons / 2);
    let start = Math.max(1, currentPage - half);
    let end = Math.min(totalPages, start + maxButtons - 1);
    start = Math.max(1, end - maxButtons + 1);

    const buttons = [];
    buttons.push(`<button type="button" class="schedule-pagination__btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`);
    for (let page = start; page <= end; page += 1) {
        buttons.push(`<button type="button" class="schedule-pagination__btn ${page === currentPage ? 'is-active' : ''}" data-page="${page}">${page}</button>`);
    }
    buttons.push(`<button type="button" class="schedule-pagination__btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`);

    paginationEl.innerHTML = `
        <div class="schedule-pagination__info" data-pagination-info></div>
        <div class="schedule-pagination__controls">${buttons.join('')}</div>`;

    paginationEl.querySelectorAll('.schedule-pagination__btn').forEach((button) => {
        button.addEventListener('click', () => {
            const target = button.dataset.page;
            const total = getTotalPages();
            if (target === 'prev') currentPage = Math.max(1, currentPage - 1);
            else if (target === 'next') currentPage = Math.min(total, currentPage + 1);
            else currentPage = Number(target) || 1;
            renderPagination();
            renderVisibleRows();
        });
    });
}