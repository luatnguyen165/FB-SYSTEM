// public/js/ai-wizard/wizard.js
// AI Content Creator wizard orchestrator
// Quản lý state, step navigation, validation, submit

(function (global) {
    'use strict';

    const SESSION_KEY = 'ai_wizard_draft';

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

    function showToast(msg, type = 'info') {
        if (typeof global.showToast === 'function') return global.showToast(msg, type);
        console.log('[toast]', type, msg);
    }

    function defaultState() {
        return {
            mode: 'new-post',          // new-post | new-pipeline | edit-schedule | edit-pipeline
            scheduleId: null,
            pipelineId: null,
            purpose: null,             // 'regular' | 'product'
            campaignName: '',
            writingStyleId: null,
            dateRange: { startDate: '', endDate: '' },
            platforms: ['FB'],
            timeSlots: [{ hour: 9, minute: 0, platforms: ['FB'], accountIds: [], postType: 'personal', groupIds: [] }],
            productId: null,
            direction: 'unset',
            contentConfig: { topics: [], maxWords: 500, language: 'vi' },
            enablePipeline: false,
            postsPerDay: 2,
            pipelineDirection: 'mixed',
            lockedSteps: [],
            channels: [],
            allGroups: [],
        };
    }

    let state = new global.WizardState(defaultState());
    let currentStep = 1;
    let channels = [];
    let allGroups = [];

    function persistDraft() {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ state: state.get(), step: currentStep })); } catch {}
    }
    function loadDraft() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch { return null; }
    }
    function clearDraft() { try { sessionStorage.removeItem(SESSION_KEY); } catch {} }

    // ============== STEP NAVIGATION ==============
    function showStep(n) {
        currentStep = n;
        document.querySelectorAll('.wizard-pane').forEach((p) => {
            p.classList.toggle('active', Number(p.dataset.pane) === n);
        });
        document.querySelectorAll('.wizard-step').forEach((s) => {
            const sn = Number(s.dataset.step);
            s.classList.toggle('active', sn === n);
            s.classList.toggle('done', sn < n);
        });
        document.getElementById('wizardPrev').style.visibility = n === 1 ? 'hidden' : 'visible';
        document.getElementById('wizardNext').innerHTML = n === 4 ? 'Hoàn tất <i class="fa-solid fa-check"></i>' : 'Tiếp tục <i class="fa-solid fa-arrow-right"></i>';
        updateFooterInfo();
        persistDraft();
    }

    function updateFooterInfo() {
        const info = document.getElementById('wizardFooterInfo');
        if (!info) return;
        const map = { 1: 'Bước 1/4 — Mục đích', 2: 'Bước 2/4 — Văn phong', 3: 'Bước 3/4 — Lịch đăng', 4: 'Bước 4/4 — Xem trước' };
        info.textContent = map[currentStep] || '';
    }

    function validateStep(n) {
        const s = state.get();
        if (n === 1) {
            if (!s.purpose) { showToast('Vui lòng chọn mục đích', 'error'); return false; }
            if (!s.campaignName.trim()) { showToast('Vui lòng nhập tên chiến dịch', 'error'); return false; }
        }
        if (n === 2 && !s.writingStyleId) {
            showToast('Vui lòng chọn văn phong', 'error');
            return false;
        }
        if (n === 3) {
            if (!s.dateRange.startDate || !s.dateRange.endDate) { showToast('Vui lòng chọn ngày bắt đầu/kết thúc', 'error'); return false; }
            if (!s.platforms.length) { showToast('Vui lòng chọn ít nhất 1 nền tảng', 'error'); return false; }
            if (!s.timeSlots.length) { showToast('Cần ít nhất 1 khung giờ', 'error'); return false; }
            if (s.purpose === 'product' && !s.productId) { showToast('Vui lòng chọn sản phẩm', 'error'); return false; }
        }
        return true;
    }

    function nextStep() {
        if (!validateStep(currentStep)) return;
        if (currentStep < 4) showStep(currentStep + 1);
        else finalize();
    }

    function prevStep() {
        if (currentStep > 1) showStep(currentStep - 1);
    }

    // ============== STEP 1: Purpose ==============
    function renderStep1() {
        const choices = document.querySelectorAll('#purposeChoices .wizard-choice');
        choices.forEach((c) => {
            c.classList.toggle('selected', c.dataset.purpose === state.get().purpose);
            c.onclick = () => {
                state.set({ purpose: c.dataset.purpose });
                renderStep1();
            };
        });
        const nameInput = document.getElementById('wizardCampaignName');
        if (nameInput) {
            nameInput.value = state.get().campaignName || '';
            nameInput.oninput = (e) => state.set({ campaignName: e.target.value });
        }
    }

    // ============== STEP 2: Style ==============
    async function renderStep2() {
        const select = document.getElementById('wizardStyleSelect');
        if (!select) return;
        try {
            const { styles } = await global.WizardAPI.listStyles();
            select.innerHTML = '';
            if (!styles.length) {
                select.appendChild(el('option', { value: '' }, '-- Chưa có văn phong nào --'));
            } else {
                select.appendChild(el('option', { value: '' }, '-- Chọn văn phong --'));
                styles.forEach((s) => {
                    const opt = el('option', { value: s._id }, `${s.name}${s.hasAnalysis ? '' : ' (chưa phân tích)'}`);
                    opt.dataset.hasAnalysis = s.hasAnalysis ? '1' : '0';
                    select.appendChild(opt);
                });
                select.value = state.get().writingStyleId || '';
            }
            select.onchange = async (e) => {
                const id = e.target.value;
                state.set({ writingStyleId: id });
                renderStyleInfo(id, styles);
            };
            if (state.get().writingStyleId) renderStyleInfo(state.get().writingStyleId, styles);
        } catch (err) {
            select.innerHTML = '<option value="">Lỗi tải danh sách</option>';
            showToast('Lỗi tải văn phong: ' + err.message, 'error');
        }

        const toggleBtn = document.getElementById('wizardToggleCreateStyle');
        const form = document.getElementById('wizardCreateStyleForm');
        toggleBtn.onclick = () => { form.style.display = form.style.display === 'none' ? 'block' : 'none'; };
        document.getElementById('wizardCancelCreateStyle').onclick = () => { form.style.display = 'none'; };
        document.getElementById('wizardSaveNewStyle').onclick = createNewStyle;
    }

    function renderStyleInfo(id, styles) {
        const info = document.getElementById('wizardStyleInfo');
        const s = (styles || []).find((x) => x._id === id);
        info.innerHTML = '';
        if (!s) return;
        info.appendChild(el('div', {
            style: { padding: '10px 12px', border: '1px solid var(--border-color, #e5e7eb)', borderRadius: '8px', background: 'var(--bg-soft, #f9fafb)', fontSize: '13px' },
            html: s.hasAnalysis
                ? '<i class="fa-solid fa-circle-check" style="color: var(--success, #10b981)"></i> Style đã phân tích AI — sẵn sàng dùng.'
                : '<i class="fa-solid fa-circle-exclamation" style="color: var(--warning, #f59e0b)"></i> Style chưa phân tích AI — sẽ tự động phân tích trước khi tạo bài.',
        }));
    }

    async function createNewStyle() {
        const name = document.getElementById('wizardNewStyleName').value.trim();
        const sample = document.getElementById('wizardNewStyleSample').value.trim();
        const topicsRaw = document.getElementById('wizardNewStyleTopics').value.trim();
        if (!name || !sample) { showToast('Cần tên và bài mẫu', 'error'); return; }
        try {
            const { style } = await global.WizardAPI.createStyle({
                name,
                sampleArticles: [{ title: 'Mẫu', content: sample, category: 'general' }],
                topics: topicsRaw ? topicsRaw.split('\n').map((s) => s.trim()).filter(Boolean) : [],
            });
            showToast('Đã tạo style, đang phân tích AI...', 'info');
            try { await global.WizardAPI.analyzeStyle(style._id); } catch (e) { showToast('Phân tích AI thất bại: ' + e.message, 'warning'); }
            state.set({ writingStyleId: style._id });
            document.getElementById('wizardCreateStyleForm').style.display = 'none';
            await renderStep2();
            showToast('Đã tạo và phân tích văn phong!', 'success');
        } catch (err) {
            showToast('Lỗi: ' + err.message, 'error');
        }
    }

    // ============== STEP 3: Schedule ==============
    function renderStep3() {
        // Bind date inputs
        const startInput = document.getElementById('wizardStartDate');
        const endInput = document.getElementById('wizardEndDate');
        startInput.value = state.get().dateRange.startDate;
        endInput.value = state.get().dateRange.endDate;
        startInput.onchange = (e) => state.set({ dateRange: { ...state.get().dateRange, startDate: e.target.value } });
        endInput.onchange = (e) => state.set({ dateRange: { ...state.get().dateRange, endDate: e.target.value } });

        // Topic textarea
        const topicsEl = document.getElementById('wizardTopics');
        topicsEl.value = (state.get().contentConfig.topics || []).join('\n');
        topicsEl.oninput = (e) => state.set({ contentConfig: { ...state.get().contentConfig, topics: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } });

        document.getElementById('wizardGenerateTopics').onclick = generateTopicsAI;

        const maxWordsEl = document.getElementById('wizardMaxWords');
        maxWordsEl.value = state.get().contentConfig.maxWords || 500;
        maxWordsEl.onchange = (e) => state.set({ contentConfig: { ...state.get().contentConfig, maxWords: parseInt(e.target.value) || 500 } });
        const langEl = document.getElementById('wizardLanguage');
        langEl.value = state.get().contentConfig.language || 'vi';
        langEl.onchange = (e) => state.set({ contentConfig: { ...state.get().contentConfig, language: e.target.value } });

        // Render platform picker + time slots + product picker
        global.WizardStep3.renderPlatformPicker(state.get(), channels, allGroups);
        global.WizardStep3.renderTimeSlots(state.get());
        global.WizardStep3.renderProductPicker(state.get());
        global.WizardStep3.mount(state.get());
    }

    async function generateTopicsAI() {
        if (!state.get().writingStyleId) { showToast('Cần chọn văn phong trước', 'error'); return; }
        const btn = document.getElementById('wizardGenerateTopics');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner"></i> Đang tạo...';
        try {
            const { topics } = await global.WizardAPI.generateTopics(state.get().writingStyleId);
            const existing = (state.get().contentConfig.topics || []);
            const merged = Array.from(new Set([...existing, ...(topics || [])]));
            state.set({ contentConfig: { ...state.get().contentConfig, topics: merged } });
            document.getElementById('wizardTopics').value = merged.join('\n');
            showToast(`Đã thêm ${topics?.length || 0} chủ đề`, 'success');
        } catch (e) {
            showToast('Lỗi: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-robot"></i> AI đề xuất chủ đề';
        }
    }

    // ============== STEP 4: Review ==============
    async function recalcSlots() {
        const s = state.get();
        try {
            const { count, sampleSlots } = await global.WizardAPI.previewSlots({
                dateRange: s.dateRange,
                timeSlots: s.timeSlots,
                contentConfig: s.contentConfig,
            });
            document.getElementById('wizardSlotCount').textContent = count;
            const preview = document.getElementById('wizardSlotPreview');
            preview.classList.remove('wizard-empty');
            preview.innerHTML = '';
            if (!count) {
                preview.appendChild(el('div', {}, 'Không có slot nào trong khoảng thời gian này.'));
                return;
            }
            preview.appendChild(el('div', { class: 'wizard-section-title' }, `Mẫu ${Math.min(sampleSlots.length, 20)}/${count} slot sẽ tạo`));
            const ul = el('ul', { style: { paddingLeft: '18px', margin: 0 } });
            sampleSlots.forEach((sl) => {
                const dt = new Date(sl.scheduledAt).toLocaleString('vi-VN');
                ul.appendChild(el('li', { style: { marginBottom: '4px', fontSize: '13px' } }, `${dt} — ${sl.topic} — ${(sl.platforms || []).join(', ')} — ${sl.postType === 'group' ? 'Nhóm' : 'Cá nhân'}`));
            });
            preview.appendChild(ul);
        } catch (e) {
            showToast('Lỗi: ' + e.message, 'error');
        }
    }

    async function renderStep4() {
        document.getElementById('wizardRecalcSlots').onclick = recalcSlots;
        document.getElementById('wizardGenerateNow').onclick = generateNow;
        document.getElementById('wizardRegenerate').onclick = regenerate;

        // Auto-toggle Step 5
        const toggle = document.getElementById('wizardAutoToggle');
        toggle.classList.toggle('on', state.get().enablePipeline);
        toggle.onclick = () => {
            const next = !state.get().enablePipeline;
            state.set({ enablePipeline: next });
            toggle.classList.toggle('on', next);
            document.getElementById('wizardAutoConfig').style.display = next ? 'block' : 'none';
        };
        document.getElementById('wizardAutoConfig').style.display = state.get().enablePipeline ? 'block' : 'none';

        const ppd = document.getElementById('wizardPostsPerDay');
        ppd.value = state.get().postsPerDay || 2;
        ppd.onchange = (e) => state.set({ postsPerDay: parseInt(e.target.value) || 2 });
        const dirSel = document.getElementById('wizardPipelineDirection');
        dirSel.value = state.get().pipelineDirection || 'mixed';
        dirSel.onchange = (e) => state.set({ pipelineDirection: e.target.value });
    }

    async function generateNow() {
        const s = state.get();
        const btn = document.getElementById('wizardGenerateNow');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner"></i> Đang tạo...';
        try {
            // Save schedule first
            let scheduleId = s.scheduleId;
            if (!scheduleId) {
                const { schedule } = await global.WizardAPI.createSchedule(collectSchedulePayload(s));
                scheduleId = schedule._id;
                state.set({ scheduleId });
            }
            const { count } = await global.WizardAPI.generateNow(scheduleId, false);
            showToast(`Đã tạo ${count} bài!`, 'success');
            document.getElementById('wizardRegenerate').style.display = 'inline-flex';
            await loadPostReview(scheduleId);
        } catch (e) {
            showToast('Lỗi: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Tạo bài ngay';
        }
    }

    async function regenerate() {
        const s = state.get();
        if (!s.scheduleId) return;
        if (!confirm('Tạo thêm bài mới mà KHÔNG xoá bài cũ?')) return;
        try {
            const { count } = await global.WizardAPI.generateNow(s.scheduleId, true);
            showToast(`Đã thêm ${count} bài!`, 'success');
            await loadPostReview(s.scheduleId);
        } catch (e) { showToast('Lỗi: ' + e.message, 'error'); }
    }

    async function loadPostReview(scheduleId) {
        try {
            const { posts } = await global.WizardAPI.listPosts({ scheduleId });
            const wrap = document.getElementById('wizardPostReview');
            const list = document.getElementById('wizardPostList');
            wrap.style.display = 'block';
            list.innerHTML = '';
            if (!posts?.length) { list.appendChild(el('div', { class: 'wizard-empty' }, 'Chưa có bài nào.')); return; }
            posts.forEach((p) => {
                list.appendChild(
                    el('div', { class: 'wizard-post-item' },
                        el('div', { style: { flex: 1 } },
                            el('strong', {}, p.title || '(Không tiêu đề)'),
                            el('div', { class: 'meta' }, `${new Date(p.scheduledAt).toLocaleString('vi-VN')} — ${(p.platforms || []).join(', ') || 'N/A'} — ${p.status}`)
                        ),
                        el('button', { class: 'btn-sm btn-view', onclick: () => global.viewPost?.(p._id) }, el('i', { class: 'fa-solid fa-eye' }))
                    )
                );
            });
        } catch (e) {
            showToast('Lỗi tải bài viết: ' + e.message, 'error');
        }
    }

    function collectSchedulePayload(s) {
        return {
            name: s.campaignName,
            writingStyleId: s.writingStyleId,
            productId: s.purpose === 'product' ? s.productId : null,
            direction: s.direction || 'unset',
            dateRange: s.dateRange,
            timeSlots: s.timeSlots,
            contentConfig: s.contentConfig,
            runImmediately: false,    // Wizard Step 4 sẽ gọi generateNow riêng
            status: 'draft',
        };
    }

    // ============== FINALIZE ==============
    async function finalize() {
        const s = state.get();

        // Validate: nếu là new-pipeline mode, bắt buộc phải có productId
        if (s.mode === 'new-pipeline' && !s.productId) {
            showToast('Pipeline yêu cầu chọn sản phẩm. Vui lòng quay lại Step 1 chọn "Quảng cáo sản phẩm" và chọn product.', 'error');
            return;
        }

        // Lưu draft schedule trước nếu chưa có
        if (!s.scheduleId) {
            try {
                const { schedule } = await global.WizardAPI.createSchedule(collectSchedulePayload(s));
                state.set({ scheduleId: schedule._id });
            } catch (e) { showToast('Lỗi lưu lịch: ' + e.message, 'error'); return; }
        }

        // Tạo pipeline nếu user bật Step 5 toggle
        if (s.enablePipeline) {
            // Fix Bug 7: tách direction giữa schedule và pipeline
            // - schedule.direction lấy từ state.direction (Step 3 product picker)
            // - pipeline.contentDirection lấy từ state.pipelineDirection (Step 5) nếu user đã chọn,
            //   fallback về product.direction hoặc 'mixed'
            const pipelineDir = s.pipelineDirection && s.pipelineDirection !== 'unset'
                ? s.pipelineDirection
                : (s.direction && s.direction !== 'unset' ? s.direction : 'mixed');

            // Fix Bug 2: validate postsPerDay hợp lệ
            const ppd = Math.max(1, Math.min(10, parseInt(s.postsPerDay) || 2));

            try {
                await global.WizardAPI.createPipeline({
                    productId: s.productId,
                    writingStyleId: s.writingStyleId,
                    postsPerDay: ppd,
                    platforms: s.platforms && s.platforms.length ? s.platforms : ['FB'],
                    accountIds: s.timeSlots[0]?.accountIds || [],
                    groupIds: s.timeSlots[0]?.groupIds || [],
                    timeSlots: s.timeSlots,
                    contentDirection: pipelineDir,
                });
                showToast('Đã tạo Auto Pipeline!', 'success');
            } catch (e) { showToast('Lỗi tạo pipeline: ' + e.message, 'error'); return; }
        }

        showToast('Hoàn tất! Đang tải lại...', 'success');
        clearDraft();
        // Fix Bug 9: delay đủ lâu để user đọc toast trước khi reload
        setTimeout(() => location.reload(), 1500);
    }

    async function saveDraft() {
        const s = state.get();
        try {
            const payload = { ...collectSchedulePayload(s), status: 'draft' };
            if (s.scheduleId) {
                await global.WizardAPI.updateSchedule(s.scheduleId, payload);
            } else {
                const { schedule } = await global.WizardAPI.createSchedule(payload);
                state.set({ scheduleId: schedule._id });
            }
            showToast('Đã lưu nháp.', 'success');
            clearDraft();
            setTimeout(() => location.reload(), 500);
        } catch (e) {
            showToast('Lỗi: ' + e.message, 'error');
        }
    }

    // ============== OPEN / CLOSE ==============
    async function openWizard(opts = {}) {
        const draft = loadDraft();
        const newState = defaultState();
        if (opts.mode) newState.mode = opts.mode;
        if (opts.scheduleId) newState.scheduleId = opts.scheduleId;
        if (opts.pipelineId) newState.pipelineId = opts.pipelineId;
        if (opts.purpose) newState.purpose = opts.purpose;

        // Fix Bug 6: new-pipeline mode tự bật enablePipeline
        if (opts.mode === 'new-pipeline') {
            newState.enablePipeline = true;
        }

        if (draft && !opts.force && draft.state?.mode === (opts.mode || 'new-post')) {
            Object.assign(newState, draft.state);
            currentStep = draft.step || 1;
        }
        state.reset(newState);

        // Load channels + groups once
        try {
            const [channelsData, groupsData] = await Promise.all([
                fetch('/channels/api/channels').then((r) => r.json()).catch(() => ({ channels: [] })),
                fetch('/schedule-groups/api/groups').then((r) => r.json()).catch(() => ({ groups: [] })),
            ]);
            channels = channelsData.channels || channelsData || [];
            allGroups = groupsData.groups || groupsData || [];
        } catch { channels = []; allGroups = []; }

        // Hydrate edit mode
        if (opts.mode === 'edit-schedule' && opts.scheduleId) {
            try {
                const { schedule, recentPosts } = await global.WizardAPI.getSchedule(opts.scheduleId);
                state.set({
                    purpose: schedule.productId ? 'product' : 'regular',
                    campaignName: schedule.name,
                    writingStyleId: schedule.writingStyleId?._id || schedule.writingStyleId,
                    dateRange: { startDate: schedule.dateRange.startDate?.substring(0, 10), endDate: schedule.dateRange.endDate?.substring(0, 10) },
                    timeSlots: schedule.timeSlots,
                    productId: schedule.productId?._id || schedule.productId || null,
                    direction: schedule.direction,
                    contentConfig: schedule.contentConfig,
                });
                currentStep = 3;
            } catch (e) { showToast('Lỗi tải lịch: ' + e.message, 'error'); }
        }
        if (opts.mode === 'edit-pipeline' && opts.pipelineId) {
            try {
                const { pipeline } = await global.WizardAPI.getPipeline(opts.pipelineId);
                state.set({
                    purpose: 'product',
                    campaignName: pipeline.productId?.name || 'Pipeline',
                    writingStyleId: pipeline.writingStyleId?._id || pipeline.writingStyleId,
                    platforms: pipeline.platforms,
                    timeSlots: pipeline.timeSlots,
                    productId: pipeline.productId?._id || pipeline.productId,
                    direction: pipeline.contentDirection,
                    enablePipeline: true,
                    postsPerDay: pipeline.postsPerDay,
                    pipelineDirection: pipeline.contentDirection,
                    pipelineId: pipeline._id,
                });
                currentStep = 3;
            } catch (e) { showToast('Lỗi tải pipeline: ' + e.message, 'error'); }
        }

        // Fix Bug 6: render Step 4 sau cùng để toggle hiển thị đúng trạng thái enablePipeline
        document.getElementById('aiWizardModal').style.display = 'flex';
        showStep(currentStep);
        renderStep1();
        if (currentStep >= 2) await renderStep2();
        if (currentStep >= 3) renderStep3();
        if (currentStep >= 4) await renderStep4();
    }

    function closeWizard() {
        document.getElementById('aiWizardModal').style.display = 'none';
    }

    // Bind buttons (after DOM ready)
    function bind() {
        document.getElementById('wizardPrev').onclick = prevStep;
        document.getElementById('wizardNext').onclick = nextStep;
        document.getElementById('wizardSaveDraft').onclick = saveDraft;
        // Escape to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('aiWizardModal').style.display === 'flex') closeWizard();
        });
        document.getElementById('aiWizardModal').addEventListener('click', (e) => {
            if (e.target.id === 'aiWizardModal') closeWizard();
        });
    }

    global.openWizard = openWizard;
    global.closeWizard = closeWizard;
    global.WizardBind = bind;
})(window);
