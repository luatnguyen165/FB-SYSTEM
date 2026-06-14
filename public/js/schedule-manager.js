/* ===================================
   SCHEDULE-MANAGER.JS - Main entry point
   Loads all schedule-manager sub-modules via script tags
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
    const managerDataEl = document.getElementById('scheduleManagerData');
    const managerData = window.managerData = managerDataEl?.textContent ? JSON.parse(managerDataEl.textContent.trim()) : {};
    const searchInput = window.searchInput = document.getElementById('scheduleSearchInput');
    const platformFilter = window.platformFilter = document.getElementById('platformFilter');
    const statusFilter = window.statusFilter = document.getElementById('statusFilter');
    const rows = window.rows = Array.from(document.querySelectorAll('.schedule-row'));
    const runButtons = Array.from(document.querySelectorAll('.btn-run-schedule'));
    const deleteButtons = Array.from(document.querySelectorAll('.btn-delete-schedule'));
    const tableBody = window.tableBody = document.querySelector('#scheduleManagerTable tbody');
    const paginationEl = window.paginationEl = document.getElementById('schedulePagination');
    const editModal = window.editModal = document.getElementById('scheduleEditModal');
    const editFields = window.editFields = {
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
    const btnSaveEdit = window.btnSaveEdit = document.getElementById('btnSaveScheduleEdit');
    const btnRefreshGroups = document.getElementById('btnRefreshScheduleManagerGroups');
    const summaryFields = window.summaryFields = {
        type: document.getElementById('scheduleSummaryType'),
        status: document.getElementById('scheduleSummaryStatus'),
        time: document.getElementById('scheduleSummaryTime')
    };

    if (statusFilter) statusFilter.value = 'all';

    // Event listeners
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
        if (!editFields.sourceChannelId?.value) { showToast('Hãy chọn tài khoản nguồn trước', 'warning'); return; }
        showToast('Đang tải lại danh sách nhóm...', 'info');
        void loadEditFacebookGroups(editFields.sourceChannelId.value, editSelectedGroupKeys);
    });

    document.getElementById('editGroupSearchInput')?.addEventListener('input', (e) => {
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        if (editFacebookGroups.length > 0) dropdown?.classList.add('open');
        renderEditGroupComboboxList(editFacebookGroups, e.target.value);
    });

    document.querySelector('#editGroupCombobox .combobox-input-wrapper')?.addEventListener('click', () => {
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        if (editFacebookGroups.length > 0) dropdown?.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        const combobox = document.getElementById('editGroupCombobox');
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        if (!combobox?.contains(e.target)) dropdown?.classList.remove('open');
        const affDropdown = document.getElementById('editAffiliateComboboxDropdown');
        const affCombobox = document.getElementById('editAffiliateCombobox');
        if (affDropdown && affCombobox && !affCombobox.contains(e.target)) affDropdown.classList.remove('open');
    });

    // Affiliate combobox events
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
    document.querySelectorAll('#editVideoSourceTabs .video-source-tab').forEach(tab => {
        tab.addEventListener('click', () => switchEditVideoTab(tab.dataset.source));
    });

    // Video library select change -> preview video on phone
    editFields.videoId?.addEventListener('change', () => {
        const selected = editFields.videoId.selectedOptions[0];
        if (!selected || !selected.value) { hideEditVideoPreview(); return; }
        const videos = Array.isArray(managerData.videos) ? managerData.videos : [];
        const video = videos.find(v => String(v._id) === selected.value);
        if (video) showEditVideoPreview(video.fileUrl || video.filePath || '', video.title || selected.text);
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

    // Dropzone drag events for video
    const dropzone = document.getElementById('editVideoDropzone');
    if (dropzone) {
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault(); dropzone.classList.remove('drag-over');
            const file = e.dataTransfer?.files[0];
            if (file && file.type.startsWith('video/')) {
                const dt = new DataTransfer(); dt.items.add(file);
                const input = document.getElementById('editVideoFileInput');
                if (input) { input.files = dt.files; input.dispatchEvent(new Event('change')); }
            }
        });
    }

    // Image add button
    document.getElementById('btnAddEditImages')?.addEventListener('click', () => document.getElementById('editImageFileInput')?.click());
    document.getElementById('editImageFileInput')?.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        files.forEach(file => { editNewImages.push(file); editExistingImages.push(URL.createObjectURL(file)); });
        renderEditPostImages(editExistingImages);
        e.target.value = '';
    });

    // Modal close buttons
    editModal?.querySelectorAll('[data-schedule-modal-close]').forEach((el) => el.addEventListener('click', closeEditModal));

    btnSaveEdit?.addEventListener('click', () => {
        const id = editFields.id?.value?.trim();
        if (id && /^[0-9a-fA-F]{24}$/.test(id)) saveEditedSchedule();
        else saveDuplicateSchedule();
    });

    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeEditModal(); });

    rows.forEach((row) => {
        row.setAttribute('tabindex', '0');
        row.addEventListener('click', (event) => {
            if (event.target.closest('button, a, select, option, input, textarea, label')) return;
            openEditModalFromRow(row);
        });
        row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEditModalFromRow(row); } });
    });

    runButtons.forEach((btn) => {
        btn.addEventListener('click', async (event) => { event.stopPropagation(); await runScheduleById(btn.dataset.scheduleId, btn); });
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
                        document.querySelector(`.schedule-row[data-id="${id}"]`)?.remove();
                        showToast('Đã xoá lịch trình', 'success');
                        applyFilters();
                    } else { showToast(data.message || 'Xoá thất bại', 'error'); }
                } catch (error) { showToast('Lỗi kết nối server', 'error'); }
            });
        });
    });

    document.querySelectorAll('.btn-view-schedule').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('.schedule-row');
            if (row) openEditModalFromRow(row);
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
    initSocketRealtime();
    setInterval(refreshManagerRowsFromServer, 15000);
    refreshManagerRowsFromServer();
});