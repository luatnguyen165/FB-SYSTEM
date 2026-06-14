/* ===================================
   SCHEDULE MANAGER EDIT VIDEO - Video preview, library, local upload
   =================================== */

function loadVideoForPhonePreview(videoId) {
    const videos = Array.isArray(managerData.videos) ? managerData.videos : [];
    const cached = videos.find(v => String(v._id) === String(videoId));
    if (cached && (cached.fileUrl || cached.filePath || cached.url)) {
        const url = cached.fileUrl || cached.filePath || cached.url;
        showEditVideoPreview(url, cached.title || videoId);
        return;
    }
    fetch('/videos/api/list')
        .then(res => { if (!res.ok) throw new Error('videos api failed ' + res.status); return res.json(); })
        .then(data => {
            if (data.success && Array.isArray(data.videos)) {
                const found = data.videos.find(v => String(v._id) === String(videoId));
                if (found) showEditVideoPreview(found.filePath || found.url || '', found.title || videoId);
            }
        })
        .catch(() => {});
}

function showEditVideoPreview(url, title) {
    const player = document.getElementById('editPhoneVideoTag');
    const poster = document.getElementById('editPhonePosterTag');
    const titleEl = document.getElementById('editPhoneVideoTitle');
    const playIcon = document.getElementById('editPhoneCenterPlayIcon');
    const controls = document.getElementById('editPhoneVideoControls');
    if (!player) return;

    if (!url) {
        player.removeAttribute('src');
        player.removeAttribute('poster');
        player.load();
        player.classList.remove('active', 'playing');
        if (poster) { poster.removeAttribute('src'); poster.classList.remove('active'); }
    } else {
        player.src = url;
        player.load();
        player.pause();
        player.classList.add('active');
        player.classList.remove('playing');
    }
    if (titleEl) titleEl.textContent = title || 'Video đã chọn';
    if (playIcon) playIcon.classList.remove('hidden-status');
    if (controls) controls.classList.remove('visible');
    updateEditPhonePlayPauseIcon(false);
}

function hideEditVideoPreview() {
    const player = document.getElementById('editPhoneVideoTag');
    const playIcon = document.getElementById('editPhoneCenterPlayIcon');
    const controls = document.getElementById('editPhoneVideoControls');
    if (player) { player.removeAttribute('src'); player.load(); player.classList.remove('active', 'playing'); }
    if (playIcon) playIcon.classList.remove('hidden-status');
    if (controls) controls.classList.remove('visible');
    updateEditPhonePlayPauseIcon(false);
}

function updateEditPhonePlayPauseIcon(isPlaying) {
    const btn = document.getElementById('editPhonePlayPauseBtn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (!icon) return;
    if (isPlaying) { icon.classList.remove('fa-play'); icon.classList.add('fa-pause'); }
    else { icon.classList.remove('fa-pause'); icon.classList.add('fa-play'); }
}

function showEditPhoneControls(show) {
    const controls = document.getElementById('editPhoneVideoControls');
    if (controls) controls.classList.toggle('visible', show);
}

function updateEditPhoneDuration() {
    const player = document.getElementById('editPhoneVideoTag');
    const durationEl = document.getElementById('editPhoneVideoDuration');
    if (!player || !durationEl) return;
    const d = player.duration;
    if (!d || Number.isNaN(d)) return;
    durationEl.textContent = `${Math.floor(d / 60)}:${Math.floor(d % 60).toString().padStart(2, '0')}`;
}

function initEditPhonePreview() {
    const container = document.getElementById('editPhoneMockupContainer');
    const video = document.getElementById('editPhoneVideoTag');
    const playIcon = document.getElementById('editPhoneCenterPlayIcon');
    const playPauseBtn = document.getElementById('editPhonePlayPauseBtn');
    if (!container || !video) return;

    function togglePlay() {
        if (!video.src || video.src === '' || video.readyState === 0) return;
        if (video.paused) {
            video.play().catch(() => {});
            video.classList.add('playing');
            playIcon?.classList.add('hidden-status');
            updateEditPhonePlayPauseIcon(true);
            showEditPhoneControls(true);
        } else {
            video.pause();
            video.classList.remove('playing');
            playIcon?.classList.remove('hidden-status');
            updateEditPhonePlayPauseIcon(false);
            showEditPhoneControls(false);
        }
    }

    container.addEventListener('click', (e) => {
        if (e.target.closest('.phone-video-controls') || e.target.closest('#editPhonePlayPauseBtn')) return;
        togglePlay();
    });

    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
    }

    video.addEventListener('ended', () => {
        video.classList.remove('playing');
        playIcon?.classList.remove('hidden-status');
        updateEditPhonePlayPauseIcon(false);
        showEditPhoneControls(false);
    });

    video.addEventListener('timeupdate', updateEditPhoneDuration);
    video.addEventListener('loadedmetadata', updateEditPhoneDuration);
}

function switchEditVideoTab(source, videoIdToSelect = '') {
    document.querySelectorAll('#editVideoSourceTabs .video-source-tab').forEach(t => t.classList.toggle('active', t.dataset.source === source));
    document.getElementById('editVideoLibrarySection').style.display = source === 'library' ? '' : 'none';
    document.getElementById('editVideoLocalSection').style.display = source === 'local' ? '' : 'none';
    if (source === 'library') {
        renderEditVideoOptions(videoIdToSelect || editFields.videoId?.value || currentEditPayload?.videoId || '');
    } else {
        hideEditVideoPreview();
    }
}

function renderEditVideoOptions(selectedVideoId = '') {
    if (!editFields.videoId) return;
    const videos = Array.isArray(managerData.videos) ? managerData.videos : [];
    const opts = videos.map(v => {
        const sel = String(v._id) === String(selectedVideoId) ? 'selected' : '';
        const title = v.title || v.fileName || v._id;
        const created = v.createdAt ? new Date(v.createdAt).toLocaleDateString('vi-VN') : '';
        const url = v.fileUrl || v.filePath || v.url || '';
        return `<option value="${v._id}" data-url="${url}" ${sel}>${title} ${created ? '(' + created + ')' : ''}</option>`;
    });
    editFields.videoId.innerHTML = ['<option value="">-- Chọn video từ kho AI --</option>'].concat(opts).join('');
}