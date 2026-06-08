/* ===================================
   STORAGE.JS - Google Drive Config
   Kết nối API backend
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Nút lưu cấu hình
    const btnSave = document.getElementById('saveDriveConfigBtn');
    if (btnSave) btnSave.addEventListener('click', saveDriveConfig);

    // Nút kết nối Google Drive
    const btnConnect = document.getElementById('triggerGoogleAuthBtn');
    if (btnConnect) btnConnect.addEventListener('click', connectGoogleDrive);
});

async function saveDriveConfig() {
    const driveClientId = document.getElementById('driveClientId')?.value?.trim();
    const driveApiKey = document.getElementById('driveApiKey')?.value?.trim();
    const driveFolderId = document.getElementById('driveFolderId')?.value?.trim();

    if (!driveClientId || !driveApiKey) {
        showToast('Vui lòng nhập Client ID và API Key!', 'warning');
        return;
    }

    try {
        const payload = { driveClientId, driveApiKey, driveFolderId };
        const finalPayload = window.cryptoVault?.encryptPayload
            ? await window.cryptoVault.encryptPayload(payload, ['driveClientId', 'driveApiKey', 'driveFolderId'])
            : payload;

        const res = await fetch('/storage/api/drive-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload)
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}

async function connectGoogleDrive() {
    try {
        const res = await fetch('/storage/api/connect-drive', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            // Cập nhật UI trạng thái
            const disconnected = document.getElementById('statusLabelDisconnected');
            const connected = document.getElementById('statusLabelConnected');
            if (disconnected) disconnected.style.display = 'none';
            if (connected) connected.style.display = 'inline-flex';
        } else {
            showToast('Lỗi: ' + data.message, 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}
