const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const Channel = require('../models/Channel');

// Ensure public/video directory exists
const videoDir = path.join(global.USER_DATA_DIR || __dirname, '..', 'public', 'video');
if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
}

// Helper: get cookies file path from TikTok account
async function getCookiesPathForAccount(tiktokAccount) {
    if (!tiktokAccount) return null;

    try {
        // Tìm channel TikTok
        const channel = await Channel.findOne({
            platform: 'TT',
            accountName: tiktokAccount,
            isEnabled: true
        }).lean();

        if (!channel) {
            console.warn(`[Download] TikTok account "${tiktokAccount}" not found`);
            return null;
        }

        // Nếu có storageStatePath (Playwright storage state) -> extract cookies
        if (channel.storageStatePath) {
            const storagePath = path.isAbsolute(channel.storageStatePath)
                ? channel.storageStatePath
                : path.join(global.USER_DATA_DIR || __dirname, '..', channel.storageStatePath);

            if (fs.existsSync(storagePath)) {
                try {
                    const storageState = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
                    if (storageState.cookies && Array.isArray(storageState.cookies)) {
                        // Tạo cookies.txt tạm từ storage state
                        const tempCookiesPath = path.join(videoDir, `cookies_${tiktokAccount.replace(/[^a-zA-Z0-9]/g, '_')}.txt`);
                        const cookieLines = storageState.cookies.map(c => {
                            const domain = c.domain || '';
                            const includeSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
                            const path_c = c.path || '/';
                            const secure = c.secure ? 'TRUE' : 'FALSE';
                            const expiry = (typeof c.expires === 'number' && c.expires > 0) ? Math.floor(c.expires) : 0;
                            const name = c.name || '';
                            const value = c.value || '';
                            return `${domain}\t${includeSub}\t${path_c}\t${secure}\t${expiry}\t${name}\t${value}`;
                        });
                        const netscapeHeader = [
                            '# Netscape HTTP Cookie File',
                            '# Generated from TikTok account: ' + tiktokAccount,
                            '# https://curl.haxx.se/rfc/cookie_spec.html',
                            ''
                        ];
                        fs.writeFileSync(tempCookiesPath, netscapeHeader.join('\n') + cookieLines.join('\n'), 'utf-8');
                        return tempCookiesPath;
                    }
                } catch (e) {
                    console.warn(`[Download] Error reading storage state: ${e.message}`);
                }
            }
        }

        // Fallback: dùng cookies.txt mặc định
        const defaultCookies = path.join(global.USER_DATA_DIR || __dirname, '..', 'cookies.txt');
        if (fs.existsSync(defaultCookies)) {
            return defaultCookies;
        }

        return null;
    } catch (err) {
        console.error(`[Download] Error getting cookies: ${err.message}`);
        return null;
    }
}

// POST - Download video từ YouTube
router.post('/video', async (req, res) => {
    const { url, quality, tiktokAccount } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Vui lòng cung cấp URL video' });
    }

    try {
        // Xử lý cookies - ưu tiên account cụ thể, fallback cookies.txt mặc định
        let cookiesArg = '';
        if (tiktokAccount) {
            const cookiesPath = await getCookiesPathForAccount(tiktokAccount);
            if (cookiesPath) {
                cookiesArg = `--cookies "${cookiesPath.replace(/\\/g, '/')}"`;
                console.log(`[Download] Using cookies from account: ${tiktokAccount}`);
            }
        }
        if (!cookiesArg) {
            // Luôn dùng cookies.txt mặc định từ project root
            const defaultCookies = path.join(global.USER_DATA_DIR || __dirname, '..', 'cookies.txt');
            if (fs.existsSync(defaultCookies)) {
                cookiesArg = `--cookies "${defaultCookies.replace(/\\/g, '/')}"`;
                console.log(`[Download] Using default cookies.txt`);
            }
        }

        // Lấy title video
        const titleCmd = `yt-dlp --print "title" --no-warnings ${cookiesArg} "${url.replace(/"/g, '\\"')}"`;
        const titleBuffer = execSync(titleCmd, { timeout: 30000 });
        const title = titleBuffer.toString().trim().replace(/[\\/:*?"<>|]/g, '_');

        // Định dạng file output
        const outputPath = path.join(videoDir, `${title}.mp4`);

        // Kiểm tra nếu file đã tồn tại
        if (fs.existsSync(outputPath)) {
            return res.json({
                success: true,
                message: 'Video đã tồn tại',
                filename: `${title}.mp4`,
                filepath: `/video/${title}.mp4`
            });
        }

        // Chọn quality: mặc định best, có thể chọn worst hoặc best
        const format = quality === 'worst'
            ? 'worstvideo[ext=mp4]+worstaudio[ext=m4a]'
            : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]';

        const safeUrl = url.replace(/"/g, '\\"');
        const cmd = `yt-dlp -f "${format}" --recode-video mp4 --no-warnings ${cookiesArg}-o "${outputPath.replace(/\\/g, '/')}" "${safeUrl}"`;

        execSync(cmd, { timeout: 300000 }); // 5 phút timeout

        res.json({
            success: true,
            message: 'Tải video thành công',
            filename: `${title}.mp4`,
            filepath: `/video/${title}.mp4`
        });

    } catch (err) {
        console.error('[Download API] Error:', err.message);
        res.status(500).json({
            success: false,
            error: 'Lỗi khi tải video: ' + err.message
        });
    }
});

// POST - Download audio từ YouTube
router.post('/audio', async (req, res) => {
    const { url, tiktokAccount } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Vui lòng cung cấp URL video' });
    }

    try {
        // Xử lý cookies - ưu tiên account cụ thể, fallback cookies.txt mặc định
        let cookiesArg = '';
        if (tiktokAccount) {
            const cookiesPath = await getCookiesPathForAccount(tiktokAccount);
            if (cookiesPath) {
                cookiesArg = `--cookies "${cookiesPath.replace(/\\/g, '/')}"`;
            }
        }
        if (!cookiesArg) {
            const defaultCookies = path.join(global.USER_DATA_DIR || __dirname, '..', 'cookies.txt');
            if (fs.existsSync(defaultCookies)) {
                cookiesArg = `--cookies "${defaultCookies.replace(/\\/g, '/')}"`;
            }
        }

        // Lấy title video
        const titleCmd = `yt-dlp --print "title" --no-warnings ${cookiesArg}"${url.replace(/"/g, '\\"')}"`;
        const titleBuffer = execSync(titleCmd, { timeout: 30000 });
        const title = titleBuffer.toString().trim().replace(/[\\/:*?"<>|]/g, '_');

        // Định dạng file output
        const musicDir = path.join(global.USER_DATA_DIR || __dirname, '..', 'public', 'music');
        if (!fs.existsSync(musicDir)) {
            fs.mkdirSync(musicDir, { recursive: true });
        }
        const outputPath = path.join(musicDir, `${title}.m4a`);

        // Kiểm tra nếu file đã tồn tại
        if (fs.existsSync(outputPath)) {
            return res.json({
                success: true,
                message: 'Audio đã tồn tại',
                filename: `${title}.m4a`,
                filepath: `/music/${title}.m4a`
            });
        }

        const safeUrl = url.replace(/"/g, '\\"');
        const cmd = `yt-dlp -f "bestaudio[ext=m4a]" --no-warnings ${cookiesArg}-o "${outputPath.replace(/\\/g, '/')}" "${safeUrl}"`;

        execSync(cmd, { timeout: 300000 });

        res.json({
            success: true,
            message: 'Tải audio thành công',
            filename: `${title}.m4a`,
            filepath: `/music/${title}.m4a`
        });

    } catch (err) {
        console.error('[Download API] Error:', err.message);
        res.status(500).json({
            success: false,
            error: 'Lỗi khi tải audio: ' + err.message
        });
    }
});

// GET - Kiểm tra trạng thái
router.get('/status', (req, res) => {
    try {
        const version = execSync('yt-dlp --version', { timeout: 5000 }).toString().trim();
        res.json({
            available: true,
            version
        });
    } catch {
        res.json({ available: false });
    }
});

module.exports = router;