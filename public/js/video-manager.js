/* ===================================
   VIDEO-MANAGER.JS - Kho Video
   Kết nối API backend
   =================================== */

let schedulePlatformCache = 'FB';
let affiliateLinksCache = [];

/* --- Date/Time helper functions --- */
function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatVMDdMmYyyy(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return '';
    return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function parseVMDdMmYyyyToIso(dateText, timeText = '09:00') {
    if (!dateText) return '';
    const parts = String(dateText).trim().split('/');
    if (parts.length !== 3) return '';
    const [day, month, year] = parts.map(Number);
    if (!day || !month || !year) return '';
    const [hours = '09', minutes = '00'] = String(timeText || '09:00').split(':');
    const normalized = new Date(year, month - 1, day, Number(hours), Number(minutes), 0, 0);
    if (Number.isNaN(normalized.getTime())) return '';
    return normalized.toISOString();
}

function toVMDateTimeLocalValue(dateValue) {
    if (!dateValue) return '';
    const d = new Date(dateValue);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function autoFormatVMDateInput(inputEl) {
    if (!inputEl) return;
    inputEl.addEventListener('input', (e) => {
        let val = e.target.value.replace(/[^\d/]/g, '');
        // Auto-insert slashes
        const digits = val.replace(/\//g, '');
        if (digits.length >= 2 && val.length <= 2) {
            val = digits.substring(0, 2) + '/';
        } else if (digits.length >= 4 && val.length <= 5) {
            val = digits.substring(0, 2) + '/' + digits.substring(2, 4) + '/';
        } else if (digits.length > 4) {
            val = digits.substring(0, 2) + '/' + digits.substring(2, 4) + '/' + digits.substring(4, 8);
        }
        e.target.value = val;
    });
}

function syncVMDateTimeHidden() {
    const dateInput = document.getElementById('postDateInput');
    const timeInput = document.getElementById('postTimeInput');
    const hiddenInput = document.getElementById('postDateTime');
    if (!hiddenInput) return;
    hiddenInput.value = parseVMDdMmYyyyToIso(dateInput?.value || '', timeInput?.value || '09:00');
}

document.addEventListener('DOMContentLoaded', () => {
    // Auto-format date input to dd/mm/yyyy
    autoFormatVMDateInput(document.getElementById('postDateInput'));
    document.getElementById('postDateInput')?.addEventListener('input', syncVMDateTimeHidden);
    document.getElementById('postTimeInput')?.addEventListener('change', syncVMDateTimeHidden);
    // Upload video
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());
        dropZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInput.click();
            }
        });
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover')); 
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) uploadFiles(e.target.files);
        });
    }

    // Schedule modal
    document.getElementById('btnCancelSchedule')?.addEventListener('click', closeScheduleModal);
    document.getElementById('btnCancelScheduleAlt')?.addEventListener('click', closeScheduleModal);
    document.getElementById('btnConfirmSchedule')?.addEventListener('click', confirmSchedule);

    // Close schedule modal on backdrop click
    document.getElementById('scheduleModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'scheduleModal') closeScheduleModal();
    });

    // Preview modal
    document.getElementById('videoModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'videoModal') closePreviewModal();
    });

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('videoModal');
        if (e.key === 'Escape' && modal?.classList.contains('open')) {
            closePreviewModal();
        }
    });

    // CSP-safe bindings for existing video page controls
    document.querySelectorAll('[data-status-filter]').forEach(btn => {
        btn.addEventListener('click', () => filterStatus(btn.dataset.statusFilter, btn));
    });

    document.getElementById('searchInput')?.addEventListener('input', searchVideos);
    document.getElementById('btnBulkDelete')?.addEventListener('click', deleteSelected);

    document.getElementById('videoGrid')?.addEventListener('click', (e) => {
        const preview = e.target.closest('.video-preview');
        if (preview) {
            openPreviewModal(preview);
            return;
        }

        const scheduleBtn = e.target.closest('.btn-trigger-schedule');
        if (scheduleBtn) {
            const cardId = scheduleBtn.dataset.cardId;
            const videoTitle = scheduleBtn.dataset.videoTitle;
            openScheduleModal(cardId, videoTitle);
            return;
        }
    });

    document.getElementById('videoGrid')?.addEventListener('change', (e) => {
        if (e.target.matches('.card-checkbox')) checkSelection();
    });

    document.getElementById('btnPrevVideoPage')?.addEventListener('click', () => changeVideoPage(-1));
    document.getElementById('btnNextVideoPage')?.addEventListener('click', () => changeVideoPage(1));

    // Platform tabs in schedule modal
    document.getElementById('schedulePlatformTabs')?.addEventListener('click', (e) => {
        const tab = e.target.closest('.platform-tab');
        if (!tab) return;
        document.querySelectorAll('#schedulePlatformTabs .platform-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        schedulePlatformCache = tab.dataset.platform;
        // Hide affiliate for TikTok
        const affSection = document.getElementById('affiliateLinkSection');
        if (affSection) affSection.style.display = schedulePlatformCache === 'TT' ? 'none' : '';
        // Re-render accounts for this platform
        renderVideoScheduleAccounts(getSelectedAccountIds(), schedulePlatformCache);
    });

    // Affiliate search + checkbox listeners (delegated)
    document.getElementById('affiliateSearchInput')?.addEventListener('input', (e) => {
        const currSelected = getAffiliateSelectedIds();
        renderAffiliateList(e.target.value, currSelected);
    });

    document.getElementById('affiliateListBox')?.addEventListener('change', (e) => {
        if (e.target.matches('.affiliate-checkbox')) {
            updateAffiliateTags();
        }
    });

    // Load videos từ DB
    loadScheduleChannels();
    loadVideos();
    loadAffiliateLinks();
});

const VIDEO_PAGE_SIZE = 8;
let allVideosCache = [];
let currentVideoPage = 1;
let scheduleChannelsCache = [];

// === UPLOAD ===
async function uploadFiles(files) {
    const formData = new FormData();
    for (const file of files) {
        formData.append('videos', file);
    }
    try {
        const res = await fetch('/videos/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            loadVideos();
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        console.error('Upload error:', err);
        showToast('Lỗi kết nối server', 'error');
    }
}

// === LOAD VIDEOS ===
async function loadVideos(status = 'all', search = '') {
    try {
        const res = await fetch(`/videos/api/list?status=${status}&search=${encodeURIComponent(search)}`);
        const data = await res.json();
        if (data.success) {
            allVideosCache = data.videos || [];
            currentVideoPage = 1;
            renderVideoGrid();
            updateCounts(data.videos);
        }
    } catch (err) {
        console.error('Load videos error:', err);
    }
}

async function loadScheduleChannels() {
    try {
        const res = await fetch('/channels/api/list');
        const data = await res.json();
        scheduleChannelsCache = data.success ? (data.channels || []) : [];

        if (allVideosCache.length > 0) {
            renderVideoGrid();
        }
    } catch (err) {
        console.error('Load schedule channels error:', err);
        scheduleChannelsCache = [];
    }
}

async function loadAffiliateLinks() {
    try {
        const res = await fetch('/shopee/api/list?search=&status=ALL&platform=ALL');
        const data = await res.json();
        if (data.success) {
            affiliateLinksCache = data.links || [];
        }
    } catch (err) {
        console.error('Load affiliate links error:', err);
        affiliateLinksCache = [];
    }
}

function renderAffiliateList(searchQuery = '', selectedIds = []) {
    const listBox = document.getElementById('affiliateListBox');
    if (!listBox) return;

    const filtered = searchQuery
        ? affiliateLinksCache.filter(l => l.title.toLowerCase().includes(searchQuery.toLowerCase()))
        : affiliateLinksCache;

    if (filtered.length === 0) {
        listBox.innerHTML = '<div style="padding:8px;color:var(--text-muted);font-size:0.82rem;"><i class="fa-solid fa-circle-info"></i> Không tìm thấy link affiliate nào</div>';
        return;
    }

    const selectedSet = new Set((selectedIds || []).map(id => String(id)));

    listBox.innerHTML = filtered.map(link => {
        const isChecked = selectedSet.has(String(link._id));
        return `
        <label class="affiliate-item">
            <input type="checkbox" class="affiliate-checkbox" value="${link._id}" ${isChecked ? 'checked' : ''}>
            <span class="affiliate-item__icon"><i class="fa-solid fa-link"></i></span>
            <span class="affiliate-item__title">${link.title}</span>
            <span class="affiliate-item__platform" style="color:${link.platform === 'shopee' ? '#ee4d2d' : link.platform === 'tiktok' ? '#161823' : '#2563eb'}">${link.platform}</span>
        </label>
    `}).join('');
}

function getAffiliateSelectedIds() {
    return Array.from(document.querySelectorAll('.affiliate-checkbox:checked')).map(cb => cb.value);
}

function updateAffiliateTags() {
    const tagsContainer = document.getElementById('affiliateSelectedTags');
    if (!tagsContainer) return;
    const selected = Array.from(document.querySelectorAll('.affiliate-checkbox:checked'));
    if (selected.length === 0) {
        tagsContainer.innerHTML = '';
        return;
    }
    const names = selected.map(cb => {
        const title = cb.closest('.affiliate-item')?.querySelector('.affiliate-item__title')?.textContent || '';
        return title;
    });
    tagsContainer.innerHTML = names.map(name =>
        `<span class="affiliate-tag"><i class="fa-solid fa-link"></i> ${name}</span>`
    ).join('');
}

function populateAffiliateSelect(selectedValue = '') {
    // Replaced by multi-select with search
}

function getSelectedAccountIds() {
    return Array.from(document.querySelectorAll('input[name="socialAcc"]:checked')).map(cb => cb.value);
}

function renderVideoGrid() {
    const grid = document.getElementById('videoGrid');
    if (!grid) return;

    const videos = allVideosCache || [];
    const totalPages = Math.max(1, Math.ceil(videos.length / VIDEO_PAGE_SIZE));
    if (currentVideoPage > totalPages) currentVideoPage = totalPages;
    if (currentVideoPage < 1) currentVideoPage = 1;

    const startIndex = (currentVideoPage - 1) * VIDEO_PAGE_SIZE;
    const pageVideos = videos.slice(startIndex, startIndex + VIDEO_PAGE_SIZE);

    updateVideoPagination(totalPages, videos.length);

    if (pageVideos.length === 0) {
        grid.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted); grid-column: 1/-1;"><i class="fa-solid fa-video-slash" style="font-size:2rem;margin-bottom:12px;display:block;"></i>Chưa có video nào trong kho</div>';
        return;
    }

    grid.innerHTML = pageVideos.map(v => {
        const hasSchedule = !!(v.scheduleDate || v.status === 'scheduled');
        const scheduledAtText = v.scheduleDate ? new Date(v.scheduleDate).toLocaleString('vi-VN') : 'Chưa có lịch';
        const selectedChannels = Array.isArray(v.scheduleAccounts)
            ? v.scheduleAccounts
                .map(item => {
                    const raw = String(item || '').trim();
                    const byId = scheduleChannelsCache.find(ch => String(ch._id) === raw);
                    if (byId) return byId;

                    const legacyParts = raw.split(':');
                    if (legacyParts.length >= 2) {
                        return {
                            platform: legacyParts[0].trim(),
                            accountName: legacyParts.slice(1).join(':').trim()
                        };
                    }

                    return null;
                })
                .filter(Boolean)
            : [];
        const selectedPlatformText = selectedChannels.length
            ? selectedChannels.map(ch => `${getPlatformLabel(ch.platform)} · ${ch.accountName}`).join(' • ')
            : 'Chưa chọn tài khoản';

        const scheduleButtonLabel = hasSchedule ? 'Sửa lịch' : 'Lên lịch đăng';

        return `
        <div class="video-card ${hasSchedule ? 'has-schedule' : ''}" data-status="${v.status}" id="vcard-${v._id}">
            <input type="checkbox" class="card-checkbox" data-id="${v._id}">
            <div class="video-preview" data-video-url="${v.filePath}">
                <img
                    class="video-thumbnail-img loaded"
                    src="${v.thumbnailUrl || v.thumbnailPath || 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?q=80&w=400&auto=format&fit=crop'}"
                    alt="${v.title}"
                    loading="lazy"
                >
                <div class="preview-overlay"><div class="play-icon-center"><i class="fa-solid fa-play"></i></div></div>
            </div>
            <div class="video-info">
                <div class="video-title">${v.title}</div>
                <div class="schedule-details-text"><i class="fa-regular fa-clock"></i> ${scheduledAtText}</div>
                <div class="schedule-platforms-text"><i class="fa-solid fa-bullhorn"></i> ${selectedPlatformText}</div>
                <div class="video-meta"><span>${formatFileSize(v.fileSize)}</span><span class="status-tag ${v.status}">${getStatusLabel(v.status)}</span></div>
            </div>
            <div class="card-footer-action">
                <button class="btn-trigger-schedule" data-card-id="${v._id}" data-video-title="${v.title}"><i class="fa-regular fa-calendar-plus"></i> ${scheduleButtonLabel}</button>
            </div>
        </div>
    `;
    }).join('');

    const bulkBar = document.getElementById('bulkBar');
    const selectCount = document.getElementById('selectCount');
    if (bulkBar) bulkBar.classList.remove('active');
    if (selectCount) selectCount.textContent = '0';
}

function formatFileSize(bytes) {
    if (!bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function getStatusLabel(status) {
    const labels = { ready: 'Chưa cấu hình', scheduled: 'Đã lên lịch', posted: 'Đã đăng' };
    return labels[status] || status;
}

function getPlatformLabel(platform) {
    const labels = { FB: 'Facebook', TT: 'TikTok', IG: 'Instagram', YT: 'YouTube' };
    return labels[platform] || platform || 'Kênh';
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function toLocalDateTimeInputValue(date = new Date()) {
    const d = new Date(date);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addMinutes(date, minutes) {
    return new Date(new Date(date).getTime() + minutes * 60 * 1000);
}

function updateCounts(videos) {
    const countAll = document.getElementById('count-all');
    if (countAll) countAll.textContent = videos.length;
}

function updateVideoPagination(totalPages, totalVideos) {
    const pageInfo = document.getElementById('videoPageInfo');
    const prevBtn = document.getElementById('btnPrevVideoPage');
    const nextBtn = document.getElementById('btnNextVideoPage');

    if (pageInfo) pageInfo.textContent = `Trang ${currentVideoPage}/${totalPages}`;
    if (prevBtn) prevBtn.disabled = currentVideoPage <= 1;
    if (nextBtn) nextBtn.disabled = currentVideoPage >= totalPages || totalVideos <= VIDEO_PAGE_SIZE;

    const paginationBar = document.getElementById('videoPaginationBar');
    if (paginationBar) paginationBar.style.display = totalVideos > VIDEO_PAGE_SIZE ? 'flex' : 'none';
}

function changeVideoPage(delta) {
    const totalPages = Math.max(1, Math.ceil((allVideosCache || []).length / VIDEO_PAGE_SIZE));
    const nextPage = currentVideoPage + delta;
    if (nextPage < 1 || nextPage > totalPages) return;
    currentVideoPage = nextPage;
    renderVideoGrid();
}

// === FILTER & SEARCH ===
function filterStatus(status, btn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const search = document.getElementById('searchInput')?.value || '';
    loadVideos(status, search);
}

function searchVideos() {
    const search = document.getElementById('searchInput')?.value || '';
    const activeTab = document.querySelector('.tab-btn.active');
    const status = activeTab ? (activeTab.id === 'tab-all' ? 'all' : activeTab.textContent.toLowerCase().includes('chưa') ? 'ready' : activeTab.textContent.toLowerCase().includes('lên lịch') ? 'scheduled' : 'posted') : 'all';
    loadVideos(status, search);
}

// === SCHEDULE MODAL ===
function openScheduleModal(videoId, title) {
    const modal = document.getElementById('scheduleModal');
    const targetInput = document.getElementById('targetCardId');
    if (modal) modal.classList.add('open');
    if (targetInput) targetInput.value = videoId;

    const existingVideo = (allVideosCache || []).find(v => String(v._id) === String(videoId));

    // Set default time or restore existing schedule
    const dateInputEl = document.getElementById('postDateInput');
    const timeInputEl = document.getElementById('postTimeInput');
    const hiddenDateTime = document.getElementById('postDateTime');
    const captionInput = document.getElementById('postCaption');
    const accountBox = document.getElementById('dynamicAccountBox');

    if (captionInput) captionInput.value = existingVideo?.scheduleCaption || '';

    // Set date/time values
    if (existingVideo?.scheduleDate) {
        const schedDate = new Date(existingVideo.scheduleDate);
        if (dateInputEl) dateInputEl.value = formatVMDdMmYyyy(schedDate);
        if (timeInputEl) timeInputEl.value = `${pad2(schedDate.getHours())}:${pad2(schedDate.getMinutes())}`;
    } else {
        // Default: next hour
        const defaultDate = addMinutes(new Date(), 60);
        if (dateInputEl) dateInputEl.value = formatVMDdMmYyyy(defaultDate);
        if (timeInputEl) timeInputEl.value = `${pad2(defaultDate.getHours())}:${pad2(defaultDate.getMinutes())}`;
    }
    syncVMDateTimeHidden();

    // Set platform tab
    const savedPlatform = existingVideo?.schedulePlatform || 'FB';
    schedulePlatformCache = savedPlatform;
    document.querySelectorAll('#schedulePlatformTabs .platform-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.platform === savedPlatform);
    });

    // Show/hide affiliate for TikTok
    const affSection = document.getElementById('affiliateLinkSection');
    if (affSection) affSection.style.display = savedPlatform === 'TT' ? 'none' : '';

    // Populate affiliate links (multi-select)
    renderAffiliateList('', existingVideo?.affiliateLinkIds || []);
    updateAffiliateTags();

    if (accountBox) {
        accountBox.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Đang tải tài khoản...</div>';
    }

    renderVideoScheduleAccounts(existingVideo?.scheduleAccounts || [], savedPlatform);
}

async function renderVideoScheduleAccounts(selectedIds = [], filterPlatform = '') {
    const boxContainer = document.getElementById('dynamicAccountBox');
    if (!boxContainer) return;

    boxContainer.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Đang tải tài khoản...</div>';

    try {
        const res = await fetch('/channels/api/list');
        const data = await res.json();
        if (!data.success) throw new Error('Không tải được danh sách tài khoản');

        let accounts = data.channels || [];
        
        // Filter by selected platform
        if (filterPlatform) {
            accounts = accounts.filter(acc => acc.platform === filterPlatform);
        }

        // Lọc theo loại tài khoản:
        // Facebook: chỉ hiển thị Fanpage
        // Instagram: chỉ hiển thị Nhà sáng tạo
        if (filterPlatform === 'FB') {
            accounts = accounts.filter(acc => acc.accountType === 'Fanpage');
        } else if (filterPlatform === 'IG') {
            accounts = accounts.filter(acc => acc.accountType === 'Nhà sáng tạo');
        }

        if (!accounts.length) {
            let hint = 'Hãy kết nối ở mục Kênh.';
            if (filterPlatform === 'FB') hint = 'Chỉ hiển thị tài khoản Fanpage. Hãy kết nối Fanpage ở mục Kênh.';
            else if (filterPlatform === 'IG') hint = 'Chỉ hiển thị tài khoản Nhà sáng tạo. Hãy kết nối tài khoản Nhà sáng tạo ở mục Kênh.';
            boxContainer.innerHTML = `<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;"><i class="fa-solid fa-circle-info"></i> Chưa có tài khoản phù hợp. ${hint}</div>`;
            return;
        }

        boxContainer.innerHTML = '';
        const platformIcons = { FB: 'fa-brands fa-facebook', TT: 'fa-brands fa-tiktok', IG: 'fa-brands fa-instagram', YT: 'fa-brands fa-youtube' };
        const platformColors = { FB: '#1877f2', TT: '#000', IG: '#e1306c', YT: '#ff0000' };
        const typeMeta = (accountType = '') => {
            const normalized = String(accountType || '').trim();
            if (normalized === 'Fanpage') return { label: 'Fanpage', className: 'account-type-pill--fanpage', icon: 'fa-solid fa-flag' };
            if (normalized === 'Nhà sáng tạo') return { label: 'Nhà sáng tạo', className: 'account-type-pill--creator', icon: 'fa-solid fa-pen-nib' };
            return { label: 'Cá nhân', className: 'account-type-pill--personal', icon: 'fa-regular fa-user' };
        };
        const selectedId = selectedIds.length > 0 ? String(selectedIds[0]).trim() : '';

        accounts.forEach(acc => {
            const meta = typeMeta(acc.accountType);
            const isSelected = selectedId && selectedId === String(acc._id);
            const label = document.createElement('label');
            label.className = 'acc-pick-item acc-pick-item--single';
            const legacyValue = `${acc.platform}: ${acc.accountName}`;
            label.innerHTML = `
                <input type="radio" name="socialAcc" value="${acc._id}" data-legacy-value="${legacyValue}" ${isSelected ? 'checked' : ''}>
                <i class="${platformIcons[acc.platform] || 'fa-solid fa-circle-user'}" style="color:${platformColors[acc.platform] || 'var(--text-muted)'}"></i>
                <span class="acc-pick-item__content">
                    <span class="acc-pick-item__title">${acc.accountName}</span>
                    <span class="acc-pick-item__meta">
                        <span class="account-type-pill ${meta.className}"><i class="${meta.icon}"></i> ${meta.label}</span>
                    </span>
                </span>`;
            boxContainer.appendChild(label);
        });
    } catch (err) {
        console.error('Load video schedule accounts error:', err);
        boxContainer.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Không tải được tài khoản</div>';
    }
}

function closeScheduleModal() {
    const modal = document.getElementById('scheduleModal');
    if (modal) modal.classList.remove('open');
}

async function confirmSchedule() {
    const videoId = document.getElementById('targetCardId')?.value;
    const caption = document.getElementById('postCaption')?.value || '';
    const dateTime = document.getElementById('postDateTime')?.value;
    const accounts = Array.from(document.querySelectorAll('input[name="socialAcc"]:checked')).map(cb => cb.value);
    const platform = schedulePlatformCache || 'FB';
    const affiliateLinkIds = getAffiliateSelectedIds();

    if (!dateTime) {
        showToast('Vui lòng chọn thời gian đăng!', 'warning');
        return;
    }

    const selectedTime = new Date(dateTime);
    if (Number.isNaN(selectedTime.getTime())) {
        showToast('Thời gian đăng không hợp lệ!', 'warning');
        return;
    }

    if (selectedTime.getTime() < Date.now()) {
        showToast('Không thể lên lịch video trong quá khứ!', 'warning');
        return;
    }

    if (accounts.length === 0) {
        showToast('Vui lòng chọn một tài khoản đăng bài!', 'warning');
        return;
    }

    if (accounts.length > 1) {
        showToast('Chỉ được chọn một tài khoản đăng bài!', 'warning');
        return;
    }

    try {
        const res = await fetch('/videos/api/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videoId, caption, dateTime, accounts, platform, affiliateLinkIds })
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            closeScheduleModal();
            loadVideos();
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}

// === DELETE ===
function checkSelection() {
    const checked = document.querySelectorAll('.card-checkbox:checked');
    const bulkBar = document.getElementById('bulkBar');
    const selectCount = document.getElementById('selectCount');
    if (bulkBar) bulkBar.style.display = checked.length > 0 ? 'flex' : 'none';
    if (selectCount) selectCount.textContent = checked.length;
}

async function deleteSelected() {
    const ids = Array.from(document.querySelectorAll('.card-checkbox:checked')).map(cb => cb.dataset.id);
    if (ids.length === 0) return;
    showConfirm(`Bạn có chắc muốn xóa ${ids.length} video?`, async () => {
        try {
            const res = await fetch('/videos/api/delete-multiple', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                loadVideos();
            }
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
        }
    });
}

// === PREVIEW MODAL ===
function openPreviewModal(el) {
    const url = el?.dataset?.videoUrl;
    const title = el?.dataset?.videoTitle || el?.closest('.video-card')?.querySelector('.video-title')?.textContent || 'Video Preview';
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalPlayer');
    const titleEl = document.getElementById('phoneVideoTitle');
    const infoEl = document.getElementById('phoneVideoInfo');

    if (!modal || !player || !url) return;

    // Reset video state
    player.removeAttribute('poster');
    player.src = url;
    player.load();

    if (titleEl) titleEl.textContent = title;
    if (infoEl) infoEl.style.display = 'flex';

    modal.classList.add('open');

    // Play video after load
    player.play().then(() => {
        // Video started playing
    }).catch(() => {
        // Autoplay blocked, that's ok
    });
}

function closePreviewModal() {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('modalPlayer');
    if (modal) modal.classList.remove('open');
    if (player) {
        player.pause();
        player.src = '';
        player.removeAttribute('poster');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const videoModal = document.getElementById('videoModal');
    if (videoModal) {
        videoModal.addEventListener('click', (e) => {
            if (e.target === videoModal) closePreviewModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && videoModal.classList.contains('open')) {
                closePreviewModal();
            }
        });
    }
});
