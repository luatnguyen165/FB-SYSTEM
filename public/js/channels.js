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

    document.querySelectorAll('.btn-connect').forEach(btn => {
        btn.addEventListener('click', () => {
            const platform = btn.dataset.platform || pagePlatform;
            openOAuthModal(platform);
        });
    });

    document.querySelectorAll('.btn-edit-channel').forEach(btn => {
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            openOAuthModal(btn.dataset.platform || 'FB', {
                id: btn.dataset.id,
                accountName: btn.dataset.accountName || '',
                accountType: btn.dataset.accountType || 'Cá nhân',
                profileUrl: btn.dataset.profileUrl || '',
                avatarUrl: btn.dataset.avatarUrl || ''
            });
        });
    });

    document.getElementById('btnCloseOAuthModal')?.addEventListener('click', closeOAuthModal);
    document.getElementById('btnOAuthCancel')?.addEventListener('click', closeOAuthModal);
    document.getElementById('btnOAuthSubmit')?.addEventListener('click', submitNewChannel);

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
let pagePlatform = document.querySelector('.btn-platform')?.dataset.platform || 'FB';
let isFacebookConnectInProgress = false;
let currentEditingChannelId = '';
let currentEditAvatarUrl = '';
let currentEditMode = false;

const platformConfig = {
    FB: { icon: 'fa-brands fa-facebook', title: 'Kết nối Facebook API', color: '#1877f2' },
    TT: { icon: 'fa-brands fa-tiktok', title: 'Kết nối TikTok API', color: '#000' },
    IG: { icon: 'fa-brands fa-instagram', title: 'Kết nối Instagram API', color: '#e1306c' },
    YT: { icon: 'fa-brands fa-youtube', title: 'Kết nối YouTube API', color: '#ff0000' },
    ZO: { icon: 'fa-solid fa-message', title: 'Kết nối Zalo API', color: '#0068ff' }
};

function normalizeFacebookAccountType(value) {
    const type = String(value || '').trim();
    if (type === 'Fanpage') return 'Fanpage';
    if (type === 'Nhà sáng tạo') return 'Nhà sáng tạo';
    return 'Cá nhân';
}

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
    const secondaryField = document.getElementById('oauthSecondaryField');
    const submitBtn = document.getElementById('btnOAuthSubmit');
    const avatarPreviewWrap = document.getElementById('oauthEditAvatarPreviewWrap');
    const currentAvatarText = document.getElementById('oauthCurrentAvatarText');

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

    const submitBtnEl = document.getElementById('btnOAuthSubmit');
    if (submitBtnEl) {
        submitBtnEl.innerHTML = currentEditMode
            ? '<i class="fa-solid fa-floppy-disk"></i> Lưu thay đổi'
            : '<i class="fa-solid fa-link"></i> Ủy quyền kết nối';
    }
    if (modal) modal.classList.add('open');

    const nameInput = document.getElementById('oauthAccountName');
    if (nameInput) nameInput.value = '';
    const profileUrlInput = document.getElementById('oauthProfileUrl');
    const profileUrlFieldWrapper = document.getElementById('profileUrlFieldWrapper');
    if (profileUrlInput) profileUrlInput.value = '';
    // Hiện field profile URL cho FB, TikTok, Instagram, YouTube (trừ Zalo)
    const showProfileUrl = ['FB', 'TT', 'IG', 'YT'].includes(platform);
    if (profileUrlFieldWrapper) profileUrlFieldWrapper.style.display = showProfileUrl ? 'block' : 'none';
    if (profileUrlInput && !showProfileUrl) profileUrlInput.value = '';
    // Cập nhật placeholder theo platform
    if (profileUrlInput) {
        const platformKey = platform.toLowerCase();
        const platformPlaceholder = profileUrlInput.getAttribute(`data-placeholder-${platformKey}`);
        if (platformPlaceholder) profileUrlInput.placeholder = platformPlaceholder;
    }

    // Disable tên tài khoản khi edit (đã tạo profile rồi thì k cho sửa tên)
    if (nameInput) {
        nameInput.disabled = currentEditMode;
        nameInput.classList.toggle('input-disabled-locked', currentEditMode);
        // Xóa hint cũ nếu có
        const existingHint = nameInput.parentNode?.querySelector('.input-lock-hint');
        if (existingHint) existingHint.remove();
        // Thêm hint khi edit mode
        if (currentEditMode) {
            const hint = document.createElement('div');
            hint.className = 'input-lock-hint';
            hint.innerHTML = '<i class="fa-solid fa-lock"></i> Tên tài khoản được lấy từ hồ sơ và không thể thay đổi.';
            nameInput.parentNode?.appendChild(hint);
        }
    }

    if (channelData) {
        if (nameInput) nameInput.value = channelData.accountName || '';
        if (profileUrlInput) profileUrlInput.value = channelData.profileUrl || '';
        if (currentAvatarText) currentAvatarText.textContent = channelData.avatarUrl ? 'Đã có avatar' : 'Chưa có avatar';
        // Hiển thị ảnh avatar hiện tại trong modal edit
        if (avatarPreviewWrap) avatarPreviewWrap.style.display = 'block';
        const currentAvatarBox = document.getElementById('oauthCurrentAvatarBox');
        if (currentAvatarBox && channelData.avatarUrl) {
            currentAvatarBox.innerHTML = `<img class="oauth-current-avatar-img" src="${channelData.avatarUrl}" alt="Avatar hiện tại"><span class="oauth-current-avatar-text" id="oauthCurrentAvatarText">Avatar hiện tại</span>`;
        }
        if (currentPlatform === 'FB') {
            const checkedType = normalizeFacebookAccountType(channelData.accountType || 'Cá nhân');
            setTimeout(() => {
                initAccountTypeCards(checkedType);
            }, 0);
        }
    } else {
        if (avatarPreviewWrap) avatarPreviewWrap.style.display = 'none';
        // Reset avatar preview về trạng thái mặc định
        const currentAvatarBox = document.getElementById('oauthCurrentAvatarBox');
        if (currentAvatarBox) {
            currentAvatarBox.innerHTML = '<div class="oauth-current-avatar-text" id="oauthCurrentAvatarText">Chưa có avatar</div>';
        }
        currentEditAvatarUrl = '';
        if (currentPlatform === 'FB') {
            setTimeout(() => initAccountTypeCards('Cá nhân'), 0);
        }
    }

    if (secondaryField) {
        if (platform === 'FB') {
            // Facebook: Cá nhân / Fanpage / Nhà sáng tạo
            secondaryField.innerHTML = `
                <div class="oauth-account-type-section">
                    <div class="oauth-account-type-label">Loại tài khoản</div>
                    <div class="oauth-type-grid" id="oauthTypeGrid">
                        <label class="oauth-type-card" data-type="Cá nhân">
                            <input type="radio" name="oauthAccountType" value="Cá nhân" checked>
                            <div class="oauth-type-icon personal"><i class="fa-regular fa-user"></i></div>
                            <div class="oauth-type-content">
                                <strong>Tài khoản cá nhân</strong>
                                <span>Dành cho profile Facebook riêng</span>
                            </div>
                            <div class="oauth-type-check"><i class="fa-solid fa-check"></i></div>
                        </label>
                        <label class="oauth-type-card" data-type="Fanpage">
                            <input type="radio" name="oauthAccountType" value="Fanpage">
                            <div class="oauth-type-icon fanpage"><i class="fa-solid fa-flag"></i></div>
                            <div class="oauth-type-content">
                                <strong>Fanpage / Page</strong>
                                <span>Dành cho trang Facebook doanh nghiệp</span>
                            </div>
                            <div class="oauth-type-check"><i class="fa-solid fa-check"></i></div>
                        </label>
                        <label class="oauth-type-card" data-type="Nhà sáng tạo">
                            <input type="radio" name="oauthAccountType" value="Nhà sáng tạo">
                            <div class="oauth-type-icon creator"><i class="fa-solid fa-pen-nib"></i></div>
                            <div class="oauth-type-content">
                                <strong>Nhà sáng tạo</strong>
                                <span>Dành cho tài khoản Facebook Creator</span>
                            </div>
                            <div class="oauth-type-check"><i class="fa-solid fa-check"></i></div>
                        </label>
                    </div>
                    <div class="oauth-helper-text">
                        <i class="fa-solid fa-circle-info"></i>
                        Chọn đúng loại tài khoản để hệ thống lưu cookie và hiển thị cấu hình chính xác.
                    </div>
                </div>
            `;
            initAccountTypeCards('Cá nhân');
        } else if (platform === 'IG') {
            // Instagram: Cá nhân / Nhà sáng tạo / Business
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
            initAccountTypeCards('Cá nhân');
        } else {
            // TikTok, YouTube, Zalo: mặc định là "Cá nhân", chỉ cho nhập followers
            secondaryField.innerHTML = `
                <input type="hidden" name="oauthAccountType" value="Cá nhân">
                <div class="oauth-form-group">
                    <label class="oauth-form-label" for="oauthFollowers">Follower ban đầu (tuỳ chọn)</label>
                    <input type="text" class="oauth-input" id="oauthFollowers" placeholder="Ví dụ: 10000">
                </div>
            `;
        }
    }

    const existingImageField = document.getElementById('oauthAvatar');
    if (existingImageField) existingImageField.value = '';

    // Focus first input
    setTimeout(() => nameInput?.focus(), 100);
}

function initAccountTypeCards(defaultType = 'Cá nhân') {
    const grid = document.getElementById('oauthTypeGrid');
    if (!grid) return;    const updateSelection = () => {
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

    // FB connect đặc biệt vì mở browser thủ công
    if (currentPlatform === 'FB') {
        if (isFacebookConnectInProgress) return;
        const accountNameEl = document.getElementById('oauthAccountName');
        if (!validateField(accountNameEl, 'Vui lòng nhập tên tài khoản Facebook!')) return;

        const profileUrlEl = document.getElementById('oauthProfileUrl');
        if (!validateField(profileUrlEl, 'Vui lòng nhập Link Profile Facebook!')) return;

        // Validate URL format
        const profileUrlValue = profileUrlEl?.value?.trim() || '';
        if (profileUrlValue && !/^https?:\/\/(www\.)?facebook\.com\/.+/.test(profileUrlValue)) {
            profileUrlEl.classList.add('oauth-input--error');
            showToast('Link Profile phải đúng định dạng facebook.com/...', 'warning');
            profileUrlEl.addEventListener('input', () => profileUrlEl.classList.remove('oauth-input--error'), { once: true });
            return;
        }

        const accountName = accountNameEl.value.trim();
        const profileUrl = profileUrlValue;
        const accountType = document.querySelector('input[name="oauthAccountType"]:checked')?.value || 'Cá nhân';
        const avatarInput = document.getElementById('oauthAvatar');

        isFacebookConnectInProgress = true;
        setLoading(true);
        try {
            const data = await doSubmitChannel(accountName, profileUrl || '', accountType, '0', avatarInput);
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

    // Các platform còn lại: TikTok, Instagram, YouTube, Zalo
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