// public/js/ai-comments.js
// AI Comments Bank frontend - Unified form with auto-detect type

(function () {
    'use strict';

    const data = window.__AI_COMMENTS_DATA__ || {};
    let editingId = null;

    // DOM
    const $modal = document.getElementById('commentModal');
    const $modalTitle = document.getElementById('modalTitle');
    const $form = document.getElementById('commentForm');
    const $id = document.getElementById('commentId');
    const $name = document.getElementById('commentName');
    const $textContent = document.getElementById('commentTextContent');
    const $fileInput = document.getElementById('commentFileInput');
    const $filePath = document.getElementById('commentFilePath');
    const $fileType = document.getElementById('commentFileType');
    const $fileName = document.getElementById('commentFileName');
    const $filePlaceholder = document.getElementById('filePlaceholder');
    const $filePreviewContent = document.getElementById('filePreviewContent');
    const $fileProgress = document.getElementById('fileProgress');
    const $fileProgressBar = document.getElementById('fileProgressBar');
    const $isActive = document.getElementById('commentIsActive');
    const $detectType = document.getElementById('detectType');
    const $tagsContainer = document.getElementById('commentTagsContainer');
    const $tagInput = document.getElementById('commentTagInput');
    let commentTags = [];

    // ============================================================
    // AUTO-DETECT TYPE
    // ============================================================
    // Logic ưu tiên: video > image > text
    // - Nếu upload video → type=video, text trở thành caption
    // - Nếu upload image → type=image, text trở thành caption
    // - Nếu chỉ có text → type=text
    function detectType() {
        const fileType = ($fileType?.value || '').toLowerCase();
        if (fileType === 'video') return 'video';
        if (fileType === 'image') return 'image';
        return 'text';
    }

    function detectCaption() {
        // Caption chỉ có ý nghĩa khi có file
        const t = detectType();
        if (t === 'text') return '';
        return $textContent.value.trim();
    }

    function updateDetectBadge() {
        if (!$detectType) return;
        const t = detectType();
        if (t === 'video') {
            $detectType.innerHTML = '<i class="fa-solid fa-video"></i> Video';
            $detectType.className = 'aic-detect-type aic-detect-video';
        } else if (t === 'image') {
            $detectType.innerHTML = '<i class="fa-solid fa-image"></i> Hình ảnh';
            $detectType.className = 'aic-detect-type aic-detect-image';
        } else {
            $detectType.innerHTML = '<i class="fa-solid fa-font"></i> Text';
            $detectType.className = 'aic-detect-type aic-detect-text';
        }
    }

    // Lắng nghe thay đổi text để cập nhật badge
    $textContent?.addEventListener('input', updateDetectBadge);

    // ============================================================
    // FILE UPLOAD
    // ============================================================
    $fileInput.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (!file) return;
        uploadFile(file);
    });

    // Click preview to trigger file input
    document.getElementById('filePreview').addEventListener('click', function () {
        $fileInput.click();
    });

    // Drag & drop
    const $filePreview = document.getElementById('filePreview');
    ['dragenter', 'dragover'].forEach(function (evt) {
        $filePreview.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            $filePreview.classList.add('aic-drag-over');
        });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
        $filePreview.addEventListener(evt, function (e) {
            e.preventDefault();
            e.stopPropagation();
            $filePreview.classList.remove('aic-drag-over');
        });
    });
    $filePreview.addEventListener('drop', function (e) {
        const dt = e.dataTransfer;
        const file = dt?.files?.[0];
        if (!file) return;
        $fileInput.files = dt.files;
        uploadFile(file);
    });

    function uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);

        const isVideo = file.type.startsWith('video/');
        const isImage = file.type.startsWith('image/');

        if (!isVideo && !isImage) {
            showToast('Chỉ hỗ trợ file ảnh hoặc video', 'error');
            return;
        }

        // Show preview
        $filePlaceholder.style.display = 'none';
        $filePreviewContent.style.display = 'block';
        $filePreviewContent.classList.add('has-file');
        $filePreview.classList.add('has-file');

        const reader = new FileReader();
        reader.onload = function (ev) {
            if (isImage) {
                $filePreviewContent.innerHTML = '<img src="' + ev.target.result + '" style="max-width:100%;max-height:180px;border-radius:6px;">';
            } else {
                $filePreviewContent.innerHTML = '<video src="' + ev.target.result + '" style="max-width:100%;max-height:180px;border-radius:6px;" controls></video>';
            }
        };
        reader.readAsDataURL(file);

        // Upload via XHR
        const xhr = new XMLHttpRequest();
        $fileProgress.style.display = 'block';
        $fileProgressBar.style.width = '0%';

        xhr.upload.onprogress = function (e) {
            if (e.lengthComputable) {
                const pct = (e.loaded / e.total) * 100;
                $fileProgressBar.style.width = pct + '%';
            }
        };

        xhr.onload = function () {
            $fileProgress.style.display = 'none';
            try {
                const res = JSON.parse(xhr.responseText);
                if (res.success && res.data) {
                    $filePath.value = res.data.filePath;
                    $fileType.value = res.data.type || (isVideo ? 'video' : 'image');
                    $fileName.textContent = res.data.fileName || 'Uploaded';
                    updateDetectBadge();
                    showToast('Upload file thành công!', 'success');
                } else {
                    showToast(res.message || 'Upload thất bại', 'error');
                    resetFilePreview();
                }
            } catch (e) {
                showToast('Lỗi xử lý response', 'error');
                resetFilePreview();
            }
        };

        xhr.onerror = function () {
            $fileProgress.style.display = 'none';
            showToast('Lỗi kết nối khi upload', 'error');
            resetFilePreview();
        };

        xhr.open('POST', '/schedule/ai-comment/api/upload-file', true);
        xhr.send(formData);
    }

    function resetFilePreview() {
        $filePath.value = '';
        $fileType.value = '';
        $fileName.textContent = '';
        $filePreviewContent.innerHTML = '';
        $filePreviewContent.style.display = 'none';
        $filePreviewContent.classList.remove('has-file');
        $filePreview.classList.remove('has-file');
        $filePlaceholder.style.display = 'flex';
        $fileInput.value = '';
        updateDetectBadge();
    }

    // ============================================================
    // MODAL
    // ============================================================
    function openModal() {
        $modal.style.display = 'flex';
        void $modal.offsetHeight;
        $modal.classList.add('is-visible');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        $modal.classList.remove('is-visible');
        setTimeout(function () {
            $modal.style.display = 'none';
            document.body.style.overflow = '';
        }, 320);
        resetForm();
    }

    function resetForm() {
        editingId = null;
        $form.reset();
        $id.value = '';
        resetFilePreview();
        $isActive.checked = true;
        $modalTitle.innerHTML = '<i class="fa-solid fa-plus"></i> Tạo Comment Mới';
        updateDetectBadge();
        commentTags = [];
        renderTags();
    }

    document.getElementById('btnNewComment')?.addEventListener('click', function () {
        resetForm();
        openModal();
    });
    document.getElementById('btnNewEmpty')?.addEventListener('click', function () {
        resetForm();
        openModal();
    });
    document.getElementById('btnCloseModal')?.addEventListener('click', closeModal);
    document.getElementById('btnCancel')?.addEventListener('click', closeModal);
    $modal?.addEventListener('click', function (e) {
        if (e.target === $modal) closeModal();
    });

    // ESC key to close
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && $modal.classList.contains('is-visible')) {
            closeModal();
        }
    });

    // ============================================================
    // FORM SUBMIT - Auto-detect type
    // ============================================================
    $form.addEventListener('submit', async function (e) {
        e.preventDefault();

        const type = detectType();
        const textVal = $textContent.value.trim();
        const fileVal = $filePath.value.trim();

        // Validation: phải có text hoặc file
        if (type === 'text' && !textVal) {
            return showToast('Vui lòng nhập nội dung comment', 'error');
        }
        if ((type === 'image' || type === 'video') && !fileVal) {
            return showToast('Vui lòng upload file ảnh/video', 'error');
        }

        let content = '';
        let caption = '';
        if (type === 'text') {
            content = textVal;
            caption = '';
        } else {
            content = fileVal;
            // Text trong trường hợp có file trở thành caption
            caption = textVal;
        }

        const payload = {
            type,
            name: $name.value.trim(),
            content,
            caption,
            isActive: $isActive.checked,
            tags: commentTags
        };

        const btn = document.getElementById('btnSave');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
        btn.disabled = true;

        try {
            if (editingId) {
                payload.commentId = editingId;
                const res = await fetch('/schedule/ai-comment/api/update', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const json = await res.json();
                if (json.success) {
                    showToast('Đã cập nhật comment!', 'success');
                    closeModal();
                    setTimeout(function () { location.reload(); }, 500);
                } else {
                    showToast(json.message || 'Lỗi cập nhật', 'error');
                }
            } else {
                const res = await fetch('/schedule/ai-comment/api/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const json = await res.json();
                if (json.success) {
                    showToast('Đã tạo comment!', 'success');
                    closeModal();
                    setTimeout(function () { location.reload(); }, 500);
                } else {
                    showToast(json.message || 'Lỗi tạo', 'error');
                }
            }
        } catch (err) {
            showToast('Lỗi: ' + err.message, 'error');
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }
    });

    // ============================================================
    // COMMENT ACTIONS
    // ============================================================

    // Edit
    document.querySelectorAll('.aic-btn-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const id = this.dataset.commentId;
            const comment = data.comments.find(function (c) { return c._id === id; });
            if (!comment) return showToast('Không tìm thấy comment', 'error');

            editingId = id;
            $id.value = id;
            $name.value = comment.name || '';
            $isActive.checked = comment.isActive;
            $modalTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Sửa Comment';

            // Load tags
            commentTags = Array.isArray(comment.tags) ? comment.tags.slice() : [];
            renderTags();

            // Reset file preview trước
            resetFilePreview();

            if (comment.type === 'text') {
                $textContent.value = comment.content || '';
            } else {
                $filePath.value = comment.content || '';
                $fileType.value = comment.type || '';
                $fileName.textContent = comment.content ? comment.content.split('/').pop() : '';
                // Caption chính là content text cũ (vì lúc tạo text → caption khi có file)
                $textContent.value = comment.caption || '';
                $filePlaceholder.style.display = 'none';
                $filePreviewContent.style.display = 'block';
                $filePreviewContent.classList.add('has-file');
                $filePreview.classList.add('has-file');
                if (comment.type === 'image') {
                    $filePreviewContent.innerHTML = '<img src="' + comment.content + '" style="max-width:100%;max-height:180px;border-radius:8px;display:block;" data-fallback-hide>';
                } else if (comment.type === 'video') {
                    $filePreviewContent.innerHTML = '<video src="' + comment.content + '" style="max-width:100%;max-height:180px;border-radius:8px;display:block;" controls preload="metadata"></video>';
                } else {
                    $filePreviewContent.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);"><i class="fa-solid fa-check-circle" style="color:#10b981;font-size:1.5rem;"></i><p style="margin:8px 0 0;font-size:0.85rem;">File: ' + escapeHtml(comment.content.split('/').pop()) + '</p></div>';
                }
            }

            updateDetectBadge();
            openModal();
        });
    });

    // Toggle
    document.querySelectorAll('.aic-btn-toggle').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            const id = this.dataset.commentId;
            try {
                const res = await fetch('/schedule/ai-comment/api/' + id + '/toggle', { method: 'POST' });
                const json = await res.json();
                if (json.success) {
                    showToast(json.message, 'success');
                    setTimeout(function () { location.reload(); }, 300);
                } else {
                    showToast(json.message || 'Lỗi', 'error');
                }
            } catch (err) {
                showToast('Lỗi: ' + err.message, 'error');
            }
        });
    });

    // Delete
    document.querySelectorAll('.aic-btn-delete').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            const id = this.dataset.commentId;
            if (!confirm('Xóa comment này?')) return;

            try {
                const res = await fetch('/schedule/ai-comment/api/' + id, { method: 'DELETE' });
                const json = await res.json();
                if (json.success) {
                    showToast('Đã xóa comment', 'success');
                    setTimeout(function () { location.reload(); }, 300);
                } else {
                    showToast(json.message || 'Lỗi xóa', 'error');
                }
            } catch (err) {
                showToast('Lỗi: ' + err.message, 'error');
            }
        });
    });

    // ============================================================
    // TAGS MANAGEMENT
    // ============================================================
    function renderTags() {
        if (!$tagsContainer) return;
        var html = '';
        commentTags.forEach(function (tag, idx) {
            html += '<span class="aic-tag-chip">' + escapeHtml(tag) +
                ' <i class="fa-solid fa-xmark" data-tag-idx="' + idx + '"></i></span>';
        });
        $tagsContainer.innerHTML = html;
        $tagsContainer.querySelectorAll('i[data-tag-idx]').forEach(function (icon) {
            icon.addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-tag-idx'), 10);
                commentTags.splice(idx, 1);
                renderTags();
            });
        });
    }

    if ($tagInput) {
        $tagInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                var val = this.value.trim().replace(/,$/, '').trim().toLowerCase();
                if (val && commentTags.indexOf(val) === -1) {
                    commentTags.push(val);
                    renderTags();
                }
                this.value = '';
            } else if (e.key === 'Backspace' && this.value === '' && commentTags.length > 0) {
                commentTags.pop();
                renderTags();
            }
        });
        $tagInput.addEventListener('blur', function () {
            var val = this.value.trim().toLowerCase();
            if (val && commentTags.indexOf(val) === -1) {
                commentTags.push(val);
                renderTags();
                this.value = '';
            }
        });
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function showToast(msg, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, type);
        } else {
            var toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:10000;padding:14px 18px;border-radius:12px;color:white;font-size:14px;font-weight:500;box-shadow:0 10px 15px rgba(0,0,0,0.1);animation:toastIn 0.35s ease;min-width:280px;display:flex;align-items:center;gap:10px;';
            toast.style.background = type === 'error' ? 'linear-gradient(135deg,#ef4444,#dc2626)' : type === 'warning' ? 'linear-gradient(135deg,#f59e0b,#d97706)' : type === 'info' ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : 'linear-gradient(135deg,#10b981,#059669)';
            var icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
            toast.innerHTML = '<span style="font-size:16px;">' + (icons[type] || '✓') + '</span><span>' + msg + '</span>';
            document.body.appendChild(toast);
            setTimeout(function () { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(function () { toast.remove(); }, 300); }, 3000);
        }
    }

    // Init badge on load
    updateDetectBadge();

    // CSP-compliant image error fallback: hide images with data-fallback-hide on error
    document.querySelectorAll('img[data-fallback-hide]').forEach(function (img) {
        img.addEventListener('error', function () {
            this.style.display = 'none';
        });
    });

    console.log('[AI Comments] Initialized. Comments:', data.comments?.length || 0);
})();
