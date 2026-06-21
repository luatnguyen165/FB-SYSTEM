/* ===================================
   TIKTOK.JS - Render tab nội dung cho TikTok
   =================================== */

function renderTikTokTab(container, tab) {
    const accounts = (typeof getCheckedAccountsByPlatform === 'function')
        ? getCheckedAccountsByPlatform('TT')
        : [];
    if (!accounts.length) {
        container.innerHTML = `
            <div class="target-block target-block--tt">
                <div class="target-block__empty">
                    <i class="fa-brands fa-tiktok"></i>
                    <span>Tick TikTok ở trên và chọn ít nhất 1 tài khoản TT để cấu hình nơi đăng</span>
                </div>
            </div>`;
        return;
    }

    const accNames = accounts.map(id => {
        const item = document.querySelector(`.account-card.acc-platform-TT input[value="${CSS.escape(id)}"]`);
        return item?.closest('.account-card')?.querySelector('.account-card__name')?.textContent?.trim() || id;
    }).slice(0, 3);
    const accHint = accNames.length > 1
        ? `${accNames.slice(0, -1).join(', ')} và ${accNames[accNames.length - 1]}`
        : accNames[0];

    container.innerHTML = `
        <div class="target-block target-block--tt">
            <div class="target-block__header">
                <i class="${tab.icon}"></i>
                <strong>Nơi đăng TikTok</strong>
            </div>
            <div class="target-block__body">
                <div class="tt-info-box">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>Bài sẽ đăng lên feed của <strong>@${escapeHtml(accHint)}</strong>.</span>
                </div>
                <div class="form-section__hint">
                    <i class="fa-solid fa-lightbulb"></i>
                    TikTok hiện chỉ hỗ trợ đăng feed video. Để đăng video hãy dùng chức năng "Đăng Reels / Video".
                </div>
            </div>
        </div>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
