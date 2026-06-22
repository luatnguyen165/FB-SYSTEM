// controllers/commentCrawlerController.js
// Controller cho tính năng FB Comment Crawler (gắn vào sidebar "FB Comment Crawler").
// Tách biệt hoàn toàn với trackingController — không đụng code cũ.

const CommentScrape = require('../models/CommentScrape');
const Channel = require('../models/Channel');
const { scrapePostComments, extractPostId } = require('../services/facebook/commentCrawler');

// ===== Helpers =====
function safeUserId(req) {
    return req.session?.userId || req.user?.id || null;
}

function ensureAuth(req, res) {
    if (!safeUserId(req)) {
        return res.redirect('/auth/login');
    }
    return null;
}

// GET /tracking/comments - Trang chính
exports.showCommentCrawler = async (req, res) => {
    try {
        if (ensureAuth(req, res)) return;

        const userId = safeUserId(req);

        const channels = await Channel.find({ userId, isEnabled: true, platform: 'FB' })
            .select('accountName platform accountType')
            .sort('accountName')
            .lean();

        const scrapes = await CommentScrape.find({ userId })
            .select('postUrl postTitle status stats scrapedAt createdAt accountName channelId')
            .sort({ scrapedAt: -1 })
            .limit(20)
            .lean();

        const stats = {
            totalScrapes: await CommentScrape.countDocuments({ userId }),
            successScrapes: await CommentScrape.countDocuments({ userId, status: 'success' }),
            totalComments: 0,
            lastScrapedAt: scrapes[0]?.scrapedAt || null
        };

        // Tổng số comments (aggregate từ stats.totalComments)
        const agg = await CommentScrape.aggregate([
            { $match: { userId: typeof userId === 'string' ? new (require('mongoose').Types.ObjectId)(userId) : userId } },
            { $group: { _id: null, total: { $sum: '$stats.totalComments' } } }
        ]);
        stats.totalComments = agg[0]?.total || 0;

        res.render('comment-crawler', {
            currentPage: 'comment-crawler',
            channels,
            scrapes,
            stats,
            features: res.locals.features || {},
            user: req.session.user || req.user || null
            // KHÔNG override t() ở đây — để res.locals.t từ i18nMiddleware/authMiddleware hoạt động
            // Nếu override bằng `(key) => key` thì t('app.name') sẽ trả raw key thay vì 'ReelsFlow AI'
        });
    } catch (err) {
        console.error('[Comment Crawler] showCommentCrawler error:', err.message);
        res.status(500).send('Lỗi tải trang: ' + err.message);
    }
};

// POST /tracking/comments/api/scrape - Bắt đầu scrape (lưu DB với status=running, chạy async, emit progress qua Socket.IO)
exports.startScrape = async (req, res) => {
    try {
        const userId = safeUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        const { postUrl, channelId, maxComments, maxDepth, includeReplies, skipPreviousUsers, visible } = req.body;
        if (!postUrl || !channelId) {
            return res.status(400).json({ success: false, message: 'Thiếu postUrl hoặc channelId' });
        }
        // Mặc định: KHÔNG lấy reply (chỉ lấy main comment). User phải gửi includeReplies=true để lấy reply.
        const includeRepliesFlag = includeReplies === true || includeReplies === 'true' || includeReplies === 1 || includeReplies === '1';
        const skipPreviousUsersFlag = skipPreviousUsers === true || skipPreviousUsers === 'true' || skipPreviousUsers === 1 || skipPreviousUsers === '1'; // mặc định: false
        const visibleFlag = visible === true || visible === 'true' || visible === 1 || visible === '1'; // mặc định: false (chạy ngầm)

        const channel = await Channel.findOne({ _id: channelId, userId, platform: 'FB' }).lean();
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản FB' });
        }

        const postId = extractPostId(postUrl);

        // Chuẩn hoá URL để so sánh chính xác (bỏ query/fragment)
        const cleanUrl = postUrl.split('?')[0].split('#')[0];

        // Tìm job cũ của cùng postUrl để UPDATE thay vì tạo mới
        const oldJob = await CommentScrape.findOne({
            userId,
            $or: [
                { postUrl: cleanUrl },
                { postUrl: { $regex: '^' + cleanUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } }
            ]
        }).sort({ scrapedAt: -1 });

        // Nếu bật skipPreviousUsers → query tất cả job cũ của cùng postUrl, lấy unique authors
        let previousAuthors = [];
        if (skipPreviousUsersFlag) {
            const oldJobs = oldJob ? [oldJob] : [];
            const authorSet = new Set();
            oldJobs.forEach(job => {
                (job.comments || []).forEach(c => {
                    const key = (c.author || c.authorName || '').trim().toLowerCase();
                    if (key && key.length > 0) authorSet.add(key);
                });
            });
            previousAuthors = Array.from(authorSet);
            console.log('[Comment Crawler] skipPreviousUsers: tìm thấy', previousAuthors.length, 'user đã scrape trước đó');
        }

        // Tạo job record mới HOẶC update job cũ cùng postUrl
        let job;
        let hasOldData = false;
        if (oldJob) {
            // Kiểm tra job cũ có dữ liệu không (để tránh mất data khi fail)
            hasOldData = (oldJob.comments && oldJob.comments.length > 0) || (oldJob.tree && oldJob.tree.length > 0);
            // Update job cũ — reset status, progress, scrapedAt
            // LƯU Ý: KHÔNG xóa comments/tree ở đây — chỉ xóa khi scrape thành công
            // Nếu scrape fail, dữ liệu cũ vẫn còn nguyên
            oldJob.status = 'running';
            oldJob.progress = 5;
            oldJob.errorMessage = '';
            oldJob.scrapedAt = new Date();
            oldJob.channelId = channel._id;
            oldJob.accountName = channel.accountName;
            oldJob.postId = postId;
            oldJob.options = {
                maxComments: parseInt(maxComments) || 0,
                maxDepth: parseInt(maxDepth) || 5,
                includeReplies: includeRepliesFlag,
                skipPreviousUsers: skipPreviousUsersFlag,
                visible: visibleFlag,
                previousAuthorsCount: previousAuthors.length,
                scrollAttempts: 3,
                expandIterations: 200
            };
            await oldJob.save();
            job = oldJob;
            console.log('[Comment Crawler] Update job cũ:', job._id, 'postUrl:', cleanUrl, '| hasOldData:', hasOldData);
        } else {
            // Tạo job mới
            job = await CommentScrape.create({
                userId,
                channelId: channel._id,
                accountName: channel.accountName,
                postUrl,
                postId,
                status: 'running',
                progress: 5,
                options: {
                    maxComments: parseInt(maxComments) || 0,
                    maxDepth: parseInt(maxDepth) || 5,
                    includeReplies: includeRepliesFlag,
                    skipPreviousUsers: skipPreviousUsersFlag,
                    visible: visibleFlag,
                    previousAuthorsCount: previousAuthors.length,
                    scrollAttempts: 3,
                    expandIterations: 200
                }
            });
            console.log('[Comment Crawler] Tạo job mới:', job._id, 'postUrl:', cleanUrl);
        }

        // Trả response ngay, chạy scrape async ở background
        res.json({ success: true, jobId: job._id, message: 'Đã bắt đầu scrape' });

        // ===== Background worker =====
        const io = req.app.get('io');
        const emitProgress = (p) => {
            if (io) {
                io.to('user:' + userId).emit('comment-crawler:progress', {
                    jobId: job._id.toString(),
                    ...p
                });
            }
        };

        let lastEmitUserCount = 0;
        try {
            emitProgress({ phase: 'init', statusText: 'Đang mở browser...', progress: 10, postUrl });
            const result = await scrapePostComments({
                userId,
                channel,
                postUrl,
                maxComments: job.options.maxComments,
                maxDepth: job.options.maxDepth,
                includeReplies: job.options.includeReplies,
                skipPreviousUsers: skipPreviousUsersFlag,
                visible: visibleFlag,
                previousAuthors: previousAuthors,
                onProgress: (p) => {
                    // Map progress phase sang %
                    let pct = 30;
                    if (p.phase === 'init') pct = 10;
                    else if (p.phase === 'navigate') pct = 20;
                    else if (p.phase === 'open-modal') pct = 30;
                    else if (p.phase === 'cycle') pct = 50;
                    else if (p.phase === 'expand-replies') pct = 60;
                    else if (p.phase === 'extracting') pct = 80;
                    else if (p.phase === 'success') pct = 100;
                    else if (p.phase === 'failed') pct = 100;

                    // Nếu scrape gửi về user mới → emit newUser realtime
                    if (p.newUser) {
                        emitProgress({ ...p, progress: pct, postUrl });
                        lastEmitUserCount++;
                    } else {
                        emitProgress({ ...p, progress: pct, postUrl });
                    }

                    CommentScrape.updateOne({ _id: job._id }, { progress: pct }).catch(() => {});
                }
            });

            if (result.success) {
                await CommentScrape.updateOne(
                    { _id: job._id },
                    {
                        status: result.stats.hasIncompleteReplies ? 'partial' : 'success',
                        progress: 100,
                        postId: result.postId || postId,
                        postTitle: result.postTitle || '',
                        stats: result.stats,
                        comments: result.comments,
                        tree: result.tree,
                        scrapedAt: new Date(),
                        errorMessage: ''
                    }
                );
                emitProgress({ phase: 'success', statusText: 'Xong!', progress: 100, jobId: job._id.toString() });
            } else {
                // FAIL: chỉ update status + error, KHÔNG đụng comments/tree cũ
                // → Dữ liệu cũ được giữ nguyên, job vẫn xem được
                const updateData = {
                    status: 'failed',
                    errorMessage: result.error || 'Unknown error',
                    progress: 100,
                    scrapedAt: new Date()
                };
                if (hasOldData) {
                    // Có dữ liệu cũ → set status=stale_failed (failed nhưng vẫn có data)
                    updateData.status = 'stale_failed';
                }
                await CommentScrape.updateOne(
                    { _id: job._id },
                    updateData
                );
                emitProgress({ phase: 'failed', error: result.error, progress: 100, jobId: job._id.toString() });
            }
        } catch (err) {
            console.error('[Comment Crawler] Background error:', err.message);
            // FAIL: cũng giữ dữ liệu cũ nếu có
            const updateData = {
                status: hasOldData ? 'stale_failed' : 'failed',
                errorMessage: err.message,
                progress: 100,
                scrapedAt: new Date()
            };
            await CommentScrape.updateOne(
                { _id: job._id },
                updateData
            ).catch(() => {});
            emitProgress({ phase: 'failed', error: err.message, progress: 100, jobId: job._id.toString() });
        }
    } catch (err) {
        console.error('[Comment Crawler] startScrape error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

// GET /tracking/comments/api/list - Danh sách các lần scrape gần đây
exports.listScrapes = async (req, res) => {
    try {
        const userId = safeUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const scrapes = await CommentScrape.find({ userId })
            .select('postUrl postTitle status stats scrapedAt createdAt accountName channelId')
            .sort({ scrapedAt: -1 })
            .limit(limit)
            .lean();

        res.json({ success: true, scrapes });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// GET /tracking/comments/api/job/:id - Lấy chi tiết 1 job
exports.getJob = async (req, res) => {
    try {
        const userId = safeUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        const job = await CommentScrape.findOne({ _id: req.params.id, userId }).lean();
        if (!job) return res.status(404).json({ success: false, message: 'Không tìm thấy job' });

        res.json({ success: true, job });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// GET /tracking/comments/api/job/:id/export?format=json|csv
exports.exportJob = async (req, res) => {
    try {
        const userId = safeUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        const format = (req.query.format || 'json').toLowerCase();
        const job = await CommentScrape.findOne({ _id: req.params.id, userId }).lean();
        if (!job) return res.status(404).json({ success: false, message: 'Không tìm thấy job' });

        const ts = new Date(job.scrapedAt || job.createdAt).toISOString().split('T')[0];
        const safePostId = (job.postId || 'post').replace(/[^\w.-]/g, '_');
        const filename = `fb-comments_${safePostId}_${ts}`;

        if (format === 'csv') {
            const headers = ['ID', 'Parent ID', 'Thread', 'Author', 'Profile URL', 'Text', 'Timestamp', 'Likes', 'Depth', 'Is Reply', 'Reply To'];
            const rows = [headers.join(',')];
            (job.comments || []).forEach((c) => {
                const indent = '  '.repeat(c.depth || 0);
                const threadText = `${indent}${c.depth === 0 ? '┌' : '└'} ${c.author || '[NO AUTHOR]'}`;
                const row = [
                    `"${(c.cid || '').replace(/"/g, '""')}"`,
                    `"${(c.parentId || '').replace(/"/g, '""')}"`,
                    `"${threadText.replace(/"/g, '""')}"`,
                    `"${(c.author || '').replace(/"/g, '""')}"`,
                    `"${(c.profileUrl || '').replace(/"/g, '""')}"`,
                    `"${(c.text || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
                    `"${(c.timestamp || '').replace(/"/g, '""')}"`,
                    c.likes || 0,
                    c.depth || 0,
                    c.isReply ? 'Yes' : 'No',
                    `"${(c.replyToAuthor || '').replace(/"/g, '""')}"`
                ];
                rows.push(row.join(','));
            });
            res.setHeader('Content-Type', 'text/csv;charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            return res.send(rows.join('\n'));
        }

        // JSON mặc định — trả hierarchical tree
        const exportData = {
            format: 'hierarchical',
            postUrl: job.postUrl,
            postId: job.postId,
            postTitle: job.postTitle,
            totalComments: job.stats?.totalComments || 0,
            mainComments: job.stats?.mainComments || 0,
            replies: job.stats?.replies || 0,
            scrapedAt: job.scrapedAt,
            comments: job.tree || job.comments || []
        };
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// DELETE /tracking/comments/api/job/:id
exports.deleteJob = async (req, res) => {
    try {
        const userId = safeUserId(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Chưa đăng nhập' });

        const result = await CommentScrape.deleteOne({ _id: req.params.id, userId });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy job' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};
