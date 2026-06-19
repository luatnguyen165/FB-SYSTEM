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

    // ---- Target platform checkbox toggle ----
    document.querySelectorAll('.target-cb').forEach(function (cb) {
        cb.addEventListener('change', function () {
            const row = this.closest('.target-platform-row');
            const select = row.querySelector('.target-account-select');
            select.disabled = !this.checked;
            if (this.checked && select.options.length <= 1) {
                loadChannelOptions(select, this.value);
            }
        });
    });

    // ---- Submit form ----
    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        const isEdit = !!trackingIdInput.value;
        const url = isEdit ? '/tracking/api/update/' + trackingIdInput.value : '/tracking/api/create';
        const method = isEdit ? 'PUT' : 'POST';

        // Collect target platforms
        const targetPlatforms = [];
        document.querySelectorAll('.target-cb:checked').forEach(function (cb) {
            const row = cb.closest('.target-platform-row');
            const select = row.querySelector('.target-account-select');
            const accountId = select.value;
            if (accountId) {
                targetPlatforms.push({ platform: cb.value, accountId: accountId });
            }
        });

        const body = {
            name: nameInput.value.trim(),
            url: urlInput.value.trim(),
            type: document.querySelector('input[name="trackingTypeRadio"]:checked')?.value || document.getElementById('trackingType')?.value || 'profile',
            sourcePlatform: document.querySelector('input[name="sourcePlatform"]:checked')?.value || 'facebook',
            sourceAccountId: sourceAccountSelect?.value || '',
            targetPlatforms: JSON.stringify(targetPlatforms),
            cookiesPath: cookiesPathInput?.value || ''
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

// ---- Functions ----

function openAddModal() {
    document.getElementById('modalTitle').textContent = 'Thêm Đối Tượng Theo Dõi';
    document.getElementById('trackingId').value = '';
    document.getElementById('trackingForm').reset();
    document.getElementById('modalSubmitBtn').innerHTML = '<i class="fa-solid fa-plus"></i> Thêm';
    // Reset target selects
    document.querySelectorAll('.target-account-select').forEach(function (sel) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">Chọn tài khoản</option>';
    });
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

            // Set target platforms
            if (item.targetPlatforms && item.targetPlatforms.length > 0) {
                item.targetPlatforms.forEach(function (tp) {
                    var cb = document.querySelector('.target-cb[value="' + tp.platform + '"]');
                    if (cb) {
                        cb.checked = true;
                        var row = cb.closest('.target-platform-row');
                        var select = row.querySelector('.target-account-select');
                        select.disabled = false;
                        // Load accounts then set
                        loadChannelOptions(select, tp.platform, function () {
                            select.value = tp.accountId._id || tp.accountId;
                        });
                    }
                });
            }

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