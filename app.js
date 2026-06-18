// app.js
const path = require('path');
const fs = require('fs');

// Load .env từ thư mục app (quan trọng khi chạy qua Electron build)
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Xác định thư mục gốc dữ liệu người dùng
// Khi chạy qua Electron build, dùng USER_DATA_DIR để đảm bảo có quyền ghi
// Khi dev (nodemon), dùng thư mục project hiện tại
const USER_DATA_DIR = process.env.USER_DATA_DIR || __dirname;
global.USER_DATA_DIR = USER_DATA_DIR;

// Tạo các thư mục nếu chưa tồn tại
const ensureDirectories = [
    '', 'uploads', 'uploads/ai-images', 'uploads/avatars', 'uploads/competitor-posts',
    'uploads/crypto-keys', 'uploads/images', 'uploads/video-projects',
    'uploads/videos', 'page_post', 'page_post/PANZI',
    'social-sessions', 'views/fb_session', 'public/music', 'public/output'
];
ensureDirectories.forEach(dir => {
    const fullPath = path.join(USER_DATA_DIR, dir);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
});

// Tắt console.log toàn bộ hệ thống (trừ lỗi)
const isSilent = process.env.SILENT_MODE === 'true' || process.env.NODE_ENV === 'production';
if (isSilent) {
    console.log = () => {};
    console.warn = () => {};
    console.info = () => {};
} else {
    // Giữ lại console.log nhưng tắt debug không cần thiết
    const originalLog = console.log;
    console.log = (...args) => {
        const msg = args.map(a => { try { if (typeof a === 'string') return a; if (a && a.message) return a.message; if (a && a.stack) return a.stack; return JSON.stringify(a); } catch(e) { return '[Object]'; } }).join(' ');
        // Chỉ hiển thị log có prefix quan trọng, ẩn debug
        if (msg.includes('[ERROR]') || msg.includes('[Error]') || msg.includes('Error:') || 
            msg.includes('❌') || msg.includes('✅') || msg.includes('🚀') ||
            msg.includes('[Socket.IO]') || msg.includes('[Schedule Runner]') ||
            msg.includes('[IG Upload]') || msg.includes('[TikTok Upload]') ||
            msg.includes('[Reels Upload]') || msg.includes('[FB Connect]') ||
            msg.includes('[Post Upload]') || msg.includes('[Crawl]') ||
            msg.includes('[Full Scan]') || msg.includes('[AI]') ||
            msg.includes('[Scheduler]') || msg.includes('[Comment]') ||
            msg.includes('[CommentPlay]') || msg.includes('[Competitor Service]') || msg.includes('[AI Image]') || msg.includes('[Download API]') || msg.includes('BAT DAU CHAY PLAY') ||
            msg.includes('KET QUA:') || msg.includes('step=') ||
            msg.includes('[Profile Scraper]') ||
            msg.includes('[Scrape]') ||
            msg.includes('[Download] ') ||
            msg.includes('#####')) {
            originalLog(...args);
        }
    };
}

const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import Routes
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const channelRoutes = require('./routes/channels');
const shopeeRoutes = require('./routes/shopee');
const scheduleRoutes = require('./routes/schedule');
const settingsRoutes = require('./routes/settings');
const storageRoutes = require('./routes/storage');
const featureRoutes = require('./routes/features');
const commentPlayRoutes = require('./routes/commentPlay');
const aiImageRoutes = require('./routes/aiImages');
const licenseRoutes = require('./routes/licenses');
const musicTrendingRoutes = require('./routes/musicTrending');
const aiContentRoutes = require('./routes/aiContent');
const feedbackRoutes = require('./routes/feedback');
const { rateLimiter } = require('./middlewares/rateLimiter');
const { loadFeatureVisibility } = require('./middlewares/authMiddleware');
const { loadUserChannels } = require('./middlewares/channelMiddleware');
const { startReelsScheduleRunner } = require('./services/reelsScheduleRunner');
const { startAutoContentRunner } = require('./services/autoContentRunner');
const { runScheduledScans } = require('./services/aiScanService');
const i18nMiddleware = require('./middlewares/i18nMiddleware');
const http = require('http');
const { Server } = require('socket.io');
const { emitScheduleUpdate } = require('./services/socketService');
global.emitScheduleUpdate = emitScheduleUpdate;

const app = express();

// Static files - disable cache during development
app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
}));
// Static files từ USER_DATA_DIR (cho uploads) và từ app gốc (cho public)
app.use('/uploads', express.static(path.join(USER_DATA_DIR, 'uploads')));

// Security & Middleware
app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
                scriptSrcAttr: ["'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "blob:", "https://images.unsplash.com", "https://oaiusercontent.com"],
                mediaSrc: ["'self'", "blob:", "https://assets.mixkit.co"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com", "data:"],
                connectSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "ws:", "wss:"],
            },
        },
    })
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Cookie parser for remember-me authentication
app.use(require('cookie-parser')(process.env.COOKIE_SECRET || process.env.SESSION_SECRET || 'keyboard cat'));

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 30,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Flash message middleware — make flash data available to all routes
app.use((req, res, next) => {
    if (req.session?.flash) {
        res.locals.flash = req.session.flash;
        delete req.session.flash;
    }
    next();
});

// ========================
// ROUTING
// ========================

// Apply feature visibility globally (after auth but before regular routes)
app.use(loadFeatureVisibility);         // Load feature visibility settings for sidebar
app.use(loadUserChannels);              // Load user channels for sidebar dropdown
app.use(i18nMiddleware);                 // Inject t() and lang into all views

// Rate limiter for API routes
app.use(rateLimiter(120, 60000));       // 120 requests/minute per user/IP

app.use('/auth', authRoutes);           // Auth: login, register, forgot, profile, change-password
app.use('/dashboard', dashboardRoutes); // Dashboard
app.use('/channels', channelRoutes);    // Quản lý kênh + API
app.use('/shopee', shopeeRoutes);       // Shopee Links + API
app.use('/schedule', scheduleRoutes);   // Lịch đăng Post & Reels + API
app.use('/settings', settingsRoutes);   // Cấu hình + API
app.use('/storage', storageRoutes);     // Lưu trữ Google Drive + API
app.use('/features', featureRoutes);    // Quản lý tính năng (Admin only)
app.use('/schedule/ai-comment/play', commentPlayRoutes); // Khúc Play Comment
app.use('/ai-images', aiImageRoutes);              // Tạo Ảnh AI
app.use('/admin/licenses', licenseRoutes);        // License Key Management
app.use('/music-trending', musicTrendingRoutes);  // Music Trending
app.use('/download', require('./routes/download')); // Download YouTube video/audio
app.use('/ai-content', aiContentRoutes);           // AI Content Creator + Auto Pipeline
app.use('/feedback', feedbackRoutes);              // Feedback & Feature Requests
app.use('/tracking', require('./routes/tracking')); // Theo dõi đối tượng

// Route mặc định - Chuyển hướng đến trang đăng nhập
app.get('/', (req, res) => {
    res.redirect('/auth/login');
});

// 404
app.use((req, res) => {
    res.status(404).json({ message: 'Không tìm thấy trang này!' });
});

// Start Server with Socket.IO - Xử lý port bận, tự động tìm port khác
const DEFAULT_PORT = process.env.PORT || 4000;
let PORT = DEFAULT_PORT;

function startServer(port) {
    const server = http.createServer(app);
    const io = new Server(server, {
        cors: { origin: '*', methods: ['GET', 'POST'] }
    });
    require('./services/socketService')(io);

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${port} đã được sử dụng, thử port ${port + 1}`);
            startServer(port + 1);
        } else {
            console.error('❌ Lỗi server:', err);
        }
    });

    server.listen(port, () => {
        PORT = port;
        // Cập nhật global.SERVER_URL để các module khác dùng
        global.SERVER_URL = `http://localhost:${port}`;
        console.log(`🚀 Server đang lắng nghe tại port: ${global.SERVER_URL}`);
    });

    return server;
}

// Khởi động server trước (routes đã được định nghĩa ở trên)
const server = startServer(DEFAULT_PORT);

// Sau đó kết nối MongoDB - scheduler sẽ được khởi động sau khi kết nối thành công
// QUAN TRỌNG: global.mongoConnected được set trong callback, không phải đồng bộ
const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/reelsflow';
global.mongoConnected = false;

// Track scheduled intervals so we can clear them on disconnect
const schedulerIntervals = [];

function clearAllSchedulers() {
    schedulerIntervals.forEach(clearInterval);
    schedulerIntervals.length = 0;
    console.log('[Scheduler] Đã dọn dẹp tất cả scheduler intervals');
}

function startSchedulers() {
    if (global.mongoConnected !== true) return;
    console.log('[Scheduler] Khởi động tất cả schedulers...');

    // === KHỞI ĐỘNG SCHEDULER SAU KHI CÓ DB ===
    try { startReelsScheduleRunner(); } catch(e) { console.error('[Startup] Reels schedule runner error:', e.message); }
    try { startAutoContentRunner(); } catch(e) { console.error('[Startup] Auto content runner error:', e.message); }

    // AI Scan scheduler
    schedulerIntervals.push(setInterval(() => {
        if (!global.mongoConnected) return;
        runScheduledScans().then(results => {
            if (results && results.length > 0) {
                console.log(`[AI Scan Scheduler] Đã xử lý ${results.length} cấu hình`);
            }
        }).catch(err => {
            console.error('[AI Scan Scheduler] Error:', err.message);
        });
    }, 30 * 1000));
    console.log('[AI Scan Scheduler] Đã khởi động scheduler (kiểm tra mỗi 30 giây)');

    // Comment Play scheduler
    schedulerIntervals.push(setInterval(() => {
        if (!global.mongoConnected) return;
        try {
            const commentPlayService = require('./services/commentPlayService');
            commentPlayService.processScheduledPlays().then(results => {
                if (results.length > 0) {
                    console.log(`[CommentPlay Scheduler] Đã xử lý ${results.length} kịch bản`);
                }
            }).catch(err => {
                console.error('[CommentPlay Scheduler] Error:', err.message);
            });
        } catch(e) {
            console.error('[CommentPlay Scheduler] Error:', e.message);
        }
    }, 30 * 1000));
    console.log('[CommentPlay Scheduler] Đã khởi động scheduler (kiểm tra mỗi 30 giây)');

    // AI Content Creator scheduler - tạo bài viết theo lịch
    schedulerIntervals.push(setInterval(() => {
        if (!global.mongoConnected) return;
        try {
            const aiContentService = require('./services/aiContentService');
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) return;
            aiContentService.processActiveSchedules(apiKey).then(count => {
                if (count > 0) {
                    console.log(`✅ [AI Content Scheduler] Đã tạo ${count} bài viết mới`);
                }
            }).catch(err => {
                console.error('[AI Content Scheduler] Error:', err.message);
            });
        } catch(e) {
            console.error('[AI Content Scheduler] Error:', e.message);
        }
    }, 60 * 1000));
    console.log('[AI Content Scheduler] Đã khởi động scheduler (kiểm tra mỗi 60 giây)');

    // AI Content Auto-Retrain - train lại văn phong từ bài viết tốt nhất
    schedulerIntervals.push(setInterval(() => {
        if (!global.mongoConnected) return;
        try {
            const aiContentService = require('./services/aiContentService');
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) return;
            aiContentService.autoRetrainLoop(apiKey).then(count => {
                if (count > 0) {
                    console.log(`🧠 [AI Auto-Retrain] Đã train lại ${count} văn phong`);
                }
            }).catch(err => {
                console.error('[AI Auto-Retrain] Error:', err.message);
            });
        } catch(e) {
            console.error('[AI Auto-Retrain] Error:', e.message);
        }
    }, 30 * 60 * 1000)); // Kiểm tra mỗi 30 phút
    console.log('[AI Auto-Retrain] Đã khởi động scheduler (kiểm tra mỗi 30 phút)');
}

mongoose.connect(DB_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
})
.then(() => {
    global.mongoConnected = true;
    console.log('✅ Đã kết nối thành công tới MongoDB');
    startSchedulers();
})
.catch(err => {
    console.error('❌ Lỗi kết nối MongoDB:', err.message);
    console.error('⚠️ App sẽ chạy nhưng không có database - một số tính năng sẽ không hoạt động');
    // global.mongoConnected vẫn là false, scheduler sẽ không khởi động
});

// Monitor MongoDB connection events and cleanup/re-create schedulers
const db = mongoose.connection;
db.on('disconnected', () => {
    global.mongoConnected = false;
    console.log('⚠️ MongoDB mất kết nối - dừng tất cả schedulers');
    clearAllSchedulers();
});
db.on('reconnected', () => {
    global.mongoConnected = true;
    console.log('✅ MongoDB đã kết nối lại - khởi động lại schedulers');
    startSchedulers();
});
db.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err.message);
});
