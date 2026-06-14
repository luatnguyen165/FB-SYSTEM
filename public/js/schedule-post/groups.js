/* ===================================
   SCHEDULE POST GROUPS — Same style as AI Content
   =================================== */

let schedulePostFacebookGroups = [];
let selectedGroupKeys = [];
let currentGroupSourceChannelId = '';

function toggleFacebookGroupSelectionForSchedulePost() {
    const groupWrapper = document.getElementById('facebookGroupSelectWrapper');
    const selectedPlatform = document.querySelector('.platform-check:checked')?.value || '';
    const shouldShow = selectedPlatform === 'FB';
    if (groupWrapper) groupWrapper.style.display = shouldShow ? '' : 'none';

    if (shouldShow) {
        setTimeout(() => {
            const checkedFBAccounts = document.querySelectorAll('.acc-pick-item input:checked');
            const fbAccounts = [];
            checkedFBAccounts.forEach(cb => {
                if (cb.closest('.acc-pick-item')?.querySelector('i.fa-facebook')) fbAccounts.push(cb);
            });

            if (fbAccounts.length > 0) {
                loadSchedulePostFacebookGroups(fbAccounts[0].value);
            }
        }, 300);
    }
}

async function loadSchedulePostFacebookGroups(sourceChannelId) {
    const container = document.getElementById('schedulePostGroupsList');
    if (!container) return;

    currentGroupSourceChannelId = sourceChannelId;
    selectedGroupKeys = [];

    if (!sourceChannelId) {
        container.innerHTML = `<div class="schedule-accounts-empty"><i class="fa-solid fa-lightbulb"></i> Chọn tài khoản Facebook để hiển thị danh sách nhóm</div>`;
        return;
    }

    container.innerHTML = `<div class="schedule-accounts-empty"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách nhóm...</div>`;

    try {
        const res = await fetch(`/channels/api/${encodeURIComponent(sourceChannelId)}/facebook-groups`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Không tải được group');

        schedulePostFacebookGroups = Array.isArray(data.groups) ? data.groups : [];

        if (schedulePostFacebookGroups.length === 0) {
            container.innerHTML = `<div class="schedule-accounts-empty"><i class="fa-solid fa-users-slash"></i> Chưa có nhóm nào. Vui lòng vào trang <a href="/schedule/groups" style="color:var(--primary);font-weight:600;">Quét nhóm Facebook</a> để quét.</div>`;
            return;
        }

        renderSchedulePostGroups(container, schedulePostFacebookGroups);
    } catch (err) {
        console.error('Load Facebook groups failed:', err);
        container.innerHTML = `<div class="schedule-accounts-empty"><i class="fa-solid fa-exclamation-triangle"></i> Không tải được group. Vui lòng thử lại.</div>`;
    }
}

function renderSchedulePostGroups(container, groups) {
    let html = `
    <div class="groups-search-bar">
        <i class="fa-solid fa-search"></i>
        <input type="text" class="groups-search-input" placeholder="Click để chọn nhóm..." oninput="filterSchedulePostGroups(this.value)">
        <button type="button" class="groups-select-all-btn" onclick="toggleAllSchedulePostGroups(true)" title="Chọn tất cả"><i class="fa-solid fa-check-double"></i></button>
        <button type="button" class="groups-select-all-btn" onclick="toggleAllSchedulePostGroups(false)" title="Bỏ chọn tất cả"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="groups-items-wrapper" id="schedulePostGroupsWrapper">`;

    groups.forEach(g => {
        const key = g.groupUrl || g.groupId;
        html += `
        <label class="group-select-item" data-group-key="${escapeAttr(key)}" data-group-name="${escapeAttr((g.groupName || '').toLowerCase())}">
            <input type="checkbox" name="schedulePostGroupSelect" value="${escapeAttr(key)}" onchange="onSchedulePostGroupToggle()">
            <span class="group-select-check"><i class="fa-solid fa-check"></i></span>
            <span class="group-select-icon"><i class="fa-brands fa-facebook"></i></span>
            <span class="group-select-info">
                <span class="group-select-name">${escapeHtml(g.groupName || 'Unknown')}</span>
                <span class="group-select-account">ID: ${(g.groupId || '').substring(0, 12)}...</span>
            </span>
        </label>`;
    });

    html += `</div><div class="groups-selected-badges" id="schedulePostSelectedBadges"></div><div class="groups-count-bar"><strong id="schedulePostGroupCount">0</strong> / ${groups.length} nhóm đã chọn</div>`;

    container.innerHTML = html;

    // Groups list hidden by default, show on search focus/click
    const wrapper = document.getElementById('schedulePostGroupsWrapper');
    const searchInput = container.querySelector('.groups-search-input');
    const searchBar = container.querySelector('.groups-search-bar');
    if (wrapper) wrapper.style.display = 'none';
    if (searchInput) {
        searchInput.addEventListener('focus', () => {
            if (wrapper) wrapper.style.display = '';
        });
        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (wrapper && !wrapper.matches(':hover')) {
                    wrapper.style.display = 'none';
                }
            }, 200);
        });
    }
    if (searchBar) {
        searchBar.addEventListener('click', (e) => {
            if (e.target === searchBar || e.target.tagName === 'I') {
                if (wrapper) wrapper.style.display = '';
                if (searchInput) searchInput.focus();
            }
        });
    }
}

function filterSchedulePostGroups(keyword) {
    const kw = keyword.toLowerCase().trim();
    document.querySelectorAll('#schedulePostGroupsWrapper .group-select-item').forEach(item => {
        const name = item.dataset.groupName || '';
        item.style.display = (!kw || name.includes(kw)) ? '' : 'none';
    });
}

function toggleAllSchedulePostGroups(select) {
    document.querySelectorAll('#schedulePostGroupsWrapper .group-select-item').forEach(item => {
        if (item.style.display !== 'none') {
            item.querySelector('input[type="checkbox"]').checked = select;
        }
    });
    onSchedulePostGroupToggle();
}

function onSchedulePostGroupToggle() {
    const checked = document.querySelectorAll('#schedulePostGroupsWrapper input[name="schedulePostGroupSelect"]:checked');
    const total = document.querySelectorAll('#schedulePostGroupsWrapper .group-select-item').length;
    selectedGroupKeys = Array.from(checked).map(cb => cb.value);

    const countEl = document.getElementById('schedulePostGroupCount');
    if (countEl) countEl.textContent = selectedGroupKeys.length;

    renderSchedulePostGroupBadges();
}

function renderSchedulePostGroupBadges() {
    const badgesContainer = document.getElementById('schedulePostSelectedBadges');
    if (!badgesContainer) return;

    let html = '';
    selectedGroupKeys.forEach(key => {
        const group = schedulePostFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
        const name = group?.groupName || key;
        html += `<span class="group-badge" onclick="removeSchedulePostGroupBadge('${escapeAttr(key)}')"><i class="fa-brands fa-facebook"></i> ${escapeHtml(name.substring(0, 25))} <i class="fa-solid fa-xmark"></i></span>`;
    });

    badgesContainer.innerHTML = html;
}

function removeSchedulePostGroupBadge(key) {
    const cb = document.querySelector(`#schedulePostGroupsWrapper input[name="schedulePostGroupSelect"][value="${CSS.escape(key)}"]`);
    if (cb) {
        cb.checked = false;
        onSchedulePostGroupToggle();
    }
}

function getSelectedGroups() {
    return selectedGroupKeys.map(key => {
        const group = schedulePostFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
        return { groupId: group?.groupId || '', groupUrl: key, groupName: group?.groupName || '' };
    });
}

// Legacy compatibility
function updateSelectedCountDisplay() { onSchedulePostGroupToggle(); }
function renderSelectedGroupTags() { renderSchedulePostGroupBadges(); }
function updateGroupSelectedBadge() { renderSchedulePostGroupBadges(); }

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&').replace(/"/g, '"').replace(/'/g, '&#39;').replace(/</g, '<').replace(/>/g, '>');
}