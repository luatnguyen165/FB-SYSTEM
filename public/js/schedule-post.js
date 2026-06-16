/* ===================================
   SCHEDULE-POST.JS - Main entry point
   Loads all schedule-post sub-modules via script tags
   =================================== */

let schedulePostAvailablePlatforms = new Set();
let schedulePostDropdownJustOpened = false;

function renderAccountList(preferredAccounts) {
    const checkedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const boxContainer = document.getElementById('dynamicAccountBox');
    if (!boxContainer) return;

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
            if (!data.success) return;
            boxContainer.innerHTML = '';
            const filtered = data.channels
                .filter(ch => checkedPlatforms.includes(ch.platform))
                .slice()
                .sort((a, b) => {
                    if (a.platform !== b.platform) return String(a.platform).localeCompare(String(b.platform), 'vi');
                    return (typeOrder[String(a.accountType || 'Cá nhân').trim()] ?? 99) - (typeOrder[String(b.accountType || 'Cá nhân').trim()] ?? 99);
                });

            filtered.forEach(ch => {
                const icons = { FB: 'fa-brands fa-facebook', IG: 'fa-brands fa-instagram', TT: 'fa-brands fa-tiktok', YT: 'fa-brands fa-youtube' };
                const colors = { FB: '#1877f2', IG: '#e1306c', TT: '#000', YT: '#ff0000' };
                const meta = typeMeta(ch.accountType);
                const label = document.createElement('label');
                label.className = `acc-pick-item acc-platform-${ch.platform}`;
                const isChecked = preferredAccounts && preferredAccounts.includes(ch._id);
                label.innerHTML = `
                    <input type="checkbox" name="modalAccSelect" value="${ch._id}" ${isChecked ? 'checked' : ''}>
                    <i class="${icons[ch.platform]}" style="color:${colors[ch.platform]}"></i>
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

async function refreshSchedulePostPlatformOptions() {
    try {
        const res = await fetch('/channels/api/list');
        const data = await res.json();
        if (!data.success) throw new Error('Không tải được danh sách tài khoản');

        const channels = Array.isArray(data.channels) ? data.channels : [];
        schedulePostAvailablePlatforms = new Set(channels.map(ch => ch.platform).filter(Boolean));

        const chips = Array.from(document.querySelectorAll('.platform-chip'));
        chips.forEach(chip => {
            const input = chip.querySelector('.platform-check');
            if (!input) return;
            const hasAccount = schedulePostAvailablePlatforms.has(input.value);
            chip.style.display = hasAccount ? '' : 'none';
            input.disabled = !hasAccount;
            if (!hasAccount) input.checked = false;
        });

        const visibleChecked = Array.from(document.querySelectorAll('.platform-check:checked')).filter(cb => !cb.disabled);
        if (!visibleChecked.length) {
            const firstAvailable = Array.from(document.querySelectorAll('.platform-check')).find(cb => !cb.disabled);
            if (firstAvailable) firstAvailable.checked = true;
        }

        renderAccountList();
        toggleFacebookGroupSelectionForSchedulePost();
    } catch (err) {
        console.error('Refresh schedule post platform options failed:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btnCreate = document.getElementById('btnCreatePost');
    if (btnCreate) btnCreate.addEventListener('click', () => { resetScheduleForm(); openCreatePostModal(null); });

    const calendarGrid = document.getElementById('calendarGrid');
    calendarGrid?.addEventListener('click', (e) => {
        const item = e.target.closest('.schedule-item[data-schedule-id]');
        const moreItem = e.target.closest('.schedule-item--more[data-date-key]');
        const cell = e.target.closest('.day-cell[data-date]');

        if (item) {
            const schedule = getScheduleFromRenderedItemElement(item);
            if (!schedule) return;
            e.stopPropagation();
            closeSchedulePopoverIfNeeded();
            openSchedulePopover(schedule, item, 'detail');
            return;
        }

        if (moreItem) {
            const dateKey = moreItem.dataset.dateKey || '';
            if (!dateKey) return;
            const dayCell = moreItem.closest('.day-cell[data-date]');
            const items = scheduleCalendarOverflowMap.get(dateKey) || [];
            if (!items.length) return;
            closeSchedulePopoverIfNeeded();
            openSchedulePopover(items[0], moreItem, 'overflow', items);
            if (dayCell) dayCell.classList.remove('is-drop-target');
            return;
        }

        if (cell) {
            const dateString = cell.getAttribute('data-date');
            if (!dateString) return;
            const selected = new Date(`${dateString}T00:00:00`);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (selected < today) return;
            openScheduleFromDay(dateString);
        }
    });

    calendarGrid?.addEventListener('dragstart', handleCalendarDragStart);
    calendarGrid?.addEventListener('dragend', handleCalendarDragEnd);
    calendarGrid?.addEventListener('dragover', handleCalendarDragOver);
    calendarGrid?.addEventListener('drop', handleCalendarDrop);

    document.addEventListener('click', (event) => {
        const popover = document.getElementById('scheduleQuickPreviewPopover');
        if (!popover?.classList.contains('open')) return;
        if (event.target.closest('#scheduleQuickPreviewPopover')) return;
        if (event.target.closest('.schedule-item') || event.target.closest('.day-cell')) return;
        closeSchedulePopoverIfNeeded();
    });

    document.getElementById('btnCloseSchedulePopover')?.addEventListener('click', closeSchedulePopoverIfNeeded);
    document.getElementById('scheduleQuickPreviewPopover')?.addEventListener('click', (event) => {
        const editBtn = event.target.closest('#btnPopoverEditSchedule');
        const overflowBtn = event.target.closest('.schedule-popover__overflow-item[data-schedule-id]');
        if (editBtn?.dataset?.scheduleId) {
            const schedule = scheduleCalendarSchedulesCache.find(item => String(item._id) === String(editBtn.dataset.scheduleId));
            if (schedule) { closeSchedulePopoverIfNeeded(); openScheduleById(String(schedule._id)); }
            return;
        }
        if (overflowBtn?.dataset?.scheduleId) {
            const schedule = scheduleCalendarSchedulesCache.find(item => String(item._id) === String(overflowBtn.dataset.scheduleId));
            if (schedule) { closeSchedulePopoverIfNeeded(); openScheduleById(String(schedule._id)); }
        }
    });

    document.getElementById('btnPrevMonth')?.addEventListener('click', async () => { currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1); await renderCalendar(); });
    document.getElementById('btnNextMonth')?.addEventListener('click', async () => { currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1); await renderCalendar(); });
    document.getElementById('btnCalendarToday')?.addEventListener('click', async () => { currentCalendarDate = new Date(); await renderCalendar(); });

    document.getElementById('btnClearCalendarFilters')?.addEventListener('click', async () => {
        ['scheduleStatusFilter', 'schedulePlatformFilter', 'scheduleKeywordFilter', 'scheduleDateFilter'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            if (el.tagName === 'SELECT') el.value = 'all';
            else if (el.type === 'date') el.value = '';
            else el.value = '';
        });
        closeSchedulePopoverIfNeeded();
        await renderCalendar();
    });

    ['scheduleStatusFilter', 'schedulePlatformFilter', 'scheduleKeywordFilter', 'scheduleDateFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evt = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input';
        el.addEventListener(evt, () => { closeSchedulePopoverIfNeeded(); void renderCalendar(); });
    });

    const uploadZone = document.getElementById('uploadZone');
    const actualImageInput = document.getElementById('actualImageInput');
    if (uploadZone && actualImageInput) {
        uploadZone.addEventListener('click', () => actualImageInput.click());
        uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
        uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer?.files?.length) handleMultipleImagesPicked(e.dataTransfer.files);
        });
    }
    actualImageInput?.addEventListener('change', (e) => handleMultipleImagesPicked(e.target.files));

    document.getElementById('btnClosePostModal')?.addEventListener('click', closeCreatePostModal);
    document.getElementById('btnCancelPostSchedule')?.addEventListener('click', closeCreatePostModal);
    document.getElementById('modalCaptionInput')?.addEventListener('input', updateLiveFeedPreview);
    document.getElementById('modalDateInput')?.addEventListener('input', syncSchedulePostTimeInput);
    document.getElementById('modalClockInput')?.addEventListener('input', syncSchedulePostTimeInput);
    document.getElementById('modalDateInput')?.addEventListener('change', syncSchedulePostTimeInput);
    document.getElementById('modalClockInput')?.addEventListener('change', syncSchedulePostTimeInput);

    document.getElementById('dynamicAccountBox')?.addEventListener('click', (e) => {
        const accItem = e.target.closest('.acc-pick-item');
        if (!accItem) return;
        const checkbox = accItem.querySelector('input[type="checkbox"]');
        if (!checkbox) return;

        if (!checkbox.checked) {
            checkbox.checked = true;
            const platform = [...accItem.classList].find(c => c.startsWith('acc-platform-'))?.replace('acc-platform-', '');
            document.querySelectorAll('.acc-pick-item input:checked').forEach(otherCb => {
                if (otherCb !== checkbox && otherCb.closest('.acc-pick-item')?.classList.contains('acc-platform-' + platform)) otherCb.checked = false;
            });
            if (accItem.querySelector('i.fa-facebook')) void loadSchedulePostFacebookGroups(checkbox.value);
        } else {
            checkbox.checked = false;
            if (accItem.querySelector('i.fa-facebook')) {
                const remainingFB = document.querySelector('.acc-pick-item.acc-platform-FB input:checked');
                if (remainingFB) void loadSchedulePostFacebookGroups(remainingFB.value);
            }
        }
    });

    const groupCombobox = document.getElementById('groupCombobox');
    const groupDropdown = document.getElementById('groupComboboxDropdown');
    const groupSearchInput = document.getElementById('groupSearchInput');

    if (groupSearchInput) {
        groupSearchInput.addEventListener('focus', () => { if (schedulePostFacebookGroups.length > 0) groupDropdown.classList.add('open'); });
        groupSearchInput.addEventListener('click', () => { if (schedulePostFacebookGroups.length > 0) groupDropdown.classList.add('open'); });
        groupSearchInput.addEventListener('input', (e) => {
            if (schedulePostFacebookGroups.length > 0) groupDropdown.classList.add('open');
            renderGroupComboboxList(schedulePostFacebookGroups, e.target.value);
        });
        groupSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { groupDropdown.classList.remove('open'); groupSearchInput.blur(); } });
    }

    document.querySelector('.combobox-input-wrapper')?.addEventListener('click', () => {
        if (schedulePostFacebookGroups.length > 0) groupDropdown?.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (schedulePostDropdownJustOpened) return;
        if (!groupCombobox?.contains(e.target)) groupDropdown?.classList.remove('open');
    });

    document.getElementById('btnSubmitPostSchedule')?.addEventListener('click', submitPostSchedule);
    document.getElementById('btnDeleteSchedule')?.addEventListener('click', async () => { await deleteCurrentSchedulePost(); });

    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.addEventListener('change', () => { if (!cb.disabled) { renderAccountList(); toggleFacebookGroupSelectionForSchedulePost(); } });
    });

    window.addEventListener('resize', () => {
        const popover = document.getElementById('scheduleQuickPreviewPopover');
        if (popover?.classList.contains('open')) {
            const scheduleId = popover.dataset.scheduleId || '';
            const schedule = scheduleCalendarSchedulesCache.find(item => String(item._id) === String(scheduleId));
            const anchor = document.querySelector(`.schedule-item[data-schedule-id="${CSS?.escape ? CSS.escape(scheduleId) : scheduleId}"]`);
            if (schedule && anchor) positionSchedulePopover(popover, anchor);
        }
    });

    refreshSchedulePostPlatformOptions();
    initSchedulePostRealtimeSocket();
    renderCalendar();
});