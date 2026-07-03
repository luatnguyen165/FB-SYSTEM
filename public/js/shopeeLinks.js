/* ===================================
   SHOPEELINKS.JS - Shopee Link Manager
   Kết nối API backend
   =================================== */

const PLATFORM_META = {
    shopee:  { label: 'Shopee',      icon: 'fa-solid fa-bag-shopping', color: '#ee4d2d' },
    tiktok:  { label: 'TikTok Shop', icon: 'fa-brands fa-tiktok',       color: '#000000' },
    website: { label: 'Website',      icon: 'fa-solid fa-globe',         color: '#2563eb' },
};

document.addEventListener('DOMContentLoaded', () => {
    initPlatformFilterTabs();
    initModalPlatformTabs();

    const btnOpen = document.getElementById('btnOpenProductModal');
    if (btnOpen) btnOpen.addEventListener('click', () => openProductModal(false));

    const btnClose = document.getElementById('btnCloseModal');
    if (btnClose) btnClose.addEventListener('click', closeProductModal);

    const btnCancel = document.getElementById('btnCancelProductModal');
    if (btnCancel) btnCancel.addEventListener('click', closeProductModal);

    const btnCloseDeleteConfirm = document.getElementById('btnCloseDeleteConfirm');
    if (btnCloseDeleteConfirm) btnCloseDeleteConfirm.addEventListener('click', closeDeleteConfirmModal);

    const btnCancelDeleteConfirm = document.getElementById('btnCancelDeleteConfirm');
    if (btnCancelDeleteConfirm) btnCancelDeleteConfirm.addEventListener('click', closeDeleteConfirmModal);

    const btnConfirmDeleteLink = document.getElementById('btnConfirmDeleteLink');
    if (btnConfirmDeleteLink) {
        btnConfirmDeleteLink.addEventListener('click', async () => {
            if (!pendingDeleteShopeeLink?.id) return;
            const { id, rowEl } = pendingDeleteShopeeLink;
            closeDeleteConfirmModal();
            await deleteShopeeLink(id, rowEl, true);
        });
    }

    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    if (deleteConfirmModal) {
        deleteConfirmModal.addEventListener('click', (e) => {
            if (e.target === deleteConfirmModal) closeDeleteConfirmModal();
        });
    }

    const btnPrevShopeePage = document.getElementById('btnPrevShopeePage');
    if (btnPrevShopeePage) btnPrevShopeePage.addEventListener('click', () => changeShopeePage(-1));

    const btnNextShopeePage = document.getElementById('btnNextShopeePage');
    if (btnNextShopeePage) btnNextShopeePage.addEventListener('click', () => changeShopeePage(1));

    const btnSubmit = document.getElementById('btnModalSubmit');
    if (btnSubmit) btnSubmit.addEventListener('click', handleModalSubmit);

    const btnTrigger = document.getElementById('btnTriggerUpload');
    const inputSelector = document.getElementById('modalImageSelector');
    if (btnTrigger && inputSelector) {
        btnTrigger.addEventListener('click', () => inputSelector.click());
        inputSelector.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                previewModalImage(e.target.files[0]);
            }
        });
    }

    const searchInput = document.getElementById('tableSearchInput');
    if (searchInput) searchInput.addEventListener('input', () => loadShopeeLinks());

    const statusFilter = document.getElementById('statusFilterSelector');
    if (statusFilter) statusFilter.addEventListener('change', () => loadShopeeLinks());

    const platformFilter = document.getElementById('platformFilterSelector');
    if (platformFilter) platformFilter.addEventListener('change', () => loadShopeeLinks());


    document.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit');
        const deleteBtn = e.target.closest('.btn-delete');
        if (editBtn) {
            const row = editBtn.closest('.table-row-item');
            if (row) openEditModal(row);
        }
        if (deleteBtn) {
            const row = deleteBtn.closest('.table-row-item');
            if (row) deleteShopeeLink(row.dataset.id, row);
        }
    });

    loadShopeeLinks();
});

function initModalPlatformTabs() {
    const modalGroup = document.getElementById('platformSelectGroup');
    if (!modalGroup) return;
    modalGroup.addEventListener('click', (e) => {
        const tab = e.target.closest('.platform-tab');
        if (!tab) return;
        modalGroup.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Sync hidden radio
        const platform = tab.dataset.platform;
        const radio = modalGroup.querySelector('input[type="radio"]');
        if (radio) radio.value = platform;
    });
}

function initPlatformFilterTabs() {
    const tabsContainer = document.getElementById('platformFilterTabs');
    if (!tabsContainer) return;
    tabsContainer.addEventListener('click', (e) => {
        const tab = e.target.closest('.platform-tab');
        if (!tab) return;
        // Remove active from all tabs
        tabsContainer.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
        // Add active to clicked tab
        tab.classList.add('active');
        // Sync hidden select
        const hiddenSelect = document.getElementById('platformFilterSelector');
        if (hiddenSelect) hiddenSelect.value = tab.dataset.value;
        // Reload data
        loadShopeeLinks();
    });
}

let editingId = null;
let pendingDeleteShopeeLink = null;
const SHOPEE_PAGE_SIZE = 8;
let allShopeeLinksCache = [];
let currentShopeePage = 1;

function openDeleteConfirmModal(id, rowEl) {
    pendingDeleteShopeeLink = {
        id,
        rowEl,
        title: rowEl?.dataset?.title || 'sản phẩm này'
    };

    const titleEl = document.getElementById('deleteConfirmTitle');
    if (titleEl) titleEl.textContent = pendingDeleteShopeeLink.title;

    document.getElementById('deleteConfirmModal')?.classList.add('open');
}

function closeDeleteConfirmModal() {
    document.getElementById('deleteConfirmModal')?.classList.remove('open');
    pendingDeleteShopeeLink = null;
}

function openProductModal(isEdit) {
    editingId = null;
    const modal = document.getElementById('productModal');
    const title = document.getElementById('modalTitle');
    if (title) title.textContent = isEdit ? 'Chỉnh sửa sản phẩm' : 'Thêm sản phẩm điều hướng';
    if (modal) modal.classList.add('open');

    const titleInput = document.getElementById('modalTitleInput');
    const urlInput = document.getElementById('modalUrlInput');
    const previewContainer = document.getElementById('modalImgPreviewContainer');
    if (titleInput) titleInput.value = '';
    if (urlInput) urlInput.value = '';
    if (previewContainer) previewContainer.style.display = 'none';

    // Reset platform - lấy theo filter hiện tại, nếu ALL thì mặc định shopee
    const currentFilter = document.getElementById('platformFilterSelector')?.value || 'ALL';
    const targetPlatform = (currentFilter && currentFilter !== 'ALL') ? currentFilter : 'shopee';
    const modalGroup = document.getElementById('platformSelectGroup');
    if (modalGroup) {
        modalGroup.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
        const activeTab = modalGroup.querySelector(`.platform-tab[data-platform="${targetPlatform}"]`);
        if (activeTab) activeTab.classList.add('active');
        const radio = modalGroup.querySelector('input[type="radio"]');
        if (radio) radio.value = targetPlatform;
    }
}

function openEditModal(row) {
    editingId = row.dataset.id;
    const modal = document.getElementById('productModal');
    const title = document.getElementById('modalTitle');
    const titleInput = document.getElementById('modalTitleInput');
    const urlInput = document.getElementById('modalUrlInput');

    if (title) title.textContent = 'Chỉnh sửa sản phẩm';
    if (titleInput) titleInput.value = row.dataset.title || '';
    if (urlInput) urlInput.value = row.querySelector('.col-url')?.textContent || '';
    if (modal) modal.classList.add('open');

    // Set platform
    const platform = row.dataset.platform || 'shopee';
    const modalGroup = document.getElementById('platformSelectGroup');
    if (modalGroup) {
        modalGroup.querySelectorAll('.platform-tab').forEach(t => t.classList.toggle('active', t.dataset.platform === platform));
        const radio = modalGroup.querySelector('input[type="radio"]');
        if (radio) radio.value = platform;
    }
}

function closeProductModal() {
    const modal = document.getElementById('productModal');
    if (modal) modal.classList.remove('open');
    editingId = null;
}

function previewModalImage(file) {
    const container = document.getElementById('modalImgPreviewContainer');
    const imgTag = document.getElementById('modalImgTag');
    if (container && imgTag) {
        imgTag.src = URL.createObjectURL(file);
        container.style.display = 'block';
    }
}

async function handleModalSubmit() {
    const title = document.getElementById('modalTitleInput')?.value?.trim();
    const shopeeUrl = document.getElementById('modalUrlInput')?.value?.trim();
    const platform = document.getElementById('platformSelectGroup')?.querySelector('.platform-tab.active')?.dataset?.platform || 'shopee';
    const imageFile = document.getElementById('modalImageSelector')?.files[0];

    if (!title || !shopeeUrl) {
        showToast('Vui lòng nhập đủ thông tin!', 'warning');
        return;
    }

    const formData = new FormData();
    formData.append('title', title);
    formData.append('shopeeUrl', shopeeUrl);
    formData.append('platform', platform);
    if (imageFile) formData.append('image', imageFile);

    try {
        let url = '/shopee/api/create';
        let method = 'POST';
        if (editingId) {
            url = `/shopee/api/${editingId}`;
            method = 'PUT';
        }
        const res = await fetch(url, { method, body: formData });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            closeProductModal();
            loadShopeeLinks();
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}

async function deleteShopeeLink(id, rowEl, skipConfirm = false) {
    if (!skipConfirm) {
        openDeleteConfirmModal(id, rowEl);
        return;
    }

    try {
        const res = await fetch(`/shopee/api/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showToast('Đã xóa sản phẩm', 'success');
            loadShopeeLinks(false);
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}

async function loadShopeeLinks(resetPage = true) {
    const search = document.getElementById('tableSearchInput')?.value || '';
    const status = document.getElementById('statusFilterSelector')?.value || 'ALL';
    const platform = document.getElementById('platformFilterSelector')?.value || 'ALL';

    try {
        const res = await fetch(`/shopee/api/list?search=${encodeURIComponent(search)}&status=${status}&platform=${platform}`);
        const data = await res.json();
        if (data.success) {
            allShopeeLinksCache = data.links || [];
            if (resetPage) currentShopeePage = 1;
            renderTable();
        }
    } catch (err) {
        console.error('Load shopee links error:', err);
    }
}

function renderTable() {
    const tbody = document.getElementById('shopeeLinksTableBodyContainer');
    if (!tbody) return;

    const links = allShopeeLinksCache || [];
    const totalPages = Math.max(1, Math.ceil(links.length / SHOPEE_PAGE_SIZE));
    if (currentShopeePage > totalPages) currentShopeePage = totalPages;
    if (currentShopeePage < 1) currentShopeePage = 1;

    const startIndex = (currentShopeePage - 1) * SHOPEE_PAGE_SIZE;
    const pageLinks = links.slice(startIndex, startIndex + SHOPEE_PAGE_SIZE);

    updateShopeePagination(totalPages, links.length);

    if (pageLinks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text-muted);">Chưa có sản phẩm nào</td></tr>';
        return;
    }

    tbody.innerHTML = pageLinks.map(link => {
        const meta = PLATFORM_META[link.platform] || PLATFORM_META.shopee;
        return `
        <tr class="table-row-item" data-id="${link._id}" data-title="${link.title}" data-status="${link.status}" data-platform="${link.platform}">
            <td class="col-thumb"><img class="img-thumb" src="${link.imageUrl || ''}" alt="prod" onerror="if(!this.dataset.fallback){this.dataset.fallback='1';this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2246%22 height=%2246%22><rect fill=%22%23ddd%22 width=%2246%22 height=%2246%22 rx=%224%22/><text x=%2223%22 y=%2228%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2214%22>?</text></svg>'}"></td>
            <td class="col-title">${link.title}</td>
            <td class="col-platform">
                <span class="platform-badge" style="background:${meta.color}20;color:${meta.color};">
                    <i class="${meta.icon}"></i> ${meta.label}
                </span>
            </td>
            <td class="col-url" title="${link.shopeeUrl}">${link.shopeeUrl}</td>
            <td class="col-time">${new Date(link.createdAt).toLocaleString('vi-VN')}</td>
            <td class="col-status"><span class="status-badge ${link.status}"><i class="fa-solid fa-circle-${link.status === 'attached' ? 'check' : 'dot'}"></i> ${link.status === 'attached' ? 'Đã gắn link' : 'Chưa gắn link'}</span></td>
            <td class="col-actions">
                <div class="actions-cell">
                    <button class="btn-table-action btn-edit"><i class="fa-regular fa-pen-to-square"></i></button>
                    <button class="btn-table-action btn-delete"><i class="fa-regular fa-trash-can"></i></button>
                </div>
            </td>
        </tr>
    `}).join('');
}

function updateShopeePagination(totalPages, totalLinks) {
    const pageInfo = document.getElementById('shopeePageInfo');
    const prevBtn = document.getElementById('btnPrevShopeePage');
    const nextBtn = document.getElementById('btnNextShopeePage');
    const paginationBar = document.getElementById('shopeePaginationBar');

    if (pageInfo) pageInfo.textContent = `Trang ${currentShopeePage}/${totalPages}`;
    if (prevBtn) prevBtn.disabled = currentShopeePage <= 1;
    if (nextBtn) nextBtn.disabled = currentShopeePage >= totalPages || totalLinks <= SHOPEE_PAGE_SIZE;
    if (paginationBar) paginationBar.style.display = totalLinks > SHOPEE_PAGE_SIZE ? 'flex' : 'none';
}

function changeShopeePage(delta) {
    const totalPages = Math.max(1, Math.ceil((allShopeeLinksCache || []).length / SHOPEE_PAGE_SIZE));
    const nextPage = currentShopeePage + delta;
    if (nextPage < 1 || nextPage > totalPages) return;
    currentShopeePage = nextPage;
    renderTable();
}
