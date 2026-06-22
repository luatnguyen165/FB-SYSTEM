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

// ===== RE-ENTRANT GUARD =====
let isProcessing = false;

function isScanSchedulerProcessing() { return isProcessing; }

async function emitRealtimeResults(userId, configId) {
    try {
        const [totalScanned, totalMatched, totalCommented] = await Promise.all([
            AiScanResult.countDocuments({ userId }),
            AiScanResult.countDocuments({ userId, isMatching: true }),
            AiScanResult.countDocuments({ userId, commentSent: true })
        ]);
        
        socketService.emitStatsUpdate(userId, {
            totalScanned,
            totalMatched,
            totalCommented
        });
        
        const latestResults = await AiScanResult.find({ userId, configId })
            .sort({ scannedAt: -1 })
            .limit(5)
            .lean();
        
        if (latestResults.length > 0) {
            socketService.emitNewResults(userId, latestResults);
        }
    } catch (e) {
        console.error('[Realtime] Error emitting results:', e.message);
    }
}

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
    if (!channel) { console.error(`[Crawl] ❌ Channel not found: ${config.channelId}`); throw new Error('Tài khoản Facebook không tồnatable'); }

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
        console.log(`[Crawl] Will scan ${groupKeys.length} groups via GraphQL API`);

        for (const groupKey of groupKeys) {
            try {
                let groupId = groupKey;
                const urlMatch = String(groupKey).match(/\/groups\/([^/?&]+)/);
                if (urlMatch) groupId = urlMatch[1];

                const groupUrl = groupKey.startsWith('http') ? groupKey : `https://www.facebook.com/groups/${groupId}`;
                console.log(`\n[Crawl] --- Crawling group: ${groupUrl} (ID: ${groupId}) ---`);

                let rawPosts = [];
                try {
                    rawPosts = await fetchGroupPosts({
                        groupId,
                        cookies: fbSession.cookies,
                        fbDtsg: fbSession.fbDtsg,
                        limit: config.maxPostsPerScan || 10,
                        minComments: 0,
                        maxRetries: 5
                    });
                } catch (fetchErr) {
                    console.error(`[Crawl] ❌ fetchGroupPosts threw error:`, fetchErr.message);
                }

                console.log(`[Crawl] Got ${rawPosts.length} posts from GraphQL API`);
                const saved = await savePostsToDb(rawPosts, config, groupUrl);
                totalCrawled += saved;
            } catch (e) {
                console.error(`[Crawl] ❌ Error crawling group:`, e.message);
            }
        }

        await AiScanConfig.updateOne({ _id: config._id }, { $set: { lastScanAt: new Date(), updatedAt: new Date() } });
        console.log(`\n[Crawl] ===== CRAWL COMPLETE: ${totalCrawled} total posts =====\n`);
        
        if (totalCrawled > 0) {
            try { await emitRealtimeResults(config.userId, config._id); } catch (e) { console.error('[Crawl] Error emitting:', e.message); }
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
    
    // Determine provider & API key from config or settings
    const provider = config.aiProvider || settings?.aiProvider || 'openai';
    let apiKey = '';
    if (provider === 'openai') {
        apiKey = config.openaiApiKey || settings?.openaiApiKey || process.env.OPENAI_API_KEY || '';
    } else if (provider === 'openai-compatible') {
        apiKey = config.openaiCompatibleApiKey || settings?.openaiCompatibleApiKey || config.openaiApiKey || settings?.openaiApiKey || process.env.OPENAI_API_KEY || '';
    } else if (provider === 'anthropic') {
        apiKey = config.anthropicApiKey || settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '';
    }
    
    // Ensure config has the correct provider fields for analyzeDbResult to use
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
        try { await emitRealtimeResults(config.userId, config._id); } catch (e) { console.error('[AI] Error emitting:', e.message); }
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

    // ===== BỎ QUA AI PHASE NẾU TẮT =====
    let aiResult = { totalAnalyzed: 0, matchingPosts: 0, commentedPosts: 0 };

    if (!useAiDetection) {
        console.log(`[Full Scan] ⏭ Skipping AI analysis phase (useAiDetection=false). Posts already matched by keyword.`);
        // Đếm số bài match đã được set trong crawl phase
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

    // Detect provider and get appropriate API key
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
        // Fallback: nếu không có key, dùng keyword filter
        console.log(`[Full Scan] ↪ Falling back to keyword-based matching...`);
        const matchedCount = await AiScanResult.countDocuments({
            configId: config._id,
            isMatching: true
        });
        aiResult = { totalAnalyzed: 0, matchingPosts: matchedCount, commentedPosts: 0 };
    }

    // Terminal state → thông báo bell (CHỈ khi chạy xong, không thông báo running)
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

async function runScheduledScans() {
    // Re-entrant guard: skip nếu tick trước còn đang chạy
    if (isProcessing) {
        console.log('[AI Scan Scheduler] Skipped - previous tick still running');
        return [];
    }
    isProcessing = true;
    const startedAt = Date.now();

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
    
    console.log(`[Scheduler] Running ${toRun.length} configs`);
    const results = [];
    for (const cfg of toRun) {
        try {
            const scanConfig = { ...cfg, maxPostsPerScan: cfg.maxPostsPerScan || 10 };
            await runAiScan(scanConfig);
            await AiScanConfig.updateOne({ _id: cfg._id }, {
                $set: {
                    lastScanAt: new Date(),
                    nextScanAt: new Date(now.getTime() + (cfg.scanIntervalMinutes || 60) * 60000),
                    updatedAt: new Date()
                }
            });
            results.push({ configId: cfg._id, name: cfg.name, success: true });
        } catch (e) {
            console.error(`[Scheduler] Error ${cfg.name}:`, e.message);
            // Thông báo bell khi config fail (terminal state)
            try {
                const { emitNotif } = require('../socketService');
                emitNotif(cfg.userId, 'error', {
                    id: 'ai-scan:' + cfg._id + ':error-' + Date.now(),
                    title: '❌ AI Scan lỗi: ' + cfg.name,
                    message: (e.message || 'Lỗi không xác định').substring(0, 200),
                    source: 'ai-scan'
                });
            } catch (ne) { /* ignore */ }
            results.push({ configId: cfg._id, name: cfg.name, success: false, error: e.message });
        }
        await wait(randomInt(3000, 8000));
    }
    return results;
    } finally {
        isProcessing = false;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (elapsed > 5) {
            console.log(`[AI Scan Scheduler] Tick xong trong ${elapsed}s`);
        }
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
    playCommentForResult
};