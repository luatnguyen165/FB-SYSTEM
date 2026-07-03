/* ===================================
   REELS MODAL - Modal open/close, form fill/reset, submit
   =================================== */

let currentEditingReels = null;
let reelsAccountOptionsCache = [];
let reelsAvailablePlatforms = new Set();
let selectedReelsAccountIds = new Set();
let suppressAccountRestore = false;

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
        reelsAccountOptionsCache = channels;

        // Setup events 1 lần (search/select all)
        setupReelsAccountPickerEvents();

        // Update visual state cho platform picker cards (is-selected, is-disabled)
        updateReelsPlatformCardsUI();

        // Update counter cho platform picker
        updateReelsPlatformCounter();

        // Listen platform changes → update account list + counter
        const platformChips = Array.from(document.querySelectorAll('.platform-chip'));
        platformChips.forEach(chip => {
            const input = chip.querySelector('.platform-check');
            if (!input) return;

            // Đã setup listener ở dưới, skip nếu trùng
            if (input.dataset.reelsListener) return;
            input.dataset.reelsListener = '1';
            input.addEventListener('change', () => {
                updateReelsPlatformCardsUI();
                updateReelsPlatformCounter();
                renderAccountList();
                syncSelectedPlatformPreview();
                toggleShopeeLinkSectionForReels();
                toggleReelsAccountSection();
                toggleReelsTitleSection();
            });

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

        // KHÔNG tự tick platform đầu tiên — để user chủ động chọn
        // if (!visibleSelected.length) {
        //     const firstAvailable = Array.from(document.querySelectorAll('.platform-check'))
        //         .find(cb => !cb.disabled);
        //     if (firstAvailable) firstAvailable.checked = true;
        // }

        syncSelectedPlatformPreview();
        renderAccountList();
        toggleShopeeLinkSectionForReels();
        toggleReelsAccountSection();
        toggleReelsTitleSection();
        updateReelsPlatformCounter();
        logReelsUiStep('refresh-platform-options-done', `available=${Array.from(reelsAvailablePlatforms).join(',') || 'none'}`);
    } catch (err) {
        console.error('Refresh reels platform options failed:', err);
    }
}

function updateReelsPlatformCardsUI() {
    const cards = Array.from(document.querySelectorAll('.platform-picker-card'));
    cards.forEach(card => {
        const input = card.querySelector('.platform-check');
        if (!input) return;
        const channelPlatform = reelsPlatformToChannel(input.value);
        const hasAccount = reelsAvailablePlatforms.has(channelPlatform);
        card.classList.toggle('is-selected', input.checked && !input.disabled);
        card.classList.toggle('is-disabled', !hasAccount);
    });
}

function updateReelsPlatformCounter() {
    const counter = document.getElementById('reelsPlatformCounter');
    if (!counter) return;
    const all = Array.from(document.querySelectorAll('.platform-picker-card'));
    const total = all.length;
    const selected = all.filter(c => c.querySelector('.platform-check')?.checked).length;
    if (total === 0) {
        counter.style.display = 'none';
    } else {
        counter.style.display = '';
        counter.textContent = `${selected}/${total} đã chọn`;
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
    if (typeof window.initCaptionEditor === 'function') window.initCaptionEditor();
    if (window.captionEditorAPI) window.captionEditorAPI.setText(schedule.caption || '');
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

    // Fill tiêu đề video (cho YS / PI)
    const titleInput = document.getElementById('modalVideoTitleInput');
    if (titleInput) titleInput.value = schedule.videoTitle || '';

    if (videoPlayer && hasVideo) {
        videoPlayer.classList.add('active');
    }

    const placeholder = document.getElementById('phoneCenterPlayIcon');
    if (placeholder) placeholder.classList.toggle('hidden-status', hasVideo);

    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.checked = (schedule.platforms || []).includes(cb.value);
        const card = cb.closest('.platform-picker-card');
        if (card) card.classList.toggle('is-selected', cb.checked && !cb.disabled);
    });
    // Suppress restoring old selections; replace with schedule's accounts
    suppressAccountRestore = true;
    selectedReelsAccountIds = new Set((schedule.accounts || []).map(String));
    renderAccountList();
    setTimeout(() => { suppressAccountRestore = false; }, 200);
    syncSelectedPlatformPreview();
    toggleReelsAccountSection();
    toggleReelsTitleSection();
    updateReelsSubmitButtonState();

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
    if (window.captionEditorAPI) window.captionEditorAPI.setText('');
    const titleInput = document.getElementById('modalVideoTitleInput');
    if (titleInput) titleInput.value = '';
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

    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.checked = false;
        const card = cb.closest('.platform-picker-card');
        if (card) card.classList.remove('is-selected');
    });
    // Reset selection khi mở modal mới
    selectedReelsAccountIds = new Set();
    renderAccountList();
    syncSelectedPlatformPreview();
    renderShopeeLinkList();
    syncSelectedShopeeLinksPreview();
    toggleShopeeLinkSectionForReels();
    toggleReelsAccountSection();
    toggleReelsTitleSection();
    updateReelsRunNowButtonState();
    updateReelsSubmitButtonState();
}

/**
 * Hiện/ẩn section "Tài khoản đăng" trong Reels modal theo platform đang tick
 * - Hiện khi tick ít nhất 1 platform
 * - Ẩn khi bỏ tick hết
 */
function toggleReelsAccountSection() {
    const section = document.getElementById('accountPickerSection');
    if (!section) return;
    const platforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    section.style.display = platforms.length > 0 ? '' : 'none';
}

/**
 * Hiện/ẩn section "Tiêu đề video" trong Reels modal theo platform đang tick
 * - Hiện khi tick PI (Pinterest Idea Pin) hoặc YS (YouTube Shorts)
 * - Ẩn khi không tick 2 platform trên
 */
function toggleReelsTitleSection() {
    const section = document.getElementById('reelsTitleSection');
    if (!section) return;
    const platforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const hasPI = platforms.includes('PI');
    const hasYS = platforms.includes('YS');
    const showSection = hasPI || hasYS;
    if (showSection) {
        section.style.display = '';
    } else {
        section.style.display = 'none';
    }
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
    // Init Quill khi modal visible
    if (typeof window.initCaptionEditor === 'function') window.initCaptionEditor();
    updateReelsRunNowButtonState();
    updateReelsSubmitButtonState();
}

function refreshReelsModalUI() {
    const preview = document.getElementById('livePreviewCaption');
    const caption = window.captionEditorAPI ? window.captionEditorAPI.getText() : (document.getElementById('modalCaptionInput')?.value || '');
    if (preview) preview.textContent = caption || 'Nội dung Reels sẽ hiển thị tại đây.';
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

    // Giới hạn 1000 ký tự cho tất cả nền tảng (Threads tự truncate xuống 500 bên backend)
    if (caption.length > 1000) {
        showToast(`Nội dung vượt quá 1000 ký tự (${caption.length}/1000). Vui lòng rút ngắn!`, 'warning');
        document.getElementById('modalCaptionInput')?.focus();
        return false;
    }

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
    // Tiêu đề video: ưu tiên input user nhập → fallback tên file gốc
    const userVideoTitle = document.getElementById('modalVideoTitleInput')?.value?.trim() || '';
    const resolvedVideoTitle = userVideoTitle
        || currentSelectedReelsVideo.title
        || currentEditingReels?.videoTitle
        || '';
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

    // Validate tiêu đề nếu chọn Pinterest Idea Pin hoặc YouTube Shorts
    const hasPI = platforms.includes('PI');
    const hasYS = platforms.includes('YS');
    if ((hasPI || hasYS) && !resolvedVideoTitle) {
        showToast(hasPI && hasYS
            ? 'Pinterest Idea Pin & YouTube Shorts yêu cầu phải có tiêu đề video!'
            : (hasPI ? 'Pinterest Idea Pin yêu cầu phải có tiêu đề video!' : 'YouTube Shorts yêu cầu phải có tiêu đề video!'),
            'warning');
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

    // Lưu các account đã chọn TRƯỚC khi render lại
    if (!suppressAccountRestore) {
        document.querySelectorAll('input[name="modalAccSelect"]:checked').forEach(cb => {
            selectedReelsAccountIds.add(String(cb.value));
        });
    }

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

            // Lưu lại search value TRƯỚC khi re-render
            const prevSearch = (document.getElementById('accountPickerSearch')?.value || '').toLowerCase().trim();

            // Build HTML theo pattern schedule-post: group theo platform
            const platformMeta = {
                FB: { name: 'Facebook', icon: 'fa-brands fa-facebook', color: '#1877F2' },
                TT: { name: 'TikTok', icon: 'fa-brands fa-tiktok', color: '#000000' },
                IG: { name: 'Instagram', icon: 'fa-brands fa-instagram', color: '#E4405F' },
                YT: { name: 'YouTube', icon: 'fa-brands fa-youtube', color: '#FF0000' },
                TH: { name: 'Threads', icon: 'fa-brands fa-threads', color: '#000000' },
                PI: { name: 'Pinterest', icon: 'fa-brands fa-pinterest', color: '#E60023' }
            };
            const platformOrder = ['FB', 'IG', 'TT', 'YT', 'TH', 'PI'];

            // Group theo platform
            const grouped = {};
            filtered.forEach(ch => {
                if (!grouped[ch.platform]) grouped[ch.platform] = [];
                grouped[ch.platform].push(ch);
            });

            // Apply search filter
            const search = prevSearch;
            let visibleTotal = 0;
            let checkedTotal = 0;
            let html = '';

            platformOrder.forEach(platform => {
                if (!grouped[platform]) return;
                const accounts = grouped[platform].filter(ch => {
                    if (!search) return true;
                    return String(ch.accountName || '').toLowerCase().includes(search)
                        || String(ch.accountType || '').toLowerCase().includes(search);
                });
                if (accounts.length === 0) return;
                visibleTotal += accounts.length;

                const pm = platformMeta[platform] || { name: platform, icon: 'fa-solid fa-globe', color: '#888' };
                html += `
                <div class="account-group" data-platform="${platform}">
                    <div class="account-group__header" style="--group-color:${pm.color}">
                        <i class="${pm.icon}"></i>
                        <span>${pm.name}</span>
                        <span class="account-group__count">${accounts.length}</span>
                    </div>
                    <div class="account-group__grid">`;

                accounts.forEach(ch => {
                    const meta = typeMeta(ch.accountType);
                    const chId = String(ch._id);
                    const chName = String(ch.accountName || '');
                    // So sánh cả _id và accountName để cover cả 2 format DB
                    const isChecked = selectedReelsAccountIds.size > 0 && Array.from(selectedReelsAccountIds).some(p => {
                        if (typeof p === 'string') {
                            if (/^[0-9a-fA-F]{24}$/.test(p)) return p === chId;
                            return p === chName;
                        }
                        return false;
                    });
                    if (isChecked) checkedTotal++;
                    // Lấy 2 chữ cái đầu làm avatar fallback
                    const parts = String(ch.accountName || '').trim().split(/\s+/);
                    let initial = '?';
                    if (parts.length === 1 && parts[0]) initial = parts[0].charAt(0).toUpperCase();
                    else if (parts.length >= 2) initial = (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
                    const avatarColor = pm.color;
                    const avatarHtml = ch.avatarUrl
                        ? `<img src="${ch.avatarUrl}" alt="${ch.accountName}" class="account-card__avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="account-card__avatar-fallback" style="background:${avatarColor};display:none;">${initial}</span>`
                        : `<span class="account-card__avatar-fallback" style="background:${avatarColor};">${initial}</span>`;

                    html += `
                        <label class="account-card acc-platform-${platform} ${isChecked ? 'is-selected' : ''}" data-account-id="${chId}" data-account-name="${String(ch.accountName || '').toLowerCase()}" data-account-type="${String(ch.accountType || '').toLowerCase()}">
                            <input type="checkbox" name="modalAccSelect" value="${chId}" ${isChecked ? 'checked' : ''}>
                            <span class="account-card__checkbox"><i class="fa-solid fa-check"></i></span>
                            <span class="account-card__avatar">${avatarHtml}</span>
                            <span class="account-card__body">
                                <span class="account-card__name">${ch.accountName}</span>
                                <span class="account-card__type">
                                    <i class="${meta.icon}"></i> ${meta.label}
                                </span>
                            </span>
                        </label>`;
                });

                html += `</div></div>`;
            });

            if (visibleTotal === 0) {
                if (filtered.length === 0) {
                    const hasBlockedFacebookPersonal = reelsAccountOptionsCache.some(ch => channelPlatforms.includes(String(ch.platform || '').trim()) && isFacebookPersonalAccount(ch));
                    boxContainer.innerHTML = `
                        <div style="grid-column:1/-1; padding:12px 14px; border:1px dashed var(--border-dark); border-radius:14px; background:#f8fafc; color:var(--text-muted); font-size:0.84rem; line-height:1.45;">
                            ${hasBlockedFacebookPersonal
                                ? 'Không có tài khoản hợp lệ cho Reels. Tài khoản Facebook cá nhân không hỗ trợ đăng Reels, hãy chọn Fanpage hoặc Nhà sáng tạo.'
                                : 'Chưa có tài khoản phù hợp với nền tảng đang chọn.'}
                        </div>`;
                } else if (search) {
                    boxContainer.innerHTML = `
                        <div class="account-picker-no-result">
                            <i class="fa-solid fa-magnifying-glass"></i>
                            <p>Không tìm thấy tài khoản nào với từ khóa "<strong>${search}</strong>"</p>
                        </div>`;
                }
            } else {
                boxContainer.innerHTML = html;
                // Apply class is-selected cho mọi card đã tick (đảm bảo CSS áp dụng khi edit)
                boxContainer.querySelectorAll('input[name="modalAccSelect"]:checked').forEach(cb => {
                    const card = cb.closest('.account-card');
                    if (card) card.classList.add('is-selected');
                });
            }

            // Cleanup các id không còn trong DOM
            const visibleIds = new Set(filtered.map(ch => String(ch._id)));
            for (const id of Array.from(selectedReelsAccountIds)) {
                if (!visibleIds.has(id)) selectedReelsAccountIds.delete(id);
            }

            // Gắn listener + apply class is-selected (đảm bảo hiển thị đúng khi edit)
            boxContainer.querySelectorAll('input[name="modalAccSelect"]').forEach(cb => {
                const card = cb.closest('.account-card');
                if (card) card.classList.toggle('is-selected', cb.checked);
                cb.addEventListener('change', (e) => {
                    const id = String(e.target.value);
                    if (e.target.checked) selectedReelsAccountIds.add(id);
                    else selectedReelsAccountIds.delete(id);
                    if (card) card.classList.toggle('is-selected', e.target.checked);
                    updateReelsAccountPickerUI();
                });
            });

            updateReelsAccountPickerUI();
        })
        .catch(err => console.error('Load channels error:', err));
}

function updateReelsAccountPickerUI() {
    const counter = document.getElementById('accountPickerCounter');
    const toolbar = document.getElementById('accountPickerToolbar');
    const empty = document.getElementById('accountPickerEmpty');
    const searchInput = document.getElementById('accountPickerSearch');
    const box = document.getElementById('dynamicAccountBox');

    const cards = box ? box.querySelectorAll('.account-card') : [];
    const visibleCards = Array.from(cards).filter(c => c.style.display !== 'none');
    const total = visibleCards.length;
    const selected = box ? box.querySelectorAll('input[name="modalAccSelect"]:checked').length : 0;

    if (counter) {
        counter.textContent = `${selected}/${total} đã chọn`;
        counter.style.display = total > 0 ? '' : 'none';
    }
    if (toolbar) toolbar.style.display = total > 0 ? '' : 'none';
    if (empty) empty.style.display = total > 0 ? 'none' : '';
}

// Setup search/select-all events cho account picker (reels)
function setupReelsAccountPickerEvents() {
    const search = document.getElementById('accountPickerSearch');
    const clearBtn = document.getElementById('accountPickerSearchClear');
    const selectAllBtn = document.getElementById('accountPickerSelectAll');
    const box = document.getElementById('dynamicAccountBox');

    if (search) {
        search.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = search.value ? '' : 'none';
            renderAccountList();
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (search) search.value = '';
            clearBtn.style.display = 'none';
            renderAccountList();
        });
    }
    if (selectAllBtn && box) {
        selectAllBtn.addEventListener('click', () => {
            const visibleCards = Array.from(box.querySelectorAll('.account-card')).filter(c => c.style.display !== 'none');
            const allChecked = visibleCards.length > 0 && visibleCards.every(c => c.querySelector('input').checked);
            visibleCards.forEach(card => {
                const cb = card.querySelector('input');
                cb.checked = !allChecked;
                card.classList.toggle('is-selected', !allChecked);
                if (!allChecked) selectedReelsAccountIds.add(String(cb.value));
                else selectedReelsAccountIds.delete(String(cb.value));
            });
            updateReelsAccountPickerUI();
        });
    }
}