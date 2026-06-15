/* ===================================
   SCHEDULE MANAGER EDIT GROUPS - Facebook groups combobox for edit modal
   =================================== */

let editFacebookGroups = [];
let editSelectedGroupKeys = [];
let editGroupNamesMap = {}; // key -> groupName (stored from payload for display before groups load)

function setEditGroupNamesFromPayload(payload) {
    editGroupNamesMap = {};
    if (!payload) return;
    const keys = Array.isArray(payload.targetGroupId)
        ? payload.targetGroupId
        : (payload.targetGroupId ? [payload.targetGroupId] : []);
    const name = payload.targetGroupName || '';
    // Map each key to the group name (if multiple keys share the same name, store individually)
    keys.forEach((key, idx) => {
        // If we have a groupUrl in payload, prefer it as key
        const actualKey = key;
        // For backward compat, check if payload has group URL mapping
        editGroupNamesMap[actualKey] = name;
    });
}

async function loadEditFacebookGroups(sourceChannelId, preferredGroupKeys = '') {
    const combobox = document.getElementById('editGroupCombobox');
    const dropdown = document.getElementById('editGroupComboboxDropdown');
    const list = document.getElementById('editGroupComboboxList');
    const loading = document.getElementById('editGroupComboboxLoading');
    const empty = document.getElementById('editGroupComboboxEmpty');
    const hint = document.getElementById('editGroupComboboxHint');
    const searchInput = document.getElementById('editGroupSearchInput');

    if (!sourceChannelId) {
        if (list) list.innerHTML = '';
        if (empty) empty.style.display = 'none';
        if (loading) loading.style.display = 'none';
        if (dropdown) dropdown.classList.remove('open');
        if (hint) hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Chọn tài khoản Facebook để hiển thị danh sách nhóm';
        editFacebookGroups = [];
        editSelectedGroupKeys = [];
        editGroupNamesMap = {};
        renderEditSelectedGroupTags();
        return;
    }

    if (dropdown) dropdown.classList.add('open');
    if (loading) loading.style.display = 'block';
    if (empty) empty.style.display = 'none';
    if (list) list.innerHTML = '';
    if (hint) hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách nhóm...';

    try {
        const res = await fetch(`/channels/api/${encodeURIComponent(sourceChannelId)}/facebook-groups`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Không tải được group');

        editFacebookGroups = Array.isArray(data.groups) ? data.groups : [];

        if (editFacebookGroups.length === 0) {
            if (loading) loading.style.display = 'none';
            if (empty) { empty.style.display = 'block'; empty.innerHTML = '<i class="fa-solid fa-users-slash"></i><span>Chưa có nhóm nào</span>'; }
            if (hint) hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Chưa có nhóm nào. Vào "Quét Group" để thêm.';
            return;
        }

        if (loading) loading.style.display = 'none';
        if (hint) hint.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${editFacebookGroups.length} nhóm có sẵn. Chọn một hoặc nhiều nhóm để đăng bài.`;
        editSelectedGroupKeys = Array.isArray(preferredGroupKeys) ? [...preferredGroupKeys] : (preferredGroupKeys ? preferredGroupKeys.split(',') : []);
        
        // Update group names map with actual data from loaded groups
        editFacebookGroups.forEach(g => {
            const key = g.groupUrl || g.groupId || '';
            if (key) editGroupNamesMap[key] = g.groupName || key;
        });
        
        if (searchInput) searchInput.value = '';
        renderEditGroupComboboxList(editFacebookGroups);
        renderEditSelectedGroupTags();
    } catch (err) {
        console.error('Load groups failed:', err);
        if (loading) loading.style.display = 'none';
        if (empty) { empty.style.display = 'block'; empty.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i><span>Lỗi tải nhóm</span>'; }
        if (hint) hint.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Lỗi khi tải danh sách nhóm.';
        showToast('Lỗi khi tải danh sách nhóm. Thử lại hoặc chọn tài khoản khác.', 'error');
    }
}

function renderEditGroupComboboxList(groups, searchTerm = '') {
    const list = document.getElementById('editGroupComboboxList');
    if (!list) return;

    let filtered = groups;
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        filtered = groups.filter(g => (g.groupName || '').toLowerCase().includes(term) || (g.groupId || '').toLowerCase().includes(term));
    }

    list.innerHTML = filtered.map(group => {
        const key = group.groupUrl || group.groupId || '';
        const isSelected = editSelectedGroupKeys.includes(key);
        return `<div class="combobox-item ${isSelected ? 'selected' : ''}" data-group-url="${key}">
            <span class="combobox-item-checkbox">${isSelected ? '✓' : ''}</span>
            <div class="combobox-item-content">
                <span class="combobox-item-title">${group.groupName || key}</span>
            </div>
        </div>`;
    }).join('');

    attachEditGroupItemListeners();
}

function attachEditGroupItemListeners() {
    const list = document.getElementById('editGroupComboboxList');
    if (!list) return;

    list.querySelectorAll('.combobox-item').forEach(item => {
        item.addEventListener('click', () => {
            const key = item.dataset.groupUrl;
            const isCurrentlySelected = item.classList.contains('selected');

            if (isCurrentlySelected) {
                editSelectedGroupKeys = editSelectedGroupKeys.filter(k => k !== key);
            } else {
                editSelectedGroupKeys.push(key);
            }

            item.classList.toggle('selected');
            const checkbox = item.querySelector('.combobox-item-checkbox');
            checkbox.textContent = isCurrentlySelected ? '' : '✓';
            renderEditSelectedGroupTags();
        });
    });
}

function renderEditSelectedGroupTags() {
    const container = document.getElementById('editSelectedGroupTags');
    const badge = document.getElementById('editGroupSelectedBadge');
    if (!container) return;

    container.innerHTML = editSelectedGroupKeys.map(key => {
        const group = editFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
        const name = group?.groupName || editGroupNamesMap[key] || key;
        return `<div class="selected-tag" data-key="${key}">
            <span>${name.substring(0, 25)}${name.length > 25 ? '...' : ''}</span>
            <span class="selected-tag__remove" data-action="remove-edit-group" data-key="${key}">
                <i class="fa-solid fa-xmark"></i>
            </span>
        </div>`;
    }).join('');

    if (badge) badge.textContent = `${editSelectedGroupKeys.length} đã chọn`;
}

document.addEventListener('click', function(e) {
    const removeBtn = e.target.closest('.selected-tag__remove[data-action="remove-edit-group"]');
    if (removeBtn) removeEditSelectedGroup(removeBtn.dataset.key);
});

function removeEditSelectedGroup(key) {
    editSelectedGroupKeys = editSelectedGroupKeys.filter(k => k !== key);
    renderEditSelectedGroupTags();
    renderEditGroupComboboxList(editFacebookGroups, document.getElementById('editGroupSearchInput')?.value || '');
}

function getEditSelectedGroups() {
    return editSelectedGroupKeys.map(key => {
        const group = editFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
        return { groupId: group?.groupId || '', groupUrl: key, groupName: group?.groupName || '' };
    });
}