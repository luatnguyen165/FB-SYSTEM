/* ===================================
   BASE.JS - JS CHUNG CHO TẤT CẢ TRANG
   Menu Toggle, Sidebar, Avatar Dropdown, Toast Handler
   =================================== */

// Track already-handled API URLs to avoid duplicate toasts
window.__toastHandledUrls = new Set();

// === TOAST NOTIFICATION HANDLER ===
// Intercept all fetch calls and auto-show toast on `{ success, message }` responses
const originalFetch = window.fetch;
window.fetch = async function(input, init = {}) {
    const res = await originalFetch(input, init);
    const url = typeof input === 'string' ? input : input?.url || '';
    // Only process JSON API responses matching our app routes
    const contentType = res.headers.get('content-type') || '';
    const isApiCall = url.includes('/api/') || url.includes('/auth/') || init.method !== 'GET';
    if (contentType.includes('json') && isApiCall && !window.__toastHandledUrls.has(url)) {
        window.__toastHandledUrls.add(url);
        try {
            const cloned = res.clone();
            const data = await cloned.json();
            if (data && typeof data === 'object') {
                if (data.success === true && data.message) {
                    showToast(data.message, 'success');
                } else if (data.success === false && data.message) {
                    showToast(data.message, 'error');
                }
            }
        } catch { /* ignore parse errors */ }
    }
    return res;
};

// === MENU TOGGLE (Mobile) ===
document.addEventListener('DOMContentLoaded', function() {
    // === MENU TOGGLE (Mobile) ===
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

    function isMobileView() {
        return window.innerWidth <= 1024;
    }

    function updateMenuToggleVisibility() {
        if (menuToggle) {
            if (isMobileView()) {
                menuToggle.style.display = 'block';
            } else {
                menuToggle.style.display = 'none';
                if (sidebar) {
                    sidebar.classList.remove('active');
                }
            }
        }
    }

    // Toggle sidebar
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }

    // Close sidebar (X button)
    if (sidebarCloseBtn && sidebar) {
        sidebarCloseBtn.addEventListener('click', () => {
            sidebar.classList.remove('active');
        });
    }

    // Close sidebar khi click ra ngoài (mobile only)
    document.addEventListener('click', (e) => {
        if (isMobileView() && sidebar && menuToggle) {
            if (!sidebar.contains(e.target) && !menuToggle.contains(e.target) && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
            }
        }
    });

    // Sidebar tree dropdowns — exclusive mode: chỉ mở 1 group tại 1 thời điểm
    function getSidebarGroups() {
        return Array.from(document.querySelectorAll('.sidebar-group'));
    }

    function setSidebarGroupOpen(group, isOpen) {
        if (!group) return;
        group.classList.toggle('is-open', isOpen);
        const button = group.querySelector('[data-sidebar-group-toggle]');
        if (button) button.setAttribute('aria-expanded', String(isOpen));
    }

    function openOnlySidebarGroup(targetGroup) {
        // Query lại DOM mỗi lần để chắc chắn bắt đúng tất cả group hiện có
        getSidebarGroups().forEach((group) => {
            setSidebarGroupOpen(group, group === targetGroup);
        });
    }

    // Lưu group đang mở trong localStorage để giữ trạng thái qua navigation,
    // refresh và mở tab mới (không dùng sessionStorage vì sẽ mất khi tab đóng).
    const STORAGE_KEY = 'sidebar:openGroupId';

    function getStoredOpenGroupId() {
        try {
            return localStorage.getItem(STORAGE_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function setStoredOpenGroupId(groupId) {
        try {
            if (groupId) localStorage.setItem(STORAGE_KEY, groupId);
            else localStorage.removeItem(STORAGE_KEY);
        } catch (e) {
            /* ignore */
        }
    }

    // Click toggle: toggle group hiện tại, đóng các group khác (dùng event delegation trên sidebar)
    const sidebarEl = document.getElementById('sidebar');
    if (sidebarEl) {
        sidebarEl.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('[data-sidebar-group-toggle]');
            if (toggleBtn && sidebarEl.contains(toggleBtn)) {
                e.stopPropagation();
                e.preventDefault();
                const group = toggleBtn.closest('.sidebar-group');
                if (!group) return;
                const groupId = group.dataset.sidebarGroupId || toggleBtn.dataset.sidebarGroupToggle || '';
                const willOpen = !group.classList.contains('is-open');
                if (willOpen) {
                    openOnlySidebarGroup(group);
                    setStoredOpenGroupId(groupId);
                } else {
                    // Click vào group đang mở → đóng tất cả
                    openOnlySidebarGroup(null);
                    setStoredOpenGroupId('');
                }
                return;
            }

            // Click vào link submenu: lưu group cha vào storage, để page mới tự mở khi load
            // KHÔNG toggle DOM trực tiếp — DOM cũ sẽ bị unmount khi navigate, toggle sẽ mất tác dụng.
            const subLink = e.target.closest('.sidebar-submenu .menu-item a');
            if (subLink && sidebarEl.contains(subLink)) {
                const group = subLink.closest('.sidebar-group');
                const groupId = group?.dataset?.sidebarGroupId || '';
                // Lưu ý: nếu group đang đóng, click vào link vẫn nên mở group đó visually TRƯỚC KHI navigate
                // (giúp user thấy được item active đang chọn). Tuy nhiên vì navigate ngay lập tức, ta chỉ cần
                // set storage — page mới sẽ restore đúng nhờ logic dưới.
                if (group && !group.classList.contains('is-open')) {
                    openOnlySidebarGroup(group);
                }
                setStoredOpenGroupId(groupId);
                return;
            }

            // Click vào link menu-item cấp cao (NGOÀI submenu) — giữ nguyên group đang mở,
            // không xóa storage. Trang mới load sẽ restore đúng group theo logic dưới.
            const topLink = e.target.closest('.sidebar-menu > li.menu-item > a');
            if (topLink && sidebarEl.contains(topLink)) {
                return;
            }
        });
    }

    // Khi load trang: ưu tiên theo thứ tự
    // 1. Nếu có menu-item.active → mở group chứa nó (chắc chắn đúng vì server render currentPage)
    // 2. Server-rendered aria-expanded="true" → mở đúng group đó
    // 3. Nếu không có active item → restore từ storage
    const activeSidebarItem = document.querySelector('.sidebar .menu-item.active');
    const activeSidebarGroup = activeSidebarItem?.closest('.sidebar-group');
    if (activeSidebarGroup) {
        // Có item active → mở group đó (server đã render đúng currentPage)
        openOnlySidebarGroup(activeSidebarGroup);
        const groupId = activeSidebarGroup.dataset.sidebarGroupId || '';
        setStoredOpenGroupId(groupId);
    } else {
        // Item active không thuộc group nào (vd: FB Comment Crawler đứng độc lập)
        // → giữ nguyên group đang mở trước đó từ localStorage
        const storedId = getStoredOpenGroupId();
        if (storedId) {
            const group = document.querySelector(`.sidebar-group[data-sidebar-group-id="${storedId}"]`);
            if (group) {
                openOnlySidebarGroup(group);
            } else {
                openOnlySidebarGroup(null);
            }
        } else {
            // Không có gì trong storage → check aria-expanded do server set
            const serverOpened = document.querySelector('.sidebar-group[aria-expanded="true"]');
            if (serverOpened) {
                openOnlySidebarGroup(serverOpened);
                setStoredOpenGroupId(serverOpened.dataset.sidebarGroupId || '');
            } else {
                openOnlySidebarGroup(null);
            }
        }
    }

    updateMenuToggleVisibility();
    window.addEventListener('resize', updateMenuToggleVisibility);

    // === THEME TOGGLE (Light/Dark) ===
    const themeToggle = document.getElementById('themeToggle');
    const root = document.documentElement;
    // Load saved theme
    try {
        const savedTheme = localStorage.getItem('app-theme');
        if (savedTheme === 'dark') {
            root.classList.add('dark-mode');
        } else if (savedTheme === 'light') {
            root.classList.add('light-mode');
        }
    } catch (e) { /* ignore */ }
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = root.classList.contains('dark-mode');
            if (isDark) {
                root.classList.remove('dark-mode');
                root.classList.add('light-mode');
                try { localStorage.setItem('app-theme', 'light'); } catch (e) {}
                if (typeof showToast === 'function') showToast('Chuyển sang Light mode', 'success');
            } else {
                root.classList.remove('light-mode');
                root.classList.add('dark-mode');
                try { localStorage.setItem('app-theme', 'dark'); } catch (e) {}
                if (typeof showToast === 'function') showToast('Switched to Dark mode', 'success');
            }
        });
    }

    // === LANGUAGE SWITCHER ===
    const langSwitcher = document.getElementById('languageSwitcher');
    const langSwitcherBtn = document.getElementById('languageSwitcherBtn');
    if (langSwitcher && langSwitcherBtn) {
        langSwitcherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            langSwitcher.classList.toggle('is-open');
        });
        document.addEventListener('click', (e) => {
            if (!langSwitcher.contains(e.target)) {
                langSwitcher.classList.remove('is-open');
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                langSwitcher.classList.remove('is-open');
            }
        });
        // Current active language — read from the server-rendered data-lang on the nav element
        const getCurrentLang = () => {
            const nav = document.querySelector('.top-nav[data-lang]');
            if (nav) return nav.dataset.lang;
            const active = langSwitcher.querySelector('.language-option.is-active');
            return active?.dataset.lang || 'vi';
        };

        // Click on language option — save then hard-reload immediately
        langSwitcher.querySelectorAll('.language-option').forEach((opt) => {
            opt.addEventListener('click', async () => {
                const lang = opt.dataset.lang;
                if (!lang) return;

                // No-op if already on this language
                if (lang === getCurrentLang()) {
                    langSwitcher.classList.remove('is-open');
                    return;
                }

                langSwitcher.classList.add('is-loading');
                langSwitcher.classList.remove('is-open');

                try {
                    const res = await fetch('/auth/api/language', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ language: lang })
                    });
                    const data = await res.json();
                    if (data && data.success) {
                        // Reload immediately — server will render everything in the new language
                        window.location.reload();
                    } else {
                        if (typeof showToast === 'function') {
                            showToast((data && data.message) || 'Update failed', 'error');
                        }
                        langSwitcher.classList.remove('is-loading');
                    }
                } catch (err) {
                    if (typeof showToast === 'function') {
                        showToast('Network error', 'error');
                    }
                    langSwitcher.classList.remove('is-loading');
                }
            });
        });
    }

    // === AVATAR DROPDOWN ===
    const avatarBtn = document.getElementById('avatarBtn');
    const profileDropdown = document.getElementById('profileDropdown');

    if (avatarBtn) {
        avatarBtn.addEventListener('click', () => {
            if (profileDropdown) {
                const isOpen = profileDropdown.classList.toggle('show');
                avatarBtn.setAttribute('aria-expanded', String(isOpen));
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (profileDropdown && avatarBtn && !avatarBtn.contains(e.target) && !profileDropdown.contains(e.target)) {
            profileDropdown.classList.remove('show');
            avatarBtn.setAttribute('aria-expanded', 'false');
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Close profile dropdown
            if (profileDropdown && profileDropdown.classList.contains('show')) {
                profileDropdown.classList.remove('show');
                avatarBtn?.setAttribute('aria-expanded', 'false');
            }
            // Close modals
            document.querySelectorAll('.modal-popup.open').forEach(m => m.classList.remove('open'));
            return;
        }

        // Skip shortcuts when in form inputs
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        // Ctrl+K or / : Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            document.querySelector('.search-box input, .search-input, #tableSearchInput, #scheduleSearchInput')?.focus();
            return;
        }

        // N: New / Open modal (on pages that have it)
        if (e.key === 'n' || e.key === 'N') {
            document.getElementById('btnOpenProductModal')?.click();
        }
    });
});