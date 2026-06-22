// services/facebook/groups.js
const FacebookGroupCache = require('../../models/FacebookGroupCache');
const { ACTIVE_FB_SESSIONS, GROUP_SCAN_JOBS, getOrOpenFacebookContext } = require('./session');
const socketService = require('../socketService');

const FACEBOOK_GROUPS_JOINS_URL = 'https://www.facebook.com/groups/joins/?nav_source=tab';

function buildInvalidGroupSegments() {
    return new Set([
        'feed', 'discover', 'create', 'search', 'settings', 'joined', 'your', 'invites', 'pending',
        'suggestions', 'popular', 'explore', 'recommendations', 'feeds', 'top_chats', 'groups'
    ]);
}

function normalizeGroupLabel(value = '') {
    return String(value).replace(/\s+/g, ' ').trim();
}

async function extractFacebookGroupsFromPage(page, invalidSegments) {
    return page.evaluate(({ invalidSegmentsList }) => {
        const normalizeText = (value = '') => String(value).replace(/\s+/g, ' ').trim();
        const invalidSegments = new Set(invalidSegmentsList || []);

        const anchors = Array.from(document.querySelectorAll('a[href*="/groups/"]'));
        const items = [];

        anchors.forEach((anchor) => {
            const rawHref = anchor.getAttribute('href') || '';
            const label = normalizeText(anchor.innerText || anchor.textContent || '');
            if (!rawHref || !label) return;

            let url;
            try {
                url = new URL(rawHref, location.origin);
            } catch (err) {
                return;
            }

            const match = url.pathname.match(/^\/groups\/([^/?#]+)/i);
            if (!match) return;

            const groupId = match[1].trim();
            if (!groupId || invalidSegments.has(groupId.toLowerCase())) return;
            if (label.length < 2) return;

            items.push({
                groupId,
                groupUrl: url.toString(),
                groupName: label
            });
        });

        return items;
    }, { invalidSegmentsList: Array.from(invalidSegments) });
}

async function extractFacebookGroupsFromPageV2(page) {
    return page.$$eval('a[href*="/groups/"]', elements => {
        return elements
            .filter(el => {
                const href = el.href;
                const text = el.innerText.trim();
                const isGroupLink = /\/groups\/\d+\/$/.test(href);
                const isMenuLink = href.includes('/joins') || href.includes('/feed') || href.includes('/discover') || 
                                   href.includes('/search') || href.includes('/settings') || href.includes('/create') ||
                                   href.includes('/members') || href.includes('/photos') || href.includes('/videos') || href.includes('/files');
                return isGroupLink && !isMenuLink && text !== "" && text !== "Xem nhom";
            })
            .map(el => ({ name: el.innerText.split('\n')[0], url: el.href }));
    });
}

async function scrapeGroupsFromJoinsPage({ page, maxScrollRounds = 5, scrollDelayMs = 3000, onProgress, onGroupsFound, maxGroups = 0 }) {
    const joinsUrl = 'https://www.facebook.com/groups/joins/?nav_source=tab';
    return scrapeGroupsFromUrl({ page, targetUrl: joinsUrl, maxScrollRounds, scrollDelayMs, onProgress, onGroupsFound, maxGroups });
}

async function scrapeGroupsFromUrl({ page, targetUrl, maxScrollRounds = 5, scrollDelayMs = 3000, scrollAmount = 3000, onProgress, onGroupsFound, maxGroups = 0 }) {
    const discoveredById = new Map();
    let retryCount = 0;
    let lastHeight = 0;
    let totalNewGroups = 0;
    
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2500);

    if (onProgress) onProgress({ phase: 'loading', message: 'Dang tai trang...', found: 0, newGroups: 0 });

    while (retryCount < maxScrollRounds) {
        if (maxGroups > 0 && discoveredById.size >= maxGroups) break;

        const currentGroups = await page.$$eval('a[href*="/groups/"]', elements => {
            return elements
                .filter(el => {
                    const href = el.href;
                    const text = el.innerText.trim();
                    const isGroupLink = /\/groups\/\d+\/$/.test(href);
                    const isMenuLink = href.includes('/joins') || href.includes('/feed') || href.includes('/discover') || 
                                       href.includes('/search') || href.includes('/settings') || href.includes('/create') ||
                                       href.includes('/members') || href.includes('/photos') || href.includes('/videos') || href.includes('/files');
                    return isGroupLink && !isMenuLink && text !== "" && text !== "Xem nhom";
                })
                .map(el => ({ name: el.innerText.split('\n')[0], url: el.href }));
        });

        let newGroups = 0;
        const newFoundGroups = [];
        for (const group of currentGroups) {
            const match = group.url.match(/\/groups\/(\d+)\//);
            if (!match) continue;
            const groupId = match[1];
            
            if (!discoveredById.has(groupId)) {
                const groupData = {
                    groupId: groupId,
                    groupUrl: group.url,
                    groupName: group.name
                };
                discoveredById.set(groupId, groupData);
                newFoundGroups.push(groupData);
                newGroups++;
                totalNewGroups++;
                
                if (maxGroups > 0 && discoveredById.size >= maxGroups) break;
            }
        }
        
        if (onGroupsFound && newFoundGroups.length > 0) {
            const currentGroupsArray = Array.from(discoveredById.values());
            try {
                await onGroupsFound(currentGroupsArray, newFoundGroups);
            } catch (e) { /* silent */ }
        }
        
        if (onProgress) {
            onProgress({ 
                phase: 'scraping', 
                message: `Da tim thay ${discoveredById.size} group...`, 
                found: discoveredById.size,
                newGroups: totalNewGroups,
                round: retryCount + 1,
                maxRounds: maxScrollRounds
            });
        }
        
        await page.mouse.wheel(0, scrollAmount || 3000);
        await page.waitForTimeout(scrollDelayMs);

        const newHeight = await page.evaluate('document.body.scrollHeight');
        if (newHeight === lastHeight) {
            retryCount++;
        } else {
            retryCount = 0;
            lastHeight = newHeight;
        }
    }

    if (onProgress) {
        onProgress({ 
            phase: 'complete', 
            message: `Hoan tat! Da tim thay ${discoveredById.size} group`, 
            found: discoveredById.size,
            newGroups: totalNewGroups
        });
    }

    return Array.from(discoveredById.values())
        .filter(group => group.groupName && group.groupId)
        .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));
}

async function scanFacebookGroups({
    page,
    candidateUrls,
    invalidSegments,
    initialWaitMs,
    maxRoundsPerUrl,
    scrollWaitMs,
    stableThreshold,
    stopAfterStablePasses,
    discovered
}) {
    const discoveredMap = discovered || new Map();

    const addGroupsFromPage = async () => {
        const pageGroups = await extractFacebookGroupsFromPage(page, invalidSegments);
        let added = 0;
        for (const group of pageGroups) {
            if (!group.groupId) continue;
            // DEDUP THEO groupId ONLY (1 group có thể có nhiều URL variants)
            if (!discoveredMap.has(group.groupId)) {
                discoveredMap.set(group.groupId, group);
                added += 1;
            }
        }
        return added;
    };

    let stablePasses = 0;
    for (const url of candidateUrls) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(initialWaitMs);

        let previousCount = -1;
        let stableRounds = 0;
        for (let round = 0; round < maxRoundsPerUrl; round++) {
            await addGroupsFromPage();

            const currentCount = discoveredMap.size;
            if (currentCount === previousCount) {
                stableRounds += 1;
            } else {
                stableRounds = 0;
                previousCount = currentCount;
            }

            if (stableRounds >= stableThreshold) break;

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
            await page.waitForTimeout(scrollWaitMs);
        }
    }

    return discoveredMap;
}

async function persistFacebookGroupCache({ userId, channelId, accountName, accountType, groups }) {
    // Dedup groups theo groupId trước khi lưu (1 group có thể xuất hiện với nhiều URL variants)
    const dedupedGroups = dedupGroupsById(groups);

    const result = await FacebookGroupCache.findOneAndUpdate(
        { userId, channelId },
        {
            userId,
            channelId,
            accountName,
            accountType: accountType || 'Cá nhân',
            groups: dedupedGroups,
            updatedAt: new Date()
        },
        { upsert: true, returnDocument: "after" }
    );
    console.log(`[Group Cache] Saved ${dedupedGroups.length} groups (deduped from ${groups.length}) for user ${userId}, channel ${channelId}`);
    return result;
}

/**
 * Loại bỏ groups trùng lặp theo groupId. Giữ lại bản ghi đầu tiên.
 */
function dedupGroupsById(groups) {
    if (!Array.isArray(groups)) return [];
    const seen = new Map();
    for (const g of groups) {
        if (g && g.groupId && !seen.has(g.groupId)) {
            seen.set(g.groupId, g);
        }
    }
    return Array.from(seen.values());
}

async function getJoinedFacebookGroups(userId, accountName, accountType = 'Cá nhân', platform = 'FB', existingSessionDir = '') {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, platform, { headless: true, existingSessionDir });

    try {
        const page = context.pages()[0] || await context.newPage();
        const discovered = await scanFacebookGroups({
            page,
            candidateUrls: [FACEBOOK_GROUPS_JOINS_URL],
            invalidSegments: buildInvalidGroupSegments(),
            initialWaitMs: 2500,
            maxRoundsPerUrl: 10,
            scrollWaitMs: 1800,
            stableThreshold: 2
        });

        return Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'))
            .filter((group, idx, arr) => arr.findIndex(g => g.groupId === group.groupId) === idx); // dedup theo groupId
    } finally {
        if (isExternal) {
            await context.close().catch(() => {});
            ACTIVE_FB_SESSIONS.delete(sessionKey);
        }
    }
}

async function getJoinedFacebookGroupsDeep({ userId, channelId, accountName, accountType = 'Cá nhân', existingSessionDir = '' }) {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: true, existingSessionDir });

    try {
        const page = context.pages()[0] || await context.newPage();
        const discovered = new Map();
        let stableDeepPasses = 0;
        const maxPasses = 12;

        for (let pass = 0; pass < maxPasses; pass++) {
            const beforeCount = discovered.size;

            await scanFacebookGroups({
                page,
                candidateUrls: [FACEBOOK_GROUPS_JOINS_URL],
                invalidSegments: buildInvalidGroupSegments(),
                initialWaitMs: 2200,
                maxRoundsPerUrl: 10,
                scrollWaitMs: 1600,
                stableThreshold: 2,
                discovered
            });

            const afterCount = discovered.size;
            if (afterCount === beforeCount) {
                stableDeepPasses += 1;
            } else {
                stableDeepPasses = 0;
                await persistFacebookGroupCache({
                    userId,
                    channelId,
                    accountName,
                    accountType,
                    groups: Array.from(discovered.values())
                });
            }

            if (stableDeepPasses >= 2) break;
        }

        const groups = Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'))
            .filter((group, idx, arr) => arr.findIndex(g => g.groupId === group.groupId) === idx);

        await persistFacebookGroupCache({
            userId,
            channelId,
            accountName,
            accountType,
            groups
        });

        return groups;
    } finally {
        if (isExternal) {
            await context.close().catch(() => {});
            ACTIVE_FB_SESSIONS.delete(sessionKey);
        }
    }
}

async function getJoinedFacebookGroupsQuick({ userId, channelId, accountName, accountType = 'Cá nhân', existingSessionDir = '' }) {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless: true, existingSessionDir });

    try {
        const page = context.pages()[0] || await context.newPage();

        const discovered = await scanFacebookGroups({
            page,
            candidateUrls: [FACEBOOK_GROUPS_JOINS_URL],
            invalidSegments: buildInvalidGroupSegments(),
            initialWaitMs: 900,
            maxRoundsPerUrl: 4,
            scrollWaitMs: 700,
            stableThreshold: 1
        });

        const groups = Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'))
            .filter((group, idx, arr) => arr.findIndex(g => g.groupId === group.groupId) === idx);

        await persistFacebookGroupCache({
            userId,
            channelId,
            accountName,
            accountType,
            groups
        });

        return groups;
    } finally {
        if (isExternal) {
            await context.close().catch(() => {});
            ACTIVE_FB_SESSIONS.delete(sessionKey);
        }
    }
}

async function getJoinedFacebookGroupsCached({ userId, channelId, accountName, accountType = 'Cá nhân', forceRefresh = false, scanMode = 'fast', existingSessionDir = '' }) {
    if (!userId || !channelId) {
        throw new Error('Thieu thong tin tai khoan Facebook de lay group');
    }

    const cachedDoc = await FacebookGroupCache.findOne({ userId, channelId }).lean();
    if (cachedDoc?.groups?.length && !forceRefresh) {
        return {
            groups: cachedDoc.groups,
            source: 'cache',
            updatedAt: cachedDoc.updatedAt || null,
            scanStatus: cachedDoc.scanStatus || 'idle'
        };
    }

    const groups = forceRefresh
        ? (scanMode === 'deep'
            ? await getJoinedFacebookGroupsDeep({ userId, channelId, accountName, accountType, existingSessionDir })
            : await getJoinedFacebookGroupsQuick({ userId, channelId, accountName, accountType, existingSessionDir }))
        : await getJoinedFacebookGroups(userId, accountName, accountType, 'FB', existingSessionDir);

    await persistFacebookGroupCache({
        userId,
        channelId,
        accountName,
        accountType,
        groups
    });

    return {
        groups,
        source: forceRefresh ? 'scrape-deep' : 'scrape',
        updatedAt: new Date(),
        scanStatus: 'completed'
    };
}

// =============================================================
// AUTO SCAN GROUPS DƯỚI NỀN (BACKGROUND) KHI THÊM TÀI KHOẢN FB
// =============================================================
//
// - Fire-and-forget: gọi xong không await, response client trả về ngay.
// - Tận dụng session Playwright đang mở (sessionKey) để không mở Chrome mới.
// - Nếu session đã đóng trước khi scan xong → mở context mới qua existingSessionDir.
// - Đã có cache groups thì skip (idempotent).
// - Lưu scanStatus vào FacebookGroupCache để frontend poll.
// - Emit Socket.IO để UI realtime (nếu user đang mở trang groups).

const BG_SCAN_TIMEOUT_MS = 5 * 60 * 1000; // 5 phút

// ===== SEMAPHORE CHO CHROME CONTEXTS =====
// Chống mở quá nhiều Chrome process cùng lúc khi backfill nhiều accounts
// Mỗi Chrome context chiếm ~200-400MB RAM
const MAX_CONCURRENT_BG_SCANS = 2;
let activeBgScanCount = 0;
const bgScanWaitingQueue = [];

function tryRunBackgroundScan(opts) {
    const { sessionKey, userId, channelId, accountName, accountType, existingSessionDir, scanMode, force } = opts;

    const jobKey = sessionKey || `${userId}:${channelId}`;
    const logPrefix = `[BG Group Scan] ${accountName} ch=${channelId}`;

    if (activeBgScanCount >= MAX_CONCURRENT_BG_SCANS) {
        bgScanWaitingQueue.push(opts);
        console.log(`${logPrefix} Queue full (${activeBgScanCount}/${MAX_CONCURRENT_BG_SCANS}), pending=${bgScanWaitingQueue.length}`);
        return false;
    }

    activeBgScanCount++;
    console.log(`${logPrefix} Active=${activeBgScanCount}/${MAX_CONCURRENT_BG_SCANS} | Starting...`);

    runBackgroundGroupScan({
        sessionKey, userId, channelId, accountName, accountType, existingSessionDir, scanMode
    })
    .catch((err) => {
        console.error(`${logPrefix} Unhandled error:`, err.message);
    })
    .finally(() => {
        activeBgScanCount--;
        // Chạy job tiếp theo trong queue (nếu có)
        if (bgScanWaitingQueue.length > 0) {
            const next = bgScanWaitingQueue.shift();
            setImmediate(() => tryRunBackgroundScan(next));
        }
    });

    return true;
}

function getBgScanQueueStats() {
    return {
        active: activeBgScanCount,
        maxConcurrent: MAX_CONCURRENT_BG_SCANS,
        pending: bgScanWaitingQueue.length
    };
}

async function runBackgroundGroupScan({
    sessionKey, userId, channelId, accountName, accountType = 'Cá nhân', existingSessionDir = '', scanMode = 'fast'
}) {
    const logPrefix = `[BG Group Scan] ${accountName} (${accountType}) ch=${channelId}`;
    let context = null;
    let openedContextHere = false;
    let sessionKeyForCleanup = sessionKey;

    try {
        console.log(`${logPrefix} Bắt đầu scan ngầm (mode=${scanMode})...`);

        // 1. Mark running trong DB
        await FacebookGroupCache.findOneAndUpdate(
            { userId, channelId },
            {
                $set: {
                    scanStatus: 'running',
                    scanStartedAt: new Date(),
                    scanFinishedAt: null,
                    scanError: ''
                },
                $setOnInsert: {
                    userId, channelId, accountName, accountType,
                    groups: [], updatedAt: new Date()
                }
            },
            { upsert: true, new: true }
        );

        // 2. Lấy context: ưu tiên session đang mở, fallback existingSessionDir
        const session = sessionKey ? ACTIVE_FB_SESSIONS.get(sessionKey) : null;
        if (session?.context && !session.context.browser()?.isConnected?.() === false) {
            context = session.context;
            console.log(`${logPrefix} Tái sử dụng session đang mở (key=${sessionKey})`);
        } else {
            const result = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', {
                headless: true,
                existingSessionDir
            });
            context = result.context;
            sessionKeyForCleanup = result.sessionKey;
            openedContextHere = true;
            console.log(`${logPrefix} Mở context mới (key=${sessionKeyForCleanup})`);
        }

        // 3. Chạy scan với timeout
        const page = context.pages()[0] || await context.newPage();
        const discovered = new Map();
        const scanPromise = scanFacebookGroups({
            page,
            candidateUrls: [FACEBOOK_GROUPS_JOINS_URL],
            invalidSegments: buildInvalidGroupSegments(),
            initialWaitMs: 2000,
            maxRoundsPerUrl: scanMode === 'deep' ? 10 : 6,
            scrollWaitMs: 1500,
            stableThreshold: 2,
            discovered
        });
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout ${BG_SCAN_TIMEOUT_MS / 1000}s khi scan groups`)), BG_SCAN_TIMEOUT_MS)
        );
        await Promise.race([scanPromise, timeoutPromise]);

        const groups = Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'));

        // 4. Persist + mark completed
        await FacebookGroupCache.findOneAndUpdate(
            { userId, channelId },
            {
                $set: {
                    groups,
                    updatedAt: new Date(),
                    scanStatus: 'completed',
                    scanFinishedAt: new Date(),
                    scannedGroupsCount: groups.length,
                    scanError: ''
                },
                $setOnInsert: { accountName, accountType }
            },
            { upsert: true, new: true }
        );

        console.log(`${logPrefix} ✓ Hoàn thành: ${groups.length} groups`);

        // 5. Emit Socket.IO realtime
        try {
            socketService.emitGroupsComplete?.(userId, {
                channelId: String(channelId),
                accountName,
                totalGroups: groups.length,
                source: 'background-scan',
                message: `Đã tự động quét ${groups.length} nhóm cho tài khoản "${accountName}"`
            });
        } catch (e) {
            console.warn(`${logPrefix} Emit socket failed:`, e.message);
        }

        return { success: true, count: groups.length };
    } catch (err) {
        console.error(`${logPrefix} ✗ Lỗi:`, err.message || err);
        await FacebookGroupCache.findOneAndUpdate(
            { userId, channelId },
            {
                $set: {
                    scanStatus: 'failed',
                    scanFinishedAt: new Date(),
                    scanError: String(err.message || err).substring(0, 500)
                }
            },
            { upsert: false }
        ).catch(() => {});
        return { success: false, error: err.message };
    } finally {
        // Cleanup
        if (openedContextHere && context) {
            try { await context.close(); } catch (e) {}
            if (sessionKeyForCleanup) ACTIVE_FB_SESSIONS.delete(sessionKeyForCleanup);
        }
        if (sessionKey) GROUP_SCAN_JOBS.delete(sessionKey);
    }
}

/**
 * Khởi động background scan groups (fire-and-forget).
 * - Idempotent: nếu đang scan cùng sessionKey thì skip.
 * - Nếu account đã có groups trong cache → skip (tránh scan lại khi reconnect).
 * - Không throw, không block caller.
 *
 * @param {Object} opts
 * @param {string} opts.sessionKey     - Key của session Playwright đang mở (ưu tiên)
 * @param {string} opts.userId         - ID user
 * @param {string} opts.channelId      - ID Channel
 * @param {string} opts.accountName
 * @param {string} [opts.accountType='Cá nhân']
 * @param {string} [opts.existingSessionDir='']
 * @param {'fast'|'deep'} [opts.scanMode='fast']
 * @param {boolean} [opts.force=false] - Nếu true thì scan dù đã có cache
 */
function startBackgroundGroupScan(opts = {}) {
    const { sessionKey, userId, channelId, accountName, accountType, existingSessionDir, scanMode = 'fast', force = false } = opts;

    if (!userId || !channelId || !accountName) {
        console.warn('[BG Group Scan] Thiếu tham số bắt buộc (userId/channelId/accountName)');
        return false;
    }

    // Re-entrant guard theo sessionKey
    if (sessionKey && GROUP_SCAN_JOBS.has(sessionKey)) {
        console.log(`[BG Group Scan] Đã có job đang chạy cho sessionKey=${sessionKey}, skip`);
        return false;
    }

    // Mark job trước khi async chạy để chống race
    const jobKey = sessionKey || `${userId}:${channelId}`;
    GROUP_SCAN_JOBS.set(jobKey, { startedAt: Date.now(), userId, channelId });

    // Check idempotent (cache đã có groups)
    (async () => {
        try {
            if (!force) {
                const existing = await FacebookGroupCache.findOne({ userId, channelId }).lean();
                if (existing?.groups?.length > 0) {
                    console.log(`[BG Group Scan] ${accountName}: cache đã có ${existing.groups.length} groups, skip scan ngầm`);
                    GROUP_SCAN_JOBS.delete(jobKey);
                    return;
                }
                // Nếu đang chạy rồi (do process restart) thì cũng skip
                if (existing?.scanStatus === 'running' && existing?.scanStartedAt) {
                    const elapsed = Date.now() - new Date(existing.scanStartedAt).getTime();
                    if (elapsed < BG_SCAN_TIMEOUT_MS) {
                        console.log(`[BG Group Scan] ${accountName}: scan đang chạy ở process khác (${Math.round(elapsed / 1000)}s ago), skip`);
                        GROUP_SCAN_JOBS.delete(jobKey);
                        return;
                    }
                }
            }

            // Dùng semaphore (tối đa 2 Chrome contexts cùng lúc) thay vì fire trực tiếp
            tryRunBackgroundScan({
                sessionKey, userId, channelId, accountName, accountType, existingSessionDir, scanMode, force
            });
        } catch (err) {
            console.error(`[BG Group Scan] Pre-check error:`, err.message);
            GROUP_SCAN_JOBS.delete(jobKey);
        }
    })();

    return true;
}

// =============================================================
// BACKFILL: Quét groups cho FB accounts chưa có cache
// =============================================================
//
// Dùng cho 2 trường hợp:
// 1. User cũ có tài khoản FB đã thêm từ lâu, chưa từng được scan groups
//    → Khi mở trang groups hoặc login, tự động kick off scan cho account đó
// 2. Cron job định kỳ quét toàn bộ user → cover edge case user mới

const Channel = require('../../models/Channel');

/**
 * Tìm tất cả FB account của 1 user CHƯA CÓ cache groups hợp lệ.
 * @param {string} userId
 * @returns {Promise<Array<{channelId, accountName, accountType, existingSessionDir}>>}
 */
async function findFbAccountsMissingGroupCache(userId) {
    if (!userId) return [];
    const channels = await Channel.find({
        userId,
        platform: 'FB',
        isEnabled: true
    }).select('_id accountName accountType storageStatePath').lean();

    if (!channels.length) return [];

    const channelIds = channels.map(c => c._id);
    const caches = await FacebookGroupCache.find({
        userId,
        channelId: { $in: channelIds },
        scanStatus: 'completed'
    }).select('channelId groups').lean();

    const cachedIds = new Set(
        caches
            .filter(c => Array.isArray(c.groups) && c.groups.length > 0)
            .map(c => String(c.channelId))
    );

    // Lọc ra accounts chưa có cache hợp lệ
    const { normalizeEncryptedValue } = require('../../utils/cryptoVault');
    return channels
        .filter(ch => !cachedIds.has(String(ch._id)))
        .map(ch => ({
            channelId: ch._id,
            accountName: normalizeEncryptedValue(ch.accountName),
            accountType: normalizeEncryptedValue(ch.accountType) || 'Cá nhân',
            existingSessionDir: ch.storageStatePath
                ? require('path').dirname(ch.storageStatePath)
                : ''
        }));
}

/**
 * Backfill cho 1 user cụ thể: kick off scan groups cho mọi FB account chưa có cache.
 * Fire-and-forget, không await, không throw.
 * @param {string} userId
 * @param {Object} [opts]
 * @param {boolean} [opts.silent=false] - không log nếu không có gì để làm
 */
function backfillMissingGroupCaches(userId, { silent = false } = {}) {
    if (!userId) return;
    (async () => {
        try {
            const missing = await findFbAccountsMissingGroupCache(userId);
            if (!missing.length) {
                if (!silent) console.log(`[BG Group Backfill] user=${userId}: tất cả FB accounts đã có cache.`);
                return;
            }
            console.log(`[BG Group Backfill] user=${userId}: phát hiện ${missing.length} FB accounts chưa có cache → bật scan ngầm.`);
            for (const acc of missing) {
                // Không có sessionKey (user không đang mở browser ở server) → scan mode mở context mới
                startBackgroundGroupScan({
                    sessionKey: null, // không có session đang mở
                    userId,
                    channelId: acc.channelId,
                    accountName: acc.accountName,
                    accountType: acc.accountType,
                    existingSessionDir: acc.existingSessionDir,
                    scanMode: 'fast',
                    force: false
                });
                // Tránh mở quá nhiều Chrome cùng lúc
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (err) {
            console.error(`[BG Group Backfill] user=${userId} error:`, err.message);
        }
    })();
}

// =============================================================
// WORKER ĐỊNH KỲ: Quét backfill toàn hệ thống
// =============================================================

let backfillTimer = null;
let backfillWorkerStarted = false;
const BACKFILL_INTERVAL_MS = 60 * 60 * 1000; // 1 giờ
const BACKFILL_FIRST_RUN_DELAY_MS = 2 * 60 * 1000; // chạy lần đầu sau 2 phút server start

/**
 * Khởi động worker quét backfill định kỳ cho toàn bộ users.
 * Pattern giống autoContentRunner / reelsScheduleRunner.
 */
function startGroupBackfillWorker() {
    if (backfillWorkerStarted) return;
    backfillWorkerStarted = true;

    const User = require('../../models/User');

    async function runOnce() {
        try {
            // Lấy danh sách user có ít nhất 1 FB account enabled
            const userIds = await Channel.distinct('userId', { platform: 'FB', isEnabled: true });
            if (!userIds.length) return;

            console.log(`[BG Group Backfill Worker] Quét backfill cho ${userIds.length} users...`);

            // Xử lý tuần tự từng user để tránh mở quá nhiều Chrome
            for (const userId of userIds) {
                try {
                    await backfillMissingGroupCachesPromise(userId);
                } catch (e) {
                    console.error(`[BG Group Backfill Worker] user=${userId} error:`, e.message);
                }
                // Nghỉ giữa các user
                await new Promise(r => setTimeout(r, 5000));
            }
        } catch (err) {
            console.error('[BG Group Backfill Worker] Loop error:', err.message);
        }
    }

    // First run sau 2 phút (cho server ổn định)
    setTimeout(runOnce, BACKFILL_FIRST_RUN_DELAY_MS);
    // Sau đó mỗi 1 giờ
    backfillTimer = setInterval(runOnce, BACKFILL_INTERVAL_MS);
    console.log('[BG Group Backfill Worker] Started (interval=' + (BACKFILL_INTERVAL_MS / 60000) + 'min)');
}

async function backfillMissingGroupCachesPromise(userId) {
    const missing = await findFbAccountsMissingGroupCache(userId);
    if (!missing.length) return 0;
    console.log(`[BG Group Backfill] user=${userId}: ${missing.length} accounts chưa có cache`);
    for (const acc of missing) {
        startBackgroundGroupScan({
            sessionKey: null,
            userId,
            channelId: acc.channelId,
            accountName: acc.accountName,
            accountType: acc.accountType,
            existingSessionDir: acc.existingSessionDir,
            scanMode: 'fast',
            force: false
        });
        await new Promise(r => setTimeout(r, 2000));
    }
    return missing.length;
}

function stopGroupBackfillWorker() {
    if (backfillTimer) {
        clearInterval(backfillTimer);
        backfillTimer = null;
    }
    backfillWorkerStarted = false;
    console.log('[BG Group Backfill Worker] Stopped');
}

module.exports = {
    FACEBOOK_GROUPS_JOINS_URL,
    buildInvalidGroupSegments,
    normalizeGroupLabel,
    extractFacebookGroupsFromPage,
    extractFacebookGroupsFromPageV2,
    scrapeGroupsFromJoinsPage,
    scrapeGroupsFromUrl,
    scanFacebookGroups,
    persistFacebookGroupCache,
    getOrOpenFacebookContext,
    getJoinedFacebookGroups,
    getJoinedFacebookGroupsDeep,
    getJoinedFacebookGroupsQuick,
    getJoinedFacebookGroupsCached,
    startBackgroundGroupScan,
    backfillMissingGroupCaches,
    startGroupBackfillWorker,
    getBgScanQueueStats,
    MAX_CONCURRENT_BG_SCANS
};