// services/aiScan/scheduler.js
const AiScanConfig = require('../../models/AiScanConfig');
const AiScanResult = require('../../models/AiScanResult');
const Channel = require('../../models/Channel');
const Settings = require('../../models/Settings');
const { getOrOpenFacebookContext } = require('../facebook/session');
const { fetchGroupPosts } = require('../facebookGraphqlScraper');
const socketService = require('../socketService');
const { wait, randomInt } = require('./helpers');
const { normalizeEncryptedValue } = require('../../utils/cryptoVault');
const { analyzeDbResult } = require('./aiAnalysis');
const { savePostsToDb, crawlGroupPosts } = require('./crawler');
const { commentOnPostLegacy } = require('./comments');

// ===== SCAN QUEUE =====
// Hàng đợi quét với per-config locking, retry, và status tracking
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

const queue = [];          // Array<{ configId, userId, config, priority, enqueuedAt }>
const running = new Map(); // configId → { status, startedAt, retries, error }
const completed = [];      // Array<{ configId, name, success, error?, startedAt, finishedAt }> (giữ 50 bản ghi gần nhất)
let isProcessingLoop = false;

function getQueueStatus() {
    return {
        pending: queue.map(j => ({ configId: j.configId, name: j.config.name, enqueuedAt: j.enqueuedAt })),
        running: Array.from(running.entries()).map(([configId, state]) => ({ configId, ...state })),
        completed: completed.slice(-20),
        totalPending: queue.length,
        totalRunning: running.size
    };
}

function isScanSchedulerProcessing() {
    return isProcessingLoop || queue.length > 0 || running.size > 0;
}

function emitQueueStatus(userId) {
    const status = getQueueStatus();
    socketService.emitQueueUpdate(userId, status);
}

function emitRealtimeResults(userId, configId) {
    try {
        const statsPromise = Promise.all([
            AiScanResult.countDocuments({ userId }),
            AiScanResult.countDocuments({ userId, isMatching: true }),
            AiScanResult.countDocuments({ userId, commentSent: true })
        ]);

        statsPromise.then(([totalScanned, totalMatched, totalCommented]) => {
            socketService.emitStatsUpdate(userId, { totalScanned, totalMatched, totalCommented });
        }).catch(() => {});

        AiScanResult.find({ userId, configId })
            .sort({ scannedAt: -1 })
            .limit(5)
            .lean()
            .then(latestResults => {
                if (latestResults.length > 0) {
                    socketService.emitNewResults(userId, latestResults);
                }
            })
            .catch(() => {});
    } catch (e) {
        console.error('[Realtime] Error emitting results:', e.message);
    }
}

// ===== QUEUE OPERATIONS =====

/**
 * Thêm config vào hàng đợi quét
 * @param {Object} config - AiScanConfig document (plain object)
 * @param {Object} opts - { priority: 'high'|'normal', userId }
 */
function enqueueScan(config, opts = {}) {
    const configId = String(config._id);

    // Không enqueue nếu config đang chạy
    if (running.has(configId)) {
        console.log(`[Queue] Config "${config.name}" đang chạy, bỏ qua`);
        return false;
    }

    // Không enqueue trùng lặp trong hàng đợi
    const existsInQueue = queue.some(j => String(j.configId) === configId);
    if (existsInQueue) {
        console.log(`[Queue] Config "${config.name}" đã có trong hàng đợi, bỏ qua`);
        return false;
    }

    const job = {
        configId,
        userId: config.userId || opts.userId,
        config: { ...config, maxPostsPerScan: config.maxPostsPerScan || 10 },
        priority: opts.priority || 'normal',
        enqueuedAt: new Date()
    };

    if (job.priority === 'high') {
        queue.unshift(job); // Ưu tiên lên đầu
    } else {
        queue.push(job);
    }

    console.log(`[Queue] Đã thêm "${config.name}" vào hàng đợi (${queue.length} pending)`);
    emitQueueStatus(job.userId);

    // Trigger processing loop nếu chưa chạy
    if (!isProcessingLoop) {
        processQueue().catch(err => console.error('[Queue] Loop error:', err.message));
    }

    return true;
}

/**
 * Xử lý hàng đợi - chạy tuần tự từng config
 * Mỗi config được lock riêng, không block config khác
 */
async function processQueue() {
    if (isProcessingLoop) return;
    isProcessingLoop = true;

    try {
        while (queue.length > 0) {
            const job = queue.shift();
            const configId = String(job.configId);

            // Double-check không chạy trùng
            if (running.has(configId)) {
                console.log(`[Queue] Config "${job.config.name}" đang chạy, skip`);
                continue;
            }

            // Lock config này
            const runState = {
                status: 'running',
                name: job.config.name,
                startedAt: new Date(),
                retries: 0,
                error: null
            };
            running.set(configId, runState);
            emitQueueStatus(job.userId);

            let success = false;
            let lastError = null;

            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    runState.retries = attempt;
                    runState.error = null;
                    if (attempt > 0) {
                        console.log(`[Queue] Retry ${attempt}/${MAX_RETRIES} cho "${job.config.name}"...`);
                        await wait(RETRY_DELAY_MS);
                    }

                    const result = await runAiScan(job.config);
                    success = true;
                    console.log(`[Queue] ✓ "${job.config.name}" xong: crawl ${result.totalCrawled}, match ${result.matchingPosts}`);

                    // Cập nhật lastScanAt + nextScanAt
                    const now = new Date();
                    await AiScanConfig.updateOne({ _id: configId }, {
                        $set: {
                            lastScanAt: now,
                            nextScanAt: new Date(now.getTime() + (job.config.scanIntervalMinutes || 60) * 60000),
                            updatedAt: now
                        }
                    });
                    break;
                } catch (err) {
                    lastError = err;
                    runState.error = err.message;
                    console.error(`[Queue] ✗ "${job.config.name}" attempt ${attempt + 1} failed:`, err.message);
                }
            }

            // Unlock
            running.delete(configId);

            // Lưu completed history
            completed.push({
                configId,
                name: job.config.name,
                userId: job.userId,
                success,
                error: lastError ? lastError.message : null,
                startedAt: runState.startedAt,
                finishedAt: new Date()
            });
            if (completed.length > 50) completed.splice(0, completed.length - 50);

            emitQueueStatus(job.userId);

            // Gửi notification bell khi xong
            try {
                const { emitNotif } = require('../socketService');
                if (!success) {
                    emitNotif(job.userId, 'error', {
                        id: 'ai-scan:' + configId + ':error-' + Date.now(),
                        title: '❌ AI Scan lỗi: ' + job.config.name,
                        message: (lastError?.message || 'Lỗi không xác định').substring(0, 200),
                        source: 'ai-scan'
                    });
                }
            } catch (ne) { /* ignore */ }

            // Delay giữa các config
            if (queue.length > 0) {
                await wait(randomInt(2000, 5000));
            }
        }
    } finally {
        isProcessingLoop = false;
    }
}

// ===== CORE SCAN FUNCTIONS (giữ nguyên logic) =====

async function extractFbSessionFromPlaywright(channel) {
    console.log(`[Crawl] Opening Playwright to extract session cookies + fb_dtsg...`);

    const { context, sessionKey } = await getOrOpenFacebookContext(
        channel.userId || '', channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: true, existingSessionDir: channel.storageStatePath ? require('path').dirname(normalizeEncryptedValue(channel.storageStatePath)) : '' }
    );

    try {
        const page = context.pages()[0] || await context.newPage();
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const browserCookies = await context.cookies('https://www.facebook.com');
        const cookies = {};
        for (const c of browserCookies) {
            cookies[c.name] = c.value;
        }
        console.log(`[Crawl] ✓ Extracted ${Object.keys(cookies).length} cookies`);

        await page.waitForTimeout(5000);

        let fbDtsg = '';
        try {
            fbDtsg = await page.evaluate(() => {
                const input = document.querySelector('input[name="fb_dtsg"]');
                if (input) return input.value || '';
                const meta = document.querySelector('meta[name="csrf-token"]');
                if (meta) return meta.getAttribute('content') || '';
                const html = document.documentElement.innerHTML;
                const m1 = html.match(/"fb_dtsg"\s*:\s*"([^"]+)"/);
                if (m1) return m1[1];
                const m2 = html.match(/name="fb_dtsg"[^>]*value="([^"]+)"/);
                if (m2) return m2[1];
                const m3 = html.match(/"DTSGInitialData".*?"token"\s*:\s*"([^"]+)"/);
                if (m3) return m3[1];
                const m4 = html.match(/data-content='[^']*"token":"([^"]+)"/);
                if (m4) return m4[1];
                return '';
            });
        } catch (e) {
            console.log(`[Crawl] ⚠ Could not extract fb_dtsg via evaluate: ${e.message}`);
        }

        if (!fbDtsg) {
            try {
                const content = await page.content();
                const patterns = [
                    /"fb_dtsg"\s*:\s*"([^"]+)"/,
                    /name="fb_dtsg"[^>]*value="([^"]+)"/,
                    /"DTSGInitialData".*?"token"\s*:\s*"([^"]+)"/,
                    /fb_dtsg=([^&"]+)/
                ];
                for (const pattern of patterns) {
                    const match = content.match(pattern);
                    if (match) { fbDtsg = match[1]; break; }
                }
            } catch (e) {}
        }

        if (!fbDtsg) {
            try {
                const allCookies = await context.cookies('https://www.facebook.com');
                for (const c of allCookies) {
                    if (c.name === 'fb_dtsg') { fbDtsg = c.value; break; }
                }
            } catch (e) {}
        }

        console.log(`[Crawl] ✓ fb_dtsg: ${fbDtsg ? fbDtsg.substring(0, 20) + '...' : '(empty - GraphQL may fail!)'}`);
        return { cookies, fbDtsg, sessionKey, context };
    } catch (e) {
        try { await context.close(); } catch (ex) {}
        throw e;
    }
}

async function crawlPhase(config) {
    console.log(`\n[Crawl] ===== START CRAWL PHASE (GraphQL API) =====`);
    console.log(`[Crawl] Config: ${config.name} (ID: ${config._id})`);

    const channel = await Channel.findById(config.channelId).lean();
    if (!channel) { console.error(`[Crawl] ❌ Channel not found: ${config.channelId}`); throw new Error('Tài khoản Facebook không tồn tại'); }

    let fbSession;
    try {
        fbSession = await extractFbSessionFromPlaywright({ ...channel, userId: config.userId });
        console.log(`[Crawl] ✓ FB session extracted`);
    } catch (fbErr) {
        console.error(`[Crawl] ❌ Failed to extract FB session:`, fbErr.message);
        throw fbErr;
    }

    let totalCrawled = 0;

    try {
        const groupKeys = config.groupKeys || [];
        console.log(`[Crawl] Will scan ${groupKeys.length} groups via GraphQL API (concurrency: 5)`);

        // Chạy song song 5 groups mỗi batch thay vì tuần tự
        const CONCURRENT = 5;
        for (let i = 0; i < groupKeys.length; i += CONCURRENT) {
            const batch = groupKeys.slice(i, i + CONCURRENT);
            const batchNum = Math.floor(i / CONCURRENT) + 1;
            const totalBatches = Math.ceil(groupKeys.length / CONCURRENT);
            console.log(`[Crawl] Batch ${batchNum}/${totalBatches}: ${batch.length} groups`);

            const batchResults = await Promise.allSettled(batch.map(async (groupKey) => {
                let groupId = groupKey;
                const urlMatch = String(groupKey).match(/\/groups\/([^/?&]+)/);
                if (urlMatch) groupId = urlMatch[1];

                const groupUrl = groupKey.startsWith('http') ? groupKey : `https://www.facebook.com/groups/${groupId}`;
                console.log(`[Crawl] --- Crawling group: ${groupUrl} (ID: ${groupId}) ---`);

                const rawPosts = await fetchGroupPosts({
                    groupId,
                    cookies: fbSession.cookies,
                    fbDtsg: fbSession.fbDtsg,
                    limit: config.maxPostsPerScan || 10,
                    minComments: 0,
                    maxRetries: 5
                });

                console.log(`[Crawl] Got ${rawPosts.length} posts from group ${groupId}`);
                const saved = await savePostsToDb(rawPosts, config, groupUrl);
                return saved;
            }));

            for (const r of batchResults) {
                if (r.status === 'fulfilled') totalCrawled += r.value;
                else console.error(`[Crawl] ❌ Group error:`, r.reason?.message);
            }
        }

        await AiScanConfig.updateOne({ _id: config._id }, { $set: { lastScanAt: new Date(), updatedAt: new Date() } });
        console.log(`\n[Crawl] ===== CRAWL COMPLETE: ${totalCrawled} total posts =====\n`);
        
        if (totalCrawled > 0) {
            emitRealtimeResults(config.userId, config._id);
        }
        
        return { success: true, totalCrawled };
    } finally {
        try {
            if (fbSession?.context) await fbSession.context.close();
            const sessions = global.__facebookPlaywrightSessions;
            if (sessions && fbSession?.sessionKey) sessions.delete(fbSession.sessionKey);
        } catch (e) {}
    }
}

async function aiAnalyzePhase(config) {
    const settings = await Settings.findOne({ userId: config.userId }).lean();
    
    const provider = config.aiProvider || settings?.aiProvider || 'openai';
    let apiKey = '';
    if (provider === 'openai') {
        apiKey = config.openaiApiKey || settings?.openaiApiKey || process.env.OPENAI_API_KEY || '';
    } else if (provider === 'openai-compatible') {
        apiKey = config.openaiCompatibleApiKey || settings?.openaiCompatibleApiKey || config.openaiApiKey || settings?.openaiApiKey || process.env.OPENAI_API_KEY || '';
    } else if (provider === 'anthropic') {
        apiKey = config.anthropicApiKey || settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
    }
    
    if (provider !== 'openai') {
        if (provider === 'openai-compatible') {
            if (!config.openaiCompatibleApiKey) config.openaiCompatibleApiKey = apiKey;
            if (!config.openaiCompatibleBaseUrl) config.openaiCompatibleBaseUrl = settings?.openaiCompatibleBaseUrl || '';
            if (!config.openaiCompatibleModel) config.openaiCompatibleModel = settings?.openaiCompatibleModel || 'gpt-3.5-turbo';
        } else if (provider === 'anthropic') {
            if (!config.anthropicApiKey) config.anthropicApiKey = apiKey;
            if (!config.anthropicModel) config.anthropicModel = settings?.anthropicModel || 'claude-3-haiku-20240307';
        }
        config.aiProvider = provider;
    }

    const unscannedDocs = await AiScanResult.find({
        configId: config._id,
        aiAnalyzed: false
    }).limit(config.maxPostsPerScan || 50).exec();

    if (unscannedDocs.length === 0) {
        console.log(`[AI] No unscanned posts for config: ${config.name}`);
        return { success: true, totalAnalyzed: 0, matchingPosts: 0, commentedPosts: 0 };
    }

    const BATCH_SIZE = 5;
    const total = unscannedDocs.length;
    unscannedDocs.forEach((d, i) => { d._batchIndex = i + 1; d._batchTotal = total; });
    const allResults = [];

    for (let i = 0; i < unscannedDocs.length; i += BATCH_SIZE) {
        const batch = unscannedDocs.slice(i, i + BATCH_SIZE);
        console.log(`[AI] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(total / BATCH_SIZE)}: ${batch.length} posts`);
        const batchResults = await Promise.all(batch.map(doc => analyzeDbResult(doc, config, apiKey)));
        for (const r of batchResults) allResults.push(r);
        await wait(randomInt(300, 800));
    }

    const matchingResults = allResults.filter(r => r.isMatching);

    await AiScanConfig.updateOne({ _id: config._id }, { $set: { lastScanAt: new Date(), updatedAt: new Date() } });
    console.log(`[AI] Done. Analyzed: ${allResults.length}, Matched: ${matchingResults.length}`);

    if (allResults.length > 0) {
        emitRealtimeResults(config.userId, config._id);
    }

    return {
        success: true,
        totalAnalyzed: allResults.length,
        matchingPosts: matchingResults.length,
        commentedPosts: 0
    };
}

async function runAiScan(config) {
    console.log(`[Full Scan] Starting for: ${config.name}`);
    const useAiDetection = config.useAiDetection === true;
    console.log(`[Full Scan] Mode: ${useAiDetection ? 'AI DETECTION ON' : 'AI DETECTION OFF (keyword-based)'}`);

    const crawlResult = await crawlPhase(config);
    console.log(`[Full Scan] Crawl done: ${crawlResult.totalCrawled} posts`);

    let aiResult = { totalAnalyzed: 0, matchingPosts: 0, commentedPosts: 0 };

    if (!useAiDetection) {
        console.log(`[Full Scan] ⏭ Skipping AI analysis phase (useAiDetection=false). Posts already matched by keyword.`);
        const matchedCount = await AiScanResult.countDocuments({
            configId: config._id,
            isMatching: true
        });
        aiResult = {
            totalAnalyzed: 0,
            matchingPosts: matchedCount,
            commentedPosts: 0
        };
        return { ...crawlResult, ...aiResult };
    }

    const settings = await Settings.findOne({ userId: config.userId }).lean();

    const provider = config.aiProvider || settings?.aiProvider || 'openai';
    let hasKey = false;
    if (provider === 'openai') {
        hasKey = !!(config.openaiApiKey || settings?.openaiApiKey || process.env.OPENAI_API_KEY);
    } else if (provider === 'openai-compatible') {
        hasKey = !!(config.openaiCompatibleApiKey || settings?.openaiCompatibleApiKey || config.openaiApiKey || settings?.openaiApiKey || process.env.OPENAI_API_KEY);
    } else if (provider === 'anthropic') {
        hasKey = !!(config.anthropicApiKey || settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY);
    }

    if (hasKey) {
        try {
            aiResult = await aiAnalyzePhase(config);
            console.log(`[Full Scan] AI done: ${aiResult.totalAnalyzed} analyzed, ${aiResult.matchingPosts} matched`);
        } catch (err) {
            console.error(`[Full Scan] AI phase failed:`, err.message);
        }
    } else {
        console.log(`[Full Scan] ⏭ Skipping AI analysis (no API key).`);
        console.log(`[Full Scan] ↪ Falling back to keyword-based matching...`);
        const matchedCount = await AiScanResult.countDocuments({
            configId: config._id,
            isMatching: true
        });
        aiResult = { totalAnalyzed: 0, matchingPosts: matchedCount, commentedPosts: 0 };
    }

    // Terminal state → thông báo bell
    try {
        const { emitNotif } = require('../socketService');
        const totalScanned = (crawlResult && crawlResult.totalCrawled) || 0;
        const matched = (aiResult && aiResult.matchingPosts) || 0;
        if (totalScanned === 0) {
            emitNotif(config.userId, 'warning', {
                id: 'ai-scan:' + config._id + ':empty',
                title: '⚠️ AI Scan: ' + config.name,
                message: 'Không crawl được bài viết nào. Kiểm tra group FB hoặc tài khoản.',
                source: 'ai-scan'
            });
        } else {
            emitNotif(config.userId, matched > 0 ? 'success' : 'info', {
                id: 'ai-scan:' + config._id + ':done-' + Date.now(),
                title: matched > 0 ? '✅ AI Scan xong: ' + config.name : 'ℹ️ AI Scan: ' + config.name,
                message: 'Crawl ' + totalScanned + ' bài, match ' + matched + ' bài',
                source: 'ai-scan'
            });
        }
    } catch (e) { /* ignore */ }

    return { ...crawlResult, ...aiResult };
}

// ===== SCHEDULER (push vào queue thay vì chạy trực tiếp) =====

function isInTimeRange(config) {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentMinutes = hour * 60 + minute;
    
    const timeStart = config.scheduleTimeStart || '06:00';
    const timeEnd = config.scheduleTimeEnd || '23:00';
    
    const [startH, startM] = timeStart.split(':').map(Number);
    const [endH, endM] = timeEnd.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Kiểm tra configs đủ điều kiện → enqueue vào hàng đợi
 * Được gọi mỗi 30 giây từ app.js
 */
async function runScheduledScans() {
    try {
        const now = new Date();
        const configs = await AiScanConfig.find({
            isActive: true,
            scheduleEnabled: true
        }).lean();
    
        const toRun = configs.filter(c => {
            if (!isInTimeRange(c)) return false;
            if (c.lastScanAt) {
                const elapsed = (now - new Date(c.lastScanAt)) / 60000;
                if (elapsed < (c.scanIntervalMinutes || 60)) return false;
            }
            if (c.nextScanAt && new Date(c.nextScanAt) > now) return false;
            return true;
        });
        
        if (toRun.length > 0) {
            console.log(`[Scheduler] Enqueuing ${toRun.length} configs`);
            for (const cfg of toRun) {
                enqueueScan(cfg, { priority: 'normal', userId: cfg.userId });
            }
        }

        return toRun.map(c => ({ configId: c._id, name: c.name, enqueued: true }));
    } catch (err) {
        console.error('[Scheduler] Error:', err.message);
        return [];
    }
}

async function playCommentForResult(resultId) {
    return { success: false, message: 'Tính năng gửi comment đã bị tắt. AI Scan chỉ lưu bài viết dựa theo logic code.' };
}

module.exports = {
    emitRealtimeResults,
    extractFbSessionFromPlaywright,
    crawlPhase,
    aiAnalyzePhase,
    isScanSchedulerProcessing,
    runAiScan,
    isInTimeRange,
    runScheduledScans,
    playCommentForResult,
    // Queue API
    enqueueScan,
    getQueueStatus,
    processQueue
};
