/* ===================================
   SCHEDULE MANAGER EDIT MODAL - Open, close, save, duplicate modal
   =================================== */

let currentEditPayload = null;
let editSelectedPlatform = null;
let editSelectedPlatforms = []; // Multi-platform support: lưu tất cả platform đã chọn
let editSelectedAccountIds = []; // Lưu tất cả account IDs đã chọn
let editNewImages = [];
let editExistingImages = [];
let editLocalVideoFile = null;

function applyEditModalHeader(mode) {
    const eyebrow = document.getElementById('editModalEyebrow');
    const title = document.getElementById('scheduleModalTitle');
    const subhead = document.getElementById('editModalSubhead');
    if (mode === 'duplicate') {
        if (eyebrow) eyebrow.textContent = 'Sao chép lịch trình';
        if (title) title.textContent = 'Tạo bản sao từ lịch hiện tại';
        if (subhead) subhead.textContent = 'Dữ liệu đã được sao chép. Thay đổi thời gian và lưu để tạo lịch mới.';
        if (btnSaveEdit) { btnSaveEdit.textContent = 'Tạo lịch sao chép'; btnSaveEdit.disabled = false; btnSaveEdit.style.opacity = '1'; }
    } else {
        if (eyebrow) eyebrow.textContent = 'Chỉnh sửa lịch trình';
        if (title) title.textContent = 'Xem & cập nhật lịch';
        if (subhead) subhead.textContent = 'Chỉnh sửa dữ liệu thật từ hệ thống, chọn lại nền tảng, tài khoản, group, video và link affiliate.';
        if (btnSaveEdit) btnSaveEdit.textContent = 'Lưu thay đổi';
    }
}

function applyEditTypeSection(type) {
    document.querySelectorAll('.schedule-edit-post, .schedule-edit-reels').forEach(el => el.classList.remove('visible'));
    if (type === 'post') {
        document.getElementById('editGroupSection')?.classList.add('visible');
        document.getElementById('editPostImagesSection')?.classList.add('visible');
    } else {
        document.getElementById('editReelsVideoSection')?.classList.add('visible');
        document.getElementById('editAffiliateSection')?.classList.add('visible');
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
            <i class="${meta.icon}"></i><span>${meta.label}</span>
        </button>`;
    }).join('');

    container.querySelectorAll('.schedule-platform-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            // Multi-select: toggle platform
            const code = chip.dataset.platform;
            const isCurrentlyActive = chip.classList.contains('active');

            if (isCurrentlyActive) {
                chip.classList.remove('active');
                editSelectedPlatforms = editSelectedPlatforms.filter(p => p !== code);
                // Cleanup accounts thuộc platform này
                const channelCode = PLATFORM_TO_CHANNEL[code] || code;
                editSelectedAccountIds = editSelectedAccountIds.filter(id => {
                    const ch = managerData.channels?.find(c => String(c._id) === String(id));
                    return ch && ch.platform !== channelCode;
                });
            } else {
                chip.classList.add('active');
                if (!editSelectedPlatforms.includes(code)) editSelectedPlatforms.push(code);
            }

            // Set first active as editSelectedPlatform để tương thích code cũ
            const firstActive = container.querySelector('.schedule-platform-chip.active');
            editSelectedPlatform = firstActive ? firstActive.dataset.platform : null;

            onEditPlatformChange(type);
        });
    });
}

function onEditPlatformChange(type) {
    const chip = editSelectedPlatform || (type === 'post' ? 'FB' : 'FB');
    renderEditAccountOptions(type, chip, editSelectedAccountIds);
    if (type === 'post') onEditPostPlatformChange();
}

function onEditPostPlatformChange() {
    const isFacebook = editSelectedPlatform === 'FB';
    const groupSection = document.getElementById('editGroupSection');
    if (groupSection) groupSection.classList.toggle('visible', isFacebook);
    if (isFacebook) {
        renderEditFacebookSourceOptions(currentEditPayload?.sourceChannelId || '');
        // Re-render selected group tags (preserved from payload) so they show below the combobox
        renderEditSelectedGroupTags();
        // Do NOT auto-load groups — they will load only when user clicks on combobox
    } else {
        // Clear groups when switching away from Facebook
        editSelectedGroupKeys = []; editFacebookGroups = []; editGroupNamesMap = {}; renderEditSelectedGroupTags();
        const list = document.getElementById('editGroupComboboxList');
        if (list) list.innerHTML = '';
        const hint = document.getElementById('editGroupComboboxHint');
        if (hint) hint.innerHTML = '<i class="fa-solid fa-lightbulb"></i> Chọn tài khoản Facebook để hiển thị danh sách nhóm';
    }
}

function renderEditAccountOptions(type, selectedPlatform = null, selectedAccountIds = []) {
    if (!editFields.accounts) return;
    const channels = Array.isArray(managerData.channels) ? managerData.channels : [];
    let filterPlatforms;
    if (type === 'post') {
        // Post: hiển thị accounts của TẤT CẢ platforms đã chọn
        filterPlatforms = editSelectedPlatforms.length > 0
            ? editSelectedPlatforms.map(p => PLATFORM_TO_CHANNEL[p] || p)
            : ['FB', 'IG'];
    } else {
        // Reels: hiển thị accounts của TẤT CẢ platforms đã chọn
        filterPlatforms = editSelectedPlatforms.length > 0
            ? editSelectedPlatforms.map(p => PLATFORM_TO_CHANNEL[p] || p)
            : (selectedPlatform ? [PLATFORM_TO_CHANNEL[selectedPlatform] || selectedPlatform] : ['FB']);
    }
    const filtered = channels.filter(ch => filterPlatforms.includes(String(ch.platform || '').trim()));
    editFields.accounts.innerHTML = filtered.map((ch) => {
        const meta = PLATFORM_META[ch.platform] || { label: ch.platform, icon: 'fa-solid fa-user' };
        const badge = ch.accountType ? ` · ${ch.accountType}` : '';
        const sel = selectedAccountIds.includes(String(ch._id)) ? 'selected' : '';
        return `<option value="${ch._id}" ${sel}>${ch.accountName}${badge} [${meta.label}]</option>`;
    }).join('');
    const desc = document.getElementById('editAccountsDesc');
    if (desc) {
        const total = filtered.length;
        const platformList = editSelectedPlatforms.length > 0 ? editSelectedPlatforms.join(', ') : 'chưa chọn';
        desc.textContent = `${total} tài khoản thuộc: ${platformList}`;
    }
}

function renderEditFacebookSourceOptions(selectedSourceId = '') {
    if (!editFields.sourceChannelId) return;
    const fbChannels = Array.isArray(managerData.facebookChannels) ? managerData.facebookChannels : [];
    editFields.sourceChannelId.innerHTML = ['<option value="">-- Chọn tài khoản Facebook nguồn --</option>']
        .concat(fbChannels.map(ch => `<option value="${ch._id}" ${String(ch._id) === String(selectedSourceId) ? 'selected' : ''}>${ch.accountName}${ch.accountType ? ' · ' + ch.accountType : ''}</option>`))
        .join('');
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
        btn.addEventListener('click', () => { const idx = parseInt(btn.dataset.idx); editExistingImages.splice(idx, 1); renderEditPostImages(editExistingImages); });
    });
}

function setSummaryBar(payload = {}) {
    if (summaryFields.type) summaryFields.type.textContent = payload.typeLabel || '—';
    if (summaryFields.status) summaryFields.status.textContent = payload.statusLabel || '—';
    if (summaryFields.time) summaryFields.time.textContent = formatReadableTime(payload.publishedAtIso) || '—';
}

function openEditModalFromRow(row) {
    const payload = getPayloadFromRow(row);
    if (!payload || !editModal) return;
    applyEditModalHeader('edit');
    currentEditPayload = payload;
    editNewImages = []; editExistingImages = []; editLocalVideoFile = null; editSelectedShopeeLinks = []; editSelectedGroupKeys = []; editFacebookGroups = [];
    setEditGroupNamesFromPayload(payload);
    if (editFields.id) editFields.id.value = payload.id || row.dataset.id || '';
    if (editFields.caption) editFields.caption.value = payload.caption || '';
    if (editFields.status) editFields.status.value = payload.status || 'pending';
    const type = payload.type || 'post';
    if (editFields.type) editFields.type.value = type;
    const scheduledDate = payload.publishedAtIso || payload.scheduledAt || '';
    if (editFields.dateTime) editFields.dateTime.value = formatForDateTimeLocal(scheduledDate);
    const platforms = Array.isArray(payload.platforms) ? payload.platforms : [];
    editSelectedPlatforms = [...platforms];
    editSelectedPlatform = platforms[0] || 'FB';
    // Lưu các account IDs đã chọn từ payload
    editSelectedAccountIds = Array.isArray(payload.accounts) ? payload.accounts.map(String) : [];
    applyEditTypeSection(type);
    renderEditPlatformChips(type, platforms);
    renderEditAccountOptions(type, editSelectedPlatform, editSelectedAccountIds);
    if (type === 'post') {
        const images = Array.isArray(payload.images) ? payload.images : [];
        renderEditPostImages(images);
        editSelectedGroupKeys = Array.isArray(payload.targetGroupId) ? payload.targetGroupId : (payload.targetGroupId ? [payload.targetGroupId] : []);
        renderEditSelectedGroupTags();
        setTimeout(() => onEditPostPlatformChange(), 50);
    } else {
        editAllAffiliateLinks = Array.isArray(managerData.shopeeLinks) ? managerData.shopeeLinks : [];
        const linkIds = payload.shopeeLinkIds || [];
        editSelectedShopeeLinks = [...linkIds];
        renderEditVideoOptions(payload.videoId || '');
        const videoUrl = payload.videoUrl || payload.videoPath || '';
        if (videoUrl) showEditVideoPreview(videoUrl, payload.videoTitle || 'Video đã chọn');
        else if (payload.videoId) setTimeout(() => updateEditPhoneFromSelect(), 0);
        else hideEditVideoPreview();
        renderEditAffiliateComboboxList(editAllAffiliateLinks, '');
        renderEditAffiliateUrls();
        renderEditAffiliateSelectedBadge();
    }
    if (editFields.meta) {
        const videoTitle = payload.videoTitle || '—'; const linkCount = payload.shopeeLinksCount || 0; const sourceName = payload.sourceChannelName || '—';
        editFields.meta.innerHTML = `<div class="schedule-meta-grid"><div><span>Video</span><strong>${safeText(videoTitle)}</strong></div><div><span>Link Affiliate</span><strong>${linkCount}</strong></div><div><span>Nguồn</span><strong>${safeText(sourceName)}</strong></div></div>`;
        if (payload.publishedUrl) editFields.meta.innerHTML += `<div style="margin-top:8px;"><a href="${safeText(payload.publishedUrl)}" target="_blank">Mở bài đã đăng</a></div>`;
    }
    setSummaryBar(payload);
    if (btnSaveEdit) { const isPosted = payload.status === 'posted'; btnSaveEdit.disabled = isPosted; btnSaveEdit.textContent = isPosted ? 'Đã đăng' : 'Lưu thay đổi'; btnSaveEdit.style.opacity = isPosted ? '0.6' : '1'; }
    editModal.classList.add('open'); editModal.setAttribute('aria-hidden', 'false');
}

function openDuplicateModal(row) {
    const payload = getPayloadFromRow(row);
    if (!payload || !editModal) return;
    applyEditModalHeader('duplicate');
    const newPayload = { ...payload, id: undefined };
    currentEditPayload = newPayload; editNewImages = []; editExistingImages = []; editLocalVideoFile = null;
    editSelectedShopeeLinks = [...(payload.shopeeLinkIds || [])];
    editSelectedGroupKeys = Array.isArray(payload.targetGroupId) ? [...payload.targetGroupId] : [];
    editFacebookGroups = [];
    setEditGroupNamesFromPayload(payload);
    if (editFields.id) editFields.id.value = '';
    if (editFields.caption) editFields.caption.value = payload.caption || '';
    if (editFields.status) editFields.status.value = 'pending';
    const type = payload.type || 'post';
    if (editFields.type) editFields.type.value = type;
    if (editFields.dateTime) editFields.dateTime.value = '';
    const platforms = Array.isArray(payload.platforms) ? payload.platforms : [];
    editSelectedPlatforms = [...platforms];
    editSelectedPlatform = platforms[0] || 'FB';
    editSelectedAccountIds = Array.isArray(payload.accounts) ? payload.accounts.map(String) : [];
    applyEditTypeSection(type);
    renderEditPlatformChips(type, platforms);
    renderEditAccountOptions(type, editSelectedPlatform, editSelectedAccountIds);
    if (type === 'post') {
        const images = Array.isArray(payload.images) ? payload.images : [];
        renderEditPostImages(images);
        editSelectedGroupKeys = Array.isArray(payload.targetGroupId) ? [...payload.targetGroupId] : [];
        renderEditSelectedGroupTags();
        setTimeout(() => onEditPostPlatformChange(), 50);
    } else {
        editAllAffiliateLinks = Array.isArray(managerData.shopeeLinks) ? managerData.shopeeLinks : [];
        renderEditVideoOptions(payload.videoId || ''); setTimeout(() => updateEditPhoneFromSelect(), 0);
        renderEditAffiliateComboboxList(editAllAffiliateLinks, ''); renderEditAffiliateUrls(); renderEditAffiliateSelectedBadge();
        const videoUrl = payload.videoUrl || payload.videoPath || '';
        if (videoUrl) showEditVideoPreview(videoUrl, payload.videoTitle || 'Video đã chọn'); else hideEditVideoPreview();
    }
    if (editFields.meta) editFields.meta.innerHTML = '—';
    setSummaryBar(newPayload);
    editModal.classList.add('open'); editModal.setAttribute('aria-hidden', 'false');
}

function closeEditModal() {
    if (!editModal) return;
    editModal.classList.remove('open'); editModal.setAttribute('aria-hidden', 'true');
    document.getElementById('editGroupComboboxDropdown')?.classList.remove('open');
    document.getElementById('editAffiliateComboboxDropdown')?.classList.remove('open');
    if (btnSaveEdit) { btnSaveEdit.disabled = false; btnSaveEdit.textContent = 'Lưu thay đổi'; btnSaveEdit.style.opacity = '1'; }
    currentEditPayload = null;
    editSelectedPlatform = null;
    editSelectedPlatforms = [];
    editSelectedAccountIds = [];
    editNewImages = []; editExistingImages = []; editLocalVideoFile = null;
}

async function saveEditedSchedule() {
    const scheduleId = (editFields.id?.value || '').trim();
    if (!scheduleId || !/^[0-9a-fA-F]{24}$/.test(scheduleId)) { showToast('Không tìm thấy ID lịch trình. Vui lòng thử mở lại modal.', 'error'); return; }
    const type = editFields.type?.value || 'post';
    const selectedAccounts = Array.from(editFields.accounts?.selectedOptions || []).map((opt) => opt.value);
    const scheduledAtValue = editFields.dateTime?.value;
    if (scheduledAtValue) { const scheduledDate = new Date(scheduledAtValue); if (scheduledDate < new Date()) { showToast('Thời gian đăng không được ở quá khứ!', 'warning'); return; } }
    let finalStatus = editFields.status?.value || 'pending';
    if (finalStatus === 'failed' || finalStatus === 'pending') finalStatus = 'pending';
    const videoId = editFields.videoId?.value || (currentEditPayload?.videoId ? (typeof currentEditPayload.videoId === 'object' ? currentEditPayload.videoId._id : currentEditPayload.videoId) : '');
    const payload = {
        scheduleId, type, status: finalStatus, caption: editFields.caption?.value || '',
        scheduledAt: scheduledAtValue ? new Date(scheduledAtValue).toISOString() : '',
        // Gửi TẤT CẢ platforms đã chọn (multi-select), fallback về 1 platform nếu rỗng
        platforms: editSelectedPlatforms.length > 0
            ? [...editSelectedPlatforms]
            : [editSelectedPlatform || (type === 'post' ? 'FB' : 'FR')],
        accounts: selectedAccounts, videoId,
        targetGroupSourceChannelId: type === 'post' ? (editFields.sourceChannelId?.value || '') : '',
        targetGroupIds: type === 'post' && (editSelectedPlatforms.includes('FB') || editSelectedPlatform === 'FB') ? editSelectedGroupKeys : [],
        shopeeLinks: editSelectedShopeeLinks, existingImages: editExistingImages.filter(url => !url.startsWith('blob:')), newImages: editNewImages, localVideoFile: editLocalVideoFile
    };
    try {
        const hasNewImages = Array.isArray(payload.newImages) && payload.newImages.length > 0;
        const hasLocalVideo = payload.localVideoFile instanceof File;
        let url = '/schedule/api/update', method = 'PUT', body;
        if (hasNewImages || hasLocalVideo) {
            const formData = new FormData();
            formData.append('scheduleId', payload.scheduleId); formData.append('type', payload.type); formData.append('status', payload.status);
            formData.append('caption', payload.caption); if (payload.scheduledAt) formData.append('scheduledAt', payload.scheduledAt);
            payload.platforms.forEach(p => formData.append('platforms', p)); selectedAccounts.forEach(a => formData.append('accounts', a));
            formData.append('videoId', payload.videoId);
            if (type === 'post') { if (payload.targetGroupSourceChannelId) formData.append('targetGroupSourceChannelId', payload.targetGroupSourceChannelId); payload.targetGroupIds.forEach(g => formData.append('targetGroupIds', g)); }
            editSelectedShopeeLinks.forEach(l => formData.append('shopeeLinks', l)); payload.newImages.forEach(file => formData.append('images', file));
            if (payload.localVideoFile instanceof File) formData.append('localVideo', payload.localVideoFile);
            body = formData;
        } else {
            const jsonBody = { scheduleId: payload.scheduleId, type: payload.type, status: payload.status, caption: payload.caption, scheduledAt: payload.scheduledAt, platforms: payload.platforms, accounts: selectedAccounts, videoId: payload.videoId, shopeeLinks: editSelectedShopeeLinks };
            if (type === 'post') { jsonBody.targetGroupSourceChannelId = payload.targetGroupSourceChannelId; jsonBody.targetGroupIds = payload.targetGroupIds; }
            body = JSON.stringify(jsonBody);
        }
        const res = await fetch(url, { method, headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Không lưu được lịch trình', 'error'); return; }
        showToast('Đã cập nhật lịch trình', 'success'); location.reload();
    } catch (error) { console.error('saveEditedSchedule error:', error); showToast('Lỗi kết nối server: ' + (error.message || 'Không rõ nguyên nhân'), 'error'); }
}

async function saveDuplicateSchedule() {
    const type = editFields.type?.value || 'post';
    const selectedAccounts = Array.from(editFields.accounts?.selectedOptions || []).map((opt) => opt.value);
    const scheduledAtValue = editFields.dateTime?.value;
    if (!scheduledAtValue) { showToast('Vui lòng chọn thời gian đăng!', 'warning'); return; }
    const scheduledDate = new Date(scheduledAtValue);
    if (scheduledDate < new Date()) { showToast('Thời gian đăng không được ở quá khứ!', 'warning'); return; }
    const videoId = editFields.videoId?.value || (currentEditPayload?.videoId ? (typeof currentEditPayload.videoId === 'object' ? currentEditPayload.videoId._id : currentEditPayload.videoId) : '');
    const origPayload = currentEditPayload || {};
    const payload = {
        type, status: 'pending', caption: editFields.caption?.value || origPayload.caption || '',
        scheduledAt: new Date(scheduledAtValue).toISOString(),
        platforms: editSelectedPlatforms.length > 0
            ? [...editSelectedPlatforms]
            : [editSelectedPlatform || (type === 'post' ? 'FB' : 'FR')], accounts: selectedAccounts, videoId,
        videoTitle: origPayload.videoTitle || '', videoPath: origPayload.videoPath || origPayload.videoUrl || '',
        videoUrl: origPayload.videoUrl || origPayload.videoPath || '',
        targetGroupSourceChannelId: type === 'post' ? (editFields.sourceChannelId?.value || origPayload.sourceChannelId || '') : '',
        targetGroupId: type === 'post' && editSelectedPlatform === 'FB' ? editSelectedGroupKeys : [],
        shopeeLinks: editSelectedShopeeLinks, existingImages: editExistingImages.filter(url => !url.startsWith('blob:')), newImages: editNewImages, localVideoFile: editLocalVideoFile
    };
    try {
        const hasNewImages = Array.isArray(payload.newImages) && payload.newImages.length > 0;
        const hasLocalVideo = payload.localVideoFile instanceof File;
        let body, method = 'POST';
        if (hasNewImages || hasLocalVideo) {
            const formData = new FormData();
            formData.append('type', payload.type); formData.append('status', payload.status); formData.append('caption', payload.caption);
            if (payload.scheduledAt) formData.append('scheduledAt', payload.scheduledAt);
            payload.platforms.forEach(p => formData.append('platforms', p)); selectedAccounts.forEach(a => formData.append('accounts', a));
            formData.append('videoId', payload.videoId);
            if (type === 'post') { if (payload.targetGroupSourceChannelId) formData.append('targetGroupSourceChannelId', payload.targetGroupSourceChannelId); (payload.targetGroupId || []).forEach(g => formData.append('targetGroupId', g)); }
            editSelectedShopeeLinks.forEach(l => formData.append('shopeeLinks', l)); payload.newImages.forEach(file => formData.append('images', file));
            if (payload.localVideoFile instanceof File) formData.append('localVideo', payload.localVideoFile);
            body = formData;
        } else { body = JSON.stringify(payload); }
        const res = await fetch('/schedule/api/create', { method, headers: body instanceof FormData ? {} : { 'Content-Type': 'application/json' }, body });
        const data = await res.json();
        if (!data.success) { showToast(data.message || 'Không tạo được lịch trình: ' + res.status, 'error'); console.warn('[saveDuplicateSchedule] error:', data); return; }
        closeEditModal(); showToast('Đã tạo lịch trình sao chép thành công!', 'success'); setTimeout(() => location.reload(), 1000);
    } catch (error) { console.error('saveEditedSchedule error:', error); showToast('Lỗi kết nối server: ' + (error.message || 'Không rõ nguyên nhân'), 'error'); }
}