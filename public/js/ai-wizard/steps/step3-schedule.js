// public/js/ai-wizard/steps/step3-schedule.js
// Step 3: Date range + platform + account + group + timeslot
// Reuse rendering pattern từ ai-content.js (renderScheduleAccounts, renderScheduleGroups, createTimeSlotEntry)

(function (global) {
    'use strict';

    const PLATFORMS = [
        { id: 'FB', label: 'Facebook', icon: 'fa-facebook' },
        { id: 'IG', label: 'Instagram', icon: 'fa-instagram' },
        { id: 'TT', label: 'TikTok', icon: 'fa-tiktok' },
    ];

    function el(tag, attrs = {}, ...children) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') e.className = v;
            else if (k === 'onclick') e.onclick = v;
            else if (k === 'dataset') Object.assign(e.dataset, v);
            else if (k === 'html') e.innerHTML = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
            else e.setAttribute(k, v);
        }
        children.flat().forEach((c) => {
            if (c == null || c === false) return;
            if (typeof c === 'string') e.appendChild(document.createTextNode(c));
            else e.appendChild(c);
        });
        return e;
    }

    // Build default time slot
    function defaultSlot() {
        return { hour: 9, minute: 0, platforms: ['FB'], accountIds: [], postType: 'personal', groupIds: [] };
    }

    // Render platform chips + account list (filter by selected platforms)
    function renderPlatformPicker(state, channels, allGroups) {
        const root = document.getElementById('wizardPlatformPicker');
        if (!root) return;
        root.innerHTML = '';

        // Platform chips
        const chips = el('div', { class: 'ai-platform-chips', style: { display: 'flex', gap: '8px', marginBottom: '12px' } });
        PLATFORMS.forEach((p) => {
            const selected = state.platforms.includes(p.id);
            const chip = el('button', {
                type: 'button',
                class: 'ai-platform-chip' + (selected ? ' active' : ''),
                dataset: { platform: p.id },
                onclick: () => {
                    const set = new Set(state.platforms);
                    set.has(p.id) ? set.delete(p.id) : set.add(p.id);
                    state.platforms = Array.from(set);
                    renderPlatformPicker(state, channels, allGroups);
                },
            }, el('i', { class: 'fa-brands ' + p.icon }), ' ' + p.label);
            chips.appendChild(chip);
        });
        root.appendChild(chips);

        // Account list (filtered by platforms)
        const filteredAccounts = (channels || []).filter((c) => state.platforms.includes(c.platform));
        const accountWrap = el('div', { class: 'ai-account-list' });
        if (!state.platforms.length) {
            accountWrap.appendChild(el('div', { class: 'wizard-empty' }, el('i', { class: 'fa-solid fa-circle-info' }), el('div', 'Chọn ít nhất 1 nền tảng.')));
        } else if (!filteredAccounts.length) {
            accountWrap.appendChild(el('div', { class: 'wizard-empty' }, el('i', { class: 'fa-solid fa-user-slash' }), el('div', 'Chưa có tài khoản nào được kết nối.')));
        } else {
            filteredAccounts.forEach((acc) => {
                const selected = state.timeSlots[0]?.accountIds?.includes(String(acc._id)) || false;
                const id = 'wizard-acc-' + acc._id;
                accountWrap.appendChild(
                    el('label', { class: 'ai-account-item', for: id, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', cursor: 'pointer', marginBottom: '6px' } },
                        el('input', { type: 'checkbox', id, value: acc._id, checked: selected ? 'checked' : null, onchange: (e) => {
                            state.timeSlots.forEach((s) => {
                                const set = new Set(s.accountIds || []);
                                e.target.checked ? set.add(String(acc._id)) : set.delete(String(acc._id));
                                s.accountIds = Array.from(set);
                            });
                        } }),
                        el('i', { class: 'fa-brands ' + (acc.platform === 'FB' ? 'fa-facebook' : acc.platform === 'IG' ? 'fa-instagram' : 'fa-tiktok'), style: { color: 'var(--primary)' } }),
                        el('span', { style: { flex: 1 } }, acc.accountName || acc.username || acc._id),
                        el('small', { style: { color: 'var(--text-muted)' } }, acc.platform)
                    )
                );
            });
        }
        root.appendChild(accountWrap);

        // Group picker chỉ hiển thị khi có FB và postType === 'group'
        if (state.platforms.includes('FB')) {
            const useGroup = state.timeSlots[0]?.postType === 'group';
            const typeWrap = el('div', { style: { marginTop: '12px' } });
            typeWrap.appendChild(el('div', { class: 'wizard-section-title' }, 'Đăng lên'));
            const typeChips = el('div', { style: { display: 'flex', gap: '8px' } });
            ['personal', 'group'].forEach((t) => {
                typeChips.appendChild(el('button', {
                    type: 'button',
                    class: 'ai-platform-chip' + ((useGroup && t === 'group') || (!useGroup && t === 'personal') ? ' active' : ''),
                    onclick: () => {
                        state.timeSlots.forEach((s) => { s.postType = t; });
                        renderPlatformPicker(state, channels, allGroups);
                    },
                }, t === 'personal' ? '👤 Cá nhân' : '👥 Nhóm'));
            });
            typeWrap.appendChild(typeChips);
            root.appendChild(typeWrap);

            if (useGroup) {
                const groupsRoot = el('div', { style: { marginTop: '10px' } });
                groupsRoot.appendChild(el('div', { class: 'wizard-section-title' }, 'Chọn nhóm'));
                const searchInput = el('input', {
                    type: 'text', placeholder: 'Tìm nhóm...', class: 'wizard-input',
                    style: { width: '100%', padding: '8px 10px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: '8px', marginBottom: '8px' },
                    oninput: (e) => filterGroups(e.target.value),
                });
                groupsRoot.appendChild(searchInput);
                const listWrap = el('div', { class: 'wizard-group-list', style: { maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', padding: '4px' } });
                if (!(allGroups || []).length) {
                    listWrap.appendChild(el('div', { class: 'wizard-empty' }, el('i', { class: 'fa-solid fa-users-slash' }), el('div', 'Chưa có nhóm nào. Vào /schedule-groups để quét.')));
                } else {
                    const renderList = (filter = '') => {
                        listWrap.innerHTML = '';
                        const lower = filter.toLowerCase();
                        allGroups.filter((g) => !lower || (g.name || '').toLowerCase().includes(lower)).forEach((g) => {
                            const gid = String(g.groupId || g._id);
                            const checked = state.timeSlots[0]?.groupIds?.includes(gid);
                            listWrap.appendChild(
                                el('label', { class: 'wizard-group-item', style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer' } },
                                    el('input', {
                                        type: 'checkbox', checked: checked ? 'checked' : null,
                                        onchange: (e) => {
                                            state.timeSlots.forEach((s) => {
                                                const set = new Set(s.groupIds || []);
                                                e.target.checked ? set.add(gid) : set.delete(gid);
                                                s.groupIds = Array.from(set);
                                            });
                                        },
                                    }),
                                    el('span', {}, g.name || gid),
                                )
                            );
                        });
                    };
                    renderList();
                    // Lưu filter fn để gọi lại khi search
                    groupsRoot._filterFn = renderList;
                }
                groupsRoot.appendChild(listWrap);
                root.appendChild(groupsRoot);
                function filterGroups(value) {
                    if (groupsRoot._filterFn) groupsRoot._filterFn(value);
                }
            }
        }
    }

    // Render time slots
    function renderTimeSlots(state) {
        const root = document.getElementById('wizardTimeSlots');
        if (!root) return;
        root.innerHTML = '';
        if (!state.timeSlots.length) state.timeSlots = [defaultSlot()];
        state.timeSlots.forEach((slot, idx) => {
            const wrap = el('div', { class: 'wizard-timeslot', style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', padding: '10px', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', background: 'var(--bg-soft, #f9fafb)' } });
            wrap.appendChild(el('span', { style: { fontSize: '13px', color: 'var(--text-muted)' } }, `#${idx + 1}`));
            wrap.appendChild(el('input', {
                type: 'number', min: '0', max: '23', value: slot.hour,
                style: { width: '70px', padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: '6px' },
                onchange: (e) => { slot.hour = parseInt(e.target.value) || 0; },
            }));
            wrap.appendChild(el('span', {}, ':'));
            wrap.appendChild(el('input', {
                type: 'number', min: '0', max: '59', value: slot.minute,
                style: { width: '70px', padding: '6px 8px', border: '1px solid var(--border-color, #d1d5db)', borderRadius: '6px' },
                onchange: (e) => { slot.minute = parseInt(e.target.value) || 0; },
            }));
            if (state.timeSlots.length > 1) {
                wrap.appendChild(el('button', {
                    type: 'button', class: 'btn-sm btn-delete', title: 'Xóa',
                    onclick: () => { state.timeSlots.splice(idx, 1); renderTimeSlots(state); },
                }, el('i', { class: 'fa-solid fa-trash' })));
            }
            root.appendChild(wrap);
        });
    }

    // Product picker (chỉ hiển thị nếu purpose === 'product')
    async function renderProductPicker(state) {
        const section = document.getElementById('wizardProductSection');
        const root = document.getElementById('wizardProductPicker');
        if (!section || !root) return;
        if (state.purpose !== 'product') { section.style.display = 'none'; return; }
        section.style.display = 'block';
        root.innerHTML = '<div class="wizard-loading"><i class="fa-solid fa-spinner"></i> Đang tải sản phẩm...</div>';
        try {
            const products = await global.WizardAPI.listProducts();
            if (!products.products?.length) {
                root.innerHTML = '';
                root.appendChild(el('div', { class: 'wizard-empty' }, el('i', { class: 'fa-solid fa-box-open' }), el('div', 'Chưa có sản phẩm nào. Vào tab Sản Phẩm để tạo trước.')));
                return;
            }
            root.innerHTML = '';
            const select = el('select', {
                onchange: (e) => {
                    state.productId = e.target.value || null;
                    const p = products.products.find((x) => String(x._id) === String(state.productId));
                    state.direction = p?.direction && p.direction !== 'unset' ? p.direction : state.direction;
                    renderDirectionInfo(state, p);
                },
            });
            select.appendChild(el('option', { value: '' }, '-- Chọn sản phẩm --'));
            products.products.forEach((p) => {
                select.appendChild(el('option', { value: p._id }, `${p.name}${p.category ? ' (' + p.category + ')' : ''}`));
            });
            select.value = state.productId || '';
            root.appendChild(select);
            const dirWrap = el('div', { id: 'wizardDirectionInfo', style: { marginTop: '8px' } });
            root.appendChild(dirWrap);
            if (state.productId) {
                const p = products.products.find((x) => String(x._id) === String(state.productId));
                renderDirectionInfo(state, p);
            }
        } catch (e) {
            root.innerHTML = '<div class="wizard-empty">Lỗi tải sản phẩm: ' + (e.message || 'unknown') + '</div>';
        }
    }

    function renderDirectionInfo(state, product) {
        const dirWrap = document.getElementById('wizardDirectionInfo');
        if (!dirWrap) return;
        dirWrap.innerHTML = '';
        if (!product) return;
        const select = el('select', {
            onchange: (e) => { state.direction = e.target.value; },
        });
        ['unset', 'mixed', 'advertising', 'purchase'].forEach((d) => {
            const labels = { unset: 'Theo sản phẩm', mixed: 'Kết hợp', advertising: 'Quảng cáo', purchase: 'Mua hàng' };
            select.appendChild(el('option', { value: d }, labels[d]));
        });
        select.value = state.direction || product.direction || 'unset';
        state.direction = select.value;
        dirWrap.appendChild(el('div', { class: 'wizard-section-title', style: { marginTop: '8px' } }, 'Hướng nội dung'));
        dirWrap.appendChild(select);
    }

    // Mount: gắn event cho nút "Thêm khung giờ"
    function mount(state) {
        const addBtn = document.getElementById('wizardAddTimeSlot');
        if (addBtn) {
            addBtn.onclick = () => {
                state.timeSlots.push(defaultSlot());
                renderTimeSlots(state);
            };
        }
    }

    global.WizardStep3 = { renderPlatformPicker, renderTimeSlots, renderProductPicker, mount };
})(window);
