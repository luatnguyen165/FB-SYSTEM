/* ===================================
   SCHEDULE POST IMAGE - Image preview, upload, swiper
   =================================== */

let uploadedImagesBlobUrls = [];
let selectedSchedulePostImages = [];
let selectedSchedulePostPreviewUrls = [];
let swiperInstance = null;

function clearSchedulePostImagePreview() {
    const thumbContainer = document.getElementById('miniThumbGridContainer');
    const wrapper = document.getElementById('swiperWrapperTarget');
    const placeholder = document.getElementById('feedImagePlaceholder');
    const counter = document.getElementById('phoneCarouselCounterBadge');

    if (thumbContainer) { thumbContainer.innerHTML = ''; thumbContainer.classList.remove('active'); }
    if (wrapper) wrapper.innerHTML = '';
    if (placeholder) placeholder.style.display = 'flex';
    if (counter) counter.innerText = '1/1';
    if (swiperInstance) { swiperInstance.destroy(true, true); swiperInstance = null; }
}

function revokeSchedulePostPreviewUrls() {
    selectedSchedulePostPreviewUrls.forEach(url => {
        if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    });
    selectedSchedulePostPreviewUrls = [];
}

function renderSchedulePostImagePreview(imageUrls = []) {
    const thumbContainer = document.getElementById('miniThumbGridContainer');
    const wrapper = document.getElementById('swiperWrapperTarget');
    const placeholder = document.getElementById('feedImagePlaceholder');
    const counter = document.getElementById('phoneCarouselCounterBadge');
    if (!thumbContainer || !wrapper) return;

    thumbContainer.innerHTML = '';
    wrapper.innerHTML = '';

    const urls = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
    if (!urls.length) {
        if (thumbContainer) thumbContainer.classList.remove('active');
        if (placeholder) placeholder.style.display = 'flex';
        if (counter) counter.innerText = '1/1';
        if (swiperInstance) { swiperInstance.destroy(true, true); swiperInstance = null; }
        return;
    }

    if (placeholder) placeholder.style.display = 'none';
    if (thumbContainer) thumbContainer.classList.add('active');

    urls.forEach((url, index) => {
        const thumbItem = document.createElement('div');
        thumbItem.className = 'thumb-preview-item';
        thumbItem.innerHTML = `<img src="${url}" alt="Preview ${index + 1}"><button class="thumb-preview-remove-btn" type="button">&times;</button>`;
        thumbItem.querySelector('button')?.addEventListener('click', () => {
            const nextUrls = urls.filter((_, i) => i !== index);
            revokeSchedulePostPreviewUrls();
            selectedSchedulePostPreviewUrls = nextUrls.filter(Boolean);
            uploadedImagesBlobUrls = nextUrls.filter(u => typeof u === 'string' && u.startsWith('blob:'));
            renderSchedulePostImagePreview(nextUrls);
        });
        thumbContainer.appendChild(thumbItem);

        const slide = document.createElement('div');
        slide.className = 'swiper-slide';
        slide.innerHTML = `<img src="${url}" alt="Preview ${index + 1}">`;
        wrapper.appendChild(slide);
    });

    if (swiperInstance) swiperInstance.destroy(true, true);
    swiperInstance = new Swiper('.mySwiper', {
        pagination: { el: '.swiper-pagination', clickable: true },
        on: { slideChange: () => { if (counter) counter.innerText = `${swiperInstance.activeIndex + 1}/${urls.length}`; } }
    });

    if (counter) {
        counter.innerText = `1/${urls.length}`;
        counter.classList.toggle('active', urls.length > 1);
    }
}

function updateLiveFeedPreview() {
    const inputText = document.getElementById('modalCaptionInput')?.value;
    const previewDisplay = document.getElementById('liveFeedTextPreview');
    if (previewDisplay) previewDisplay.innerText = inputText?.trim() !== "" ? inputText : "Nội dung bài viết sẽ hiển thị tại đây.";
}

function handleMultipleImagesPicked(files) {
    const thumbContainer = document.getElementById('miniThumbGridContainer');
    const wrapper = document.getElementById('swiperWrapperTarget');
    if (!thumbContainer || !wrapper) return;

    thumbContainer.innerHTML = "";
    wrapper.innerHTML = "";
    revokeSchedulePostPreviewUrls();
    uploadedImagesBlobUrls = [];
    selectedSchedulePostImages = Array.from(files || []).filter(Boolean);

    if (!selectedSchedulePostImages.length) { clearSchedulePostImagePreview(); return; }

    selectedSchedulePostPreviewUrls = selectedSchedulePostImages.map(file => URL.createObjectURL(file));

    selectedSchedulePostPreviewUrls.forEach((blobUrl, index) => {
        uploadedImagesBlobUrls.push(blobUrl);
        const thumbItem = document.createElement('div');
        thumbItem.className = "thumb-preview-item";
        thumbItem.innerHTML = `<img src="${blobUrl}"><button class="thumb-preview-remove-btn">&times;</button>`;
        thumbItem.querySelector('button').addEventListener('click', () => {
            selectedSchedulePostImages = selectedSchedulePostImages.filter((_, i) => i !== index);
            revokeSchedulePostPreviewUrls();
            uploadedImagesBlobUrls = [];
            selectedSchedulePostPreviewUrls = selectedSchedulePostImages.map(file => URL.createObjectURL(file));
            renderSchedulePostImagePreview(selectedSchedulePostPreviewUrls);
        });
        thumbContainer.appendChild(thumbItem);

        const slide = document.createElement('div');
        slide.className = "swiper-slide";
        slide.innerHTML = `<img src="${blobUrl}" alt="Preview">`;
        wrapper.appendChild(slide);
    });

    const placeholder = document.getElementById('feedImagePlaceholder');
    if (placeholder) placeholder.style.display = 'none';
    thumbContainer.classList.add('active');

    if (swiperInstance) swiperInstance.destroy(true, true);
    swiperInstance = new Swiper(".mySwiper", {
        pagination: { el: ".swiper-pagination", clickable: true },
        on: { slideChange: () => {
            const counter = document.getElementById('phoneCarouselCounterBadge');
            if (counter) counter.innerText = `${swiperInstance.activeIndex + 1}/${uploadedImagesBlobUrls.length}`;
        } }
    });

    const counter = document.getElementById('phoneCarouselCounterBadge');
    if (counter) {
        counter.innerText = `1/${uploadedImagesBlobUrls.length}`;
        counter.classList.toggle('active', uploadedImagesBlobUrls.length > 1);
    }
}