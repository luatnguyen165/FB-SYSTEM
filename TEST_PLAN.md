# 🧪 FB-SYSTEM — TEST PLAN (Kế hoạch Test Toàn Diện)

> File này liệt kê **đầy đủ các tính năng, endpoint và kịch bản test** mà AI (hoặc QA thủ công) cần thực hiện để đảm bảo hệ thống hoạt động chính xác trước khi release.
> **Ngày tạo:** 2026-06-20 · **Phiên bản hệ thống:** dev branch · **Stack:** Express 5 + Mongoose 9 + EJS + Socket.IO + Playwright

---

## 📋 Mục lục

1. [Quy tắc chung khi test](#1-quy-tắc-chung-khi-test)
2. [Auth & User (Module Xác thực)](#2-auth--user)
3. [Dashboard](#3-dashboard)
4. [Channels (Quản lý kênh FB/IG/TT/YT/ZO/PI/TH)](#4-channels)
5. [Schedule (Lịch đăng bài)](#5-schedule)
6. [Reels (Lịch đăng Reels)](#6-reels)
7. [Schedule Groups (Quét group Facebook)](#7-schedule-groups)
8. [AI Scan (Quét bài viết bằng AI)](#8-ai-scan)
9. [AI Comments (Ngân hàng comment)](#9-ai-comments)
10. [Comment Play (Auto Comment)](#10-comment-play)
11. [Comment Crawler (FB)](#11-comment-crawler)
12. [AI Content Creator + Auto Pipeline](#12-ai-content)
13. [AI Images (Tạo ảnh AI)](#13-ai-images)
14. [Tracking (Theo dõi profile/page/group)](#14-tracking)
15. [Shopee Links](#15-shopee-links)
16. [Settings](#16-settings)
17. [Storage (Google Drive)](#17-storage)
18. [Music Trending](#18-music-trending)
19. [Download (YouTube/TikTok)](#19-download)
20. [Feedback](#20-feedback)
21. [Admin: License Keys](#21-license-keys)
22. [Admin: Features Visibility](#22-features-visibility)
23. [Admin: Scheduler Status](#23-scheduler-status)
24. [AI Reply Messenger](#24-ai-reply-messenger)
25. [Schedule Archive](#25-schedule-archive)
26. [Common (Socket.IO / I18n / Rate limit)](#26-common)
27. [Smoke Test (Build / Start)](#27-smoke-test)
28. [Checklist trước khi release](#28-checklist-trước-khi-release)

---

## 1. Quy tắc chung khi test

### 1.1 Môi trường
- **Server**: `npm run dev` chạy trên `http://localhost:4000`
- **Database**: MongoDB local (xem `MONGODB_URI` trong `.env`)
- **Browser test**: Chrome/Firefox mới nhất + Chrome profile trống
- **Electron**: chạy được `npm run electron-dev`
- **Biến môi trường cần có**: `JWT_SECRET`, `SESSION_SECRET`, `COOKIE_SECRET`, `OPENAI_API_KEY`, `SERVER_ADMIN_URL`

### 1.2 Loại test cần thực hiện cho MỖI endpoint
1. **Happy path** — Input hợp lệ → status code & payload đúng
2. **Auth** — Không có session → 401/redirect `/auth/login`
3. **Validation** — Thiếu field, sai kiểu, payload rỗng
4. **Edge case** — Giá trị biên, ký tự đặc biệt, tiếng Việt có dấu, emoji, rất dài
5. **Authorization** — User A không truy cập được resource của User B
6. **Concurrency** — Click nút nhiều lần → không tạo duplicate
7. **Performance** — Trang load < 2s với dữ liệu < 100 records

### 1.3 Công cụ khuyến nghị
- Postman / Insomnia (gọi API)
- Browser DevTools (kiểm tra Network, Console)
- MongoDB Compass (xem data)
- `curl` cho test nhanh

---

## 2. Auth & User

### 2.1 Routes liên quan
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/auth/register` | Hiển thị form đăng ký |
| POST | `/auth/register` | Xử lý đăng ký (forward tới ServerAdmin) |
| GET | `/auth/login` | Hiển thị form đăng nhập |
| POST | `/auth/login` | Xử lý đăng nhập |
| GET | `/auth/forgot-password` | Form quên mật khẩu |
| POST | `/auth/forgot-password` | Gửi yêu cầu reset |
| GET | `/auth/reset-password/:token` | Form đặt lại MK |
| POST | `/auth/reset-password/:token` | Đặt lại MK |
| GET | `/auth/profile` | Trang cá nhân |
| POST | `/auth/profile` | Cập nhật profile |
| GET | `/auth/change-password` | Form đổi MK |
| POST | `/auth/change-password` | Đổi MK |
| GET | `/auth/logout` | Đăng xuất |
| POST | `/auth/api/language` | Đổi ngôn ngữ |
| POST | `/auth/api/device` | Đăng ký thiết bị (public) |
| GET | `/auth/api/devices` | Danh sách thiết bị |
| POST | `/auth/api/gui/login` | Login cho Python GUI |
| POST | `/auth/api/gui/register` | Register cho GUI |
| POST | `/auth/api/gui/forgot-password` | Forgot cho GUI |
| POST | `/auth/api/gui/reset-password/:token` | Reset cho GUI |
| GET | `/auth/api/gui/logout` | Logout GUI |
| GET | `/auth/api/gui/me` | Check session GUI |

### 2.2 Kịch bản test Auth
- [ ] **TC-AUTH-01**: Vào `/auth/login` khi chưa login → hiển thị form, không redirect
- [ ] **TC-AUTH-02**: Vào `/auth/profile` khi chưa login → redirect về `/auth/login`
- [ ] **TC-AUTH-03**: Login đúng email/password → redirect `/dashboard`, lưu session, set cookie `remember_token`
- [ ] **TC-AUTH-04**: Login sai password → hiển thị flash error "Sai mật khẩu!"
- [ ] **TC-AUTH-05**: Login email không tồn tại → "Email không tồn tại!"
- [ ] **TC-AUTH-06**: Đăng ký với email đã tồn tại → "Email đã tồn tại!"
- [ ] **TC-AUTH-07**: Đăng ký thiếu field → "Vui lòng điền đủ thông tin!"
- [ ] **TC-AUTH-08**: Forgot password với email hợp lệ → flash success
- [ ] **TC-AUTH-09**: Reset password với token hết hạn (>15 phút) → "Token hết hạn"
- [ ] **TC-AUTH-10**: Reset password với mật khẩu < 6 ký tự → "Mật khẩu phải có ít nhất 6 ký tự"
- [ ] **TC-AUTH-11**: Đổi mật khẩu với MK cũ sai → báo lỗi
- [ ] **TC-AUTH-12**: Đổi ngôn ngữ `vi` → `en` → sidebar/text chuyển sang tiếng Anh
- [ ] **TC-AUTH-13**: Logout → session destroy, redirect `/auth/login`, cookie xoá
- [ ] **TC-AUTH-14**: Truy cập bất kỳ route protected nào khi không login → redirect login (không phải 404)
- [ ] **TC-AUTH-15**: Login GUI `/auth/api/gui/login` → trả JSON `{ success: true, userId, ... }`
- [ ] **TC-AUTH-16**: Đăng ký GUI với email trùng → `{ success: false, message: 'Email đã tồn tại!' }`

---

## 3. Dashboard

### 3.1 Route
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/dashboard` | Trang tổng quan |

### 3.2 Kịch bản test
- [ ] **TC-DASH-01**: Vào `/dashboard` khi có data → hiển thị cards thống kê
- [ ] **TC-DASH-02**: Counts chính xác: tổng channels, scheduled, posted, failed, shopee links
- [ ] **TC-DASH-03**: Recent schedules hiển thị 8 bản ghi mới nhất
- [ ] **TC-DASH-04**: Recent channels hiển thị 8 kênh mới nhất
- [ ] **TC-DASH-05**: Channel Distribution tính đúng theo platform FB/IG/TT/YT
- [ ] **TC-DASH-06**: Scheduled by Platform aggregate đúng
- [ ] **TC-DASH-07**: Pending ratio tính đúng (`posted / (posted+pending) * 100`)
- [ ] **TC-DASH-08**: User chưa có data nào → vẫn render, hiển thị 0
- [ ] **TC-DASH-09**: Khi MongoDB mất kết nối → không crash, hiển thị fallback
- [ ] **TC-DASH-10**: Upcoming schedules chỉ lấy `scheduledAt >= now`

---

## 4. Channels

### 4.1 Routes liên quan
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/channels` | Trang quản lý kênh |
| POST | `/channels/api/:platform/connect` | Kết nối platform (FB/TT/IG/YT/ZO/PI/TH) |
| POST | `/channels/api/create` | Tạo channel mới |
| PATCH | `/channels/api/:id/update` | Cập nhật channel |
| PATCH | `/channels/api/:id/toggle` | Bật/tắt channel |
| DELETE | `/channels/api/:id` | Xoá channel |
| GET | `/channels/api/list` | Lấy danh sách (JSON) |
| GET | `/channels/api/:id/facebook-groups` | Lấy groups của FB channel |
| POST | `/channels/api/:id/open` | Mở browser session |

### 4.2 Kịch bản test Channels
- [ ] **TC-CH-01**: Tạo channel FB hợp lệ → lưu DB, redirect/list cập nhật
- [ ] **TC-CH-02**: Tạo channel thiếu `accountName` → báo lỗi validation
- [ ] **TC-CH-03**: Upload avatar PNG/JPG < 5MB → OK; > 5MB → reject
- [ ] **TC-CH-04**: Tạo 2 channels cùng `accountName` + `platform` → có cho phép duplicate không?
- [ ] **TC-CH-05**: PATCH toggle channel → `isEnabled` đảo ngược
- [ ] **TC-CH-06**: DELETE channel → record xoá khỏi DB, không xoát posts đã đăng
- [ ] **TC-CH-07**: Kết nối FB → mở Playwright, login xong → `storageStatePath` được lưu
- [ ] **TC-CH-08**: Kết nối TT/IG/YT tương tự FB → dùng đúng opener (`openTiktokLoginWindow`...)
- [ ] **TC-CH-09**: Platform không hợp lệ (`/api/XX/connect`) → 404 hoặc error
- [ ] **TC-CH-10**: GET `/channels/api/list` → trả JSON, chỉ chứa channels của current user
- [ ] **TC-CH-11**: User A không truy cập được channel của User B (test với 2 session)
- [ ] **TC-CH-12**: Update channel với data rỗng → không crash, giữ nguyên data cũ
- [ ] **TC-CH-13**: Avatar upload nhưng không có file → vẫn tạo được channel
- [ ] **TC-CH-14**: GET facebook-groups của FB channel chưa connect → trả mảng rỗng hoặc báo lỗi rõ ràng

---

## 5. Schedule

### 5.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/schedule/post` | Trang tạo lịch post |
| GET | `/schedule/manager` | Quản lý lịch |
| GET | `/schedule/reels` | Trang reels |
| GET | `/schedule/groups` | Trang groups |
| GET | `/schedule/groups` | (alias) |
| POST | `/schedule/api/create` | Tạo schedule |
| PUT | `/schedule/api/update` | Cập nhật schedule |
| GET | `/schedule/api/list` | Danh sách |
| GET | `/schedule/api/by-date` | Lấy theo ngày |
| GET | `/schedule/api/:id` | Chi tiết |
| DELETE | `/schedule/api/:id` | Xoá |
| POST | `/schedule/api/run-schedule/:id` | Chạy ngay 1 schedule |
| GET | `/schedule/api/groups` | Lấy groups cho polling |
| POST | `/schedule/api/scan-groups` | Quét groups |
| POST | `/schedule/api/scrape-group` | Scrape group members |
| POST | `/schedule/api/scrape-joins` | Scrape từ joins |

### 5.2 Kịch bản test Schedule
- [ ] **TC-SCH-01**: Tạo schedule post FB với content + images → lưu DB, status `pending`
- [ ] **TC-SCH-02**: Tạo schedule với `scheduledAt` trong quá khứ → vẫn accept (sẽ chạy ngay)
- [ ] **TC-SCH-03**: Tạo schedule cho multi-platform (FB + IG) → lưu đúng `platforms` array
- [ ] **TC-SCH-04**: Upload 10 ảnh vượt giới hạn → reject
- [ ] **TC-SCH-05**: Content vượt giới hạn ký tự (vd >5000) → vẫn lưu nhưng cảnh báo UI
- [ ] **TC-SCH-06**: Update schedule → fields cập nhật, `updatedAt` thay đổi
- [ ] **TC-SCH-07**: Delete schedule → record xoá, không ảnh hưởng posts đã đăng
- [ ] **TC-SCH-08**: GET `/api/by-date?date=YYYY-MM-DD` → trả về schedules của ngày đó
- [ ] **TC-SCH-09**: Run ngay 1 schedule `/api/run-schedule/:id` → status chuyển `running` → `posted`/`failed`
- [ ] **TC-SCH-10**: Schedule Reels tạo OK, status `pending`
- [ ] **TC-SCH-11**: Schedule archive hiển thị các bài đã posted
- [ ] **TC-SCH-12**: Socket.IO emit `schedule:update` khi tạo/sửa/xoá → frontend cập nhật realtime
- [ ] **TC-SCH-13**: User khác không nhìn thấy schedule của user hiện tại
- [ ] **TC-SCH-14**: Schedule Groups page load, danh sách groups hiển thị đúng

---

## 6. Reels

### 6.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| POST | `/schedule/api/upload-local-reels-video` | Upload video reels |
| POST | `/schedule/api/upload-instant-reels` | Upload reels đăng ngay |
| GET | `/schedule/api/reels-runner/status` | Trạng thái runner |
| POST | `/schedule/api/reels-runner/run-now` | Chạy runner ngay |
| POST | `/schedule/api/reels-runner/run-schedule/:id` | Chạy 1 reels schedule |

### 6.2 Kịch bản test Reels
- [ ] **TC-REEL-01**: Upload video MP4 < 200MB → OK, lưu vào `uploads/videos/`
- [ ] **TC-REEL-02**: Upload video > 500MB → reject (theo giới hạn multer)
- [ ] **TC-REEL-03**: Upload file không phải video → reject
- [ ] **TC-REEL-04**: Reels runner status trả về `{ started, processing, lastRunAt }`
- [ ] **TC-REEL-05**: Run now → 1 schedule được xử lý
- [ ] **TC-REEL-06**: Reels schedule với platform không hợp lệ → error log, không crash
- [ ] **TC-REEL-07**: Đăng reels lên FB page thật (nếu có test account) → bài xuất hiện trên page
- [ ] **TC-REEL-08**: Upload instant reels → đăng ngay, không qua queue

---

## 7. Schedule Groups

### 7.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/schedule/groups` | Trang groups |
| POST | `/schedule/api/scan-groups` | Quét groups của FB account |
| POST | `/schedule/api/scrape-group` | Scrape members |
| POST | `/schedule/api/scrape-joins` | Scrape từ joined groups |
| GET | `/schedule/api/groups` | Lấy groups cho polling |

### 7.2 Kịch bản test
- [ ] **TC-SG-01**: Chọn FB channel → click "Quét groups" → hiển thị progress, kết quả lưu vào `FacebookGroupCache`
- [ ] **TC-SG-02**: Scrape members group → lấy được danh sách user (nếu group public)
- [ ] **TC-SG-03**: Scrape group riêng tư (user chưa join) → trả mảng rỗng hoặc error rõ ràng
- [ ] **TC-SG-04**: Scrape joins → lấy groups user đã join
- [ ] **TC-SG-05**: Group cache được reuse giữa các lần scrape (không fetch lại ngay)
- [ ] **TC-SG-06**: Channel chưa login FB → trả lỗi "Chưa kết nối FB"

---

## 8. AI Scan

### 8.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/schedule/ai-scan` | Trang AI Scan |
| POST | `/schedule/ai-scan/api/config/create` | Tạo config |
| PUT | `/schedule/ai-scan/api/config/update` | Update config |
| DELETE | `/schedule/ai-scan/api/config/:configId` | Xoá config |
| POST | `/schedule/ai-scan/api/config/:configId/toggle` | Bật/tắt config |
| GET | `/schedule/ai-scan/api/config/:configId` | Chi tiết config |
| POST | `/schedule/ai-scan/api/scan-now` | Chạy scan ngay |
| GET | `/schedule/ai-scan/api/results` | Danh sách kết quả |
| PUT | `/schedule/ai-scan/api/result/update` | Update result |
| DELETE | `/schedule/ai-scan/api/result/delete` | Xoá 1 result |
| DELETE | `/schedule/ai-scan/api/results` | Xoá nhiều results |
| GET | `/schedule/ai-scan/api/channel-groups` | Groups của channel |
| POST | `/schedule/ai-scan/api/upload-comment-file` | Upload file cho comment item |
| POST | `/schedule/ai-scan/api/settings/openai-key` | Lưu OpenAI key |
| POST | `/schedule/ai-scan/api/settings/test-openai-key` | Test key |

### 8.2 Kịch bản test AI Scan
- [ ] **TC-AIS-01**: Tạo config với keywords "mua xe", "bất động sản" → lưu DB
- [ ] **TC-AIS-02**: Tạo config thiếu `name` hoặc `prompt` → báo lỗi validation
- [ ] **TC-AIS-03**: Toggle config → `isActive` đảo
- [ ] **TC-AIS-04**: Scan-now trên config hợp lệ → quét posts, lưu AiScanResult
- [ ] **TC-AIS-05**: Scan-now khi không có OpenAI key → báo lỗi rõ ràng
- [ ] **TC-AIS-06**: Scan-now khi không có FB channel đang bật → báo lỗi
- [ ] **TC-AIS-07**: Scan với prompt rỗng → AI trả về fallback hoặc skip
- [ ] **TC-AIS-08**: Test OpenAI key hợp lệ → `{ success: true }`
- [ ] **TC-AIS-09**: Test OpenAI key sai → `{ success: false, message: '...' }`
- [ ] **TC-AIS-10**: Upload comment file (image/video) < 500MB → OK
- [ ] **TC-AIS-11**: Upload file > 500MB → reject
- [ ] **TC-AIS-12**: Delete result → record xoá
- [ ] **TC-AIS-13**: Update result (status, note) → lưu thành công
- [ ] **TC-AIS-14**: Scheduler chạy mỗi 30s, chỉ xử lý configs `isActive && scheduleEnabled`
- [ ] **TC-AIS-15**: Kết quả matching đúng được lưu với `isMatching: true`

---

## 9. AI Comments

### 9.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/schedule/ai-comments` | Trang comments |
| POST | `/schedule/ai-comment/api/create` | Tạo comment |
| PUT | `/schedule/ai-comment/api/update` | Update comment |
| DELETE | `/schedule/ai-comment/api/:commentId` | Xoá comment |
| POST | `/schedule/ai-comment/api/:commentId/toggle` | Bật/tắt comment |
| GET | `/schedule/ai-comment/api/active` | Lấy comment active |
| GET | `/schedule/ai-comment/api/all` | Lấy tất cả (cho picker) |
| POST | `/schedule/ai-comment/api/upload-file` | Upload file |

### 9.2 Kịch bản test AI Comments
- [ ] **TC-AIC-01**: Tạo text comment "Hay quá bạn ơi!" → lưu, type=text
- [ ] **TC-AIC-02**: Tạo comment thiếu `type` hoặc `content` → 400
- [ ] **TC-AIC-03**: Upload image cho comment → type=image, lưu URL
- [ ] **TC-AIC-04**: Upload video cho comment → type=video
- [ ] **TC-AIC-05**: Upload file > 500MB → reject
- [ ] **TC-AIC-06**: Upload file không phải ảnh/video → reject
- [ ] **TC-AIC-07**: Toggle comment → `isActive` đảo
- [ ] **TC-AIC-08**: GET active → chỉ trả comments có `isActive: true`
- [ ] **TC-AIC-09**: Order được set tự động theo count hiện tại
- [ ] **TC-AIC-10**: Stats trên trang chính xác: total, active, inactive, text/image/video

---

## 10. Comment Play

### 10.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/schedule/ai-comment/play` | Trang quản lý |
| POST | `/schedule/ai-comment/play/api/create` | Tạo play |
| PUT | `/schedule/ai-comment/play/api/:playId/update` | Update |
| DELETE | `/schedule/ai-comment/play/api/:playId` | Xoá |
| POST | `/schedule/ai-comment/play/api/:playId/toggle` | Toggle |
| POST | `/schedule/ai-comment/play/api/:playId/run` | Chạy ngay |
| GET | `/schedule/ai-comment/play/api/:playId/logs` | Logs |
| GET | `/schedule/ai-comment/play/api/:playId/logs-summary` | Tổng hợp logs |

### 10.2 Kịch bản test Comment Play
- [ ] **TC-CP-01**: Tạo play mới với scanConfig + commentIds + channelIds → lưu DB
- [ ] **TC-CP-02**: Tạo play thiếu fields bắt buộc → 400
- [ ] **TC-CP-03**: Update play → fields mới cập nhật
- [ ] **TC-CP-04**: Delete play → record xoá
- [ ] **TC-CP-05**: Toggle play → `isActive` đảo
- [ ] **TC-CP-06**: Run ngay → gọi Playwright, comment vào bài matched, log được tạo
- [ ] **TC-CP-07**: Logs hiển thị: success, failed, skipped, errors
- [ ] **TC-CP-08**: Logs summary thống kê đúng theo status
- [ ] **TC-CP-09**: Scheduler (mỗi 30s) chỉ xử lý play `isActive`
- [ ] **TC-CP-10**: Concurrent run được khoá (không chạy 2 lần cùng lúc) — `isCommentPlayProcessing`
- [ ] **TC-CP-11**: Play chạy với channel FB chưa login → báo lỗi, log error
- [ ] **TC-CP-12**: Comment Play tôn trọng `maxCommentsPerDay` nếu có

---

## 11. Comment Crawler

### 11.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/tracking/comments` | Trang crawler |
| POST | `/tracking/comments/api/scrape` | Bắt đầu scrape |
| GET | `/tracking/comments/api/list` | Danh sách job |
| GET | `/tracking/comments/api/job/:id` | Chi tiết job |
| GET | `/tracking/comments/api/job/:id/export` | Export CSV/JSON |
| DELETE | `/tracking/comments/api/job/:id` | Xoá job |

### 11.2 Kịch bản test Comment Crawler
- [ ] **TC-CC-01**: Vào trang `/tracking/comments` → hiển thị FB channels + lịch sử scrape
- [ ] **TC-CC-02**: Submit scrape với postUrl hợp lệ + channel FB → tạo CommentScrape record, status=running
- [ ] **TC-CC-03**: Scrape chạy async, progress emit qua Socket.IO
- [ ] **TC-CC-04**: Scrape với postUrl không phải FB → báo lỗi
- [ ] **TC-CC-05**: Scrape post công khai → lấy được comments + stats
- [ ] **TC-CC-06**: Option `includeReplies=true` → lấy cả reply
- [ ] **TC-CC-07**: Option `skipPreviousUsers=true` → loại bỏ user đã từng tương tác
- [ ] **TC-CC-08**: Scrape post riêng tư (không có quyền) → status=failed, error rõ ràng
- [ ] **TC-CC-09**: Sau scrape thành công, status → success, stats.totalComments cập nhật
- [ ] **TC-CC-10**: Export job → download CSV/JSON đúng format
- [ ] **TC-CC-11**: Delete job → record xoá
- [ ] **TC-CC-12**: Channel FB chưa login → báo lỗi trước khi scrape
- [ ] **TC-CC-13**: Trang hiển thị stats tổng: totalScrapes, successScrapes, totalComments

---

## 12. AI Content

### 12.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/ai-content` | Trang chính |
| POST | `/ai-content/api/styles` | Tạo style |
| POST | `/ai-content/api/styles/:id/analyze` | Phân tích style |
| PUT | `/ai-content/api/styles/:id` | Update style |
| DELETE | `/ai-content/api/styles/:id` | Xoá style |
| POST | `/ai-content/api/schedules` | Tạo schedule |
| PUT | `/ai-content/api/schedules/:id` | Update schedule |
| DELETE | `/ai-content/api/schedules/:id` | Xoá schedule |
| POST | `/ai-content/api/schedules/:id/generate` | Generate ngay |
| GET | `/ai-content/api/posts` | Danh sách posts |
| PUT | `/ai-content/api/posts/:id` | Update post |
| DELETE | `/ai-content/api/posts/:id` | Xoá post |
| POST | `/ai-content/api/posts/:id/publish` | Đăng bài |
| GET | `/ai-content/api/products` | Danh sách sản phẩm |
| GET | `/ai-content/api/products/:id` | Chi tiết SP |
| POST | `/ai-content/api/products` | Tạo SP |
| PUT | `/ai-content/api/products/:id` | Update SP |
| DELETE | `/ai-content/api/products/:id` | Xoá SP |
| POST | `/ai-content/api/products/:id/analyze` | Phân tích SP bằng AI |
| POST | `/ai-content/api/generate-topics` | Tạo topics |
| POST | `/ai-content/api/research` | Research style |
| POST | `/ai-content/api/styles/:id/retrain` | Train lại style |
| GET | `/ai-content/api/styles/:id/training-stats` | Thống kê training |
| POST | `/ai-content/api/settings/openai-key` | Lưu OpenAI key |
| GET | `/ai-content/api/settings/openai-key` | Check key |
| GET | `/ai-content/api/stats` | Dashboard stats |
| POST | `/ai-content/api/pipelines` | Tạo pipeline |
| POST | `/ai-content/api/pipelines/:id/run` | Chạy pipeline |
| POST | `/ai-content/api/pipelines/:id/toggle` | Toggle pipeline |
| DELETE | `/ai-content/api/pipelines/:id` | Xoá pipeline |

### 12.2 Kịch bản test AI Content
- [ ] **TC-AICT-01**: Tạo Writing Style với sample text → lưu, status pending
- [ ] **TC-AICT-02**: Analyze style → AI trả về style profile, lưu vào DB
- [ ] **TC-AICT-03**: Analyze style thiếu OpenAI key → báo lỗi
- [ ] **TC-AICT-04**: Tạo Schedule với style + channel + cron → lưu
- [ ] **TC-AICT-05**: Generate ngay → tạo 1 post bằng AI
- [ ] **TC-AICT-06**: Tạo Product với title + description → lưu
- [ ] **TC-AICT-07**: Analyze Product → AI trả về keywords, hook, structure
- [ ] **TC-AICT-08**: Generate Topics → AI trả về 10+ topic ideas
- [ ] **TC-AICT-09**: Retrain style → AI train lại từ best posts
- [ ] **TC-AICT-10**: Publish post → đăng lên channel đã chọn, status=published
- [ ] **TC-AICT-11**: Auto pipeline run → tạo post → đăng tự động
- [ ] **TC-AICT-12**: Rate limit (10 req/min) hoạt động đúng
- [ ] **TC-AICT-13**: Auto retrain scheduler (mỗi 30 phút) có chạy
- [ ] **TC-AICT-14**: Stats trang dashboard đúng số liệu

---

## 13. AI Images

### 13.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/ai-images` | Trang projects |
| POST | `/ai-images/api/project` | Tạo project |
| POST | `/ai-images/api/project/:projectId/upload` | Upload ảnh + prompt |
| GET | `/ai-images/api/project/:projectId/status` | Trạng thái project |
| PUT | `/ai-images/api/project/:projectId/name` | Đổi tên project |
| POST | `/ai-images/api/project/:projectId/favorite` | Toggle yêu thích |
| PUT | `/ai-images/api/project/:projectId/entry/:entryId` | Update prompt entry |
| DELETE | `/ai-images/api/project/:projectId/entry/:entryId` | Xoá entry |
| DELETE | `/ai-images/api/project/:projectId` | Xoá project |

### 13.2 Kịch bản test AI Images
- [ ] **TC-AII-01**: Tạo project → lưu, hiển thị trong danh sách
- [ ] **TC-AII-02**: Upload ảnh + prompt → entry được tạo, status=pending
- [ ] **TC-AII-03**: Status poll → entry chuyển sang completed/failed
- [ ] **TC-AII-04**: Ảnh completed hiển thị thumbnail
- [ ] **TC-AII-05**: Đổi tên project → tên mới hiển thị
- [ ] **TC-AII-06**: Toggle yêu thích → `isFavorite` đảo
- [ ] **TC-AII-07**: Update prompt entry → text mới lưu
- [ ] **TC-AII-08**: Delete entry → record xoá, file trên disk xoá
- [ ] **TC-AII-09**: Delete project → toàn bộ entries xoá
- [ ] **TC-AII-10**: Upload ảnh > 10MB → reject

---

## 14. Tracking

### 14.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/tracking` | Trang chính |
| POST | `/tracking/api/create` | Tạo tracking |
| PUT | `/tracking/api/update/:id` | Update tracking |
| DELETE | `/tracking/api/delete/:id` | Xoá tracking |
| POST | `/tracking/api/toggle/:id` | Toggle tracking |
| GET | `/tracking/api/list` | Danh sách |
| GET | `/tracking/api/channels` | Channels theo platform |
| POST | `/tracking/api/scrape/:id` | Scrape tracking |
| GET | `/tracking/api/posts/:trackingId` | Posts của tracking |
| PUT | `/tracking/api/posts/:id` | Update post |
| DELETE | `/tracking/api/posts/:id` | Xoá post |
| PUT | `/tracking/api/schedule/:id` | Update schedule |
| GET | `/tracking/api/schedule/:id` | Get schedule |
| POST | `/tracking/api/fix-paths` | Sửa absolute video paths |

### 14.2 Kịch bản test Tracking
- [ ] **TC-TR-01**: Tạo tracking cho FB profile (URL: facebook.com/username) → lưu DB
- [ ] **TC-TR-02**: Tạo tracking cho FB group (URL: facebook.com/groups/123) → lưu DB
- [ ] **TC-TR-03**: Tạo tracking cho FB page (URL: facebook.com/pages/Name/123) → lưu DB
- [ ] **TC-TR-04**: Scrape profile → lấy posts, lưu TrackingPost
- [ ] **TC-TR-05**: Scrape group → lấy group posts + videos
- [ ] **TC-TR-06**: Scrape profile riêng tư (chưa kết bạn) → báo lỗi
- [ ] **TC-TR-07**: Filter `?type=profile` chỉ hiển thị profile tracking
- [ ] **TC-TR-08**: Filter `?type=group` chỉ hiển thị group tracking
- [ ] **TC-TR-09**: Filter `?platform=facebook` kết hợp với type
- [ ] **TC-TR-10**: Scrape TikTok profile → lấy posts (nếu có tracking TikTok)
- [ ] **TC-TR-11**: Update post (note, category) → lưu
- [ ] **TC-TR-12**: Schedule tracking tự động scrape theo cron
- [ ] **TC-TR-13**: Fix paths → chuyển absolute path thành relative
- [ ] **TC-TR-14**: Stats hiển thị đúng: total, facebook, active

---

## 15. Shopee Links

### 15.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/shopee` | Trang quản lý |
| POST | `/shopee/api/create` | Tạo link |
| GET | `/shopee/api/list` | Danh sách |
| PUT | `/shopee/api/:id` | Update |
| DELETE | `/shopee/api/:id` | Xoá |

### 15.2 Kịch bản test Shopee
- [ ] **TC-SH-01**: Tạo link với shopeeUrl hợp lệ → lưu
- [ ] **TC-SH-02**: Tạo link thiếu shopeeUrl → 400
- [ ] **TC-SH-03**: Upload image cho link → lưu URL
- [ ] **TC-SH-04**: Update link → các field cập nhật
- [ ] **TC-SH-05**: Delete link → xoá record
- [ ] **TC-SH-06**: Schedule post có gắn shopeeLinks → hiển thị affiliate links

---

## 16. Settings

### 16.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/settings` | Trang settings |
| GET | `/settings/api/security` | Public key + status mã hoá |
| POST | `/settings/api/save` | Lưu settings |
| POST | `/settings/api/reset` | Reset về default |
| POST | `/settings/api/telegram-test` | Test Telegram |
| POST | `/settings/api/test-ai-connection` | Test AI connection |

### 16.2 Kịch bản test Settings
- [ ] **TC-ST-01**: Load `/settings` → hiển thị form các config
- [ ] **TC-ST-02**: Save settings → cập nhật DB (OpenAI key, Telegram, watermark...)
- [ ] **TC-ST-03**: Upload watermark → lưu file vào `uploads/`
- [ ] **TC-ST-04**: Reset settings → trở về default
- [ ] **TC-ST-05**: Test Telegram với token hợp lệ → gửi tin nhắn thành công
- [ ] **TC-ST-06**: Test Telegram với token sai → báo lỗi
- [ ] **TC-ST-07**: Test AI connection với OpenAI key hợp lệ → success
- [ ] **TC-ST-08**: Security endpoint trả về public key + crypto status

---

## 17. Storage (Google Drive)

### 17.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/storage` | Trang |
| POST | `/storage/api/drive-config` | Lưu config |
| POST | `/storage/api/connect-drive` | Kết nối |

### 17.2 Kịch bản test
- [ ] **TC-STO-01**: Lưu Drive config (client_id, client_secret) → lưu encrypted
- [ ] **TC-STO-02**: Connect Drive → OAuth flow, lưu token
- [ ] **TC-STO-03**: Config sai → báo lỗi rõ ràng

---

## 18. Music Trending

### 18.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/music-trending` | Trang |
| GET | `/music-trending/fetch?platform=TT` | Lấy tracks trending |
| POST | `/music-trending/delete/:id` | Xoá track |

### 18.2 Kịch bản test
- [ ] **TC-MT-01**: Vào `/music-trending` → tự động seed tracks nếu DB trống
- [ ] **TC-MT-02**: Fetch với platform TT → lấy tracks từ `public/music/tracks`
- [ ] **TC-MT-03**: Fetch với platform khác (IG, YT) → trả mảng rỗng hoặc platform-specific
- [ ] **TC-MT-04**: Delete track → xoá khỏi DB
- [ ] **TC-MT-05**: Tracks hiển thị đầy đủ metadata (title, artist, duration)
- [ ] **TC-MT-06**: Audio playback trên UI hoạt động

---

## 19. Download

### 19.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| POST | `/download/video` | Download video |
| POST | `/download/audio` | Download audio |
| GET | `/download/status` | Kiểm tra yt-dlp |

### 19.2 Kịch bản test
- [ ] **TC-DL-01**: `/download/status` → trả `{ available: true, version }` nếu có yt-dlp
- [ ] **TC-DL-02**: Download video YouTube hợp lệ → lưu file MP4 vào `public/video/`
- [ ] **TC-DL-03**: Download audio YouTube → lưu M4A vào `public/music/`
- [ ] **TC-DL-04**: Download URL không hợp lệ → báo lỗi
- [ ] **TC-DL-05**: Download với `quality=worst` → file nhỏ hơn
- [ ] **TC-DL-06**: Download file đã tồn tại → trả "Video đã tồn tại", không download lại
- [ ] **TC-DL-07**: Tên file chứa ký tự đặc biệt → được sanitize (`\/:*?"<>|` → `_`)
- [ ] **TC-DL-08**: Cookies từ TikTok account → file cookies.txt được tạo
- [ ] **TC-DL-09**: Timeout > 5 phút → báo lỗi timeout
- [ ] **TC-DL-10**: Thiếu URL → 400 "Vui lòng cung cấp URL video"

---

## 20. Feedback

### 20.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/feedback` | Trang |
| POST | `/feedback/api/create` | Tạo feedback |
| PUT | `/feedback/api/update/:id` | Update |
| GET | `/feedback/api/get/:id` | Chi tiết |
| DELETE | `/feedback/api/delete/:id` | Xoá |
| GET | `/feedback/api/admin` | Admin list tất cả |
| PUT | `/feedback/api/admin/:id` | Admin update |

### 20.2 Kịch bản test
- [ ] **TC-FB-01**: User tạo feedback → lưu với `userId`
- [ ] **TC-FB-02**: User update feedback của mình → OK
- [ ] **TC-FB-03**: User A update feedback của User B → 403/404
- [ ] **TC-FB-04**: User xoá feedback của mình → OK
- [ ] **TC-FB-05**: Admin xem tất cả feedback → list đầy đủ
- [ ] **TC-FB-06**: Admin update status (new/in-progress/resolved) → lưu
- [ ] **TC-FB-07**: Filter theo category (bug/feature/question) → đúng

---

## 21. License Keys

### 21.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/admin/licenses` | Trang admin |
| POST | `/admin/licenses/generate` | Tạo key mới |
| POST | `/admin/licenses/:id/toggle` | Suspend/unsuspend |
| POST | `/admin/licenses/:id/extend` | Gia hạn |
| DELETE | `/admin/licenses/:id` | Xoá |
| POST | `/admin/licenses/api/activate` | Activate key |
| GET | `/admin/licenses/api/check` | Check status |

### 21.2 Kịch bản test
- [ ] **TC-LIC-01**: Admin generate 5 keys → DB có 5 record mới
- [ ] **TC-LIC-02**: User activate key hợp lệ → success, user gắn key
- [ ] **TC-LIC-03**: User activate key đã dùng → báo lỗi
- [ ] **TC-LIC-04**: User activate key bị suspend → báo lỗi
- [ ] **TC-LIC-05**: Toggle license → status đảo
- [ ] **TC-LIC-06**: Extend license +30 days → expiryDate cập nhật
- [ ] **TC-LIC-07**: Delete license → record xoá
- [ ] **TC-LIC-08**: Non-admin không truy cập được `/admin/licenses`
- [ ] **TC-LIC-09**: Check status sau khi license hết hạn → expired

---

## 22. Features Visibility

### 22.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/features` | Trang admin |
| POST | `/features/api/update` | Cập nhật visibility |

### 22.2 Kịch bản test
- [ ] **TC-FV-01**: Admin bật/tắt feature → sidebar ẩn/hiện
- [ ] **TC-FV-02**: Non-admin không truy cập được `/features` → 403
- [ ] **TC-FV-03**: Update với field không tồn tại → bị bỏ qua
- [ ] **TC-FV-04**: Boolean conversion: string `"true"` → `true`

---

## 23. Scheduler Status

### 23.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/admin/scheduler/status` | Trạng thái realtime |
| POST | `/admin/scheduler/cleanup/now` | Cleanup FB sessions |
| POST | `/admin/scheduler/bg-scan/flush` | Flush queue |

### 23.2 Kịch bản test
- [ ] **TC-SCH-01**: GET status → trả memory, queues, workers
- [ ] **TC-SCH-02**: Cleanup now → sessions idle bị xoá ngay
- [ ] **TC-SCH-03**: Flush bg-scan → pending jobs bị skip
- [ ] **TC-SCH-04**: Non-admin không truy cập được

---

## 24. AI Reply Messenger

### 24.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/schedule/ai-reply-messenger` | Trang |

### 24.2 Kịch bản test
- [ ] **TC-MSG-01**: Vào trang → render với features
- [ ] **TC-MSG-02**: Trang hiển thị khi `features.aiReplyMessenger = true`
- [ ] **TC-MSG-03**: Khi feature bị tắt → redirect hoặc ẩn menu

---

## 25. Schedule Archive

### 25.1 Routes
| Method | URL | Mô tả |
|--------|-----|-------|
| GET | `/schedule/archive` | Trang archive |
| GET | `/schedule/archive/export` | Export CSV |

### 25.2 Kịch bản test
- [ ] **TC-AR-01**: Archive page → liệt kê posts có status=posted
- [ ] **TC-AR-02**: Export → download file CSV/Excel đúng format
- [ ] **TC-AR-03**: Filter theo date range
- [ ] **TC-AR-04**: Stats tổng: tổng posted, tỷ lệ thành công

---

## 26. Common

### 26.1 Middleware
- **Rate limiter**: 120 requests/minute/IP
  - [ ] Spam > 120 req trong 1 phút → 429
  - [ ] Sau 1 phút → reset
- **i18n middleware**: inject `t()` và `lang`
  - [ ] Switch `?lang=en` → text chuyển Anh
  - [ ] Switch `?lang=vi` → text chuyển Việt
- **Feature visibility**: load vào `res.locals.features`
  - [ ] Ẩn menu nếu feature = false
- **Auth middleware**: `requireAuth` + `requireAdmin`
  - [ ] Route admin → trả 403 nếu không phải admin

### 26.2 Socket.IO
- [ ] **TC-SOCK-01**: Connect Socket.IO khi vào `/dashboard` → `schedule:update` event realtime
- [ ] **TC-SOCK-02**: Tạo schedule từ tab A → tab B nhận được update
- [ ] **TC-SOCK-03**: Comment Crawler emit progress → UI cập nhật progress bar

### 26.3 Error handling
- [ ] **TC-ERR-01**: 404 cho URL không tồn tại → JSON `{ message: 'Không tìm thấy trang này!' }`
- [ ] **TC-ERR-02**: Unhandled rejection với Playwright CDP → không crash server
- [ ] **TC-ERR-03**: Validation error → trả status 400 với message rõ ràng
- [ ] **TC-ERR-04**: Server error → trả 500, log error đầy đủ

---

## 27. Smoke Test

### 27.1 Build & Start
- [ ] **TC-SMOKE-01**: `npm install` → không lỗi
- [ ] **TC-SMOKE-02**: `npm run dev` → server start port 4000 (hoặc port khác nếu 4000 bận)
- [ ] **TC-SMOKE-03**: `npm run electron-dev` → Electron window mở
- [ ] **TC-SMOKE-04**: MongoDB connect thành công → log "Đã kết nối thành công tới MongoDB"
- [ ] **TC-SMOKE-05**: Schedulers khởi động sau khi DB connect
- [ ] **TC-SMOKE-06**: `npm run build` → build Windows installer thành công
- [ ] **TC-SMOKE-07**: `npm run electron-start` → chạy production
- [ ] **TC-SMOKE-08**: Tắt server (Ctrl+C) → cleanup schedulers, exit gracefully

### 27.2 End-to-End Smoke (Happy Path)
- [ ] **TC-E2E-01**: Đăng ký → Đăng nhập → Vào dashboard
- [ ] **TC-E2E-02**: Tạo channel FB → Connect FB (login thủ công) → Channel hiển thị enabled
- [ ] **TC-E2E-03**: Tạo schedule post → Run now → Status=posted
- [ ] **TC-E2E-04**: Tạo AI Scan config → Scan now → Kết quả hiển thị
- [ ] **TC-E2E-05**: Tạo Comment Play → Run → Comments xuất hiện
- [ ] **TC-E2E-06**: Comment Crawler scrape post → Comments lưu DB
- [ ] **TC-E2E-07**: Tạo AI Content style → Generate post → Publish
- [ ] **TC-E2E-08**: Tracking profile → Scrape → Posts hiển thị

---

## 28. Checklist trước khi release

### 28.1 Bắt buộc (Must-have)
- [ ] Tất cả test case trên PASS
- [ ] Không có lỗi ESLint nghiêm trọng
- [ ] Không có secret/PII hardcode trong code
- [ ] `.env` đầy đủ các biến cần thiết
- [ ] `node_modules/` không commit
- [ ] `uploads/`, `social-sessions/`, `chrome-profiles/` không commit
- [ ] README/CLAUDE.md cập nhật
- [ ] Migrations scripts (nếu có) đã chạy

### 28.2 Khuyến nghị (Should-have)
- [ ] Load test với 100 schedules đồng thời
- [ ] Backup DB trước khi deploy
- [ ] Test với MongoDB cluster thật
- [ ] Test trên Windows + macOS + Linux
- [ ] Kiểm tra memory leak khi chạy lâu
- [ ] Verify rate limit hoạt động production
- [ ] Test restore sau khi MongoDB disconnect/reconnect

### 28.3 Nice-to-have
- [ ] Unit test cho services (Jest/Mocha)
- [ ] Integration test cho API
- [ ] E2E test với Playwright (UI test)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Monitoring (Sentry/Datadog)
- [ ] Logging structured (Winston/Pino)

---

## 📝 Ghi chú cho AI tester

1. **Khi gặp lỗi**, ghi rõ: input, expected, actual, screenshot/log
2. **Test theo thứ tự ưu tiên**: Auth → Core (Schedule/Channel) → Advanced (AI/Tracking)
3. **Không skip edge case**: input rỗng, null, undefined, mảng rỗng, ID không hợp lệ
4. **Cleanup sau mỗi test**: xoá data test khỏi DB để tránh ảnh hưởng test sau
5. **Với Playwright/cron jobs**: test trong môi trường dev trước, không chạy production Facebook account
6. **Vietnamese comments**: code có comment tiếng Việt, AI cần hiểu ngữ cảnh
7. **i18n**: nhiều text hiển thị đa ngôn ngữ (vi/en), test cả 2 ngôn ngữ

---

**Tác giả:** Auto-generated bởi AI cho FB-SYSTEM
**Cập nhật lần cuối:** 2026-06-20
**Liên hệ:** Xem `CLAUDE.md` để biết thêm chi tiết về project structure
