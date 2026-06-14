// AI Content Creator - Frontend Logic

// ==================== TOAST ====================
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#6366f1' };
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    toast.style.cssText = `padding:14px 22px;border-radius:12px;color:white;font-size:14px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,0.15);animation:fadeIn 0.3s;display:flex;align-items:center;gap:10px;background:${colors[type] || colors.info};`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// ==================== TABS ====================
document.querySelectorAll('.ai-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.ai-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
});

// ==================== LOAD STATS ====================
async function loadStats() {
    try {
        const res = await fetch('/ai-content/api/stats');
        const data = await res.json();
        if (data.totalStyles !== undefined) {
            document.getElementById('statStyles').textContent = data.totalStyles;
            document.getElementById('statSchedules').textContent = data.totalSchedules;
            document.getElementById('statPosts').textContent = data.totalPosts;
            document.getElementById('statPublished').textContent = data.postedCount;
        }
    } catch (e) { console.error('Stats error:', e); }
}
loadStats();

// ==================== STYLE MODAL ====================
const styleModal = document.getElementById('styleModal');
const articlesList = document.getElementById('articlesList');

document.getElementById('btnNewStyle').addEventListener('click', () => {
    document.getElementById('styleModalTitle').innerHTML = '<i class="fa-solid fa-pen-fancy"></i> Tạo Văn Phong Mới';
    document.getElementById('styleEditId').value = '';
    document.getElementById('styleName').value = '';
    document.getElementById('styleTopics').value = '';
    articlesList.innerHTML = createArticleEntry('');
    styleModal.style.display = 'flex';
});

document.getElementById('btnAddArticle').addEventListener('click', () => {
    articlesList.insertAdjacentHTML('beforeend', createArticleEntry(''));
});

function createArticleEntry(article) {
    const title = article?.title || '';
    const content = article?.content || '';
    const category = article?.category || '';
    return `
    <div class="article-entry">
        <input type="text" class="form-input article-title" placeholder="Tiêu đề bài mẫu (tùy chọn)" value="${escapeHtml(title)}">
        <textarea class="form-input article-content" rows="4" placeholder="Nội dung bài viết mẫu...">${escapeHtml(content)}</textarea>
        <input type="text" class="form-input article-category" placeholder="Chủ đề / thể loại (tùy chọn)" value="${escapeHtml(category)}">
        <button type="button" class="btn-sm btn-remove-article" onclick="removeArticle(this)"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function removeArticle(btn) {
    const entries = articlesList.querySelectorAll('.article-entry');
    if (entries.length <= 1) { showToast('Cần ít nhất 1 bài viết mẫu', 'warning'); return; }
    btn.closest('.article-entry').remove();
}

function closeStyleModal() { styleModal.style.display = 'none'; }

// Save Style
document.getElementById('btnSaveStyle').addEventListener('click', async () => {
    const editId = document.getElementById('styleEditId').value;
    const name = document.getElementById('styleName').value.trim();
    const articles = [];
    articlesList.querySelectorAll('.article-entry').forEach(entry => {
        const content = entry.querySelector('.article-content').value.trim();
        if (content) {
            articles.push({
                title: entry.querySelector('.article-title').value.trim(),
                content,
                category: entry.querySelector('.article-category').value.trim(),
            });
        }
    });
    const topics = document.getElementById('styleTopics').value.split('\n').map(t => t.trim()).filter(Boolean);

    if (!name) { showToast('Nhập tên văn phong', 'error'); return; }
    if (!articles.length) { showToast('Cần ít nhất 1 bài viết mẫu', 'error'); return; }

    try {
        const url = editId ? `/ai-content/api/styles/${editId}` : '/ai-content/api/styles';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, sampleArticles: articles, topics })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast(editId ? 'Đã cập nhật văn phong' : 'Đã tạo văn phong mới');
        closeStyleModal();
        setTimeout(() => location.reload(), 500);
    } catch (e) { showToast(e.message, 'error'); }
});

// ==================== STYLE ACTIONS ====================
async function analyzeStyle(id) {
    if (!confirm('Phân tích văn phong bằng AI? Điều này sẽ sử dụng OpenAI API.')) return;
    try {
        showToast('Đang phân tích văn phong...', 'info');
        const res = await fetch(`/ai-content/api/styles/${id}/analyze`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('Phân tích thành công!');
        setTimeout(() => location.reload(), 500);
    } catch (e) { showToast(e.message, 'error'); }
}

async function editStyle(id) {
    try {
        const styleData = window.__stylesData?.find(s => s._id === id);
        if (!styleData) {
            showToast('Đang tải dữ liệu...', 'info');
            return;
        }
        document.getElementById('styleModalTitle').innerHTML = '<i class="fa-solid fa-pen-fancy"></i> Sửa Văn Phong';
        document.getElementById('styleEditId').value = id;
        document.getElementById('styleName').value = styleData.name || '';
        document.getElementById('styleTopics').value = (styleData.topics || []).join('\n');

        articlesList.innerHTML = '';
        (styleData.sampleArticles || []).forEach(a => {
            articlesList.insertAdjacentHTML('beforeend', createArticleEntry(a));
        });
        if (!articlesList.children.length) articlesList.innerHTML = createArticleEntry('');
        styleModal.style.display = 'flex';
    } catch (e) { showToast(e.message, 'error'); }
}

async function deleteStyle(id) {
    if (!confirm('Xóa văn phong này?')) return;
    try {
        const res = await fetch(`/ai-content/api/styles/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('Đã xóa văn phong');
        setTimeout(() => location.reload(), 500);
    } catch (e) { showToast(e.message, 'error'); }
}

// ==================== TRAINING ====================
async function retrainStyle(id) {
    if (!confirm('Train lại văn phong từ bài viết tốt nhất?\nAI sẽ phân tích lại style dựa trên top bài có nhiều like, comment, share nhất.')) return;
    
    try {
        showToast('Đang train lại văn phong... Quá trình này có thể mất 1-2 phút.', 'info');
        
        const btn = document.querySelector(`[data-id="${id}"] .btn-retrain`);
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            btn.disabled = true;
        }
        
        const res = await fetch(`/ai-content/api/styles/${id}/retrain`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        showToast(`Đã train lại thành công! Version ${data.version}. Đánh giá ${data.topPosts} bài, điểm TB: ${data.avgScore}`, 'success');
        setTimeout(() => location.reload(), 1000);
    } catch (e) {
        showToast(e.message, 'error');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-brain"></i>';
            btn.disabled = false;
        }
    }
}

async function viewTrainingStats(id) {
    try {
        const res = await fetch(`/ai-content/api/styles/${id}/training-stats`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        let msg = `Training Version: ${data.trainingVersion}\n`;
        msg += `Lần cuối train: ${data.lastTrainedAt ? new Date(data.lastTrainedAt).toLocaleString('vi-VN') : 'Chưa có'}\n`;
        msg += `Tổng bài đã tạo: ${data.totalGenerated}\n`;
        msg += `Bài đã đăng: ${data.totalPosts}`;
        
        if (data.logs && data.logs.length) {
            msg += `\n\n--- Lịch sử training ---`;
            data.logs.forEach(log => {
                msg += `\n\nv${log.version} (${new Date(log.createdAt).toLocaleString('vi-VN')}): Đánh giá ${log.postsEvaluated} bài, Điểm TB: ${log.avgScore}, Điểm cao nhất: ${log.topScore}`;
            });
        }
        
        alert(msg);
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ==================== SCHEDULE MODAL ====================
const scheduleModal = document.getElementById('scheduleModal');
const timeSlotsList = document.getElementById('timeSlotsList');

document.getElementById('btnNewSchedule')?.addEventListener('click', () => {
    document.getElementById('scheduleModalTitle').innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Tạo Lịch Mới';
    document.getElementById('scheduleEditId').value = '';
    document.getElementById('scheduleName').value = '';
    document.getElementById('scheduleStyleId').value = '';
    document.getElementById('scheduleStartDate').value = '';
    document.getElementById('scheduleStartDate').type = 'text';
    document.getElementById('scheduleEndDate').value = '';
    document.getElementById('scheduleEndDate').type = 'text';
    document.getElementById('scheduleTopics').value = '';
    document.getElementById('scheduleMaxWords').value = '500';
    document.getElementById('scheduleCustomInstructions').value = '';
    document.getElementById('scheduleLanguage').value = 'vi';
    document.getElementById('btnSaveSchedule').innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Tạo Lịch & Tạo Bài Ngay';
    timeSlotsList.innerHTML = createTimeSlotEntry();
    renderScheduleAccounts();
    scheduleModal.style.display = 'flex';
});

document.getElementById('btnAddTimeSlot')?.addEventListener('click', () => {
    timeSlotsList.insertAdjacentHTML('beforeend', createTimeSlotEntry());
});

// ==================== PLATFORM / ACCOUNT SELECTION ====================
function renderScheduleAccounts() {
    const selectedPlatform = document.querySelector('input[name="schedulePlatformPick"]:checked')?.value || 'FB';
    const channels = window.__channelsData || [];
    const accounts = channels.filter(ch => ch.platform === selectedPlatform);
    const container = document.getElementById('scheduleAccountsList');

    if (!accounts.length) {
        container.innerHTML = `<div class="schedule-accounts-empty">Chưa có tài khoản ${selectedPlatform} nào. Vui lòng thêm tài khoản tại <a href="/channels">Quản lý kênh</a>.</div>`;
    } else {
        container.innerHTML = accounts.map((ch, i) => `
            <label class="schedule-account-item" data-account-id="${ch._id}">
                <input type="radio" name="scheduleAccountSelect" value="${ch._id}" ${i === 0 ? 'checked' : ''} onchange="onAccountChange()">
                <span class="schedule-account-avatar">
                    <i class="fa-solid fa-user"></i>
                </span>
                <span class="schedule-account-info">
                    <span class="schedule-account-name">${ch.accountName || ch.platform}</span>
                    <span class="schedule-account-type">${ch.accountType || ch.platform}</span>
                </span>
                <span class="schedule-account-check"><i class="fa-solid fa-check"></i></span>
            </label>
        `).join('');
    }

    // Show/hide postType selector and reload groups
    onAccountChange();

    // Show/hide postType selector based on platform
    const postTypeGroup = document.getElementById('postTypeGroup');
    const postTypeGroupOption = document.getElementById('postTypeGroupOption');
    const groupSelectContainer = document.getElementById('groupSelectContainer');

    if (selectedPlatform === 'FB') {
        postTypeGroup.style.display = 'block';
        postTypeGroupOption.style.display = 'inline-flex';
    } else {
        // IG, TT: no groups option
        postTypeGroup.style.display = 'none';
        groupSelectContainer.style.display = 'none';
        // Reset to personal
        document.querySelector('input[name="postTypePick"][value="personal"]').checked = true;
        document.querySelectorAll('.post-type-chip').forEach(c => c.classList.remove('active'));
        document.querySelector('.post-type-chip[data-posttype="personal"]').classList.add('active');
    }

    renderScheduleGroups();
}

function onAccountChange() {
    // Re-render groups based on selected account
    renderScheduleGroups();
}

// ==================== POST TYPE (Personal / Group) ====================
function selectPostType(type) {
    document.querySelectorAll('.post-type-chip').forEach(c => c.classList.remove('active'));
    document.querySelector(`.post-type-chip[data-posttype="${type}"]`).classList.add('active');
    document.querySelector(`input[name="postTypePick"][value="${type}"]`).checked = true;

    const groupSelectContainer = document.getElementById('groupSelectContainer');
    if (type === 'group') {
        groupSelectContainer.style.display = 'block';
        renderScheduleGroups();
    } else {
        groupSelectContainer.style.display = 'none';
    }
}

function renderScheduleGroups(checkedGroupIds) {
    const container = document.getElementById('scheduleGroupsList');
    const groupCaches = window.__groupCaches || [];
    const selectedAccount = document.querySelector('input[name="scheduleAccountSelect"]:checked')?.value;

    // Find groups for selected account
    const matchingCaches = selectedAccount ? groupCaches.filter(gc => gc.channelId === selectedAccount) : [];

    if (!matchingCaches.length) {
        container.innerHTML = `<div class="schedule-accounts-empty">Chưa có nhóm nào. Vui lòng quét nhóm tại <a href="/schedule-groups">Quản lý nhóm</a>.</div>`;
        return;
    }

    // Collect all groups
    let allGroups = [];
    matchingCaches.forEach(gc => {
        (gc.groups || []).forEach(g => {
            allGroups.push({ ...g, accountName: gc.accountName });
        });
    });

    // Search input + select all / deselect all
    let html = `
    <div class="groups-search-bar">
        <i class="fa-solid fa-search"></i>
        <input type="text" class="groups-search-input" placeholder="Click để chọn nhóm..." oninput="filterScheduleGroups(this.value)">
        <button type="button" class="groups-select-all-btn" onclick="toggleAllGroups(true)" title="Chọn tất cả"><i class="fa-solid fa-check-double"></i></button>
        <button type="button" class="groups-select-all-btn" onclick="toggleAllGroups(false)" title="Bỏ chọn tất cả"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="groups-items-wrapper" id="groupsItemsWrapper">`;

    allGroups.forEach(g => {
        const isChecked = checkedGroupIds && checkedGroupIds.includes(g.groupId);
        html += `
        <label class="group-select-item" data-group-id="${g.groupId}" data-group-name="${(g.groupName || '').toLowerCase()}" data-account-name="${(g.accountName || '').toLowerCase()}">
            <input type="checkbox" name="scheduleGroupSelect" value="${g.groupId}" onchange="updateGroupCount()" ${isChecked ? 'checked' : ''}>
            <span class="group-select-check"><i class="fa-solid fa-check"></i></span>
            <span class="group-select-icon"><i class="fa-brands fa-facebook"></i></span>
            <span class="group-select-info">
                <span class="group-select-name">${g.groupName}</span>
                <span class="group-select-account">${g.accountName}</span>
            </span>
        </label>`;
    });

    html += `</div><div class="groups-selected-badges" id="groupsSelectedBadges"></div><div class="groups-count-bar" id="groupsCountBar">Đã chọn <strong id="groupCountNum">0</strong> / ${allGroups.length} nhóm</div>`;

    container.innerHTML = html;

    // Groups list hidden by default, show on search focus/click
    const wrapper = document.getElementById('groupsItemsWrapper');
    const searchInput = container.querySelector('.groups-search-input');
    const searchBar = container.querySelector('.groups-search-bar');
    if (wrapper) wrapper.style.display = 'none';
    if (searchInput) {
        searchInput.addEventListener('focus', () => {
            if (wrapper) wrapper.style.display = '';
        });
        searchInput.addEventListener('blur', () => {
            // Delay to allow click on group items
            setTimeout(() => {
                if (wrapper && !wrapper.matches(':hover')) {
                    wrapper.style.display = 'none';
                }
            }, 200);
        });
    }
    if (searchBar) {
        searchBar.addEventListener('click', (e) => {
            if (e.target === searchBar || e.target.tagName === 'I') {
                if (wrapper) wrapper.style.display = '';
                if (searchInput) searchInput.focus();
            }
        });
    }

    renderGroupBadges();
    updateGroupCount();
}

function filterScheduleGroups(keyword) {
    const kw = keyword.toLowerCase().trim();
    document.querySelectorAll('#groupsItemsWrapper .group-select-item').forEach(item => {
        const name = item.dataset.groupName || '';
        const account = item.dataset.accountName || '';
        item.style.display = (!kw || name.includes(kw) || account.includes(kw)) ? '' : 'none';
    });
}

function toggleAllGroups(select) {
    document.querySelectorAll('#groupsItemsWrapper .group-select-item').forEach(item => {
        if (item.style.display !== 'none') {
            item.querySelector('input[type="checkbox"]').checked = select;
        }
    });
    updateGroupCount();
}

function updateGroupCount() {
    const total = document.querySelectorAll('#groupsItemsWrapper .group-select-item').length;
    const checked = document.querySelectorAll('#groupsItemsWrapper input[name="scheduleGroupSelect"]:checked').length;
    const el = document.getElementById('groupCountNum');
    if (el) el.textContent = checked;
    renderGroupBadges();
}

function renderGroupBadges() {
    const badgesContainer = document.getElementById('groupsSelectedBadges');
    if (!badgesContainer) return;

    const checked = document.querySelectorAll('#groupsItemsWrapper input[name="scheduleGroupSelect"]:checked');
    let html = '';
    checked.forEach(cb => {
        const item = cb.closest('.group-select-item');
        const name = item?.querySelector('.group-select-name')?.textContent || cb.value;
        html += `<span class="group-badge" onclick="removeGroupBadge('${cb.value}')"><i class="fa-brands fa-facebook"></i> ${name} <i class="fa-solid fa-xmark"></i></span>`;
    });

    badgesContainer.innerHTML = html;
}

function removeGroupBadge(groupId) {
    const cb = document.querySelector(`#groupsItemsWrapper input[name="scheduleGroupSelect"][value="${groupId}"]`);
    if (cb) {
        cb.checked = false;
        updateGroupCount();
    }
}

function createTimeSlotEntry() {
    return `
    <div class="time-slot-entry">
        <input type="time" class="form-input time-slot-time" value="09:00">
        <button type="button" class="btn-sm btn-remove-article" onclick="removeTimeSlot(this)"><i class="fa-solid fa-trash"></i></button>
    </div>`;
}

function removeTimeSlot(btn) {
    const entries = timeSlotsList.querySelectorAll('.time-slot-entry');
    if (entries.length <= 1) { showToast('Cần ít nhất 1 khung giờ', 'warning'); return; }
    btn.closest('.time-slot-entry').remove();
}

function closeScheduleModal() { scheduleModal.style.display = 'none'; }

// ==================== AI GENERATE TOPICS ====================
async function generateTopicsAI() {
    const styleId = document.getElementById('scheduleStyleId').value;
    if (!styleId) {
        showToast('Vui lòng chọn văn phong trước', 'warning');
        return;
    }

    const btn = document.getElementById('btnGenerateTopics');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tạo...';
    btn.disabled = true;

    try {
        const res = await fetch('/ai-content/api/generate-topics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ writingStyleId: styleId })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        const topics = data.topics || [];
        if (!topics.length) {
            showToast('AI không tạo được chủ đề. Thử lại sau.', 'warning');
            return;
        }

        // Show generated topics as clickable chips
        const listEl = document.getElementById('generatedTopicsList');
        listEl.style.display = 'block';
        listEl.innerHTML = `
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
                ${topics.map((t, i) => `
                    <span class="generated-topic-chip" onclick="addGeneratedTopic(this)" 
                          style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:8px;font-size:12px;font-weight:500;background:var(--bg-main);border:1.5px solid var(--border);color:var(--text-muted);cursor:pointer;transition:all 0.2s;user-select:none;"
                          data-topic="${escapeHtml(t)}">
                        <i class="fa-solid fa-plus" style="font-size:10px;"></i> ${escapeHtml(t)}
                    </span>
                `).join('')}
            </div>
            <div style="display:flex;gap:8px;">
                <button type="button" class="btn-sm btn-generate" onclick="addAllGeneratedTopics()" style="font-size:11px;">
                    <i class="fa-solid fa-check-double"></i> Thêm tất cả
                </button>
                <button type="button" class="btn-sm btn-delete" onclick="document.getElementById('generatedTopicsList').style.display='none'" style="font-size:11px;">
                    <i class="fa-solid fa-xmark"></i> Đóng
                </button>
            </div>
        `;

        showToast(`Đã tạo ${topics.length} chủ đề hot!`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

function addGeneratedTopic(chip) {
    const topic = chip.dataset.topic;
    const textarea = document.getElementById('scheduleTopics');
    const current = textarea.value.trim();
    if (current && !current.endsWith('\n')) textarea.value += '\n';
    textarea.value += topic + '\n';
    chip.style.opacity = '0.4';
    chip.style.pointerEvents = 'none';
    chip.querySelector('i').className = 'fa-solid fa-check';
    showToast(`Đã thêm: ${topic}`, 'info');
}

function addAllGeneratedTopics() {
    const chips = document.querySelectorAll('#generatedTopicsList .generated-topic-chip');
    const textarea = document.getElementById('scheduleTopics');
    let current = textarea.value.trim();
    let added = 0;
    chips.forEach(chip => {
        if (chip.style.pointerEvents !== 'none') {
            if (current && !current.endsWith('\n')) current += '\n';
            current += chip.dataset.topic + '\n';
            chip.style.opacity = '0.4';
            chip.style.pointerEvents = 'none';
            chip.querySelector('i').className = 'fa-solid fa-check';
            added++;
        }
    });
    textarea.value = current;
    showToast(`Đã thêm ${added} chủ đề`, 'success');
}

// Save Schedule
document.getElementById('btnSaveSchedule')?.addEventListener('click', async () => {
    const editId = document.getElementById('scheduleEditId').value;
    const name = document.getElementById('scheduleName').value.trim();
    const writingStyleId = document.getElementById('scheduleStyleId').value;
    const startDate = document.getElementById('scheduleStartDate').value;
    const endDate = document.getElementById('scheduleEndDate').value;

    if (!name) { showToast('Nhập tên lịch', 'error'); return; }
    if (!writingStyleId) { showToast('Chọn văn phong', 'error'); return; }
    if (!startDate || !endDate) { showToast('Chọn khoảng ngày', 'error'); return; }

    // Get selected platform and accounts
    const selectedPlatform = document.querySelector('input[name="schedulePlatformPick"]:checked')?.value || 'FB';
    const selectedAccountId = document.querySelector('input[name="scheduleAccountSelect"]:checked')?.value;

    if (!selectedAccountId) { showToast('Chọn tài khoản đăng bài', 'error'); return; }

    // Get postType and groupIds
    const postType = document.querySelector('input[name="postTypePick"]:checked')?.value || 'personal';
    const groupIds = postType === 'group'
        ? Array.from(document.querySelectorAll('input[name="scheduleGroupSelect"]:checked')).map(cb => cb.value)
        : [];

    const timeSlots = [];
    timeSlotsList.querySelectorAll('.time-slot-entry').forEach(entry => {
        const time = entry.querySelector('.time-slot-time').value;
        if (time) {
            const [hour, minute] = time.split(':').map(Number);
            timeSlots.push({
                hour, minute,
                platforms: [selectedPlatform],
                accountIds: [selectedAccountId],
                postType,
                groupIds,
            });
        }
    });

    if (!timeSlots.length) { showToast('Cần ít nhất 1 khung giờ hợp lệ', 'error'); return; }
    if (postType === 'group' && !groupIds.length) { showToast('Chọn ít nhất 1 nhóm', 'error'); return; }

    const topics = document.getElementById('scheduleTopics').value.split('\n').map(t => t.trim()).filter(Boolean);

    const body = {
        name,
        writingStyleId,
        dateRange: { startDate, endDate },
        timeSlots,
        contentConfig: {
            topics,
            minWords: 200,
            maxWords: parseInt(document.getElementById('scheduleMaxWords').value) || 500,
            customInstructions: document.getElementById('scheduleCustomInstructions').value.trim(),
            language: document.getElementById('scheduleLanguage').value,
        },
        status: 'active',
    };

    try {
        const url = editId ? `/ai-content/api/schedules/${editId}` : '/ai-content/api/schedules';
        const method = editId ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (data.generatedCount > 0) {
            showToast(`Đã tạo lịch và AI đã tạo ${data.generatedCount} bài viết!`, 'success');
        } else {
            showToast(editId ? 'Đã cập nhật lịch' : 'Đã tạo lịch mới');
        }
        closeScheduleModal();
        setTimeout(() => location.reload(), 800);
    } catch (e) { showToast(e.message, 'error'); }
});

// ==================== SCHEDULE ACTIONS ====================
async function generateNow(id) {
    if (!confirm('Tạo bài viết ngay lập tức?')) return;
    try {
        showToast('Đang tạo bài viết...', 'info');
        const res = await fetch(`/ai-content/api/schedules/${id}/generate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast(data.message || 'Đã tạo bài viết');
        setTimeout(() => location.reload(), 500);
    } catch (e) { showToast(e.message, 'error'); }
}

function editSchedule(id) {
    const schedule = window.__schedulesData?.find(s => s._id === id);
    if (!schedule) {
        showToast('Không tìm thấy lịch', 'error');
        return;
    }

    // Store pending group IDs for restoration after rendering
    const firstSlot = schedule.timeSlots?.[0];
    const savedGroupIds = firstSlot?.groupIds || [];
    const savedAccountId = firstSlot?.accountIds?.[0] || '';
    const savedPostType = firstSlot?.postType || 'personal';

    // Set modal title
    document.getElementById('scheduleModalTitle').innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Sửa Lịch Nội Dung';
    document.getElementById('scheduleEditId').value = id;

    // Fill basic fields
    document.getElementById('scheduleName').value = schedule.name || '';
    document.getElementById('scheduleStyleId').value = schedule.writingStyleId?._id || schedule.writingStyleId || '';
    document.getElementById('scheduleMaxWords').value = schedule.contentConfig?.maxWords || 500;
    document.getElementById('scheduleLanguage').value = schedule.contentConfig?.language || 'vi';
    document.getElementById('scheduleCustomInstructions').value = schedule.contentConfig?.customInstructions || '';

    // Fill dates
    if (schedule.dateRange?.startDate) {
        const sd = new Date(schedule.dateRange.startDate);
        document.getElementById('scheduleStartDate').value = sd.toISOString().split('T')[0];
        document.getElementById('scheduleStartDate').type = 'date';
    }
    if (schedule.dateRange?.endDate) {
        const ed = new Date(schedule.dateRange.endDate);
        document.getElementById('scheduleEndDate').value = ed.toISOString().split('T')[0];
        document.getElementById('scheduleEndDate').type = 'date';
    }

    // Fill topics
    document.getElementById('scheduleTopics').value = (schedule.contentConfig?.topics || []).join('\n');

    // Fill time slots
    timeSlotsList.innerHTML = '';
    (schedule.timeSlots || []).forEach(slot => {
        const time = (slot.hour < 10 ? '0' : '') + slot.hour + ':' + (slot.minute < 10 ? '0' : '') + slot.minute;
        timeSlotsList.insertAdjacentHTML('beforeend', `
            <div class="time-slot-entry">
                <input type="time" class="form-input time-slot-time" value="${time}">
                <button type="button" class="btn-sm btn-remove-article" onclick="removeTimeSlot(this)"><i class="fa-solid fa-trash"></i></button>
            </div>
        `);
    });
    if (!timeSlotsList.children.length) {
        timeSlotsList.innerHTML = createTimeSlotEntry();
    }

    // Set platform from first timeSlot
    if (firstSlot?.platforms?.[0]) {
        const platformRadio = document.querySelector(`input[name="schedulePlatformPick"][value="${firstSlot.platforms[0]}"]`);
        if (platformRadio) {
            platformRadio.checked = true;
        }
    }

    // Render accounts first (triggers onAccountChange → renderScheduleGroups with default account)
    renderScheduleAccounts();

    // Set correct account, then re-render groups for that account
    if (savedAccountId) {
        const accountRadio = document.querySelector(`input[name="scheduleAccountSelect"][value="${savedAccountId}"]`);
        if (accountRadio) {
            accountRadio.checked = true;
        }
    }

    // Set post type (shows group container and renders groups if 'group')
    selectPostType(savedPostType);

    // For group postType: re-render groups for the correct account with saved selections
    if (savedPostType === 'group') {
        renderScheduleGroups(savedGroupIds);
    }

    // Update button text
    document.getElementById('btnSaveSchedule').innerHTML = '<i class="fa-solid fa-save"></i> Lưu thay đổi';

    scheduleModal.style.display = 'flex';
}

async function deleteSchedule(id) {
    if (!confirm('Xóa lịch này và tất cả bài viết liên quan?')) return;
    try {
        const res = await fetch(`/ai-content/api/schedules/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('Đã xóa lịch');
        setTimeout(() => location.reload(), 500);
    } catch (e) { showToast(e.message, 'error'); }
}

// ==================== POST MODAL — Premium Editor ====================
const postModal = document.getElementById('postModal');
const postTitleInput = document.getElementById('postTitle');
const postContentInput = document.getElementById('postContent');
const wordCountNum = document.getElementById('wordCountNum');
const wordCountEl = document.getElementById('postWordCount');

function closePostModal() { postModal.style.display = 'none'; }

// Word count updater
function updateWordCount() {
    const text = postContentInput.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    wordCountNum.textContent = words;
    wordCountEl.classList.remove('count-warn', 'count-ok');
    if (words > 0) {
        wordCountEl.classList.add(words >= 100 ? 'count-ok' : 'count-warn');
    }
}

// Auto-resize textarea
function autoResizeTextarea() {
    postContentInput.style.height = 'auto';
    postContentInput.style.height = Math.max(320, postContentInput.scrollHeight) + 'px';
}

postContentInput?.addEventListener('input', () => {
    updateWordCount();
    autoResizeTextarea();
});

// Toggle channel chip
function toggleChannelChip(chip) {
    chip.classList.toggle('active');
}

// View post — fetches full data from API
async function viewPost(id) {
    try {
        const res = await fetch(`/ai-content/api/posts?limit=100`);
        const data = await res.json();
        const post = data.posts?.find(p => p._id === id);
        if (!post) {
            showToast('Không tìm thấy bài viết', 'error');
            return;
        }
        openPostModal(post, false);
    } catch (e) {
        // Fallback: read from DOM
        const card = document.querySelector(`.ai-post-card[data-id="${id}"]`);
        if (!card) return;
        const post = {
            _id: id,
            title: card.querySelector('.ai-post-title')?.textContent || '',
            content: card.querySelector('.ai-post-content-preview')?.textContent || '',
            status: card.dataset.status || 'draft',
            scheduledAt: card.querySelector('.ai-post-date')?.textContent || '',
            platforms: [],
        };
        openPostModal(post, false);
    }
}

// Edit post — fetches full data from API
async function editPost(id) {
    try {
        const res = await fetch(`/ai-content/api/posts?limit=100`);
        const data = await res.json();
        const post = data.posts?.find(p => p._id === id);
        if (!post) {
            showToast('Không tìm thấy bài viết', 'error');
            return;
        }
        openPostModal(post, true);
    } catch (e) {
        const card = document.querySelector(`.ai-post-card[data-id="${id}"]`);
        if (!card) return;
        const post = {
            _id: id,
            title: card.querySelector('.ai-post-title')?.textContent || '',
            content: card.querySelector('.ai-post-content-preview')?.textContent || '',
            status: card.dataset.status || 'draft',
            scheduledAt: card.querySelector('.ai-post-date')?.textContent || '',
            platforms: [],
        };
        openPostModal(post, true);
    }
}

// Open post modal with data
function openPostModal(post, isEdit) {
    document.getElementById('postEditId').value = post._id;
    document.getElementById('postTitle').value = post.title || '';
    document.getElementById('postContent').value = post.content || '';

    // Update title
    document.getElementById('postModalTitle').innerHTML = isEdit
        ? '<i class="fa-solid fa-pen-to-square"></i> Chỉnh sửa bài viết'
        : '<i class="fa-solid fa-eye"></i> Xem bài viết';

    // Update meta bar
    const statusChip = document.getElementById('postStatusChip');
    const statusText = document.getElementById('postStatusText');
    statusText.textContent = post.status || 'draft';
    statusChip.className = 'post-meta-chip status-' + (post.status || 'draft');

    document.getElementById('postDateText').textContent = post.scheduledAt || '-';
    document.getElementById('postScheduleText').textContent = post.scheduleId?.name || 'N/A';

    // Update channel chips
    const platforms = post.platforms || [];
    document.querySelectorAll('#postChannelsGrid .post-channel-chip').forEach(chip => {
        const p = chip.dataset.platform;
        chip.classList.toggle('active', platforms.includes(p));
    });

    // Update word count
    updateWordCount();

    // Auto-resize
    setTimeout(autoResizeTextarea, 50);

    // Toggle edit mode
    const saveBtn = document.getElementById('btnSavePost');
    const titleInput = document.getElementById('postTitle');
    const contentInput = document.getElementById('postContent');

    if (isEdit) {
        saveBtn.style.display = 'flex';
        titleInput.readOnly = false;
        contentInput.readOnly = false;
        titleInput.style.opacity = '1';
        contentInput.style.opacity = '1';
    } else {
        saveBtn.style.display = 'none';
        titleInput.readOnly = true;
        contentInput.readOnly = true;
        titleInput.style.opacity = '0.7';
        contentInput.style.opacity = '0.7';
    }

    postModal.style.display = 'flex';
}

// Save Post
document.getElementById('btnSavePost')?.addEventListener('click', async () => {
    const id = document.getElementById('postEditId').value;
    const title = document.getElementById('postTitle').value.trim();
    const content = document.getElementById('postContent').value.trim();

    if (!content) { showToast('Nội dung không được để trống', 'error'); return; }

    // Gather selected platforms
    const platforms = [];
    document.querySelectorAll('#postChannelsGrid .post-channel-chip.active').forEach(chip => {
        platforms.push(chip.dataset.platform);
    });

    const saveBtn = document.getElementById('btnSavePost');
    saveBtn.classList.add('btn-loading');
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner"></i> Đang lưu...';

    try {
        const res = await fetch(`/ai-content/api/posts/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, platforms })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('Đã lưu bài viết thành công!');
        closePostModal();
        setTimeout(() => location.reload(), 500);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        saveBtn.classList.remove('btn-loading');
        saveBtn.innerHTML = '<i class="fa-solid fa-save"></i> Lưu thay đổi';
    }
});

// ==================== POST ACTIONS ====================
async function publishPost(id) {
    if (!confirm('Đăng bài viết này ngay?')) return;
    try {
        const res = await fetch(`/ai-content/api/posts/${id}/publish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast(data.message || 'Đã lên lịch đăng bài');
        setTimeout(() => location.reload(), 500);
    } catch (e) { showToast(e.message, 'error'); }
}

async function deletePost(id) {
    if (!confirm('Xóa bài viết này?')) return;
    try {
        const res = await fetch(`/ai-content/api/posts/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        showToast('Đã xóa bài viết');
        setTimeout(() => location.reload(), 500);
    } catch (e) { showToast(e.message, 'error'); }
}

function filterPosts() {
    const scheduleId = document.getElementById('filterSchedule').value;
    const status = document.getElementById('filterStatus').value;
    document.querySelectorAll('.ai-post-card').forEach(card => {
        const matchSchedule = !scheduleId || card.querySelector('.ai-post-meta span')?.textContent.includes(scheduleId);
        const matchStatus = !status || card.dataset.status === status;
        card.style.display = (matchSchedule && matchStatus) ? '' : 'none';
    });
}

// ==================== UTILS ====================
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}

// Close modals on overlay click
document.querySelectorAll('.ai-modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
});

// Keyboard escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.ai-modal-overlay').forEach(m => m.style.display = 'none');
    }
});