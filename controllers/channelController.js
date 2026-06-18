// controllers/channelController.js
const Channel = require('../models/Channel');
const {
    openFacebookLoginWindow,
    getJoinedFacebookGroupsCached,
    openYoutubeLoginWindow,
    openTiktokLoginWindow,
    openInstagramLoginWindow,
    openZaloLoginWindow,
    openPinterestLoginWindow,
    openThreadsLoginWindow,
    openExistingSocialBrowserWindow
} = require('../services/socialPlaywrightService');
const {
    normalizeEncryptedValue,
    prepareSensitiveValue,
    restoreRecordForView
} = require('../utils/cryptoVault');
const {
    startFacebookProfileUrlWatcher
} = require('../services/facebook/utils');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeFacebookAccountType(value) {
    const type = String(value || '').trim();
    if (type === 'Fanpage') return 'Fanpage';
    if (type === 'Nhà sáng tạo') return 'Nhà sáng tạo';
    return 'Cá nhân';
}

function normalizeAccountType(value, platform) {
    const type = String(value || '').trim().toLowerCase();
    switch (platform) {
        case 'FB':
            if (type === 'fanpage' || type === 'page') return 'Fanpage';
            if (type === 'nhà sáng tạo' || type === 'creator') return 'Nhà sáng tạo';
            return 'Cá nhân';
        case 'TT':
            if (type === 'fanpage' || type === 'page') return 'Fanpage';
            if (type === 'nhà sáng tạo' || type === 'creator') return 'Nhà sáng tạo';
            return 'Cá nhân';
        case 'IG':
            if (type === 'business') return 'Business';
            if (type === 'creator') return 'Creator';
            return 'Personal';
        case 'YT':
            if (type === 'channel') return 'Channel';
            if (type === 'brand') return 'Brand';
            return 'Personal';
        case 'ZO':
            return 'Personal';
        case 'PI':
            if (type === 'business') return 'Business';
            return 'Personal';
        case 'TH':
            return 'Personal';
        default:
            return 'Cá nhân';
    }
}

/** Map platform code → login-window opener function */
const PLATFORM_OPENERS = {
    FB: openFacebookLoginWindow,
    TT: openTiktokLoginWindow,
    IG: openInstagramLoginWindow,
    YT: openYoutubeLoginWindow,
    ZO: openZaloLoginWindow,
    PI: openPinterestLoginWindow,
    TH: openThreadsLoginWindow,
};

/** Platform display names */
const PLATFORM_LABELS = { FB: 'Facebook', TT: 'TikTok', IG: 'Instagram', YT: 'YouTube', ZO: 'Zalo', PI: 'Pinterest', TH: 'Threads' };

const ALLOWED_PLATFORMS = ['FB', 'TT', 'IG', 'YT', 'ZO', 'PI', 'TH'];

/** Fields to strip from channel objects sent to views/clients */
const SENSITIVE_FIELDS = ['storageStatePath', 'accessToken'];
const VIEW_RESTORE_FIELDS = ['platform', 'accountName', 'accountType', 'profileUrl', 'avatarUrl', 'followers', 'storageStatePath', 'accessToken'];

async function getEncryptionEnabledForUser(userId) {
    const Settings = require('../models/Settings');
    const settings = await Settings.findOne({ userId }, { dataEncryptionEnabled: 1 }).lean();
    return Boolean(settings?.dataEncryptionEnabled);
}

/**
 * Find an existing channel for this user+platform that matches accountName+accountType.
 * Uses index { userId, platform, accountName, accountType } — but since accountName/accountType
 * may be encrypted, we still need to fetch by userId+platform first then compare in memory.
 */
async function findMatchingChannel(userId, platform, accountName, accountType) {
    const existing = await Channel
        .find({ userId, platform }, { _id: 1, accountName: 1, accountType: 1, storageStatePath: 1, accessToken: 1 })
        .lean();
    return existing.find((item) => {
        const safe = restoreRecordForView(item, VIEW_RESTORE_FIELDS);
        return safe.accountName === accountName && safe.accountType === accountType;
    }) || null;
}

// ─── Page controller ─────────────────────────────────────────────────────────

const showChannels = async (req, res) => {
    try {
        const requestedPlatform = String(req.query.platform || 'FB').trim().toUpperCase();
        const activePlatform = ALLOWED_PLATFORMS.includes(requestedPlatform) ? requestedPlatform : 'FB';

        // Single query — only fields needed for the view (exclude large encrypted blobs)
        const allChannels = await Channel
            .find({ userId: req.user._id }, { storageStatePath: 0, accessToken: 0 })
            .sort({ createdAt: -1 })
            .lean();

        // Stats + availablePlatforms only need the `platform` field. Decrypt just that
        // (cheap) for every record, and reserve the full field decryption for the
        // subset actually rendered (active platform) — avoids decrypting accountName,
        // profileUrl, etc. for channels the user isn't viewing.
        const stats = { total: 0, fb: 0, tt: 0, ig: 0, yt: 0, zo: 0, pi: 0, th: 0 };
        const availableSet = new Set();
        const activeRaw = [];

        for (const ch of allChannels) {
            const platform = normalizeEncryptedValue(ch.platform);
            const key = platform?.toLowerCase();
            if (key && key in stats) stats[key]++;
            if (ALLOWED_PLATFORMS.includes(platform)) availableSet.add(platform);
            if (platform === activePlatform) activeRaw.push(ch);
        }

        stats.total = activeRaw.length;
        const channels = activeRaw.map(ch => restoreRecordForView(ch, VIEW_RESTORE_FIELDS));
        const availablePlatforms = [...availableSet];

        res.render('channels', {
            user: req.user,
            channels,
            stats,
            activePlatform,
            platformLabel: PLATFORM_LABELS[activePlatform] || activePlatform,
            availablePlatforms
        });
    } catch (error) {
        console.error('[showChannels]', error);
        res.render('channels', {
            user: req.user,
            channels: [],
            stats: { total: 0, fb: 0, tt: 0, ig: 0, yt: 0, zo: 0, pi: 0, th: 0 },
            activePlatform: 'FB',
            platformLabel: 'Facebook',
            availablePlatforms: []
        });
    }
};

// ─── Generic platform connect (FB / TT / IG / YT / ZO) ──────────────────────

/**
 * Shared handler for all platform connect routes.
 * Opens the Playwright login window, then upserts the channel on success.
 */
const openPlatformConnect = async (req, res) => {
    const platform = req.params.platform?.toUpperCase();
    if (!ALLOWED_PLATFORMS.includes(platform)) {
        return res.status(400).json({ success: false, message: 'Nền tảng không hợp lệ' });
    }

    const opener = PLATFORM_OPENERS[platform];
    if (!opener) {
        return res.status(400).json({ success: false, message: 'Nền tảng không được hỗ trợ' });
    }

    try {
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const rawAccountType = normalizeEncryptedValue(req.body.accountType);

        if (!accountName?.trim()) {
            return res.status(400).json({ success: false, message: `Vui lòng nhập tên tài khoản ${PLATFORM_LABELS[platform]}` });
        }

        const normalizedAccountType = platform === 'FB'
            ? normalizeFacebookAccountType(rawAccountType)
            : normalizeAccountType(rawAccountType, platform);

        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.facebookUrl || req.body.tiktokUrl || req.body.instagramUrl || req.body.youtubeUrl || req.body.zaloUrl || '');
        const avatarUrl = req.file ? `/uploads/images/${req.file.filename}` : undefined;

        // Open Playwright browser and wait for login
        console.log(`[openPlatformConnect:${platform}] Opening login window for ${accountName.trim()}...`);
        const result = await opener(req.user._id, accountName.trim(), normalizedAccountType, platform);
        console.log(`[openPlatformConnect:${platform}] Login result: success=${result.success} cookiesSaved=${result.cookiesSaved}`);

        if (!result.success || !result.cookiesSaved) {
            return res.json({
                success: false,
                message: result.message || 'Đăng nhập chưa hoàn tất. Vui lòng thử lại.',
                cookiesSaved: false
            });
        }

        const encryptionEnabled = await getEncryptionEnabledForUser(req.user._id);

        // Dùng accountName thật từ scrape, fallback về tên nhập tay
        const finalAccountName = result.myName ? result.myName : accountName.trim();
        // Dùng profileUrl từ scrape, fallback về URL nhập tay
        const finalProfileUrl = result.myProfileUrl ? result.myProfileUrl : profileUrl;
        // Dùng avatarUrl từ scrape, fallback về URL upload
        const finalAvatarUrl = result.myAvatarUrl ? result.myAvatarUrl : avatarUrl;

        // FB: ưu tiên dùng scrapedAccountType (từ scrape profile), fallback về normalizedAccountType (từ form)
        const finalAccountType = (platform === 'FB' && result.scrapedAccountType)
            ? normalizeFacebookAccountType(result.scrapedAccountType)
            : normalizedAccountType;

        const updateData = {
            userId: req.user._id,
            platform,
            accountName: finalAccountName,
            accountType: finalAccountType,
            profileUrl: finalProfileUrl,
            storageStatePath: prepareSensitiveValue(normalizeEncryptedValue(result.storageStatePath), encryptionEnabled),
            apiStatus: 'active',
            isEnabled: true,
            ...(finalAvatarUrl && { avatarUrl: finalAvatarUrl })
        };

        // Upsert: update existing or create new (dùng finalAccountName để match)
        const matchedChannel = await findMatchingChannel(req.user._id, platform, finalAccountName, finalAccountType);
        let channel;
        if (matchedChannel) {
            channel = await Channel.findByIdAndUpdate(matchedChannel._id, updateData, { returnDocument: "after" });
        } else {
            channel = await Channel.create(updateData);
        }

        // FB: profile URL đã được scrape ngay trong openFacebookLoginWindow, không cần watcher riêng
        // FB: start profile URL watcher (dự phòng nếu scrape không lấy được URL)
        if (platform === 'FB' && result.sessionKey && !result.myProfileUrl) {
            startFacebookProfileUrlWatcher({
                sessionKey: result.sessionKey,
                userId: req.user._id,
                channelId: channel._id,
                accountName: finalAccountName,
                accountType: normalizedAccountType
            });
        }

        return res.json({
            success: true,
            message: result.message,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath,
            cookiesSaved: true,
            channel: restoreRecordForView(channel.toObject(), SENSITIVE_FIELDS)
        });
    } catch (error) {
        console.error(`[openPlatformConnect:${platform}]`, error);
        return res.status(500).json({ success: false, message: `Không thể kết nối ${PLATFORM_LABELS[platform] || platform}: ` + error.message });
    }
};

// ─── CRUD API ─────────────────────────────────────────────────────────────────

/** POST /api/create — manual channel creation (no Playwright) */
const createChannel = async (req, res) => {
    try {
        const platform = normalizeEncryptedValue(req.body.platform);
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const accountType = normalizeEncryptedValue(req.body.accountType);
        const followers = normalizeEncryptedValue(req.body.followers);

        if (!platform || !accountName) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc' });
        }
        if (!ALLOWED_PLATFORMS.includes(platform)) {
            return res.status(400).json({ success: false, message: 'Nền tảng không hợp lệ' });
        }

        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.facebookUrl || '');
        const avatarUrl = req.file ? `/uploads/images/${req.file.filename}` : '';
        const encryptionEnabled = await getEncryptionEnabledForUser(req.user._id);

        const channel = await Channel.create({
            userId: req.user._id,
            platform,
            accountName,
            accountType: normalizeAccountType(accountType, platform),
            profileUrl,
            followers: followers || '0',
            avatarUrl,
            accessToken: prepareSensitiveValue('', encryptionEnabled)
        });

        res.json({
            success: true,
            message: 'Đã thêm kênh thành công!',
            channel: restoreRecordForView(channel.toObject(), SENSITIVE_FIELDS)
        });
    } catch (error) {
        console.error('[createChannel]', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

/** PATCH /api/:id/toggle */
const toggleChannel = async (req, res) => {
    try {
        const channel = await Channel.findOne(
            { _id: req.params.id, userId: req.user._id },
            { isEnabled: 1 }
        );
        if (!channel) return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });

        channel.isEnabled = !channel.isEnabled;
        await channel.save();
        res.json({ success: true, message: `Kênh đã ${channel.isEnabled ? 'bật' : 'tắt'}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/** DELETE /api/:id */
const deleteChannel = async (req, res) => {
    try {
        const result = await Channel.deleteOne({ _id: req.params.id, userId: req.user._id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });
        res.json({ success: true, message: 'Đã xóa kênh' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/** POST /api/:id/open — open Chromium for an existing channel */
const openChannelBrowser = async (req, res) => {
    try {
        const channel = await Channel
            .findOne({ _id: req.params.id, userId: req.user._id })
            .lean();
        if (!channel) return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });

        const safeChannel = restoreRecordForView(channel, VIEW_RESTORE_FIELDS);

        if (!ALLOWED_PLATFORMS.includes(safeChannel.platform)) {
            return res.status(400).json({ success: false, message: 'Không hỗ trợ mở Chromium cho nền tảng này' });
        }

        const result = await openExistingSocialBrowserWindow(
            req.user._id,
            safeChannel.accountName,
            safeChannel.accountType || 'Cá nhân',
            safeChannel.platform,
            safeChannel.storageStatePath
        );

        return res.json({
            success: true,
            message: result.message,
            channel: safeChannel,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath
        });
    } catch (error) {
        console.error('[openChannelBrowser]', error);
        return res.status(500).json({ success: false, message: 'Không thể mở Chromium: ' + error.message });
    }
};

/** GET /api/list — enabled channels JSON (used by other features) */
const getChannelsAPI = async (req, res) => {
    try {
        const channels = await Channel
            .find({ userId: req.user._id, isEnabled: true }, { storageStatePath: 0, accessToken: 0 })
            .lean();
        res.json({
            success: true,
            channels: channels.map(ch => restoreRecordForView(ch, VIEW_RESTORE_FIELDS))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/** GET /api/:id/facebook-groups */
const getFacebookGroupsAPI = async (req, res) => {
    try {
        const channel = await Channel
            .findOne({ _id: req.params.id, userId: req.user._id, platform: 'FB', isEnabled: true })
            .lean();
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản Facebook hợp lệ' });
        }

        const safeChannel = restoreRecordForView(channel, VIEW_RESTORE_FIELDS);
        const result = await getJoinedFacebookGroupsCached(req.user._id, safeChannel._id);

        return res.json({
            success: true,
            groups: result.groups,
            source: result.source,
            updatedAt: result.updatedAt
        });
    } catch (error) {
        console.error('[getFacebookGroupsAPI]', error);
        return res.status(500).json({ success: false, message: 'Không thể tải danh sách group: ' + error.message });
    }
};

/** PATCH /api/:id/update */
const updateChannel = async (req, res) => {
    try {
        const channel = await Channel.findOne({ _id: req.params.id, userId: req.user._id });
        if (!channel) return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });

        const accountName = normalizeEncryptedValue(req.body.accountName || '').trim();
        const accountType = normalizeEncryptedValue(req.body.accountType || '').trim();
        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.facebookUrl || '').trim();
        const followers = normalizeEncryptedValue(req.body.followers || '').trim();

        if (accountName) channel.accountName = accountName;
        if (accountType) channel.accountType = normalizeFacebookAccountType(accountType);
        if (profileUrl !== '') channel.profileUrl = profileUrl;
        if (followers !== '') channel.followers = followers;
        if (req.file?.filename) channel.avatarUrl = `/uploads/images/${req.file.filename}`;

        await channel.save();

        if (channel.platform === 'FB' && channel.profileUrl) {
            startFacebookProfileUrlWatcher({
                sessionKey: `channel:${channel._id}`,
                userId: req.user._id,
                channelId: channel._id,
                accountName: channel.accountName,
                accountType: channel.accountType || 'Cá nhân'
            });
        }

        return res.json({
            success: true,
            message: 'Đã cập nhật kênh thành công!',
            channel: restoreRecordForView(channel.toObject(), SENSITIVE_FIELDS)
        });
    } catch (error) {
        console.error('[updateChannel]', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

module.exports = {
    showChannels,
    createChannel,
    toggleChannel,
    deleteChannel,
    openChannelBrowser,
    getChannelsAPI,
    getFacebookGroupsAPI,
    openPlatformConnect,  // replaces 5 separate openXxxConnect handlers
    updateChannel
};
