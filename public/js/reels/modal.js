/* ===================================
   REELS MODAL - Modal open/close, form fill/reset, submit
   =================================== */

let currentEditingReels = null;
let reelsAccountOptionsCache = [];
let reelsAvailablePlatforms = new Set();

function updateReelsSubmitButtonState() {
    const btnSubmit = document.getElementById('btnSubmitReelsSchedule');
    if (!btnSubmit) return;

    if (currentEditingReels?._id) {
        btnSubmit.textContent = 'Cập nhật lịch';
        btnSubmit.setAttribute('data-mode', 'edit');
    } else {
        btnSubmit.textContent = 'Xác nhận lên lịch';
        btnSubmit.setAttribute('data-mode', 'create');
    }
}

async function refreshReelsPlatformOptions() {
    try {
        logReelsUiStep('refresh-platform-options-start');
        const res = await fetch('/channels/api/list');
        const data = await res.json();
        if (!data.success) throw new Error('Không tải được danh sách tài khoản');

        const channels = Array.isArray(data.channels) ? data.channels : [];
        reelsAvailablePlatforms = new Set(channels.map(ch => ch.platform).filter(Boolean));

        const platformChips = Array.from(document.querySelectorAll('.platform-chip'));
        platformChips.forEach(chip => {
            const input = chip.querySelector('.platform-check');
            if (!input) return;

            const platform = input.value;
            const channelPlatform = reelsPlatformToChannel(platform);
            const hasAccount = reelsAvailablePlatforms.has(channelPlatform);
            chip.style.display = hasAccount ? '' : 'none';
            input.disabled = !hasAccount;

            if (!hasAccount) {
                input.checked = false;
            }
        });

        const visibleSelected = Array.from(document.querySelectorAll('.platform-check:checked'))
            .filter(cb => !cb.disabled);

        if (!visibleSelected.length) {
            const firstAvailable = Array.from(document.querySelectorAll('.platform-check'))
                .find(cb => !cb.disabled);
            if (firstAvailable) firstAvailable.checked = true;
        }

        syncSelectedPlatformPreview();
        renderAccountList();
        toggleShopeeLinkSectionForReels();
        logReelsUiStep('refresh-platform-options-done', `available=${Array.from(reelsAvailablePlatforms).join(',') || 'none'}`);
    } catch (err) {
        console.error('Refresh reels platform options failed:', err);
    }
}

function updateReelsRunNowButtonState() {
    const btn = document.getElementById('btnRunReelsNow');
    if (!btn) return;

    const hasSchedule = Boolean(currentEditingReels?._id);
    btn.disabled = !hasSchedule;
    btn.style.opacity = hasSchedule ? '1' : '0.55';
    btn.title = hasSchedule
        ? 'Chạy ngay lịch Reels này trên Chrome'
        : 'Hãy mở một lịch Reels đã tạo để dùng nút này';
}

function fillReelsForm(schedule) {
    if (!schedule) return;

    currentEditingReels = schedule;
    const captionInput = document.getElementById('modalCaptionInput');
    const videoPlayer = document.getElementById('phoneMockupVideoTag');

    if (captionInput) captionInput.value = schedule.caption || '';
    updateLiveMobilePreview();
    const timeInput = document.getElementById('modalTimeInput');
    if (schedule.scheduledAt) {
        const scheduled = new Date(schedule.scheduledAt);
        setReelsScheduleInputs(schedule.scheduledAt, `${pad2(scheduled.getHours())}:${pad2(scheduled.getMinutes())}`);
        if (timeInput) timeInput.title = `Đã chọn: ${formatReadableDateTime(schedule.scheduledAt)}`;
    }

    const populatedVideo = schedule.videoId && typeof schedule.videoId === 'object' ? schedule.videoId : null;
    const hasVideo = !!(schedule.videoUrl || schedule.videoPath || populatedVideo?.filePath);
    setReelsVideoPreview({
        id: populatedVideo?._id || (typeof schedule.videoId === 'string' ? schedule.videoId : ''),
        url: schedule.videoUrl || schedule.videoPath || populatedVideo?.filePath || '',
        poster: populatedVideo?.thumbnailUrl || '',
        title: schedule.videoTitle || schedule.videoName || populatedVideo?.title || 'Đã chọn video',
        size: schedule.videoSize || ''
    });

    if (videoPlayer && hasVideo) {
        videoPlayer.classList.add('active');
    }

    const placeholder = document.getElementById('phoneCenterPlayIcon');
    if (placeholder) placeholder.classList.toggle('hidden-status', hasVideo);

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (schedule.platforms || []).includes(cb.value));
    renderAccountList();
    syncSelectedPlatformPreview();
    updateReelsSubmitButtonState();

    const accChecks = schedule.accounts || [];
    setTimeout(() => {
        document.querySelectorAll('input[name="modalAccSelect"]').forEach(cb => {
            cb.checked = accChecks.includes(cb.value);
        });
    }, 150);

    updateReelsRunNowButtonState();
}

function resetReelsForm() {
    currentEditingReels = null;
    currentSelectedReelsVideo = { id: '', url: '', poster: '', title: '', size: '' };
    currentReelsVideoUploadPromise = null;
    isReelsVideoUploading = false;
    const captionInput = document.getElementById('modalCaptionInput');
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const posterEl = document.getElementById('phoneMockupPosterTag');

    if (captionInput) captionInput.value = '';
    updateLiveMobilePreview();
    const dateInput = document.getElementById('modalDateInput');
    const clockInput = document.getElementById('modalClockInput');
    const timeInput = document.getElementById('modalTimeInput');
    if (dateInput) dateInput.value = '';
    if (clockInput) clockInput.value = '09:00';
    if (timeInput) {
        timeInput.value = '';
        timeInput.title = '';
    }
    setReelsVideoPreview();
    if (videoPlayer) videoPlayer.classList.remove('active');
    if (posterEl) {
        posterEl.removeAttribute('src');
        posterEl.classList.remove('active');
    }

    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (playIcon) playIcon.classList.remove('hidden-status');

    document.querySelectorAll('.platform-check').forEach(cb => cb.checked = (cb.value === 'FR'));
    renderAccountList();
    syncSelectedPlatformPreview();
    renderShopeeLinkList();
    syncSelectedShopeeLinksPreview();
    toggleShopeeLinkSectionForReels();
    updateReelsRunNowButtonState();
    updateReelsSubmitButtonState();
}

function openCreatePostModal(dayNumber) {
    const now = new Date();
    const dateInput = document.getElementById('modalDateInput');
    const clockInput = document.getElementById('modalClockInput');
    const timeInput = document.getElementById('modalTimeInput');

    if (dateInput && !dateInput.value) {
        setReelsScheduleInputs(now, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
        if (timeInput) timeInput.title = `Thời gian hiện tại: ${formatReadableDateTime(now)}`;
    } else if (clockInput && !clockInput.value) {
        setReelsScheduleInputs(dateInput?.value ? new Date(`${dateInput.value.split('/').reverse().join('-')}T00:00:00`) : now, `${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    }
    logReelsUiStep('open-modal', `currentSchedule=${currentEditingReels?._id || 'new'}`);
    document.getElementById('createPostModal')?.classList.add('open');
    updateReelsRunNowButtonState();
    updateReelsSubmitButtonState();
}

function refreshReelsModalUI() {
    const preview = document.getElementById('livePreviewCaption');
    const caption = document.getElementById('modalCaptionInput')?.value || '';
    if (preview) preview.textContent = caption.trim() || 'Nội dung Reels sẽ hiển thị tại đây.';
}

function closeCreatePostModal() {
    document.getElementById('createPostModal')?.classList.remove('open');
}

async function runCurrentReelsScheduleNow() {
    if (!currentEditingReels?._id) {
        showToast?.('Hãy chọn một lịch Reels đã có trước khi chạy ngay', 'warning');
        return;
    }

    const btn = document.getElementById('btnRunReelsNow');
    if (btn) btn.disabled = true;

    try {
        showToast?.('Đang mở Chrome để chạy lịch Reels...', 'info');
        logReelsUiStep('run-now-start', `scheduleId=${currentEditingReels._id}`);
        const res = await fetch(`/schedule/api/reels-runner/run-schedule/${encodeURIComponent(currentEditingReels._id)}`, {
            method: 'POST'
        });
        const data = await res.json();

        logReelsUiStep('run-now-response', `success=${Boolean(data.success)} message=${data.message || ''}`);

        if (data.success) {
            showToast?.(data.message || 'Đã chạy Chrome cho lịch Reels', 'success');
        } else {
            showToast?.(data.message || 'Không thể chạy lịch Reels', 'error');
        }
    } catch (error) {
        console.error('Run current reels schedule now failed:', error);
        showToast?.('Lỗi kết nối khi chạy lịch Reels', 'error');
    } finally {
        updateReelsRunNowButtonState();
    }
}

async function deleteCurrentReelsSchedule() {
    if (!currentEditingReels?._id) {
        showToast('Chưa có lịch để xóa', 'warning');
        return;
    }

    showConfirm('Bạn có chắc muốn xóa lịch này?', async () => {
        logReelsUiStep('delete-schedule-confirmed', currentEditingReels._id);

        try {
            const res = await fetch(`/schedule/api/${encodeURIComponent(currentEditingReels._id)}`, { method: 'DELETE' });
            const data = await res.json();
            if (data.success) {
                showToast(data.message, 'success');
                currentEditingReels = null;
                closeCreatePostModal();
                await refreshReelsCalendarFallback();
            } else {
                showToast('Lỗi: ' + data.message, 'error');
            }
        } catch (err) {
            showToast('Lỗi kết nối server', 'error');
        }
    });
}

async function openReelsFromDay(dateString) {
    try {
        logReelsUiStep('load-day-schedule-start', dateString);
        const res = await fetch(`/schedule/api/by-date?type=reels&date=${encodeURIComponent(dateString)}`);
        const data = await res.json();

        openCreatePostModal(null);

        setReelsScheduleInputs(new Date(`${dateString}T00:00:00`), '09:00');
        const timeInput = document.getElementById('modalTimeInput');
        if (timeInput) timeInput.title = `Ngày đã chọn: ${formatReadableDateTime(`${dateString}T09:00`)}`;

        const schedules = data.success ? (data.schedules || []) : [];
        logReelsUiStep('load-day-schedule-result', `count=${schedules.length}`);
        if (!schedules.length) {
            resetReelsForm();
            setReelsScheduleInputs(new Date(`${dateString}T00:00:00`), '09:00');
            if (timeInput) timeInput.title = `Ngày đã chọn: ${formatReadableDateTime(`${dateString}T09:00`)}`;
            return;
        }

        fillReelsForm(schedules[0]);
    } catch (err) {
        console.error('Load reels by date failed:', err);
        openCreatePostModal(null);
    }
}

async function openReelsScheduleById(scheduleId) {
    try {
        logReelsUiStep('load-schedule-by-id-start', scheduleId);
        const res = await fetch(`/schedule/api/${encodeURIComponent(scheduleId)}`);
        const data = await res.json();
        openCreatePostModal(null);

        if (!data.success || !data.schedule) {
            logReelsUiStep('load-schedule-by-id-empty', scheduleId);
            resetReelsForm();
            return;
        }

        fillReelsForm(data.schedule);
        logReelsUiStep('load-schedule-by-id-done', `status=${data.schedule.status || 'pending'}`);

        const populatedVideo = data.schedule.videoId && typeof data.schedule.videoId === 'object' ? data.schedule.videoId : null;
        if (populatedVideo || data.schedule.videoUrl || data.schedule.videoPath) {
            setReelsVideoPreview({
                id: populatedVideo?._id || (typeof data.schedule.videoId === 'string' ? data.schedule.videoId : ''),
                url: data.schedule.videoUrl || data.schedule.videoPath || populatedVideo?.filePath || '',
                poster: populatedVideo?.thumbnailUrl || '',
                title: data.schedule.videoTitle || data.schedule.videoName || populatedVideo?.title || 'Đã chọn video',
                size: data.schedule.videoSize || ''
            });
        }
    } catch (err) {
        console.error('Load reels schedule by id failed:', err);
        openCreatePostModal(null);
    }
}

function applyScheduleToForm(schedule) {
    if (!schedule) return;
    fillReelsForm(schedule);
    openCreatePostModal(null);
}

function getScheduleDateFromCell(cell) {
    return cell?.dataset?.date || '';
}

async function submitReelsSchedule() {
    logReelsUiStep('submit-schedule-start');
    const caption = document.getElementById('modalCaptionInput')?.value || '';
    syncReelsScheduleTimeInput();
    const scheduledAt = document.getElementById('modalTimeInput')?.value;
    const platforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const accounts = Array.from(document.querySelectorAll('input[name="modalAccSelect"]:checked')).map(cb => cb.value);
    const shopeeLinks = Array.from(document.querySelectorAll('input[name="modalShopeeLinkSelect"]:checked')).map(cb => cb.value);
    const selectedAccountDetails = reelsAccountOptionsCache.filter(ch => accounts.includes(String(ch._id || '')));

    if (isReelsVideoUploading && currentReelsVideoUploadPromise) {
        logReelsUiStep('submit-schedule-wait-upload');
        showToast('Đang upload video lên kho, vui lòng đợi một chút...', 'info');
        try {
            await currentReelsVideoUploadPromise;
        } catch (err) {
            showToast('Upload video thất bại, vui lòng chọn lại video', 'error');
            return false;
        }
    }

    const resolvedVideoId = currentSelectedReelsVideo.id || (currentEditingReels?.videoId && typeof currentEditingReels.videoId === 'object' ? currentEditingReels.videoId._id : currentEditingReels?.videoId) || '';
    const resolvedVideoPath = currentSelectedReelsVideo.url && !resolvedVideoId
        ? currentSelectedReelsVideo.url
        : (currentEditingReels?.videoPath || '');
    const resolvedVideoTitle = currentSelectedReelsVideo.title || currentEditingReels?.videoTitle || '';
    const resolvedVideoSize = currentSelectedReelsVideo.size || currentEditingReels?.videoSize || '';

    if (!scheduledAt) {
        logReelsUiStep('submit-schedule-invalid', 'missing scheduledAt');
        showToast('Vui lòng chọn thời gian đăng!', 'warning');
        return false;
    }

    const dateInput = document.getElementById('modalDateInput')?.value || '';
    const timeValue = document.getElementById('modalClockInput')?.value || '09:00';

    if (isPastReelsDateTime(dateInput, timeValue)) {
        logReelsUiStep('submit-schedule-invalid', `past-time=${dateInput} ${timeValue}`);
        showToast('Không thể lên lịch vào thời gian trong quá khứ!', 'warning');
        return false;
    }

    if (selectedAccountDetails.some(isFacebookPersonalAccount)) {
        showToast('Tài khoản Facebook cá nhân không hỗ trợ đăng Reels. Vui lòng chọn Fanpage hoặc Nhà sáng tạo.', 'warning');
        return false;
    }

    try {
        const payload = {
            type: 'reels',
            caption,
            scheduledAt: parseDateInputToIso(dateInput, timeValue) || scheduledAt,
            platforms,
            accounts,
            shopeeLinks,
            videoId: resolvedVideoId,
            videoPath: resolvedVideoPath,
            videoTitle: resolvedVideoTitle,
            videoSize: resolvedVideoSize
        };

        console.log('[Reels] submit payload =', JSON.stringify({
            ...payload,
            shopeeLinksCount: shopeeLinks.length,
            videoResolved: Boolean(resolvedVideoId)
        }));
        logReelsUiStep('submit-schedule-payload', `videoId=${payload.videoId || 'none'}; videoPath=${payload.videoPath || 'none'}; links=${shopeeLinks.length}; mode=${currentEditingReels ? 'update' : 'create'}`);

        if (!payload.videoId && !payload.videoPath) {
            showToast('Vui lòng chọn video local hoặc video từ kho trước khi lên lịch!', 'warning');
            return false;
        }

        const method = currentEditingReels ? 'PUT' : 'POST';
        const url = currentEditingReels ? '/schedule/api/update' : '/schedule/api/create';

        if (currentEditingReels) payload.scheduleId = currentEditingReels._id;

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            logReelsUiStep('submit-schedule-success', `scheduleId=${data.schedule?._id || currentEditingReels?._id || 'new'}`);
            currentEditingReels = null;
            closeCreatePostModal();
            if (typeof window.refreshReelsCalendar === 'function') {
                await window.refreshReelsCalendar(true);
            } else {
                await refreshReelsCalendarFallback();
            }
            return true;
        } else {
            showToast('Lỗi: ' + data.message, 'error');
            return false;
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
        return false;
    }
}

function renderAccountList() {
    const checkedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const boxContainer = document.getElementById('dynamicAccountBox');
    if (!boxContainer) return;

    console.log('[Reels] renderAccountList - checkedPlatforms:', checkedPlatforms);

    const typeOrder = { 'Fanpage': 0, 'Nhà sáng tạo': 1, 'Cá nhân': 2 };
    const typeMeta = (accountType = '') => {
        const normalized = String(accountType || '').trim() || 'Cá nhân';
        if (normalized === 'Fanpage') return { label: 'Fanpage', className: 'account-type-pill--fanpage', icon: 'fa-solid fa-flag' };
        if (normalized === 'Nhà sáng tạo') return { label: 'Nhà sáng tạo', className: 'account-type-pill--creator', icon: 'fa-solid fa-pen-nib' };
        return { label: 'Cá nhân', className: 'account-type-pill--personal', icon: 'fa-regular fa-user' };
    };

    fetch('/channels/api/list')
        .then(res => res.json())
        .then(data => {
            console.log('[Reels] channels API response:', data);
            if (!data.success) return;
            boxContainer.innerHTML = '';
            reelsAccountOptionsCache = Array.isArray(data.channels) ? data.channels : [];

            console.log('[Reels] channels loaded:', reelsAccountOptionsCache.length, 'channels');

            const channelPlatforms = checkedPlatforms.map(reelsPlatformToChannel);
            const filtered = reelsAccountOptionsCache
                .filter(ch => channelPlatforms.includes(String(ch.platform || '').trim()))
                .filter(ch => {
                    const p = String(ch.platform || '').trim();
                    if (p === 'FB') return !isFacebookPersonalAccount(ch);
                    return true;
                })
                .slice()
                .sort((a, b) => {
                    if (a.platform !== b.platform) return String(a.platform).localeCompare(String(b.platform), 'vi');
                    return (typeOrder[String(a.accountType || 'Cá nhân').trim()] ?? 99) - (typeOrder[String(b.accountType || 'Cá nhân').trim()] ?? 99);
                });

            console.log('[Reels] filtered accounts:', filtered.length, 'accounts');

            if (!filtered.length) {
                const hasBlockedFacebookPersonal = reelsAccountOptionsCache.some(ch => channelPlatforms.includes(String(ch.platform || '').trim()) && isFacebookPersonalAccount(ch));
                boxContainer.innerHTML = `
                    <div style="grid-column:1/-1; padding:12px 14px; border:1px dashed var(--border-dark); border-radius:14px; background:#f8fafc; color:var(--text-muted); font-size:0.84rem; line-height:1.45;">
                        ${hasBlockedFacebookPersonal
                            ? 'Không có tài khoản hợp lệ cho Reels. Tài khoản Facebook cá nhân không hỗ trợ đăng Reels, hãy chọn Fanpage hoặc Nhà sáng tạo.'
                            : 'Chưa có tài khoản phù hợp với nền tảng đang chọn.'}
                    </div>`;
                return;
            }

            filtered.forEach(ch => {
                const platformIcons = { FB: 'fa-brands fa-facebook', TT: 'fa-brands fa-tiktok', IG: 'fa-brands fa-instagram', YT: 'fa-brands fa-youtube' };
                const platformColors = { FB: '#1877f2', TT: '#000', IG: '#e1306c', YT: '#ff0000' };
                const meta = typeMeta(ch.accountType);
                const label = document.createElement('label');
                label.className = 'acc-pick-item';
                label.innerHTML = `
                    <input type="checkbox" name="modalAccSelect" value="${ch._id}">
                    <i class="${platformIcons[ch.platform]}" style="color:${platformColors[ch.platform]}"></i>
                    <span class="acc-pick-item__content">
                        <span class="acc-pick-item__title">${ch.accountName}</span>
                        <span class="acc-pick-item__meta">
                            <span class="account-type-pill ${meta.className}"><i class="${meta.icon}"></i> ${meta.label}</span>
                        </span>
                    </span>`;
                boxContainer.appendChild(label);
            });
        })
        .catch(err => console.error('Load channels error:', err));
}