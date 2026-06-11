// public/js/ai-scan.js
// AI Scan frontend logic - Puter.js AI + Comment Bank picker

(function () {
    'use strict';

    const data = window.__AI_SCAN_DATA__ || {};
    let editingConfigId = null;
    let recentResults = window.__AI_SCAN_RESULTS__ || [];

    // ============================================================
    // SOCKET.IO + PUTER.JS AI ANALYSIS
    // ============================================================
    let socket = null;

    function initSocketAndPuter() {
        try {
            socket = io({ transports: ['websocket', 'polling'] });

            socket.on('connect', function () {
                console.log('[AI Scan] Socket connected:', socket.id);
                // Join user room for private events
                if (window.__USER_ID__) {
                    socket.emit('join-user', window.__USER_ID__);
                }
            });

            // Listen for AI analysis requests from backend
            socket.on('scan:analyze-post', async function (data) {
                const { requestId, postData, prompt } = data;
                console.log('[AI Scan] Received analysis request:', requestId, 'Post:', postData.postId);

                try {
                    // Show progress
                    showScanProgressMessage('Đang phân tích bài: ' + (postData.postContent || '').substring(0, 60) + '...');

                    // Call Puter.js AI (miễn phí!)
                    const response = await puter.ai.chat(prompt, {
                        model: 'gpt-5.4-nano'
                    });

                    console.log('[AI Scan] Puter.js analysis completed for post:', postData.postId);

                    // Send result back to backend
                    socket.emit('scan:analysis-result', {
                        requestId: requestId,
                        result: typeof response === 'string' ? response : String(response)
                    });

                    showScanProgressMessage('✓ Đã phân tích xong bài: ' + postData.postId);
                } catch (err) {
                    console.error('[AI Scan] Puter.js analysis error:', err);

                    // Send error back to backend
                    socket.emit('scan:analysis-result', {
                        requestId: requestId,
                        error: err.message || 'Puter.js AI analysis failed'
                    });

                    showScanProgressMessage('✕ Lỗi phân tích: ' + err.message);
                }
            });

            // Listen for scan progress updates
            socket.on('scan:progress', function (data) {
                const { configId, status, current, total, message } = data;
                console.log('[AI Scan] Progress:', status, current + '/' + total, message);
                showScanProgressMessage(message || ('Đang quét: ' + current + '/' + total));
                updateScanProgressBar(current, total);
            });

            // Listen for scan completion
            socket.on('scan:complete', function (data) {
                console.log('[AI Scan] Scan completed:', data);
                showScanProgressMessage('✓ Quét hoàn tất! Đang làm mới trang...');
                setTimeout(function () { location.reload(); }, 2000);
            });

            // Listen for new results in real-time
            socket.on('scan:new-results', function (data) {
                const { results } = data;
                console.log('[AI Scan] New results received:', results.length);
                if (results && results.length > 0) {
                    results.forEach(function(result) {
                        prependResultToTable(result);
                    });
                    // Re-init pagination
                    initAiScanPagination();
                }
            });

            // Listen for stats updates
            socket.on('scan:stats-update', function (data) {
                const { stats } = data;
                console.log('[AI Scan] Stats update:', stats);
                if (stats) {
                    updateStats(stats);
                }
            });

            // Listen for individual analysis results
            socket.on('scan:analysis-done', function (data) {
                const { result } = data;
                console.log('[AI Scan] Analysis done for:', result?._id);
                // Update the specific row if it exists
                if (result && result._id) {
                    updateResultRow(result);
                }
            });

            socket.on('disconnect', function () {
                console.log('[AI Scan] Socket disconnected');
            });

        } catch (err) {
            console.error('[AI Scan] Socket init error:', err);
        }
    }

    // Initialize socket connection
    initSocketAndPuter();

    // ============================================================
    // SCAN PROGRESS UI
    // ============================================================
    function showScanProgressMessage(msg) {
        var panel = document.getElementById('scanProgressPanel');
        var info = document.getElementById('scanProgressInfo');
        var log = document.getElementById('scanProgressLog');
        if (panel) panel.style.display = 'block';
        if (info) info.textContent = msg;
        if (log) {
            var line = document.createElement('div');
            line.className = 'scan-log-line';
            line.textContent = '[' + new Date().toLocaleTimeString('vi-VN') + '] ' + msg;
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
        }
    }

    function updateScanProgressBar(current, total) {
        var bar = document.getElementById('scanProgressBar');
        if (bar && total > 0) {
            var pct = Math.round((current / total) * 100);
            bar.style.width = pct + '%';
        }
    }

    // Close scan progress panel
    document.getElementById('btnCloseScanProgress')?.addEventListener('click', function () {
        var panel = document.getElementById('scanProgressPanel');
        if (panel) panel.style.display = 'none';
    });

    // ============================================================
    // DOM ELEMENTS
    // ============================================================
    const $modal = document.getElementById('configModal');
    const $modalTitle = document.getElementById('modalTitle');
    const $configForm = document.getElementById('configForm');
    const $configId = document.getElementById('configId');
    const $configName = document.getElementById('configName');
    const $configChannel = document.getElementById('configChannel');
    const $configMaxPosts = document.getElementById('configMaxPosts');
    const $configOpenaiKey = document.getElementById('configOpenaiKey');
    const $configNiche = document.getElementById('configNiche');
    const $configScanScript = document.getElementById('configScanScript');

    const $groupLoading = document.getElementById('groupLoading');
    const $groupEmpty = document.getElementById('groupEmpty');
    const $groupCheckboxList = document.getElementById('groupCheckboxList');
    const $groupSelectedCount = document.getElementById('groupSelectedCount');
    const $groupCount = document.getElementById('groupCount');

    // Schedule fields
    const $scheduleEnabled = document.getElementById('configScheduleEnabled');
    const $scheduleFields = document.getElementById('scheduleFields');
    const $scanInterval = document.getElementById('configScanInterval');
    const $scheduleMaxPosts = document.getElementById('configScheduleMaxPosts');
    const $scheduleTimeStart = document.getElementById('configScheduleTimeStart');
    const $scheduleTimeEnd = document.getElementById('configScheduleTimeEnd');
    const $maxDaysOld = document.getElementById('configMaxDaysOld');

    // Toggle schedule fields visibility
    if ($scheduleEnabled) {
        $scheduleEnabled.addEventListener('change', function () {
            $scheduleFields.style.display = this.checked ? 'block' : 'none';
        });
    }

    // ============================================================
    // MODAL HELPERS
    // ============================================================
    function openModal() {
        $modal.style.display = 'flex';
        // Trigger reflow so the transition fires
        void $modal.offsetHeight;
        $modal.classList.add('is-visible');
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        $modal.classList.remove('is-visible');
        // Wait for transition to finish before hiding
        setTimeout(function () {
            $modal.style.display = 'none';
            document.body.style.overflow = '';
        }, 300);
        resetForm();
    }

    function resetForm() {
        editingConfigId = null;
        $configForm.reset();
        $configId.value = '';
        $modalTitle.textContent = 'Tạo Cấu Hình Quét AI';
        $configMaxPosts.value = '10';
        resetGroupSelector();
        // Reset comment bank
        var bankList = document.getElementById('commentBankList');
        if (bankList) bankList.innerHTML = '';
    }

    function resetGroupSelector() {
        $groupLoading.style.display = 'none';
        $groupEmpty.style.display = 'block';
        $groupCheckboxList.style.display = 'none';
        $groupSelectedCount.style.display = 'none';
        $groupCheckboxList.innerHTML = '';
        if ($groupSearchBox) { $groupSearchBox.style.display = 'none'; $groupSearchInput.value = ''; }
    }

    // ============================================================
    // GROUP LOADING
    // ============================================================
    async function loadGroups(channelId, selectedKeys) {
        selectedKeys = selectedKeys || [];
        if (!channelId) { resetGroupSelector(); return; }

        $groupLoading.style.display = 'block';
        $groupEmpty.style.display = 'none';
        $groupCheckboxList.style.display = 'none';
        $groupSelectedCount.style.display = 'none';

        try {
            const res = await fetch('/schedule/ai-scan/api/channel-groups?channelId=' + channelId);
            const json = await res.json();
            $groupLoading.style.display = 'none';

            if (!json.success || !json.groups || json.groups.length === 0) {
                $groupEmpty.innerHTML = '<p><i class="fa-solid fa-circle-exclamation"></i> Không tìm thấy group nào. Hãy quét group trước ở trang <a href="/schedule/groups">Quét Group Facebook</a>.</p>';
                $groupEmpty.style.display = 'block';
                return;
            }

            $groupEmpty.style.display = 'none';
            $groupSearchBox.style.display = 'flex';
            $groupSearchInput.value = '';
            $groupCheckboxList.style.display = 'block';
            $groupSelectedCount.style.display = 'block';

            var selectedSet = new Set(selectedKeys.map(String));
            var html = '';
            json.groups.forEach(function (group) {
                var key = group.groupUrl || group.groupId;
                var checked = selectedSet.has(String(key)) ? 'checked' : '';
                html += '<label class="group-checkbox-item"><input type="checkbox" class="group-checkbox" value="' + escapeAttr(key) + '" ' + checked + '><span title="' + escapeAttr(group.groupName || key) + '">' + escapeHtml(group.groupName || 'Unknown Group') + '</span></label>';
            });
            $groupCheckboxList.innerHTML = html;
            updateGroupCount();
            $groupCheckboxList.querySelectorAll('.group-checkbox').forEach(function (cb) {
                cb.addEventListener('change', updateGroupCount);
            });
        } catch (err) {
            $groupLoading.style.display = 'none';
            $groupEmpty.innerHTML = '<p><i class="fa-solid fa-triangle-exclamation"></i> Lỗi tải groups: ' + escapeHtml(err.message) + '</p>';
            $groupEmpty.style.display = 'block';
        }
    }

    function updateGroupCount() {
        var checked = $groupCheckboxList.querySelectorAll('.group-checkbox:checked');
        $groupCount.textContent = checked.length;
    }

    function getSelectedGroupKeys() {
        var checkboxes = $groupCheckboxList.querySelectorAll('.group-checkbox:checked');
        return Array.from(checkboxes).map(function (cb) { return cb.value; });
    }

    $configChannel.addEventListener('change', function () { loadGroups(this.value, []); });

    // ============================================================
    // GROUP SEARCH
    // ============================================================
    var $groupSearchInput = document.getElementById('groupSearchInput');
    var $groupSearchBox = document.getElementById('groupSearchBox');
    var $groupSearchClear = document.getElementById('groupSearchClear');

    if ($groupSearchInput) {
        $groupSearchInput.addEventListener('input', function () {
            var query = this.value.toLowerCase().trim();
            var items = $groupCheckboxList.querySelectorAll('.group-checkbox-item');
            items.forEach(function (item) {
                var name = item.querySelector('span').textContent.toLowerCase();
                item.style.display = (!query || name.indexOf(query) !== -1) ? '' : 'none';
            });
        });
        $groupSearchClear.addEventListener('click', function () {
            $groupSearchInput.value = '';
            $groupSearchInput.dispatchEvent(new Event('input'));
            $groupSearchInput.focus();
        });
    }

    // ============================================================
    // FORM SUBMIT
    // ============================================================
    $configForm.addEventListener('submit', async function (e) {
        e.preventDefault();

        var name = $configName.value.trim();
        var channelId = $configChannel.value;
        var groupKeys = getSelectedGroupKeys();

        if (!name) return showToast('Vui lòng nhập tên cấu hình', 'error');
        if (!channelId) return showToast('Vui lòng chọn tài khoản Facebook', 'error');
        if (groupKeys.length === 0) return showToast('Vui lòng chọn ít nhất 1 group', 'error');

        var payload = {
            name: name,
            channelId: channelId,
            groupKeys: JSON.stringify(groupKeys),
            maxPostsPerScan: parseInt($configMaxPosts.value, 10) || 10,
            openaiApiKey: $configOpenaiKey.value.trim(),
            niche: $configNiche ? $configNiche.value.trim() : '',
            scanScript: $configScanScript ? $configScanScript.value.trim() : '',
            commentItems: JSON.stringify(getCommentBankItems()),
            scheduleEnabled: $scheduleEnabled ? $scheduleEnabled.checked : false,
            scanIntervalMinutes: parseInt($scanInterval.value, 10) || 60,
            maxPostsPerScanSchedule: parseInt($scheduleMaxPosts.value, 10) || 10,
            scheduleTimeStart: $scheduleTimeStart ? $scheduleTimeStart.value : '06:00',
            scheduleTimeEnd: $scheduleTimeEnd ? $scheduleTimeEnd.value : '23:00',
            maxDaysOld: parseInt($maxDaysOld.value, 10) || 1
        };

        var btnText = document.querySelector('#btnSaveConfig');
        var originalHTML = btnText.innerHTML;
        btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
        btnText.disabled = true;

        try {
            var res, json;
            if (editingConfigId) {
                payload.configId = editingConfigId;
                res = await fetch('/schedule/ai-scan/api/config/update', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                json = await res.json();
                if (json.success) {
                    showToast('Đã cập nhật cấu hình!', 'success');
                    closeModal();
                    setTimeout(function () { location.reload(); }, 500);
                } else {
                    showToast(json.message || 'Lỗi cập nhật', 'error');
                }
            } else {
                res = await fetch('/schedule/ai-scan/api/config/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                json = await res.json();
                if (json.success) {
                    showToast('Đã tạo cấu hình quét AI!', 'success');
                    closeModal();
                    setTimeout(function () { location.reload(); }, 500);
                } else {
                    showToast(json.message || 'Lỗi tạo cấu hình', 'error');
                }
            }
        } catch (err) {
            showToast('Lỗi: ' + err.message, 'error');
        } finally {
            btnText.innerHTML = originalHTML;
            btnText.disabled = false;
        }
    });

    // ============================================================
    // CONFIG ACTIONS
    // ============================================================
    document.getElementById('btnNewConfig')?.addEventListener('click', function () { resetForm(); openModal(); });
    document.getElementById('btnNewConfigEmpty')?.addEventListener('click', function () { resetForm(); openModal(); });
    document.getElementById('btnCloseModal')?.addEventListener('click', closeModal);
    document.getElementById('btnCancelConfig')?.addEventListener('click', closeModal);
    $modal?.addEventListener('click', function (e) { if (e.target === $modal) closeModal(); });

    // Edit config
    document.querySelectorAll('.btn-edit-config').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var configId = this.dataset.configId;
            var config = data.configs.find(function (c) { return c._id === configId; });
            if (!config) return showToast('Không tìm thấy cấu hình', 'error');

            editingConfigId = configId;
            $configId.value = config._id;
            $configName.value = config.name || '';
            $configChannel.value = config.channelId || '';
            $configMaxPosts.value = config.maxPostsPerScan || 10;
            $configOpenaiKey.value = config.openaiApiKey || '';
            $modalTitle.textContent = 'Sửa Cấu Hình Quét AI';

            // Load niche & scanScript
            if ($configNiche) $configNiche.value = config.niche || '';
            if ($configScanScript) $configScanScript.value = config.scanScript || '';

            // Load comment bank
            renderCommentBank(config.commentItems || []);

            // Load schedule fields
            if ($scheduleEnabled) {
                $scheduleEnabled.checked = !!config.scheduleEnabled;
                $scheduleFields.style.display = config.scheduleEnabled ? 'block' : 'none';
            }
            if ($scanInterval) $scanInterval.value = config.scanIntervalMinutes || 60;
            if ($scheduleMaxPosts) $scheduleMaxPosts.value = config.maxPostsPerScan || 10;
            if ($scheduleTimeStart) $scheduleTimeStart.value = config.scheduleTimeStart || '06:00';
            if ($scheduleTimeEnd) $scheduleTimeEnd.value = config.scheduleTimeEnd || '23:00';
            if ($maxDaysOld) $maxDaysOld.value = config.maxDaysOld || 1;

            openModal();
            await loadGroups(config.channelId, config.groupKeys || []);
        });
    });

    // Delete config
    document.querySelectorAll('.btn-delete-config').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var configId = this.dataset.configId;
            if (!confirm('Xóa cấu hình này? Tất cả kết quả quét liên quan cũng sẽ bị xóa.')) return;
            try {
                var res = await fetch('/schedule/ai-scan/api/config/' + configId, { method: 'DELETE' });
                var json = await res.json();
                if (json.success) { showToast('Đã xóa cấu hình', 'success'); setTimeout(function () { location.reload(); }, 500); }
                else showToast(json.message || 'Lỗi xóa', 'error');
            } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
        });
    });

    // Toggle config
    document.querySelectorAll('.btn-toggle-config').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var configId = this.dataset.configId;
            try {
                var res = await fetch('/schedule/ai-scan/api/config/' + configId + '/toggle', { method: 'POST' });
                var json = await res.json();
                if (json.success) { showToast(json.message, 'success'); setTimeout(function () { location.reload(); }, 500); }
                else showToast(json.message || 'Lỗi', 'error');
            } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
        });
    });

    // Run scan now
    document.querySelectorAll('.btn-run-now').forEach(function (btn) {
        btn.addEventListener('click', async function () {
            var configId = this.dataset.configId;
            var originalHTML = this.innerHTML;
            this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            this.disabled = true;
            try {
                var res = await fetch('/schedule/ai-scan/api/scan-now', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ configId: configId }) });
                var json = await res.json();
                if (json.success) { showToast('Đã bắt đầu quét!', 'success'); showScanRunningIndicator(); }
                else showToast(json.message || 'Lỗi chạy quét', 'error');
            } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
            finally { this.innerHTML = originalHTML; this.disabled = false; }
        });
    });

    // Clear results
    document.getElementById('btnClearResults')?.addEventListener('click', async function () {
        if (!confirm('Xóa tất cả kết quả quét?')) return;
        try {
            var res = await fetch('/schedule/ai-scan/api/results', { method: 'DELETE' });
            var json = await res.json();
            if (json.success) { showToast(json.message, 'success'); setTimeout(function () { location.reload(); }, 500); }
            else showToast(json.message || 'Lỗi', 'error');
        } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
    });

    // ============================================================
    // EDIT RESULT
    // ============================================================
    const $editResultModal = document.getElementById('editResultModal');
    const $editResultForm = document.getElementById('editResultForm');

    // Delegate click for edit result buttons
    document.addEventListener('click', function (e) {
        const editBtn = e.target.closest('.btn-edit-result');
        if (editBtn) {
            e.preventDefault();
            var resultId = editBtn.dataset.id;
            var row = editBtn.closest('tr');
            var result = recentResults.find(function(r) { return r._id === resultId; });

            // Get data from row (fallback)
            var contentEl = row ? row.querySelector('.result-post .post-link') : null;
            var authorEl = row ? row.querySelector('.result-post .post-author') : null;
            var scoreEl = row ? row.querySelector('.score-text') : null;
            var matchEl = row ? row.querySelector('.match-badge') : null;

            document.getElementById('editResultId').value = resultId;
            if (result) {
                document.getElementById('editResultContent').value = result.postContent || '';
                document.getElementById('editResultUrl').value = result.postUrl || '';
                document.getElementById('editResultAuthor').value = result.postAuthor || '';
                document.getElementById('editResultScore').value = result.aiScore || 0;
                document.getElementById('editResultMatch').value = result.isMatching ? 'true' : 'false';
                document.getElementById('editResultReason').value = result.matchReason || '';
                document.getElementById('editResultAnalysis').value = result.aiAnalysis || '';

                // Render images
                var imagesContainer = document.getElementById('editResultImages');
                imagesContainer.innerHTML = '';
                if (result.postImages && result.postImages.length > 0) {
                    result.postImages.forEach(function(url) {
                        var img = document.createElement('img');
                        img.src = url;
                        img.alt = 'Preview';
                        img.onclick = function() { window.open(url, '_blank'); };
                        imagesContainer.appendChild(img);
                    });
                } else {
                    imagesContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Không có hình ảnh</p>';
                }
            } else {
                document.getElementById('editResultContent').value = contentEl ? contentEl.textContent.trim() : '';
                document.getElementById('editResultUrl').value = contentEl ? (contentEl.href || '') : '';
                document.getElementById('editResultAuthor').value = authorEl ? authorEl.textContent.replace(/^-\s*/, '').trim() : '';
                document.getElementById('editResultScore').value = scoreEl ? parseInt(scoreEl.textContent) || 0 : 0;
                document.getElementById('editResultMatch').value = matchEl && matchEl.classList.contains('match-yes') ? 'true' : 'false';
                document.getElementById('editResultReason').value = '';
                document.getElementById('editResultAnalysis').value = '';
                document.getElementById('editResultImages').innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem;">Không có hình ảnh</p>';
            }

            $editResultModal.style.display = 'flex';
            void $editResultModal.offsetHeight;
            $editResultModal.classList.add('is-visible');
            document.body.style.overflow = 'hidden';
            return;
        }

        // Delete button - xóa từng bài viết
        const deleteBtn = e.target.closest('.btn-delete-result');
        if (deleteBtn) {
            e.preventDefault();
            e.stopPropagation();
            var resultId = deleteBtn.dataset.id;
            if (!resultId) return;
            if (!confirm('Xóa bài viết này khỏi kết quả quét?')) return;

            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

            fetch('/schedule/ai-scan/api/result/delete', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resultId: resultId })
            }).then(function(res) { return res.json(); }).then(function(json) {
                if (json.success) {
                    showToast('Đã xóa bài viết', 'success');
                    var row = deleteBtn.closest('tr');
                    if (row) {
                        row.style.transition = 'opacity 0.3s, transform 0.3s';
                        row.style.opacity = '0';
                        row.style.transform = 'translateX(20px)';
                        setTimeout(function() { location.reload(); }, 400);
                    } else {
                        setTimeout(function() { location.reload(); }, 500);
                    }
                } else {
                    showToast(json.message || 'Lỗi xóa', 'error');
                    deleteBtn.disabled = false;
                    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                }
            }).catch(function(err) {
                showToast('Lỗi: ' + err.message, 'error');
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            });
            return;
        }
    });

    document.getElementById('btnCloseEditResult')?.addEventListener('click', function () {
        $editResultModal.classList.remove('is-visible');
        setTimeout(function () { $editResultModal.style.display = 'none'; document.body.style.overflow = ''; }, 300);
    });
    document.getElementById('btnCancelEditResult')?.addEventListener('click', function () {
        $editResultModal.classList.remove('is-visible');
        setTimeout(function () { $editResultModal.style.display = 'none'; document.body.style.overflow = ''; }, 300);
    });

    $editResultForm?.addEventListener('submit', async function (e) {
        e.preventDefault();
        var resultId = document.getElementById('editResultId').value;
        if (!resultId) return;

        var payload = {
            resultId: resultId,
            postContent: document.getElementById('editResultContent').value,
            postUrl: document.getElementById('editResultUrl').value,
            postAuthor: document.getElementById('editResultAuthor').value,
            aiScore: parseInt(document.getElementById('editResultScore').value, 10) || 0,
            isMatching: document.getElementById('editResultMatch').value,
            matchReason: document.getElementById('editResultReason').value,
            aiAnalysis: document.getElementById('editResultAnalysis').value
        };

        try {
            var res = await fetch('/schedule/ai-scan/api/result/update', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var json = await res.json();
            if (json.success) {
                showToast('Đã cập nhật kết quả!', 'success');
                $editResultModal.classList.remove('is-visible');
                setTimeout(function () { $editResultModal.style.display = 'none'; document.body.style.overflow = ''; }, 300);
                setTimeout(function () { location.reload(); }, 500);
            } else {
                showToast(json.message || 'Lỗi cập nhật', 'error');
            }
        } catch (err) {
            showToast('Lỗi: ' + err.message, 'error');
        }
    });

    // Test OpenAI key
    document.getElementById('btnTestOpenAiKey')?.addEventListener('click', async function () {
        var key = $configOpenaiKey.value.trim() || data.openaiApiKey || '';
        if (!key) return showToast('Vui lòng nhập OpenAI API key', 'error');
        var originalHTML = this.innerHTML;
        this.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        this.disabled = true;
        try {
            var res = await fetch('/schedule/ai-scan/api/settings/test-openai-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openaiApiKey: key }) });
            var json = await res.json();
            if (json.success) showToast('Kết nối OpenAI thành công!', 'success');
            else showToast(json.message || 'Lỗi kết nối', 'error');
        } catch (err) { showToast('Lỗi: ' + err.message, 'error'); }
        finally { this.innerHTML = originalHTML; this.disabled = false; }
    });

    // ============================================================
    // SCAN RUNNING INDICATOR
    // ============================================================
    function showScanRunningIndicator() {
        var existing = document.querySelector('.scan-running-indicator');
        if (existing) existing.remove();
        var indicator = document.createElement('div');
        indicator.className = 'scan-running-indicator';
        indicator.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét bài viết... Vui lòng đợi và refresh trang sau vài phút.';
        var hero = document.querySelector('.ai-scan-hero');
        if (hero) hero.insertAdjacentElement('afterend', indicator);
        setTimeout(function () {
            if (indicator.parentNode) {
                indicator.style.opacity = '0';
                indicator.style.transition = 'opacity 0.5s';
                setTimeout(function () { if (indicator.parentNode) indicator.remove(); }, 500);
            }
        }, 5 * 60 * 1000);
    }

    // ============================================================
    // HELPERS
    // ============================================================
    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }

    function escapeAttr(str) {
        return String(str).replace(/&/g, '&').replace(/"/g, '"').replace(/'/g, '&#39;').replace(/</g, '<').replace(/>/g, '>');
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

    // ============================================================
    // REAL-TIME TABLE UPDATE FUNCTIONS
    // ============================================================

    /**
     * Prepend a new result row to the top of the results table
     */
    function prependResultToTable(result) {
        var tbody = document.querySelector('#resultsTable tbody');
        if (!tbody) return;

        // Check for duplicate by _id
        var existingRow = tbody.querySelector('tr[data-result-id="' + result._id + '"]');
        if (existingRow) return; // Already exists, skip

        // Remove empty state row if present
        var emptyRow = tbody.querySelector('.empty-cell');
        if (emptyRow) {
            var emptyTr = emptyRow.closest('tr');
            if (emptyTr) emptyTr.remove();
        }

        var scoreClass = result.aiScore >= 70 ? 'score-high' : result.aiScore >= 40 ? 'score-mid' : 'score-low';
        var matchClass = result.isMatching ? 'match-yes' : 'match-no';
        var matchText = result.isMatching ? '✓ Match' : '✗ No';

        var hasComments = result.comments && result.comments.length > 0;
        var anySent = hasComments ? result.comments.some(function(c) { return c.sent; }) : result.commentSent;
        var hasError = hasComments ? result.comments.some(function(c) { return c.error; }) : !!result.commentError;

        var commentHtml = '';
        if (anySent) {
            var sentCount = hasComments ? result.comments.filter(function(c) { return c.sent; }).length : 1;
            commentHtml = '<span class="comment-badge sent"><i class="fa-solid fa-check"></i> Đã gửi (' + sentCount + ')</span>';
        } else if (hasError) {
            commentHtml = '<span class="comment-badge error" title="' + escapeAttr(result.commentError || '') + '"><i class="fa-solid fa-triangle-exclamation"></i> Lỗi</span>';
        } else {
            commentHtml = '<span class="comment-badge none">—</span>';
        }

        // Build images HTML
        var imagesHtml = '';
        if (result.postImages && result.postImages.length > 0) {
            imagesHtml = '<div class="result-images">';
            result.postImages.slice(0, 4).forEach(function(img) {
                imagesHtml += '<a href="' + escapeAttr(img) + '" target="_blank"><img src="' + escapeAttr(img) + '" alt="Post image" loading="lazy" onerror="this.style.display=\'none\'"></a>';
            });
            if (result.postImages.length > 4) {
                imagesHtml += '<span class="result-images-more">+' + (result.postImages.length - 4) + '</span>';
            }
            imagesHtml += '</div>';
        }

        var postContent = result.postContent ? result.postContent.substring(0, 80) + (result.postContent.length > 80 ? '...' : '') : '(Không có nội dung)';
        var scannedAt = result.scannedAt ? new Date(result.scannedAt).toLocaleDateString('en-GB') + ' ' + new Date(result.scannedAt).toLocaleTimeString('en-GB') : '—';

        var tr = document.createElement('tr');
        tr.className = 'result-row ' + (result.isMatching ? 'row-match' : 'row-no-match');
        tr.setAttribute('data-result-id', result._id);
        tr.style.opacity = '0';
        tr.style.transition = 'opacity 0.5s ease';

        tr.innerHTML = '' +
            '<td>' +
                '<div class="result-post">' +
                    imagesHtml +
                    '<a href="' + escapeAttr(result.postUrl || '#') + '" target="_blank" class="post-link">' + escapeHtml(postContent) + '</a>' +
                    (result.postAuthor ? '<span class="post-author">- ' + escapeHtml(result.postAuthor) + '</span>' : '') +
                '</div>' +
            '</td>' +
            '<td>' +
                '<a class="group-name-link" href="' + escapeAttr(result.groupUrl || '#') + '" target="_blank" title="' + escapeAttr(result.groupUrl || '') + '">' +
                    '<i class="fa-solid fa-users-group"></i> ' + escapeHtml(result.groupName || 'Unknown Group') +
                '</a>' +
            '</td>' +
            '<td>' +
                '<div class="score-bar">' +
                    '<div class="score-fill ' + scoreClass + '" style="width: ' + result.aiScore + '%"></div>' +
                    '<span class="score-text">' + result.aiScore + '%</span>' +
                '</div>' +
            '</td>' +
            '<td><span class="match-badge ' + matchClass + '">' + matchText + '</span></td>' +
            '<td>' + commentHtml + '</td>' +
            '<td class="time-cell">' +
                '<div>' + scannedAt + '</div>' +
                '<div class="result-actions">' +
                    '<button class="btn-edit-result" data-id="' + result._id + '" title="Sửa kết quả"><i class="fa-solid fa-pen-to-square"></i></button>' +
                    '<button class="btn-delete-result" data-id="' + result._id + '" title="Xóa kết quả"><i class="fa-solid fa-trash-can"></i></button>' +
                '</div>' +
            '</td>';

        // Insert at the top of tbody
        tbody.insertBefore(tr, tbody.firstChild);

        // Fade in
        setTimeout(function() { tr.style.opacity = '1'; }, 50);

        // Add to recentResults array
        recentResults.unshift(result);
    }

    /**
     * Update a specific result row (for AI analysis updates)
     */
    function updateResultRow(result) {
        var tbody = document.querySelector('#resultsTable tbody');
        if (!tbody) return;

        var row = tbody.querySelector('tr[data-result-id="' + result._id + '"]');
        if (!row) return;

        // Update the row classes
        row.className = 'result-row ' + (result.isMatching ? 'row-match' : 'row-no-match');

        // Update score
        var scoreFill = row.querySelector('.score-fill');
        var scoreText = row.querySelector('.score-text');
        if (scoreFill && scoreText) {
            var scoreClass = result.aiScore >= 70 ? 'score-high' : result.aiScore >= 40 ? 'score-mid' : 'score-low';
            scoreFill.className = 'score-fill ' + scoreClass;
            scoreFill.style.width = result.aiScore + '%';
            scoreText.textContent = result.aiScore + '%';
        }

        // Update match badge
        var matchBadge = row.querySelector('.match-badge');
        if (matchBadge) {
            matchBadge.className = 'match-badge ' + (result.isMatching ? 'match-yes' : 'match-no');
            matchBadge.textContent = result.isMatching ? '✓ Match' : '✗ No';
        }

        // Update comment
        var commentTd = row.querySelector('td:nth-child(5)');
        if (commentTd) {
            var hasComments = result.comments && result.comments.length > 0;
            var anySent = hasComments ? result.comments.some(function(c) { return c.sent; }) : result.commentSent;
            var hasError = hasComments ? result.comments.some(function(c) { return c.error; }) : !!result.commentError;

            if (anySent) {
                var sentCount = hasComments ? result.comments.filter(function(c) { return c.sent; }).length : 1;
                commentTd.innerHTML = '<span class="comment-badge sent"><i class="fa-solid fa-check"></i> Đã gửi (' + sentCount + ')</span>';
            } else if (hasError) {
                commentTd.innerHTML = '<span class="comment-badge error" title="' + escapeAttr(result.commentError || '') + '"><i class="fa-solid fa-triangle-exclamation"></i> Lỗi</span>';
            } else {
                commentTd.innerHTML = '<span class="comment-badge none">—</span>';
            }
        }

        // Highlight the row briefly
        row.style.transition = 'background-color 0.5s ease';
        row.style.backgroundColor = 'rgba(16, 185, 129, 0.1)';
        setTimeout(function() {
            row.style.backgroundColor = '';
        }, 2000);
    }

    /**
     * Update the stats overview cards
     */
    function updateStats(stats) {
        if (!stats) return;

        var statCards = document.querySelectorAll('.ai-scan-stat-card .stat-value');
        if (statCards.length >= 4) {
            if (stats.totalScanned !== undefined) statCards[0].textContent = stats.totalScanned;
            if (stats.totalMatched !== undefined) statCards[1].textContent = stats.totalMatched;
            if (stats.totalCommented !== undefined) statCards[2].textContent = stats.totalCommented;
            // statCards[3] is active/scheduled configs - not updated dynamically
        }
    }

    // ============================================================
    // AI SCAN RESULTS PAGINATION
    // ============================================================
    // Pagination state
    var paginationState = {
        pageSize: 10,
        currentPage: 1
    };
    
    function initAiScanPagination() {
        var rows = document.querySelectorAll('#resultsTable .result-row');
        if (rows.length === 0) return;

        function renderPage(page) {
            paginationState.currentPage = Math.max(1, Math.min(page, Math.ceil(rows.length / paginationState.pageSize)));
            var cp = paginationState.currentPage;

            rows.forEach(function(r) { r.style.display = 'none'; });
            Array.from(rows).slice((cp - 1) * paginationState.pageSize, cp * paginationState.pageSize).forEach(function(r) {
                r.style.display = '';
            });

            var infoEl = document.getElementById('aiScanPaginationInfo');
            var controlsEl = document.getElementById('aiScanPaginationControls');
            var totalPages = Math.max(1, Math.ceil(rows.length / paginationState.pageSize));

            if (infoEl) {
                if (rows.length === 0) {
                    infoEl.textContent = 'Không có kết quả';
                } else {
                    var start = (cp - 1) * paginationState.pageSize + 1;
                    var end = Math.min(cp * paginationState.pageSize, rows.length);
                    infoEl.textContent = 'Hiển thị ' + start + '-' + end + ' / ' + rows.length + ' kết quả';
                }
            }

            if (controlsEl) {
                var btns = '<button class="ai-scan-pagination__btn" data-page="prev" ' + (cp === 1 ? 'disabled' : '') + '><i class="fa-solid fa-chevron-left"></i></button>';

                var maxBtns = 5;
                var half = Math.floor(maxBtns / 2);
                var startPage = Math.max(1, cp - half);
                var endPage = Math.min(totalPages, startPage + maxBtns - 1);
                startPage = Math.max(1, endPage - maxBtns + 1);

                for (var p = startPage; p <= endPage; p++) {
                    btns += '<button class="ai-scan-pagination__btn ' + (p === cp ? 'is-active' : '') + '" data-page="' + p + '">' + p + '</button>';
                }

                btns += '<button class="ai-scan-pagination__btn" data-page="next" ' + (cp === totalPages ? 'disabled' : '') + '><i class="fa-solid fa-chevron-right"></i></button>';

                controlsEl.innerHTML = btns;

                controlsEl.querySelectorAll('.ai-scan-pagination__btn').forEach(function(btn) {
                    btn.addEventListener('click', function() {
                        var target = btn.dataset.page;
                        if (target === 'prev') renderPage(parseInt(cp) - 1);
                        else if (target === 'next') renderPage(parseInt(cp) + 1);
                        else renderPage(parseInt(target));
                    });
                });
            }
        }

        renderPage(1);
    }
    
    // Initialize pagination on page load
    initAiScanPagination();

    console.log('[AI Scan] Frontend initialized. Configs:', data.configs?.length || 0);
})();
