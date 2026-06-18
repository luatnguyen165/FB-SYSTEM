/* ===================================
   CHANNELS.JS - Quản Lý Kênh Kết Nối
   Kết nối API backend
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
    const pagePlatform = document.querySelector('.btn-platform')?.dataset.platform || 'FB';

    // Platform tab click handlers - navigate to selected platform
    document.querySelectorAll('.platform-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const platform = tab.dataset.platform;
            if (platform) {
                window.location.href = `/channels?platform=${encodeURIComponent(platform)}`;
            }
        });
    });

    document.querySelectorAll('.account-card.is-openable').forEach(card => {
        card.addEventListener('click', (event) => {
            const interactiveTarget = event.target.closest('.account-action-control, button, input, label');
            if (interactiveTarget) return;
            openChannelBrowser(card.dataset.id, card.dataset.platform);
        });

        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const interactiveTarget = event.target.closest('.account-action-control, button, input, label');
            if (interactiveTarget) return;
            event.preventDefault();
            openChannelBrowser(card.dataset.id, card.dataset.platform);
        });
    });

    // btn-connect-hero (hero header), btn-empty-connect (empty state), btn-connect (legacy)
    document.querySelectorAll('.btn-connect-hero, .btn-empty-connect, .btn-connect').forEach(btn => {
        btn.addEventListener('click', () => {
            const platform = btn.dataset.platform || pagePlatform;
            openOAuthModal(platform);
        });
    });

    document.querySelectorAll('.btn-edit-channel').forEach(btn => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            openOAuthModal(btn.dataset.platform || 'FB', {
                id: btn.dataset.id
            });
        });
    });

    document.getElementById('btnCloseOAuthModal')?.addEventListener('click', closeOAuthModal);
    document.getElementById('btnOAuthCancel')?.addEventListener('click', closeOAuthModal);
    document.getElementById('btnOAuthSubmit')?.addEventListener('click', submitNewChannel);

    // Wire up avatar file input → instant image preview
    initAvatarPreview();

    document.querySelectorAll('.switch-toggle input').forEach(toggle => {
        toggle.addEventListener('change', function() {
            const card = this.closest('.account-card');
            const channelId = card?.dataset?.id;
            if (channelId) toggleChannel(channelId);
        });
    });

    document.querySelectorAll('.btn-delete-channel').forEach(btn => {
        btn.addEventListener('click', function(event) {
            event.stopPropagation();
            const card = this.closest('.account-card');
            const channelId = card?.dataset?.id;
            if (channelId) deleteChannel(channelId, card);
        });
    });

    // Close modal on backdrop click
    const oauthModal = document.getElementById('oauthModal');
    if (oauthModal) {
        oauthModal.addEventListener('click', (e) => {
            if (e.target === oauthModal) closeOAuthModal();
        });
    }

    // Escape key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && oauthModal?.classList.contains('open')) {
            closeOAuthModal();
        }
    });
});

let currentPlatform = '';
// pagePlatform is also declared inside DOMContentLoaded — use a module-level var here
// to avoid the duplicate declaration error in non-module scripts.
let pagePlatform = document.querySelector('.btn-platform')?.dataset.platform || 'FB';
let isFacebookConnectInProgress = false;
let currentEditingChannelId = '';
let currentEditMode = false;
let currentEditAvatarUrl = '';

const platformConfig = {
    FB: { icon: 'fa-brands fa-facebook', title: 'Kết nối Facebook API', color: '#1877f2' },
    TT: { icon: 'fa-brands fa-tiktok', title: 'Kết nối TikTok API', color: '#000' },
    IG: { icon: 'fa-brands fa-instagram', title: 'Kết nối Instagram API', color: '#e1306c' },
    YT: { icon: 'fa-brands fa-youtube', title: 'Kết nối YouTube API', color: '#ff0000' },
    PI: { icon: 'fa-brands fa-pinterest', title: 'Kết nối Pinterest API', color: '#e60023' },
    TH: { icon: 'fa-brands fa-threads', title: 'Kết nối Threads API', color: '#000' }
};

function openOAuthModal(platform, channelData = null) {
    currentPlatform = platform;
    currentEditMode = Boolean(channelData?.id);
    currentEditingChannelId = channelData?.id || '';
    currentEditAvatarUrl = channelData?.avatarUrl || '';
    const config = platformConfig[platform];
    const modal = document.getElementById('oauthModal');
    const iconBox = document.getElementById('oauthIconBox');
    const titleEl = document.getElementById('oauthTitle');
    const descEl = document.getElementById('oauthDesc');
    const formFields = document.getElementById('oauthFormFields');
    const secondaryField = document.getElementById('oauthSecondaryField');

    // Platform-specific icon color class
    const iconClass = `oauth-icon-box oauth-icon-box--${platform.toLowerCase()}`;
    if (iconBox) {
        iconBox.className = iconClass;
        iconBox.innerHTML = `<i class="${config.icon}"></i>`;
    }
    if (titleEl) titleEl.textContent = currentEditMode ? 'Chỉnh sửa tài khoản' : config.title;
    if (descEl) descEl.textContent = currentEditMode
        ? 'Cập nhật thông tin tài khoản kết nối.'
        : 'Cấp quyền để hệ thống kết nối từng tài khoản riêng biệt.';

    // Ẩn toàn bộ form fields cho tất cả platforms (auto-scrape sau login)
    if (formFields) {
        formFields.style.display = 'none';
    }

    // Reset các field
    const nameInput = document.getElementById('oauthAccountName');
    if (nameInput) nameInput.value = '';
    const profileUrlInput = document.getElementById('oauthProfileUrl');
    if (profileUrlInput) profileUrlInput.value = '';
    // Cập nhật placeholder theo platform (chỉ khi field được show)
    if (profileUrlInput) {
        const platformKey = platform.toLowerCase();
        const platformPlaceholder = profileUrlInput.getAttribute(`data-placeholder-${platformKey}`);
        if (platformPlaceholder) profileUrlInput.placeholder = platformPlaceholder;
    }

    // Reset avatar preview
    const avatarPreviewWrap = document.getElementById('oauthEditAvatarPreviewWrap');
    if (avatarPreviewWrap) avatarPreviewWrap.style.display = 'none';
    const currentAvatarBox = document.getElementById('oauthCurrentAvatarBox');
    if (currentAvatarBox) {
        currentAvatarBox.innerHTML = '<div class="oauth-current-avatar-text" id="oauthCurrentAvatarText">Chưa có avatar</div>';
    }
    const avatarInput = document.getElementById('oauthAvatar');
    if (avatarInput) avatarInput.value = '';
    currentEditAvatarUrl = '';

    if (channelData && platform !== 'FB') {
        if (nameInput) nameInput.value = channelData.accountName || '';
        if (profileUrlInput) profileUrlInput.value = channelData.profileUrl || '';
        const currentAvatarText = document.getElementById('oauthCurrentAvatarText');
        if (currentAvatarText) currentAvatarText.textContent = channelData.avatarUrl ? 'Đã có avatar' : 'Chưa có avatar';
        if (avatarPreviewWrap) avatarPreviewWrap.style.display = 'block';
        if (currentAvatarBox && channelData.avatarUrl) {
            currentAvatarBox.innerHTML = `<img class="oauth-current-avatar-img" src="${channelData.avatarUrl}" alt="Avatar hiện tại"><span class="oauth-current-avatar-text" id="oauthCurrentAvatarText">Avatar hiện tại</span>`;
        }
        currentEditAvatarUrl = channelData.avatarUrl || '';
    }

    // Render account type selector cho các platform cần (không phải FB)
    if (secondaryField) {
        if (platform === 'IG') {
            secondaryField.innerHTML = `
                <div class="oauth-account-type-section">
                    <div class="oauth-account-type-label">Loại tài khoản Instagram</div>
                    <div class="oauth-type-grid" id="oauthTypeGrid">
                        <label class="oauth-type-card" data-type="Cá nhân">
                            <input type="radio" name="oauthAccountType" value="Cá nhân" checked>
                            <div class="oauth-type-icon personal"><i class="fa-regular fa-user"></i></div>
                            <div class="oauth-type-content">
                                <strong>Cá nhân</strong>
                                <span>Tài khoản Instagram cá nhân</span>
                            </div>
                            <div class="oauth-type-check"><i class="fa-solid fa-check"></i></div>
                        </label>
                        <label class="oauth-type-card" data-type="Nhà sáng tạo">
                            <input type="radio" name="oauthAccountType" value="Nhà sáng tạo">
                            <div class="oauth-type-icon creator"><i class="fa-solid fa-pen-nib"></i></div>
                            <div class="oauth-type-content">
                                <strong>Nhà sáng tạo</strong>
                                <span>Dành cho Creator / Người sáng tạo nội dung</span>
                            </div>
                            <div class="oauth-type-check"><i class="fa-solid fa-check"></i></div>
                        </label>
                        <label class="oauth-type-card" data-type="Business">
                            <input type="radio" name="oauthAccountType" value="Business">
                            <div class="oauth-type-icon fanpage"><i class="fa-solid fa-briefcase"></i></div>
                            <div class="oauth-type-content">
                                <strong>Business</strong>
                                <span>Dành cho tài khoản doanh nghiệp</span>
                            </div>
                            <div class="oauth-type-check"><i class="fa-solid fa-check"></i></div>
                        </label>
                    </div>
                    <div class="oauth-helper-text">
                        <i class="fa-solid fa-circle-info"></i>
                        Chọn đúng loại tài khoản Instagram để hiển thị cấu hình chính xác.
                    </div>
                </div>
            `;
            if (channelData) {
                setTimeout(() => initAccountTypeCards(channelData.accountType || 'Cá nhân'), 0);
            } else {
                setTimeout(() => initAccountTypeCards('Cá nhân'), 0);
            }
        } else if (platform !== 'FB') {
            // TT, YT, PI, TH: mặc định là "Cá nhân"
            secondaryField.innerHTML = `<input type="hidden" name="oauthAccountType" value="Cá nhân">`;
        } else {
            secondaryField.innerHTML = '';
        }
    }

    const submitBtnEl = document.getElementById('btnOAuthSubmit');
    if (submitBtnEl) {
        submitBtnEl.innerHTML = currentEditMode
            ? '<i class="fa-solid fa-floppy-disk"></i> Lưu thay đổi'
            : '<i class="fa-solid fa-link"></i> Ủy quyền kết nối';
    }
    if (modal) modal.classList.add('open');
}



async function connectFacebookDirectly() {
    await submitNewChannel();
}

function closeOAuthModal() {
    const modal = document.getElementById('oauthModal');
    currentEditMode = false;
    currentEditingChannelId = '';
    currentEditAvatarUrl = '';
    if (modal) modal.classList.remove('open');
}

async function submitNewChannel() {
    const platformToSubmit = currentPlatform || pagePlatform || 'FB';
    const submitBtn = document.getElementById('btnOAuthSubmit');

    function setLoading(on) {
        if (!submitBtn) return;
        submitBtn.disabled = on;
        submitBtn.classList.toggle('is-loading', on);
    }

    function validateField(inputEl, message) {
        if (!inputEl?.value?.trim()) {
            inputEl.classList.add('oauth-input--error');
            const cleanup = () => inputEl.classList.remove('oauth-input--error');
            inputEl.addEventListener('input', cleanup, { once: true });
            showToast(message, 'warning');
            return false;
        }
        return true;
    }

    // Tất cả platforms: fields đã ẩn trên UI, auto-generate tên để backend không báo lỗi
    {
        if (isFacebookConnectInProgress) return;

        isFacebookConnectInProgress = true;
        setLoading(true);
        try {
            const autoName = `${currentPlatform}_${Date.now()}`;
            const data = await doSubmitChannel(autoName, '', 'Cá nhân', '0', null);
            if (data.success) {
                showToast(data.message, 'success');
                closeOAuthModal();
                window.location.href = `/channels?platform=${encodeURIComponent(currentPlatform)}`;
            } else {
                showToast('Lỗi: ' + data.message, 'error');
            }
        } catch (err) {
            console.error('[Connect Error]', err);
            showToast('Lỗi kết nối server', 'error');
        } finally {
            isFacebookConnectInProgress = false;
            setLoading(false);
        }
        return;
    }

    // Các platform còn lại: TikTok, Instagram, YouTube, Pinterest, Threads
    const accountNameEl = document.getElementById('oauthAccountName');
    if (!validateField(accountNameEl, 'Vui lòng nhập tên kênh!')) return;

    const accountName = accountNameEl.value.trim();
    const profileUrl = document.getElementById('oauthProfileUrl')?.value?.trim() || '';
    const followers = document.getElementById('oauthFollowers')?.value?.trim();
    const avatarInput = document.getElementById('oauthAvatar');
    const accountType = document.querySelector('input[name="oauthAccountType"]:checked')?.value || 'Cá nhân';

    setLoading(true);
    try {
        const data = await doSubmitChannel(accountName, profileUrl, accountType, followers || '0', avatarInput);
        if (data.success) {
            showToast(data.message, 'success');
            closeOAuthModal();
            window.location.href = `/channels?platform=${encodeURIComponent(currentPlatform)}`;
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    } finally {
        setLoading(false);
    }
}

/**
 * Hàm chung gửi formData lên server để connect hoặc update channel
 */
async function doSubmitChannel(accountName, profileUrl, accountType, followers, avatarInput) {
    const security = window.cryptoVault?.getSecurityConfig
        ? await window.cryptoVault.getSecurityConfig()
        : null;
    const shouldEncrypt = Boolean(security?.dataEncryptionEnabled && security?.publicKey);

    const formData = new FormData();
    formData.append('accountName', accountName);
    formData.append('accountType', accountType);
    formData.append('followers', followers || '0');
    if (profileUrl) formData.append('profileUrl', profileUrl);
    if (avatarInput?.files?.[0]) formData.append('avatar', avatarInput.files[0]);

    if (shouldEncrypt && window.cryptoVault?.encryptText) {
        formData.set('accountName', await window.cryptoVault.encryptText(accountName, security.publicKey));
        formData.set('accountType', await window.cryptoVault.encryptText(accountType, security.publicKey));
        formData.set('followers', await window.cryptoVault.encryptText(followers || '0', security.publicKey));
        if (profileUrl) formData.set('profileUrl', await window.cryptoVault.encryptText(profileUrl, security.publicKey));
    }

    const endpoint = currentEditMode && currentEditingChannelId
        ? `/channels/api/${encodeURIComponent(currentEditingChannelId)}/update`
        : `/channels/api/${currentPlatform}/connect`;

    const res = await fetch(endpoint, {
        method: currentEditMode && currentEditingChannelId ? 'PATCH' : 'POST',
        body: formData
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
}

async function toggleChannel(channelId) {
    try {
        const res = await fetch(`/channels/api/${channelId}/toggle`, { method: 'PATCH' });
        const data = await res.json();
        if (!data.success) showToast('Lỗi: ' + data.message, 'error');
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}

async function deleteChannel(channelId, cardEl) {
    showConfirm('Bạn có chắc muốn xóa kênh này?', async () => {
        try {
            const res = await fetch(`/channels/api/${channelId}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                if (cardEl) cardEl.remove();
                showToast('Đã xóa kênh', 'success');
                location.reload();
            } else {
                showToast('Lỗi: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
        }
    });
}

/**
 * Wire up the avatar file input to show an instant preview in #oauthCurrentAvatarBox.
 */
function initAvatarPreview() {
    const avatarInput = document.getElementById('oauthAvatar');
    const previewWrap = document.getElementById('oauthEditAvatarPreviewWrap');
    const previewBox  = document.getElementById('oauthCurrentAvatarBox');
    if (!avatarInput) return;

    avatarInput.addEventListener('change', () => {
        const file = avatarInput.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            if (previewWrap) previewWrap.style.display = 'block';
            if (previewBox) {
                previewBox.innerHTML = `
                    <img class="oauth-current-avatar-img" src="${e.target.result}" alt="Preview avatar">
                    <span class="oauth-current-avatar-text">Ảnh mới chọn</span>
                `;
            }
        };
        reader.readAsDataURL(file);
    });
}

function initAccountTypeCards(defaultType = 'Cá nhân') {
    const grid = document.getElementById('oauthTypeGrid');
    if (!grid) return;
    const updateSelection = () => {
        const checked = grid.querySelector('input[name="oauthAccountType"]:checked');
        grid.querySelectorAll('.oauth-type-card').forEach(card => {
            const radio = card.querySelector('input[type="radio"]');
            card.classList.toggle('is-selected', radio?.checked);
        });
    };

    grid.querySelectorAll('.oauth-type-card').forEach(card => {
        const radio = card.querySelector('input[type="radio"]');
        if (radio) {
            if (radio.value === defaultType) radio.checked = true;
            radio.addEventListener('change', updateSelection);
            card.addEventListener('click', () => {
                radio.checked = true;
                updateSelection();
            });
        }
    });

    updateSelection();
}

async function openChannelBrowser(channelId, platform) {
    if (!channelId) return;

    try {
        const res = await fetch(`/channels/api/${channelId}/open`, {
            method: 'POST'
        });
        const data = await res.json();

        if (data.success) {
            showToast(data.message, 'success');
            return;
        }

        showToast('Lỗi: ' + data.message, 'error');
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}