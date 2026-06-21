/* ===================================
   PINTEREST.JS - Render tab nội dung cho Pinterest
   =================================== */

function renderPinterestTab(container, tab) {
    const accounts = (typeof getCheckedAccountsByPlatform === 'function')
        ? getCheckedAccountsByPlatform('PI')
        : [];
    if (!accounts.length) {
        container.innerHTML = `
            <div class="target-block target-block--pi">
                <div class="target-block__empty">
                    <i class="fa-brands fa-pinterest"></i>
                    <span>Tick Pinterest ở trên và chọn ít nhất 1 tài khoản Pinterest để cấu hình nơi đăng</span>
                </div>
            </div>`;
        return;
    }

    const accNames = accounts.map(id => {
        const item = document.querySelector(`.account-card.acc-platform-PI input[value="${CSS.escape(id)}"]`);
        return item?.closest('.account-card')?.querySelector('.account-card__name')?.textContent?.trim() || id;
    }).slice(0, 3);
    const accHint = accNames.length > 1
        ? `${accNames.slice(0, -1).join(', ')} và ${accNames[accNames.length - 1]}`
        : accNames[0];

    container.innerHTML = `
        <div class="target-block target-block--pi">
            <div class="target-block__header">
                <i class="${tab.icon}"></i>
                <strong>Nơi đăng Pinterest</strong>
            </div>
            <div class="target-block__body">
                <div class="pi-info-box">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>Bài sẽ pin ảnh lên tài khoản <strong>@${escapeHtml(accHint)}</strong>.</span>
                </div>
                <div class="form-section__hint">
                    <i class="fa-solid fa-lightbulb"></i>
                    Pinterest chỉ pin <strong>1 ảnh mỗi lần</strong>. Dòng đầu của caption sẽ làm Title, phần còn lại làm Description.
                </div>
            </div>
        </div>`;
}

function collectPinterestOptions() {
    return {
        board: ''
    };
}

function onPinterestOptionsChange() {
    if (typeof refreshTargetTabsBadges === 'function') refreshTargetTabsBadges();
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
