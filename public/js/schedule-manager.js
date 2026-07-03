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
        // Clear loaded groups data when source changes, but preserve selected group keys & names (already set from payload)
        editFacebookGroups = [];
        renderEditSelectedGroupTags();
        const list = document.getElementById('editGroupComboboxList');
        if (list) list.innerHTML = '';
        const dropdown = document.getElementById('editGroupComboboxDropdown');
        if (dropdown) dropdown.classList.remove('open');
        const hint = document.getElementById('editGroupComboboxHint');
        if (hint) hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Click vào ô tìm kiếm để hiển thị danh sách nhóm';
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
        const sourceChannelId = editFields.sourceChannelId?.value;
        if (editFacebookGroups.length === 0 && sourceChannelId) {
            // Load groups on demand when user clicks on the combobox
            void loadEditFacebookGroups(sourceChannelId, editSelectedGroupKeys);
        } else if (editFacebookGroups.length > 0) {
            dropdown?.classList.toggle('open');
        }
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

    document.querySelectorAll('.btn-group-results').forEach((btn) => {
        btn.addEventListener('click', () => {
            let groupResults = [];
            let targetGroupIds = [];
            try { groupResults = JSON.parse(btn.dataset.groupResults || '[]'); } catch (e) {}
            try { targetGroupIds = JSON.parse(btn.dataset.targetGroupIds || '[]'); } catch (e) {}
            showGroupResultsPopup(groupResults, targetGroupIds);
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

function showGroupResultsPopup(groupResults, targetGroupIds) {
    const existing = document.getElementById('groupResultsPopup');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'groupResultsPopup';
    overlay.className = 'group-results-popup-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';

    let bodyHtml = '';
    if (!groupResults || groupResults.length === 0) {
        const groupCount = (targetGroupIds || []).length;
        bodyHtml = `<div style="text-align:center;padding:32px 16px;color:#999;">
            <i class="fa-solid fa-inbox" style="font-size:32px;margin-bottom:12px;display:block;"></i>
            Chưa có kết quả${groupCount > 0 ? ` (${groupCount} nhóm đã chọn)` : ''}. Chạy schedule để xem kết quả.
        </div>`;
    } else {
        const successCount = groupResults.filter(r => r.success && !r.skipped).length;
        const skipCount = groupResults.filter(r => r.skipped).length;
        const failCount = groupResults.filter(r => !r.success && !r.skipped).length;

        bodyHtml = `<div style="margin-bottom:12px;font-size:13px;color:#555;">
            ${groupResults.length} nhóm — <span style="color:#28a745;">✅ ${successCount} thành công</span>
            ${skipCount > 0 ? ` · <span style="color:#ffc107;">⏭ ${skipCount} bỏ qua</span>` : ''}
            ${failCount > 0 ? ` · <span style="color:#dc3545;">❌ ${failCount} thất bại</span>` : ''}
        </div>
        <div style="overflow-x:auto;">
            <table class="group-results-table" style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr>
                    <th style="width:30px;padding:8px 6px;text-align:center;">#</th>
                    <th style="padding:8px 6px;text-align:left;">Nhóm</th>
                    <th style="width:90px;padding:8px 6px;text-align:center;">Trạng thái</th>
                    <th style="padding:8px 6px;text-align:left;">Link bài đăng</th>
                    <th style="padding:8px 6px;text-align:left;">Lỗi</th>
                    <th style="width:140px;padding:8px 6px;text-align:left;">Thời gian</th>
                </tr></thead>
                <tbody>
                    ${groupResults.map((r, i) => {
                        let badge, text;
                        if (r.skipped) { badge = 'badge-skip'; text = 'Bỏ qua'; }
                        else if (r.success) { badge = 'badge-success'; text = 'Thành công'; }
                        else { badge = 'badge-fail'; text = 'Thất bại'; }
                        const name = r.groupName || r.groupId || r.groupUrl || `Group ${i+1}`;
                        const url = r.publishedUrl || '';
                        const err = r.error || '';
                        const time = r.postedAt ? new Date(r.postedAt).toLocaleString('vi-VN') : '—';
                        return `<tr>
                            <td style="text-align:center;padding:8px 6px;border-top:1px solid var(--border,#e0e0e0);">${i+1}</td>
                            <td style="padding:8px 6px;border-top:1px solid var(--border,#e0e0e0);font-weight:500;" title="${r.groupUrl || r.groupId || ''}">${_safeTextPopup(name)}</td>
                            <td style="text-align:center;padding:8px 6px;border-top:1px solid var(--border,#e0e0e0);"><span class="group-result-badge ${badge}">${text}</span></td>
                            <td style="padding:8px 6px;border-top:1px solid var(--border,#e0e0e0);">${url ? `<a href="${_safeTextPopup(url)}" target="_blank" style="color:#1877f2;font-size:12px;word-break:break-all;">${_safeTextPopup(url)}</a>` : '<span style="color:#999;">—</span>'}</td>
                            <td style="max-width:200px;padding:8px 6px;border-top:1px solid var(--border,#e0e0e0);">${err ? `<span style="color:#dc3545;font-size:12px;word-break:break-all;" title="${_safeTextPopup(err)}">${_safeTextPopup(err)}</span>` : '<span style="color:#999;">—</span>'}</td>
                            <td style="font-size:12px;color:#666;white-space:nowrap;padding:8px 6px;border-top:1px solid var(--border,#e0e0e0);">${time}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
    }

    overlay.innerHTML = `<div style="background:#fff;border-radius:12px;max-width:800px;width:92%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 style="margin:0;font-size:16px;"><i class="fa-solid fa-chart-column"></i> Kết quả đăng bài nhóm</h3>
            <button onclick="this.closest('.group-results-popup-overlay').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;padding:4px 8px;">&times;</button>
        </div>
        ${bodyHtml}
    </div>`;

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

function _safeTextPopup(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}