# CODE REVIEW — FB-SYSTEM AI Content
> Ngày: 2026-06-18 | Phạm vi: AI Content Creator + Auto Pipeline + Writing Style Research

---

## 1. TỔNG QUAN

| Metric | Giá trị |
|---|---|
| Files review | 12 files chính |
| Tổng dòng code | ~5,300 dòng |
| Vấn đề bảo mật | 5 |
| Code thừa cần xóa | 3 files |
| Code trùng lặp | 4 chỗ lớn |
| Logic issues | 3 |
| Performance issues | 2 |

---

## 2. FILES THỪA CẦN XÓA

| File | Lý do |
|---|---|
| `controllers/autoContentController.js` | Đã gộp vào `aiContentController.js` |
| `routes/autoContent.js` | Đã gộp vào `routes/aiContent.js` |
| `views/auto-content.ejs` | Đã gộp vào `views/ai-content.ejs` |

**Impact:** Không ảnh hưởng chức năng, chỉ là file chết.

---

## 3. VẤN ĐỀ BẢO MẬT

### 3.1 Không có input validation (MEDIUM)

**Vị trí:** `controllers/aiContentController.js` — tất cả API endpoints

```js
// ❌ Hiện tại: lấy trực tiếp từ req.body không validate
const { name, sampleArticles, topics } = req.body;
const { title, content } = req.body;
const updates = req.body; // ← Nguy hiểm nhất
```

**Rủi ro:**
- User có thể gửi field lạ (prototype pollution)
- Content quá dài có thể gây OOM
- Thiếu sanitize HTML trong content

**Fix:** Thêm validation middleware.

### 3.2 Object.assign với user input (HIGH)

**Vị trí:** `controllers/aiContentController.js:379`

```js
// ❌ Nguy hiểm: user có thể inject __proto__, constructor
Object.assign(schedule.contentConfig, updates.contentConfig);
```

**Rủi ro:** Prototype pollution attack

**Fix:** Whitelist fields trước khi assign.

### 3.3 Error message lộ internal details (LOW)

**Vị trí:** Tất cả catch blocks

```js
// ❌ Lộ internal error message cho client
res.status(500).json({ error: err.message });
```

**Rủi ro:** Lộ đường dẫn file, database structure, stack trace

**Fix:** Chỉ trả message chung chung cho client, log chi tiết ở server.

### 3.4 Không có rate limiting cho AI API (MEDIUM)

**Vị trí:** Tất cả endpoint gọi AI (analyzeStyle, generateNow, researchStyle...)

**Rủi ro:** User spam gọi AI → tốn tiền API

**Fix:** Thêm rate limit cho AI endpoints.

### 3.5 XSS trong EJS template (LOW)

**Vị trí:** `views/ai-content.ejs` — dùng `<%- %>` (unescaped) ở vài chỗ

```ejs
<%- JSON.stringify(products || []) %>  <!-- OK vì trong script tag -->
```

**Đánh giá:** An toàn vì nằm trong `<script>` tag, nhưng cần cẩn thận khi render user content.

---

## 4. CODE TRÙNG LẶP

### 4.1 userId extraction — 20+ lần

```js
// Lặp lại ở MỖI controller function
const userId = req.session.userId || req.user?._id;
```

**Fix:** Tạo helper function hoặc middleware.

### 4.2 getUserApiConfig — 2 nơi

- `controllers/aiContentController.js:45`
- `services/autoContentRunner.js:25`

**Fix:** Tách ra file `utils/aiConfig.js` dùng chung.

### 4.3 Parse AI response — 3 nơi

- `services/aiContentService.js:143` (analyzeWritingStyle)
- `services/aiContentService.js:464` (generateTopics)
- `services/aiContentService.js:564` (retrainFromBestPosts)
- `services/aiContentService.js:740` (analyzeProduct)
- `services/autoContentRunner.js:496` (updateLearningData)

**Fix:** Tạo helper `parseAIJsonResponse()` dùng chung.

### 4.4 Chrome launch pattern — 3 nơi

- `socialPlaywrightService.js` (launchChromeWithCDP)
- `writingStyleResearch.js` (crawlFromGroup/crawlFromProfile)
- `aiScan/crawler.js`

**Fix:** Dùng chung `getOrOpenSocialContext()`.

---

## 5. LOGIC ISSUES

### 5.1 Auto Content Runner — scheduling bug

**Vị trí:** `services/autoContentRunner.js:225-235`

```js
// ❌ Logic tính scheduledAt có bug
scheduledAt.setDate(scheduledAt.getDate() + 1); // Ngày mai
// ...
if (todaySlot > now && i === 0) {
    scheduledAt.setDate(scheduledAt.getDate() - 1); // Quay lại hôm nay???
}
```

**Vấn đề:** Logic vòng lặp, dễ tạo bài trùng giờ.

**Fix:** Tính scheduledAt đơn giản hơn.

### 5.2 WritingStyleResearch — không đóng browser khi lỗi

**Vị trí:** `services/writingStyleResearch.js:25-45`

```js
// ❌ Không có finally block để đóng browser
async function crawlFromGroup(userId, groupUrl, accountName, maxPosts) {
    let context;
    try {
        const result = await getOrOpenSocialContext(...);
        context = result.context;
        // ... crawl
        return posts;
    } catch (err) {
        return []; // Browser không được đóng!
    }
}
```

**Rủi ro:** Memory leak, zombie browser processes

### 5.3 isValidApiKey quá strict

**Vị trí:** `services/aiContentService.js:107`

```js
// ❌ Chỉ check prefix "sk-", không đúng cho tất cả provider
function isValidApiKey(key) {
    return key && key.trim() && key.trim().startsWith('sk-') && key.trim().length > 10;
}
```

**Vấn đề:** Anthropic key bắt đầu bằng `sk-ant-`, OpenAI compatible keys có format khác.

---

## 6. PERFORMANCE ISSUES

### 6.1 Query N+1 trong renderPage

**Vị trí:** `controllers/aiContentController.js:95-103`

```js
// 8 queries chạy parallel — OK, nhưng mỗi lần load trang
const [styles, schedules, posts, channels, settings, groupCaches, products, pipelines] = 
    await Promise.all([...]);
```

**Đánh giá:** Acceptable vì dùng `Promise.all`, nhưng có thể cache kết quả.

### 6.2 Crawl posts không có timeout rõ ràng

**Vị trí:** `services/writingStyleResearch.js` — crawl functions

**Rủi ro:** Nếu group có nhiều bài, crawl có thể chạy rất lâu.

**Fix:** Thêm timeout tổng cho toàn bộ research process.

---

## 7. CẤU TRÚC MỚI (ĐÃ IMPLEMENT)

```
controllers/aiContent/
  index.js                    ← Entry point, gộp tất cả modules
  helpers.js                  ← getUserId, errorResponse, deleteImageFiles (38 dòng)
  styleController.js          ← Văn phong + Research + Topics (127 dòng)
  scheduleController.js       ← Lịch nội dung (92 dòng)
  postController.js           ← Bài viết CRUD (66 dòng)
  productController.js        ← Sản phẩm CRUD (79 dòng)
  pipelineController.js       ← Auto Pipeline (54 dòng)

utils/
  aiConfig.js                 ← getUserApiConfig, isValidApiKey dùng chung
  aiResponse.js               ← parseAIJsonResponse dùng chung

middlewares/
  aiValidation.js             ← Input validation middleware
```

**Tất cả files < 150 dòng, AI có thể hiểu và maintain dễ dàng.**

---

## 8. ƯU TIÊN FIX

| # | Vấn đề | Mức độ | Trạng thái |
|---|---|---|---|
| 1 | Xóa 3 files thừa | Low | ✅ Đã xóa autoContentController, autoContent route, auto-content view |
| 2 | Input validation | Medium | ✅ Tạo middlewares/aiValidation.js |
| 3 | Object.assign prototype pollution | High | ✅ Whitelist fields trước khi assign |
| 4 | Error message lộ details | Low | ✅ Thay bằng errorResponse() helper |
| 5 | getUserApiConfig trùng lặp | Low | ✅ Tách ra utils/aiConfig.js |
| 6 | userId extraction trùng lặp | Low | ✅ Thay bằng getUserId() helper |
| 7 | Browser không đóng khi lỗi | Medium | ✅ Dùng getOrOpenSocialContext (managed session) |
| 8 | Auto runner scheduling bug | Medium | ✅ Fix logic tính scheduledAt |
| 9 | isValidApiKey quá strict | Low | ✅ Tách ra utils/aiConfig.js, hỗ trợ mọi provider |
| 10 | Parse AI response trùng lặp | Low | ✅ Tách ra utils/aiResponse.js |
| 11 | Rate limiting cho AI API | Medium | ✅ Áp dụng aiLimiter (10 req/min) cho 7 AI endpoints |
| 12 | Controller quá lớn (1049 dòng) | Low | ✅ Tách thành 7 modules, mỗi file < 130 dòng |
