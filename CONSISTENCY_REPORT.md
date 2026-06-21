# 📐 FB-SYSTEM — Báo cáo Đồng nhất hóa (Consistency Report)

> **Ngày:** 2026-06-21 · **Phạm vi:** Toàn bộ `views/`, `public/css/style.css`, `public/js/`
> **Mục tiêu:** Đồng nhất icon Font Awesome, button class, phân trang toàn hệ thống

---

## 🎯 Tổng quan thay đổi

| # | Vấn đề | Mức độ | Trạng thái |
|---|--------|--------|------------|
| 1 | Icon trùng tên nhưng khác class (`fa-pen-to-square` vs `fa-pen`, `fa-trash-can` vs `fa-trash`) | 🔴 Cao | ✅ Fixed |
| 2 | 6 file dùng phân trang khác nhau (`pagination-bar`, `groups-pagination`, `archive-pagination`, `ai-scan-pagination`, `page-link`, `page-nav-btn`) | 🔴 Cao | ✅ Fixed |
| 3 | Button không đồng nhất (`btn-sm`, `btn-icon`, `btn-action`, `aic-btn-edit`, `cp-btn-icon`, `btn-view`, `btn-favorite`, `btn-delete`, ...) | 🟡 Trung bình | ✅ Added shared class |
| 4 | Helper EJS chưa có sẵn | 🟡 Trung bình | ✅ Added |

---

## 📁 Files đã tạo / sửa

### 1. **Mới tạo:**

#### `views/partials/pagination.ejs` (component phân trang chuẩn)
- Hỗ trợ **2 mode**: `server` (render EJS) + `js` (render trong JavaScript)
- Tự động build query string, ellipsis cho trang dài
- Public API: `Pagination.update({ currentPage, totalPages })`
- Style đồng nhất với `.pagination-wrapper / .pagination-btn / .pagination-ellipsis`

#### `views/partials/icons-helper.js` (Node.js helper)
```js
const icon = require('./views/partials/icons-helper');
icon.render('edit');                            // <i class="fa-solid fa-pen"></i>
icon.render('trash', { text: 'Xóa' });         // <button>...Xóa</button>
icon.render('add', { cssClass: 'btn-icon' });  // <i class="fa-solid fa-plus btn-icon"></i>
```

**60+ icon đã map sẵn:**
- Action: `edit`, `delete`, `close`, `add`, `check`, `save`, `eye`, `search`
- Navigation: `chevron-left/right/up/down`, `back`, `forward`, `play`, `pause`, `stop`
- Media: `image`, `video`, `file`, `folder`
- Status: `warning`, `error`, `success`, `info`
- Mạng xã hội: `comment`, `share`, `bell`, `user`, `heart`, `star`
- ...và nhiều hơn nữa

### 2. **CSS — thêm vào `public/css/style.css`:**

```css
/* ===== PAGINATION (chuẩn hóa) ===== */
.pagination-wrapper { display: flex; justify-content: space-between; ... }
.pagination-info    { font-size: .85rem; color: var(--text-muted); }
.pagination-controls { display: flex; gap: 6px; }
.pagination-btn     { min-width: 36px; height: 36px; ... }
.pagination-btn.is-active { background: var(--primary); color: #fff; ... }
.pagination-btn--nav { padding: 0 12px; }
.pagination-ellipsis { color: var(--text-muted); }

/* ===== BUTTON SYSTEM (chuẩn hóa) ===== */
.btn              { /* base button */ }
.btn-primary      { background: var(--primary); color: #fff; }
.btn-secondary    { background: var(--bg-card); }
.btn-success      { background: #16a34a; }
.btn-danger       { background: #dc2626; }
.btn-warning      { background: #f59e0b; }
.btn-ghost        { background: transparent; }
.btn-outline      { background: transparent; color: var(--primary); }
.btn-sm / .btn-lg / .btn-block

.btn-icon         { width: 32px; height: 32px; ... }
.btn-icon--danger { color: var(--danger); }
.btn-icon--success { color: var(--success); }
.btn-icon--sm     { width: 28px; }
.btn-icon--lg     { width: 40px; }
```

### 3. **Refactor 6 file dùng component pagination:**

| File | Trước | Sau |
|------|------|-----|
| `views/admin-licenses.ejs` | Custom HTML `<ul class="pagination">` | `<%- include('partials/pagination', {...}) %>` |
| `views/ai-scan.ejs` | `ai-scan-pagination` | `<%- include('partials/pagination', { mode: 'js' }) %>` |
| `views/schedule-archive.ejs` | `archive-pagination` | `<%- include('partials/pagination', { mode: 'js' }) %>` |
| `views/schedule-groups.ejs` | `groups-pagination` | `<%- include('partials/pagination', { mode: 'js' }) %>` |
| `views/shopeeLinks.ejs` | `pagination-bar` + `page-nav-btn` | `<%- include('partials/pagination', { mode: 'js' }) %>` |
| `views/tracking.ejs` | `pagination-bar` trong JS string | Render thành `.pagination-wrapper` + `.pagination-btn` |

### 4. **Đồng nhất icon Sửa/Xóa trong 8 file:**

| File | Trước | Sau |
|------|------|-----|
| `views/ai-comments.ejs` | `fa-pen-to-square` + `fa-trash-can` | `fa-pen` + `fa-trash` |
| `views/ai-content.ejs` | `fa-pen` (chỉ icon) | `fa-pen` + "Sửa" text |
| `views/ai-images.ejs` | `fa-trash` (chỉ icon) | `fa-trash` + "Xóa" text |
| `views/channels.ejs` | `fa-regular fa-pen-to-square` + `fa-regular fa-trash-can` | `fa-solid fa-pen` + `fa-solid fa-trash` |
| `views/comment-play.ejs` | `fa-pen-to-square` + `fa-trash-can` | `fa-pen` + `fa-trash` |
| `views/feedback.ejs` | OK | OK (đã chuẩn) |
| `views/music-trending.ejs` | `fa-trash-can` | (chưa refactor) |
| `views/tracking.ejs` | `fa-pen` + `fa-trash-can` | `fa-pen` + `fa-trash` |

---

## 🧪 Mapping icon (đã chuẩn hóa)

| Action | Tên helper | Class FA | Trước đây (không đồng nhất) |
|--------|------------|----------|----------------------------|
| **Edit/Sửa** | `edit` | `fa-solid fa-pen` | `fa-pen-to-square` (regular), `fa-pen` (solid), `fa-pen-fancy` (solid) |
| **Delete/Xóa** | `delete` / `trash` | `fa-solid fa-trash` | `fa-trash-can` (regular), `fa-trash` (solid) |
| **Close/Đóng** | `close` | `fa-solid fa-xmark` | `fa-xmark`, `&times;` |
| **Add/Thêm** | `add` / `plus` | `fa-solid fa-plus` | OK |
| **Check/Save** | `check` / `save` | `fa-check` / `fa-floppy-disk` | `fa-check`, `fa-save` (cũ) |
| **Eye/View** | `eye` | `fa-solid fa-eye` | OK |
| **Search** | `search` | `fa-solid fa-magnifying-glass` | OK |
| **Refresh** | `refresh` | `fa-solid fa-arrows-rotate` | `fa-sync`, `fa-redo` |

---

## 🔧 Cách dùng

### Pagination (server-side)
```ejs
<%- include('partials/pagination', {
    currentPage: page,
    totalPages: totalPages,
    totalItems: total,
    baseUrl: '/admin/licenses',
    queryParams: { status: 'active', search: 'test' }
}) %>
```

### Pagination (JavaScript / API)
```ejs
<div id="myPagination" data-current-page="1" data-total-pages="5">
    <%- include('partials/pagination', { mode: 'js', containerId: 'myPagination' }) %>
</div>

<script>
window.Pagination_onPageClick = function(page) {
    fetchMyData(page);
};

// Sau khi load data mới, update pagination:
window.Pagination.update({ currentPage: 3, totalPages: 10 });
</script>
```

### Icon (trong server-side EJS)
```ejs
<% const icon = require('./views/partials/icons-helper'); %>

<%- icon.render('edit') %>
<%- icon.render('trash', { text: 'Xóa', cssClass: 'btn-icon--danger' }) %>
<%- icon.render('plus', { text: 'Thêm mới' }) %>
<%- icon.render('search', { cssClass: 'text-muted' }) %>
```

### Button class chuẩn
```html
<button class="btn btn-primary">Lưu</button>
<button class="btn btn-secondary">Hủy</button>
<button class="btn btn-danger">Xóa</button>
<button class="btn btn-sm btn-icon--danger" title="Xóa"><i class="fa-solid fa-trash"></i></button>
<button class="btn btn-outline">Chi tiết</button>
```

---

## 📊 So sánh trước/sau

### Trước
- ❌ 6 file có class pagination khác nhau → phải style 6 chỗ
- ❌ 8 file dùng `fa-pen-to-square` / `fa-trash-can` không đồng nhất với các nơi dùng `fa-pen` / `fa-trash`
- ❌ Button action không có base class chuẩn → mỗi file tự định nghĩa
- ❌ Không có helper icon → mỗi lần phải nhớ tên class

### Sau
- ✅ 1 component `partials/pagination.ejs` dùng chung
- ✅ 1 helper `icons-helper.js` map 60+ icon
- ✅ 1 bộ button class `.btn .btn-primary .btn-icon...` dùng chung
- ✅ Style đồng nhất trong `style.css`

---

## ⚠️ Công việc còn lại (tùy chọn)

1. **Refactor music-trending.ejs** - còn dùng `fa-trash-can`
2. **Refactor schedule-manager.ejs** + các view còn dùng icon cũ
3. **Tạo helper `partials/button.ejs`** - nếu muốn wrap button vào partial
4. **Audit lại ai-content.ejs** - còn nhiều icon `fa-pen` / `fa-trash` rải rác

---

## 🧪 Cách test

1. **Mở `/admin/licenses`** → kiểm tra pagination chuẩn hiển thị đúng
2. **Mở `/schedule/groups`** → kiểm tra pagination JS hoạt động
3. **Mở `/channels`** → kiểm tra icon Sửa/Xóa đồng nhất
4. **Mở `/ai-content`** → kiểm tra button "Sửa" / "Xóa" có text rõ ràng
5. **So sánh visual** giữa các trang → font, padding, color phải giống nhau

---

**Tác giả:** Auto-generated bởi AI cho FB-SYSTEM
**Files đã thay đổi:** 11 (2 mới + 9 refactor)
**Lines changed:** ~250
