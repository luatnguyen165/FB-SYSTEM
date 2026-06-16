/* ===================================
   REELS VIDEO - Video preview, upload, mini library, shopee links
   =================================== */

let currentSelectedReelsVideo = {
    id: '',
    url: '',
    poster: '',
    title: '',
    size: ''
};
let currentReelsVideoUploadPromise = null;
let isReelsVideoUploading = false;
let selectedVideoUrl = '';
let reelsMiniLibraryCache = [];
let reelsMiniLibrarySearch = '';
let reelsShopeeLinksCache = [];

function setReelsVideoPreview({ id = '', url = '', poster = '', title = '', size = '' } = {}) {
    currentSelectedReelsVideo = { id, url, poster, title, size };

    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const posterEl = document.getElementById('phoneMockupPosterTag');
    const badge = document.getElementById('filePickedBadge');
    const nameEl = document.getElementById('filePickedName');
    const sizeEl = document.getElementById('filePickedSize');
    const titleEl = document.getElementById('phoneVideoTitle');

    if (badge) badge.style.display = url ? 'flex' : 'none';
    if (nameEl) nameEl.textContent = title || 'Đã chọn video';
    if (sizeEl) sizeEl.textContent = size || '';
    if (titleEl) titleEl.textContent = title || 'Video Preview';

    if (posterEl) {
        if (poster) {
            posterEl.src = poster;
            posterEl.classList.add('active');
        } else {
            posterEl.removeAttribute('src');
            posterEl.classList.remove('active');
        }
    }

    if (!videoPlayer) return;

    if (poster) videoPlayer.poster = poster;
    else videoPlayer.removeAttribute('poster');

    if (url) {
        videoPlayer.src = url;
        videoPlayer.load();
        videoPlayer.pause();
        videoPlayer.classList.add('active');
        showVideoControls(false);
        updatePlayPauseIcon(false);
    } else {
        videoPlayer.removeAttribute('src');
        videoPlayer.removeAttribute('poster');
        videoPlayer.load();
        videoPlayer.classList.remove('active');
        showVideoControls(false);
        updatePlayPauseIcon(false);
    }
}

function stopReelsPlayback() {
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const posterEl = document.getElementById('phoneMockupPosterTag');
    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (!videoPlayer) return;

    videoPlayer.pause();
    videoPlayer.currentTime = 0;
    videoPlayer.removeAttribute('src');
    videoPlayer.removeAttribute('poster');
    videoPlayer.load();
    videoPlayer.classList.remove('playing');
    if (posterEl) {
        posterEl.removeAttribute('src');
        posterEl.classList.remove('active');
    }
    playIcon?.classList.remove('hidden-status');
    showVideoControls(false);
    updatePlayPauseIcon(false);
}

function updatePlayPauseIcon(isPlaying) {
    const playPauseBtn = document.getElementById('phonePlayPauseBtn');
    if (!playPauseBtn) return;

    const icon = playPauseBtn.querySelector('i');
    if (!icon) return;

    if (isPlaying) {
        icon.classList.remove('fa-play');
        icon.classList.add('fa-pause');
    } else {
        icon.classList.remove('fa-pause');
        icon.classList.add('fa-play');
    }
}

function showVideoControls(show) {
    const controls = document.getElementById('phoneVideoControls');
    if (!controls) return;

    if (show) {
        controls.classList.add('visible');
    } else {
        controls.classList.remove('visible');
    }
}

function updateVideoDuration() {
    const durationEl = document.getElementById('phoneVideoDuration');
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    if (!durationEl || !videoPlayer) return;

    const duration = videoPlayer.duration;
    if (!duration || Number.isNaN(duration)) return;

    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    durationEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function updateLiveMobilePreview() {
    const text = document.getElementById('modalCaptionInput')?.value;
    const preview = document.getElementById('livePreviewCaption');
    if (preview) preview.textContent = text?.trim() || 'Nội dung Reels sẽ hiển thị tại đây.';
}

function syncSelectedPlatformPreview() {
    const selected = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const preview = document.getElementById('phonePreviewPlatformName');
    if (!preview) return;

    const labelMap = {
        FR: 'Facebook Reels',
        TT: 'TikTok Video',
        IG: 'Instagram',
        YS: 'YouTube Short'
    };
    preview.textContent = selected.length ? selected.map(v => labelMap[v] || v).join(' • ') : 'Xem trước Reels';
}

async function uploadReelsVideoToServer(file) {
    if (!file) throw new Error('Thiếu file video');

    logReelsUiStep('upload-video-start', `${file.name} (${file.size} bytes)`);

    const formData = new FormData();
    formData.append('video', file);

    console.log('[Reels] Uploading selected local video to /schedule/api/upload-local-reels-video ...');
    const res = await fetch('/schedule/api/upload-local-reels-video', { method: 'POST', body: formData });
    const data = await res.json();

    if (!data.success || !data.video) {
        throw new Error(data.message || 'Không upload được video local cho Reels');
    }

    logReelsUiStep('upload-video-done', `path=${data.video.filePath || ''}`);

    return data.video;
}

async function handleVideoSelected(file) {
    logReelsUiStep('handle-video-selected-start', file.name);
    const badge = document.getElementById('filePickedBadge');
    const nameEl = document.getElementById('filePickedName');
    const sizeEl = document.getElementById('filePickedSize');

    if (badge) badge.style.display = 'flex';
    if (nameEl) nameEl.textContent = file.name;
    if (sizeEl) sizeEl.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';

    if (selectedVideoUrl && String(selectedVideoUrl).startsWith('blob:')) {
        try { URL.revokeObjectURL(selectedVideoUrl); } catch (e) {}
    }

    selectedVideoUrl = URL.createObjectURL(file);
    setReelsVideoPreview({
        id: '',
        url: selectedVideoUrl,
        poster: '',
        title: file.name,
        size: (file.size / (1024 * 1024)).toFixed(1) + ' MB'
    });

    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    if (videoPlayer) {
        videoPlayer.src = selectedVideoUrl;
        videoPlayer.classList.add('active');
        videoPlayer.play().catch(() => {});
    }

    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (playIcon) playIcon.classList.add('hidden-status');

    isReelsVideoUploading = true;
    const uploadPromise = uploadReelsVideoToServer(file);
    currentReelsVideoUploadPromise = uploadPromise;

    try {
        const uploadedVideo = await uploadPromise;

        currentSelectedReelsVideo = {
            id: uploadedVideo._id || '',
            url: uploadedVideo.filePath || '',
            poster: uploadedVideo.thumbnailUrl || '',
            title: uploadedVideo.title || file.name,
            size: formatFileSize(uploadedVideo.fileSize || file.size)
        };

        selectedVideoUrl = uploadedVideo.filePath || selectedVideoUrl;
        setReelsVideoPreview({
            id: currentSelectedReelsVideo.id,
            url: currentSelectedReelsVideo.url,
            poster: currentSelectedReelsVideo.poster,
            title: currentSelectedReelsVideo.title,
            size: currentSelectedReelsVideo.size
        });

        if (videoPlayer && currentSelectedReelsVideo.url) {
            videoPlayer.src = currentSelectedReelsVideo.url;
            if (currentSelectedReelsVideo.poster) videoPlayer.poster = currentSelectedReelsVideo.poster;
            videoPlayer.classList.add('active');
        }

        showToast?.('Đã upload video local cho Reels, sẵn sàng lên lịch', 'success');
        logReelsUiStep('handle-video-selected-done', `resolvedVideoId=${currentSelectedReelsVideo.id || 'local-only'}`);
        console.log('[Reels] Selected video uploaded and bound to currentSelectedReelsVideo:', currentSelectedReelsVideo);
    } finally {
        isReelsVideoUploading = false;
        currentReelsVideoUploadPromise = null;
    }
}

// Mini Library
function openMiniLibrary() {
    loadAvailableVideosForReels();
    document.getElementById('miniLibraryModal')?.classList.add('open');
}

function closeMiniLibrary() {
    document.getElementById('miniLibraryModal')?.classList.remove('open');
}

async function loadAvailableVideosForReels() {
    const grid = document.getElementById('miniLibGridContainer');
    if (!grid) return;

    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Đang tải video từ kho...</div>';

    try {
        const [videoRes, scheduleRes] = await Promise.all([
            fetch('/videos/api/list?status=all'),
            fetch('/schedule/api/list?type=reels&month=' + (reelsCalendarState.month) + '&year=' + (reelsCalendarState.year))
        ]);

        const videoData = await videoRes.json();
        const scheduleData = await scheduleRes.json();

        if (!videoData.success) throw new Error('Không tải được video');

        const scheduledVideoIds = new Set(
            (scheduleData.success ? scheduleData.schedules || [] : [])
                .map(item => item.videoId && typeof item.videoId === 'object' ? item.videoId._id : item.videoId)
                .filter(Boolean)
                .map(String)
        );

        const availableVideos = (videoData.videos || []).filter(v => !scheduledVideoIds.has(String(v._id)));
        reelsMiniLibraryCache = availableVideos;

        renderAvailableVideosForReels();
    } catch (err) {
        console.error('Load available reels videos failed:', err);
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Không tải được video từ kho</div>';
    }
}

function renderAvailableVideosForReels() {
    const grid = document.getElementById('miniLibGridContainer');
    if (!grid) return;

    const keyword = reelsMiniLibrarySearch.trim().toLowerCase();
    const filteredVideos = reelsMiniLibraryCache.filter(v => {
        const title = (v.title || '').toLowerCase();
        return !keyword || title.includes(keyword);
    });

    if (!filteredVideos.length) {
        grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px; color:var(--text-muted);">Không tìm thấy video phù hợp</div>';
        return;
    }

    grid.innerHTML = filteredVideos.map(v => `
        <div class="mini-lib-item" data-video-id="${v._id}" data-filename="${v.title}" data-video-title="${v.title}" data-video-size="${formatFileSize(v.fileSize)}" data-video-url="${v.filePath}" data-video-thumb="${v.thumbnailUrl || v.thumbnailPath || ''}">
            <div style="width:100%; height:100px; background:#e2e8f0; display:flex; align-items:center; justify-content:center; color:var(--text-muted); overflow:hidden;">
                ${v.thumbnailUrl || v.thumbnailPath
                    ? `<img src="${v.thumbnailUrl || v.thumbnailPath}" alt="${v.title}" style="width:100%; height:100%; object-fit:cover; display:block;">`
                    : '<i class="fa-solid fa-clapperboard" style="font-size:1.5rem;"></i>'}
            </div>
            <div style="padding:8px; font-size:0.775rem; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" class="lib-file-title">${v.title}</div>
        </div>
    `).join('');
}

function selectVideoFromMiniLib(filename, size, videoUrl) {
    const videoPlayer = document.getElementById('phoneMockupVideoTag');
    const gridItem = document.querySelector(`.mini-lib-item[data-video-url="${CSS.escape(videoUrl)}"]`);
    const videoId = gridItem?.dataset?.videoId || '';
    const poster = gridItem?.dataset?.videoThumb || '';

    selectedVideoUrl = videoUrl;
    setReelsVideoPreview({
      id: videoId,
      url: videoUrl,
      poster,
      title: filename,
      size
    });
    if (videoPlayer) {
      videoPlayer.classList.add('active');
      videoPlayer.play().catch(() => {
        console.log('Autoplay blocked, waiting for user interaction');
      });
    }
    const playIcon = document.getElementById('phoneCenterPlayIcon');
    if (playIcon) playIcon.classList.add('hidden-status');
    closeMiniLibrary();
}

function searchVideoInMiniLibrary() {
    reelsMiniLibrarySearch = document.getElementById('miniLibSearchInput')?.value || '';
    renderAvailableVideosForReels();
    renderShopeeLinkList();
}

// Shopee Links
async function loadShopeeLinksForReels() {
    const box = document.getElementById('dynamicShopeeLinkBox');
    if (!box) return;

    box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Đang tải link affiliate...</div>';

    try {
        const res = await fetch('/shopee/api/list?status=ALL');
        const data = await res.json();

        if (!data.success) throw new Error('Không tải được link Shopee');

        reelsShopeeLinksCache = data.links || [];
        renderShopeeLinkList();
    } catch (err) {
        console.error('Load Shopee links failed:', err);
        box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Không tải được link affiliate</div>';
    }
}

function renderShopeeLinkList() {
    const box = document.getElementById('dynamicShopeeLinkBox');
    if (!box) return;

    const selectedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const hasNonTTPlatform = selectedPlatforms.some(p => p !== 'TT');

    if (!hasNonTTPlatform) {
        box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">TikTok Video không có link affiliate</div>';
        return;
    }

    const keyword = (document.getElementById('miniLibSearchInput')?.value || '').toLowerCase();
    const list = reelsShopeeLinksCache.filter(link => !keyword || (link.title || '').toLowerCase().includes(keyword));

    if (!list.length) {
        box.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Không có link phù hợp</div>';
        return;
    }

    box.innerHTML = list.map(link => `
        <label class="acc-pick-item" style="align-items:flex-start;">
            <input type="checkbox" name="modalShopeeLinkSelect" value="${link._id}">
            <img src="${link.imageUrl || getCspSafePlaceholderImage(link.title)}" alt="${link.title}" style="width:44px; height:44px; object-fit:cover; border-radius:8px; border:1px solid var(--border); flex-shrink:0;">
            <span style="display:flex; flex-direction:column; gap:2px;">
                <strong style="font-size:0.85rem; color:var(--text-main);">${link.title}</strong>
                <small style="font-size:0.72rem; color:var(--text-muted); word-break:break-all;">${link.shopeeUrl}</small>
            </span>
        </label>
    `).join('');
}

function syncSelectedShopeeLinksPreview() {
    // Placeholder for future preview count/summary if needed.
}

function toggleShopeeLinkSectionForReels() {
    const section = document.getElementById('dynamicShopeeLinkBox')?.closest('.form-section');
    if (!section) return;
    const selectedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const showSection = selectedPlatforms.length === 0 || selectedPlatforms.some(p => p !== 'TT');
    section.style.display = showSection ? '' : 'none';
    if (showSection) {
        renderShopeeLinkList();
    }
}
