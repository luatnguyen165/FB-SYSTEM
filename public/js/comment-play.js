(function() {
    'use strict';

    const data = window.__PLAY_DATA__ || {};
    let editingId = null;

    // DOM
    const $modal = document.getElementById('playModal');
    const $modalTitle = document.getElementById('modalTitle');
    const $form = document.getElementById('playForm');
    const $playId = document.getElementById('playId');
    const $playName = document.getElementById('playName');
    const $playDesc = document.getElementById('playDescription');
    const $scheduleType = document.getElementById('scheduleType');
    const $intervalMinutes = document.getElementById('intervalMinutes');
    const $timeStart = document.getElementById('timeStart');
    const $timeEnd = document.getElementById('timeEnd');
    const $delayMin = document.getElementById('delayMin');
    const $delayMax = document.getElementById('delayMax');
    const $maxPerDay = document.getElementById('maxPerDay');
    const $targetType = document.getElementById('targetType');
    const $groupIds = document.getElementById('groupIds');
    const $postUrls = document.getElementById('postUrls');
    const $groupIdsGroup = document.getElementById('groupIdsGroup');
    const $postUrlsGroup = document.getElementById('postUrlsGroup');
    const $scanConfigGroup = document.getElementById('scanConfigGroup');
    const $scanConfigId = document.getElementById('scanConfigId');
    const $playChannelId = document.getElementById('playChannelId');
    const $filterTypes = document.querySelectorAll('.filter-type');
    const $commentChecks = document.querySelectorAll('.cp-comment-check');
    const $selectedCommentCount = document.getElementById('selectedCommentCount');
    const $postAllComments = document.getElementById('postAllComments');

    // ============================================================
    // COMMENT PICKER - Update count
    // ============================================================
    $commentChecks.forEach(function (cb) {
        cb.addEventListener('change', updateCommentCount);
    });

    function updateCommentCount() {
        var checked = document.querySelectorAll('.cp-comment-check:checked').length;
        if ($selectedCommentCount) $selectedCommentCount.textContent = checked;
    }

    function getSelectedCommentIds() {
        var ids = [];
        document.querySelectorAll('.cp-comment-check:checked').forEach(function (cb) {
            ids.push(cb.value);
        });
        return ids;
    }

    function setSelectedCommentIds(ids) {
        document.querySelectorAll('.cp-comment-check').forEach(function (cb) {
            cb.checked = ids.includes(cb.value);
        });
        updateCommentCount();
    }

    // ============================================================
    // TABS
    // ============================================================
    document.querySelectorAll('.cp-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            // Deactivate all
            document.querySelectorAll('.cp-tab').forEach(function (t) { t.classList.remove('active'); });
            document.querySelectorAll('.cp-tab-content').forEach(function (c) { c.classList.remove('active'); });

            // Activate clicked
            this.classList.add('active');
            var target = document.getElementById('tab-' + this.dataset.tab);
            if (target) target.classList.add('active');
        });
    });

    // ============================================================
    // TARGET TYPE SWITCH
    // ============================================================
    $targetType?.addEventListener('change', function () {
        $groupIdsGroup.style.display = 'none';
        $postUrlsGroup.style.display = 'none';
        $scanConfigGroup.style.display = 'none';

        if (this.value === 'specific-posts') {
            $postUrlsGroup.style.display = '';
        } else if (this.value === 'ai-scan-results') {
            $scanConfigGroup.style.display = '';
        } else {
            // group-posts
            $groupIdsGroup.style.display = '';
        }
    });

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
        $playId.value = '';
        $modalTitle.innerHTML = '<i class="fa-solid fa-play"></i> ▶ Tạo Kịch Bản Mới';
        // Reset defaults
        $intervalMinutes.value = 30;
        $timeStart.value = '06:00';
        $timeEnd.value = '23:59';
        $delayMin.value = 5;
        $delayMax.value = 15;
        $maxPerDay.value = 50;
        $filterTypes.forEach(function (cb) { cb.checked = true; });
        // Reset tab
        document.querySelectorAll('.cp-tab').forEach(function (t, i) {
            t.classList.toggle('active', i === 0);
        });
        document.querySelectorAll('.cp-tab-content').forEach(function (c, i) {
            c.classList.toggle('active', i === 0);
        });
        // Show groupIds by default
        $groupIdsGroup.style.display = '';
        $postUrlsGroup.style.display = 'none';
        $scanConfigGroup.style.display = 'none';
    }

    // Open buttons
    document.getElementById('btnNewPlay')?.addEventListener('click', function () {
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
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && $modal.classList.contains('is-visible')) {
            closeModal();
        }
    });

    // ============================================================
    // LOGS MODAL
    // ============================================================
    const $logsModal = document.getElementById('logsModal');
    const $logsContent = document.getElementById('logsContent');

    function openLogsModal() {
        $logsModal.style.display = 'flex';
        void $logsModal.offsetHeight;
        $logsModal.classList.add('is-visible');
        document.body.style.overflow = 'hidden';
    }

    function closeLogsModal() {
        $logsModal.classList.remove('is-visible');
        setTimeout(function () {
            $logsModal.style.display = 'none';
            document.body.style.overflow = '';
        }, 320);
    }

    document.getElementById('btnCloseLogs')?.addEventListener('click', closeLogsModal);
    $logsModal?.addEventListener('click', function (e) {
        if (e.target === $logsModal) closeLogsModal();
    });

    async function loadLogs(playId) {
        $logsContent.innerHTML = '<div class="cp-empty" style="padding:24px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:2rem;color:var(--text-muted);"></i><p>Đang tải lịch sử...</p></div>';
        openLogsModal();

        try {
            const res = await fetch('/schedule/ai-comment/play/api/' + playId + '/logs');
            const json = await res.json();
            if (!json.success || !json.logs || json.logs.length === 0) {
                $logsContent.innerHTML = '<div class="cp-empty" style="padding:24px;"><i class="fa-solid fa-clock-rotate-left" style="font-size:2.5rem;color:var(--text-light);"></i><p>Chưa có lịch sử chạy.</p></div>';
                return;
            }
            var html = '';
            json.logs.forEach(function (log) {
                var statusClass = log.status === 'success' ? 'cp-log-success' : 'cp-log-error';
                var icon = log.status === 'success' ? 'fa-circle-check' : 'fa-circle-xmark';
                var statusText = log.status === 'success' ? 'Thành công' : 'Lỗi';
                var time = log.postedAt ? new Date(log.postedAt).toLocaleString('vi-VN') : '';
                html += '<div class="cp-log-item ' + statusClass + '">';
                html += '  <div class="cp-log-icon"><i class="fa-solid ' + icon + '"></i></div>';
                html += '  <div class="cp-log-info">';
                html += '    <div class="cp-log-text">' + escapeHtml(log.commentText || '') + '</div>';
                html += '    <div class="cp-log-meta">';
                html += '      <span class="cp-log-status">' + statusText + '</span>';
                html += '      <span><i class="fa-solid fa-link"></i> ' + escapeHtml(log.targetUrl || '') + '</span>';
                html += '      <span class="cp-log-time"><i class="fa-regular fa-clock"></i> ' + time + '</span>';
                html += '    </div>';
                if (log.errorMessage) {
                    html += '    <div style="margin-top:4px;font-size:0.75rem;color:#ef4444;">' + escapeHtml(log.errorMessage) + '</div>';
                }
                html += '  </div>';
                html += '</div>';
            });
            $logsContent.innerHTML = html;
        } catch (err) {
            $logsContent.innerHTML = '<div class="cp-empty" style="padding:24px;color:#ef4444;"><i class="fa-solid fa-exclamation-triangle" style="font-size:2rem;"></i><p>Lỗi tải lịch sử: ' + err.message + '</p></div>';
        }
    }

    // ============================================================
    // FORM SUBMIT
    // ============================================================
    $form.addEventListener('submit', async function (e) {
        e.preventDefault();

        // Collect filter types
        var selectedTypes = [];
        $filterTypes.forEach(function (cb) {
            if (cb.checked) selectedTypes.push(cb.value);
        });

        // Collect groupIds
        var groupIdsArr = $groupIds.value.trim().split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        // Collect postUrls
        var postUrlsArr = $postUrls.value.trim().split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        // Collect selected comment ids
        var selectedCommentIds = getSelectedCommentIds();
        // Collect scanConfigId
        var scanConfigIdVal = $scanConfigId.value || '';
        // Collect channelId
        var channelIdVal = $playChannelId.value || '';

        var payload = {
            name: $playName.value.trim(),
            description: $playDesc.value.trim(),
            schedule: {
                type: $scheduleType.value,
                intervalMinutes: parseInt($intervalMinutes.value) || 30,
                timeRange: {
                    start: $timeStart.value || '08:00',
                    end: $timeEnd.value || '22:00'
                },
                maxPerDay: parseInt($maxPerDay.value) || 50,
                commentDelay: {
                    min: parseInt($delayMin.value) || 5,
                    max: parseInt($delayMax.value) || 15
                }
            },
            channelId: channelIdVal,
            selectedCommentIds: selectedCommentIds,
            postAllComments: $postAllComments ? $postAllComments.checked : false,
            target: {
                type: $targetType.value,
                groupIds: groupIdsArr,
                postUrls: postUrlsArr,
                scanConfigId: scanConfigIdVal,
                filter: {
                    types: selectedTypes
                }
            }
        };

        var btn = document.getElementById('btnSave');
        var origHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
        btn.disabled = true;

        try {
            var url, method;
            if (editingId) {
                url = '/schedule/ai-comment/play/api/' + editingId + '/update';
                method = 'PUT';
            } else {
                url = '/schedule/ai-comment/play/api/create';
                method = 'POST';
            }

            var res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var json = await res.json();
            if (json.success) {
                showToast(editingId ? 'Đã cập nhật kịch bản!' : 'Đã tạo kịch bản!', 'success');
                closeModal();
                setTimeout(function () { location.reload(); }, 500);
            } else {
                showToast(json.message || 'Lỗi lưu kịch bản', 'error');
            }
        } catch (err) {
            showToast('Lỗi: ' + err.message, 'error');
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }
    });

    // ============================================================
    // CARD ACTIONS
    // ============================================================

    // Edit
    document.querySelectorAll('.cp-btn-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = this.dataset.playId;
            var play = data.plays.find(function (p) { return p._id === id; });
            if (!play) return showToast('Không tìm thấy kịch bản', 'error');

            editingId = id;
            $playId.value = id;
            $playName.value = play.name || '';
            $playDesc.value = play.description || '';
            $modalTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> ▶ Sửa Kịch Bản';

            // Schedule
            $scheduleType.value = play.schedule?.type || 'interval';
            $intervalMinutes.value = play.schedule?.intervalMinutes || 30;
            $timeStart.value = play.schedule?.timeRange?.start || '08:00';
            $timeEnd.value = play.schedule?.timeRange?.end || '22:00';
            $delayMin.value = play.schedule?.commentDelay?.min || 5;
            $delayMax.value = play.schedule?.commentDelay?.max || 15;
            $maxPerDay.value = play.schedule?.maxPerDay || 50;

            // Channel
            var channelId = play.channelId || '';
            if ($playChannelId) {
                // Tìm option và select
                for (var i = 0; i < $playChannelId.options.length; i++) {
                    if ($playChannelId.options[i].value === channelId) {
                        $playChannelId.selectedIndex = i;
                        break;
                    }
                }
            }

            // Target
            $targetType.value = play.target?.type || 'group-posts';
            $groupIds.value = (play.target?.groupIds || []).join('\n');
            $postUrls.value = (play.target?.postUrls || []).join('\n');

            // Toggle visibility
            if ($targetType.value === 'specific-posts') {
                $groupIdsGroup.style.display = 'none';
                $postUrlsGroup.style.display = '';
            } else {
                $groupIdsGroup.style.display = '';
                $postUrlsGroup.style.display = 'none';
            }

            // Filter types
            var filterTypes = play.target?.filter?.types || [];
            $filterTypes.forEach(function (cb) {
                cb.checked = filterTypes.length === 0 || filterTypes.includes(cb.value);
            });

            // Selected comments
            var selectedIds = play.selectedCommentIds || [];
            setSelectedCommentIds(selectedIds);

            // postAllComments
            if ($postAllComments) {
                $postAllComments.checked = !!play.postAllComments;
            }

            openModal();
        });
    });

    // Toggle
    document.querySelectorAll('.cp-btn-toggle').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var id = this.dataset.playId;
            try {
                var res = await fetch('/schedule/ai-comment/play/api/' + id + '/toggle', { method: 'POST' });
                var json = await res.json();
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

    // Bản dịch lý do bỏ qua sang tiếng Việt dễ hiểu
    var skipReasonMessages = {
        'no_target_posts_available': 'Không còn bài viết nào để comment (đã comment hết các bài match trong cấu hình quét)',
        'no_comments_available': 'Chưa có comment mẫu nào trong kho - hãy tạo comment ở trang AI Comments',
        'outside_time_range': 'Ngoài khung giờ chạy đã cấu hình',
        'max_per_day_reached': 'Đã đạt giới hạn số comment trong ngày'
    };

    // ============================================================
    // PLAY BUTTON = AUTO COMMENT ALL (gộp thành 1 nút)
    // ============================================================
    var autoCommentProgress = null;

    function createProgressPanel() {
        if (autoCommentProgress) return autoCommentProgress;
        var panel = document.createElement('div');
        panel.id = 'autoCommentProgress';
        panel.className = 'cp-auto-progress';
        panel.style.cssText = 'display:none;position:fixed;top:20px;right:20px;z-index:10000;width:380px;background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.2);overflow:hidden;animation:slideIn 0.3s ease;';
        panel.innerHTML = '' +
            '<div style="background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:white;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<i class="fa-solid fa-forward-fast" style="font-size:1.2rem;"></i>' +
                    '<div>' +
                        '<div style="font-weight:700;font-size:0.95rem;">Đang tự động comment...</div>' +
                        '<div id="autoCommentStatus" style="font-size:0.8rem;opacity:0.9;margin-top:2px;">Đang khởi động...</div>' +
                    '</div>' +
                '</div>' +
                '<button id="btnStopAutoComment" title="Dừng" style="background:rgba(255,255,255,0.2);border:none;color:white;width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:1rem;">' +
                    '<i class="fa-solid fa-stop"></i>' +
                '</button>' +
            '</div>' +
            '<div style="padding:16px 20px;">' +
                '<div style="display:flex;gap:16px;margin-bottom:12px;">' +
                    '<div style="flex:1;text-align:center;padding:10px;background:#f0fdf4;border-radius:10px;">' +
                        '<div id="autoCommentPosted" style="font-size:1.5rem;font-weight:800;color:#10b981;">0</div>' +
                        '<div style="font-size:0.75rem;color:#6b7280;">Đã comment</div>' +
                    '</div>' +
                    '<div style="flex:1;text-align:center;padding:10px;background:#fef2f2;border-radius:10px;">' +
                        '<div id="autoCommentErrors" style="font-size:1.5rem;font-weight:800;color:#ef4444;">0</div>' +
                        '<div style="font-size:0.75rem;color:#6b7280;">Lỗi</div>' +
                    '</div>' +
                    '<div style="flex:1;text-align:center;padding:10px;background:#eff6ff;border-radius:10px;">' +
                        '<div id="autoCommentIteration" style="font-size:1.5rem;font-weight:800;color:#2563eb;">0</div>' +
                        '<div style="font-size:0.75rem;color:#6b7280;">Lượt</div>' +
                    '</div>' +
                '</div>' +
                '<div style="margin-bottom:8px;">' +
                    '<div style="height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;">' +
                        '<div id="autoCommentBar" style="height:100%;background:linear-gradient(90deg,#8b5cf6,#6d28d9);width:0%;transition:width 0.3s ease;border-radius:3px;"></div>' +
                    '</div>' +
                '</div>' +
                '<div id="autoCommentLog" style="max-height:150px;overflow-y:auto;font-size:0.8rem;color:#6b7280;"></div>' +
            '</div>';
        document.body.appendChild(panel);
        autoCommentProgress = panel;

        // Stop button
        document.getElementById('btnStopAutoComment').addEventListener('click', function () {
            if (window.__autoCommentActive) {
                window.__autoCommentActive = false;
                showToast('Đã dừng tự động comment', 'warning');
                hideProgressPanel();
            }
        });

        return panel;
    }

    function showProgressPanel() {
        var panel = createProgressPanel();
        panel.style.display = 'block';
    }

    function hideProgressPanel() {
        if (autoCommentProgress) {
            autoCommentProgress.style.display = 'none';
        }
    }

    function updateProgress(data) {
        var posted = document.getElementById('autoCommentPosted');
        var errors = document.getElementById('autoCommentErrors');
        var iteration = document.getElementById('autoCommentIteration');
        var status = document.getElementById('autoCommentStatus');
        var bar = document.getElementById('autoCommentBar');
        var log = document.getElementById('autoCommentLog');

        if (posted) posted.textContent = data.totalPosted || 0;
        if (errors) errors.textContent = data.totalErrors || 0;
        if (iteration) iteration.textContent = data.iteration || 0;

        if (data.type === 'progress' && status) {
            var shortUrl = data.targetUrl || '';
            if (shortUrl.length > 50) shortUrl = shortUrl.substring(0, 50) + '...';
            status.textContent = 'Lượt ' + data.iteration + ': ' + (data.posted > 0 ? '✓' : '✕');
            if (bar) {
                var pct = Math.min(100, (data.totalPosted / Math.max(1, data.totalPosted + data.totalErrors)) * 100);
                bar.style.width = pct + '%';
            }
            if (log) {
                var logLine = document.createElement('div');
                logLine.style.cssText = 'padding:4px 0;border-bottom:1px solid #f3f4f6;display:flex;align-items:center;gap:6px;';
                logLine.innerHTML = '<span style="color:' + (data.posted > 0 ? '#10b981' : '#ef4444') + ';">' + (data.posted > 0 ? '✓' : '✕') + '</span>' +
                    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (data.targetUrl || '') + '">' + escapeHtml(shortUrl) + '</span>';
                log.appendChild(logLine);
                log.scrollTop = log.scrollHeight;
            }
        } else if (data.type === 'complete' && status) {
            status.textContent = 'Hoàn tất! Đã comment ' + (data.totalPosted || 0) + ' bài viết';
            if (bar) bar.style.width = '100%';
        }
    }

    // Play button = Auto Comment All (gộp thành 1 nút)
    document.querySelectorAll('.cp-btn-run').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var id = this.dataset.playId;
            var origHTML = this.innerHTML;
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            this.disabled = true;

            try {
                var res = await fetch('/schedule/ai-comment/play/api/' + id + '/auto-comment-all', { method: 'POST' });
                var json = await res.json();
                if (json.success) {
                    window.__autoCommentActive = true;
                    showProgressPanel();
                    showToast('Đã bắt đầu tự động comment tất cả bài viết!', 'success');

                    // Listen for socket progress
                    if (typeof io !== 'undefined') {
                        var socket = io();
                        socket.on('auto-comment-progress', function (data) {
                            if (data.playId === id) updateProgress(data);
                        });
                        socket.on('auto-comment-complete', function (data) {
                            if (data.playId === id) {
                                updateProgress({ type: 'complete', totalPosted: data.totalPosted, totalErrors: data.totalErrors });
                                window.__autoCommentActive = false;
                                showToast('Hoàn tất! Đã comment ' + data.totalPosted + ' bài viết, ' + data.totalErrors + ' lỗi', 'success');
                                setTimeout(function () { location.reload(); }, 2000);
                            }
                        });
                    }
                } else {
                    showToast(json.message || 'Lỗi chạy', 'error');
                }
            } catch (err) {
                showToast('Lỗi: ' + err.message, 'error');
            } finally {
                this.innerHTML = origHTML;
                this.disabled = false;
            }
        });
    });

    // Delete
    document.querySelectorAll('.cp-btn-delete').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var id = this.dataset.playId;
            if (!confirm('Xóa kịch bản này?')) return;
            try {
                var res = await fetch('/schedule/ai-comment/play/api/' + id, { method: 'DELETE' });
                var json = await res.json();
                if (json.success) {
                    showToast('Đã xóa kịch bản', 'success');
                    setTimeout(function () { location.reload(); }, 300);
                } else {
                    showToast(json.message || 'Lỗi xóa', 'error');
                }
            } catch (err) {
                showToast('Lỗi: ' + err.message, 'error');
            }
        });
    });

    // Logs
    document.querySelectorAll('.cp-btn-logs').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var id = this.dataset.playId;
            loadLogs(id);
        });
    });

    // ============================================================
    // HELPERS
    // ============================================================
    function escapeHtml(str) {
        if (!str) return '';
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

    console.log('[CommentPlay] Initialized. Plays:', data.plays?.length || 0);
})();
