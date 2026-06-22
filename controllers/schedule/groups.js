// controllers/schedule/groups.js
const Channel = require('../../models/Channel');
const FacebookGroupCache = require('../../models/FacebookGroupCache');
const { emitGroupsBatch, emitGroupsProgress, emitGroupsComplete } = require('../../services/socketService');
const { restoreRecordForView } = require('../../utils/cryptoVault');

const CHANNEL_VIEW_FIELDS = ['platform', 'accountName', 'accountType', 'avatarUrl', 'storageStatePath'];

const showScheduleGroups = async (req, res) => {
    try {
        const { channelId } = req.query;
        const rawFacebookChannels = await Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true })
            .select('_id platform accountName accountType avatarUrl')
            .sort({ createdAt: -1 })
            .lean();
        const facebookChannels = rawFacebookChannels.map(channel => restoreRecordForView(channel, CHANNEL_VIEW_FIELDS));

        let currentChannelId = channelId || null;
        let groups = [];
        let groupsStats = {
            total: 0,
            lastScanDate: null,
            source: null
        };
        let currentAccount = null;

        if (currentChannelId) {
            const channel = facebookChannels.find(c => String(c._id) === String(currentChannelId));
            if (channel) {
                currentAccount = channel;
            }
        }

        if (!currentChannelId && facebookChannels.length > 0) {
            currentChannelId = String(facebookChannels[0]._id);
            currentAccount = facebookChannels[0];
        }

        if (currentChannelId) {
            const cachedGroups = await FacebookGroupCache.findOne({
                userId: req.user._id,
                channelId: currentChannelId
            }).lean();

            if (cachedGroups && cachedGroups.groups) {
                groups = cachedGroups.groups;
                groupsStats = {
                    total: groups.length,
                    lastScanDate: cachedGroups.updatedAt 
                        ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(cachedGroups.updatedAt))
                        : null,
                    source: 'cache'
                };
            }
        }

        res.render('schedule-groups', {
            user: req.user,
            facebookChannels,
            groups,
            groupsStats,
            currentAccount,
            currentChannelId
        });
    } catch (error) {
        console.error('Show Schedule Groups Error:', error);
        res.render('schedule-groups', {
            user: req.user,
            facebookChannels: [],
            groups: [],
            groupsStats: { total: 0, lastScanDate: null, source: null },
            currentAccount: null,
            currentChannelId: null
        });
    }
};

const scanFacebookGroupsAPI = async (req, res) => {
    try {
        const { channelId, scanMode = 'fast' } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook' });
        }

        const channel = await Channel.findOne({
            _id: channelId,
            userId: req.user._id,
            platform: 'FB',
            isEnabled: true
        }).lean();

        if (!channel) {
            return res.status(404).json({ success: false, message: 'Tài khoản Facebook không tồn tại hoặc đã bị tắt' });
        }

        const { getJoinedFacebookGroupsCached: getGroupsCached } = require('../../services/facebook/groups');
        const safeChannel = restoreRecordForView(channel, CHANNEL_VIEW_FIELDS);

        // Resolve session dir từ channel's storageStatePath
        const path = require('path');
        const existingSessionDir = safeChannel.storageStatePath
            ? path.dirname(safeChannel.storageStatePath)
            : '';

        const result = await getGroupsCached({
            userId: req.user._id,
            channelId: channel._id,
            accountName: safeChannel.accountName,
            accountType: safeChannel.accountType || 'Cá nhân',
            forceRefresh: true,
            scanMode: scanMode === 'deep' ? 'deep' : 'fast',
            existingSessionDir
        });

        return res.json({
            success: true,
            message: `Đã quét thành công ${result.groups.length} group`,
            groupsCount: result.groups.length,
            source: result.source,
            updatedAt: result.updatedAt
        });
    } catch (error) {
        console.error('Scan Facebook Groups Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

const scrapeGroupMembersAPI = async (req, res) => {
    let context = null;
    let page = null;
    try {
        const { channelId, groupUrl, scanMode = 'fast' } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook' });
        }

        if (!groupUrl) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập link group Facebook' });
        }

        // Validate URL
        let parsedUrl;
        try {
            parsedUrl = new URL(groupUrl);
            if (!/^(www\.)?facebook\.com$/i.test(parsedUrl.hostname)) {
                return res.status(400).json({ success: false, message: 'Link không hợp lệ. Vui lòng nhập link Facebook.' });
            }
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Link không hợp lệ.' });
        }

        const channel = await Channel.findOne({
            _id: channelId,
            userId: req.user._id,
            platform: 'FB',
            isEnabled: true
        }).lean();

        if (!channel) {
            return res.status(404).json({ success: false, message: 'Tài khoản Facebook không tồn tại hoặc đã bị tắt' });
        }

        const {
            getOrOpenFacebookContext,
            scrapeGroupsFromUrl,
            persistFacebookGroupCache
        } = require('../../services/facebook/groups');
        const safeChannel = restoreRecordForView(channel, CHANNEL_VIEW_FIELDS);

        // Resolve session dir từ channel's storageStatePath để tránh mismatch khi accountName đổi
        const path = require('path');
        const existingSessionDir = safeChannel.storageStatePath
            ? path.dirname(safeChannel.storageStatePath)
            : '';

        const { context: browserContext, sessionKey, isExternal } = await getOrOpenFacebookContext(
            req.user._id,
            safeChannel.accountName,
            safeChannel.accountType || 'Cá nhân',
            'FB',
            { headless: true, existingSessionDir }
        );

        context = browserContext;

        const existingPages = context.pages();
        if (existingPages.length > 0 && !existingPages[0].isClosed()) {
            page = existingPages[0];
        } else {
            page = await context.newPage();
        }
        
        const isDeepMode = scanMode === 'deep';
        const maxScrollRounds = isDeepMode ? 15 : 5;
        const maxGroups = isDeepMode ? 0 : 500;

        console.log(`[Group Scrape API] Starting scrape from: ${groupUrl}, deep: ${isDeepMode}, maxGroups: ${maxGroups || 'unlimited'}`);

        // Lấy dữ liệu cũ từ DB
        const existingCache = await FacebookGroupCache.findOne({ userId: req.user._id, channelId: channel._id }).lean();
        const existingGroupsMap = new Map();
        if (existingCache?.groups) {
            existingCache.groups.forEach(g => existingGroupsMap.set(g.groupId, g));
            console.log(`[Group Scrape API] Co ${existingGroupsMap.size} groups trong DB`);
        }

        // Callback lưu groups vào DB ngay khi có groups mới
        const saveGroupsToDB = async (allGroups, newGroups) => {
            try {
                // Cập nhật existingGroupsMap với groups mới để tránh duplicate ở lần callback sau
                allGroups.forEach(g => existingGroupsMap.set(g.groupId, g));

                const mergedGroups = Array.from(existingGroupsMap.values())
                    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));
                
                await persistFacebookGroupCache({
                    userId: req.user._id,
                    channelId: channel._id,
                    accountName: safeChannel.accountName,
                    accountType: safeChannel.accountType || 'Cá nhân',
                    groups: mergedGroups
                });
                
                console.log(`[Group Scrape API] Da luu ${mergedGroups.length} groups vao DB`);
            } catch (e) {
                console.error(`[Group Scrape API] Loi khi luu vao DB: ${e.message}`);
            }
        };

        // Socket callback: emit batches to frontend in real-time
        let lastBatchCount = 0;
        const onGroupsFoundWithSocket = async (allGroups, newGroups) => {
            // Save to DB
            await saveGroupsToDB(allGroups, newGroups);
            // Emit to frontend via socket
            emitGroupsBatch(req.user._id, allGroups, newGroups, {
                found: allGroups.length,
                round: null,
                maxRounds: maxScrollRounds,
                phase: 'scraping'
            });
            lastBatchCount = allGroups.length;
        };

        // Scrape groups mới từ URL
        const newGroups = await scrapeGroupsFromUrl({
            page,
            targetUrl: groupUrl,
            maxScrollRounds,
            scrollDelayMs: 3000,
            scrollAmount: 3000,
            onGroupsFound: onGroupsFoundWithSocket,
            maxGroups
        });

        console.log(`[Group Scrape API] Da quet ${newGroups.length} groups moi tu ${groupUrl}`);

        // Merge dữ liệu lần cuối
        const mergedGroupsMap = new Map(existingGroupsMap);
        newGroups.forEach(g => mergedGroupsMap.set(g.groupId, g));

        const finalGroups = Array.from(mergedGroupsMap.values())
            .filter((group, idx, arr) => arr.findIndex(g => g.groupId === group.groupId) === idx)
            .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));

        // Lưu final data
        const savedCache = await persistFacebookGroupCache({
            userId: req.user._id,
            channelId: channel._id,
            accountName: safeChannel.accountName,
            accountType: safeChannel.accountType || 'Cá nhân',
            groups: finalGroups
        });

        console.log(`[Group Scrape API] Saved ${finalGroups.length} groups to database`);

        // Emit completion via socket
        emitGroupsComplete(req.user._id, {
            totalGroups: finalGroups.length,
            source: 'scrape-url',
            updatedAt: savedCache?.updatedAt || new Date(),
            message: `Hoàn tất! Đã quét ${newGroups.length} group mới, tổng ${finalGroups.length} group`
        });

        return res.json({
            success: true,
            message: `Đã quét ${newGroups.length} group mới, tổng ${finalGroups.length} group`,
            groupsCount: finalGroups.length,
            newGroupsCount: newGroups.length,
            source: 'scrape-url',
            updatedAt: savedCache?.updatedAt || new Date(),
            groups: finalGroups.slice(0, 10)
        });

    } catch (error) {
        console.error('Scrape Group Members API Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (context) {
            await context.close().catch(() => {});
        }
    }
};

const scrapeGroupsFromJoinsAPI = async (req, res) => {
    let context = null;
    let page = null;
    
    try {
        const { channelId, scanMode = 'fast' } = req.body;

        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook' });
        }

        const channel = await Channel.findOne({
            _id: channelId,
            userId: req.user._id,
            platform: 'FB',
            isEnabled: true
        }).lean();

        if (!channel) {
            return res.status(404).json({ success: false, message: 'Tài khoản Facebook không tồn tại hoặc đã bị tắt' });
        }

        const {
            getOrOpenFacebookContext,
            scrapeGroupsFromJoinsPage,
            persistFacebookGroupCache
        } = require('../../services/facebook/groups');
        const safeChannel = restoreRecordForView(channel, CHANNEL_VIEW_FIELDS);

        // Resolve session dir từ channel's storageStatePath để tránh mismatch khi accountName đổi
        const path = require('path');
        const existingSessionDir = safeChannel.storageStatePath
            ? path.dirname(safeChannel.storageStatePath)
            : '';

        const { context: browserContext, sessionKey, isExternal, userSessionDir } = await getOrOpenFacebookContext(
            req.user._id,
            safeChannel.accountName,
            safeChannel.accountType || 'Cá nhân',
            safeChannel.platform || 'FB',
            { headless: true, existingSessionDir }
        );
        console.log(`[Group Scrape Joins API>>>>>>>>] Opened userSessionDir context for userSessionDir: ${sessionKey},  userSessionDir: ${userSessionDir}`);
        context = browserContext;

        const existingPages = context.pages();
        if (existingPages.length > 0 && !existingPages[0].isClosed()) {
            page = existingPages[0];
        } else {
            page = await context.newPage();
        }
        
        const isDeepMode = scanMode === 'deep';
        const maxScrollRounds = isDeepMode ? 15 : 5;
        const maxGroups = isDeepMode ? 0 : 500;

        // Lấy dữ liệu cũ từ DB
        const existingCache = await FacebookGroupCache.findOne({ userId: req.user._id, channelId: channel._id }).lean();
        const existingGroupsMap = new Map();
        if (existingCache?.groups) {
            existingCache.groups.forEach(g => existingGroupsMap.set(g.groupId, g));
            console.log(`[Group Scrape] Co ${existingGroupsMap.size} groups trong DB`);
        }

        // Callback gửi tiến trình qua socket + console
        let lastFoundCount = 0;
        const sendProgress = (data) => {
            if (data.found !== lastFoundCount) {
                lastFoundCount = data.found;
                console.log(`[Group Scrape Progress] ${data.message} (${data.found} groups)`);
            }
            // Emit progress via socket
            emitGroupsProgress(req.user._id, {
                phase: data.phase || 'scraping',
                message: data.message,
                found: data.found,
                round: data.round || null,
                maxRounds: data.maxRounds || maxScrollRounds
            });
        };

        // Callback lưu groups vào DB + emit socket batch
        const saveGroupsToDBAndEmit = async (allGroups, newGroups) => {
            try {
                // Cập nhật existingGroupsMap với groups mới để tránh duplicate ở lần callback sau
                allGroups.forEach(g => existingGroupsMap.set(g.groupId, g));

                const mergedGroups = Array.from(existingGroupsMap.values())
                    .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));
                
                // Lưu vào DB ngay
                await persistFacebookGroupCache({
                    userId: req.user._id,
                    channelId: channel._id,
                    accountName: safeChannel.accountName,
                    accountType: safeChannel.accountType || 'Cá nhân',
                    groups: mergedGroups
                });
                
                console.log(`[Group Scrape] Da luu ${mergedGroups.length} groups vao DB`);

                // Emit batch to frontend via socket
                emitGroupsBatch(req.user._id, allGroups, newGroups, {
                    found: allGroups.length,
                    round: null,
                    maxRounds: maxScrollRounds,
                    phase: 'scraping'
                });
            } catch (e) {
                console.error(`[Group Scrape] Loi khi luu vao DB: ${e.message}`);
            }
        };

        // Quét groups mới
        const newGroups = await scrapeGroupsFromJoinsPage({
            page,
            maxScrollRounds,
            scrollDelayMs: 3000,
            onProgress: sendProgress,
            onGroupsFound: saveGroupsToDBAndEmit,
            maxGroups
        });

        console.log(`[Group Scrape Joins API] Da quet ${newGroups.length} groups moi`);

        // Merge dữ liệu lần cuối
        const mergedGroupsMap = new Map(existingGroupsMap);
        newGroups.forEach(g => mergedGroupsMap.set(g.groupId, g));

        const finalGroups = Array.from(mergedGroupsMap.values())
            .filter((group, idx, arr) => arr.findIndex(g => g.groupId === group.groupId) === idx)
            .sort((a, b) => a.groupName.localeCompare(b.groupName, 'vi'));

        // Lưu final data
        const savedCache = await persistFacebookGroupCache({
            userId: req.user._id,
            channelId: channel._id,
            accountName: safeChannel.accountName,
            accountType: safeChannel.accountType || 'Cá nhân',
            groups: finalGroups
        });

        console.log(`[Group Scrape Joins API] Saved ${finalGroups.length} groups to database`);

        // Emit completion via socket
        emitGroupsComplete(req.user._id, {
            totalGroups: finalGroups.length,
            source: 'scrape-joins',
            updatedAt: savedCache?.updatedAt || new Date(),
            message: `Hoàn tất! Đã quét ${newGroups.length} group mới, tổng ${finalGroups.length} group`
        });

        return res.json({
            success: true,
            message: `Đã quét ${newGroups.length} group mới, tổng ${finalGroups.length} group`,
            groupsCount: finalGroups.length,
            newGroupsCount: newGroups.length,
            source: 'scrape-joins',
            updatedAt: savedCache?.updatedAt || new Date(),
            groups: finalGroups.slice(0, 10)
        });

    } catch (error) {
        console.error('Scrape Groups From Joins API Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    } finally {
        if (context) {
            await context.close().catch(() => {});
        }
    }
};

const getGroupsAPI = async (req, res) => {
    try {
        console.log('Get Groups API called with query:', req.query);
        const { channelId } = req.query;
        
        if (!channelId) {
            return res.status(400).json({ success: false, message: 'Thiếu channelId' });
        }

        const cache = await FacebookGroupCache.findOne({ 
            userId: req.user._id, 
            channelId 
        }).lean();

        if (!cache || !cache.groups) {
            return res.json({ success: true, groups: [] });
        }

        return res.json({ 
            success: true, 
            groups: cache.groups,
            count: cache.groups.length 
        });
    } catch (error) {
        console.error('Get Groups API Error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    showScheduleGroups,
    scanFacebookGroupsAPI,
    scrapeGroupMembersAPI,
    scrapeGroupsFromJoinsAPI,
    getGroupsAPI
};