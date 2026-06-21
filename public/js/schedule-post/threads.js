/* ===================================
   THREADS.JS - Render tab nội dung cho Threads
   =================================== */

function renderThreadsTab(container, tab) {
    const accounts = (typeof getCheckedAccountsByPlatform === 'function')
        ? getCheckedAccountsByPlatform('TH')
        : [];
    if (!accounts.length) {
        container.innerHTML = `
            <div class="target-block target-block--th">
                <div class="target-block__empty">
                    <i class="fa-brands fa-threads"></i>
                    <span>Tick Threads ở trên và chọn ít nhất 1 tài khoản Threads để cấu hình nơi đăng</span>
                </div>
            </div>`;
        return;
    }

    const opts = collectThreadsOptions();
    const accNames = accounts.map(id => {
        const item = document.querySelector(`.account-card.acc-platform-TH input[value="${CSS.escape(id)}"]`);
        return item?.closest('.account-card')?.querySelector('.account-card__name')?.textContent?.trim() || id;
    }).slice(0, 3);
    const accHint = accNames.length > 1
        ? `${accNames.slice(0, -1).join(', ')} và ${accNames[accNames.length - 1]}`
        : accNames[0];

    container.innerHTML = `
        <div class="target-block target-block--th">
            <div class="target-block__header">
                <i class="${tab.icon}"></i>
                <strong>Nơi đăng Threads</strong>
            </div>
            <div class="target-block__body">
                <div class="th-info-box">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>Bài sẽ đăng lên feed của <strong>@${escapeHtml(accHint)}</strong>.</span>
                </div>
                <div class="form-section__sub">
                    <label class="th-option">
                        <input type="checkbox" id="thOptionFeed" ${opts.feed ? 'checked' : ''} onchange="onThreadsOptionsChange()">
                        <i class="fa-solid fa-comment"></i>
                        <span>Feed (text + ảnh)</span>
                    </label>
                </div>
                <div class="form-section__hint">
                    <i class="fa-solid fa-lightbulb"></i>
                    Threads cho phép đăng text kèm tối đa 10 ảnh. Mặc định đăng Feed, cần có ít nhất 1 ảnh.
                </div>
            </div>
        </div>`;
}

function collectThreadsOptions() {
    return { feed: document.getElementById('thOptionFeed')?.checked ?? true };
}

function onThreadsOptionsChange() {
    if (typeof refreshTargetTabsBadges === 'function') refreshTargetTabsBadges();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
