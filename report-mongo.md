# 📊 FB-SYSTEM — Test Report (MongoDB THẬT — Integration Test)

> Generated: 00:18:57 21/6/2026 · Test Runner: `scripts/test-features-mongo.js`
> Branch: `dev` · **Mode: Real MongoDB** · DB: `fb_system_test_1781975936473`

---

## 🎯 Tổng quan

| Metric | Value |
|--------|-------|
| **MongoDB URI** | `mongodb://localhost:27017/fb_system_test_1781975936473` |
| **Test DB** | `fb_system_test_1781975936473` |
| **Total tests** | 67 |
| ✅ **Passed** | 66 |
| ❌ **Failed** | 1 |
| 📈 **Pass rate** | **98.5%** |
| ⏱️ **Total duration** | 566 ms |
| 📦 **Test groups** | 11 |

**Overall status: 🟡 MOSTLY PASSED**

```
[███████████████████████████████████████░] 98.5%
```

---

## 📋 Kết quả theo nhóm

| Nhóm | ✅ Pass | ❌ Fail | Tổng | Tỷ lệ |
|------|---------|---------|------|--------|
| 🟢 **AI_COMMENT** | 11 | 0 | 11 | 100% |
| 🟢 **MODEL** | 8 | 0 | 8 | 100% |
| 🟢 **AI_SCAN** | 8 | 0 | 8 | 100% |
| 🟢 **SCHEDULE** | 8 | 0 | 8 | 100% |
| 🟢 **EDGE** | 7 | 0 | 7 | 100% |
| 🟢 **TRACKING** | 7 | 0 | 7 | 100% |
| 🟡 **E2E_WORKFLOW** | 6 | 1 | 7 | 86% |
| 🟢 **FEEDBACK** | 4 | 0 | 4 | 100% |
| 🟢 **CHANNEL** | 3 | 0 | 3 | 100% |
| 🟢 **SHOPEE** | 2 | 0 | 2 | 100% |
| 🟢 **LICENSE** | 2 | 0 | 2 | 100% |

---

## 🔍 Chi tiết từng test

### AI_COMMENT

> ✅ Tất cả 11 test PASS

- ✅ **Create text comment** _(5ms)_
- ✅ **Create image comment** _(31ms)_
- ✅ **Create video comment** _(2ms)_
- ✅ **Reject missing type** _(1ms)_
- ✅ **Reject missing content** _(0ms)_
- ✅ **Toggle isActive persists in DB** _(14ms)_
- ✅ **Update comment content persists** _(5ms)_
- ✅ **Delete comment removes from DB** _(4ms)_
- ✅ **Get active comments only** _(3ms)_
- ✅ **Get all comments for picker** _(1ms)_
- ✅ **Multi-tenant: User B không thấy comment của A** _(1ms)_

### MODEL

> ✅ Tất cả 8 test PASS

- ✅ **Schedule filter pending/posted** _(2ms)_
- ✅ **Multi-tenant: Channel isolation** _(2ms)_
- ✅ **AI Scan active configs** _(1ms)_
- ✅ **Trackings filter by type** _(45ms)_
- ✅ **License keys count by status** _(3ms)_
- ✅ **Aggregate comment scrape stats** _(54ms)_
- ✅ **Aggregate by status** _(1ms)_
- ✅ **Sort + limit chain** _(2ms)_

### AI_SCAN

> ✅ Tất cả 8 test PASS

- ✅ **Create AI Scan config persists** _(5ms)_
- ✅ **Reject missing name/channelId** _(0ms)_
- ✅ **Update config persists** _(4ms)_
- ✅ **Toggle config persists** _(8ms)_
- ✅ **Get config by ID** _(2ms)_
- ✅ **Get results returns empty initially** _(2ms)_
- ✅ **Delete config removes from DB** _(4ms)_
- ✅ **Channel groups API** _(1ms)_

### SCHEDULE

> ✅ Tất cả 8 test PASS

- ✅ **Create post schedule persists** _(28ms)_
- ✅ **Create reels schedule requires videoPath** _(4ms)_
- ✅ **Multi-platform schedule** _(4ms)_
- ✅ **Reject schedule without scheduledAt** _(0ms)_
- ✅ **Get schedules API returns user schedules** _(2ms)_
- ✅ **Get schedule by date filter** _(2ms)_
- ✅ **Update schedule persists** _(10ms)_
- ✅ **Delete schedule removes from DB** _(2ms)_

### EDGE

> ✅ Tất cả 7 test PASS

- ✅ **Vietnamese có dấu trong DB** _(2ms)_
- ✅ **Special characters in feedback title** _(12ms)_
- ✅ **ObjectId conversion** _(2ms)_
- ✅ **Populate-like join works** _(2ms)_
- ✅ **UpdateMany in DB** _(6ms)_
- ✅ **DeleteMany bulk** _(2ms)_
- ✅ **Index query (userId+platform)** _(1ms)_

### TRACKING

> ✅ Tất cả 7 test PASS

- ✅ **Create tracking for FB profile** _(18ms)_
- ✅ **Reject tracking without name/url** _(0ms)_
- ✅ **List tracking by user** _(2ms)_
- ✅ **Toggle tracking persists** _(6ms)_
- ✅ **Update tracking persists** _(5ms)_
- ✅ **Delete tracking removes from DB** _(2ms)_
- ✅ **Get channels by platform** _(2ms)_

### E2E_WORKFLOW

> ⚠️ 1/7 test FAIL

- ✅ **Full pipeline: scan → match → comment** _(12ms)_
- ✅ **Multi-step schedule lifecycle** _(15ms)_
- ✅ **Tracking → Scrape → Posts flow** _(7ms)_
- ✅ **Transaction-like multi-collection update** _(0ms)_
- ✅ **Concurrent operations safety** _(6ms)_
- ❌ **Transaction-like multi-collection update** _(2ms)_
  - ❗ `Cannot read properties of undefined (reading '_id')`
- ✅ **Cascade delete behavior** _(6ms)_

### FEEDBACK

> ✅ Tất cả 4 test PASS

- ✅ **Create feedback persists** _(39ms)_
- ✅ **Get own feedback** _(3ms)_
- ✅ **Update feedback persists** _(9ms)_
- ✅ **Delete feedback removes from DB** _(5ms)_

### CHANNEL

> ✅ Tất cả 3 test PASS

- ✅ **List channels returns user channels** _(19ms)_
- ✅ **Toggle channel persists** _(91ms)_
- ✅ **Delete channel removes from DB** _(25ms)_

### SHOPEE

> ✅ Tất cả 2 test PASS

- ✅ **Create Shopee link persists** _(4ms)_
- ✅ **Get list returns user products** _(3ms)_

### LICENSE

> ✅ Tất cả 2 test PASS

- ✅ **Activate valid unused key (uses insertMany to avoid pre-save)** _(2ms)_
- ✅ **List licenses as admin** _(1ms)_

---

## ❌ Chi tiết các test FAIL

### E2E_WORKFLOW → Transaction-like multi-collection update

- **Error**: `Cannot read properties of undefined (reading '_id')`
- **Duration**: 2ms

---

## 💡 So sánh với các test mode khác

| Mode | Tests | Pass | Rate | Time | Notes |
|------|-------|------|------|------|-------|
| Mock data only | 75 | ? | 100% | ~5ms | Logic test cơ bản |
| Real controllers + mock model | 30 | ? | 100% | ~80ms | Controller logic |
| **Real MongoDB** | **67** | **66** | **98.5%** | **566ms** | **Full integration** |

---

## 🧪 Cách chạy lại test

```bash
# Đảm bảo MongoDB local đang chạy trên port 27017
mongod  # hoặc chạy MongoDB Compass

# Chạy test integration với MongoDB thật
node scripts/test-features-mongo.js

# Sinh ra report-mongo.md ở root
```

### Lưu ý

- ✅ Test dùng **DB riêng** (`fb_system_test_<timestamp>`) — không ảnh hưởng data thật
- ✅ DB test tự động **bị xoá** sau khi test xong
- ✅ Test **persistence** thật vào MongoDB (không phải mock)
- ✅ Test **multi-tenant** — User A không thấy data User B
- ⚠️ Cần MongoDB chạy local trên port 27017

---

**Báo cáo được sinh tự động bởi `scripts/test-features-mongo.js`**
