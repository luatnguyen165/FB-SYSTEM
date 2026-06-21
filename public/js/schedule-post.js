/* ===================================
   SCHEDULE-POST.JS - Main entry point
   Loads all schedule-post sub-modules via script tags
   =================================== */

let schedulePostAvailablePlatforms = new Set();
let schedulePostDropdownJustOpened = false;

/* ===================================
   ACCOUNT PICKER STATE (Redesign 2026-06-21)
   =================================== */
let accountPickerData = [];           // toàn bộ accounts từ API
let accountPickerPreferred = [];      // IDs đã tick từ schedule edit

function getAccountPickerInitial(accountName = '') {
    if (!accountName) return '?';
    const parts = accountName.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function renderAccountList(preferredAccounts) {
    const checkedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const boxContainer = document.getElementById('dynamicAccountBox');
    const toolbar = document.getElementById('accountPickerToolbar');
    const counter = document.getElementById('accountPickerCounter');
    const emptyState = document.getElementById('accountPickerEmpty');
    if (!boxContainer) return;

    // Normalize preferredAccounts: chấp nhận cả string ID lẫn object { _id }
    const normalizedPreferred = (Array.isArray(preferredAccounts) ? preferredAccounts : [])
        .map(a => {
            if (typeof a === 'string') return a;
            if (a && typeof a === 'object' && a._id) return String(a._id);
            return '';
        })
        .filter(Boolean);
    accountPickerPreferred = normalizedPreferred;

    console.log('[schedule-post] renderAccountList - preferred:', accountPickerPreferred);

    const typeMeta = (accountType = '') => {
        const normalized = String(accountType || '').trim() || 'Cá nhân';
        if (normalized === 'Fanpage') return { label: 'Fanpage', className: 'account-type-pill--fanpage', icon: 'fa-solid fa-flag' };
        if (normalized === 'Nhà sáng tạo') return { label: 'Nhà sáng tạo', className: 'account-type-pill--creator', icon: 'fa-solid fa-pen-nib' };
        return { label: 'Cá nhân', className: 'account-type-pill--personal', icon: 'fa-regular fa-user' };
    };

    const platformMeta = {
        FB: { name: 'Facebook', icon: 'fa-brands fa-facebook', color: '#1877F2' },
        IG: { name: 'Instagram', icon: 'fa-brands fa-instagram', color: '#E4405F' },
        TT: { name: 'TikTok', icon: 'fa-brands fa-tiktok', color: '#000000' },
        YT: { name: 'YouTube', icon: 'fa-brands fa-youtube', color: '#FF0000' },
        TH: { name: 'Threads', icon: 'fa-brands fa-threads', color: '#000000' },
        PI: { name: 'Pinterest', icon: 'fa-brands fa-pinterest', color: '#E60023' }
    };

    fetch('/channels/api/list')
        .then(res => res.json())
        .then(data => {
            if (!data.success) return;
            accountPickerData = Array.isArray(data.channels) ? data.channels : [];

            // Filter theo platform đang tick
            let filtered = accountPickerData.filter(ch => checkedPlatforms.includes(ch.platform));

            if (filtered.length === 0) {
                // Empty state
                boxContainer.innerHTML = '';
                if (toolbar) toolbar.style.display = 'none';
                if (counter) counter.style.display = 'none';
                if (emptyState) emptyState.style.display = '';
                return;
            }

            if (emptyState) emptyState.style.display = 'none';
            if (toolbar) toolbar.style.display = '';

            // Group theo platform
            const grouped = {};
            filtered.forEach(ch => {
                if (!grouped[ch.platform]) grouped[ch.platform] = [];
                grouped[ch.platform].push(ch);
            });

            // Render
            const search = (document.getElementById('accountPickerSearch')?.value || '').toLowerCase().trim();
            let html = '';
            let visibleTotal = 0;
            let checkedTotal = 0;

            const platformOrder = ['FB', 'IG', 'TT', 'YT', 'TH', 'PI'];
            platformOrder.forEach(platform => {
                if (!grouped[platform]) return;
                const accounts = grouped[platform].filter(ch => {
                    if (!search) return true;
                    return String(ch.accountName || '').toLowerCase().includes(search)
                        || String(ch.accountType || '').toLowerCase().includes(search);
                });
                if (accounts.length === 0) return;
                visibleTotal += accounts.length;

                const pm = platformMeta[platform];
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
                    // So sánh cả _id và accountName để cover cả 2 format DB
                    const chId = String(ch._id);
                    const chName = String(ch.accountName || '');
                    const isChecked = accountPickerPreferred.some(p => {
                        if (typeof p === 'string') {
                            // Nếu p trông như ObjectId hex (24 chars), so sánh với _id
                            if (/^[0-9a-fA-F]{24}$/.test(p)) return p === chId;
                            // Nếu không phải hex (là tên), so sánh với accountName
                            return p === chName;
                        }
                        return false;
                    });
                    if (isChecked) checkedTotal++;
                    const initial = getAccountPickerInitial(ch.accountName);
                    const avatarColor = pm.color;
                    const avatarHtml = ch.avatarUrl
                        ? `<img src="${ch.avatarUrl}" alt="${ch.accountName}" class="account-card__avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="account-card__avatar-fallback" style="background:${avatarColor};display:none;">${initial}</span>`
                        : `<span class="account-card__avatar-fallback" style="background:${avatarColor};">${initial}</span>`;

                    html += `
                        <label class="account-card acc-platform-${platform} ${isChecked ? 'is-selected' : ''}" data-account-id="${ch._id}" data-account-name="${String(ch.accountName || '').toLowerCase()}" data-account-type="${String(ch.accountType || '').toLowerCase()}">
                            <input type="checkbox" name="modalAccSelect" value="${ch._id}" data-account-name="${chName}" ${isChecked ? 'checked' : ''}>
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
            });

            if (visibleTotal === 0 && search) {
                html = `
                <div class="account-picker-no-result">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <p>Không tìm thấy tài khoản nào với từ khóa "<strong>${search}</strong>"</p>
                </div>`;
            }

            boxContainer.innerHTML = html;
            // Apply class is-selected ngay sau innerHTML (cách cũ để chắc chắn)
            boxContainer.querySelectorAll('input[name="modalAccSelect"]:checked').forEach(cb => {
                const card = cb.closest('.account-card');
                if (card) card.classList.add('is-selected');
            });

            // Apply lại lần nữa sau tick để chắc chắn CSS áp dụng khi edit
            setTimeout(() => {
                boxContainer.querySelectorAll('input[name="modalAccSelect"]:checked').forEach(cb => {
                    const card = cb.closest('.account-card');
                    if (card) card.classList.add('is-selected');
                });
                // EDIT MODE: Sau khi account list render xong, gọi lại renderTargetTabs
                // để "Nơi đăng" hiện ra với tab FB + group selection đúng theo account tick
                if (currentEditingSchedule) {
                    if (typeof renderTargetTabs === 'function') renderTargetTabs();
                }
            }, 10);

            updateAccountPickerCounter(visibleTotal, checkedTotal);
        })
        .catch(err => console.error('Load channels error:', err));
}

function updateAccountPickerCounter(visibleTotal, checkedTotal) {
    const counter = document.getElementById('accountPickerCounter');
    if (!counter) return;
    const total = accountPickerData.filter(ch => {
        const checkedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
        return checkedPlatforms.includes(ch.platform);
    }).length;
    if (total === 0) {
        counter.style.display = 'none';
    } else {
        counter.style.display = '';
        counter.textContent = `${checkedTotal}/${total} đã chọn`;
    }
}

function setupAccountPickerEvents() {
    const search = document.getElementById('accountPickerSearch');
    const clearBtn = document.getElementById('accountPickerSearchClear');
    const selectAllBtn = document.getElementById('accountPickerSelectAll');
    const box = document.getElementById('dynamicAccountBox');

    if (search) {
        search.addEventListener('input', () => {
            if (clearBtn) clearBtn.style.display = search.value ? '' : 'none';
            renderAccountList(accountPickerPreferred);
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (search) search.value = '';
            clearBtn.style.display = 'none';
            renderAccountList(accountPickerPreferred);
        });
    }
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const visibleCards = box.querySelectorAll('.account-card:not([style*="display: none"])');
            const allChecked = Array.from(visibleCards).every(c => c.querySelector('input').checked);
            visibleCards.forEach(card => {
                card.querySelector('input').checked = !allChecked;
                card.classList.toggle('is-selected', !allChecked);
            });
            // Đồng bộ preferred
            accountPickerPreferred = Array.from(box.querySelectorAll('input[name="modalAccSelect"]:checked'))
                .map(cb => String(cb.value));
            const visibleTotal = visibleCards.length;
            const checkedTotal = Array.from(visibleCards).filter(c => c.querySelector('input').checked).length;
            updateAccountPickerCounter(visibleTotal, checkedTotal);
            // Trigger change để các listener khác chạy
            box.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }
    if (box) {
        // Cập nhật counter khi tick/untick 1 card
        // Ép mỗi platform chỉ tick được 1 account: tick account mới → untick các account cùng platform khác
        box.addEventListener('change', (e) => {
            if (e.target?.name === 'modalAccSelect') {
                const card = e.target.closest('.account-card');
                if (card) card.classList.toggle('is-selected', e.target.checked);

                if (e.target.checked) {
                    // Lấy platform của card vừa tick
                    const platformMatch = card?.className?.match(/acc-platform-(\w+)/);
                    const platform = platformMatch?.[1];
                    if (platform) {
                        // Untick các account CÙNG platform khác
                        box.querySelectorAll(`.account-card.acc-platform-${platform} input[name="modalAccSelect"]:checked`)
                            .forEach(cb => {
                                if (cb !== e.target) {
                                    cb.checked = false;
                                    cb.closest('.account-card')?.classList.remove('is-selected');
                                }
                            });
                    }
                }

                accountPickerPreferred = Array.from(box.querySelectorAll('input[name="modalAccSelect"]:checked'))
                    .map(cb => String(cb.value));
                const visibleTotal = box.querySelectorAll('.account-card').length;
                const checkedTotal = box.querySelectorAll('input[name="modalAccSelect"]:checked').length;
                updateAccountPickerCounter(visibleTotal, checkedTotal);
            }
        });
    }
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
            // Không tự tick platform đầu tiên — để user chủ động chọn
            // firstAvailable = Array.from(document.querySelectorAll('.platform-check')).find(cb => !cb.disabled);
            // if (firstAvailable) firstAvailable.checked = true;
        }

        renderAccountList();
        onPlatformChipsChange();
    } catch (err) {
        console.error('Refresh schedule post platform options failed:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    setupAccountPickerEvents();

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
        cb.addEventListener('change', () => {
            if (!cb.disabled) {
                // Toggle class is-selected cho platform-picker-card tương ứng
                const card = cb.closest('.platform-picker-card');
                if (card) card.classList.toggle('is-selected', cb.checked);
                renderAccountList();
                onPlatformChipsChange();
            }
        });
    });
    // Khi tick/untick account, cập nhật badge trên tab + show/hide tabs
    const accountBox = document.getElementById('dynamicAccountBox');
    if (accountBox) {
        accountBox.addEventListener('change', (e) => {
            if (e.target?.name === 'modalAccSelect') {
                if (typeof refreshTargetTabsBadges === 'function') refreshTargetTabsBadges();
                if (typeof onAccountPickerChange === 'function') onAccountPickerChange();
            }
        });
    }

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