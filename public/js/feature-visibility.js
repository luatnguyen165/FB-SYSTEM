/* ===================================
   FEATURE-VISIBILITY.JS
   ReelsFlow AI - Admin Feature Management
   =================================== */

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnSaveFeatures')?.addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('.feature-checkbox');
        const updates = {};

        checkboxes.forEach(cb => {
            updates[cb.dataset.key] = cb.checked;
        });

        try {
            const res = await fetch('/features/api/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
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
    });
});