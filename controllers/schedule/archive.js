// controllers/schedule/archive.js
const { chromium } = require('playwright');
const {
    buildSchedulePopulateOptions,
    buildPublishedArchiveRow,
    buildPublishedArchiveStats,
    filterPublishedArchiveRows,
    getPublishedArchiveRows,
    buildExportFilename,
    escapeHtml
} = require('./helpers');

function buildArchiveExportHtml(rows = [], title = 'Thư Viện Đã Đăng') {
    const rowHtml = rows.map((row, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.publishedAtLabel)}</td>
            <td>${escapeHtml(row.typeLabel)}</td>
            <td>${escapeHtml(row.platformLabel)}</td>
            <td>${escapeHtml(row.caption || '—')}</td>
            <td>${escapeHtml(row.accountsLabel || '—')}</td>
            <td>${escapeHtml(row.targetGroupName || row.sourceChannelName || '—')}</td>
            <td>${escapeHtml(row.videoTitle || '—')}</td>
            <td>${escapeHtml(String(row.shopeeLinksCount || 0))}</td>
        </tr>
    `).join('');

    const stats = buildPublishedArchiveStats(rows);

    return `<!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(title)}</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #0f172a; }
            h1 { margin: 0 0 8px; font-size: 22px; }
            .meta { color: #64748b; margin-bottom: 18px; }
            .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
            .stat { border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; }
            .stat span { display: block; font-size: 11px; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
            .stat strong { font-size: 18px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px; vertical-align: top; }
            th { background: #f8fafc; text-align: left; }
            .small { color: #64748b; font-size: 11px; }
        </style>
    </head>
    <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Xuất lúc: ${escapeHtml(new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()))}</div>
        <div class="stats">
            <div class="stat"><span>Tổng đã đăng</span><strong>${stats.total}</strong></div>
            <div class="stat"><span>Post</span><strong>${stats.posts}</strong></div>
            <div class="stat"><span>Reels</span><strong>${stats.reels}</strong></div>
            <div class="stat"><span>Hôm nay</span><strong>${stats.today}</strong></div>
        </div>
        <table>
            <thead>
                <tr>
                    <th>#</th>
                    <th>Ngày đăng</th>
                    <th>Loại</th>
                    <th>Nền tảng</th>
                    <th>Nội dung</th>
                    <th>Tài khoản</th>
                    <th>Group/Nguồn</th>
                    <th>Video</th>
                    <th>Link</th>
                </tr>
            </thead>
            <tbody>
                ${rowHtml || `<tr><td colspan="9" class="small">Không có dữ liệu</td></tr>`}
            </tbody>
        </table>
    </body>
    </html>`;
}

const exportPublishedArchive = async (req, res) => {
    try {
        const format = String(req.query.format || 'xls').toLowerCase() === 'pdf' ? 'pdf' : 'xls';
        const rows = filterPublishedArchiveRows(await getPublishedArchiveRows(req.user._id), req.query);
        const html = buildArchiveExportHtml(rows, 'Thư Viện Đã Đăng');

        if (format === 'pdf') {
            const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
            try {
                const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
                await page.setContent(html, { waitUntil: 'load' });
                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    landscape: true,
                    printBackground: true,
                    margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' }
                });

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${buildExportFilename('thu-vien-da-dang', 'pdf')}"`);
                return res.send(pdfBuffer);
            } finally {
                await browser.close().catch(() => {});
            }
        }

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${buildExportFilename('thu-vien-da-dang', 'xls')}"`);
        return res.send(html);
    } catch (error) {
        console.error('Export Published Archive Error:', error);
        return res.status(500).send(`Lỗi export: ${error.message}`);
    }
};

const showPublishedArchive = async (req, res) => {
    try {
        const schedules = await require('../../models/SchedulePost').find({ userId: req.user._id, status: 'posted' })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .sort({ scheduledAt: -1 })
            .lean();

        const archiveRows = schedules.map(buildPublishedArchiveRow);
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const stats = {
            total: archiveRows.length,
            posts: archiveRows.filter(item => item.type === 'post').length,
            reels: archiveRows.filter(item => item.type === 'reels').length,
            fb: archiveRows.filter(item => item.platforms?.includes('FB')).length,
            ig: archiveRows.filter(item => item.platforms?.includes('IG')).length,
            tt: archiveRows.filter(item => item.platforms?.includes('TT')).length,
            yt: archiveRows.filter(item => item.platforms?.includes('YT')).length,
            today: archiveRows.filter(item => item.publishedAtDayKey === todayKey).length,
            month: archiveRows.filter(item => item.publishedAtMonthKey === monthKey).length
        };

        res.render('schedule-archive', { user: req.user, schedules: archiveRows, stats });
    } catch (error) {
        console.error('Show Published Archive Error:', error);
        res.render('schedule-archive', {
            user: req.user,
            schedules: [],
            stats: { total: 0, posts: 0, reels: 0, fb: 0, ig: 0, tt: 0, yt: 0, today: 0, month: 0 }
        });
    }
};

module.exports = {
    exportPublishedArchive,
    showPublishedArchive
};