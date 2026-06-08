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

    // Sidebar tree dropdowns
    document.querySelectorAll('[data-sidebar-group-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            const group = button.closest('.sidebar-group');
            if (!group) return;

            const willOpen = !group.classList.contains('is-open');
            group.classList.toggle('is-open', willOpen);
            button.setAttribute('aria-expanded', String(willOpen));
        });
    });

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
        // Click on language option
        langSwitcher.querySelectorAll('.language-option').forEach((opt) => {
            opt.addEventListener('click', async () => {
                const lang = opt.dataset.lang;
                if (!lang) return;
                try {
                    // Show loading state
                    langSwitcher.classList.add('is-loading');
                    const res = await fetch('/auth/api/language', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ language: lang })
                    });
                    const data = await res.json();
                    if (data && data.success) {
                        // Show toast
                        if (typeof showToast === 'function') {
                            showToast(lang === 'vi' ? 'Đã chuyển sang Tiếng Việt' : 'Switched to English', 'success');
                        }
                        // Reload page to apply new language
                        setTimeout(() => window.location.reload(), 400);
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
