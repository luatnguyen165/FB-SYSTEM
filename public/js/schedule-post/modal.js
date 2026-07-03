/* ===================================
   SCHEDULE POST MODAL - Modal open/close, form fill/reset, submit, delete
   =================================== */

let currentEditingSchedule = null;

function fillScheduleForm(schedule) {
    if (!schedule) return;
    console.log('[schedule-post] fillScheduleForm - FULL schedule object:', JSON.stringify(schedule, null, 2));
    console.log('[schedule-post] fillScheduleForm - schedule.accounts:', schedule.accounts);
    console.log('[schedule-post] fillScheduleForm - schedule.platforms:', schedule.platforms);
    currentEditingSchedule = schedule;

    const modalFormTitle = document.getElementById('modalFormTitle');
    const modalFormSubtitle = document.getElementById('modalFormSubtitle');
    const submitButton = document.getElementById('btnSubmitPostSchedule');
    const deleteButton = document.getElementById('btnDeleteSchedule');

    if (modalFormTitle) modalFormTitle.textContent = 'Cập nhật bài viết';
    if (modalFormSubtitle) modalFormSubtitle.textContent = 'Chỉnh sửa lịch đăng bài';
    const submitBtnSpan = submitButton?.querySelector('span');
    if (submitBtnSpan) submitBtnSpan.textContent = 'Cập nhật lịch';
    if (submitButton) submitButton.textContent = 'Cập nhật lịch';
    if (deleteButton) deleteButton.style.display = 'inline-flex';

    const captionInput = document.getElementById('modalCaptionInput');
    if (captionInput) captionInput.value = schedule.caption || '';
    if (typeof window.initCaptionEditor === 'function') window.initCaptionEditor();
    if (window.captionEditorAPI) {
        window.captionEditorAPI.setText(schedule.caption || '');
    }
    const titleInput = document.getElementById('modalPostTitleInput');
    if (titleInput) titleInput.value = schedule.postTitle || schedule.title || '';
    setScheduleTimeInputValue(schedule.scheduledAt);

    const existingImages = Array.isArray(schedule.images) ? schedule.images : [];
    uploadedImagesBlobUrls = existingImages.filter(url => String(url).startsWith('blob:'));
    renderSchedulePostImagePreview(existingImages);

    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.checked = (schedule.platforms || []).includes(cb.value);
        const card = cb.closest('.platform-picker-card');
        if (card) card.classList.toggle('is-selected', cb.checked && !cb.disabled);
    });
    console.log('[schedule-post] fillScheduleForm - schedule.accounts:', schedule.accounts);
    console.log('[schedule-post] fillScheduleForm - schedule.platforms:', schedule.platforms);
    renderAccountList(schedule.accounts || []);
    onPlatformChipsChange();

    // Edit mode: chắc chắn section "Tài khoản đăng" + "Nơi đăng" hiện ra
    if (typeof toggleAccountAndTargetSections === 'function') {
        toggleAccountAndTargetSections();
    }

    const sourceChannelId = schedule.targetGroupSourceChannelId?._id || schedule.targetGroupSourceChannelId || '';
    let preferredGroupKeys = [];
    if (schedule.targetGroupIds) {
        preferredGroupKeys = Array.isArray(schedule.targetGroupIds) ? schedule.targetGroupIds : [schedule.targetGroupIds];
    } else if (schedule.targetGroupUrl || schedule.targetGroupId) {
        preferredGroupKeys = [schedule.targetGroupUrl || schedule.targetGroupId];
    }

    if (sourceChannelId) {
        // Set sourceId cho cả 2 biến để platform-target.js và groups.js đồng bộ
        currentGroupSourceChannelId = String(sourceChannelId);
        if (typeof currentFBTargetSource !== 'undefined') {
            currentFBTargetSource = String(sourceChannelId);
        }
        void loadSchedulePostFacebookGroups(String(sourceChannelId), preferredGroupKeys);
    } else {
        // Lấy FB account đang tick (KHÔNG dùng firstFBAccount trong DOM vì có thể sai thứ tự)
        const checkedFB = document.querySelector('.acc-pick-item.acc-platform-FB input[name="modalAccSelect"]:checked');
        if (checkedFB) {
            currentGroupSourceChannelId = checkedFB.value;
            if (typeof currentFBTargetSource !== 'undefined') {
                currentFBTargetSource = checkedFB.value;
            }
            void loadSchedulePostFacebookGroups(checkedFB.value, preferredGroupKeys);
        }
    }

    const firstVisibleAvailable = Array.from(document.querySelectorAll('.platform-check')).find(cb => !cb.disabled && cb.checked);
    if (!firstVisibleAvailable) {
        const fallback = Array.from(document.querySelectorAll('.platform-check')).find(cb => !cb.disabled);
        if (fallback) {
            document.querySelectorAll('.platform-check').forEach(cb => cb.checked = false);
            fallback.checked = true;
            renderAccountList();
        }
    }

}

function resetScheduleForm() {
    currentEditingSchedule = null;
    selectedGroupKeys = [];
    currentGroupSourceChannelId = '';

    const modalFormTitle = document.getElementById('modalFormTitle');
    const modalFormSubtitle = document.getElementById('modalFormSubtitle');
    const submitButton = document.getElementById('btnSubmitPostSchedule');
    const deleteButton = document.getElementById('btnDeleteSchedule');

    if (modalFormTitle) modalFormTitle.textContent = 'Tạo bài viết mới';
    if (modalFormSubtitle) modalFormSubtitle.textContent = 'Đăng album ảnh lên các nhóm Facebook';
    const submitBtnSpan = submitButton?.querySelector('span');
    if (submitBtnSpan) submitBtnSpan.textContent = 'Xác nhận lên lịch';
    if (submitButton) submitButton.textContent = 'Xác nhận lên lịch';
    if (deleteButton) deleteButton.style.display = 'none';

    revokeSchedulePostPreviewUrls();
    uploadedImagesBlobUrls = [];
    selectedSchedulePostImages = [];

    const captionInput = document.getElementById('modalCaptionInput');
    const imageInput = document.getElementById('actualImageInput');

    if (captionInput) captionInput.value = '';
    if (window.captionEditorAPI) window.captionEditorAPI.setText('');
    const titleInput = document.getElementById('modalPostTitleInput');
    if (titleInput) titleInput.value = '';
    if (imageInput) imageInput.value = '';
    setScheduleTimeInputValue('');
    clearSchedulePostImagePreview();

    void loadSchedulePostFacebookGroups('');

    // Mở modal mới: KHÔNG tự tick platform nào, để user chủ động chọn
    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.checked = false;
        const card = cb.closest('.platform-picker-card');
        if (card) card.classList.remove('is-selected');
    });
    toggleFacebookGroupSelectionForSchedulePost();

    const selectedTagsContainer = document.getElementById('selectedGroupTags');
    if (selectedTagsContainer) selectedTagsContainer.innerHTML = '';
    updateGroupSelectedBadge();

    const counter = document.getElementById('phoneCarouselCounterBadge');
    if (counter) counter.innerText = '1/1';

    if (swiperInstance) { swiperInstance.destroy(true, true); swiperInstance = null; }
    renderAccountList();

    // Khi mới mở modal (chưa tick platform) → ẩn "Tài khoản đăng" + "Nơi đăng"
    // Sau khi tick platform mới hiện ra
    toggleAccountAndTargetSections();
}

function toggleAccountAndTargetSections() {
    const accountSection = document.getElementById('accountPickerSection');
    const targetSection = document.getElementById('targetTabsSection');
    const activePlatforms = Array.from(document.querySelectorAll('.platform-check:checked'))
        .map(cb => cb.value)
        .filter(Boolean);
    const hasPlatform = activePlatforms.length > 0;
    if (accountSection) accountSection.style.display = hasPlatform ? '' : 'none';
    if (targetSection) targetSection.style.display = hasPlatform ? '' : 'none';
}

function openCreatePostModal(dayNumber) {
    const now = new Date();
    const submitButton = document.getElementById('btnSubmitPostSchedule');
    if (submitButton) submitButton.textContent = 'Xác nhận lên lịch';
    setSchedulePostInputs(now, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    const timeInput = document.getElementById('modalTimeInput');
    if (timeInput) timeInput.title = `Thời gian hiện tại: ${formatReadableDateTime(now)}`;
    document.getElementById('createPostModal')?.classList.add('open');
    // Init Quill khi modal visible
    if (typeof window.initCaptionEditor === 'function') window.initCaptionEditor();
}

function closeCreatePostModal() {
    document.getElementById('createPostModal')?.classList.remove('open');
}

async function deleteCurrentSchedulePost() {
    if (!currentEditingSchedule?._id) { showToast('Chưa có lịch để xóa', 'warning'); return; }

    showConfirm('Bạn có chắc muốn xóa lịch này?', async () => {
        try {
            const res = await fetch(`/schedule/api/${encodeURIComponent(currentEditingSchedule._id)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                currentEditingSchedule = null;
                closeCreatePostModal();
                location.reload();
            } else {
                showToast('Lỗi: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
        }
    });
}

async function submitPostSchedule() {
    const caption = document.getElementById('modalCaptionInput')?.value || '';
    const postTitle = document.getElementById('modalPostTitleInput')?.value?.trim() || '';
    syncSchedulePostTimeInput();
    const scheduledAt = document.getElementById('modalTimeInput')?.value;
    const platforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const accounts = Array.from(document.querySelectorAll('input[name="modalAccSelect"]:checked')).map(cb => cb.value);

    console.log('[schedule-submit] platforms:', platforms);
    console.log('[schedule-submit] postTitle:', postTitle);

    // Giới hạn 1000 ký tự cho tất cả nền tảng (Threads tự truncate xuống 500 bên backend)
    if (caption.length > 1000) {
        showToast(`Nội dung vượt quá 1000 ký tự (${caption.length}/1000). Vui lòng rút ngắn!`, 'warning');
        document.getElementById('modalCaptionInput')?.focus();
        return;
    }

    // Pinterest yêu cầu bắt buộc có tiêu đề
    const hasPI = platforms.includes('PI');
    if (hasPI && !postTitle) {
        showToast('Pinterest yêu cầu phải có tiêu đề bài viết!', 'warning');
        document.getElementById('modalPostTitleInput')?.focus();
        return;
    }

    const selectedGroups = getSelectedGroups();
    const targetGroupIds = selectedGroups.map(g => g.groupUrl || g.groupId);

    if (schedulePostGroupsLoading) { showToast('Đang tải danh sách group, vui lòng chờ...', 'warning'); return; }
    if (!scheduledAt) { showToast('Vui lòng chọn thời gian đăng!', 'warning'); return; }

    const dateInput = document.getElementById('modalDateInput')?.value || '';
    const timeValue = document.getElementById('modalClockInput')?.value || '09:00';

    if (isPastDateTime(dateInput, timeValue)) { showToast('Không thể lên lịch vào thời gian trong quá khứ!', 'warning'); return; }

    // Nếu chọn Instagram/Threads/Pinterest, bắt buộc phải có ảnh (bao gồm cả ảnh đã lưu trong lịch đang edit)
    if (platforms.includes('IG') || platforms.includes('TH') || platforms.includes('PI')) {
        const existingImagesCount = currentEditingSchedule && Array.isArray(currentEditingSchedule.images)
            ? currentEditingSchedule.images.filter(Boolean).length
            : 0;
        const newFilesCount = (document.getElementById('actualImageInput')?.files?.length || 0);
        const hasImages = uploadedImagesBlobUrls.length > 0
            || selectedSchedulePostImages.length > 0
            || newFilesCount > 0
            || existingImagesCount > 0;
        if (!hasImages) {
            const names = [];
            if (platforms.includes('IG')) names.push('Instagram');
            if (platforms.includes('TH')) names.push('Threads');
            if (platforms.includes('PI')) names.push('Pinterest');
            showToast(`${names.join('/')} yêu cầu phải có ít nhất 1 hình ảnh!`, 'warning');
            return;
        }
    }

    const formData = new FormData();
    formData.append('type', 'post');
    formData.append('caption', caption);
    if (postTitle) formData.append('postTitle', postTitle);
    formData.append('scheduledAt', parseDateInputToIso(dateInput, timeValue) || scheduledAt);

    if (platforms.includes('FB')) {
        const postTargetType = window.fbPostTargetType || 'group';
        if (postTargetType === 'group') {
            if (targetGroupIds.length === 0) { showToast('Vui lòng chọn ít nhất một group Facebook để đăng bài!', 'warning'); return; }
            if (!currentGroupSourceChannelId) { showToast('Vui lòng chọn tài khoản Facebook nguồn!', 'warning'); return; }
            formData.append('targetGroupSourceChannelId', currentGroupSourceChannelId);
            formData.append('targetGroupIds', JSON.stringify(targetGroupIds));
        }
        formData.append('postTargetType', postTargetType);
    }

    platforms.forEach(p => formData.append('platforms', p));
    accounts.forEach(a => formData.append('accounts', a));

    const filesToUpload = selectedSchedulePostImages.length
        ? selectedSchedulePostImages
        : Array.from(document.getElementById('actualImageInput')?.files || []);

    if (filesToUpload.length) {
        for (const file of filesToUpload) formData.append('images', file);
    }

    try {
        if (currentEditingSchedule) formData.append('scheduleId', currentEditingSchedule._id);

        const res = await fetch(currentEditingSchedule ? '/schedule/api/update' : '/schedule/api/create', {
            method: currentEditingSchedule ? 'PUT' : 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            currentEditingSchedule = null;
            closeCreatePostModal();
            location.reload();
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}