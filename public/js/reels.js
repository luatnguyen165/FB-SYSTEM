/* ===================================
   REELS.JS - Main entry point
   Loads all reels sub-modules via script tags
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
    logReelsUiStep('DOMContentLoaded', 'initialize reels page');

    const phoneMockup = document.getElementById('phoneMockupContainer');
    const phoneVideo = document.getElementById('phoneMockupVideoTag');
    const phonePlayIcon = document.getElementById('phoneCenterPlayIcon');
    const phonePlayPauseBtn = document.getElementById('phonePlayPauseBtn');

    if (phoneMockup && phoneVideo) {
        phoneMockup.addEventListener('click', () => {
            if (phoneVideo.paused) {
                phoneVideo.play().catch(() => {});
                phoneVideo.classList.add('playing');
                phonePlayIcon?.classList.add('hidden-status');
                updatePlayPauseIcon(true);
                showVideoControls(true);
            } else {
                phoneVideo.pause();
                phoneVideo.currentTime = phoneVideo.currentTime;
                phoneVideo.load();
                phoneVideo.classList.remove('playing');
                phonePlayIcon?.classList.remove('hidden-status');
                updatePlayPauseIcon(false);
                showVideoControls(false);
            }
        });
    }

    if (phonePlayPauseBtn && phoneVideo) {
        phonePlayPauseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (phoneVideo.paused) {
                phoneVideo.play().catch(() => {});
                phoneVideo.classList.add('playing');
                phonePlayIcon?.classList.add('hidden-status');
                updatePlayPauseIcon(true);
                showVideoControls(true);
            } else {
                phoneVideo.pause();
                phoneVideo.currentTime = phoneVideo.currentTime;
                phoneVideo.load();
                phoneVideo.classList.remove('playing');
                phonePlayIcon?.classList.remove('hidden-status');
                updatePlayPauseIcon(false);
                showVideoControls(false);
            }
        });
    }

    phoneVideo?.addEventListener('loadedmetadata', () => {
        updateVideoDuration();
    });

    phoneVideo?.addEventListener('timeupdate', () => {
        updateVideoDuration();
    });

    // Create reels button
    const btnCreate = document.getElementById('btnCreatePost');
    if (btnCreate) btnCreate.addEventListener('click', () => {
        logReelsUiStep('open-create-modal', 'clicked create reels');
        resetReelsForm();
        openCreatePostModal(null);
    });

    // Today button
    document.querySelector('.btn-today')?.addEventListener('click', () => {
        logReelsUiStep('open-create-modal', 'clicked today button');
        resetReelsForm();
        openCreatePostModal(null);
    });

    // Calendar navigation
    document.querySelector('.month-nav .btn-nav:first-child')?.addEventListener('click', async () => {
        logReelsUiStep('calendar-prev-month', `before=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        reelsCalendarState.month -= 1;
        if (reelsCalendarState.month < 1) {
            reelsCalendarState.month = 12;
            reelsCalendarState.year -= 1;
        }
        logReelsUiStep('calendar-prev-month', `after=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        await refreshReelsCalendarFallback();
    });

    document.querySelector('.month-nav .btn-nav:last-child')?.addEventListener('click', async () => {
        logReelsUiStep('calendar-next-month', `before=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        reelsCalendarState.month += 1;
        if (reelsCalendarState.month > 12) {
            reelsCalendarState.month = 1;
            reelsCalendarState.year += 1;
        }
        logReelsUiStep('calendar-next-month', `after=${reelsCalendarState.month}/${reelsCalendarState.year}`);
        await refreshReelsCalendarFallback();
    });

    document.getElementById('btnTodayReels')?.addEventListener('click', async () => {
        const now = new Date();
        logReelsUiStep('jump-today', now.toISOString());
        reelsCalendarState.month = now.getMonth() + 1;
        reelsCalendarState.year = now.getFullYear();
        reelsCalendarState.date = now;
        await refreshReelsCalendarFallback();
    });

    const calendarGrid = document.getElementById('calendarGrid');

    calendarGrid?.addEventListener('click', (e) => {
        const scheduleItem = e.target.closest('.schedule-item[data-schedule-id]');
        const moreItem = e.target.closest('.schedule-item--more[data-date-key]');
        const cell = e.target.closest('.day-cell[data-date]');

        if (scheduleItem) {
            const schedule = getReelsScheduleFromRenderedItemElement(scheduleItem);
            if (!schedule) return;
            e.stopPropagation();
            closeReelsPopoverIfNeeded();
            openReelsPopover(schedule, scheduleItem, 'detail');
            return;
        }

        if (moreItem) {
            const dateKey = moreItem.dataset.dateKey || '';
            const items = reelsCalendarOverflowMap.get(dateKey) || [];
            if (!items.length) return;
            closeReelsPopoverIfNeeded();
            openReelsOverflowPopover(dateKey, moreItem);
            return;
        }

        if (!cell || !isReelsDateSelectable(cell.getAttribute('data-date') || buildDateFromCell(cell))) return;
        const dateString = cell.getAttribute('data-date') || buildDateFromCell(cell);
        logReelsUiStep('open-create-from-day', dateString);
        openReelsFromDay(dateString);
    });

    calendarGrid?.addEventListener('dragstart', handleReelsCalendarDragStart);
    calendarGrid?.addEventListener('dragend', handleReelsCalendarDragEnd);
    calendarGrid?.addEventListener('dragover', handleReelsCalendarDragOver);
    calendarGrid?.addEventListener('drop', handleReelsCalendarDrop);

    document.addEventListener('click', (event) => {
        const popover = document.getElementById('reelsQuickPreviewPopover');
        if (!popover?.classList.contains('open')) return;
        if (event.target.closest('#reelsQuickPreviewPopover')) return;
        if (event.target.closest('.schedule-item') || event.target.closest('.day-cell')) return;
        closeReelsPopoverIfNeeded();
    });

    document.getElementById('btnCloseReelsPopover')?.addEventListener('click', closeReelsPopoverIfNeeded);
    document.getElementById('reelsQuickPreviewPopover')?.addEventListener('click', (event) => {
        const editBtn = event.target.closest('#btnPopoverEditReels');
        const overflowBtn = event.target.closest('.schedule-popover__overflow-item[data-schedule-id]');

        if (editBtn?.dataset?.scheduleId) {
            const schedule = reelsCalendarSchedulesCache.find(item => String(item._id) === String(editBtn.dataset.scheduleId));
            if (schedule) {
                closeReelsPopoverIfNeeded();
                openReelsScheduleById(String(schedule._id));
            }
            return;
        }

        if (overflowBtn?.dataset?.scheduleId) {
            const schedule = reelsCalendarSchedulesCache.find(item => String(item._id) === String(overflowBtn.dataset.scheduleId));
            if (schedule) {
                closeReelsPopoverIfNeeded();
                openReelsScheduleById(String(schedule._id));
            }
        }
    });

    // Upload video local
    const btnUploadLocal = document.getElementById('btnUploadLocal');
    const videoFileInput = document.getElementById('modalVideoFileSelector');
    if (btnUploadLocal && videoFileInput) {
        btnUploadLocal.addEventListener('click', () => videoFileInput.click());
        videoFileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                logReelsUiStep('local-video-selected', `${e.target.files[0].name} (${e.target.files[0].size} bytes)`);
                handleVideoSelected(e.target.files[0]).catch((err) => {
                    console.error('Handle video selected failed:', err);
                    showToast?.('Không thể xử lý video vừa chọn', 'error');
                });
            }
        });
    }

    // Mini library
    const btnOpenLib = document.getElementById('btnOpenLibrary');
    if (btnOpenLib) btnOpenLib.addEventListener('click', openMiniLibrary);

    const btnCloseMiniLib = document.getElementById('btnCloseMiniLib');
    if (btnCloseMiniLib) btnCloseMiniLib.addEventListener('click', closeMiniLibrary);

    const btnSubmitReelsSchedule = document.getElementById('btnSubmitReelsSchedule');
    if (btnSubmitReelsSchedule) btnSubmitReelsSchedule.addEventListener('click', async () => {
        logReelsUiStep('submit-schedule-click');
        const saved = await submitReelsSchedule();
        if (saved) {
            logReelsUiStep('submit-schedule-success');
            stopReelsPlayback();
            closeCreatePostModal();
        }
    });

    document.getElementById('btnDeleteReels')?.addEventListener('click', async () => {
        await deleteCurrentReelsSchedule();
    });

    // Close modal
    document.querySelector('.btn-close-modal')?.addEventListener('click', () => {
        stopReelsPlayback();
        closeCreatePostModal();
    });
    document.getElementById('btnCloseReelsModal')?.addEventListener('click', () => {
        stopReelsPlayback();
        closeCreatePostModal();
    });
    document.getElementById('btnCancelReels')?.addEventListener('click', (e) => {
        e.preventDefault();
        resetReelsForm();
        stopReelsPlayback();
        closeCreatePostModal();
    });

    // Platform selection
    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.addEventListener('change', () => {
            renderAccountList();
            syncSelectedPlatformPreview();
            toggleShopeeLinkSectionForReels();
        });
    });

    document.getElementById('modalCaptionInput')?.addEventListener('input', updateLiveMobilePreview);
    document.getElementById('miniLibSearchInput')?.addEventListener('input', searchVideoInMiniLibrary);
    document.getElementById('dynamicShopeeLinkBox')?.addEventListener('change', () => {
        syncSelectedShopeeLinksPreview();
    });

    document.getElementById('btnClearCalendarFilters')?.addEventListener('click', async () => {
        const status = document.getElementById('scheduleStatusFilter');
        const platform = document.getElementById('schedulePlatformFilter');
        const keyword = document.getElementById('scheduleKeywordFilter');
        const date = document.getElementById('scheduleDateFilter');
        if (status) status.value = 'all';
        if (platform) platform.value = 'all';
        if (keyword) keyword.value = '';
        if (date) date.value = '';
        closeReelsPopoverIfNeeded();
        await refreshReelsCalendarFallback();
    });

    ['scheduleStatusFilter', 'schedulePlatformFilter', 'scheduleKeywordFilter', 'scheduleDateFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
        el.addEventListener(evt, () => {
            closeReelsPopoverIfNeeded();
            applyReelsFilters();
        });
    });

    window.addEventListener('resize', () => {
        const popover = document.getElementById('reelsQuickPreviewPopover');
        if (!popover?.classList.contains('open')) return;
        const scheduleId = popover.dataset.scheduleId || '';
        const schedule = reelsCalendarSchedulesCache.find(item => String(item._id) === String(scheduleId));
        const anchor = document.querySelector(`.schedule-item[data-schedule-id="${scheduleId}"]`);
        if (schedule && anchor) {
            positionReelsPopover(popover, anchor);
        }
    });

    document.getElementById('miniLibGridContainer')?.addEventListener('click', (e) => {
        const item = e.target.closest('.mini-lib-item');
        if (!item) return;
        selectVideoFromMiniLib(item.dataset.videoTitle, item.dataset.videoSize, item.dataset.videoUrl);
    });

    const btnMockDriveSync = document.getElementById('btnMockDriveSync');
    if (btnMockDriveSync) {
        btnMockDriveSync.addEventListener('click', () => showToast('Đồng bộ ảnh mẫu áo từ Google Drive thành công!', 'success'));
    }

    loadShopeeLinksForReels();
    initReelsAutoRefresh();
    refreshReelsCalendarFallback();
});