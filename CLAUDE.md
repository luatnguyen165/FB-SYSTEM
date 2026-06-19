# FB-SYSTEM

Facebook Automation Desktop App - Quản lý fanpage, đăng bài, comment, crawl data.

## Tech Stack

- **Backend**: Express.js (v5) + EJS views
- **Database**: MongoDB (Mongoose v9)
- **Desktop**: Electron (v42)
- **Automation**: Playwright + puppeteer-extra-plugin-stealth
- **AI**: OpenAI API
- **Media**: ffmpeg (fluent-ffmpeg), sharp, yt-dlp
- **Realtime**: Socket.IO
- **Bot**: Telegraf (Telegram)
- **Auth**: JWT + bcryptjs + express-session

## Project Structure

```
app.js                    # Express app entry point
electron/main.js          # Electron main process
controllers/              # Route handlers
services/                 # Business logic (facebook/, aiScan/, common/)
models/                   # Mongoose schemas
routes/                   # Express routes (mounted in app.js)
middlewares/              # auth, validation, rate-limit, upload, i18n
views/                    # EJS templates
public/                   # Static assets (CSS, JS, images)
utils/                    # Helpers (aiConfig, cryptoVault, facebookUrlUtils)
locales/                  # i18n translations
page_post/                # Post data storage
social-sessions/          # Browser session data
chrome-profiles/          # Playwright browser profiles
```

## Key Services

- `services/facebook/` - Facebook API interactions
- `services/facebookGraphqlScraper.js` - GraphQL data scraping
- `services/facebookProfileScraper.js` - Profile scraping
- `services/facebookGroupScraper.js` - Group scraping
- `services/instagramPlaywrightService.js` - Instagram automation
- `services/tiktokPlaywrightService.js` - TikTok automation
- `services/aiContentService.js` - AI content generation
- `services/aiImageService.js` - AI image generation
- `services/commentPlayService.js` - Auto comment
- `services/autoContentRunner.js` - Auto content pipeline
- `services/reelsScheduleRunner.js` - Reels scheduling
- `services/telegramService.js` - Telegram bot notifications

## Conventions

- Language: JavaScript (CommonJS `require`), không dùng TypeScript
- View engine: EJS with express-ejs-layouts
- Vietnamese comments trong code
- Log prefix: `[ERROR]`, `[Crawl]`, `[AI]`, `[Scheduler]`, `[Socket.IO]`, etc.
- Environment: `.env` file (dotenv)
- Silent mode: `SILENT_MODE=true` tắt console.log

## Run Commands

```bash
npm run dev              # Nodemon dev server
npm run electron-dev     # Electron dev mode
npm run electron-start   # Electron production
npm run build            # Build Windows installer (electron-builder)
```

## Common Patterns

- Controllers gọi services, services xử lý logic
- Socket.IO emit events cho real-time updates
- Playwright chạy browser automation với stealth plugin
- Upload files qua multer → `uploads/` directory
- MongoDB connection string trong `.env` (MONGODB_URI)

## API Routes

| Prefix | Controller | Chức năng |
|--------|-----------|-----------|
| `/auth` | authController | Login, register, forgot password, profile |
| `/dashboard` | dashboardController | Dashboard tổng quan |
| `/channels` | channelController | Quản lý kênh (FB, IG, TikTok, YouTube) |
| `/schedule` | scheduleController | Lịch đăng bài & reels |
| `/schedule/ai-comment/play` | commentPlayController | Auto comment |
| `/settings` | settingsController | Cấu hình hệ thống |
| `/storage` | storageController | Lưu trữ Google Drive |
| `/features` | featureController | Quản lý tính năng (Admin) |
| `/ai-images` | aiImageController | Tạo ảnh AI |
| `/ai-content` | aiContentController | AI Content Creator + Auto Pipeline |
| `/admin/licenses` | licenseController | License key management |
| `/music-trending` | musicTrendingController | Music trending |
| `/download` | downloadController | Download YouTube video/audio |
| `/feedback` | feedbackController | Feedback & feature requests |
| `/tracking` | trackingController | Theo dõi đối tượng (profile/page/group) |
| `/shopee` | shopeeController | Shopee links |

## MongoDB Models (25 models)

- **User**: User account, auth, license
- **Channel**: Kênh social (FB, IG, TikTok, YouTube)
- **SchedulePost**: Lịch đăng bài/reels
- **CommentPlay / CommentPlayLog**: Auto comment config & logs
- **AiScanConfig / AiScanResult**: AI scan configuration & results
- **AiComment**: AI comment settings
- **AiImage / AiGeneratedPost**: AI generated content
- **AiContentSchedule / AutoContentPipeline**: Auto content pipeline
- **Tracking / TrackingPost**: Theo dõi đối tượng & posts
- **Video**: Video metadata
- **Product / ShopeeLink**: Sản phẩm & Shopee links
- **MusicTrending**: Music trending data
- **WritingStyle / ContentTrainingLog**: Style writing & training
- **FacebookGroupCache**: Cache group data
- **FeatureVisibility**: Feature toggle (Admin)
- **LicenseKey**: License keys
- **Feedback**: User feedback
- **Settings**: System settings

## Environment Variables (.env)

```
PORT=4000                    # Server port
MONGODB_URI                  # MongoDB connection string
JWT_SECRET                   # JWT signing key
SESSION_SECRET               # Express session secret
COOKIE_SECRET                # Cookie parser secret
OPENAI_API_KEY               # OpenAI API key
SERVER_ADMIN_URL             # Admin server URL
SILENT_MODE                  # true = tắt console.log
USER_DATA_DIR                # Thư mục dữ liệu (Electron build)
VITE_API_URL                 # Frontend API URL
```

## Socket.IO Events

- `schedule:update` - Cập nhật lịch trình real-time
- Các service emit events qua `global.emitScheduleUpdate`

## Facebook URL Patterns

```
profile.php?id=123456        → Profile by ID
/username/                   → Profile/Page by username
/pages/Page-Name/123456      → Page by name+ID
/groups/123456/              → Group by ID
/groups/groupname/           → Group by name
```

## EJS Views Pattern

- Views trong `views/*.ejs`
- Partials trong `views/partials/`
- Layout dùng `express-ejs-layouts`
- Flash messages: `res.locals.flash`
- i18n: `t('key')` function + `lang` variable

## Notes

- Project dùng cả CommonJS (backend) và ES modules (frontend React)
- `global.USER_DATA_DIR` xác định thư mục gốc dữ liệu
- Electron build output: `release/` directory
- Rate limit: 120 requests/phút/IP
- Session maxAge: 30 ngày
- Không commit: `node_modules/`, `uploads/`, `social-sessions/`, `chrome-profiles/`, `.env`
