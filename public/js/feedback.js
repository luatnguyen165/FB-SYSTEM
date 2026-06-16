// ===== Góp Ý & Yêu Cầu =====

document.addEventListener('DOMContentLoaded', function() {
    // Mở modal tạo mới
    document.getElementById('btnNewFeedback').addEventListener('click', function() {
        openNewFeedbackModal();
    });

    // Lưu feedback
    document.getElementById('btnSaveFeedback').addEventListener('click', saveFeedback);
});

function selectFeedbackType(el) {
    document.querySelectorAll('.feedback-type-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    el.querySelector('input[type="radio"]').checked = true;
}

function selectFeedbackPriority(el) {
    document.querySelectorAll('.feedback-priority-opt').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    el.querySelector('input[type="radio"]').checked = true;
}

function openNewFeedbackModal() {
    document.getElementById('feedbackModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Gửi Góp Ý';
    document.getElementById('feedbackEditId').value = '';
    document.getElementById('feedbackTitle').value = '';
    document.getElementById('feedbackDescription').value = '';
    document.getElementById('feedbackFeature').value = '';
    // Reset type
    document.querySelectorAll('.feedback-type-chip').forEach((c, i) => {
        c.classList.toggle('active', i === 0);
        c.querySelector('input[type="radio"]').checked = i === 0;
    });
    // Reset priority
    document.querySelectorAll('.feedback-priority-opt').forEach((c, i) => {
        c.classList.toggle('active', i === 1);
        c.querySelector('input[type="radio"]').checked = i === 1;
    });
    document.getElementById('feedbackModal').style.display = 'flex';
}

function closeFeedbackModal() {
    document.getElementById('feedbackModal').style.display = 'none';
}

async function saveFeedback() {
    const id = document.getElementById('feedbackEditId').value;
    const data = {
        type: document.querySelector('input[name="fbType"]:checked')?.value || 'feature',
        priority: document.querySelector('input[name="fbPriority"]:checked')?.value || 'medium',
        feature: document.getElementById('feedbackFeature').value,
        title: document.getElementById('feedbackTitle').value.trim(),
        description: document.getElementById('feedbackDescription').value.trim()
    };

    if (!data.title) { showToast('Vui lòng nhập tiêu đề', 'error'); return; }
    if (!data.description) { showToast('Vui lòng nhập mô tả chi tiết', 'error'); return; }
    if (!data.feature) { showToast('Vui lòng chọn tính năng liên quan', 'error'); return; }

    try {
        const url = id ? `/feedback/api/update/${id}` : '/feedback/api/create';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            showToast(id ? 'Đã cập nhật góp ý!' : 'Đã gửi góp ý! Cảm ơn bạn!', 'success');
            closeFeedbackModal();
            setTimeout(() => location.reload(), 1000);
        } else {
            showToast(result.error || 'Có lỗi xảy ra', 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, 'error');
    }
}

async function editFeedback(id) {
    try {
        const res = await fetch(`/feedback/api/get/${id}`);
        const result = await res.json();
        if (!result.success || !result.feedback) {
            showToast('Không tìm thấy góp ý', 'error');
            return;
        }
        const fb = result.feedback;
        document.getElementById('feedbackModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Sửa Góp Ý';
        document.getElementById('feedbackEditId').value = fb._id;
        document.getElementById('feedbackTitle').value = fb.title;
        document.getElementById('feedbackDescription').value = fb.description;
        document.getElementById('feedbackFeature').value = fb.feature || '';

        // Set type
        document.querySelectorAll('.feedback-type-chip').forEach(c => {
            const isActive = c.dataset.type === fb.type;
            c.classList.toggle('active', isActive);
            c.querySelector('input[type="radio"]').checked = isActive;
        });

        // Set priority
        document.querySelectorAll('.feedback-priority-opt').forEach(c => {
            const isActive = c.dataset.priority === fb.priority;
            c.classList.toggle('active', isActive);
            c.querySelector('input[type="radio"]').checked = isActive;
        });

        document.getElementById('feedbackModal').style.display = 'flex';
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, 'error');
    }
}

async function deleteFeedback(id) {
    if (!confirm('Bạn có chắc muốn xóa góp ý này?')) return;
    try {
        const res = await fetch(`/feedback/api/delete/${id}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            showToast('Đã xóa góp ý', 'success');
            document.querySelector(`.feedback-card[data-id="${id}"]`)?.remove();
            // Check if list is now empty
            const list = document.getElementById('feedbackList');
            if (list && list.querySelectorAll('.feedback-card').length === 0) {
                location.reload();
            }
        } else {
            showToast(result.error || 'Có lỗi xảy ra', 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, 'error');
    }
}

function showToast(message, type = 'success') {
    const container = document.querySelector('.toast-container') || (() => {
        const c = document.createElement('div');
        c.className = 'toast-container';
        document.body.appendChild(c);
        return c;
    })();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}