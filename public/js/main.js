// 1. BIẾN TOÀN CỤC (Nằm ngoài cùng)
let uploadedImagesBlobUrls = [];
let swiperInstance = null;

// 2. KHỞI TẠO SỰ KIỆN (Khi DOM load xong)
document.addEventListener('DOMContentLoaded', () => {

    // Toggle sidebar for schedule-post page
    const btnToggleSidebarSchedule = document.getElementById('btnToggleSidebarSchedule');
    if(btnToggleSidebarSchedule) {
        btnToggleSidebarSchedule.addEventListener('click', function() {
            const sidebar = document.getElementById('sidebar');
            if(sidebar) {
                sidebar.classList.toggle('active');
            }
        });
    }

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    // 1. Khi click vào vùng upload thì kích hoạt input file
    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => {
            fileInput.click();
        });
    }

    // 2. Lắng nghe thay đổi khi chọn file
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });
    }


    // Nút Hủy
    const btnCancel = document.getElementById('btnCancelProductModal');
    if (btnCancel) {
        btnCancel.addEventListener('click', closeProductModal);
    }


    // Gán sự kiện cho nút Hủy
   
    // Gán sự kiện cho nút Xác nhận
    const btnSubmit = document.getElementById('btnModalSubmit');
    if (btnSubmit) {
        btnSubmit.addEventListener('click', () => {
            handleModalSubmit(); // Gọi hàm của bạn ở đây
        });
    }

    const btnTrigger = document.getElementById('btnTriggerUpload');
    const inputSelector = document.getElementById('modalImageSelector');

    if (btnTrigger && inputSelector) {
        btnTrigger.addEventListener('click', () => {
            inputSelector.click();
        });
    }

    const btnAddProduct = document.getElementById('btnOpenProductModal');
    
    if (btnAddProduct) {
        btnAddProduct.addEventListener('click', () => {
            // Bây giờ hàm openProductModal đã nằm ở phạm vi toàn cục nên gọi được
            openProductModal(false);
        });
    }
    // Gán sự kiện cho nút Thêm sản phẩm
    // Sự kiện lịch
    document.getElementById('calendarGrid')?.addEventListener('click', (e) => {
        const cell = e.target.closest('.day-cell');
        if (cell) openCreatePostModal(cell.getAttribute('data-day'));
    });

    // Sự kiện Modal
    document.getElementById('actualImageInput')?.addEventListener('change', (e) => handleMultipleImagesPicked(e.target.files));
    document.getElementById('btnSelectImages')?.addEventListener('click', () => {
        document.getElementById('actualImageInput')?.click();
    });
    document.getElementById('modalCaptionInput')?.addEventListener('input', updateLiveFeedPreview);
    document.querySelector('.btn-publish-schedule')?.addEventListener('click', submitNewPostToCalendar);
    document.querySelector('.btn-close-modal')?.addEventListener('click', closeCreatePostModal);
    document.querySelector('.btn-today')?.addEventListener('click', () => openCreatePostModal(null));

    // Sự kiện Platform
    document.querySelectorAll('.platform-check').forEach(cb => {
        cb.addEventListener('change', renderAccountList);
    });

    document.getElementById('avatarBtn')?.addEventListener('click', () => {
        document.getElementById('profileDropdown')?.classList.toggle('show');
    });
    document.addEventListener('click', (e) => {
        const avatar = document.getElementById('avatarBtn');
        const dropdown = document.getElementById('profileDropdown');
        if (dropdown && avatar && !avatar.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.remove('show');
        }
    });

});

// 3. CÁC HÀM XỬ LÝ (Nằm ngoài DOMContentLoaded để có thể gọi tự do)

function renderAccountList() {
    const checkedPlatforms = Array.from(document.querySelectorAll('.platform-check:checked')).map(cb => cb.value);
    const boxContainer = document.getElementById('dynamicAccountBox');
    if(!boxContainer) return;

    boxContainer.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Đang tải tài khoản...</div>';

    fetch('/channels/api/list')
        .then(res => res.json())
        .then(data => {
            if (!data.success) throw new Error('Không tải được danh sách tài khoản');

            const filteredAccounts = (data.channels || []).filter(acc => checkedPlatforms.includes(acc.platform));
            if (!filteredAccounts.length) {
                boxContainer.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Chưa có tài khoản phù hợp</div>';
                return;
            }

            boxContainer.innerHTML = '';
            const platformIcons = { FB: 'fa-brands fa-facebook', TT: 'fa-brands fa-tiktok', IG: 'fa-brands fa-instagram', YT: 'fa-brands fa-youtube' };
            const platformColors = { FB: '#1877f2', TT: '#000', IG: '#e1306c', YT: '#ff0000' };

            filteredAccounts.forEach(acc => {
                const label = document.createElement('label');
                label.className = 'acc-pick-item';
                label.innerHTML = `<input type="checkbox" name="modalAccSelect" value="${acc._id}"> <i class="${platformIcons[acc.platform] || 'fa-solid fa-circle-user'}" style="color:${platformColors[acc.platform] || 'var(--text-muted)'}"></i> <span>${acc.accountName}</span>`;
                boxContainer.appendChild(label);
            });
        })
        .catch(() => {
            boxContainer.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">Không tải được tài khoản</div>';
        });
}

function updateLiveFeedPreview() {
    const inputText = document.getElementById('modalCaptionInput')?.value;
    const previewDisplay = document.getElementById('liveFeedTextPreview');
    if(previewDisplay) previewDisplay.innerText = inputText?.trim() !== "" ? inputText : "Nội dung bài viết sẽ hiển thị tại đây.";
}

function handleMultipleImagesPicked(files) {
    const thumbContainer = document.getElementById('miniThumbGridContainer');
    const wrapper = document.getElementById('swiperWrapperTarget');
    // reset previews and slides
    thumbContainer.innerHTML = "";
    wrapper.innerHTML = "";
    uploadedImagesBlobUrls = [];
    // generate thumbnails and slides
    Array.from(files).forEach((file, index) => {
        const blobUrl = URL.createObjectURL(file);
        uploadedImagesBlobUrls.push(blobUrl);
        // thumbnail
        const thumbItem = document.createElement('div');
        thumbItem.className = "thumb-preview-item";
        thumbItem.innerHTML = `<img src="${blobUrl}"><button class="thumb-preview-remove-btn">&times;</button>`;
        thumbItem.querySelector('button').addEventListener('click', () => {
            URL.revokeObjectURL(blobUrl);
            uploadedImagesBlobUrls.splice(index, 1);
            thumbItem.remove();
        });
        thumbContainer.appendChild(thumbItem);

        // slide
        const slide = document.createElement('div');
        slide.className = "swiper-slide";
        slide.innerHTML = `<img src="${blobUrl}" alt="Preview">`;
        wrapper.appendChild(slide);
    });
    // hide placeholder
    const placeholder = document.getElementById('feedImagePlaceholder');
    if(placeholder) placeholder.style.display = 'none';
    // initialize or update swiper
    if(swiperInstance) {
        swiperInstance.destroy(true, true);
    }
    swiperInstance = new Swiper(".mySwiper", {
        pagination: {
            el: ".swiper-pagination",
            clickable: true
        },
        on: {
            slideChange: () => {
                const counter = document.getElementById('phoneCarouselCounterBadge');
                if(counter) counter.innerText = `${swiperInstance.activeIndex + 1}/${uploadedImagesBlobUrls.length}`;
            }
        }
    });
    // set initial counter and show/hide carousel UI
    const counter = document.getElementById('phoneCarouselCounterBadge');
    const dotsContainer = document.getElementById('phoneCarouselDotsContainer');
    if (counter) {
        counter.innerText = `1/${uploadedImagesBlobUrls.length}`;
        if (uploadedImagesBlobUrls.length > 1) counter.classList.add('active');
        else counter.classList.remove('active');
    }
    if (dotsContainer) {
        dotsContainer.style.display = uploadedImagesBlobUrls.length > 1 ? 'flex' : 'none';
    }
}

function removeSingleImageFromAlbum(index, btn) {
    if(uploadedImagesBlobUrls[index]?.startsWith('blob:')) URL.revokeObjectURL(uploadedImagesBlobUrls[index]);
    uploadedImagesBlobUrls.splice(index, 1);
    btn.closest('.thumb-preview-item').remove();
}

function openCreatePostModal(dayNumber) {
    const timeInput = document.getElementById('modalTimeInput');
    if (timeInput) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        timeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    document.getElementById('createPostModal').classList.add('open');
}

function closeCreatePostModal() {
    document.getElementById('createPostModal').classList.remove('open');
}

function submitNewPostToCalendar() {
    // ... code logic xử lý submit ...
    closeCreatePostModal();
}
function openProductModal(isEditMode) {
    console.log("Đang mở modal sản phẩm:", isEditMode);
    const modal = document.getElementById('productModal'); // Thay ID cho khớp với HTML của bạn
    if (modal) {
        modal.classList.add('open');
    }
}


function closeProductModal() {
    const modal = document.getElementById('productModal'); // Thay ID nếu cần
    if (modal) modal.classList.remove('open');
    console.log("Đã đóng modal");
}

function handleModalSubmit() {
    console.log("Đang xử lý submit...");
    // Logic của bạn ở đây...
}

// Menu Toggle - Chỉ hoạt động trên mobile (≤1024px)
document.addEventListener('DOMContentLoaded', function() {
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');
    const sidebarCloseBtn = document.getElementById('sidebarCloseBtn');

    // Hàm kiểm tra xem có phải mobile không
    function isMobileView() {
        return window.innerWidth <= 1024;
    }

    // Ẩn/hiện menu toggle button dựa trên kích thước màn hình
    function updateMenuToggleVisibility() {
        if (menuToggle) {
            if (isMobileView()) {
                menuToggle.style.display = 'block';
            } else {
                menuToggle.style.display = 'none';
                // Đảm bảo sidebar luôn hiển thị trên desktop
                if (sidebar) {
                    sidebar.classList.remove('active');
                }
            }
        }
    }

    // Toggle sidebar khi click vào menu button
    if (menuToggle && sidebar) {
        menuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
        });
    }

    // Đóng sidebar khi click vào nút X
    if (sidebarCloseBtn && sidebar) {
        sidebarCloseBtn.addEventListener('click', () => {
            sidebar.classList.remove('active');
        });
    }

    // Đóng sidebar khi click ra ngoài (chỉ trên mobile)
    document.addEventListener('click', (e) => {
        if (isMobileView() && sidebar && menuToggle) {
            if (!sidebar.contains(e.target) && !menuToggle.contains(e.target) && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
            }
        }
    });

    // Cập nhật visibility khi load trang
    updateMenuToggleVisibility();

    // Cập nhật visibility khi resize window
    window.addEventListener('resize', updateMenuToggleVisibility);
});
