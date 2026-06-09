const ytDl = require('yt-dlp-exec');
const path = require('path');

async function downloadWithCookies(url) {
    try {
        const result = await ytDl(url, {
            output: 'downloads/%(title)s.%(ext)s',
            // Đường dẫn đến file cookies.txt bạn đã tải về server
            cookies: path.join(__dirname, 'cookies.txt'), 
            
            // Hoặc nếu bạn dùng Chrome profile trên máy (Linux/macOS/Windows)
            // cookiesFromBrowser: 'chrome', 
            
            format: 'best',
            noCheckCertificates: true
        });

        console.log('Tải thành công với cookies!');
    } catch (error) {
        console.error('Lỗi (có thể do cookies hết hạn):', error.message);
    }
}

downloadWithCookies('https://www.tiktok.com/@dnteamremix68/video/7649315676448115988');