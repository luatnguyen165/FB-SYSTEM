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
        // Lấy query params: status filter, type filter, platform filter, page
        const statusFilter = String(req.query.status || 'all').toLowerCase(); // 'all' | 'posted' | 'failed' | 'partial'
        const typeFilter = String(req.query.type || 'all').toLowerCase(); // 'all' | 'post' | 'reels' | 'tiktok'
        const platformFilter = String(req.query.platform || 'all').toUpperCase();
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const PAGE_SIZE = 20;

        const SchedulePostModel = require('../../models/SchedulePost');
        const mongoose = require('mongoose');
        // Ép kiểu userId thành ObjectId chính xác (req.user._id có thể là string)
        const userIdObj = new mongoose.Types.ObjectId(String(req.user._id));

        // Build query: mặc định lấy CHỈ lịch đã đăng thành công (status='posted')
        const query = { userId: userIdObj, status: 'posted' };
        if (statusFilter === 'posted') query.status = 'posted';
        else if (statusFilter === 'failed') query.status = 'failed';
        else if (statusFilter === 'partial') {
            query.status = 'posted';
            query.platformResults = { $exists: true, $not: { $size: 0 } };
            query['platformResults.success'] = false;
        }
        if (typeFilter !== 'all') query.type = typeFilter;
        if (platformFilter !== 'all' && platformFilter !== 'ALL') query.platforms = platformFilter;

        // DEBUG: log query để xem
        console.log('[Archive] Query:', JSON.stringify(query));
        const total = await SchedulePostModel.countDocuments(query);
        console.log('[Archive] Total matched:', total);

        // Load TOÀN BỘ rows — JS pagination sẽ lo phân trang client-side
        const schedules = await SchedulePostModel.find(query)
            .populate(buildSchedulePopulateOptions(userIdObj))
            .sort({ scheduledAt: -1 })
            .lean();

        console.log('[Archive] Found schedules (all):', schedules.length);
        if (schedules.length === 0) {
            // DEBUG: thử query rộng hơn để xem có data gì không
            const allAny = await SchedulePostModel.countDocuments({ userId: userIdObj });
            const allByStatus = await SchedulePostModel.aggregate([
                { $match: { userId: userIdObj } },
                { $group: { _id: '$status', count: { $sum: 1 } } }
            ]);
            console.log('[Archive DEBUG] Total any status:', allAny);
            console.log('[Archive DEBUG] By status:', JSON.stringify(allByStatus));
        }

        const archiveRows = schedules.map(buildPublishedArchiveRow);
        console.log('[Archive] archiveRows.length:', archiveRows.length);
        if (archiveRows.length > 0) {
            console.log('[Archive] Sample row:', JSON.stringify({
                _id: archiveRows[0]._id,
                status: archiveRows[0].status,
                platforms: archiveRows[0].platforms,
                type: archiveRows[0].type,
                caption: archiveRows[0].caption?.substring(0, 50),
                platformDetailsCount: archiveRows[0].platformDetails?.length || 0,
                scheduledAt: archiveRows[0].scheduledAt
            }, null, 2));
        }
        const now = new Date();
        const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Stats — dùng full count (không phân trang)
        const allRows = await getPublishedArchiveRows(userIdObj);
        const stats = buildPublishedArchiveStats(allRows);

        // Không paginate ở server nữa — JS pagination sẽ lo phân trang client-side
        const totalPages = Math.max(1, Math.ceil(archiveRows.length / PAGE_SIZE));

        res.render('schedule-archive', {
            user: req.user,
            schedules: archiveRows,
            stats,
            pagination: { page: 1, totalPages, total: archiveRows.length, pageSize: PAGE_SIZE },
            filters: { status: statusFilter, type: typeFilter, platform: platformFilter }
        });
    } catch (error) {
        console.error('Show Published Archive Error:', error);
        res.render('schedule-archive', {
            user: req.user,
            schedules: [],
            stats: { total: 0, posts: 0, reels: 0, fb: 0, ig: 0, tt: 0, yt: 0, today: 0, month: 0, partial: 0, failed: 0 },
            pagination: { page: 1, totalPages: 1, total: 0, pageSize: 20 },
            filters: { status: 'all', type: 'all', platform: 'all' }
        });
    }
};

module.exports = {
    exportPublishedArchive,
    showPublishedArchive
};