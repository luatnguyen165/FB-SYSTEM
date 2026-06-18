// services/facebook/groups.js
const FacebookGroupCache = require('../../models/FacebookGroupCache');
const { ACTIVE_FB_SESSIONS, getOrOpenFacebookContext } = require('./session');

const FACEBOOK_GROUPS_URL = 'https://www.facebook.com/groups/';
const FACEBOOK_GROUPS_FEED_URL = 'https://www.facebook.com/groups/feed/';
const FACEBOOK_GROUPS_YOU_URL = 'https://www.facebook.com/groups/you/';

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
            const key = `${group.groupId}|${group.groupUrl}`;
            if (!discoveredMap.has(key)) {
                discoveredMap.set(key, group);
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
    const result = await FacebookGroupCache.findOneAndUpdate(
        { userId, channelId },
        {
            userId,
            channelId,
            accountName,
            accountType: accountType || 'Cá nhân',
            groups,
            updatedAt: new Date()
        },
        { upsert: true, returnDocument: "after" }
    );
    console.log(`[Group Cache] Saved ${groups.length} groups for user ${userId}, channel ${channelId}`);
    return result;
}

async function getJoinedFacebookGroups(userId, accountName, accountType = 'Cá nhân', platform = 'FB', existingSessionDir = '') {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, platform, { headless: true, existingSessionDir });

    try {
        const page = context.pages()[0] || await context.newPage();
        const discovered = await scanFacebookGroups({
            page,
            candidateUrls: [FACEBOOK_GROUPS_YOU_URL, FACEBOOK_GROUPS_FEED_URL, FACEBOOK_GROUPS_URL],
            invalidSegments: buildInvalidGroupSegments(),
            initialWaitMs: 2500,
            maxRoundsPerUrl: 10,
            scrollWaitMs: 1800,
            stableThreshold: 2
        });

        return Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'));
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
                candidateUrls: [FACEBOOK_GROUPS_YOU_URL, FACEBOOK_GROUPS_FEED_URL, FACEBOOK_GROUPS_URL],
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
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'));

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
        const candidateUrls = [
            FACEBOOK_GROUPS_YOU_URL,
            FACEBOOK_GROUPS_FEED_URL
        ];

        const discovered = await scanFacebookGroups({
            page,
            candidateUrls,
            invalidSegments: buildInvalidGroupSegments(),
            initialWaitMs: 900,
            maxRoundsPerUrl: 4,
            scrollWaitMs: 700,
            stableThreshold: 1
        });

        const groups = Array.from(discovered.values())
            .filter(group => group.groupName && group.groupId)
            .sort((a, b) => normalizeGroupLabel(a.groupName).localeCompare(normalizeGroupLabel(b.groupName), 'vi'));

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
            updatedAt: cachedDoc.updatedAt || null
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
        updatedAt: new Date()
    };
}

module.exports = {
    FACEBOOK_GROUPS_URL,
    FACEBOOK_GROUPS_FEED_URL,
    FACEBOOK_GROUPS_YOU_URL,
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
    getJoinedFacebookGroupsCached
};