/* ===================================
   SCHEDULE MANAGER EDIT AFFILIATE - Shopee affiliate combobox for edit modal
   =================================== */

let editAllAffiliateLinks = [];
let editSelectedShopeeLinks = [];

function renderEditAffiliateComboboxList(links, searchTerm = '') {
    const list = document.getElementById('editAffiliateComboboxList');
    if (!list) return;

    let filtered = links;
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = links.filter(l =>
            (l.title || '').toLowerCase().includes(term) ||
            (l.shopeeUrl || '').toLowerCase().includes(term)
        );
    }

    if (filtered.length === 0) {
        list.innerHTML = '';
        const empty = document.getElementById('editAffiliateComboboxEmpty');
        if (empty) empty.style.display = 'flex';
        return;
    }

    const empty = document.getElementById('editAffiliateComboboxEmpty');
    if (empty) empty.style.display = 'none';

    list.innerHTML = filtered.map(link => {
        const isSelected = editSelectedShopeeLinks.includes(String(link._id));
        return `<div class="combobox-item ${isSelected ? 'selected' : ''}" data-link-id="${link._id}">
            <span class="combobox-item-checkbox">${isSelected ? '✓' : ''}</span>
            <img class="combobox-item-thumb" src="${link.imageUrl || 'https://via.placeholder.com/40?text=?'}" alt="${link.title || ''}" onerror="this.src='https://via.placeholder.com/40?text=?'">
            <div class="combobox-item-info">
                <span class="combobox-item-title">${link.title || '—'}</span>
                <span class="combobox-item-url">${link.shopeeUrl || '—'}</span>
            </div>
        </div>`;
    }).join('');

    attachEditAffiliateItemListeners();
}

function attachEditAffiliateItemListeners() {
    const list = document.getElementById('editAffiliateComboboxList');
    if (!list) return;

    list.querySelectorAll('.combobox-item').forEach(item => {
        item.addEventListener('click', () => {
            const id = item.dataset.linkId;
            const isCurrentlySelected = item.classList.contains('selected');

            if (isCurrentlySelected) {
                editSelectedShopeeLinks = editSelectedShopeeLinks.filter(l => l !== id);
            } else {
                editSelectedShopeeLinks.push(id);
            }

            item.classList.toggle('selected');
            const checkbox = item.querySelector('.combobox-item-checkbox');
            if (checkbox) checkbox.textContent = isCurrentlySelected ? '' : '✓';

            renderEditAffiliateUrls();
            renderEditAffiliateSelectedBadge();
        });
    });
}

function renderEditAffiliateUrls() {
    const box = document.getElementById('editAffiliateUrls');
    if (!box) return;

    const selected = editAllAffiliateLinks.filter(l => editSelectedShopeeLinks.includes(String(l._id)));

    if (!selected.length) {
        box.innerHTML = '<p class="affiliate-urls-empty">Chưa có sản phẩm nào được chọn.</p>';
        return;
    }

    box.innerHTML = selected.map(link => `
        <div class="edit-affiliate-item" data-link-id="${link._id}">
            <img src="${link.imageUrl || 'https://via.placeholder.com/32?text=?'}" alt="${link.title || ''}" onerror="this.src='https://via.placeholder.com/32?text=?'">
            <div class="edit-affiliate-item__info">
                <div class="edit-affiliate-item__title">${link.title || '—'}</div>
                <div class="edit-affiliate-item__url">${link.shopeeUrl || '—'}</div>
            </div>
            <button type="button" class="edit-affiliate-item__remove" data-id="${link._id}"><i class="fa-solid fa-xmark"></i></button>
        </div>`).join('');

    box.querySelectorAll('.edit-affiliate-item__remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            editSelectedShopeeLinks = editSelectedShopeeLinks.filter(l => l !== id);
            renderEditAffiliateUrls();
            renderEditAffiliateComboboxList(editAllAffiliateLinks, document.getElementById('editAffiliateSearchInput')?.value || '');
            renderEditAffiliateSelectedBadge();
        });
    });
}

function renderEditAffiliateSelectedBadge() {
    const badge = document.getElementById('editAffiliateSelectedBadge');
    if (badge) badge.textContent = `${editSelectedShopeeLinks.length} đã chọn`;
}

function renderEditShopeeLinkOptions(selectedIds = []) {
    if (!editFields.shopeeLinks) return;
    const links = Array.isArray(managerData.shopeeLinks) ? managerData.shopeeLinks : [];
    editFields.shopeeLinks.innerHTML = links.map(l =>
        `<option value="${l._id}" ${selectedIds.includes(String(l._id)) ? 'selected' : ''}>${l.title || l.shopeeUrl}</option>`
    ).join('');
}