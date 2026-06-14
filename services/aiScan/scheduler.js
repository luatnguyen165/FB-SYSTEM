// services/aiScan/scheduler.js
const AiScanConfig = require('../../models/AiScanConfig');
const AiScanResult = require('../../models/AiScanResult');
const Channel = require('../../models/Channel');
const Settings = require('../../models/Settings');
const AiComment = require('../../models/AiComment');
const { getOrOpenFacebookContext } = require('../facebook/session');
const { fetchGroupPosts } = require('../facebookGraphqlScraper');
const socketService = require('../socketService');
const { wait, randomInt } = require('./helpers');
const { analyzeDbResult } = require('./aiAnalysis');
const { savePostsToDb, crawlGroupPosts } = require('./crawler');
const { commentOnMatchingResults, sendMultipleComments, commentOnPostLegacy } = require('./comments');

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
        channel.userId || '', channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: true }
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
    const apiKey = config.openaiApiKey || (settings?.openaiApiKey || '');

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
    if (matchingResults.length > 0) {
        const channel = await Channel.findById(config.channelId).lean();
        if (channel) {
            const { context, sessionKey } = await getOrOpenFacebookContext(
                config.userId, channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: false }
            );
            const page = context.pages()[0] || await context.newPage();
            try {
                await commentOnMatchingResults(page, matchingResults, config);
            } finally {
                try { await context.close(); const sessions = global.__facebookPlaywrightSessions; if (sessions) sessions.delete(sessionKey); } catch (e) {}
            }
        }
    }

    await AiScanConfig.updateOne({ _id: config._id }, { $set: { lastScanAt: new Date(), updatedAt: new Date() } });
    console.log(`[AI] Done. Analyzed: ${allResults.length}, Matched: ${matchingResults.length}`);

    if (allResults.length > 0) {
        try { await emitRealtimeResults(config.userId, config._id); } catch (e) { console.error('[AI] Error emitting:', e.message); }
    }

    return {
        success: true,
        totalAnalyzed: allResults.length,
        matchingPosts: matchingResults.length,
        commentedPosts: matchingResults.filter(r => r.commentSent || (r.comments && r.comments.some(c => c.sent))).length
    };
}

async function runAiScan(config) {
    console.log(`[Full Scan] Starting for: ${config.name}`);
    const crawlResult = await crawlPhase(config);
    console.log(`[Full Scan] Crawl done: ${crawlResult.totalCrawled} posts`);
    
    const settings = await Settings.findOne({ userId: config.userId }).lean();
    const apiKey = config.openaiApiKey || (settings?.openaiApiKey || '');
    
    let aiResult = { totalAnalyzed: 0, matchingPosts: 0, commentedPosts: 0 };
    if (apiKey && apiKey.trim()) {
        try {
            aiResult = await aiAnalyzePhase(config);
            console.log(`[Full Scan] AI done: ${aiResult.totalAnalyzed} analyzed, ${aiResult.matchingPosts} matched`);
        } catch (err) {
            console.error(`[Full Scan] AI phase failed:`, err.message);
        }
    } else {
        console.log(`[Full Scan] ⏭ Skipping AI analysis (no API key).`);
    }
    
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
            results.push({ configId: cfg._id, name: cfg.name, success: false, error: e.message });
        }
        await wait(randomInt(3000, 8000));
    }
    return results;
}

async function playCommentForResult(resultId) {
    console.log(`[Play] ▶ Re-running comment for result: ${resultId}`);
    const doc = await AiScanResult.findById(resultId);
    if (!doc) return { success: false, message: 'Không tìm thấy kết quả' };
    if (!doc.postUrl) return { success: false, message: 'Bài viết không có URL' };

    const config = await AiScanConfig.findById(doc.configId).lean();
    if (!config) return { success: false, message: 'Không tìm thấy cấu hình quét' };

    const channel = await Channel.findById(doc.channelId || config.channelId).lean();
    if (!channel) return { success: false, message: 'Không tìm thấy tài khoản Facebook' };

    let context = null;
    let sessionKey = null;
    try {
        const ctx = await getOrOpenFacebookContext(
            config.userId, channel.accountName, channel.accountType || 'Cá nhân', 'FB', { headless: false }
        );
        context = ctx.context;
        sessionKey = ctx.sessionKey;
    } catch (e) {
        console.error(`[Play] ❌ Cannot open FB context:`, e.message);
        return { success: false, message: 'Không mở được trình duyệt Facebook: ' + e.message };
    }

    let page = null;
    try {
        page = context.pages()[0] || await context.newPage();

        const bankComments = await AiComment.find({ userId: config.userId, isActive: true })
            .sort({ order: 1 }).lean();

        let itemsToSend = [];
        if (bankComments && bankComments.length > 0) {
            itemsToSend = bankComments.map(bc => ({ type: bc.type, content: bc.content, caption: bc.caption || '' }));
        } else if (config.commentItems && config.commentItems.length > 0) {
            itemsToSend = config.commentItems.map(ci => ({ type: ci.type, content: ci.content, caption: ci.caption || '' }));
        } else if (config.commentScripts && config.commentScripts.length > 0) {
            const script = config.commentScripts[randomInt(0, config.commentScripts.length - 1)];
            const img = (config.commentImages && config.commentImages.length > 0)
                ? config.commentImages[randomInt(0, config.commentImages.length - 1)] : '';
            const text = script
                .replace(/\{ten_sp\}/g, config.niche || 'sản phẩm')
                .replace(/\{gia\}/g, 'Liên hệ')
                .replace(/\{nganh\}/g, config.niche || '');
            itemsToSend = [];
            if (text && img) itemsToSend.push({ type: 'image', content: img, caption: text });
            else if (img) itemsToSend.push({ type: 'image', content: img, caption: '' });
            else if (text) itemsToSend.push({ type: 'text', content: text, caption: '' });
        }

        if (itemsToSend.length === 0) {
            return { success: false, message: 'Cấu hình không có comment nào để gửi' };
        }

        console.log(`[Play] Navigating to: ${doc.postUrl}`);
        await page.goto(doc.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const commentResults = await sendMultipleComments(page, itemsToSend);
        const anySent = commentResults.some(r => r.sent);
        const firstError = commentResults.find(r => r.error)?.error || '';

        doc.comments = commentResults;
        doc.commentSent = anySent;
        doc.commentContent = commentResults.filter(r => r.type === 'text').map(r => r.content).join(' | ');
        doc.commentImage = commentResults.find(r => r.type === 'image')?.content || '';
        doc.commentError = firstError;
        doc.commentedAt = anySent ? new Date() : (doc.commentedAt || null);
        await doc.save();

        console.log(`[Play] ✓ Done. Sent: ${anySent}, Error: ${firstError || 'none'}`);
        return {
            success: anySent,
            message: anySent ? 'Đã gửi comment thành công!' : ('Gửi comment thất bại: ' + (firstError || 'không rõ lỗi')),
            result: doc
        };
    } catch (err) {
        console.error(`[Play] ❌ Error:`, err.message);
        try { doc.commentError = err.message; await doc.save(); } catch (e) {}
        return { success: false, message: 'Lỗi: ' + err.message };
    } finally {
        try {
            if (context) await context.close();
            const sessions = global.__facebookPlaywrightSessions;
            if (sessions && sessionKey) sessions.delete(sessionKey);
        } catch (e) {}
    }
}

module.exports = {
    emitRealtimeResults,
    extractFbSessionFromPlaywright,
    crawlPhase,
    aiAnalyzePhase,
    runAiScan,
    isInTimeRange,
    runScheduledScans,
    playCommentForResult
};