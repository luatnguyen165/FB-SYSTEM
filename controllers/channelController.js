// controllers/channelController.js
const Channel = require('../models/Channel');
const { 
    openFacebookLoginWindow, 
    getJoinedFacebookGroupsCached, 
    openYoutubeLoginWindow,
    openTiktokLoginWindow,
    openInstagramLoginWindow,
    openZaloLoginWindow
} = require('../services/socialPlaywrightService');
const {
    normalizeEncryptedValue,
    prepareSensitiveValue,
    restoreRecordForView
} = require('../utils/cryptoVault');
const {
    startFacebookProfileUrlWatcher
} = require('../services/facebookPlaywrightService');

function toBoolean(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'on', 'yes'].includes(String(value).trim().toLowerCase());
}

function normalizeFacebookAccountType(value) {
    const type = String(value || '').trim();
    if (type === 'Fanpage') return 'Fanpage';
    if (type === 'Nhà sáng tạo') return 'Nhà sáng tạo';
    return 'Cá nhân';
}

function normalizeAccountType(value, platform) {
    const type = String(value || '').trim().toLowerCase();
    if (platform === 'FB' || platform === 'TT') {
        if (type === 'fanpage' || type === 'page') return 'Fanpage';
        if (type === 'nhà sáng tạo' || type === 'creator') return 'Nhà sáng tạo';
        return 'Cá nhân';
    }
    if (platform === 'IG') {
        if (type === 'business') return 'Business';
        if (type === 'creator') return 'Creator';
        return 'Personal';
    }
    if (platform === 'YT') {
        if (type === 'channel') return 'Channel';
        if (type === 'brand') return 'Brand';
        return 'Personal';
    }
    if (platform === 'ZO') {
        return 'Personal';
    }
    return 'Cá nhân';
}

async function openSocialLoginWindow(userId, platform, accountName, accountType, profileUrl) {
    const normalizedAccountType = normalizeAccountType(accountType, platform);
    const platformLower = platform.toLowerCase();
    
    try {
        switch(platform) {
            case 'FB':
                return await openFacebookLoginWindow(userId, accountName.trim(), normalizedAccountType);
            case 'YT':
                return await openYoutubeLoginWindow(userId, accountName.trim(), normalizedAccountType);
            case 'TT':
                return await openTiktokLoginWindow(userId, accountName.trim(), normalizedAccountType);
            case 'IG':
                return await openInstagramLoginWindow(userId, accountName.trim(), normalizedAccountType);
            case 'ZO':
                return await openZaloLoginWindow(userId, accountName.trim(), normalizedAccountType);
            default:
                throw new Error(`Platform ${platform} not supported`);
        }
    } catch (error) {
        console.error(`Open ${platform} Login Error:`, error);
        throw error;
    }
}

async function getEncryptionEnabledForUser(userId) {
    const Settings = require('../models/Settings');
    const settings = await Settings.findOne({ userId }).lean();
    return Boolean(settings?.dataEncryptionEnabled);
}

// Hiển thị trang quản lý kênh
const showChannels = async (req, res) => {
    try {
        const requestedPlatform = String(req.query.platform || 'FB').trim().toUpperCase();
        const allowedPlatforms = ['FB', 'TT', 'IG', 'YT', 'ZO'];
        const activePlatform = allowedPlatforms.includes(requestedPlatform) ? requestedPlatform : 'FB';

        const allChannels = await Channel.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
        const safeAllChannels = allChannels.map(channel => restoreRecordForView(channel, ['platform', 'accountName', 'accountType', 'profileUrl', 'followers', 'storageStatePath', 'accessToken']));
        const availablePlatforms = Array.from(new Set(safeAllChannels.map(channel => channel.platform).filter(platform => allowedPlatforms.includes(platform))));
        const channels = safeAllChannels.filter(channel => channel.platform === activePlatform);
        const platformLabels = { FB: 'Facebook', TT: 'TikTok', IG: 'Instagram', YT: 'YouTube', ZO: 'Zalo' };
        const platformLabel = platformLabels[activePlatform] || activePlatform;
        const stats = {
            total: channels.length,
            fb: safeAllChannels.filter(c => c.platform === 'FB').length,
            tt: safeAllChannels.filter(c => c.platform === 'TT').length,
            ig: safeAllChannels.filter(c => c.platform === 'IG').length,
            yt: safeAllChannels.filter(c => c.platform === 'YT').length,
            zo: safeAllChannels.filter(c => c.platform === 'ZO').length
        };
        res.render('channels', { user: req.user, channels, stats, activePlatform, platformLabel, availablePlatforms });
    } catch (error) {
        console.error('Show Channels Error:', error);
        res.render('channels', {
            user: req.user,
            channels: [],
            stats: { total: 0, fb: 0, tt: 0, ig: 0, yt: 0, zo: 0 },
            activePlatform: 'FB',
            platformLabel: 'Facebook',
            availablePlatforms: []
        });
    }
};

// API: Thêm kênh mới
const createChannel = async (req, res) => {
    try {
        const platform = normalizeEncryptedValue(req.body.platform);
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const accountType = normalizeEncryptedValue(req.body.accountType);
        const followers = normalizeEncryptedValue(req.body.followers);
        if (!platform || !accountName) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc' });
        }

        if (!['FB', 'TT', 'IG', 'YT', 'ZO'].includes(platform)) {
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
        res.json({ success: true, message: 'Đã thêm kênh thành công!', channel: restoreRecordForView(channel.toObject(), ['storageStatePath', 'accessToken']) });
    } catch (error) {
        console.error('Create Channel Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Cập nhật trạng thái kênh (bật/tắt)
const toggleChannel = async (req, res) => {
    try {
        const channel = await Channel.findOne({ _id: req.params.id, userId: req.user._id });
        if (!channel) return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });

        channel.isEnabled = !channel.isEnabled;
        await channel.save();
        res.json({ success: true, message: `Kênh đã ${channel.isEnabled ? 'bật' : 'tắt'}`, channel });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Xóa kênh
const deleteChannel = async (req, res) => {
    try {
        const result = await Channel.deleteOne({ _id: req.params.id, userId: req.user._id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });
        res.json({ success: true, message: 'Đã xóa kênh' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Mở Chromium theo đúng tài khoản đã lưu (hỗ trợ FB, TT, IG, YT - trừ Zalo)
const openChannelBrowser = async (req, res) => {
    try {
        const channel = await Channel.findOne({ _id: req.params.id, userId: req.user._id }).lean();
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });
        }

        const safeChannel = restoreRecordForView(channel, ['storageStatePath', 'accessToken', 'accountName', 'accountType', 'platform', 'profileUrl', 'followers']);

        // Map platform -> function mở trình duyệt
        const platformOpeners = {
            FB: (userId, name, type) => openFacebookLoginWindow(userId, name, type, 'FB'),
            TT: (userId, name, type) => openTiktokLoginWindow(userId, name, type),
            IG: (userId, name, type) => openInstagramLoginWindow(userId, name, type),
            YT: (userId, name, type) => openYoutubeLoginWindow(userId, name, type),
        };

        const opener = platformOpeners[safeChannel.platform];
        if (!opener) {
            return res.status(400).json({
                success: false,
                message: 'Không hỗ trợ mở Chromium cho nền tảng này'
            });
        }

        const result = await opener(
            req.user._id,
            safeChannel.accountName,
            safeChannel.accountType || 'Cá nhân'
        );

        return res.json({
            success: true,
            message: result.message,
            channel: safeChannel,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath
        });
    } catch (error) {
        console.error('Open Channel Browser Error:', error);
        return res.status(500).json({
            success: false,
            message: 'Không thể mở Chromium cho tài khoản này: ' + error.message
        });
    }
};

// API: Lấy danh sách kênh (JSON)
const getChannelsAPI = async (req, res) => {
    try {
        const channels = await Channel.find({ userId: req.user._id, isEnabled: true }).lean();
        res.json({ success: true, channels: channels.map(channel => restoreRecordForView(channel, ['platform', 'accountName', 'accountType', 'profileUrl', 'followers', 'storageStatePath', 'accessToken'])) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// API: Lấy danh sách group Facebook mà tài khoản đang tham gia
const getFacebookGroupsAPI = async (req, res) => {
    try {
        const channel = await Channel.findOne({
            _id: req.params.id,
            userId: req.user._id,
            platform: 'FB',
            isEnabled: true
        }).lean();
        // console.log(`[Get Facebook Groups API] Requested channelId: ${req.params.id}, userId: ${req.user._id}`);
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản Facebook hợp lệ' });
        }

        const safeChannel = restoreRecordForView(channel, ['storageStatePath', 'accessToken', 'accountName', 'accountType', 'platform', 'profileUrl', 'followers']);

        const forceRefresh = String(req.query.refresh || '').toLowerCase() === '1' || String(req.query.refresh || '').toLowerCase() === 'true';
        const scanMode = String(req.query.mode || 'fast').toLowerCase() === 'deep' ? 'deep' : 'fast';
        
        const userId = req.user._id;
        const channelId = safeChannel._id;
        const result = await getJoinedFacebookGroupsCached(userId, channelId);
        // console.log(`[Get Facebook Groups API] Cache result for channelId: ${safeChannel._id}, result: ${JSON.stringify(result)}`);

        return res.json({
            success: true,
            groups: result.groups,
            source: result.source,
            updatedAt: result.updatedAt
        });
    } catch (error) {
        console.error('Get Facebook Groups Error:', error);
        return res.status(500).json({ success: false, message: 'Không thể tải danh sách group Facebook: ' + error.message });
    }
};

// API: Mở trình duyệt Facebook để đăng nhập và lưu cookies
// CHỈ tạo/update channel SAU KHI đăng nhập thành công và cookies đã được lưu
const openFacebookConnect = async (req, res) => {
    try {
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const accountType = normalizeEncryptedValue(req.body.accountType);
        if (!accountName || !accountName.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên tài khoản Facebook' });
        }

        const normalizedAccountType = normalizeFacebookAccountType(accountType);
        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.facebookUrl || '');
        const avatarUrl = req.file ? `/uploads/images/${req.file.filename}` : undefined;
        
        // Mở trình duyệt và đợi người dùng đăng nhập + đóng browser
        const result = await openFacebookLoginWindow(req.user._id, accountName.trim(), normalizedAccountType, 'FB');

        // CHỈ tạo/update channel nếu đăng nhập thành công và cookies đã lưu
        if (!result.success || !result.cookiesSaved) {
            return res.json({
                success: false,
                message: result.message || 'Đăng nhập chưa hoàn tất, cookies chưa được lưu. Vui lòng thử lại.',
                cookiesSaved: false
            });
        }

        const encryptionEnabled = await getEncryptionEnabledForUser(req.user._id);

        const updateData = {
            userId: req.user._id,
            platform: 'FB',
            accountName: accountName.trim(),
            accountType: normalizedAccountType,
            profileUrl,
            storageStatePath: prepareSensitiveValue(normalizeEncryptedValue(result.storageStatePath), encryptionEnabled),
            apiStatus: 'active',
            isEnabled: true
        };

        if (avatarUrl) {
            updateData.avatarUrl = avatarUrl;
        }

        const existingChannels = await Channel.find({ userId: req.user._id, platform: 'FB' }).lean();
        const matchedChannel = existingChannels.find((item) => {
            const safeItem = restoreRecordForView(item, ['storageStatePath', 'accessToken', 'accountName', 'accountType', 'platform', 'followers']);
            return safeItem.accountName === accountName.trim() && safeItem.accountType === normalizedAccountType;
        });

        let channel;
        if (matchedChannel) {
            channel = await Channel.findByIdAndUpdate(matchedChannel._id, updateData, { new: true });
        } else {
            channel = await Channel.create(updateData);
        }

        if (result.sessionKey) {
            startFacebookProfileUrlWatcher({
                sessionKey: result.sessionKey,
                userId: req.user._id,
                channelId: channel._id,
                accountName: accountName.trim(),
                accountType: normalizedAccountType
            });
        }

        return res.json({
            success: true,
            message: result.message,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath,
            cookiesSaved: true,
            channel: restoreRecordForView(channel.toObject(), ['storageStatePath', 'accessToken', 'profileUrl'])
        });
    } catch (error) {
        console.error('Open Facebook Connect Error:', error);
        return res.status(500).json({ success: false, message: 'Không thể mở Facebook bằng Playwright: ' + error.message });
    }
};

// API: Cập nhật thông tin kênh (avatar/profile url/tên)
const updateChannel = async (req, res) => {
    try {
        const channel = await Channel.findOne({ _id: req.params.id, userId: req.user._id });
        if (!channel) {
            return res.status(404).json({ success: false, message: 'Kênh không tồn tại' });
        }

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
            channel: restoreRecordForView(channel.toObject(), ['storageStatePath', 'accessToken', 'profileUrl'])
        });
    } catch (error) {
        console.error('Update Channel Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// API: Kết nối TikTok
// CHỈ tạo/update channel SAU KHI đăng nhập thành công và cookies đã được lưu
const openTiktokConnect = async (req, res) => {
    try {
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const accountType = normalizeEncryptedValue(req.body.accountType);
        if (!accountName || !accountName.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên tài khoản TikTok' });
        }

        const normalizedAccountType = normalizeAccountType(accountType, 'TT');
        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.tiktokUrl || '');
        const avatarUrl = req.file ? `/uploads/images/${req.file.filename}` : undefined;

        // Mở trình duyệt và đợi người dùng đăng nhập + đóng browser
        const result = await openTiktokLoginWindow(req.user._id, accountName.trim(), normalizedAccountType);

        // CHỈ tạo/update channel nếu đăng nhập thành công và cookies đã lưu
        if (!result.success || !result.cookiesSaved) {
            return res.json({
                success: false,
                message: result.message || 'Đăng nhập chưa hoàn tất, cookies chưa được lưu. Vui lòng thử lại.',
                cookiesSaved: false
            });
        }

        const encryptionEnabled = await getEncryptionEnabledForUser(req.user._id);

        const updateData = {
            userId: req.user._id,
            platform: 'TT',
            accountName: accountName.trim(),
            accountType: normalizedAccountType,
            profileUrl,
            storageStatePath: prepareSensitiveValue(normalizeEncryptedValue(result.storageStatePath), encryptionEnabled),
            apiStatus: 'active',
            isEnabled: true
        };

        if (avatarUrl) {
            updateData.avatarUrl = avatarUrl;
        }

        const existingChannels = await Channel.find({ userId: req.user._id, platform: 'TT' }).lean();
        const matchedChannel = existingChannels.find((item) => {
            const safeItem = restoreRecordForView(item, ['storageStatePath', 'accessToken', 'accountName', 'accountType', 'platform', 'followers']);
            return safeItem.accountName === accountName.trim() && safeItem.accountType === normalizedAccountType;
        });

        let channel;
        if (matchedChannel) {
            channel = await Channel.findByIdAndUpdate(matchedChannel._id, updateData, { new: true });
        } else {
            channel = await Channel.create(updateData);
        }

        return res.json({
            success: true,
            message: result.message,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath,
            cookiesSaved: true,
            channel: restoreRecordForView(channel.toObject(), ['storageStatePath', 'accessToken', 'profileUrl'])
        });
    } catch (error) {
        console.error('Open TikTok Connect Error:', error);
        return res.status(500).json({ success: false, message: 'Không thể kết nối TikTok: ' + error.message });
    }
};

// API: Kết nối Instagram
// CHỈ tạo/update channel SAU KHI đăng nhập thành công và cookies đã được lưu
const openInstagramConnect = async (req, res) => {
    try {
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const accountType = normalizeEncryptedValue(req.body.accountType);
        if (!accountName || !accountName.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên tài khoản Instagram' });
        }

        const normalizedAccountType = normalizeAccountType(accountType, 'IG');
        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.instagramUrl || '');
        const avatarUrl = req.file ? `/uploads/images/${req.file.filename}` : undefined;

        // Mở trình duyệt và đợi người dùng đăng nhập + đóng browser
        const result = await openInstagramLoginWindow(req.user._id, accountName.trim(), normalizedAccountType);

        // CHỈ tạo/update channel nếu đăng nhập thành công và cookies đã lưu
        if (!result.success || !result.cookiesSaved) {
            return res.json({
                success: false,
                message: result.message || 'Đăng nhập chưa hoàn tất, cookies chưa được lưu. Vui lòng thử lại.',
                cookiesSaved: false
            });
        }

        const encryptionEnabled = await getEncryptionEnabledForUser(req.user._id);

        const updateData = {
            userId: req.user._id,
            platform: 'IG',
            accountName: accountName.trim(),
            accountType: normalizedAccountType,
            profileUrl,
            storageStatePath: prepareSensitiveValue(normalizeEncryptedValue(result.storageStatePath), encryptionEnabled),
            apiStatus: 'active',
            isEnabled: true
        };

        if (avatarUrl) {
            updateData.avatarUrl = avatarUrl;
        }

        const existingChannels = await Channel.find({ userId: req.user._id, platform: 'IG' }).lean();
        const matchedChannel = existingChannels.find((item) => {
            const safeItem = restoreRecordForView(item, ['storageStatePath', 'accessToken', 'accountName', 'accountType', 'platform', 'followers']);
            return safeItem.accountName === accountName.trim() && safeItem.accountType === normalizedAccountType;
        });

        let channel;
        if (matchedChannel) {
            channel = await Channel.findByIdAndUpdate(matchedChannel._id, updateData, { new: true });
        } else {
            channel = await Channel.create(updateData);
        }

        return res.json({
            success: true,
            message: result.message,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath,
            cookiesSaved: true,
            channel: restoreRecordForView(channel.toObject(), ['storageStatePath', 'accessToken', 'profileUrl'])
        });
    } catch (error) {
        console.error('Open Instagram Connect Error:', error);
        return res.status(500).json({ success: false, message: 'Không thể kết nối Instagram: ' + error.message });
    }
};

// API: Kết nối YouTube
// CHỈ tạo/update channel SAU KHI đăng nhập thành công và cookies đã được lưu
const openYoutubeConnect = async (req, res) => {
    try {
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const accountType = normalizeEncryptedValue(req.body.accountType);
        if (!accountName || !accountName.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên kênh YouTube' });
        }

        const normalizedAccountType = normalizeAccountType(accountType, 'YT');
        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.youtubeUrl || '');
        const avatarUrl = req.file ? `/uploads/images/${req.file.filename}` : undefined;

        // Mở trình duyệt và đợi người dùng đăng nhập + đóng browser
        const result = await openYoutubeLoginWindow(req.user._id, accountName.trim(), normalizedAccountType);

        // CHỈ tạo/update channel nếu đăng nhập thành công và cookies đã lưu
        if (!result.success || !result.cookiesSaved) {
            return res.json({
                success: false,
                message: result.message || 'Đăng nhập chưa hoàn tất, cookies chưa được lưu. Vui lòng thử lại.',
                cookiesSaved: false
            });
        }

        const encryptionEnabled = await getEncryptionEnabledForUser(req.user._id);

        const updateData = {
            userId: req.user._id,
            platform: 'YT',
            accountName: accountName.trim(),
            accountType: normalizedAccountType,
            profileUrl,
            storageStatePath: prepareSensitiveValue(normalizeEncryptedValue(result.storageStatePath), encryptionEnabled),
            apiStatus: 'active',
            isEnabled: true
        };

        if (avatarUrl) {
            updateData.avatarUrl = avatarUrl;
        }

        const existingChannels = await Channel.find({ userId: req.user._id, platform: 'YT' }).lean();
        const matchedChannel = existingChannels.find((item) => {
            const safeItem = restoreRecordForView(item, ['storageStatePath', 'accessToken', 'accountName', 'accountType', 'platform', 'followers']);
            return safeItem.accountName === accountName.trim() && safeItem.accountType === normalizedAccountType;
        });

        let channel;
        if (matchedChannel) {
            channel = await Channel.findByIdAndUpdate(matchedChannel._id, updateData, { new: true });
        } else {
            channel = await Channel.create(updateData);
        }

        return res.json({
            success: true,
            message: result.message,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath,
            cookiesSaved: true,
            channel: restoreRecordForView(channel.toObject(), ['storageStatePath', 'accessToken', 'profileUrl'])
        });
    } catch (error) {
        console.error('Open YouTube Connect Error:', error);
        return res.status(500).json({ success: false, message: 'Không thể kết nối YouTube: ' + error.message });
    }
};

// API: Kết nối Zalo
// CHỈ tạo/update channel SAU KHI đăng nhập thành công và cookies đã được lưu
const openZaloConnect = async (req, res) => {
    try {
        const accountName = normalizeEncryptedValue(req.body.accountName);
        const accountType = normalizeEncryptedValue(req.body.accountType);
        if (!accountName || !accountName.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên tài khoản Zalo' });
        }

        const normalizedAccountType = normalizeAccountType(accountType, 'ZO');
        const profileUrl = normalizeEncryptedValue(req.body.profileUrl || req.body.zaloUrl || '');
        const avatarUrl = req.file ? `/uploads/images/${req.file.filename}` : undefined;

        // Mở trình duyệt và đợi người dùng đăng nhập + đóng browser
        const result = await openZaloLoginWindow(req.user._id, accountName.trim(), normalizedAccountType);

        // CHỈ tạo/update channel nếu đăng nhập thành công và cookies đã lưu
        if (!result.success || !result.cookiesSaved) {
            return res.json({
                success: false,
                message: result.message || 'Đăng nhập chưa hoàn tất, cookies chưa được lưu. Vui lòng thử lại.',
                cookiesSaved: false
            });
        }

        const encryptionEnabled = await getEncryptionEnabledForUser(req.user._id);

        const updateData = {
            userId: req.user._id,
            platform: 'ZO',
            accountName: accountName.trim(),
            accountType: normalizedAccountType,
            profileUrl,
            storageStatePath: prepareSensitiveValue(normalizeEncryptedValue(result.storageStatePath), encryptionEnabled),
            apiStatus: 'active',
            isEnabled: true
        };

        if (avatarUrl) {
            updateData.avatarUrl = avatarUrl;
        }

        const existingChannels = await Channel.find({ userId: req.user._id, platform: 'ZO' }).lean();
        const matchedChannel = existingChannels.find((item) => {
            const safeItem = restoreRecordForView(item, ['storageStatePath', 'accessToken', 'accountName', 'accountType', 'platform', 'followers']);
            return safeItem.accountName === accountName.trim() && safeItem.accountType === normalizedAccountType;
        });

        let channel;
        if (matchedChannel) {
            channel = await Channel.findByIdAndUpdate(matchedChannel._id, updateData, { new: true });
        } else {
            channel = await Channel.create(updateData);
        }

        return res.json({
            success: true,
            message: result.message,
            sessionDir: result.sessionDir,
            storageStatePath: result.storageStatePath,
            cookiesSaved: true,
            channel: restoreRecordForView(channel.toObject(), ['storageStatePath', 'accessToken', 'profileUrl'])
        });
    } catch (error) {
        console.error('Open Zalo Connect Error:', error);
        return res.status(500).json({ success: false, message: 'Không thể kết nối Zalo: ' + error.message });
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
    openFacebookConnect,
    openTiktokConnect,
    openYoutubeConnect,
    openInstagramConnect,
    openZaloConnect,
    updateChannel
};
