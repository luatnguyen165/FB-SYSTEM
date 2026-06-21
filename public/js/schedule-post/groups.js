/* ===================================
   SCHEDULE POST GROUPS — Same style as AI Content
   Render danh sách group FB trong tab "Facebook" của Nơi đăng.
   Toggle show/hide wrapper do platform-target.js điều phối.
   =================================== */

let schedulePostFacebookGroups = [];
let selectedGroupKeys = [];
let currentGroupSourceChannelId = '';
let schedulePostGroupsLoading = false;

/**
 * Stub - gọi từ platform-target.js. (Giữ tên để tương thích ngược.)
 */
function toggleFacebookGroupSelectionForSchedulePost() {
    // Không còn dùng trong flow tabs mới; logic đã chuyển sang platform-target.js
}

/**
 * Chỉ load data groups cho 1 FB account, KHÔNG render.
 * Render là việc của renderFacebookTab (trong tab "Nơi đăng").
 * @returns {Promise<Array>} danh sách groups (rỗng nếu lỗi / account chưa có group)
 */
async function loadSchedulePostFacebookGroups(sourceChannelId, preferredGroupKeys) {
    console.log('[Groups] loadSchedulePostFacebookGroups called with:', sourceChannelId);
    schedulePostGroupsLoading = true;
    const previousSource = currentGroupSourceChannelId;
    currentGroupSourceChannelId = sourceChannelId;

    if (!sourceChannelId) {
        schedulePostFacebookGroups = [];
        schedulePostGroupsLoading = false;
        return schedulePostFacebookGroups;
    }

    try {
        const url = `/channels/api/${encodeURIComponent(sourceChannelId)}/facebook-groups`;
        console.log('[Groups] Fetching:', url);
        const res = await fetch(url);
        const data = await res.json();
        console.log('[Groups] API response success:', data.success, 'groups count:', data.groups?.length);
        if (!data.success) throw new Error(data.message || 'Không tải được group');

        schedulePostFacebookGroups = Array.isArray(data.groups) ? data.groups : [];
        schedulePostGroupsLoading = false;

        if (preferredGroupKeys && preferredGroupKeys.length > 0) {
            selectedGroupKeys = [...preferredGroupKeys];
        } else if (previousSource && previousSource !== sourceChannelId) {
            selectedGroupKeys = [];
        }

        console.log('[Groups] Updated schedulePostFacebookGroups, count:', schedulePostFacebookGroups.length);
        return schedulePostFacebookGroups;
    } catch (err) {
        console.error('[Groups] Load Facebook groups failed:', err);
        schedulePostFacebookGroups = [];
        schedulePostGroupsLoading = false;
        return [];
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
        html += `<div class="group-badge-item" onclick="removeSchedulePostGroupBadge('${escapeAttr(key)}')">
            <span class="group-badge-item__name"><i class="fa-brands fa-facebook"></i> ${escapeHtml(name.substring(0, 25))} <i class="fa-solid fa-xmark"></i></span>
            <span class="group-badge-item__platform">Facebook</span>
        </div>`;
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

/**
 * Render tab Facebook trong "Nơi đăng" - gọi từ platform-target.js
 * Logic load groups dựa trên resolveFBTarget() ở platform-target.js.
 * Async: đợi load groups xong mới render HTML.
 */
async function renderFacebookTab(container, tab) {
    const resolved = typeof resolveFBTarget === 'function' ? resolveFBTarget() : null;
    if (!resolved || !resolved.shouldRender) {
        container.innerHTML = `
            <div class="target-block target-block--fb">
                <div class="target-block__empty">
                    <i class="fa-brands fa-facebook"></i>
                    <span>Tick Facebook ở trên và chọn ít nhất 1 tài khoản FB để hiện danh sách nhóm</span>
                </div>
            </div>`;
        return;
    }

    const { sourceId, accName } = resolved;
    const myLoadToken = ++fbGroupsLoadToken;

    // Hiển thị loading NGAY
    container.innerHTML = `
        <div class="target-block target-block--fb">
            <div class="target-block__header">
                <i class="${tab.icon}"></i>
                <strong>Nhóm đích của "${escapeHtml(accName)}"</strong>
                <span class="target-block__sub"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải...</span>
            </div>
            <div class="target-block__body">
                <div class="schedule-accounts-empty"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách nhóm...</div>
            </div>
        </div>`;

    // Chỉ load lại khi account thay đổi (KHÔNG load lại khi chỉ tick thêm/bớt account khác)
    if (currentGroupSourceChannelId !== sourceId) {
        await loadSchedulePostFacebookGroups(sourceId);
        // Bỏ qua nếu đã có lệnh load mới hơn (tránh ghi đè)
        if (myLoadToken !== fbGroupsLoadToken) return;
    }

    // Nếu tab đã chuyển sang platform khác trong lúc đợi → không render
    if (typeof currentTargetTab !== 'undefined' && currentTargetTab !== 'FB') return;

    // Render groups list hoặc empty state
    const groupsListHtml = schedulePostFacebookGroups.length === 0
        ? `<div class="schedule-accounts-empty">
             <i class="fa-solid fa-users-slash"></i> Tài khoản <strong>${escapeHtml(accName)}</strong> chưa có nhóm nào. Vui lòng vào trang
             <a href="/schedule/groups" style="color:var(--primary);font-weight:600;">Quét nhóm Facebook</a> để quét nhóm cho tài khoản này.
           </div>`
        : buildGroupsListHtml();

    container.innerHTML = `
        <div class="target-block target-block--fb">
            <div class="target-block__header">
                <i class="${tab.icon}"></i>
                <strong>Nhóm đích của "${escapeHtml(accName)}"</strong>
                <span class="target-block__sub">${selectedGroupKeys.length} nhóm đã chọn</span>
            </div>
            <div class="target-block__body">
                ${groupsListHtml}
            </div>
        </div>`;

    rebindGroupsTabEvents();

    // Pre-select các group đã chọn trước đó
    if (selectedGroupKeys.length > 0) {
        selectedGroupKeys.forEach(key => {
            const cb = document.querySelector(`#schedulePostGroupsWrapper input[name="schedulePostGroupSelect"][value="${CSS.escape(key)}"]`);
            if (cb) cb.checked = true;
        });
    }
}

function buildGroupsListHtml() {
    let html = `
    <div class="groups-search-bar">
        <i class="fa-solid fa-search"></i>
        <input type="text" class="groups-search-input" placeholder="Click để chọn nhóm..." oninput="filterSchedulePostGroups(this.value)">
        <button type="button" class="groups-select-all-btn" onclick="toggleAllSchedulePostGroups(true)" title="Chọn tất cả"><i class="fa-solid fa-check-double"></i></button>
        <button type="button" class="groups-select-all-btn" onclick="toggleAllSchedulePostGroups(false)" title="Bỏ chọn tất cả"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="groups-items-wrapper" id="schedulePostGroupsWrapper">`;
    schedulePostFacebookGroups.forEach(g => {
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
    html += `</div>
    <div class="groups-count-bar"><strong id="schedulePostGroupCount">${selectedGroupKeys.length}</strong> / ${schedulePostFacebookGroups.length} nhóm đã chọn</div>`;
    return html;
}

function rebindGroupsTabEvents() {
    const wrapper = document.getElementById('schedulePostGroupsWrapper');
    const searchInput = wrapper?.parentElement?.querySelector('.groups-search-input');
    const searchBar = wrapper?.parentElement?.querySelector('.groups-search-bar');
    if (wrapper) wrapper.style.display = 'none';
    if (searchInput) {
        searchInput.addEventListener('focus', () => { if (wrapper) wrapper.style.display = ''; });
        searchInput.addEventListener('blur', () => {
            setTimeout(() => { if (wrapper && !wrapper.matches(':hover')) wrapper.style.display = 'none'; }, 200);
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