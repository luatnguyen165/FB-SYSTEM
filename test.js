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

// Hàm lưu cookies từ Playwright về định dạng cookies.txt (Netscape)
function saveCookiesAsNetscape(cookies, filePath) {
    const lines = ['# Netscape HTTP Cookie File'];
    for (const c of cookies) {
        const domain = c.domain.startsWith('.') ? c.domain : '.' + c.domain;
        const flag = 'FALSE';
        const path = c.path || '/';
        const secure = c.secure ? 'TRUE' : 'FALSE';
        const expires = Math.floor((c.expires || 9999999999));
        const name = c.name;
        const value = c.value;
        lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expires}\t${name}\t${value}`);
    }
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    console.log(`✅ Đã lưu ${cookies.length} cookies vào ${filePath}`);
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
        // BƯỚC 3: TÌM KIẾM TRENDING NHẠC VIỆT NAM
        // ============================================================
        console.log('🔍 Bắt đầu tìm kiếm...');
        
        // Đi thẳng đến URL tìm kiếm trending nhạc Việt Nam
        await page.goto('https://www.tiktok.com/search?q=nh%E1%BA%A1c%20trending%20vi%E1%BB%87t%20nam%202026&type=video', { waitUntil: 'networkidle', timeout: 30000 });
        console.log('Đã điều hướng đến trang tìm kiếm "nhạc trending việt nam 2026"...');
        await page.waitForTimeout(3000);

        console.log('Đang chờ trang kết quả tìm kiếm tải xong...');
        const videoLinkSelector = 'a[href*="/video/"]';
        await page.waitForSelector(videoLinkSelector, { timeout: 20000 });

        console.log('Cuộn trang nhẹ xuống để kích hoạt load thêm dữ liệu video...');
        await page.evaluate(() => window.scrollBy(0, 600));
        await page.waitForTimeout(2500);

        console.log('Đang lấy danh sách link video...');
        const allLinks = await page.$$eval(videoLinkSelector, elements => elements.map(el => el.href));
        const uniqueLinks = [...new Set(allLinks)];
        console.log(`Tổng cộng ${uniqueLinks.length} link video tìm thấy.`);

        // === BƯỚC 4: LỌC VIDEO THEO THỜI LƯỢNG < 2 PHÚT ===
        console.log('\n⏱ Đang kiểm tra thời lượng từng video...');
        const videoUnder2Min = [];

        for (let i = 0; i < uniqueLinks.length && videoUnder2Min.length < 10; i++) {
            const link = uniqueLinks[i];
            try {
                const username = link.split('/@')[1]?.split('/')[0] || 'unknown';
                console.log(`  [${i + 1}/${uniqueLinks.length}] Đang kiểm tra @${username}...`);
                await page.goto(link, { waitUntil: 'networkidle', timeout: 20000 });
                await page.waitForTimeout(1500);

                // Lấy thời lượng video từ page
                const durationSeconds = await page.evaluate(() => {
                    // Cách 1: từ meta og:video:duration
                    const metaDuration = document.querySelector('meta[property="og:video:duration"]');
                    if (metaDuration) return parseInt(metaDuration.getAttribute('content'));
                    // Cách 2: từ data-e2e video-duration (format MM:SS)
                    const durationEl = document.querySelector('[data-e2e="video-duration"]');
                    if (durationEl) {
                        const text = durationEl.textContent.trim();
                        const parts = text.split(':');
                        if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
                        if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
                    }
                    // Cách 3: từ JSON-LD
                    const ld = document.querySelector('script[type="application/ld+json"]');
                    if (ld) {
                        try {
                            const data = JSON.parse(ld.textContent);
                            const dur = data?.duration || '';
                            const match = dur.match(/PT(\d+)M(\d+)S/);
                            if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
                        } catch(e) {}
                    }
                    return null;
                });

                if (durationSeconds !== null && durationSeconds < 120) {
                    const minutes = Math.floor(durationSeconds / 60);
                    const secs = durationSeconds % 60;
                    console.log(`    ✅ ${minutes}m${secs.toString().padStart(2, '0')}s — DƯỚI 2 PHÚT`);
                    videoUnder2Min.push(link);
                } else if (durationSeconds !== null) {
                    const minutes = Math.floor(durationSeconds / 60);
                    const secs = durationSeconds % 60;
                    console.log(`    ⏭ ${minutes}m${secs.toString().padStart(2, '0')}s — quá 2 phút, bỏ qua`);
                } else {
                    console.log(`    ⚠️ Không xác định được thời lượng, bỏ qua`);
                }
            } catch (err) {
                console.log(`    ⚠️ Lỗi khi kiểm tra: ${err.message.slice(0, 80)}`);
            }
        }

        console.log(`\n============================================`);
        console.log(`   DANH SÁCH ${videoUnder2Min.length} VIDEO TRENDING < 2 PHÚT`);
        console.log(`============================================`);
        if (videoUnder2Min.length === 0) {
            console.log('❌ Không tìm thấy video nào dưới 2 phút.');
        } else {
            videoUnder2Min.forEach((link, index) => {
                console.log(`[${index + 1}] -> ${link}`);
            });
        }
        console.log(`============================================\n`);

    } catch (error) {
        console.error('🔴 Đã xảy ra lỗi hệ thống:', error.message);
    } finally {
        console.log('Giữ trình duyệt thêm 8 giây để bạn copy link...');
        await page.waitForTimeout(8000);
        await context.close();
    }
})();