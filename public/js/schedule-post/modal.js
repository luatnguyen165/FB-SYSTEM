/* ===================================
   SCHEDULE POST MODAL - Modal open/close, form fill/reset, submit, delete
   =================================== */

let currentEditingSchedule = null;

function fillScheduleForm(schedule) {
    if (!schedule) return;
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
    setScheduleTimeInputValue(schedule.scheduledAt);

    const existingImages = Array.isArray(schedule.images) ? schedule.images : [];
    uploadedImagesBlobUrls = existingImages.filter(url => String(url).startsWith('blob:'));
    renderSchedulePostImagePreview(existingImages);

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (schedule.platforms || [])[0] === cb.value);
    renderAccountList();
    toggleFacebookGroupSelectionForSchedulePost();

    const sourceChannelId = schedule.targetGroupSourceChannelId?._id || schedule.targetGroupSourceChannelId || '';
    let preferredGroupKeys = [];
    if (schedule.targetGroupIds) {
        preferredGroupKeys = Array.isArray(schedule.targetGroupIds) ? schedule.targetGroupIds : [schedule.targetGroupIds];
    } else if (schedule.targetGroupUrl || schedule.targetGroupId) {
        preferredGroupKeys = [schedule.targetGroupUrl || schedule.targetGroupId];
    }

    if (sourceChannelId) {
        currentGroupSourceChannelId = sourceChannelId;
        void loadSchedulePostFacebookGroups(String(sourceChannelId), preferredGroupKeys);
    } else {
        const firstFBAccount = document.querySelector('.acc-pick-item input');
        if (firstFBAccount) {
            const icon = firstFBAccount.closest('.acc-pick-item')?.querySelector('i.fa-facebook');
            if (icon) {
                currentGroupSourceChannelId = firstFBAccount.value;
                void loadSchedulePostFacebookGroups(firstFBAccount.value, preferredGroupKeys);
            }
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

    const accChecks = schedule.accounts || [];
    setTimeout(() => {
        document.querySelectorAll('input[name="modalAccSelect"]').forEach(cb => {
            cb.checked = accChecks.includes(cb.value);
        });
    }, 150);
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
    if (imageInput) imageInput.value = '';
    setScheduleTimeInputValue('');
    clearSchedulePostImagePreview();

    void loadSchedulePostFacebookGroups('');

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (cb.value === 'FB'));
    toggleFacebookGroupSelectionForSchedulePost();

    const selectedTagsContainer = document.getElementById('selectedGroupTags');
    if (selectedTagsContainer) selectedTagsContainer.innerHTML = '';
    updateGroupSelectedBadge();

    const counter = document.getElementById('phoneCarouselCounterBadge');
    if (counter) counter.innerText = '1/1';

    if (swiperInstance) { swiperInstance.destroy(true, true); swiperInstance = null; }
    renderAccountList();
}

function openCreatePostModal(dayNumber) {
    const now = new Date();
    const submitButton = document.getElementById('btnSubmitPostSchedule');
    if (submitButton) submitButton.textContent = 'Xác nhận lên lịch';
    setSchedulePostInputs(now, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    const timeInput = document.getElementById('modalTimeInput');
    if (timeInput) timeInput.title = `Thời gian hiện tại: ${formatReadableDateTime(now)}`;
    document.getElementById('createPostModal')?.classList.add('open');
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
    syncSchedulePostTimeInput();
    const scheduledAt = document.getElementById('modalTimeInput')?.value;
    const platforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const accounts = Array.from(document.querySelectorAll('input[name="modalAccSelect"]:checked')).map(cb => cb.value);

    const selectedGroups = getSelectedGroups();
    const targetGroupIds = selectedGroups.map(g => g.groupUrl || g.groupId);

    if (schedulePostGroupsLoading) { showToast('Đang tải danh sách group, vui lòng chờ...', 'warning'); return; }
    if (!scheduledAt) { showToast('Vui lòng chọn thời gian đăng!', 'warning'); return; }

    const dateInput = document.getElementById('modalDateInput')?.value || '';
    const timeValue = document.getElementById('modalClockInput')?.value || '09:00';

    if (isPastDateTime(dateInput, timeValue)) { showToast('Không thể lên lịch vào thời gian trong quá khứ!', 'warning'); return; }

    const formData = new FormData();
    formData.append('type', 'post');
    formData.append('caption', caption);
    formData.append('scheduledAt', parseDateInputToIso(dateInput, timeValue) || scheduledAt);

    if (platforms.includes('FB')) {
        if (targetGroupIds.length === 0) { showToast('Vui lòng chọn ít nhất một group Facebook để đăng bài!', 'warning'); return; }
        if (!currentGroupSourceChannelId) { showToast('Vui lòng chọn tài khoản Facebook nguồn!', 'warning'); return; }
        formData.append('targetGroupSourceChannelId', currentGroupSourceChannelId);
        formData.append('targetGroupIds', JSON.stringify(targetGroupIds));
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