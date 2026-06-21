/* ===================================
   INSTAGRAM.JS - Render tab nội dung cho Instagram
   Mặc định: chỉ đăng Feed (Story bị tắt)
   =================================== */

function renderInstagramTab(container, tab) {
    const accounts = (typeof getCheckedAccountsByPlatform === 'function')
        ? getCheckedAccountsByPlatform('IG')
        : [];
    if (!accounts.length) {
        container.innerHTML = `
            <div class="target-block target-block--ig">
                <div class="target-block__empty">
                    <i class="fa-brands fa-instagram"></i>
                    <span>Tick Instagram ở trên và chọn ít nhất 1 tài khoản IG để cấu hình nơi đăng</span>
                </div>
            </div>`;
        return;
    }

    const accNames = accounts.map(id => {
        const item = document.querySelector(`.account-card.acc-platform-IG input[value="${CSS.escape(id)}"]`);
        return item?.closest('.account-card')?.querySelector('.account-card__name')?.textContent?.trim() || id;
    }).slice(0, 3);
    const accHint = accNames.length > 1
        ? `${accNames.slice(0, -1).join(', ')} và ${accNames[accNames.length - 1]}`
        : accNames[0];

    container.innerHTML = `
        <div class="target-block target-block--ig">
            <div class="target-block__header">
                <i class="${tab.icon}"></i>
                <strong>Nơi đăng Instagram</strong>
            </div>
            <div class="target-block__body">
                <div class="ig-info-box">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>Bài sẽ đăng lên <strong>Feed</strong> của tài khoản <strong>@${escapeHtml(accHint)}</strong>.</span>
                </div>
                <div class="form-section__hint">
                    <i class="fa-solid fa-lightbulb"></i>
                    Bài viết sẽ hiển thị trên Feed chính của tài khoản Instagram.
                </div>
            </div>
        </div>`;
}

function collectInstagramOptions() {
    return { feed: true, story: false };
}

function onInstagramOptionsChange() {
    if (typeof refreshTargetTabsBadges === 'function') refreshTargetTabsBadges();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
