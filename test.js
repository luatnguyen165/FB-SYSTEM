const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Hàm xử lý chuẩn hóa bộ cookie từ yt-dlp sang định dạng Playwright
function parseCookiesTxt(filePath) {
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️ Không tìm thấy file cookie tại: ${filePath}`);
        return [];
    }
    const cookieText = fs.readFileSync(filePath, 'utf-8');
    const lines = cookieText.split('\n');
    const cookies = [];

    lines.forEach(line => {
        if (!line.trim() || line.startsWith('#')) return;
        const parts = line.split('\t');
        if (parts.length >= 7) {
            let domain = parts[0].trim();
            
            if (domain.startsWith('.')) {
                domain = domain.substring(1);
            }

            cookies.push({
                name: parts[5].trim(),
                value: parts[6].trim().replace(/\r|\n/g, ''),
                domain: domain,
                path: parts[2].trim(),
                secure: parts[3].trim() === 'TRUE',
                expires: parseInt(parts[4].trim()) || -1,
                httpOnly: false
            });
        }
    });
    return cookies;
}

// Hàm parse số (vd: "1.2M" -> 1200000, "50K" -> 50000)
function parseCount(text) {
    if (!text) return 0;
    const str = text.trim().toUpperCase();
    if (str.includes('M')) return parseFloat(str) * 1000000;
    if (str.includes('K')) return parseFloat(str) * 1000;
    return parseInt(str.replace(/[^0-9]/g, '')) || 0;
}

(async () => {
    const cookiePath = path.join(__dirname, 'cookies.txt');

    // ============================================================
    // BƯỚC 1: KIỂM TRA FILE COOKIES
    // ============================================================
    console.log('🧭 Kiểm tra file cookies.txt...');

    if (!fs.existsSync(cookiePath)) {
        console.log('\n❌ Không tìm thấy file cookies.txt.');
        console.log('👉 Hãy mở Chrome của bạn, vào TikTok.com (đã đăng nhập), dùng extension "Get cookies.txt"');
        console.log('   hoặc "cookies.txt" để export cookies về file cookies.txt trong thư mục này.');
        console.log('   Sau đó chạy lại script.\n');
        console.log('   Link extension: https://chromewebstore.google.com/detail/get-cookiestxt/bgaddhkoddajcdgocldbbfleckgcbcid');
        process.exit(1);
    }

    const stats = fs.statSync(cookiePath);
    if (stats.size < 100) {
        console.log(`\n❌ File cookies.txt quá nhỏ (${stats.size} bytes). Cookies có thể không hợp lệ.`);
        console.log('👉 Hãy export lại cookies mới từ Chrome.');
        process.exit(1);
    }

    console.log(`✅ Đã tìm thấy cookies.txt (${stats.size} bytes).`);

    // ============================================================
    // BƯỚC 2: MỞ PLAYWRIGHT VỚI COOKIES ĐÃ LẤY ĐƯỢC
    // ============================================================
    console.log('🧭 Đang mở Playwright với cookies TikTok...');

    const context = await chromium.launchPersistentContext(
        path.join(os.tmpdir(), 'tiktok-profile-' + Date.now()),
        {
            headless: false,
            channel: 'chrome',
            args: [
                '--start-maximized',
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--no-default-browser-check'
            ],
            viewport: null,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        }
    );

    const page = await context.newPage();

    try {
        // Nạp cookies vào context
        const cookies = parseCookiesTxt(cookiePath);
        if (cookies.length > 0) {
            console.log(`Đang nạp ${cookies.length} cookies vào Playwright...`);
            await context.addCookies(cookies);
        }

        console.log('Đang truy cập TikTok...');
        await page.goto('https://www.tiktok.com/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Kiểm tra đã login chưa
        const isLoggedIn = await page.evaluate(() => {
            return !!document.querySelector('[data-e2e="user-avatar"], [data-e2e="nav-profile"]');
        });

        if (!isLoggedIn) {
            console.log('⚠️ Cookies có vẻ hết hạn. Vui lòng export lại cookies mới từ Chrome và thử lại.');
            await page.waitForTimeout(5000);
            await context.close();
            process.exit(1);
        }

        console.log('✅ Đã đăng nhập thành công qua cookies!');

        // ============================================================
        // BƯỚC 3: TÌM VIDEO #TRENDING VỚI LƯỢT TƯƠNG TÁC CAO
        // ============================================================
        console.log('🔍 Tìm kiếm video hashtag #trending...');
        
        // Tìm kiếm hashtag #trending
        await page.goto('https://www.tiktok.com/search?q=%23trending', { waitUntil: 'networkidle', timeout: 30000 });
        console.log('Đã điều hướng đến trang tìm kiếm #trending...');
        await page.waitForTimeout(3000);

        console.log('Đang chờ trang kết quả tìm kiếm tải xong...');
        const videoLinkSelector = 'a[href*="/video/"]';
        await page.waitForSelector(videoLinkSelector, { timeout: 20000 });

        console.log('Cuộn trang nhẹ xuống để kích hoạt load thêm dữ liệu...');
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(2500);

        console.log('Đang lấy danh sách link video...');
        const allLinks = await page.$$eval(videoLinkSelector, elements => elements.map(el => el.href));
        const uniqueLinks = [...new Set(allLinks)];
        console.log(`Tổng cộng ${uniqueLinks.length} link video tìm thấy.`);

        // === BƯỚC 4: LẤY LƯỢT TIM & COMMENT TỪNG VIDEO ===
        console.log('\n❤️ Đang kiểm tra lượt tim & comment từng video...');
        const videoStats = [];

        for (let i = 0; i < uniqueLinks.length && videoStats.length < 10; i++) {
            const link = uniqueLinks[i];
            try {
                const username = link.split('/@')[1]?.split('/')[0] || 'unknown';
                console.log(`  [${i + 1}/${uniqueLinks.length}] @${username}...`);
                await page.goto(link, { waitUntil: 'networkidle', timeout: 20000 });
                await page.waitForTimeout(2000);

                // Lấy lượt tim và comment
                const stats = await page.evaluate(() => {
                    // Lấy lượt tim
                    const likeEl = document.querySelector('[data-e2e="like-count"], [data-e2e="video-count"]');
                    const likeText = likeEl ? likeEl.textContent.trim() : '0';

                    // Lấy lượt comment
                    const commentEl = document.querySelector('[data-e2e="comment-count"]');
                    const commentText = commentEl ? commentEl.textContent.trim() : '0';

                    // Lấy title từ meta
                    const titleMeta = document.querySelector('meta[property="og:title"]');
                    const title = titleMeta ? titleMeta.content : '';

                    // Lấy description có hashtags
                    const descMeta = document.querySelector('meta[property="og:description"]');
                    const description = descMeta ? descMeta.content : '';

                    // Lấy thời gian đăng
                    const publishEl = document.querySelector('[data-e2e="video-publish-time"]');
                    const publishTime = publishEl ? publishEl.textContent.trim() : '';

                    return { likeText, commentText, title, description, publishTime };
                });

                const likeCount = parseCount(stats.likeText);
                const commentCount = parseCount(stats.commentText);

                console.log(`    ❤️ ${stats.likeText}  💬 ${stats.commentText}  🕐 ${stats.publishTime || 'N/A'}`);

                videoStats.push({
                    url: link,
                    username,
                    likes: likeCount,
                    comments: commentCount,
                    likeText: stats.likeText,
                    commentText: stats.commentText,
                    title: stats.title,
                    publishTime: stats.publishTime
                });
            } catch (err) {
                console.log(`    ⚠️ Lỗi: ${err.message.slice(0, 80)}`);
            }
        }

        // Sắp xếp: ưu tiên lượt tim cao, sau đó comment cao
        videoStats.sort((a, b) => {
            if (b.likes !== a.likes) return b.likes - a.likes;
            return b.comments - a.comments;
        });

        console.log(`\n=========================================================`);
        console.log(`   TOP ${videoStats.length} VIDEO #TRENDING — NHIỀU TƯƠNG TÁC NHẤT`);
        console.log(`=========================================================`);
        if (videoStats.length === 0) {
            console.log('❌ Không tìm thấy video nào.');
        } else {
            videoStats.forEach((v, index) => {
                console.log(`[${index + 1}] ❤️ ${v.likeText} | 💬 ${v.commentText} | 🕐 ${v.publishTime || 'N/A'} | @${v.username}`);
                console.log(`    ${v.url}`);
            });
        }
        console.log(`=========================================================\n`);

    } catch (error) {
        console.error('🔴 Đã xảy ra lỗi hệ thống:', error.message);
    } finally {
        console.log('Giữ trình duyệt thêm 8 giây để bạn copy link...');
        await page.waitForTimeout(8000);
        await context.close();
    }
})();