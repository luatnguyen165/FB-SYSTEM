/* ===================================
   TRACKING.JS - Theo dõi đối tượng
   =================================== */

document.addEventListener('DOMContentLoaded', function () {
    // ---- Elements ----
    const modal = document.getElementById('trackingModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('trackingForm');
    const submitBtn = document.getElementById('modalSubmitBtn');
    const trackingIdInput = document.getElementById('trackingId');
    const nameInput = document.getElementById('trackingName');
    const urlInput = document.getElementById('trackingUrl');
    const sourceAccountSelect = document.getElementById('sourceAccountId');
    const cookiesFile = document.getElementById('cookiesFile');
    const cookiesPathInput = document.getElementById('cookiesPath');
    const cookiesGroup = document.getElementById('cookiesUploadGroup'); // may be null

    // ---- Open modal: Add ----
    document.querySelectorAll('#btnAddTracking, #btnAddTrackingEmpty').forEach(function (btn) {
        if (btn) btn.addEventListener('click', function () {
            openAddModal();
        });
    });

    // ---- Platform tabs ----
    document.querySelectorAll('.tracking-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            const platform = this.dataset.platform;
            const type = document.getElementById('trackingType')?.value || 'profile';
            window.location.href = '/tracking?type=' + type + '&platform=' + platform;
        });
    });

    // ---- Radio platform toggle (show/hide cookies + filter source accounts) ----
    document.querySelectorAll('input[name="sourcePlatform"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
            if (cookiesGroup) cookiesGroup.style.display = this.value === 'tiktok' ? 'block' : 'none';

            // Filter source account options by selected platform
            var platformCode = platformToChannelCode(this.value);
            var accountSelect = document.getElementById('sourceAccountId');
            var srcOpts = accountSelect.querySelectorAll('option');
            srcOpts.forEach(function(opt) {
                if (opt.value === '') return;
                opt.style.display = opt.getAttribute('data-platform') === platformCode ? '' : 'none';
            });
            if (accountSelect.selectedOptions[0] && accountSelect.selectedOptions[0].style.display === 'none') {
                accountSelect.value = '';
            }
        });
    });

    // ---- Submit form ----
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const isEdit = !!trackingIdInput.value;
        const url = isEdit ? '/tracking/api/update/' + trackingIdInput.value : '/tracking/api/create';
        const method = isEdit ? 'PUT' : 'POST';

                // Collect target platforms from chip row + account grid
        const targetPlatforms = [];
        const activeChips = document.querySelectorAll('.platform-chip-new.active:not(.disabled)');
        const checkedAccounts = document.querySelectorAll('#accountGrid .account-item input[type="checkbox"]:checked');
        for (const chip of activeChips) {
            const platform = chip.dataset.platform;
            const platformAccounts = [];
            for (const cb of checkedAccounts) {
                if (cb.dataset.platform === platform) {
                    platformAccounts.push(cb);
                }
            }
            // Nếu platform được chọn nhưng không có account nào được check, bỏ qua
            if (platformAccounts.length === 0) continue;
            for (const accountCb of platformAccounts) {
                targetPlatforms.push({
                    platform: platform.toLowerCase(),
                    accountId: accountCb.value,
                    enabled: true,
                    mapping: {
                        title: '',
                        caption: '{{text}}',
                        hashtags: [],
                        tags: []
                    }
                });
            }
        }

        const body = {
            name: nameInput.value.trim(),
            url: urlInput.value.trim(),
            type: document.querySelector('input[name="trackingTypeRadio"]:checked')?.value || document.getElementById('trackingType')?.value || 'profile',
            sourcePlatform: document.querySelector('input[name="sourcePlatform"]:checked')?.value || 'facebook',
            sourceAccountId: sourceAccountSelect?.value || '',
            targetPlatforms: JSON.stringify(targetPlatforms),
            cookiesPath: cookiesPathInput?.value || '',
            repostPaused: document.getElementById('repostPaused')?.checked ? true : false
        };

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...';

        try {
            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();

            if (data.success) {
                closeModal();
                showToast('success', data.message);
                // Reload after short delay
                setTimeout(function () { location.reload(); }, 800);
            } else {
                showToast('error', data.message || 'Có lỗi xảy ra');
            }
        } catch (err) {
            showToast('error', 'Lỗi kết nối: ' + err.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = isEdit ? '<i class="fa-solid fa-check"></i> Cập nhật' : '<i class="fa-solid fa-plus"></i> Thêm';
        }
    });

    // ---- File upload ----
    if (cookiesFile) {
        cookiesFile.addEventListener('change', function () {
            if (this.files && this.files[0]) {
                const formData = new FormData();
                formData.append('file', this.files[0]);
                fetch('/tracking/api/upload-cookies', {
                    method: 'POST',
                    body: formData
                })
                .then(function (res) { return res.json(); })
                .then(function (data) {
                    if (data.success) {
                        cookiesPathInput.value = data.path;
                        showToast('success', 'Upload cookies thành công!');
                    } else {
                        showToast('error', data.message || 'Upload thất bại');
                    }
                })
                .catch(function (err) {
                    showToast('error', 'Lỗi upload: ' + err.message);
                });
            }
        });
    }
});

// ---- Platform name to Channel code mapping ----
function platformToChannelCode(platformName) {
    var map = {
        'facebook': 'FB',
        'tiktok': 'TT',
        'instagram': 'IG',
        'youtube': 'YT',
        'pinterest': 'PI',
        'threads': 'TH'
    };
    return map[platformName] || platformName.toUpperCase();
}

// ---- Parse CSV for hashtags/tags ----
function parseHashtagCsv(input) {
    if (!input) return [];
    return String(input)
        .split(/[,\n]/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean)
        .map(function (s) { return s.startsWith('#') ? s : '#' + s; });
}

function parseCsv(input) {
    if (!input) return [];
    return String(input)
        .split(/[,\n]/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
}

// ---- Functions ----

function openAddModal() {
    document.getElementById('modalTitle').textContent = 'Thêm Đối Tượng Theo Dõi';
    document.getElementById('trackingId').value = '';
    document.getElementById('trackingForm').reset();
    document.getElementById('modalSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Thêm';
    // Reset chips và account grid
    document.querySelectorAll('.platform-chip-new').forEach(function(el) {
        el.classList.remove('active');
    });
    var grid = document.getElementById('accountGrid');
    if (grid) { grid.innerHTML = ''; grid.style.display = 'none'; }
    var cookiesGroup = document.getElementById('cookiesUploadGroup');
    if (cookiesGroup) cookiesGroup.style.display = 'none';
    document.getElementById('trackingModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('trackingModal').style.display = 'none';
}

// ---- Edit ----
function editTracking(id) {
    fetch('/tracking/api/list')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (!data.success) { showToast('error', 'Không thể tải dữ liệu'); return; }
            var item = data.data.find(function (t) { return t._id === id; });
            if (!item) { showToast('error', 'Không tìm thấy'); return; }

            document.getElementById('modalTitle').textContent = 'Sửa Đối Tượng Theo Dõi';
            document.getElementById('trackingId').value = id;
            document.getElementById('trackingName').value = item.name;
            document.getElementById('trackingUrl').value = item.url;

            // Set radio
            var radio = document.querySelector('input[name="sourcePlatform"][value="' + item.sourcePlatform + '"]');
            if (radio) radio.checked = true;
            var cg = document.getElementById('cookiesUploadGroup');
            if (cg) cg.style.display = item.sourcePlatform === 'tiktok' ? 'block' : 'none';

            // Set source account
            if (item.sourceAccountId) {
                document.getElementById('sourceAccountId').value = item.sourceAccountId._id || item.sourceAccountId;
            }

                        // Set target platforms - activate chips + populate grid + check accounts
            if (item.targetPlatforms && item.targetPlatforms.length > 0) {
                // First reset all
                document.querySelectorAll('.platform-chip-new').forEach(el => el.classList.remove('active'));

                // Collect unique platforms
                const uniquePlatforms = [...new Set(item.targetPlatforms.map(tp => tp.platform.toUpperCase()))];

                // Activate chips
                uniquePlatforms.forEach(code => {
                    const chip = document.querySelector('.platform-chip-new[data-platform="' + code + '"]');
                    if (chip) chip.classList.add('active');
                });

                // Render account grid with current selection
                renderAccountGrid();

                // Then check the saved accounts
                item.targetPlatforms.forEach(tp => {
                    const accountId = String(tp.accountId._id || tp.accountId);
                    const cb = document.querySelector('#accountGrid .account-item input[type="checkbox"][value="' + accountId + '"]');
                    if (cb) cb.checked = true;
                });
            }

            // Set repostPaused
            var pausedCb = document.getElementById('repostPaused');
            if (pausedCb) pausedCb.checked = !!item.repostPaused;

            document.getElementById('modalSubmitBtn').innerHTML = '<i class="fa-solid fa-check"></i> Cập nhật';
            document.getElementById('trackingModal').style.display = 'flex';
        })
        .catch(function (err) {
            showToast('error', 'Lỗi: ' + err.message);
        });
}

// ---- Delete ----
function deleteTracking(id) {
    if (!confirm('Xóa đối tượng theo dõi này?')) return;
    fetch('/tracking/api/delete/' + id, { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                showToast('success', data.message);
                setTimeout(function () { location.reload(); }, 800);
            } else {
                showToast('error', data.message);
            }
        })
        .catch(function (err) {
            showToast('error', 'Lỗi: ' + err.message);
        });
}

// ---- Toggle ----
function toggleTracking(id) {
    fetch('/tracking/api/toggle/' + id, { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                showToast('success', data.message);
                setTimeout(function () { location.reload(); }, 500);
            } else {
                showToast('error', data.message);
            }
        })
        .catch(function (err) {
            showToast('error', 'Lỗi: ' + err.message);
        });
}

// ---- Load channel accounts for target platform ----
function loadChannelOptions(select, platform, callback) {
    var code = platformToChannelCode(platform);
    select.innerHTML = '<option value="">Đang tải...</option>';
    fetch('/tracking/api/channels?platform=' + code)
        .then(function (r) { return r.json(); })
        .then(function (data) {
            select.innerHTML = '<option value="">-- Chọn tài khoản --</option>';
            if (data.success && data.data) {
                data.data.forEach(function (ch) {
                    var opt = document.createElement('option');
                    opt.value = ch._id;
                    opt.textContent = ch.accountName + ' (' + (ch.accountType || '') + ')';
                    select.appendChild(opt);
                });
            }
            if (typeof callback === 'function') callback();
        })
        .catch(function () {
            select.innerHTML = '<option value="">Lỗi tải</option>';
        });
}


// ---- Chip click handler + Account Grid render ----
function initPlatformChips() {
    document.querySelectorAll('.platform-chip-new:not(.disabled)').forEach(function(chip) {
        chip.addEventListener('click', function() {
            this.classList.toggle('active');
            renderAccountGrid();
        });
    });
}

function renderAccountGrid() {
    var grid = document.getElementById('accountGrid');
    if (!grid) return;
    var accounts = window.__platformAccounts || {};
    var activePlatforms = [];
    document.querySelectorAll('.platform-chip-new.active').forEach(function(chip) {
        activePlatforms.push(chip.dataset.platform);
    });

    if (activePlatforms.length === 0) {
        grid.innerHTML = '';
        grid.style.display = 'none';
        return;
    }

    grid.style.display = 'grid';
    var html = '';
    var platformIcons = {
        FB: 'fa-brands fa-facebook', IG: 'fa-brands fa-instagram',
        TT: 'fa-brands fa-tiktok', YT: 'fa-brands fa-youtube',
        PI: 'fa-brands fa-pinterest', TH: 'fa-brands fa-threads'
    };
    var platformColors = {
        FB: '#1877F2', IG: '#E4405F', TT: '#000000',
        YT: '#FF0000', PI: '#E60023', TH: '#000000'
    };
    var typeClassMap = {
        'Fanpage': 'fanpage', 'Creator': 'creator', 'Cá nhân': 'personal'
    };

    activePlatforms.forEach(function(code) {
        var platformAccounts = accounts[code] || [];
        if (platformAccounts.length === 0) return;
        platformAccounts.forEach(function(ch) {
            var typeClass = typeClassMap[ch.accountType] || 'personal';
            html += '<label class="account-item">';
            html += '<input type="checkbox" value="' + ch._id + '" data-platform="' + code + '">';
            html += '<i class="' + (platformIcons[code] || 'fa-solid fa-globe') + '" style="color:' + (platformColors[code] || '#666') + ';font-size:0.9rem;"></i>';
            html += '<div class="account-item-info">';
            html += '<span class="account-item-name">' + escapeHtml(ch.accountName) + '</span>';
            html += '<span class="account-type-pill account-type-pill--' + typeClass + '">' + (ch.accountType || 'Cá nhân') + '</span>';
            html += '</div></label>';
        });
    });

    grid.innerHTML = html || '<div style="grid-column:1/-1;padding:16px;text-align:center;color:var(--text-muted);font-size:13px;">Không có tài khoản nào cho nền tảng đã chọn</div>';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Init chips when modal opens
document.addEventListener('click', function(e) {
    var chip = e.target.closest('.platform-chip-new:not(.disabled)');
    if (chip) {
        chip.classList.toggle('active');
        renderAccountGrid();
    }
});
// ---- Toast notification ----
function showToast(type, message) {
    // Remove existing toasts
    document.querySelectorAll('.tracking-toast').forEach(function (el) { el.remove(); });

    var toast = document.createElement('div');
    toast.className = 'tracking-toast tracking-toast-' + type;
    toast.innerHTML = '<i class="fa-solid ' + (type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle') + '"></i> ' + message;
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:14px 22px;border-radius:10px;font-weight:600;font-size:0.9rem;z-index:9999;display:flex;align-items:center;gap:10px;box-shadow:0 8px 24px rgba(0,0,0,0.15);animation:fadeInUp 0.3s;max-width:420px;';
    toast.style.background = type === 'success' ? '#10b981' : '#ef4444';
    toast.style.color = '#fff';
    document.body.appendChild(toast);
    setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(function () { toast.remove(); }, 300);
    }, 3500);
}

// Inject fadeInUp keyframes
var styleSheet = document.createElement('style');
styleSheet.textContent = '@keyframes fadeInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }';
document.head.appendChild(styleSheet);

// Close modal on overlay click
document.addEventListener('click', function (e) {
    var modal = document.getElementById('trackingModal');
    if (e.target === modal) closeModal();
});