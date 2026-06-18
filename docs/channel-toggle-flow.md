# Channel Toggle (Bật/Tắt Kênh) - Flow Chi Tiết

## Tổng quan

Chức năng **toggle channel** cho phép bật/tắt (enable/disable) một kênh kết nối. Khi tắt, kênh vẫn tồn tại trong DB nhưng không được sử dụng bởi các feature khác (schedule, post, etc.).

---

## 1. Schema lưu trữ (MongoDB)

**File:** `models/Channel.js`

```js
isEnabled: { type: Boolean, default: true }
```

- Field `isEnabled` là **Boolean**, default `true`
- Lưu trực tiếp trong document `Channel` collection
- Khi toggle, giá trị bị đảo: `true → false` hoặc `false → true`

---

## 2. API Endpoint

**File:** `routes/channels.js` (line 18)

```
PATCH  /channels/api/:id/toggle
```

- Method: `PATCH`
- Param: `:id` — ObjectId của channel
- Auth: `requireAuth` middleware (user phải đăng nhập)
- Không cần body request

---

## 3. Controller Logic

**File:** `controllers/channelController.js` → `toggleChannel` (line 300-315)

```js
const toggleChannel = async (req, res) => {
    const channel = await Channel.findOne(
        { _id: req.params.id, userId: req.user._id },
        { isEnabled: 1 }
    );
    if (!channel) return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });

    channel.isEnabled = !channel.isEnabled;  // Đảo giá trị
    await channel.save();                     // Lưu vào MongoDB
    res.json({ success: true, message: `Kênh đã ${channel.isEnabled ? 'bật' : 'tắt'}` });
};
```

### Flow:
1. Tìm channel theo `_id` + `userId` (đảm bảo user chỉ toggle channel của mình)
2. Chỉ query field `isEnabled` (projection `{ isEnabled: 1 }`)
3. Đảo giá trị `isEnabled` (`!channel.isEnabled`)
4. `channel.save()` → cập nhật document trong MongoDB
5. Trả response JSON: `{ success: true, message: "Kênh đã bật" }` hoặc `"Kênh đã tắt"`

---

## 4. Frontend Call

**File:** `public/js/channels.js` → `toggleChannel` (line 365-373)

```js
async function toggleChannel(channelId) {
    const res = await fetch(`/channels/api/${channelId}/toggle`, { method: 'PATCH' });
    const data = await res.json();
    if (!data.success) showToast('Lỗi: ' + data.message, 'error');
}
```

### Trigger:
- User click vào **switch toggle** trên card kênh (line 59-65)
- Event listener trên `.switch-toggle input` → `change` event
- Lấy `channelId` từ `card.dataset.id`
- Gọi `toggleChannel(channelId)`

---

## 5. Ảnh hưởng đến các feature khác

### `getChannelsAPI` (GET /channels/api/list)
```js
Channel.find({ userId: req.user._id, isEnabled: true }, ...)
```
→ Chỉ trả về kênh **đã bật** (`isEnabled: true`). Kênh bị toggle off sẽ **không xuất hiện** trong danh sách API này.

### `getFacebookGroupsAPI` (GET /channels/api/:id/facebook-groups)
```js
Channel.findOne({ ..., isEnabled: true })
```
→ Không tìm được group nếu channel bị tắt.

### Schedule / Post features
Các feature khác khi query channel để đăng bài đều filter `isEnabled: true`, nên kênh bị toggle off sẽ **không được sử dụng**.

---

## 6. Tóm tắt đường dẫn lưu trữ

| Bước | Đường dẫn | Mô tả |
|------|-----------|-------|
| UI Toggle | `public/js/channels.js` line 59-65 | Switch toggle trên card |
| API Call | `PATCH /channels/api/:id/toggle` | Frontend gọi API |
| Route | `routes/channels.js` line 18 | Định tuyến |
| Controller | `controllers/channelController.js` line 300-315 | Xử lý logic |
| Save | `channel.save()` → MongoDB | Lưu `isEnabled` field vào DB |
| Field | `models/Channel.js` → `isEnabled: Boolean` | Schema definition |

---

## 7. Response mẫu

### Thành công (bật):
```json
{ "success": true, "message": "Kênh đã bật" }
```

### Thành công (tắt):
```json
{ "success": true, "message": "Kênh đã tắt" }
```

### Lỗi (không tìm thấy):
```json
{ "success": false, "message": "Kênh không tồn tại" }
```
