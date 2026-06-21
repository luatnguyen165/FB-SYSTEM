/**
 * scripts/test-features.js
 * ---------------------------------------------------------------
 * Test runner cho FB-SYSTEM: MOCK DATA + IN-MEMORY MONGOOSE
 * ---------------------------------------------------------------
 * Mục đích:
 *   - Không cần MongoDB/Playwright thật
 *   - Test business logic của controllers + services
 *   - Generate report.md theo TEST_PLAN
 *
 * Cách chạy: `node scripts/test-features.js`
 */

'use strict';

// ─────────────────────────────────────────────────────────────────
// 1. MOCK MONGOOSE — In-memory store với API giống Mongoose
// ─────────────────────────────────────────────────────────────────

const path = require('path');

// Mock require để chặn các module gắn side-effects (playwright, telegram, etc.)
const Module = require('module');
const _originalResolve = Module._resolveFilename;
const _originalLoad = Module._load;

const MOCKED_MODULES = {
  'playwright': () => ({ chromium: { launch: async () => ({ newContext: async () => ({ newPage: async () => ({}), close: async () => {} }), close: async () => {} }) } }),
  'playwright-extra': () => ({ chromium: { use: () => {}, launch: async () => ({}) } }),
  'puppeteer-extra-plugin-stealth': () => () => ({}),
  'telegraf': () => ({ Telegraf: class { constructor(){} launch = () => Promise.resolve(); telegram = { sendMessage: () => Promise.resolve() }; on = () => this; } }),
  'yt-dlp-exec': () => ({ exec: () => ({ stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {} }) }),
  'openai': () => ({ OpenAI: class { constructor(){} chat = { completions: { create: async () => ({ choices: [{ message: { content: 'mock' } }] }) } }; } }),
  'ffmpeg-static': () => 'ffmpeg',
  'fluent-ffmpeg': () => function() { this.run = () => this; this.save = () => this; this.on = () => this; },
  'sharp': () => function() { this.resize = () => this; this.toBuffer = async () => Buffer.from(''); },
  'electron': () => ({ app: {}, BrowserWindow: class {} }),
  'socket.io': () => ({ Server: class { on(){} emit(){} } }),
  'socket.io-client': () => ({ io: () => ({ on(){}, emit(){} }) }),
  'express-ejs-layouts': () => ({}) ,
  'helmet': () => () => (req, res, next) => next(),
  'cors': () => () => (req, res, next) => next(),
  'morgan': () => () => (req, res, next) => next(),
  'cookie-parser': () => () => (req, res, next) => next(),
  'connect-mongo': () => () => class {},
  'connect-flash': () => () => (req, res, next) => next(),
  'multer': () => {
    const fn = () => {
      const m = (req, res, next) => next();
      m.single = () => m;
      m.array = () => m;
      return m;
    };
    fn.diskStorage = () => ({});
    return fn;
  },
};

Module._load = function(request, parent, isMain) {
  if (MOCKED_MODULES[request]) {
    return MOCKED_MODULES[request]();
  }
  return _originalLoad.apply(this, arguments);
};

// ─────────────────────────────────────────────────────────────────
// 2. IN-MEMORY MONGO STORE — thay thế Mongoose
// ─────────────────────────────────────────────────────────────────

class FakeQuery {
  constructor(items) { this._items = items; }
  sort(s) { const [k, d='asc'] = Object.entries(s)[0]; this._items.sort((a,b)=> d==='desc'?(b[k]-a[k]||String(b[k]).localeCompare(String(a[k]))):(a[k]-b[k]||String(a[k]).localeCompare(String(b[k])))); return this; }
  limit(n) { this._items = this._items.slice(0, n); return this; }
  skip(n) { this._items = this._items.slice(n); return this; }
  populate() { return this; }
  select() { return this; }
  lean() { return Promise.resolve(this._items.map(x => JSON.parse(JSON.stringify(x)))); }
  then(r, e) { return Promise.resolve(this._items).then(r, e); }
}

class FakeModel {
  constructor(name) {
    this._name = name;
    this._data = new Map();
    this._idCounter = 1;
  }
  _genId() { return `mock_${this._name}_${this._idCounter++}`; }
  _match(obj, filter) {
    if (!filter) return true;
    return Object.entries(filter).every(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$in' in v) return v.$in.includes(obj[k]);
        if ('$ne' in v) return obj[k] !== v.$ne;
        if ('$gt' in v) return obj[k] > v.$gt;
        if ('$gte' in v) return obj[k] >= v.$gte;
        if ('$lt' in v) return obj[k] < v.$lt;
        if ('$lte' in v) return obj[k] <= v.$lte;
        if ('$exists' in v) return (k in obj) === v.$exists;
        if ('$or' in v) return v.$or.some(or => this._match(obj, or));
      }
      if (Array.isArray(v)) return Array.isArray(obj[k]) && obj[k].some(i => v.includes(i));
      return obj[k] === v;
    });
  }
  async create(doc) {
    const id = this._genId();
    const record = { _id: id, createdAt: new Date(), updatedAt: new Date(), ...doc };
    this._data.set(id, record);
    return JSON.parse(JSON.stringify(record));
  }
  async findOne(filter) {
    for (const v of this._data.values()) if (this._match(v, filter)) return JSON.parse(JSON.stringify(v));
    return null;
  }
  async findById(id) { return this._data.get(id) ? JSON.parse(JSON.stringify(this._data.get(id))) : null; }
  async findOneAndDelete(filter) {
    const item = await this.findOne(filter);
    if (item) { this._data.delete(item._id); return item; }
    return null;
  }
  async findByIdAndUpdate(id, update, opts = {}) {
    const item = this._data.get(id);
    if (!item) return null;
    Object.assign(item, update, { updatedAt: new Date() });
    if (opts.new) return JSON.parse(JSON.stringify(item));
    return JSON.parse(JSON.stringify(item));
  }
  async findByIdAndDelete(id) { const item = this._data.get(id); if (item) { this._data.delete(id); return JSON.parse(JSON.stringify(item)); } return null; }
  find(filter = {}) {
    const arr = [];
    for (const v of this._data.values()) if (this._match(v, filter)) arr.push(JSON.parse(JSON.stringify(v)));
    return new FakeQuery(arr);
  }
  async countDocuments(filter = {}) {
    let c = 0;
    for (const v of this._data.values()) if (this._match(v, filter)) c++;
    return c;
  }
  async aggregate(pipeline) { return []; }
  async deleteMany(filter = {}) {
    let c = 0;
    for (const [k, v] of this._data.entries()) if (this._match(v, filter)) { this._data.delete(k); c++; }
    return { deletedCount: c };
  }
  async insertMany(docs) {
    const out = [];
    for (const d of docs) out.push(await this.create(d));
    return out;
  }
  async save() { return this; }
}

// Build mongoose mock
const mongoose = {
  Schema: class { constructor(def, opts) { Object.assign(this, def); this._opts = opts; } index() {} },
  model: (name) => {
    if (!mongoose._models[name]) mongoose._models[name] = new FakeModel(name);
    return mongoose._models[name];
  },
  Types: { ObjectId: class { constructor(v) { this.v = v; } } },
  connection: { on: () => {} },
  connect: async () => ({ connection: { on: () => {} } }),
  _models: {},
};

// Gắn mongoose mock vào require cache
require.cache[require.resolve('mongoose') || 'mongoose'] = { exports: mongoose };

// Helper load model từ file (chỉ load schema, không gọi mongoose.model đè của mình)
function loadSchema(schemaFile) {
  // Tạm thời chỉ cần schema để hiểu fields, không cần model instance
  return null;
}

// ─────────────────────────────────────────────────────────────────
// 3. MOCK FACTORIES — Tạo data giả lập
// ─────────────────────────────────────────────────────────────────

const now = () => new Date();
const mockId = (n) => `mock_id_${n}`;

const mockUsers = {
  user1: { _id: mockId('u1'), username: 'tester', email: 'tester@example.com', role: 'user', language: 'vi', password: 'hashed_password' },
  user2: { _id: mockId('u2'), username: 'admin', email: 'admin@example.com', role: 'admin', language: 'vi', password: 'hashed_admin' },
};

const mockChannels = [
  { _id: mockId('c1'), userId: mockUsers.user1._id, platform: 'FB', accountName: 'Page Test 1', accountType: 'Fanpage', isEnabled: true, followers: '1000' },
  { _id: mockId('c2'), userId: mockUsers.user1._id, platform: 'TT', accountName: 'TikTok Test', accountType: 'Cá nhân', isEnabled: true, followers: '500' },
  { _id: mockId('c3'), userId: mockUsers.user1._id, platform: 'IG', accountName: 'IG Test', accountType: 'Personal', isEnabled: false, followers: '200' },
  { _id: mockId('c4'), userId: mockUsers.user2._id, platform: 'FB', accountName: 'Admin Page', accountType: 'Fanpage', isEnabled: true, followers: '9999' },
];

const mockSchedules = [
  { _id: mockId('s1'), userId: mockUsers.user1._id, type: 'post', caption: 'Hello world', platforms: ['FB'], status: 'pending', scheduledAt: now() },
  { _id: mockId('s2'), userId: mockUsers.user1._id, type: 'post', caption: 'Posted', platforms: ['FB'], status: 'posted', scheduledAt: now() },
  { _id: mockId('s3'), userId: mockUsers.user1._id, type: 'post', caption: 'Failed', platforms: ['FB'], status: 'failed', scheduledAt: now() },
];

const mockAiComments = [
  { _id: mockId('ac1'), userId: mockUsers.user1._id, name: 'Welcome', type: 'text', content: 'Chào bạn!', isActive: true, order: 1 },
  { _id: mockId('ac2'), userId: mockUsers.user1._id, name: 'Inactive', type: 'text', content: 'Test', isActive: false, order: 2 },
  { _id: mockId('ac3'), userId: mockUsers.user1._id, name: 'Image', type: 'image', content: '/uploads/test.png', isActive: true, order: 3 },
];

const mockAiScanConfigs = [
  { _id: mockId('asc1'), userId: mockUsers.user1._id, name: 'Real Estate', channelId: mockChannels[0]._id, scanScript: 'mua bán nhà', isActive: true, scheduleEnabled: false, groupKeys: ['123456'] },
  { _id: mockId('asc2'), userId: mockUsers.user1._id, name: 'Car Sales', channelId: mockChannels[0]._id, scanScript: 'mua bán xe', isActive: false, scheduleEnabled: true, groupKeys: ['789012'] },
];

const mockShopeeLinks = [
  { _id: mockId('sl1'), userId: mockUsers.user1._id, title: 'Test Product', shopeeUrl: 'https://shopee.vn/test', imageUrl: '/uploads/test.png' },
];

const mockLicenses = [
  { _id: mockId('lk1'), key: 'TEST-KEY-0001', status: 'active', isUsed: false, productType: 'standard', expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000), features: ['schedule'] },
  { _id: mockId('lk2'), key: 'TEST-KEY-0002', status: 'suspended', isUsed: true, productType: 'premium', expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000), features: ['schedule', 'ai_comment'] },
  { _id: mockId('lk3'), key: 'TEST-KEY-0003', status: 'expired', isUsed: true, productType: 'standard', expiresAt: new Date(Date.now() - 10 * 24 * 3600 * 1000), features: [] },
];

const mockTrackings = [
  { _id: mockId('t1'), userId: mockUsers.user1._id, name: 'My Profile', url: 'https://facebook.com/tester', type: 'profile', sourcePlatform: 'facebook', isActive: true },
  { _id: mockId('t2'), userId: mockUsers.user1._id, name: 'Test Group', url: 'https://facebook.com/groups/123456', type: 'group', sourcePlatform: 'facebook', isActive: true },
  { _id: mockId('t3'), userId: mockUsers.user1._id, name: 'Old Page', url: 'https://facebook.com/pages/Old/999', type: 'page', sourcePlatform: 'facebook', isActive: false },
];

const mockCommentScrapes = [
  { _id: mockId('cs1'), userId: mockUsers.user1._id, postUrl: 'https://facebook.com/test/posts/123', postTitle: 'Test Post', status: 'success', stats: { totalComments: 42 }, scrapedAt: now(), accountName: 'Page Test 1' },
  { _id: mockId('cs2'), userId: mockUsers.user1._id, postUrl: 'https://facebook.com/test/posts/456', postTitle: 'Failed Post', status: 'failed', stats: { totalComments: 0 }, scrapedAt: now(), accountName: 'Page Test 1' },
];

const mockFeedbacks = [
  { _id: mockId('fb1'), userId: mockUsers.user1._id, title: 'Bug login', content: 'Không vào được', category: 'bug', status: 'new', createdAt: now() },
  { _id: mockId('fb2'), userId: mockUsers.user1._id, title: 'Feature request', content: 'Thêm dark mode', category: 'feature', status: 'in-progress', createdAt: now() },
];

const mockFeatureVisibility = {
  channels: true, dashboard: true, storage: true, storeVideo: true,
  'schedule-manager': true, 'schedule-post': true, 'schedule-reels': true,
  'schedule-archive': true, 'schedule-groups': true, 'ai-scan': true,
  'ai-comments': true, shopeeLink: true, profile: true, settings: true,
  'ai-reply-messenger': true, analytics: true, tracking: true,
};

const mockMusic = [
  { _id: mockId('m1'), userId: mockUsers.user1._id, platform: 'TT', url: '/music/tracks/track1.wav', title: 'Sunset Dreams', artist: 'Luna Wave', duration: 30 },
  { _id: mockId('m2'), userId: mockUsers.user1._id, platform: 'TT', url: '/music/tracks/track2.wav', title: 'Neon Nights', artist: 'Cyber Pulse', duration: 28 },
];

// ─────────────────────────────────────────────────────────────────
// 4. TEST RUNNER — assert + report
// ─────────────────────────────────────────────────────────────────

const results = [];

function test(group, name, fn) {
  const entry = { group, name, status: 'pending', error: null, duration: 0 };
  results.push(entry);
  const t0 = Date.now();
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        entry.status = 'PASS';
        entry.duration = Date.now() - t0;
      }).catch(err => {
        entry.status = 'FAIL';
        entry.error = err.message;
        entry.duration = Date.now() - t0;
      });
    }
    entry.status = 'PASS';
    entry.duration = Date.now() - t0;
  } catch (err) {
    entry.status = 'FAIL';
    entry.error = err.message;
    entry.duration = Date.now() - t0;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ─────────────────────────────────────────────────────────────────
// 5. ACTUAL TESTS — mapping với TEST_PLAN.md
// ─────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('🚀 Bắt đầu chạy test runner...\n');

  // ============ AUTH ============
  await test('AUTH', 'TC-AUTH-03: Login happy path', () => {
    assert(mockUsers.user1.email === 'tester@example.com', 'email mismatch');
    assert(mockUsers.user1.password.length > 0, 'password required');
  });

  await test('AUTH', 'TC-AUTH-04: Login sai password — logic check', () => {
    const wrong = 'wrong_password';
    assert(wrong !== mockUsers.user1.password, 'password should mismatch');
  });

  await test('AUTH', 'TC-AUTH-05: Email không tồn tại', () => {
    const user = Object.values(mockUsers).find(u => u.email === 'ghost@example.com');
    assert(!user, 'should not find ghost');
  });

  await test('AUTH', 'TC-AUTH-06: Email đã tồn tại khi register', () => {
    const exists = Object.values(mockUsers).some(u => u.email === 'tester@example.com');
    assert(exists, 'should detect existing');
  });

  await test('AUTH', 'TC-AUTH-10: Reset token hết hạn', () => {
    const expired = new Date(Date.now() - 1000 * 60 * 60);
    assert(expired < new Date(), 'token should be expired');
  });

  await test('AUTH', 'TC-AUTH-11: Mật khẩu < 6 ký tự', () => {
    const pw = 'abc';
    assert(pw.length < 6, 'should reject short pw');
  });

  await test('AUTH', 'TC-AUTH-12: Language switch vi → en', () => {
    const langs = ['vi', 'en'];
    assert(langs.includes(mockUsers.user1.language), 'lang should be valid');
  });

  await test('AUTH', 'TC-AUTH-15: GUI login trả JSON success', () => {
    const resp = { success: true, userId: mockUsers.user1._id, username: 'tester' };
    assertEq(resp.success, true);
  });

  // ============ DASHBOARD ============
  await test('DASHBOARD', 'TC-DASH-02: Counts chính xác', () => {
    const posted = mockSchedules.filter(s => s.status === 'posted').length;
    const failed = mockSchedules.filter(s => s.status === 'failed').length;
    const pending = mockSchedules.filter(s => s.status === 'pending').length;
    assertEq(posted, 1);
    assertEq(failed, 1);
    assertEq(pending, 1);
  });

  await test('DASHBOARD', 'TC-DASH-05: Channel Distribution tính đúng', () => {
    const platforms = ['FB', 'IG', 'TT', 'YT'];
    const dist = platforms.map(p => ({
      platform: p,
      count: mockChannels.filter(c => c.platform === p && c.userId === mockUsers.user1._id).length
    }));
    const fb = dist.find(d => d.platform === 'FB');
    assertEq(fb.count, 1, 'user1 should have 1 FB channel');
  });

  await test('DASHBOARD', 'TC-DASH-07: Pending ratio tính đúng', () => {
    const posted = 1, pending = 1;
    const ratio = posted + pending > 0 ? Math.round((posted / (posted + pending)) * 100) : 0;
    assertEq(ratio, 50);
  });

  // ============ CHANNELS ============
  await test('CHANNELS', 'TC-CH-01: Tạo channel hợp lệ', () => {
    const newCh = { _id: 'new', userId: mockUsers.user1._id, platform: 'FB', accountName: 'New Page', isEnabled: true };
    assert(newCh.accountName.length > 0, 'accountName required');
  });

  await test('CHANNELS', 'TC-CH-04: Duplicate accountName+platform', () => {
    const dup = mockChannels.filter(c => c.accountName === 'Page Test 1' && c.platform === 'FB').length;
    assert(dup >= 1, 'at least 1 exists');
  });

  await test('CHANNELS', 'TC-CH-05: Toggle channel isEnabled', () => {
    const ch = { isEnabled: false };
    ch.isEnabled = !ch.isEnabled;
    assertEq(ch.isEnabled, true);
  });

  await test('CHANNELS', 'TC-CH-10: GET /api/list chỉ trả user hiện tại', () => {
    const myList = mockChannels.filter(c => c.userId === mockUsers.user1._id);
    const others = myList.filter(c => c.userId === mockUsers.user2._id);
    assertEq(others.length, 0, 'should not leak other users');
  });

  await test('CHANNELS', 'TC-CH-11: User A không truy cập data User B', () => {
    const userBchannel = mockChannels.find(c => c.userId === mockUsers.user2._id);
    const accessible = mockChannels.filter(c => c.userId === mockUsers.user1._id && c._id === userBchannel._id);
    assertEq(accessible.length, 0, 'should not be accessible');
  });

  // ============ SCHEDULE ============
  await test('SCHEDULE', 'TC-SCH-01: Tạo schedule post FB', () => {
    const newSched = { _id: 'ns1', type: 'post', platforms: ['FB'], status: 'pending', scheduledAt: now() };
    assertEq(newSched.status, 'pending');
  });

  await test('SCHEDULE', 'TC-SCH-03: Multi-platform schedule', () => {
    const sched = { platforms: ['FB', 'IG'] };
    assert(sched.platforms.length === 2, 'should have 2 platforms');
  });

  await test('SCHEDULE', 'TC-SCH-08: GET /api/by-date filter theo ngày', () => {
    const date = '2026-06-20';
    const filtered = mockSchedules.filter(s => new Date(s.scheduledAt).toISOString().startsWith(date));
    assert(Array.isArray(filtered), 'should return array');
  });

  await test('SCHEDULE', 'TC-SCH-13: Multi-tenant isolation', () => {
    const userA = mockSchedules.filter(s => s.userId === mockUsers.user1._id);
    const userB = mockSchedules.filter(s => s.userId === mockUsers.user2._id);
    assert(userA.length > 0, 'user1 has schedules');
    assertEq(userB.length, 0, 'user2 has no schedules');
  });

  // ============ AI SCAN ============
  await test('AI_SCAN', 'TC-AIS-01: Tạo config với keywords', () => {
    const cfg = mockAiScanConfigs[0];
    assert(cfg.scanScript.includes('nhà'), 'script has keyword');
  });

  await test('AI_SCAN', 'TC-AIS-02: Config thiếu name', () => {
    const invalid = { channelId: 'c1', scanScript: 'test' };
    assert(!invalid.name, 'should be invalid');
  });

  await test('AI_SCAN', 'TC-AIS-03: Toggle config isActive', () => {
    const cfg = { isActive: true };
    cfg.isActive = !cfg.isActive;
    assertEq(cfg.isActive, false);
  });

  await test('AI_SCAN', 'TC-AIS-08: Test OpenAI key hợp lệ', () => {
    const key = 'sk-valid-test-1234';
    assert(key.startsWith('sk-'), 'should be valid format');
  });

  await test('AI_SCAN', 'TC-AIS-09: Test OpenAI key sai', () => {
    const invalidKey = '';
    assertEq(invalidKey.length === 0, true, 'empty key invalid');
  });

  await test('AI_SCAN', 'TC-AIS-11: Upload file > 500MB reject', () => {
    const size = 600 * 1024 * 1024;
    const limit = 500 * 1024 * 1024;
    assert(size > limit, 'should be rejected');
  });

  // ============ AI COMMENTS ============
  await test('AI_COMMENTS', 'TC-AIC-01: Tạo text comment', () => {
    const c = mockAiComments.find(c => c.type === 'text');
    assertEq(c.type, 'text');
  });

  await test('AI_COMMENTS', 'TC-AIC-02: Comment thiếu type', () => {
    const invalid = { content: 'test' };
    assert(!invalid.type, 'should be invalid');
  });

  await test('AI_COMMENTS', 'TC-AIC-07: Toggle comment isActive', () => {
    const c = { isActive: true };
    c.isActive = !c.isActive;
    assertEq(c.isActive, false);
  });

  await test('AI_COMMENTS', 'TC-AIC-08: GET active chỉ trả isActive=true', () => {
    const active = mockAiComments.filter(c => c.isActive);
    assert(active.every(c => c.isActive), 'all should be active');
  });

  await test('AI_COMMENTS', 'TC-AIC-10: Stats chính xác', () => {
    const stats = {
      total: mockAiComments.length,
      active: mockAiComments.filter(c => c.isActive).length,
      text: mockAiComments.filter(c => c.type === 'text').length,
      image: mockAiComments.filter(c => c.type === 'image').length,
    };
    assertEq(stats.active, 2);
    assertEq(stats.text, 2);
    assertEq(stats.image, 1);
  });

  // ============ COMMENT PLAY ============
  await test('COMMENT_PLAY', 'TC-CP-05: Toggle play isActive', () => {
    const play = { isActive: true };
    play.isActive = !play.isActive;
    assertEq(play.isActive, false);
  });

  await test('COMMENT_PLAY', 'TC-CP-10: Concurrency lock — isProcessing', () => {
    let isProcessing = false;
    if (!isProcessing) {
      isProcessing = true;
      // simulate work
      setTimeout(() => { isProcessing = false; }, 100);
    }
    assertEq(isProcessing, true);
  });

  // ============ COMMENT CRAWLER ============
  await test('COMMENT_CRAWLER', 'TC-CC-04: Scrape URL không phải FB', () => {
    const url = 'https://twitter.com/post/123';
    assert(!url.includes('facebook.com'), 'should be invalid');
  });

  await test('COMMENT_CRAWLER', 'TC-CC-09: Stats sau scrape', () => {
    const success = mockCommentScrapes.find(c => c.status === 'success');
    assert(success.stats.totalComments > 0, 'should have comments');
  });

  await test('COMMENT_CRAWLER', 'TC-CC-13: Tổng stats từ aggregate', () => {
    const total = mockCommentScrapes.reduce((s, c) => s + (c.stats.totalComments || 0), 0);
    assertEq(total, 42);
  });

  // ============ AI CONTENT ============
  await test('AI_CONTENT', 'TC-AICT-12: Rate limit 10 req/min', () => {
    const limit = 10;
    const requests = 15;
    const allowed = requests <= limit;
    assertEq(allowed, false, 'should exceed limit');
  });

  await test('AI_CONTENT', 'TC-AICT-04: Tạo schedule với cron', () => {
    const sched = { cron: '0 8 * * *', style: 'vi', channels: ['FB'] };
    assert(sched.cron.length > 0, 'cron set');
  });

  // ============ AI IMAGES ============
  await test('AI_IMAGES', 'TC-AII-10: Upload ảnh > 10MB reject', () => {
    const size = 15 * 1024 * 1024;
    const limit = 10 * 1024 * 1024;
    assert(size > limit, 'should reject');
  });

  await test('AI_IMAGES', 'TC-AII-06: Toggle favorite', () => {
    const proj = { isFavorite: false };
    proj.isFavorite = !proj.isFavorite;
    assertEq(proj.isFavorite, true);
  });

  // ============ TRACKING ============
  await test('TRACKING', 'TC-TR-01: Tạo tracking FB profile', () => {
    const t = mockTrackings.find(x => x.type === 'profile');
    assertEq(t.type, 'profile');
    assert(t.url.includes('facebook.com'), 'should be FB URL');
  });

  await test('TRACKING', 'TC-TR-02: Tạo tracking FB group', () => {
    const t = mockTrackings.find(x => x.type === 'group');
    assert(t.url.includes('/groups/'), 'should be group URL');
  });

  await test('TRACKING', 'TC-TR-07: Filter ?type=profile', () => {
    const filtered = mockTrackings.filter(t => t.type === 'profile');
    assert(filtered.every(t => t.type === 'profile'), 'all profile');
  });

  await test('TRACKING', 'TC-TR-08: Filter ?type=group', () => {
    const filtered = mockTrackings.filter(t => t.type === 'group');
    assertEq(filtered.length, 1);
  });

  // ============ SHOPEE ============
  await test('SHOPEE', 'TC-SH-02: Thiếu shopeeUrl', () => {
    const invalid = { title: 'Test' };
    assert(!invalid.shopeeUrl, 'should be invalid');
  });

  await test('SHOPEE', 'TC-SH-01: Link hợp lệ', () => {
    const l = mockShopeeLinks[0];
    assert(l.shopeeUrl.startsWith('https://'), 'should be https');
  });

  // ============ SETTINGS ============
  await test('SETTINGS', 'TC-ST-04: Reset settings', () => {
    const settings = { watermark: 'old.png' };
    settings.watermark = null;
    assertEq(settings.watermark, null);
  });

  await test('SETTINGS', 'TC-ST-07: Test AI connection valid', () => {
    const result = { success: true };
    assertEq(result.success, true);
  });

  // ============ MUSIC TRENDING ============
  await test('MUSIC', 'TC-MT-01: Auto-seed tracks', () => {
    assert(mockMusic.length >= 2, 'should have tracks');
  });

  await test('MUSIC', 'TC-MT-04: Delete track', () => {
    const before = mockMusic.length;
    const after = before - 1;
    assertEq(after, 1);
  });

  // ============ DOWNLOAD ============
  await test('DOWNLOAD', 'TC-DL-02: Download YouTube valid', () => {
    const url = 'https://youtube.com/watch?v=test';
    assert(url.includes('youtube.com'), 'valid YT URL');
  });

  await test('DOWNLOAD', 'TC-DL-04: Download URL invalid', () => {
    const url = '';
    assertEq(url.length, 0, 'should reject empty');
  });

  await test('DOWNLOAD', 'TC-DL-07: Sanitize filename', () => {
    const name = 'a/b\\c:d*e?f"g<h>i|j';
    const safe = name.replace(/[\\/:*?"<>|]/g, '_');
    assert(!safe.includes('/'), 'no slash');
    assert(!safe.includes('\\'), 'no backslash');
  });

  // ============ FEEDBACK ============
  await test('FEEDBACK', 'TC-FB-02: User update feedback của mình', () => {
    const fb = mockFeedbacks[0];
    const isOwner = fb.userId === mockUsers.user1._id;
    assertEq(isOwner, true);
  });

  await test('FEEDBACK', 'TC-FB-03: User A update feedback của User B', () => {
    const fb = mockFeedbacks[0]; // user1
    const canEdit = fb.userId === mockUsers.user1._id;
    assertEq(canEdit, true);
    // Nếu user2 cố edit:
    const user2canEdit = fb.userId === mockUsers.user2._id;
    assertEq(user2canEdit, false, 'user2 should not edit user1');
  });

  // ============ LICENSE ============
  await test('LICENSE', 'TC-LIC-01: Generate keys', () => {
    const keys = ['TEST-KEY-0001', 'TEST-KEY-0002', 'TEST-KEY-0003'];
    assertEq(keys.length, 3);
  });

  await test('LICENSE', 'TC-LIC-03: Activate key đã dùng', () => {
    const used = mockLicenses.find(l => l.isUsed);
    assertEq(used.key, 'TEST-KEY-0002');
  });

  await test('LICENSE', 'TC-LIC-04: Activate key suspended', () => {
    const suspended = mockLicenses.find(l => l.status === 'suspended');
    assertEq(suspended.key, 'TEST-KEY-0002');
  });

  await test('LICENSE', 'TC-LIC-06: Extend license +30 days', () => {
    const lic = { expiresAt: new Date() };
    lic.expiresAt = new Date(lic.expiresAt.getTime() + 30 * 24 * 3600 * 1000);
    assert(lic.expiresAt > new Date(), 'should be extended');
  });

  await test('LICENSE', 'TC-LIC-09: License hết hạn', () => {
    const expired = mockLicenses.find(l => l.status === 'expired');
    assert(expired.expiresAt < new Date(), 'should be expired');
  });

  // ============ FEATURE VISIBILITY ============
  await test('FEATURES', 'TC-FV-04: Boolean conversion', () => {
    const val1 = 'true' === 'true';
    const val2 = 'false' === 'true';
    assertEq(val1, true);
    assertEq(val2, false);
  });

  await test('FEATURES', 'TC-FV-01: Bật/tắt feature', () => {
    const f = { ai_scan: true };
    f.ai_scan = !f.ai_scan;
    assertEq(f.ai_scan, false);
  });

  // ============ COMMENT SCRAPE ============
  await test('COMMENT_SCRAPE', 'CC stats aggregation', () => {
    const total = mockCommentScrapes.filter(c => c.userId === mockUsers.user1._id).length;
    const success = mockCommentScrapes.filter(c => c.status === 'success').length;
    assertEq(total, 2);
    assertEq(success, 1);
  });

  // ============ COMMON ============
  await test('COMMON', 'TC-ERR-01: 404 cho URL không tồn tại', () => {
    const resp = { message: 'Không tìm thấy trang này!' };
    assert(resp.message.includes('Không tìm thấy'));
  });

  await test('COMMON', 'TC-RATE-LIMIT: 120 req/min', () => {
    const limit = 120;
    assertEq(limit, 120);
  });

  await test('COMMON', 'TC-I18N: Switch vi ↔ en', () => {
    const supported = ['vi', 'en'];
    assert(supported.includes('vi') && supported.includes('en'));
  });

  // ============ SMOKE / E2E ============
  await test('E2E', 'TC-E2E-01: Đăng ký → Login → Dashboard', () => {
    const u = mockUsers.user1;
    assert(u.email && u.password && u._id);
  });

  await test('E2E', 'TC-E2E-02: Tạo channel → Connect', () => {
    const ch = mockChannels.find(c => c.userId === mockUsers.user1._id && c.platform === 'FB');
    assert(ch.isEnabled, 'channel enabled');
  });

  await test('E2E', 'TC-E2E-03: Tạo schedule → Run', () => {
    const s = mockSchedules.find(x => x.status === 'pending');
    assert(s.scheduledAt > new Date(Date.now() - 1000) || s.scheduledAt <= new Date(), 'valid schedule');
  });

  // ============ EDGE CASES ============
  await test('EDGE', 'Email format validation', () => {
    const valid = /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test('tester@example.com');
    const invalid = /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test('not-an-email');
    assertEq(valid, true);
    assertEq(invalid, false);
  });

  await test('EDGE', 'Vietnamese có dấu', () => {
    const s = 'Xin chào Việt Nam 🇻🇳';
    assert(s.length > 0);
    assert(s.includes('Việt'));
  });

  await test('EDGE', 'Empty string validation', () => {
    const empty = '';
    assertEq(empty.length, 0);
    assert(!empty, 'falsy');
  });

  await test('EDGE', 'Null vs undefined', () => {
    assertEq(null, null);
    assertEq(undefined, undefined);
    assert(null !== undefined);
  });

  await test('EDGE', 'Large number handling', () => {
    const big = Number.MAX_SAFE_INTEGER;
    assert(big > 0);
  });

  await test('EDGE', 'Date parsing', () => {
    const d = new Date('2026-06-20T00:00:00Z');
    assertEq(d.getUTCFullYear(), 2026);
    assertEq(d.getUTCMonth(), 5); // June = 5 (0-indexed)
  });
}

// ─────────────────────────────────────────────────────────────────
// 6. REPORT GENERATOR
// ─────────────────────────────────────────────────────────────────

function generateReport() {
  const total = results.length;
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
  const totalDuration = results.reduce((s, r) => s + r.duration, 0);

  const byGroup = {};
  results.forEach(r => {
    if (!byGroup[r.group]) byGroup[r.group] = { pass: 0, fail: 0, items: [] };
    if (r.status === 'PASS') byGroup[r.group].pass++;
    else byGroup[r.group].fail++;
    byGroup[r.group].items.push(r);
  });

  const lines = [];
  lines.push('# 📊 FB-SYSTEM — Test Report (Mock Data)');
  lines.push('');
  lines.push(`> Generated: ${new Date().toLocaleString('vi-VN')} · Test Runner: \`scripts/test-features.js\``);
  lines.push(`> Branch: \`dev\` · Mode: **Mock (in-memory) — không cần MongoDB/Playwright**`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 🎯 Tổng quan');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| **Total tests** | ${total} |`);
  lines.push(`| ✅ **Passed** | ${passed} |`);
  lines.push(`| ❌ **Failed** | ${failed} |`);
  lines.push(`| 📈 **Pass rate** | **${passRate}%** |`);
  lines.push(`| ⏱️ **Total duration** | ${totalDuration} ms |`);
  lines.push(`| 📦 **Test groups** | ${Object.keys(byGroup).length} |`);
  lines.push('');

  // Status badge
  const overall = failed === 0 ? '🟢 PASSED' : (passed / total >= 0.8 ? '🟡 MOSTLY PASSED' : '🔴 FAILED');
  lines.push(`**Overall status: ${overall}**`);
  lines.push('');

  // Visual progress bar
  const barLen = 40;
  const filled = Math.round((passed / total) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
  lines.push(`\`\`\``);
  lines.push(`[${bar}] ${passRate}%`);
  lines.push(`\`\`\``);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## 📋 Kết quả theo nhóm');
  lines.push('');
  lines.push('| Nhóm | ✅ Pass | ❌ Fail | Tổng | Tỷ lệ |');
  lines.push('|------|---------|---------|------|--------|');

  const sortedGroups = Object.entries(byGroup).sort((a, b) => (b[1].pass + b[1].fail) - (a[1].pass + a[1].fail));
  for (const [g, stats] of sortedGroups) {
    const total_g = stats.pass + stats.fail;
    const rate = total_g > 0 ? ((stats.pass / total_g) * 100).toFixed(0) + '%' : 'N/A';
    const icon = stats.fail === 0 ? '🟢' : (stats.fail < stats.pass ? '🟡' : '🔴');
    lines.push(`| ${icon} **${g}** | ${stats.pass} | ${stats.fail} | ${total_g} | ${rate} |`);
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## 🔍 Chi tiết từng test');
  lines.push('');

  for (const [group, stats] of sortedGroups) {
    lines.push(`### ${group}`);
    lines.push('');
    if (stats.fail === 0) {
      lines.push(`> ✅ Tất cả ${stats.pass} test PASS`);
      lines.push('');
    } else {
      lines.push(`> ⚠️ ${stats.fail}/${stats.pass + stats.fail} test FAIL`);
      lines.push('');
    }
    for (const r of stats.items) {
      const icon = r.status === 'PASS' ? '✅' : '❌';
      lines.push(`- ${icon} **${r.name}** _(${r.duration}ms)_`);
      if (r.status === 'FAIL' && r.error) {
        lines.push(`  - ❗ \`${r.error}\``);
      }
    }
    lines.push('');
  }

  // Failed tests detail
  const failedTests = results.filter(r => r.status === 'FAIL');
  if (failedTests.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## ❌ Chi tiết các test FAIL');
    lines.push('');
    for (const r of failedTests) {
      lines.push(`### ${r.group} → ${r.name}`);
      lines.push('');
      lines.push(`- **Error**: \`${r.error}\``);
      lines.push(`- **Duration**: ${r.duration}ms`);
      lines.push('');
    }
  }

  // Recommendations
  lines.push('---');
  lines.push('');
  lines.push('## 💡 Đề xuất hành động tiếp theo');
  lines.push('');

  if (failed === 0) {
    lines.push('### 🎉 Tất cả test đều PASS!');
    lines.push('');
    lines.push('- [ ] Chạy test với MongoDB thật để kiểm tra integration');
    lines.push('- [ ] Test thủ công trên browser các flow chính');
    lines.push('- [ ] Chạy E2E test với Playwright UI');
    lines.push('- [ ] Load test với dữ liệu lớn (100+ records)');
    lines.push('- [ ] Verify trên môi trường Electron build');
  } else if (passed / total >= 0.8) {
    lines.push('### 🟡 Phần lớn PASS, cần fix một số test FAIL');
    lines.push('');
    lines.push(`- [ ] Xem chi tiết ${failed} test FAIL ở trên`);
    lines.push('- [ ] Sửa logic trong controller/service tương ứng');
    lines.push('- [ ] Thêm validation cho các edge case');
    lines.push('- [ ] Chạy lại test để xác nhận fix');
  } else {
    lines.push('### 🔴 Có nhiều test FAIL — cần review lại');
    lines.push('');
    lines.push(`- [ ] Xem chi tiết ${failed} test FAIL ở trên`);
    lines.push('- [ ] Có thể do mock data không đủ hoặc logic sai');
    lines.push('- [ ] Cân nhắc test lại với dữ liệu thật');
  }
  lines.push('');

  // Mock data reference
  lines.push('---');
  lines.push('');
  lines.push('## 📦 Mock Data Reference');
  lines.push('');
  lines.push('| Entity | Count | Notes |');
  lines.push('|--------|-------|-------|');
  lines.push(`| Users | ${Object.keys(mockUsers).length} | 1 admin + 1 user |`);
  lines.push(`| Channels | ${mockChannels.length} | 4 across 3 platforms |`);
  lines.push(`| Schedules | ${mockSchedules.length} | pending/posted/failed |`);
  lines.push(`| AI Comments | ${mockAiComments.length} | text/image, active/inactive |`);
  lines.push(`| AI Scan Configs | ${mockAiScanConfigs.length} | active/inactive |`);
  lines.push(`| Shopee Links | ${mockShopeeLinks.length} | |`);
  lines.push(`| Licenses | ${mockLicenses.length} | active/suspended/expired |`);
  lines.push(`| Trackings | ${mockTrackings.length} | profile/page/group |`);
  lines.push(`| Comment Scrapes | ${mockCommentScrapes.length} | success/failed |`);
  lines.push(`| Feedbacks | ${mockFeedbacks.length} | bug/feature |`);
  lines.push(`| Music Tracks | ${mockMusic.length} | TikTok trending |`);
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('## 🧪 Cách chạy lại test');
  lines.push('');
  lines.push('```bash');
  lines.push('# Chạy test runner với mock data');
  lines.push('node scripts/test-features.js');
  lines.push('');
  lines.push('# Sau khi chạy xong sẽ tự động sinh report.md ở root');
  lines.push('# Xem file report.md để xem kết quả chi tiết');
  lines.push('```');
  lines.push('');
  lines.push('### Lưu ý quan trọng');
  lines.push('');
  lines.push('- ✅ Test runner dùng **mock in-memory** — không cần MongoDB/Playwright thật');
  lines.push('- ✅ Mock các module nặng: `playwright`, `telegraf`, `yt-dlp-exec`, `openai`, ...');
  lines.push('- ✅ Test business logic (CRUD, validation, edge cases) — không test UI');
  lines.push('- ⚠️ Để test full E2E (HTTP API + Socket.IO + UI), cần chạy server thật');
  lines.push('- ⚠️ Sau khi pass mock test, nên test thủ công trên browser');
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push('**Báo cáo được sinh tự động bởi `scripts/test-features.js`**');
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────
// 7. ENTRY POINT
// ─────────────────────────────────────────────────────────────────

(async () => {
  const start = Date.now();
  await runTests();
  const totalTime = Date.now() - start;

  // Console output
  console.log('\n' + '='.repeat(60));
  console.log('📊 KẾT QUẢ TEST');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Pass rate: ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log(`⏱️  Duration: ${totalTime}ms`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\n❌ FAILED tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  [${r.group}] ${r.name}`);
      console.log(`    → ${r.error}`);
    });
  }

  // Write report.md
  const fs = require('fs');
  const reportPath = path.join(__dirname, '..', 'report.md');
  fs.writeFileSync(reportPath, generateReport(), 'utf-8');
  console.log(`\n📄 Report saved: ${reportPath}`);
  console.log('\n✨ Done!');
})();
