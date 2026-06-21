/* ===================================
   PLATFORM-TARGET.JS
   Điều phối tabs "Nơi đăng" theo các platform chip được tick.
   Mỗi tab chứa 1 sub-module (FB/IG/TT) render account + target.
   =================================== */

const TARGET_TABS = [
    { key: 'FB', label: 'Facebook', icon: 'fa-brands fa-facebook', color: '#1877F2', module: 'groups' },
    { key: 'IG', label: 'Instagram', icon: 'fa-brands fa-instagram', color: '#E4405F', module: 'instagram' },
    { key: 'TT', label: 'TikTok', icon: 'fa-brands fa-tiktok', color: '#000000', module: 'tiktok' },
    { key: 'TH', label: 'Threads', icon: 'fa-brands fa-threads', color: '#000000', module: 'threads' },
    { key: 'PI', label: 'Pinterest', icon: 'fa-brands fa-pinterest', color: '#E60023', module: 'pinterest' }
];

let currentTargetTab = 'FB';
let currentFBTargetSource = null; // accountId đang được dùng làm nguồn load groups
let fbGroupsLoadToken = 0;       // token để tránh race condition khi load groups

/**
 * Lấy danh sách platform đang được tick
 */
function getActivePlatforms() {
    return Array.from(document.querySelectorAll('.platform-check:checked'))
        .map(cb => cb.value)
        .filter(Boolean);
}

/**
 * Lấy danh sách ID account đang được tick thuộc 1 platform cụ thể.
 * Trả về theo thứ tự DOM (giữ nguyên như cũ, không sort).
 */
function getCheckedAccountsByPlatform(platform) {
    return Array.from(document.querySelectorAll('.account-card input[name="modalAccSelect"]:checked'))
        .filter(cb => {
            const item = cb.closest('.account-card');
            return item && item.classList.contains(`acc-platform-${platform}`);
        })
        .map(cb => cb.value);
}

/**
 * Quyết định tab FB có nên hiển thị không + account nguồn nào dùng để load groups.
 * @returns {{shouldRender: boolean, sourceId: string|null, accName: string}}
 */
function resolveFBTarget() {
    const hasFBPlatform = getActivePlatforms().includes('FB');
    const fbAccounts = getCheckedAccountsByPlatform('FB');
    if (!hasFBPlatform || fbAccounts.length === 0) {
        return { shouldRender: false, sourceId: null, accName: '' };
    }

    // Account nguồn: ưu tiên account hiện tại nếu vẫn được tick; nếu không → account tick đầu tiên
    let sourceId;
    if (currentFBTargetSource && fbAccounts.includes(currentFBTargetSource)) {
        sourceId = currentFBTargetSource;
    } else {
        sourceId = fbAccounts[0];
        currentFBTargetSource = sourceId;
    }

    const accName = document.querySelector(`.account-card.acc-platform-FB input[value="${CSS.escape(sourceId)}"]`)
        ?.closest('.account-card')?.querySelector('.account-card__name')?.textContent?.trim() || sourceId;

    return { shouldRender: true, sourceId, accName };
}

/**
 * Render lại toàn bộ tabs khi user tick/untick platform chip
 */
function renderTargetTabs() {
    const wrapper = document.getElementById('targetTabsWrapper');
    const navEl = document.getElementById('targetTabsNav');
    const contentEl = document.getElementById('targetTabsContent');
    if (!wrapper || !navEl || !contentEl) return;

    const active = getActivePlatforms();
    const available = TARGET_TABS.filter(t => active.includes(t.key));

    const fbResolved = resolveFBTarget();
    const hasIGPlatform = active.includes('IG');
    const hasTTPlatform = active.includes('TT');
    const hasTHPlatform = active.includes('TH');
    const hasPIPlatform = active.includes('PI');
    const hasIGAccount = getCheckedAccountsByPlatform('IG').length > 0;
    const hasTTAccount = getCheckedAccountsByPlatform('TT').length > 0;
    const hasTHAccount = getCheckedAccountsByPlatform('TH').length > 0;
    const hasPIAccount = getCheckedAccountsByPlatform('PI').length > 0;

    const shouldShow = available.length >= 2
        || (fbResolved.shouldRender)
        || (hasIGPlatform && hasIGAccount)
        || (hasTTPlatform && hasTTAccount)
        || (hasTHPlatform && hasTHAccount)
        || (hasPIPlatform && hasPIAccount);

    if (!shouldShow) {
        wrapper.style.display = 'none';
        navEl.innerHTML = '';
        contentEl.innerHTML = '';
        return;
    }

    wrapper.style.display = '';

    // Render nav
    navEl.innerHTML = available.map((tab, i) => {
        const isActive = i === 0 || tab.key === currentTargetTab;
        const accCount = getCheckedAccountsByPlatform(tab.key).length;
        const targetBadge = getTargetBadgeForTab(tab.key);
        return `
            <button type="button" class="target-tab ${isActive ? 'active' : ''}"
                    data-tab="${tab.key}" style="--tab-color:${tab.color}">
                <i class="${tab.icon}"></i>
                <span>${tab.label}</span>
                <span class="target-tab__badge">${accCount}${targetBadge}</span>
            </button>`;
    }).join('');

    if (!available.find(t => t.key === currentTargetTab)) {
        currentTargetTab = available[0]?.key || 'FB';
    }

    navEl.querySelectorAll('.target-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTargetTab(btn.dataset.tab));
    });

    renderTargetTabContent();
}

function switchTargetTab(tabKey) {
    currentTargetTab = tabKey;
    document.querySelectorAll('#targetTabsNav .target-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabKey);
    });
    renderTargetTabContent();
}

/**
 * CHỈ render content cho tab hiện tại. Không gọi load groups ở đây.
 * Việc load groups do renderFacebookTab tự quyết định qua resolveFBTarget().
 */
function renderTargetTabContent() {
    const contentEl = document.getElementById('targetTabsContent');
    if (!contentEl) return;

    const tab = TARGET_TABS.find(t => t.key === currentTargetTab);
    if (!tab) { contentEl.innerHTML = ''; return; }

    const renderers = {
        FB: renderFacebookTab,
        IG: renderInstagramTab,
        TT: renderTikTokTab,
        TH: renderThreadsTab,
        PI: renderPinterestTab
    };
    const fn = renderers[tab.key];
    if (!fn) return;

    const result = fn(contentEl, tab);
    if (result && typeof result.catch === 'function') {
        result.catch(err => console.error(`Render ${tab.key} tab failed:`, err));
    }
}

function getTargetBadgeForTab(tabKey) {
    if (tabKey === 'FB') {
        const count = (window.selectedGroupKeys || []).length;
        return count > 0 ? `·${count} nhóm` : '';
    }
    if (tabKey === 'IG') {
        return '·Feed';
    }
    if (tabKey === 'TH') {
        const opts = collectThreadsOptions();
        return opts.feed ? '·Feed' : '';
    }
    if (tabKey === 'PI') {
        const opts = collectPinterestOptions();
        return opts.board ? `·${opts.board}` : '·Board';
    }
    return '';
}

/**
 * Cập nhật badge trên tab (không re-render content).
 * Gọi khi user tick/untick account NHƯNG không đổi account nguồn.
 */
function refreshTargetTabsBadges() {
    const navEl = document.getElementById('targetTabsNav');
    if (!navEl) return;
    navEl.querySelectorAll('.target-tab').forEach(btn => {
        const key = btn.dataset.tab;
        const accCount = getCheckedAccountsByPlatform(key).length;
        const targetBadge = getTargetBadgeForTab(key);
        const badge = btn.querySelector('.target-tab__badge');
        if (badge) badge.textContent = `${accCount}${targetBadge}`;
    });
}

/**
 * Hook chính - gọi khi platform chip thay đổi
 */
function onPlatformChipsChange() {
    // Reset state khi platform thay đổi
    const active = getActivePlatforms();
    if (!active.includes('FB')) {
        currentFBTargetSource = null;
        window.currentGroupSourceChannelId = '';
        window.schedulePostFacebookGroups = [];
    }
    // Ẩn/hiện "Tài khoản đăng" + "Nơi đăng" theo tick
    if (typeof toggleAccountAndTargetSections === 'function') {
        toggleAccountAndTargetSections();
    }
    // Highlight field tiêu đề khi chọn Pinterest
    if (typeof highlightPostTitleSection === 'function') {
        highlightPostTitleSection();
    }
    renderTargetTabs();
}

/**
 * Highlight + show/hide field "Tiêu đề bài viết" theo platform
 * - Ẩn hoàn toàn khi không chọn PI
 * - Hiện khi chọn PI (đồng nhất style với Reels, chỉ có dấu * ở header)
 */
function highlightPostTitleSection() {
    const section = document.getElementById('postTitleSection');
    if (!section) return;

    const active = (typeof getActivePlatforms === 'function') ? getActivePlatforms() : [];
    const hasPI = active.includes('PI');

    if (hasPI) {
        section.style.display = '';
    } else {
        section.style.display = 'none';
    }
}

/**
 * Hook gọi khi user tick/untick account trong picker.
 * Quy tắc: chỉ được chọn 1 account FB tại 1 thời điểm → tick account nào thì
 * load groups của account đó. Click A → load A. Click B → load B.
 */
function onAccountPickerChange() {
    // Tìm account FB đang được tick (sau khi DOM đã thay đổi)
    const fbChecked = document.querySelector('.account-card.acc-platform-FB input[name="modalAccSelect"]:checked');
    if (fbChecked) {
        // Ép source = account đang tick → renderFacebookTab sẽ thấy currentGroupSourceChannelId
        // khác sourceId và load lại groups cho account này
        currentFBTargetSource = fbChecked.value;
        currentGroupSourceChannelId = ''; // reset để chắc chắn trigger load
    } else {
        currentFBTargetSource = null;
    }
    renderTargetTabs();
}

/**
 * Gom payload từ tabs về shape cũ (backward-compatible với backend)
 */
function collectSchedulePostTargets() {
    const platforms = getActivePlatforms();
    const accounts = Array.from(document.querySelectorAll('.account-card input[name="modalAccSelect"]:checked'))
        .map(cb => cb.value);

    const result = {
        platforms,
        accounts,
        targetGroupIds: window.selectedGroupKeys || [],
        targetGroupSourceChannelId: currentFBTargetSource || getCheckedAccountsByPlatform('FB')[0] || '',
        platformTargets: {
            FB: { accounts: getCheckedAccountsByPlatform('FB'), groups: window.selectedGroupKeys || [] },
            IG: { accounts: getCheckedAccountsByPlatform('IG'), options: collectInstagramOptions() },
            TT: { accounts: getCheckedAccountsByPlatform('TT'), options: { feed: true } },
            TH: { accounts: getCheckedAccountsByPlatform('TH'), options: collectThreadsOptions() },
            PI: { accounts: getCheckedAccountsByPlatform('PI'), options: collectPinterestOptions() }
        }
    };
    return result;
}

/**
 * Pre-fill khi edit 1 schedule cũ
 */
function prefillTargetTabsFromSchedule(schedule) {
    if (!schedule) return;
    if (Array.isArray(schedule.targetGroupIds) && schedule.targetGroupIds.length) {
        window.selectedGroupKeys = [...schedule.targetGroupIds];
    }
    if (schedule.targetGroupSourceChannelId) {
        const id = typeof schedule.targetGroupSourceChannelId === 'object'
            ? schedule.targetGroupSourceChannelId._id
            : schedule.targetGroupSourceChannelId;
        currentFBTargetSource = String(id);
    }
}
