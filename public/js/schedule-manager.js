document.addEventListener('DOMContentLoaded', () => {
    function debounce(fn, delay = 300) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
    const managerDataEl = document.getElementById('scheduleManagerData');
    const managerData = managerDataEl?.textContent ? JSON.parse(managerDataEl.textContent.trim()) : {};
    const searchInput = document.getElementById('scheduleSearchInput');
    const platformFilter = document.getElementById('platformFilter');
    const statusFilter = document.getElementById('statusFilter');
    const rows = Array.from(document.querySelectorAll('.schedule-row'));
    const runButtons = Array.from(document.querySelectorAll('.btn-run-schedule'));
    const deleteButtons = Array.from(document.querySelectorAll('.btn-delete-schedule'));
    const tableBody = document.querySelector('#scheduleManagerTable tbody');
    const paginationEl = document.getElementById('schedulePagination');
    const editModal = document.getElementById('scheduleEditModal');
    const editFields = {
        id: document.getElementById('editScheduleId'),
        videoId: document.getElementById('editScheduleVideoId'),
        sourceChannelId: document.getElementById('editScheduleSourceChannelId'),
        shopeeLinks: document.getElementById('editScheduleShopeeLinks'),
        type: document.getElementById('editScheduleType'),
        status: document.getElementById('editScheduleStatus'),
        caption: document.getElementById('editScheduleCaption'),
        dateTime: document.getElementById('editScheduleDateTime'),
        accounts: document.getElementById('editScheduleAccounts'),
        meta: document.getElementById('editScheduleMeta')
    };
    const btnSaveEdit = document.getElementById('btnSaveScheduleEdit');
    const btnRefreshGroups = document.getElementById('btnRefreshScheduleManagerGroups');
    const summaryFields = {
        type: document.getElementById('scheduleSummaryType'),
        status: document.getElementById('scheduleSummaryStatus'),
        time: document.getElementById('scheduleSummaryTime')
    };

    const PAGE_SIZE = 8;
    let currentPage = 1;
    let filteredRows = [...rows];

    if (statusFilter) {
        statusFilter.value = 'all';
    }

    const PLATFORM_META = {
        FB: { label: 'Facebook', icon: 'fa-brands fa-facebook', color: '#1877f2' },
        IG: { label: 'Instagram', icon: 'fa-brands fa-instagram', color: '#e1306c' },
        TT: { label: 'TikTok Video', icon: 'fa-brands fa-tiktok', color: '#000000' },
        YT: { label: 'YouTube Short', icon: 'fa-brands fa-youtube', color: '#ff0000' },
        FR: { label: 'Facebook Reels', icon: 'fa-brands fa-facebook', color: '#1877f2' },
        TA: { label: 'TikTok Affiliate', icon: 'fa-solid fa-link', color: '#555555' }
    };

    const POST_PLATFORMS = ['FB', 'IG'];
    const REELS_PLATFORMS = ['FR', 'YS', 'IG', 'TT', 'TA'];
    const PLATFORM_TO_CHANNEL = { FR: 'FB', YS: 'YT', IG: 'IG', TT: 'TT', TA: 'TT', FB: 'FB' };

    let currentEditPayload = null;
    let editSelectedPlatform = null;
    let editNewImages = [];
    let editExistingImages = [];
    let editLocalVideoFile = null;
    let editSelectedShopeeLinks = [];
    let editSelectedGroupKeys = [];
    let editFacebookGroups = [];

    function safeText(value = '') {
        return String(value)
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/'/g, '&#39;');
    }

    function formatForDateTimeLocal(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function getPayloadFromRow(row) {
        if (!row) return null;
        try {
            return JSON.parse(decodeURIComponent(row.dataset.row || '{}'));
        } catch (error) {
            return null;
        }
    }

    function renderEditPlatformChips(type, selectedPlatforms = []) {
        const container = document.getElementById('editPlatformChips');
        if (!container) return;

        const platforms = type === 'post' ? POST_PLATFORMS : REELS_PLATFORMS;
        container.innerHTML = platforms.map((code) => {
            const meta = PLATFORM_META[code] || { label: code, icon: 'fa-solid fa-globe', color: '#888' };
            const isActive = selectedPlatforms.includes(code);
            return `<button type="button" class="schedule-platform-chip ${isActive ? 'active' : ''}" data-platform="${code}">
                <i class="${meta.icon}"></i>
                <span>${meta.label}</span>
            </button>`;
        }).join('');

        container.querySelectorAll('.schedule-platform-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                container.querySelectorAll('.schedule-platform-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                editSelectedPlatform = chip.dataset.platform;
                onEditPlatformChange(type);
            });
        });
    }

    function onEditPlatformChange(type) {
        const chip = editSelectedPlatform || (type === 'post' ? 'FB' : 'FB');
        renderEditAccountOptions(type, chip, []);
        if (type === 'post') {
            onEditPostPlatformChange();
        }
    }

    function onEditPostPlatformChange() {
        const isFacebook = editSelectedPlatform === 'FB';
        const groupSection = document.getElementById('editGroupSection');

        if (groupSection) {
            groupSection.classList.toggle('visible', isFacebook);
        }

        if (isFacebook) {
            renderEditFacebookSourceOptions(currentEditPayload?.sourceChannelId || '');
            if (currentEditPayload?.sourceChannelId) {
                setTimeout(() => {
                    loadEditFacebookGroups(currentEditPayload.sourceChannelId, currentEditPayload.targetGroupId || []);
                }, 100);
            }
        } else {
            // Clear groups if not Facebook
            editSelectedGroupKeys = [];
            editFacebookGroups = [];
            renderEditSelectedGroupTags();
            const list = document.getElementById('editGroupComboboxList');
            if (list) list.innerHTML = '';
        }
    }

    function renderEditAccountOptions(type, selectedPlatform = null, selectedAccountIds = []) {
        if (!editFields.accounts) return;
        const channels = Array.isArray(managerData.channels) ? managerData.channels : [];
        let filterPlatforms;
        if (type === 'post') {
            filterPlatforms = ['FB', 'IG'];
        } else {
            filterPlatforms = selectedPlatform ? [PLATFORM_TO_CHANNEL[selectedPlatform] || selectedPlatform] : ['FB'];
        }
        const filtered = channels.filter(ch => filterPlatforms.includes(String(ch.platform || '').trim()));
        editFields.accounts.innerHTML = filtered.map((ch) => {
            const meta = PLATFORM_META[ch.platform] || { label: ch.platform, icon: 'fa-solid fa-user' };
            const badge = ch.accountType ? ` · ${ch.accountType}` : '';
            const sel = selectedAccountIds.includes(String(ch._id)) ? 'selected' : '';
            return `<option value="${ch._id}" ${sel}>${ch.accountName}${badge} [${meta.label}]</option>`;
        }).join('');
        const desc = document.getElementById('editAccountsDesc');
        if (desc) desc.textContent = 'Chọn 1 tài khoản đăng bài.';
    }

    function renderEditPostImages(images = []) {
        const grid = document.getElementById('editImagesGrid');
        if (!grid) return;
        editExistingImages = images;
        grid.innerHTML = images.map((img, i) => `
            <div class="edit-image-item" data-index="${i}">
                <img src="${img}" alt="image ${i+1}">
                <button type="button" class="btn-remove-image" data-idx="${i}"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('');
        grid.querySelectorAll('.btn-remove-image').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                editExistingImages.splice(idx, 1);
                renderEditPostImages(editExistingImages);
            });
        });
    }

    function renderEditVideoOptions(selectedVideoId = '') {
        if (!editFields.videoId) return;
        const videos = Array.isArray(managerData.videos) ? managerData.videos : [];
        const opts = videos.map(v => {
            const sel = String(v._id) === String(selectedVideoId) ? 'selected' : '';
            const title = v.title || v.fileName || v._id;
            const created = v.createdAt ? new Date(v.createdAt).toLocaleDateString('vi-VN') : '';
            const url = v.fileUrl || v.filePath || v.url || '';
            return `<option value="${v._id}" data-url="${url}" ${sel}>${title} ${created ? '(' + created + ')' : ''}</option>`;
        });
        editFields.videoId.innerHTML = ['<option value="">-- Chọn video từ kho AI --</option>'].concat(opts).join('');
    }

    function renderEditShopeeLinkOptions(selectedIds = []) {
        if (!editFields.shopeeLinks) return;
        const links = Array.isArray(managerData.shopeeLinks) ? managerData.shopeeLinks : [];
        editFields.shopeeLinks.innerHTML = links.map(l => `<option value="${l._id}" ${selectedIds.includes(String(l._id)) ? 'selected' : ''}>${l.title || l.shopeeUrl}</option>`).join('');
    }

    function renderEditFacebookSourceOptions(selectedSourceId = '') {
        if (!editFields.sourceChannelId) return;
        const fbChannels = Array.isArray(managerData.facebookChannels) ? managerData.facebookChannels : [];
        editFields.sourceChannelId.innerHTML = ['<option value="">-- Chọn tài khoản Facebook nguồn --</option>']
            .concat(fbChannels.map(ch => `<option value="${ch._id}" ${String(ch._id) === String(selectedSourceId) ? 'selected' : ''}>${ch.accountName}${ch.accountType ? ' · ' + ch.accountType : ''}</option>`))
            .join('');
    }

    async function loadEditFacebookGroups(sourceChannelId, preferredGroupKeys = '') {
        const combobox = document.getElementById('editGroupCombobox');
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        const list = document.getElementById('editGroupComboboxList');
        const loading = document.getElementById('editGroupComboboxLoading');
        const empty = document.getElementById('editGroupComboboxEmpty');
        const hint = document.getElementById('editGroupComboboxHint');
        const searchInput = document.getElementById('editGroupSearchInput');

        if (!sourceChannelId) {
            if (list) list.innerHTML = '';
            if (empty) empty.style.display = 'none';
            if (loading) loading.style.display = 'none';
            if (dropdown) dropdown.classList.remove('open');
            if (hint) hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Chọn tài khoản Facebook để hiển thị danh sách nhóm';
            editFacebookGroups = [];
            editSelectedGroupKeys = [];
            renderEditSelectedGroupTags();
            return;
        }

        if (dropdown) dropdown.classList.add('open');
        if (loading) loading.style.display = 'block';
        if (empty) empty.style.display = 'none';
        if (list) list.innerHTML = '';
        if (hint) hint.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải danh sách nhóm...';

        try {
            const res = await fetch(`/channels/api/${encodeURIComponent(sourceChannelId)}/facebook-groups`);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || 'Không tải được group');

            editFacebookGroups = Array.isArray(data.groups) ? data.groups : [];

            if (editFacebookGroups.length === 0) {
                if (loading) loading.style.display = 'none';
                if (empty) { empty.style.display = 'block'; empty.innerHTML = '<i class="fa-solid fa-users-slash"></i><span>Chưa có nhóm nào</span>'; }
                if (hint) hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Chưa có nhóm nào. Vào "Quét Group" để thêm.';
                return;
            }

            if (loading) loading.style.display = 'none';
            if (hint) hint.innerHTML = `<i class="fa-solid fa-check-circle"></i> ${editFacebookGroups.length} nhóm có sẵn. Chọn một hoặc nhiều nhóm để đăng bài.`;
            editSelectedGroupKeys = Array.isArray(preferredGroupKeys) ? [...preferredGroupKeys] : (preferredGroupKeys ? preferredGroupKeys.split(',') : []);
            if (searchInput) searchInput.value = '';
            renderEditGroupComboboxList(editFacebookGroups);
            renderEditSelectedGroupTags();
        } catch (err) {
            console.error('Load groups failed:', err);
            if (loading) loading.style.display = 'none';
            if (empty) { empty.style.display = 'block'; empty.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i><span>Lỗi tải nhóm</span>'; }
            if (hint) hint.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Lỗi khi tải danh sách nhóm.';
            showToast('Lỗi khi tải danh sách nhóm. Thử lại hoặc chọn tài khoản khác.', 'error');
        }
    }

    function renderEditGroupComboboxList(groups, searchTerm = '') {
        const list = document.getElementById('editGroupComboboxList');
        if (!list) return;

        let filtered = groups;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = groups.filter(g => (g.groupName || '').toLowerCase().includes(term) || (g.groupId || '').toLowerCase().includes(term));
        }

        list.innerHTML = filtered.map(group => {
            const key = group.groupUrl || group.groupId || '';
            // SỬ DỤNG .includes() ĐỂ CHECK MẢNG
            const isSelected = editSelectedGroupKeys.includes(key); 
            return `<div class="combobox-item ${isSelected ? 'selected' : ''}" data-group-url="${key}">
                <span class="combobox-item-checkbox">${isSelected ? '✓' : ''}</span>
                <div class="combobox-item-content">
                    <span class="combobox-item-title">${group.groupName || key}</span>
                </div>
            </div>`
        }).join('');

        attachEditGroupItemListeners();
    }

    function attachEditGroupItemListeners() {
        const list = document.getElementById('editGroupComboboxList');
        if (!list) return;

        list.querySelectorAll('.combobox-item').forEach(item => {
            item.addEventListener('click', () => {
                const key = item.dataset.groupUrl;
                const isCurrentlySelected = item.classList.contains('selected');

                if (isCurrentlySelected) {
                    editSelectedGroupKeys = editSelectedGroupKeys.filter(k => k !== key);
                } else {
                    editSelectedGroupKeys.push(key);
                }

                item.classList.toggle('selected');
                const checkbox = item.querySelector('.combobox-item-checkbox');
                checkbox.textContent = isCurrentlySelected ? '' : '✓';

                renderEditSelectedGroupTags();
            });
        });
    }

    function renderEditSelectedGroupTags() {
        const container = document.getElementById('editSelectedGroupTags');
        const badge = document.getElementById('editGroupSelectedBadge');
        if (!container) return;

        container.innerHTML = editSelectedGroupKeys.map(key => {
            const group = editFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
            const name = group?.groupName || key;
            return `<div class="selected-tag" data-key="${key}">
                <span>${name.substring(0, 20)}${name.length > 20 ? '...' : ''}</span>
                <span class="selected-tag__remove" data-action="remove-edit-group" data-key="${key}">
                    <i class="fa-solid fa-xmark"></i>
                </span>
            </div>`;
        }).join('');

        if (badge) badge.textContent = `${editSelectedGroupKeys.length} đã chọn`;
    }

    // Remove edit group via event delegation
    document.addEventListener('click', function(e) {
        const removeBtn = e.target.closest('.selected-tag__remove[data-action="remove-edit-group"]');
        if (removeBtn) {
            removeEditSelectedGroup(removeBtn.dataset.key);
        }
    });

    function removeEditSelectedGroup(key) {
        editSelectedGroupKeys = editSelectedGroupKeys.filter(k => k !== key);
        renderEditSelectedGroupTags();
        renderEditGroupComboboxList(editFacebookGroups, document.getElementById('editGroupSearchInput')?.value || '');
    }

    // ===== AFFILIATE COMBOBOX (Reels edit) =====
    let editAllAffiliateLinks = [];

    function renderEditAffiliateComboboxList(links, searchTerm = '') {
        const list = document.getElementById('editAffiliateComboboxList');
        if (!list) return;

        let filtered = links;
        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            filtered = links.filter(l =>
                (l.title || '').toLowerCase().includes(term) ||
                (l.shopeeUrl || '').toLowerCase().includes(term)
            );
        }

        if (filtered.length === 0) {
            list.innerHTML = '';
            const empty = document.getElementById('editAffiliateComboboxEmpty');
            if (empty) { empty.style.display = 'flex'; }
            return;
        }

        const empty = document.getElementById('editAffiliateComboboxEmpty');
        if (empty) { empty.style.display = 'none'; }

        list.innerHTML = filtered.map(link => {
            const isSelected = editSelectedShopeeLinks.includes(String(link._id));
            return `<div class="combobox-item ${isSelected ? 'selected' : ''}" data-link-id="${link._id}">
                <span class="combobox-item-checkbox">${isSelected ? '✓' : ''}</span>
                <img class="combobox-item-thumb" src="${link.imageUrl || 'https://via.placeholder.com/40?text=?'}" alt="${link.title || ''}" onerror="this.src='https://via.placeholder.com/40?text=?'">
                <div class="combobox-item-info">
                    <span class="combobox-item-title">${link.title || '—'}</span>
                    <span class="combobox-item-url">${link.shopeeUrl || '—'}</span>
                </div>
            </div>`;
        }).join('');

        attachEditAffiliateItemListeners();
    }

    function attachEditAffiliateItemListeners() {
        const list = document.getElementById('editAffiliateComboboxList');
        if (!list) return;

        list.querySelectorAll('.combobox-item').forEach(item => {
            item.addEventListener('click', () => {
                const id = item.dataset.linkId;
                const isCurrentlySelected = item.classList.contains('selected');

                if (isCurrentlySelected) {
                    editSelectedShopeeLinks = editSelectedShopeeLinks.filter(l => l !== id);
                } else {
                    editSelectedShopeeLinks.push(id);
                }

                item.classList.toggle('selected');
                const checkbox = item.querySelector('.combobox-item-checkbox');
                if (checkbox) checkbox.textContent = isCurrentlySelected ? '' : '✓';

                renderEditAffiliateUrls();
                renderEditAffiliateSelectedBadge();
            });
        });
    }

    function renderEditAffiliateUrls() {
        const box = document.getElementById('editAffiliateUrls');
        if (!box) return;

        const selected = editAllAffiliateLinks.filter(l => editSelectedShopeeLinks.includes(String(l._id)));

        if (!selected.length) {
            box.innerHTML = '<p class="affiliate-urls-empty">Chưa có sản phẩm nào được chọn.</p>';
            return;
        }

        box.innerHTML = selected.map(link => `
            <div class="edit-affiliate-item" data-link-id="${link._id}">
                <img src="${link.imageUrl || 'https://via.placeholder.com/32?text=?'}" alt="${link.title || ''}" onerror="this.src='https://via.placeholder.com/32?text=?'">
                <div class="edit-affiliate-item__info">
                    <div class="edit-affiliate-item__title">${link.title || '—'}</div>
                    <div class="edit-affiliate-item__url">${link.shopeeUrl || '—'}</div>
                </div>
                <button type="button" class="edit-affiliate-item__remove" data-id="${link._id}"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('');

        box.querySelectorAll('.edit-affiliate-item__remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                editSelectedShopeeLinks = editSelectedShopeeLinks.filter(l => l !== id);
                renderEditAffiliateUrls();
                renderEditAffiliateComboboxList(editAllAffiliateLinks, document.getElementById('editAffiliateSearchInput')?.value || '');
                renderEditAffiliateSelectedBadge();
            });
        });
    }

    function renderEditAffiliateSelectedBadge() {
        const badge = document.getElementById('editAffiliateSelectedBadge');
        if (badge) badge.textContent = `${editSelectedShopeeLinks.length} đã chọn`;
    }

    function getEditSelectedGroups() {
        return editSelectedGroupKeys.map(key => {
            const group = editFacebookGroups.find(g => (g.groupUrl || g.groupId) === key);
            return { groupId: group?.groupId || '', groupUrl: key, groupName: group?.groupName || '' };
        });
    }

    function setSummaryBar(payload = {}) {
        if (summaryFields.type) summaryFields.type.textContent = payload.typeLabel || '—';
        if (summaryFields.status) summaryFields.status.textContent = payload.statusLabel || '—';
        if (summaryFields.time) summaryFields.time.textContent = formatReadableTime(payload.publishedAtIso) || '—';
    }

    function formatReadableTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('vi-VN', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        }).format(date);
    }

    function applyEditTypeSection(type) {
        document.querySelectorAll('.schedule-edit-post, .schedule-edit-reels').forEach(el => {
            el.classList.remove('visible');
        });

        if (type === 'post') {
            document.getElementById('editGroupSection')?.classList.add('visible');
            document.getElementById('editPostImagesSection')?.classList.add('visible');
        } else {
            document.getElementById('editReelsVideoSection')?.classList.add('visible');
            document.getElementById('editAffiliateSection')?.classList.add('visible');
        }
    }

    async function loadVideoForPhonePreview(videoId) {
        // First check if managerData.videos already has the filePath cached
        const videos = Array.isArray(managerData.videos) ? managerData.videos : [];
        const cached = videos.find(v => String(v._id) === String(videoId));
        if (cached && (cached.fileUrl || cached.filePath || cached.url)) {
            const url = cached.fileUrl || cached.filePath || cached.url;
            const title = cached.title || cached.fileName || videoId;
            showEditVideoPreview(url, title);
            return;
        }
        // Fallback: fetch from /videos/api/list and find by id
        try {
            const res = await fetch('/videos/api/list');
            if (!res.ok) throw new Error('videos api failed ' + res.status);
            const data = await res.json();
            if (data.success && Array.isArray(data.videos)) {
                const found = data.videos.find(v => String(v._id) === String(videoId));
                if (found) {
                    const url = found.filePath || found.url || '';
                    showEditVideoPreview(url, found.title || videoId);
                }
            }
        } catch (err) {
            // silent fail — video will just not preview
        }
    }

    function showEditVideoPreview(url, title) {
        const player = document.getElementById('editPhoneVideoTag');
        const poster = document.getElementById('editPhonePosterTag');
        const titleEl = document.getElementById('editPhoneVideoTitle');
        const playIcon = document.getElementById('editPhoneCenterPlayIcon');
        const controls = document.getElementById('editPhoneVideoControls');
        if (!player) return;

        // Resolve relative path to full URL (e.g., /uploads/videos/xxx.mp4 -> /uploads/videos/xxx.mp4)
        // URL relative như /uploads/videos/xxx.mp4 là hợp lệ vì browser sẽ tự resolve từ domain hiện tại
        let finalUrl = url;
        
        if (!url) {
            player.removeAttribute('src');
            player.removeAttribute('poster');
            player.load();
            player.classList.remove('active', 'playing');
            if (poster) {
                poster.removeAttribute('src');
                poster.classList.remove('active');
            }
        } else {
            // Nếu là relative path (bắt đầu bằng /), dùng nguyên vì browser tự resolve
            player.src = finalUrl;
            player.load();
            player.pause();
            player.classList.add('active');
            player.classList.remove('playing');
        }
        if (titleEl) titleEl.textContent = title || 'Video đã chọn';
        if (playIcon) playIcon.classList.remove('hidden-status');
        if (controls) controls.classList.remove('visible');
        updateEditPhonePlayPauseIcon(false);
    }

    async function updateEditPhoneFromSelect() {
        const selected = editFields.videoId?.selectedOptions?.[0];
        if (!selected || !selected.value) {
            hideEditVideoPreview();
            return;
        }
        const captionEl = document.getElementById('editReelsPreviewCaption');
        if (captionEl) captionEl.textContent = selected.text || '';

        // Try data-url attribute first (set when rendering options)
        const cachedUrl = selected.dataset?.url;
        if (cachedUrl) {
            showEditVideoPreview(cachedUrl, selected.text || '');
            return;
        }
        // Fallback: check in-memory cache then fetch
        await loadVideoForPhonePreview(selected.value);
    }

    function hideEditVideoPreview() {
        const player = document.getElementById('editPhoneVideoTag');
        const playIcon = document.getElementById('editPhoneCenterPlayIcon');
        const controls = document.getElementById('editPhoneVideoControls');
        if (player) {
            player.removeAttribute('src');
            player.load();
            player.classList.remove('active', 'playing');
        }
        if (playIcon) playIcon.classList.remove('hidden-status');
        if (controls) controls.classList.remove('visible');
        updateEditPhonePlayPauseIcon(false);
    }

    function updateEditPhonePlayPauseIcon(isPlaying) {
        const btn = document.getElementById('editPhonePlayPauseBtn');
        if (!btn) return;
        const icon = btn.querySelector('i');
        if (!icon) return;
        if (isPlaying) { icon.classList.remove('fa-play'); icon.classList.add('fa-pause'); }
        else { icon.classList.remove('fa-pause'); icon.classList.add('fa-play'); }
    }

    function showEditPhoneControls(show) {
        const controls = document.getElementById('editPhoneVideoControls');
        if (controls) controls.classList.toggle('visible', show);
    }

    function updateEditPhoneDuration() {
        const player = document.getElementById('editPhoneVideoTag');
        const durationEl = document.getElementById('editPhoneVideoDuration');
        if (!player || !durationEl) return;
        const d = player.duration;
        if (!d || Number.isNaN(d)) return;
        durationEl.textContent = `${Math.floor(d / 60)}:${Math.floor(d % 60).toString().padStart(2, '0')}`;
    }

    function initEditPhonePreview() {
        const container = document.getElementById('editPhoneMockupContainer');
        const video = document.getElementById('editPhoneVideoTag');
        const playIcon = document.getElementById('editPhoneCenterPlayIcon');
        const playPauseBtn = document.getElementById('editPhonePlayPauseBtn');
        if (!container || !video) return;

        function togglePlay() {
            if (!video.src || video.src === '' || video.readyState === 0) return;
            if (video.paused) {
                video.play().catch(() => {});
                video.classList.add('playing');
                playIcon?.classList.add('hidden-status');
                updateEditPhonePlayPauseIcon(true);
                showEditPhoneControls(true);
            } else {
                video.pause();
                // QUAN TRỌNG: KHÔNG gọi video.load() ở đây
                // video.load() sẽ reload lại video, gây lỗi khi play lại
                video.classList.remove('playing');
                playIcon?.classList.remove('hidden-status');
                updateEditPhonePlayPauseIcon(false);
                showEditPhoneControls(false);
            }
        }

        // Click vào container (khu vực video hoặc icon play center)
        container.addEventListener('click', (e) => {
            // Nếu click trực tiếp vào nút play/pause thì không xử lý (tránh double event)
            if (e.target.closest('.phone-video-controls') || e.target.closest('#editPhonePlayPauseBtn')) return;
            togglePlay();
        });

        // Click vào nút play/pause riêng
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePlay();
            });
        }

        // Khi video kết thúc, reset về trạng thái ban đầu
        video.addEventListener('ended', () => {
            video.classList.remove('playing');
            playIcon?.classList.remove('hidden-status');
            updateEditPhonePlayPauseIcon(false);
            showEditPhoneControls(false);
        });

        video.addEventListener('timeupdate', updateEditPhoneDuration);
        video.addEventListener('loadedmetadata', updateEditPhoneDuration);
    }

    function switchEditVideoTab(source, videoIdToSelect = '') {
        document.querySelectorAll('#editVideoSourceTabs .video-source-tab').forEach(t => t.classList.toggle('active', t.dataset.source === source));
        document.getElementById('editVideoLibrarySection').style.display = source === 'library' ? '' : 'none';
        document.getElementById('editVideoLocalSection').style.display = source === 'local' ? '' : 'none';
        if (source === 'library') {
            renderEditVideoOptions(videoIdToSelect || editFields.videoId?.value || currentEditPayload?.videoId || '');
        } else {
            // Switched to local tab - clear library selection, show local
            hideEditVideoPreview();
        }
    }

    function openEditModalFromRow(row) {
        const payload = getPayloadFromRow(row);
        if (!payload || !editModal) return;

        applyEditModalHeader('edit');
        currentEditPayload = payload;
        editNewImages = [];
        editExistingImages = [];
        editLocalVideoFile = null;
        editSelectedShopeeLinks = [];
        editSelectedGroupKeys = [];
        editFacebookGroups = [];

        if (editFields.id) editFields.id.value = payload.id || row.dataset.id || '';
        if (editFields.caption) editFields.caption.value = payload.caption || '';
        if (editFields.status) editFields.status.value = payload.status || 'pending';

        const type = payload.type || 'post';
        if (editFields.type) editFields.type.value = type;

        const scheduledDate = payload.publishedAtIso || payload.scheduledAt || '';
        if (editFields.dateTime) editFields.dateTime.value = formatForDateTimeLocal(scheduledDate);

        const platforms = Array.isArray(payload.platforms) ? payload.platforms : [];
        editSelectedPlatform = platforms[0] || 'FB';

        // Show sections first
        applyEditTypeSection(type);
        renderEditPlatformChips(type, platforms);
        renderEditAccountOptions(type, editSelectedPlatform, payload.accounts || []);

            if (type === 'post') {
                // Load images
                const images = Array.isArray(payload.images) ? payload.images : [];
                renderEditPostImages(images);

                // Groups: prefill selected
                editSelectedGroupKeys = Array.isArray(payload.targetGroupId) ? payload.targetGroupId : (payload.targetGroupId ? [payload.targetGroupId] : []);
                renderEditSelectedGroupTags();

                // Then handle FB groups visibility + loading
                setTimeout(() => {
                    onEditPostPlatformChange();
                }, 50);
            } else {
            // Reels: load video library + affiliate links
            editAllAffiliateLinks = Array.isArray(managerData.shopeeLinks) ? managerData.shopeeLinks : [];
            const linkIds = payload.shopeeLinkIds || [];
            editSelectedShopeeLinks = [...linkIds];

            renderEditVideoOptions(payload.videoId || '');
            
            const videoUrl = payload.videoUrl || payload.videoPath || '';
            if (videoUrl) {
                // Nếu có video URL (videoPath từ lịch cũ không có videoId)
                // thì show preview NGAY, KHÔNG gọi updateEditPhoneFromSelect
                // vì updateEditPhoneFromSelect sẽ check dropdown videoId
                // mà videoId rỗng -> hideEditVideoPreview() -> xóa mất src
                showEditVideoPreview(videoUrl, payload.videoTitle || 'Video đã chọn');
            } else if (payload.videoId) {
                // Chỉ gọi update from select khi có videoId trong dropdown
                setTimeout(() => updateEditPhoneFromSelect(), 0);
            } else {
                hideEditVideoPreview();
            }
            
            renderEditAffiliateComboboxList(editAllAffiliateLinks, '');
            renderEditAffiliateUrls();
            renderEditAffiliateSelectedBadge();
        }

        if (editFields.meta) {
            const videoTitle = payload.videoTitle || '—';
            const linkCount = payload.shopeeLinksCount || 0;
            const sourceName = payload.sourceChannelName || '—';
            editFields.meta.innerHTML = `<div class="schedule-meta-grid">
                <div><span>Video</span><strong>${safeText(videoTitle)}</strong></div>
                <div><span>Link Affiliate</span><strong>${linkCount}</strong></div>
                <div><span>Nguồn</span><strong>${safeText(sourceName)}</strong></div>
            </div>`;
            if (payload.publishedUrl) {
                editFields.meta.innerHTML += `<div style="margin-top:8px;"><a href="${safeText(payload.publishedUrl)}" target="_blank">Mở bài đã đăng</a></div>`;
            }
        }

        setSummaryBar(payload);

        if (btnSaveEdit) {
            const isPosted = payload.status === 'posted';
            btnSaveEdit.disabled = isPosted;
            btnSaveEdit.textContent = isPosted ? 'Đã đăng' : 'Lưu thay đổi';
            btnSaveEdit.style.opacity = isPosted ? '0.6' : '1';
        }

        editModal.classList.add('open');
        editModal.setAttribute('aria-hidden', 'false');
    }

    function applyEditModalHeader(mode) {
        const eyebrow = document.getElementById('editModalEyebrow');
        const title = document.getElementById('scheduleModalTitle');
        const subhead = document.getElementById('editModalSubhead');
        if (mode === 'duplicate') {
            if (eyebrow) eyebrow.textContent = 'Sao chép lịch trình';
            if (title) title.textContent = 'Tạo bản sao từ lịch hiện tại';
            if (subhead) subhead.textContent = 'Dữ liệu đã được sao chép. Thay đổi thời gian và lưu để tạo lịch mới.';
            if (btnSaveEdit) {
                btnSaveEdit.textContent = 'Tạo lịch sao chép';
                btnSaveEdit.disabled = false;
                btnSaveEdit.style.opacity = '1';
            }
        } else {
            if (eyebrow) eyebrow.textContent = 'Chỉnh sửa lịch trình';
            if (title) title.textContent = 'Xem & cập nhật lịch';
            if (subhead) subhead.textContent = 'Chỉnh sửa dữ liệu thật từ hệ thống, chọn lại nền tảng, tài khoản, group, video và link affiliate.';
            if (btnSaveEdit) {
                btnSaveEdit.textContent = 'Lưu thay đổi';
            }
        }
    }

    function openDuplicateModal(row) {
        const payload = getPayloadFromRow(row);
        if (!payload || !editModal) return;

        applyEditModalHeader('duplicate');

        // Clear id so backend creates a NEW schedule (not overwrite)
        const newPayload = { ...payload, id: undefined };

        currentEditPayload = newPayload;
        editNewImages = [];
        editExistingImages = [];
        editLocalVideoFile = null;
        editSelectedShopeeLinks = [...(payload.shopeeLinkIds || [])];
        editSelectedGroupKeys = Array.isArray(payload.targetGroupId) ? [...payload.targetGroupId] : [];
        editFacebookGroups = [];

        if (editFields.id) editFields.id.value = '';
        if (editFields.caption) editFields.caption.value = payload.caption || '';
        if (editFields.status) editFields.status.value = 'pending';

        const type = payload.type || 'post';
        if (editFields.type) editFields.type.value = type;

        if (editFields.dateTime) editFields.dateTime.value = '';

        const platforms = Array.isArray(payload.platforms) ? payload.platforms : [];
        editSelectedPlatform = platforms[0] || 'FB';

        applyEditTypeSection(type);
        renderEditPlatformChips(type, platforms);
        renderEditAccountOptions(type, editSelectedPlatform, payload.accounts || []);

        if (type === 'post') {
            const images = Array.isArray(payload.images) ? payload.images : [];
            renderEditPostImages(images);
            editSelectedGroupKeys = Array.isArray(payload.targetGroupId) ? [...payload.targetGroupId] : [];
            renderEditSelectedGroupTags();
            setTimeout(() => onEditPostPlatformChange(), 50);
        } else {
            editAllAffiliateLinks = Array.isArray(managerData.shopeeLinks) ? managerData.shopeeLinks : [];
            renderEditVideoOptions(payload.videoId || '');
            setTimeout(() => updateEditPhoneFromSelect(), 0);
            renderEditAffiliateComboboxList(editAllAffiliateLinks, '');
            renderEditAffiliateUrls();
            renderEditAffiliateSelectedBadge();

            const videoUrl = payload.videoUrl || payload.videoPath || '';
            if (videoUrl) {
                showEditVideoPreview(videoUrl, payload.videoTitle || 'Video đã chọn');
            } else {
                hideEditVideoPreview();
            }
        }

        if (editFields.meta) editFields.meta.innerHTML = '—';
        setSummaryBar(newPayload);

        editModal.classList.add('open');
        editModal.setAttribute('aria-hidden', 'false');
    }

    function closeEditModal() {
        if (!editModal) return;
        editModal.classList.remove('open');
        editModal.setAttribute('aria-hidden', 'true');

        document.getElementById('editGroupComboboxDropdown')?.classList.remove('open');
        document.getElementById('editAffiliateComboboxDropdown')?.classList.remove('open');
        if (btnSaveEdit) {
            btnSaveEdit.disabled = false;
            btnSaveEdit.textContent = 'Lưu thay đổi';
            btnSaveEdit.style.opacity = '1';
        }
        currentEditPayload = null;
        editNewImages = [];
        editExistingImages = [];
        editLocalVideoFile = null;
    }

    async function saveEditedSchedule() {
        const scheduleId = (editFields.id?.value || '').trim();
        if (!scheduleId || !/^[0-9a-fA-F]{24}$/.test(scheduleId)) {
            showToast('Không tìm thấy ID lịch trình. Vui lòng thử mở lại modal.', 'error');
            return;
        }

        const type = editFields.type?.value || 'post';
        const selectedAccounts = Array.from(editFields.accounts?.selectedOptions || []).map((opt) => opt.value);

        const scheduledAtValue = editFields.dateTime?.value;
        if (scheduledAtValue) {
            const scheduledDate = new Date(scheduledAtValue);
            if (scheduledDate < new Date()) {
                showToast('Thời gian đăng không được ở quá khứ!', 'warning');
                return;
            }
        }

        let finalStatus = editFields.status?.value || 'pending';
        if (finalStatus === 'failed' || finalStatus === 'pending') {
            finalStatus = 'pending';
        }

        const videoId = editFields.videoId?.value || (currentEditPayload?.videoId ? (typeof currentEditPayload.videoId === 'object' ? currentEditPayload.videoId._id : currentEditPayload.videoId) : '');

        const payload = {
            scheduleId,
            type,
            status: finalStatus,
            caption: editFields.caption?.value || '',
            scheduledAt: scheduledAtValue ? new Date(scheduledAtValue).toISOString() : '',
            platforms: [editSelectedPlatform || (type === 'post' ? 'FB' : 'FR')],
            accounts: selectedAccounts,
            videoId,
            targetGroupSourceChannelId: type === 'post' ? (editFields.sourceChannelId?.value || '') : '',
            targetGroupIds: type === 'post' && editSelectedPlatform === 'FB' ? editSelectedGroupKeys : [],
            shopeeLinks: editSelectedShopeeLinks,
            existingImages: editExistingImages.filter(url => !url.startsWith('blob:')),
            newImages: editNewImages,
            localVideoFile: editLocalVideoFile
        };

        try {
            let url = '/schedule/api/update';
            let method = 'PUT';
            let body;

            const hasNewImages = Array.isArray(payload.newImages) && payload.newImages.length > 0;
            const hasLocalVideo = payload.localVideoFile instanceof File;
            if (hasNewImages || hasLocalVideo) {
                const formData = new FormData();
                formData.append('scheduleId', payload.scheduleId);
                formData.append('type', payload.type);
                formData.append('status', payload.status);
                formData.append('caption', payload.caption);
                if (payload.scheduledAt) formData.append('scheduledAt', payload.scheduledAt);
                payload.platforms.forEach(p => formData.append('platforms', p));
                selectedAccounts.forEach(a => formData.append('accounts', a));
                formData.append('videoId', payload.videoId);
                if (type === 'post') {
                    if (payload.targetGroupSourceChannelId) formData.append('targetGroupSourceChannelId', payload.targetGroupSourceChannelId);
    
                    // GỬI MẢNG DẠNG MẢNG LÊN SERVER
                    payload.targetGroupIds.forEach(g => formData.append('targetGroupIds', g));
                }
                editSelectedShopeeLinks.forEach(l => formData.append('shopeeLinks', l));
                payload.newImages.forEach(file => formData.append('images', file));
                if (payload.localVideoFile instanceof File) {
                    formData.append('localVideo', payload.localVideoFile);
                }
                body = formData;
            } else {
                const jsonBody = {
                    scheduleId: payload.scheduleId,
                    type: payload.type,
                    status: payload.status,
                    caption: payload.caption,
                    scheduledAt: payload.scheduledAt,
                    platforms: payload.platforms,
                    accounts: selectedAccounts,
                    videoId: payload.videoId,
                    shopeeLinks: editSelectedShopeeLinks
                };
                if (type === 'post') {
                    jsonBody.targetGroupSourceChannelId = payload.targetGroupSourceChannelId;
                    jsonBody.targetGroupIds = payload.targetGroupIds;
                }
                body = JSON.stringify(jsonBody);
            }

            const res = await fetch(url, {
                method,
                headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
                body
            });

            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Không lưu được lịch trình', 'error');
                return;
            }

            showToast('Đã cập nhật lịch trình', 'success');
            location.reload();
        } catch (error) {
            console.error('saveEditedSchedule error:', error);
            showToast('Lỗi kết nối server: ' + (error.message || 'Không rõ nguyên nhân'), 'error');
        }
    }

    async function saveDuplicateSchedule() {
        const type = editFields.type?.value || 'post';
        const selectedAccounts = Array.from(editFields.accounts?.selectedOptions || []).map((opt) => opt.value);

        const scheduledAtValue = editFields.dateTime?.value;
        if (!scheduledAtValue) {
            showToast('Vui lòng chọn thời gian đăng!', 'warning');
            return;
        }
        const scheduledDate = new Date(scheduledAtValue);
        if (scheduledDate < new Date()) {
            showToast('Thời gian đăng không được ở quá khứ!', 'warning');
            return;
        }

        const videoId = editFields.videoId?.value || (currentEditPayload?.videoId ? (typeof currentEditPayload.videoId === 'object' ? currentEditPayload.videoId._id : currentEditPayload.videoId) : '');
        const origPayload = currentEditPayload || {};

        const payload = {
            type,
            status: 'pending',
            caption: editFields.caption?.value || origPayload.caption || '',
            scheduledAt: new Date(scheduledAtValue).toISOString(),
            platforms: [editSelectedPlatform || (type === 'post' ? 'FB' : 'FR')],
            accounts: selectedAccounts,
            videoId,
            videoTitle: origPayload.videoTitle || '',
            videoPath: origPayload.videoPath || origPayload.videoUrl || '',
            videoUrl: origPayload.videoUrl || origPayload.videoPath || '',
            targetGroupSourceChannelId: type === 'post' ? (editFields.sourceChannelId?.value || origPayload.sourceChannelId || '') : '',
            targetGroupId: type === 'post' && editSelectedPlatform === 'FB' ? editSelectedGroupKeys : [],
            shopeeLinks: editSelectedShopeeLinks,
            existingImages: editExistingImages.filter(url => !url.startsWith('blob:')),
            newImages: editNewImages,
            localVideoFile: editLocalVideoFile
        };

        try {
            let url = '/schedule/api/create';
            let method = 'POST';
            let body;

            const hasNewImages = Array.isArray(payload.newImages) && payload.newImages.length > 0;
            const hasLocalVideo = payload.localVideoFile instanceof File;
            if (hasNewImages || hasLocalVideo) {
                const formData = new FormData();
                formData.append('type', payload.type);
                formData.append('status', payload.status);
                formData.append('caption', payload.caption);
                if (payload.scheduledAt) formData.append('scheduledAt', payload.scheduledAt);
                payload.platforms.forEach(p => formData.append('platforms', p));
                selectedAccounts.forEach(a => formData.append('accounts', a));
                formData.append('videoId', payload.videoId);
                if (type === 'post') {
                    if (payload.targetGroupSourceChannelId) formData.append('targetGroupSourceChannelId', payload.targetGroupSourceChannelId);
                    (payload.targetGroupId || []).forEach(g => formData.append('targetGroupId', g));
                }
                editSelectedShopeeLinks.forEach(l => formData.append('shopeeLinks', l));
                payload.newImages.forEach(file => formData.append('images', file));
                if (payload.localVideoFile instanceof File) {
                    formData.append('localVideo', payload.localVideoFile);
                }
                body = formData;
            } else {
                body = JSON.stringify(payload);
            }

            const res = await fetch(url, {
                method,
                headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
                body
            });

            const data = await res.json();
            if (!data.success) {
                showToast(data.message || 'Không tạo được lịch trình: ' + res.status, 'error');
                console.warn('[saveDuplicateSchedule] error:', data);
                return;
            }

            closeEditModal();
            showToast('Đã tạo lịch trình sao chép thành công!', 'success');
            setTimeout(() => location.reload(), 1000);
        } catch (error) {
            console.error('saveEditedSchedule error:', error);
            showToast('Lỗi kết nối server: ' + (error.message || 'Không rõ nguyên nhân'), 'error');
        }
    }

    async function refreshManagerRowsFromServer() {
        try {
            const res = await fetch('/schedule/api/list');
            if (!res.ok) throw new Error('fetch failed ' + res.status);
            const data = await res.json();
            if (!data.success || !Array.isArray(data.schedules)) {
                showToast('Không tải được danh sách lịch trình', 'error');
                return;
            }

            const latestById = new Map(data.schedules.map((item) => [String(item._id), item]));
            let changed = false;

            rows.forEach((row) => {
                const current = latestById.get(String(row.dataset.id || ''));
                if (!current) return;

                const payload = getPayloadFromRow(row) || {};
                const nextStatus = String(current.status || payload.status || 'pending');
                const nextPublishedUrl = String(current.publishedUrl || '');

                if (row.dataset.status !== nextStatus) {
                    row.dataset.status = nextStatus;
                    row.className = row.className.replace(/schedule-row--\w+/g, '').trim();
                    row.classList.add(`schedule-row--${nextStatus}`);
                    const pill = row.querySelector('.status-pill');
                    if (pill) {
                        pill.className = `status-pill ${nextStatus === 'posted' ? 'status-posted' : nextStatus === 'failed' ? 'status-failed' : 'status-pending'}`;
                        pill.textContent = nextStatus === 'posted' ? 'Đã đăng' : nextStatus === 'failed' ? 'Thất bại' : 'Chưa đăng';
                    }
                    const runBtn = row.querySelector('.btn-run-schedule');
                    if (runBtn) {
                        runBtn.className = `btn-row-action btn-run-schedule btn-run-schedule--${nextStatus}`;
                    }
                    changed = true;
                }

                if ((payload.publishedUrl || '') !== nextPublishedUrl) {
                    payload.publishedUrl = nextPublishedUrl;
                    row.dataset.row = encodeURIComponent(JSON.stringify(payload));
                    changed = true;
                }
            });

            if (changed) {
                applyFilters();
                showToast('Đã cập nhật trạng thái lịch trình', 'success');
            }
        } catch (error) {
            console.error('Refresh schedule manager rows failed:', error);
            showToast('Lỗi kết nối server khi cập nhật lịch trình', 'error');
        }
    }

    function updateRowFromScheduleData(schedule = {}) {
        if (!schedule._id) return;

        const row = document.querySelector(`.schedule-row[data-id="${schedule._id}"]`);
        if (!row) return;

        const payload = getPayloadFromRow(row) || {};
        const nextStatus = String(schedule.status || payload.status || 'pending');
        const nextPublishedUrl = String(schedule.publishedUrl || payload.publishedUrl || '');

        row.dataset.status = nextStatus;
        row.className = row.className.replace(/schedule-row--\w+/g, '').trim();
        row.classList.add(`schedule-row--${nextStatus}`);

        // Update run button visibility
        const runBtn = row.querySelector('.btn-run-schedule');
        if (runBtn) {
            runBtn.className = `btn-row-action btn-run-schedule btn-run-schedule--${nextStatus}`;
        }
        const pill = row.querySelector('.status-pill');
        if (pill) {
            pill.className = `status-pill ${nextStatus === 'posted' ? 'status-posted' : nextStatus === 'failed' ? 'status-failed' : 'status-pending'}`;
            pill.textContent = nextStatus === 'posted' ? 'Đã đăng' : nextStatus === 'failed' ? 'Thất bại' : 'Chưa đăng';
        }

        payload.status = nextStatus;
        payload.statusLabel = pill?.textContent || payload.statusLabel || '';
        payload.publishedUrl = nextPublishedUrl;
        row.dataset.row = encodeURIComponent(JSON.stringify(payload));
    }

    async function runScheduleById(scheduleId, button) {
        if (!scheduleId) return;

        const originalHtml = button?.innerHTML || '';
        if (button) {
            button.disabled = true;
            button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }

        try {
            const res = await fetch(`/schedule/api/run-schedule/${encodeURIComponent(scheduleId)}`, {
                method: 'POST'
            });
            const data = await res.json();

            if (!data.success) {
                showToast(data.message || 'Chạy lịch thất bại', 'error');
                return;
            }

            updateRowFromScheduleData(data.data?.schedule || {});
            showToast(data.message || 'Đã chạy lịch thành công', 'success');
            await refreshManagerRowsFromServer();
        } catch (error) {
            console.error('Run schedule now failed:', error);
            showToast('Lỗi kết nối server', 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = originalHtml || '<i class="fa-solid fa-circle-play"></i>';
            }
        }
    }

    function applyFilters() {
        const keyword = String(searchInput?.value || '').trim().toLowerCase();
        const selectedPlatform = platformFilter?.value || 'all';
        const selectedStatus = statusFilter?.value || 'all';

        filteredRows = rows.filter((row) => {
            const rowText = String(row.dataset.searchText || '').toLowerCase();
            const rowPlatforms = String(row.dataset.platform || '').split(',').filter(Boolean);
            const rowStatus = String(row.dataset.status || '');

            const matchesKeyword = !keyword || rowText.includes(keyword);
            const matchesPlatform = selectedPlatform === 'all' || rowPlatforms.includes(selectedPlatform);
            const matchesStatus = selectedStatus === 'all' || rowStatus === selectedStatus;

            return matchesKeyword && matchesPlatform && matchesStatus;
        });

        currentPage = 1;
        renderPagination();
        renderVisibleRows();
    }

    function getTotalPages() {
        return Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    }

    function renderVisibleRows() {
        const startIndex = (currentPage - 1) * PAGE_SIZE;
        const endIndex = startIndex + PAGE_SIZE;

        rows.forEach((row) => {
            row.style.display = 'none';
        });

        filteredRows.slice(startIndex, endIndex).forEach((row) => {
            row.style.display = '';
        });

        updatePaginationInfo();
    }

    function updatePaginationInfo() {
        if (!paginationEl) return;

        const startIndex = filteredRows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
        const endIndex = Math.min(currentPage * PAGE_SIZE, filteredRows.length);
        const infoEl = paginationEl.querySelector('[data-pagination-info]');
        if (infoEl) {
            infoEl.textContent = filteredRows.length === 0
                ? 'Không có lịch trình nào phù hợp'
                : `Hiển thị ${startIndex}-${endIndex} / ${filteredRows.length} lịch trình`;
        }
    }

    function renderPagination() {
        if (!paginationEl) return;

        const totalPages = getTotalPages();
        currentPage = Math.min(currentPage, totalPages);

        const maxButtons = 5;
        const half = Math.floor(maxButtons / 2);
        let start = Math.max(1, currentPage - half);
        let end = Math.min(totalPages, start + maxButtons - 1);
        start = Math.max(1, end - maxButtons + 1);

        const buttons = [];

        buttons.push(`<button type="button" class="schedule-pagination__btn" data-page="prev" ${currentPage === 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>`);

        for (let page = start; page <= end; page += 1) {
            buttons.push(`<button type="button" class="schedule-pagination__btn ${page === currentPage ? 'is-active' : ''}" data-page="${page}">${page}</button>`);
        }

        buttons.push(`<button type="button" class="schedule-pagination__btn" data-page="next" ${currentPage === totalPages ? 'disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>`);

        paginationEl.innerHTML = `
            <div class="schedule-pagination__info" data-pagination-info></div>
            <div class="schedule-pagination__controls">
                ${buttons.join('')}
            </div>
        `;

        paginationEl.querySelectorAll('.schedule-pagination__btn').forEach((button) => {
            button.addEventListener('click', () => {
                const target = button.dataset.page;
                const total = getTotalPages();

                if (target === 'prev') {
                    currentPage = Math.max(1, currentPage - 1);
                } else if (target === 'next') {
                    currentPage = Math.min(total, currentPage + 1);
                } else {
                    currentPage = Number(target) || 1;
                }

                renderPagination();
                renderVisibleRows();
            });
        });
    }

    searchInput?.addEventListener('input', debounce(applyFilters, 300));
    platformFilter?.addEventListener('change', applyFilters);
    statusFilter?.addEventListener('change', applyFilters);

    editFields.type?.addEventListener('change', () => {
        const type = editFields.type?.value || 'post';
        const platforms = type === 'post' ? POST_PLATFORMS : REELS_PLATFORMS;
        editSelectedPlatform = platforms[0];
        renderEditPlatformChips(type, [editSelectedPlatform]);
        applyEditTypeSection(type);
        onEditPlatformChange(type);
    });

    editFields.sourceChannelId?.addEventListener('change', () => {
        void loadEditFacebookGroups(editFields.sourceChannelId.value || '', '');
    });

    btnRefreshGroups?.addEventListener('click', () => {
        if (!editFields.sourceChannelId?.value) {
            showToast('Hãy chọn tài khoản nguồn trước', 'warning');
            return;
        }
        showToast('Đang tải lại danh sách nhóm...', 'info');
        void loadEditFacebookGroups(editFields.sourceChannelId.value, editSelectedGroupKeys);
    });

    // Edit Group Combobox Events
    document.getElementById('editGroupSearchInput')?.addEventListener('input', (e) => {
        const term = e.target.value;
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        if (editFacebookGroups.length > 0) {
            dropdown?.classList.add('open');
        }
        renderEditGroupComboboxList(editFacebookGroups, term);
    });

    document.getElementById('editGroupCombobox')?.querySelector('.combobox-input-wrapper')?.addEventListener('click', () => {
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        if (editFacebookGroups.length > 0) {
            dropdown?.classList.toggle('open');
        }
    });

    document.addEventListener('click', (e) => {
        const combobox = document.getElementById('editGroupCombobox');
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        if (!combobox?.contains(e.target)) {
            dropdown?.classList.remove('open');
        }
        const affDropdown = document.getElementById('editAffiliateComboboxDropdown');
        const affCombobox = document.getElementById('editAffiliateCombobox');
        if (affDropdown && affCombobox && !affCombobox.contains(e.target)) {
            affDropdown.classList.remove('open');
        }
    });

    // Affiliate Combobox Events
    document.getElementById('editAffiliateSearchInput')?.addEventListener('input', (e) => {
        renderEditAffiliateComboboxList(editAllAffiliateLinks, e.target.value);
        const dropdown = document.getElementById('editAffiliateComboboxDropdown');
        if (dropdown) dropdown.classList.add('open');
    });

    document.getElementById('editAffiliateComboboxInputWrapper')?.addEventListener('click', () => {
        const dropdown = document.getElementById('editAffiliateComboboxDropdown');
        if (dropdown) dropdown.classList.toggle('open');
    });

    // Video source tabs
    document.getElementById('editVideoSourceTabs')?.querySelectorAll('.video-source-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            switchEditVideoTab(tab.dataset.source);
        });
    });

    // Video library select change -> preview video on phone
    editFields.videoId?.addEventListener('change', () => {
        const selected = editFields.videoId.selectedOptions[0];
        if (!selected || !selected.value) {
            hideEditVideoPreview();
            return;
        }
        const videos = Array.isArray(managerData.videos) ? managerData.videos : [];
        const video = videos.find(v => String(v._id) === selected.value);
        if (video) {
            const url = video.fileUrl || video.filePath || '';
            showEditVideoPreview(url, video.title || selected.text);
        }
        const captionEl = document.getElementById('editReelsPreviewCaption');
        if (captionEl) captionEl.textContent = selected.text || '';
    });

    // Local video file input
    document.getElementById('btnBrowseEditVideo')?.addEventListener('click', () => document.getElementById('editVideoFileInput')?.click());
    document.getElementById('editVideoFileInput')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        editLocalVideoFile = file;
        const localPlayer = document.getElementById('editLocalVideoPlayer');
        const info = document.getElementById('editLocalVideoInfo');
        const preview = document.getElementById('editLocalVideoPreview');
        const objectUrl = URL.createObjectURL(file);
        if (localPlayer) localPlayer.src = objectUrl;
        if (info) info.textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`;
        if (preview) preview.style.display = '';
        // Show on phone preview too
        showEditVideoPreview(objectUrl, file.name);
        const captionEl = document.getElementById('editReelsPreviewCaption');
        if (captionEl) captionEl.textContent = file.name;
    });
    document.getElementById('btnRemoveEditVideo')?.addEventListener('click', () => {
        editLocalVideoFile = null;
        const preview = document.getElementById('editLocalVideoPreview');
        if (preview) preview.style.display = 'none';
        const input = document.getElementById('editVideoFileInput');
        if (input) input.value = '';
        hideEditVideoPreview();
        const captionEl = document.getElementById('editReelsPreviewCaption');
        if (captionEl) captionEl.textContent = '';
    });

    // Dropzone drag events
    const dropzone = document.getElementById('editVideoDropzone');
    if (dropzone) {
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            const file = e.dataTransfer?.files[0];
            if (file && file.type.startsWith('video/')) {
                const dt = new DataTransfer();
                dt.items.add(file);
                const input = document.getElementById('editVideoFileInput');
                if (input) { input.files = dt.files; input.dispatchEvent(new Event('change')); }
            }
        });
    }

    // Affiliate select change -> update URLs display
    editFields.shopeeLinks?.addEventListener('change', () => {
        const selected = Array.from(editFields.shopeeLinks.selectedOptions).map(opt => opt.value);
        editSelectedShopeeLinks = selected;
        renderEditAffiliateUrls(selected);
    });

    // Image add button
    document.getElementById('btnAddEditImages')?.addEventListener('click', () => document.getElementById('editImageFileInput')?.click());
    document.getElementById('editImageFileInput')?.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => {
            editNewImages.push(file);
            const url = URL.createObjectURL(file);
            editExistingImages.push(url);
        });
        renderEditPostImages(editExistingImages);
        e.target.value = '';
    });

    editFields.shopeeLinks?.addEventListener('change', () => {
        editSelectedShopeeLinks = Array.from(editFields.shopeeLinks.selectedOptions).map(o => o.value);
        renderEditAffiliateUrls(editSelectedShopeeLinks);
    });

    editModal?.querySelectorAll('[data-schedule-modal-close]').forEach((el) => {
        el.addEventListener('click', closeEditModal);
    });

    btnSaveEdit?.addEventListener('click', () => {
        // Nếu có scheduleId hợp lệ → cập nhật; không có → tạo mới (duplicate)
        const id = editFields.id?.value?.trim();
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id || '');
        if (id && isValidObjectId) {
            saveEditedSchedule();
        } else {
            saveDuplicateSchedule();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeEditModal();
    });

    rows.forEach((row) => {
        row.setAttribute('tabindex', '0');
        row.addEventListener('click', (event) => {
            if (event.target.closest('button, a, select, option, input, textarea, label')) return;
            openEditModalFromRow(row);
        });
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openEditModalFromRow(row);
            }
        });
    });

    runButtons.forEach((btn) => {
        btn.addEventListener('click', async (event) => {
            event.stopPropagation();
            await runScheduleById(btn.dataset.scheduleId, btn);
        });
    });

    deleteButtons.forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.scheduleId;
            if (!id) return;

            showConfirm('Bạn có chắc muốn xoá lịch trình này?', async () => {
                try {
                    const res = await fetch(`/schedule/api/${id}`, { method: 'DELETE' });
                    const data = await res.json();
                    if (data.success) {
                        const row = document.querySelector(`.schedule-row[data-id="${id}"]`);
                        row?.remove();
                        showToast('Đã xoá lịch trình', 'success');
                        applyFilters();
                    } else {
                        showToast(data.message || 'Xoá thất bại', 'error');
                    }
                } catch (error) {
                    showToast('Lỗi kết nối server', 'error');
                }
            });
        });
    });

    document.querySelectorAll('.btn-view-schedule').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.scheduleId;
            if (!id) return;

            const row = btn.closest('.schedule-row');
            openEditModalFromRow(row);
        });
    });

    document.querySelectorAll('.btn-duplicate-schedule').forEach((btn) => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.schedule-row');
            if (row) openDuplicateModal(row);
        });
    });

    editAllAffiliateLinks = Array.isArray(managerData.shopeeLinks) ? managerData.shopeeLinks : [];
    renderEditVideoOptions();
    renderEditAffiliateComboboxList(editAllAffiliateLinks, '');
    renderEditFacebookSourceOptions();
    initEditPhonePreview();

    renderPagination();
    applyFilters();

    // ===== SOCKET.IO REALTIME UPDATE =====
    function initSocketRealtime() {
        const userId = window.__CURRENT_USER_ID || null;
        if (!userId) {
            console.warn('[Socket.IO] No userId found, cannot join user room');
            return;
        }
        
        if (typeof io !== 'undefined') {
            const socket = io(window.location.origin, {
                transports: ['websocket', 'polling']
            });
            
            socket.on('connect', () => {
                console.log('[Socket.IO] Connected to realtime server');
                socket.emit('join-user', userId);
            });
            
            socket.on('schedule-update', (data) => {
                console.log('[Socket.IO] schedule-update received:', data);
                if (!data || !data._id) return;
                
                // Update the specific row in realtime
                updateRowFromScheduleData(data);
                
                // Update stats numbers
                updateStatsFromStatusChange(data.status || '');
                
                // Show toast notification
                if (data.status === 'posted') {
                    showToast('Bài viết đã được đăng thành công!', 'success');
                } else if (data.status === 'failed') {
                    showToast('Bài viết đăng thất bại!', 'error');
                }
            });
            
            socket.on('disconnect', () => {
                console.log('[Socket.IO] Disconnected from realtime server');
            });
        }
    }
    
    function updateStatsFromStatusChange(status) {
        const statTotal = document.querySelector('.stat-card-mini:first-child strong');
        const statPending = document.querySelector('.stat-card-mini.stat-pending strong');
        const statPosted = document.querySelector('.stat-card-mini.stat-posted strong');
        const statFailed = document.querySelector('.stat-card-mini.stat-failed strong');
        
        if (statTotal) statTotal.textContent = parseInt(statTotal.textContent || '0') + 0; // total stays same
        
        if (status === 'posted') {
            if (statPending) statPending.textContent = Math.max(0, parseInt(statPending.textContent || '0') - 1);
            if (statPosted) statPosted.textContent = parseInt(statPosted.textContent || '0') + 1;
        } else if (status === 'failed') {
            if (statPending) statPending.textContent = Math.max(0, parseInt(statPending.textContent || '0') - 1);
            if (statFailed) statFailed.textContent = parseInt(statFailed.textContent || '0') + 1;
        }
    }
    
    // Initialize socket realtime
    initSocketRealtime();

    setInterval(refreshManagerRowsFromServer, 15000);
    refreshManagerRowsFromServer();
});
