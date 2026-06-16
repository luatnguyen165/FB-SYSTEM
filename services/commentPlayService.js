// services/commentPlayService.js
const CommentPlay = require('../models/CommentPlay');
const CommentPlayLog = require('../models/CommentPlayLog');
const AiComment = require('../models/AiComment');

class CommentPlayService {

    // ============================================================
    // CRUD
    // ============================================================

    async getAll(userId) {
        return CommentPlay.find({ userId }).sort({ createdAt: -1 }).lean();
    }

    async getById(userId, playId) {
        return CommentPlay.findOne({ _id: playId, userId }).lean();
    }

    async create(userId, data) {
        const count = await CommentPlay.countDocuments({ userId });
        const play = await CommentPlay.create({
            userId,
            name: data.name || `Kịch bản #${count + 1}`,
            description: data.description || '',
            schedule: {
                type: data.schedule?.type || 'interval',
                intervalMinutes: data.schedule?.intervalMinutes || 30,
                timeRange: {
                    start: data.schedule?.timeRange?.start || '06:00',
                    end: data.schedule?.timeRange?.end || '23:59'
                },
                maxPerDay: data.schedule?.maxPerDay || 50,
                commentDelay: {
                    min: data.schedule?.commentDelay?.min || 5,
                    max: data.schedule?.commentDelay?.max || 15
                }
            },
            channelId: data.channelId || null,
            selectedCommentIds: data.selectedCommentIds || [],
            postAllComments: data.postAllComments || false,
            target: {
                type: data.target?.type || 'group-posts',
                groupIds: data.target?.groupIds || [],
                postUrls: data.target?.postUrls || [],
                scanConfigId: (data.target?.type === 'ai-scan-results' && data.target?.scanConfigId) ? data.target.scanConfigId : null,
                filter: {
                    types: data.target?.filter?.types || ['text', 'image', 'video']
                }
            },
            status: data.status || 'active',
            lastResetDate: this._todayStr()
        });
        play.metrics.nextRunAt = this._calcNextRun(play);
        await play.save();
        return play;
    }

    async update(userId, playId, data) {
        const play = await CommentPlay.findOne({ _id: playId, userId });
        if (!play) return null;

        if (data.name !== undefined) play.name = data.name;
        if (data.description !== undefined) play.description = data.description;
        if (data.status !== undefined) play.status = data.status;

        if (data.schedule) {
            if (data.schedule.type !== undefined) play.schedule.type = data.schedule.type;
            if (data.schedule.intervalMinutes !== undefined) play.schedule.intervalMinutes = data.schedule.intervalMinutes;
            if (data.schedule.timeRange) {
                if (data.schedule.timeRange.start !== undefined) play.schedule.timeRange.start = data.schedule.timeRange.start;
                if (data.schedule.timeRange.end !== undefined) play.schedule.timeRange.end = data.schedule.timeRange.end;
            }
            if (data.schedule.maxPerDay !== undefined) play.schedule.maxPerDay = data.schedule.maxPerDay;
            if (data.schedule.commentDelay) {
                if (data.schedule.commentDelay.min !== undefined) play.schedule.commentDelay.min = data.schedule.commentDelay.min;
                if (data.schedule.commentDelay.max !== undefined) play.schedule.commentDelay.max = data.schedule.commentDelay.max;
            }
        }

        if (data.channelId !== undefined) play.channelId = data.channelId;
        if (data.selectedCommentIds !== undefined) play.selectedCommentIds = data.selectedCommentIds;
        if (data.postAllComments !== undefined) play.postAllComments = data.postAllComments;

        if (data.target) {
            if (data.target.type !== undefined) play.target.type = data.target.type;
            if (data.target.groupIds !== undefined) play.target.groupIds = data.target.groupIds;
            if (data.target.postUrls !== undefined) play.target.postUrls = data.target.postUrls;
            if (data.target.type === 'ai-scan-results' && data.target.scanConfigId !== undefined) {
                play.target.scanConfigId = data.target.scanConfigId || null;
            } else if (data.target.type !== 'ai-scan-results') {
                play.target.scanConfigId = null;
            }
            if (data.target.filter) {
                if (data.target.filter.types !== undefined) play.target.filter.types = data.target.filter.types;
            }
        }

        this._checkResetDaily(play);
        play.metrics.nextRunAt = this._calcNextRun(play);
        play.updatedAt = new Date();
        await play.save();
        return play;
    }

    async delete(userId, playId) {
        const result = await CommentPlay.deleteOne({ _id: playId, userId });
        await CommentPlayLog.deleteMany({ playId });
        return result.deletedCount > 0;
    }

    async toggleStatus(userId, playId) {
        const play = await CommentPlay.findOne({ _id: playId, userId });
        if (!play) return null;
        if (play.status === 'active') {
            play.status = 'paused';
        } else if (play.status === 'paused') {
            play.status = 'active';
            play.metrics.nextRunAt = this._calcNextRun(play);
        } else {
            play.status = 'active';
            play.metrics.nextRunAt = this._calcNextRun(play);
        }
        play.updatedAt = new Date();
        await play.save();
        return play;
    }

    // ============================================================
    // RUNNER
    // ============================================================

    async runPlay(userId, playId) {
        const play = await CommentPlay.findOne({ _id: playId, userId });
        if (!play) throw new Error('Không tìm thấy kịch bản');
        // Gộp: Play = Auto Comment All (comment tất cả bài viết theo tuần tự)
        return this.runAutoCommentAll(userId, playId);
    }

    async processScheduledPlays() {
        const now = new Date();
        const plays = await CommentPlay.find({
            status: 'active',
            'metrics.nextRunAt': { $lte: now }
        });
        const results = [];
        for (const play of plays) {
            try {
                // Lịch trình cũng dùng auto-comment-all
                const result = await this.runAutoCommentAll(play.userId, play._id);
                results.push({ playId: play._id, success: true, result });
            } catch (err) {
                results.push({ playId: play._id, success: false, error: err.message });
            }
        }
        return results;
    }

    // ============================================================
    // INTERNAL
    // ============================================================

    async _executePlay(play, forceRun = false) {
        // Nếu không phải forceRun, kiểm tra khung giờ và giới hạn ngày
        if (!forceRun) {
            if (!this._isInTimeRange(play)) {
                play.metrics.nextRunAt = this._calcNextRun(play, true);
                play.updatedAt = new Date();
                await play.save();
                return { skipped: true, reason: 'outside_time_range' };
            }
            this._checkResetDaily(play);
            if (play.metrics.totalToday >= play.schedule.maxPerDay) {
                play.metrics.nextRunAt = this._calcNextRun(play, true);
                play.updatedAt = new Date();
                await play.save();
                return { skipped: true, reason: 'max_per_day_reached' };
            }
        }

        this._checkResetDaily(play);

        console.log("##### _executePlay: Goi _pickTargetPost");
        const targetInfo = await this._pickTargetPost(play);
        console.log("##### _executePlay: targetInfo=", targetInfo);
        if (!targetInfo) { 
            console.log("##### _executePlay: KHONG CO targetInfo -> skip");
            return { skipped: true, reason: 'no_target_posts_available' };
        }

        // Lấy danh sách comment theo postAllComments
        const comments = await this._getCommentsToPost(play);
        if (!comments || comments.length === 0) {
            return { skipped: true, reason: 'no_comments_available' };
        }

        // Gọi _postComment một lần với toàn bộ danh sách comment
        // _postComment sẽ xử lý việc post lần lượt trong 1 lần mở browser
        const postResult = await this._postComment(play, comments, targetInfo);

        // Tạo log cho từng comment (dùng helper đã extract)
        const { results, successCount, errorCount } = await this._createCommentLogs(play, comments, targetInfo, postResult);

        // Cập nhật metrics
        play.metrics.totalCommentsPosted += successCount;
        play.metrics.totalToday += successCount;
        play.metrics.totalErrors += errorCount;
        play.metrics.lastRunAt = new Date();
        play.metrics.nextRunAt = this._calcNextRun(play);
        play.updatedAt = new Date();
        await play.save();

        return {
            success: successCount > 0,
            postedCount: successCount,
            errorCount,
            targetUrl: targetInfo.url,
            results
        };
    }

    async _getCommentsToPost(play) {
        if (play.postAllComments && play.selectedCommentIds && play.selectedCommentIds.length > 0) {
            // Post tất cả comment đã chọn theo thứ tự order
            return AiComment.find({
                _id: { $in: play.selectedCommentIds },
                userId: play.userId,
                isActive: true
            }).sort({ order: 1 }).lean();
        } else {
            // Chế độ cũ: random 1 comment
            const comment = await this._pickRandomComment(play);
            return comment ? [comment] : [];
        }
    }

    _getRandomDelay(play) {
        const min = (play.schedule.commentDelay?.min || 5) * 1000;
        const max = (play.schedule.commentDelay?.max || 15) * 1000;
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    _isInTimeRange(play) {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();
        const currentMinutes = hour * 60 + minute;

        const [startH, startM] = (play.schedule.timeRange.start || '06:00').split(':').map(Number);
        const [endH, endM] = (play.schedule.timeRange.end || '23:59').split(':').map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    }

    _checkResetDaily(play) {
        const today = this._todayStr();
        if (play.lastResetDate !== today) {
            play.metrics.totalToday = 0;
            play.lastResetDate = today;
        }
    }

    _todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _calcNextRun(play, forceTomorrow = false) {
        const now = new Date();
        let next = new Date(now);

        if (play.schedule.type === 'interval') {
            next = new Date(now.getTime() + (play.schedule.intervalMinutes || 30) * 60 * 1000);
        }

        // Nếu forceTomorrow, set vào khung giờ bắt đầu ngày mai
        if (forceTomorrow) {
            const [startH, startM] = (play.schedule.timeRange.start || '06:00').split(':').map(Number);
            next = new Date(now);
            next.setDate(next.getDate() + 1);
            next.setHours(startH, startM, 0, 0);
        }

        return next;
    }

    async _pickRandomComment(play) {
        let comments;

        if (play.selectedCommentIds && play.selectedCommentIds.length > 0) {
            comments = await AiComment.find({
                _id: { $in: play.selectedCommentIds },
                userId: play.userId,
                isActive: true
            }).sort({ order: 1 }).lean();
        } else {
            const filter = {
                userId: play.userId,
                isActive: true
            };
            if (play.target.filter?.types?.length > 0) {
                filter.type = { $in: play.target.filter.types };
            }
            comments = await AiComment.find(filter).sort({ order: 1 }).lean();
        }

        if (comments.length === 0) return null;

        const idx = Math.floor(Math.random() * comments.length);
        return comments[idx];
    }

    async _pickTargetPost(play) {
        // console.log("##### _pickTargetPost: play.target=", play);
        // console.log("##### _pickTargetPost: play.target.scanConfigId=", play.target.scanConfigId);
        // Ưu tiên: ai-scan-results với scanConfigId cụ thể
        if (play.target.type === 'ai-scan-results' && play.target.scanConfigId) {
            console.log("##### _pickTargetPost: Picking from ai-scan-results with scanConfigId=", play.target.scanConfigId);
            return this._pickPostFromScanResults(play);
        }

        // Fallback: nếu target type là group-posts hoặc ai-scan-results mà không có scanConfigId
        // → Tìm từ tất cả kết quả AI Scan chưa comment (isMatching: true)
        if (play.target.type === 'group-posts' || play.target.type === 'ai-scan-results') {
            const result = await this._pickPostFromScanResults(play);
            if (result) return result;
        }

        // Specific posts (URL list)
        if (play.target.postUrls && play.target.postUrls.length > 0) {
            const idx = Math.floor(Math.random() * play.target.postUrls.length);
            return {
                url: play.target.postUrls[idx],
                groupId: ''
            };
        }

        return null;
    }

    async _pickPostFromScanResults(play) {
        const AiScanResult = require('../models/AiScanResult');
        const mongoose = require('mongoose');

        // Ép kiểu scanConfigId về ObjectId để tránh lệch kiểu khi so sánh
        let scanConfigId = play.target.scanConfigId;
        if (scanConfigId && typeof scanConfigId === 'string' && mongoose.Types.ObjectId.isValid(scanConfigId)) {
            scanConfigId = new mongoose.Types.ObjectId(scanConfigId);
        }

        // CROSS-PLAY DEDUP: Lấy danh sách postUrl đã được TẤT CẢ plays của user này comment thành công
        const allUserPlays = await CommentPlay.find({
            userId: play.userId,
            _id: { $ne: play._id }
        }).select('_id').lean();

        const allPlayIds = [play._id, ...allUserPlays.map(p => p._id)];

        const commentedLogs = await CommentPlayLog.find({
            playId: { $in: allPlayIds },
            status: 'success',
            targetUrl: { $ne: '' }
        }).select('targetUrl').lean();

        const commentedSet = new Set(commentedLogs.map(l => String(l.targetUrl)));

        // Query filter: nếu có scanConfigId thì filter theo config, không thì lấy tất cả của user
        const baseFilter = {
            userId: play.userId,
            postUrl: { $ne: '', $exists: true }
        };
        if (scanConfigId) {
            baseFilter.configId = scanConfigId;
        }

        // Lấy bài match nhu cầu (isMatching: true) — không filter theo commentSent
        // vì CommentPlayLog (commentedSet) sẽ xử lý việc loại bỏ bài đã comment
        let results = await AiScanResult.find({
            ...baseFilter,
            isMatching: true
        }).sort({ scannedAt: -1 }).limit(100).lean();

        console.log(`[CommentPlay] Found ${results.length} matching scan results for play ${play._id}. Cross-play commented URLs count: ${commentedSet.size}`);

        // Loại bỏ bài đã comment bởi TẤT CẢ plays (cross-play dedup)
        let uncommented = results.filter(r => r.postUrl && !commentedSet.has(String(r.postUrl)));

        if (!uncommented || uncommented.length === 0) {
            console.log(`[CommentPlay] ⚠ No target post available (isMatching: true). scanConfigId=${scanConfigId || 'ALL'}, totalCommentedAcrossPlays=${commentedSet.size}, totalMatchingInDB=${results?.length || 0}`);
            return null;
        }

        const idx = Math.floor(Math.random() * uncommented.length);
        const post = uncommented[idx];

        return {
            url: post.postUrl || '',
            groupId: post.groupId || '',
            postId: post.postId || '',
            scanResultId: post._id
        };
    }

    async _postComment(play, comments, targetInfo) {
        try {
            console.log("##### _postComment: channelId=",play.channelId);if (!play.channelId) {
                console.log(`[CommentPlay] Mock ${comments.length} comment(s) to ${targetInfo.url}`);
                return { success: true, postedCount: comments.length };
            }

            const Channel = require('../models/Channel');
            const channel = await Channel.findById(play.channelId).lean();
            if (!channel) throw new Error('Không tìm thấy tài khoản Facebook');

            const facebookCommentService = require('./facebook/comment');

            // Chuẩn bị danh sách comment cho playwright
            const commentList = comments.map(c => ({
                type: c.type,
                content: c.type === 'text' ? c.content : (c.caption || ''),
                filePath: c.type !== 'text' ? c.content : null,
                caption: c.caption || ''
            }));

            console.log("##### _postComment: DANG GOI commentOnPost voi", commentList.length, "comment(s)");
            const postResult = await facebookCommentService.commentOnPost({
                channel,
                postUrl: targetInfo.url,
                comments: commentList,
                keepOpenMs: 10000
            });

            // Cập nhật scan result CHỈ KHI comment thành công
            if (postResult.success && targetInfo.scanResultId && comments.length > 0) {
                try {
                    const AiScanResult = require('../models/AiScanResult');
                    const lastComment = comments[comments.length - 1];
                    await AiScanResult.findByIdAndUpdate(targetInfo.scanResultId, {
                        commentSent: true,
                        commentContent: lastComment.type === 'text' ? lastComment.content : lastComment.caption,
                        commentImage: lastComment.type !== 'text' ? lastComment.content : '',
                        commentedAt: new Date()
                    });
                } catch (err) {
                    console.error('[CommentPlay] Error updating scan result:', err.message);
                }
            } else if (!postResult.success && targetInfo.scanResultId) {
                // Comment THẤT BẠI → giữ commentSent: false để lần sau retry
                try {
                    const AiScanResult = require('../models/AiScanResult');
                    await AiScanResult.findByIdAndUpdate(targetInfo.scanResultId, {
                        commentSent: false,
                        commentError: postResult.error || 'Comment failed'
                    });
                } catch (err) {}
            }

            return postResult;
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ============================================================
    // AUTO COMMENT ALL
    // ============================================================

    /**
     * Tự động comment tất cả bài viết chưa comment theo tuần tự
     * Mở Chrome → comment → đóng → chờ → lặp lại cho đến khi hết bài
     */
    async runAutoCommentAll(userId, playId, onProgress) {
        const play = await CommentPlay.findOne({ _id: playId, userId });
        if (!play) throw new Error('Không tìm thấy kịch bản');

        const allResults = [];
        let totalPosted = 0;
        let totalErrors = 0;
        let iteration = 0;
        const maxIterations = 100; // Safety limit

        while (iteration < maxIterations) {
            iteration++;
            let playState;
            try {
                playState = await CommentPlay.findById(play._id);
            } catch (e) { break; }
            if (!playState) break;

            this._checkResetDaily(playState);

            // Check if there's a target post available
            let targetInfo;
            try {
                targetInfo = await this._pickTargetPost(playState);
            } catch (e) {
                console.log(`[AutoCommentAll] Error picking target: ${e.message}`);
                break;
            }

            if (!targetInfo) {
                console.log(`[AutoCommentAll] No more targets available after ${iteration} iterations`);
                if (onProgress) {
                    onProgress({ type: 'complete', totalPosted, totalErrors, iterations: iteration });
                }
                break;
            }

            // Get comments
            const comments = await this._getCommentsToPost(playState);
            if (!comments || comments.length === 0) {
                console.log(`[AutoCommentAll] No comments available`);
                if (onProgress) {
                    onProgress({ type: 'complete', totalPosted, totalErrors, iterations: iteration, reason: 'no_comments' });
                }
                break;
            }

            // Post comment
            let postResult;
            try {
                postResult = await this._postComment(playState, comments, targetInfo);
            } catch (e) {
                postResult = { success: false, error: e.message };
            }

            // Create logs (dùng helper đã extract)
            const { successCount, errorCount } = await this._createCommentLogs(playState, comments, targetInfo, postResult);

            totalPosted += successCount;
            totalErrors += errorCount;

            // Update play metrics
            try {
                const freshPlay = await CommentPlay.findById(playState._id);
                if (freshPlay) {
                    freshPlay.metrics.totalCommentsPosted += successCount;
                    freshPlay.metrics.totalToday += successCount;
                    freshPlay.metrics.totalErrors += errorCount;
                    freshPlay.metrics.lastRunAt = new Date();
                    freshPlay.updatedAt = new Date();
                    await freshPlay.save();
                }
            } catch (e) { console.error('[AutoCommentAll] Error updating metrics:', e.message); }

            // Emit progress
            if (onProgress) {
                onProgress({
                    type: 'progress',
                    iteration,
                    posted: successCount,
                    errors: errorCount,
                    targetUrl: targetInfo.url,
                    totalPosted,
                    totalErrors
                });
            }

            console.log(`[AutoCommentAll] #${iteration}: ${successCount > 0 ? '✓' : '✕'} ${targetInfo.url} (total: ${totalPosted} posted, ${totalErrors} errors)`);

            // Delay between posts
            const delay = this._getRandomDelay(playState);
            console.log(`[AutoCommentAll] Waiting ${Math.round(delay / 1000)}s before next post...`);
            await new Promise(r => setTimeout(r, delay));
        }

        return {
            success: totalPosted > 0,
            totalPosted,
            totalErrors,
            iterations: iteration
        };
    }

    // ============================================================
    // HELPER: Comment Logs (extracted to eliminate duplicate code)
    // ============================================================

    /**
     * Tạo CommentPlayLog records cho mỗi comment sau khi post
     * Helper này thay thế ~50 dòng code duplicate trong _executePlay và runAutoCommentAll
     */
    async _createCommentLogs(play, comments, targetInfo, postResult) {
        const results = [];
        let successCount = 0;
        let errorCount = 0;

        if (postResult.success && postResult.results) {
            // Nếu playwright trả về kết quả chi tiết cho từng comment
            for (let i = 0; i < comments.length; i++) {
                const comment = comments[i];
                const resultDetail = postResult.results[i] || { success: postResult.success, error: postResult.error };
                
                await CommentPlayLog.create({
                    playId: play._id,
                    commentId: comment._id,
                    commentText: comment.type === 'text' ? comment.content : comment.caption,
                    commentType: comment.type,
                    targetUrl: targetInfo.url,
                    targetGroupId: targetInfo.groupId || '',
                    status: resultDetail.success ? 'success' : 'error',
                    errorMessage: resultDetail.error || '',
                    postedAt: new Date()
                });

                if (resultDetail.success) {
                    successCount++;
                } else {
                    errorCount++;
                }

                results.push({
                    commentId: comment._id,
                    success: resultDetail.success,
                    error: resultDetail.error || null
                });
            }
        } else {
            // Fallback: nếu không có kết quả chi tiết, coi tất cả thành công hoặc thất bại
            for (let i = 0; i < comments.length; i++) {
                const comment = comments[i];
                await CommentPlayLog.create({
                    playId: play._id,
                    commentId: comment._id,
                    commentText: comment.type === 'text' ? comment.content : comment.caption,
                    commentType: comment.type,
                    targetUrl: targetInfo.url,
                    targetGroupId: targetInfo.groupId || '',
                    status: postResult.success ? 'success' : 'error',
                    errorMessage: postResult.error || '',
                    postedAt: new Date()
                });

                if (postResult.success) {
                    successCount++;
                } else {
                    errorCount++;
                }

                results.push({
                    commentId: comment._id,
                    success: postResult.success,
                    error: postResult.error || null
                });
            }
        }

        return { results, successCount, errorCount };
    }

    // ============================================================
    // STATS & LOGS
    // ============================================================

    async getStats(userId) {
        const total = await CommentPlay.countDocuments({ userId });
        const active = await CommentPlay.countDocuments({ userId, status: 'active' });
        const paused = await CommentPlay.countDocuments({ userId, status: 'paused' });

        const todayStr = this._todayStr();
        const plays = await CommentPlay.find({ userId }).lean();
        const todayPosted = plays.reduce((sum, p) => {
            if (p.lastResetDate === todayStr) return sum + (p.metrics.totalToday || 0);
            return sum;
        }, 0);

        return { total, active, paused, todayPosted };
    }

    async getLogs(userId, playId, limit = 50) {
        const play = await CommentPlay.findOne({ _id: playId, userId });
        if (!play) return [];
        return CommentPlayLog.find({ playId })
            .sort({ postedAt: -1 })
            .limit(limit)
            .lean();
    }

    async getLogsSummary(userId, playId) {
        const play = await CommentPlay.findOne({ _id: playId, userId });
        if (!play) return null;
        const [success, error] = await Promise.all([
            CommentPlayLog.countDocuments({ playId, status: 'success' }),
            CommentPlayLog.countDocuments({ playId, status: 'error' })
        ]);
        return { success, error, total: success + error };
    }
}

module.exports = new CommentPlayService();