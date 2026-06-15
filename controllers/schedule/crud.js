// controllers/schedule/crud.js
const SchedulePost = require('../../models/SchedulePost');
const Channel = require('../../models/Channel');
const ShopeeLink = require('../../models/ShopeeLink');
const Video = require('../../models/Video');
const { getJoinedFacebookGroupsCached } = require('../../services/socialPlaywrightService');
const { pokeReelsScheduleRunner } = require('../../services/reelsScheduleRunner');
const { sendTelegramNotification, NOTIFICATION_TYPES } = require('../../services/telegramService');
const {
    buildSchedulePopulateOptions,
    normalizeIdArray,
    validateScheduledAt,
    normalizeScheduleAccounts,
    isFacebookPersonalChannel,
    getOwnedChannelsByIds,
    normalizeScheduleVideoPath,
    formatDateTimeVi,
    buildScheduleManagerRow
} = require('./helpers');

const showSchedulePost = async (req, res) => {
    try {
        const posts = await SchedulePost.find({ userId: req.user._id, type: 'post' }).sort({ scheduledAt: 1 }).lean();
        const channels = await Channel.find({ userId: req.user._id, isEnabled: true }).lean();
        const facebookChannels = await Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true }).sort({ createdAt: -1 }).lean();
        res.render('schedule-post', { user: req.user, posts, channels, facebookChannels });
    } catch (error) {
        console.error('Show Schedule Post Error:', error);
        res.render('schedule-post', { user: req.user, posts: [], channels: [], facebookChannels: [] });
    }
};

const showScheduleManager = async (req, res) => {
    try {
        const [schedules, channels, facebookChannels, videos, shopeeLinks] = await Promise.all([
            SchedulePost.find({ userId: req.user._id })
                .populate(buildSchedulePopulateOptions(req.user._id))
                .sort({ scheduledAt: -1 })
                .lean(),
            Channel.find({ userId: req.user._id, isEnabled: true })
                .select('_id platform accountName accountType avatarUrl followers')
                .sort({ createdAt: -1 })
                .lean(),
            Channel.find({ userId: req.user._id, platform: 'FB', isEnabled: true })
                .select('_id accountName accountType avatarUrl followers')
                .sort({ createdAt: -1 })
                .lean(),
            Video.find({ userId: req.user._id })
                .select('_id title thumbnailUrl status createdAt')
                .sort({ createdAt: -1 })
                .lean(),
            ShopeeLink.find({ userId: req.user._id })
                .select('_id title shopeeUrl imageUrl status createdAt')
                .sort({ createdAt: -1 })
                .lean()
        ]);

        const scheduleRows = schedules.map(buildScheduleManagerRow);
        const stats = {
            total: scheduleRows.length,
            pending: scheduleRows.filter(item => item.status === 'pending').length,
            posted: scheduleRows.filter(item => item.status === 'posted').length,
            failed: scheduleRows.filter(item => item.status === 'failed').length
        };

        res.render('schedule-manager', { user: req.user, schedules: scheduleRows, stats, channels, facebookChannels, videos, shopeeLinks });
    } catch (error) {
        console.error('Show Schedule Manager Error:', error);
        res.render('schedule-manager', {
            user: req.user,
            schedules: [],
            stats: { total: 0, pending: 0, posted: 0, failed: 0 },
            channels: [],
            facebookChannels: [],
            videos: [],
            shopeeLinks: []
        });
    }
};

const showScheduleReels = async (req, res) => {
    try {
        const posts = await SchedulePost.find({ userId: req.user._id, type: 'reels' }).sort({ scheduledAt: 1 }).lean();
        const channels = await Channel.find({ userId: req.user._id, isEnabled: true }).lean();
        res.render('reels', { user: req.user, posts, channels });
    } catch (error) {
        console.error('Show Schedule Reels Error:', error);
        res.render('reels', { user: req.user, posts: [], channels: [] });
    }
};

const createSchedule = async (req, res) => {
    try {
        let platforms = req.body.platforms;
        if (typeof platforms === 'string') {
            platforms = platforms ? [platforms] : [];
        } else if (!Array.isArray(platforms)) {
            platforms = [];
        }

        const { type, caption, scheduledAt, accounts, videoId, videoPath, videoTitle, videoSize, shopeeLinks, targetGroupId, targetGroupIds, targetGroupSourceChannelId } = req.body;
        if (!scheduledAt) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn thời gian đăng' });
        }

        const scheduledAtError = validateScheduledAt(scheduledAt);
        if (scheduledAtError) {
            return res.status(400).json({ success: false, message: scheduledAtError });
        }

        const nextType = type || 'post';
        const requestedVideoId = videoId || undefined;
        const requestedShopeeLinkIds = normalizeIdArray(shopeeLinks);
        const normalizedAccounts = normalizeScheduleAccounts(accounts);

        if (nextType === 'reels' && normalizedAccounts.length) {
            const selectedAccounts = await getOwnedChannelsByIds(req.user._id, normalizedAccounts);
            const selectedAccountIds = new Set(selectedAccounts.map(channel => String(channel._id)));
            const missingAccountIds = normalizedAccounts.filter(channelId => !selectedAccountIds.has(String(channelId)));

            if (missingAccountIds.length) {
                return res.status(404).json({ success: false, message: 'Một số tài khoản đã chọn không tồn tại hoặc không thuộc tài khoản hiện tại' });
            }

            if (selectedAccounts.some(isFacebookPersonalChannel)) {
                return res.status(400).json({ success: false, message: 'Tài khoản Facebook cá nhân không hỗ trợ đăng Reels. Vui lòng chọn Fanpage hoặc Nhà sáng tạo' });
            }
        }

        let ownedVideoId;
        if (nextType === 'reels' && requestedVideoId) {
            const ownedVideo = await Video.findOne({ _id: requestedVideoId, userId: req.user._id }).select('_id').lean();
            if (!ownedVideo) {
                return res.status(404).json({ success: false, message: 'Video không tồn tại hoặc không thuộc tài khoản hiện tại' });
            }
            ownedVideoId = ownedVideo._id;
        }

        const normalizedVideoPath = normalizeScheduleVideoPath(videoPath || '');

        let ownedShopeeLinkIds = [];
        if (requestedShopeeLinkIds.length > 0) {
            ownedShopeeLinkIds = await ShopeeLink.distinct('_id', {
                _id: { $in: requestedShopeeLinkIds },
                userId: req.user._id
            });
        }

        let selectedTargetGroups = [];
        let selectedSourceChannel = null;

        if (nextType === 'post') {
            let targetGroupIdsArray = [];
            if (targetGroupIds) {
                try {
                    targetGroupIdsArray = typeof targetGroupIds === 'string' ? JSON.parse(targetGroupIds) : targetGroupIds;
                } catch (e) {
                    targetGroupIdsArray = [];
                }
            }

            if (targetGroupIdsArray.length === 0 && targetGroupId) {
                targetGroupIdsArray = [targetGroupId];
            }

            const hasTargetGroupSelection = targetGroupIdsArray.length > 0 || targetGroupSourceChannelId;

            if (hasTargetGroupSelection) {
                if (!targetGroupSourceChannelId) {
                    return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook nguồn' });
                }

                if (targetGroupIdsArray.length === 0) {
                    return res.status(400).json({ success: false, message: 'Vui lòng chọn ít nhất một group để đăng bài' });
                }

                selectedSourceChannel = await Channel.findOne({
                    _id: targetGroupSourceChannelId,
                    userId: req.user._id,
                    platform: 'FB',
                    isEnabled: true
                }).select('_id accountName accountType').lean();

                if (!selectedSourceChannel) {
                    return res.status(404).json({ success: false, message: 'Tài khoản Facebook nguồn không tồn tại hoặc đã bị tắt' });
                }

                const { groups: joinedGroups } = await getJoinedFacebookGroupsCached(
                    req.user._id,
                    selectedSourceChannel._id
                );

                for (const groupKey of targetGroupIdsArray) {
                    const foundGroup = joinedGroups.find(group =>
                        String(group.groupId) === String(groupKey) ||
                        String(group.groupUrl) === String(groupKey)
                    );
                    if (foundGroup) {
                        selectedTargetGroups.push(foundGroup);
                    }
                }

                if (selectedTargetGroups.length === 0) {
                    return res.status(404).json({ success: false, message: 'Không tìm thấy group nào trong danh sách đã chọn' });
                }
            }
        }

        let images = [];
        if (req.files && req.files.length > 0) {
            images = req.files.map(f => '/uploads/images/' + f.filename);
        }
        
        const schedule = await SchedulePost.create({
            userId: req.user._id,
            type: nextType,
            caption: caption || '',
            images,
            videoId: ownedVideoId,
            videoPath: nextType === 'reels' ? normalizedVideoPath : '',
            videoTitle: nextType === 'reels' ? String(videoTitle || '').trim() : '',
            videoSize: nextType === 'reels' ? String(videoSize || '').trim() : '',
            shopeeLinks: ownedShopeeLinkIds,
            targetGroupSourceChannelId: selectedSourceChannel?._id,
            targetGroupIds: selectedTargetGroups.map(g => g.groupUrl || g.groupId),
            targetGroupId: selectedTargetGroups[0]?.groupId || '',
            targetGroupName: selectedTargetGroups[0]?.groupName || '',
            targetGroupUrl: selectedTargetGroups[0]?.groupUrl || '',
            scheduledAt: new Date(scheduledAt),
            platforms: platforms || [],
            accounts: normalizedAccounts
        });

        if (nextType === 'reels' && schedule.shopeeLinks?.length) {
            await ShopeeLink.updateMany(
                { _id: { $in: schedule.shopeeLinks }, userId: req.user._id },
                { $set: { status: 'attached' } }
            );
        }

        console.log(`[Schedule API] createSchedule => armed reels wakeup for schedule ${schedule._id} type=${nextType} at ${schedule.scheduledAt.toISOString()}`);
        await pokeReelsScheduleRunner().catch(() => {});

        sendTelegramNotification(req.user._id, NOTIFICATION_TYPES.PROGRESS, {
            action: 'Tạo lịch đăng mới',
            scheduleTitle: schedule.caption || schedule.videoTitle || '—',
            platform: Array.isArray(schedule.platforms) ? schedule.platforms[0] : 'FB',
            time: formatDateTimeVi(schedule.scheduledAt)
        }).catch(() => {});

        await schedule.populate(buildSchedulePopulateOptions(req.user._id));
        res.json({ success: true, message: 'Đã lên lịch thành công!', schedule });
    } catch (error) {
        console.error('Create Schedule Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const updateSchedule = async (req, res) => {
    try {
        let platforms = req.body.platforms;
        if (typeof platforms === 'string') {
            platforms = platforms ? [platforms] : [];
        } else if (!Array.isArray(platforms)) {
            platforms = [];
        }

        const { scheduleId, type, status, caption, scheduledAt, accounts, videoId, videoPath, videoTitle, videoSize, shopeeLinks, targetGroupSourceChannelId } = req.body;
        const targetGroupIds = req.body.targetGroupIds || req.body.targetGroupId || [];
        if (!scheduleId) {
            return res.status(400).json({ success: false, message: 'Thiếu scheduleId' });
        }
        if (!/^[0-9a-fA-F]{24}$/.test(scheduleId)) {
            return res.status(400).json({ success: false, message: 'scheduleId không hợp lệ' });
        }
        if (!scheduledAt) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn thời gian đăng' });
        }

        const scheduledAtError = validateScheduledAt(scheduledAt);
        if (scheduledAtError) {
            return res.status(400).json({ success: false, message: scheduledAtError });
        }

        const schedule = await SchedulePost.findOne({ _id: scheduleId, userId: req.user._id });
        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch đăng' });
        }

        if (schedule.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Lịch đã chạy rồi, không thể sửa nữa' });
        }

        const nextType = type || schedule.type;
        const nextShopeeLinkIds = normalizeIdArray(shopeeLinks);
        const normalizedAccounts = normalizeScheduleAccounts(accounts);

        if (nextType === 'reels' && normalizedAccounts.length) {
            const selectedAccounts = await getOwnedChannelsByIds(req.user._id, normalizedAccounts);
            const selectedAccountIds = new Set(selectedAccounts.map(channel => String(channel._id)));
            const missingAccountIds = normalizedAccounts.filter(channelId => !selectedAccountIds.has(String(channelId)));

            if (missingAccountIds.length) {
                return res.status(404).json({ success: false, message: 'Một số tài khoản đã chọn không tồn tại hoặc không thuộc tài khoản hiện tại' });
            }

            if (selectedAccounts.some(isFacebookPersonalChannel)) {
                return res.status(400).json({ success: false, message: 'Tài khoản Facebook cá nhân không hỗ trợ đăng Reels. Vui lòng chọn Fanpage hoặc Nhà sáng tạo' });
            }
        }

        let ownedVideoId = schedule.videoId;
        let nextVideoPath = normalizeScheduleVideoPath(videoPath || schedule.videoPath || '');
        let nextVideoTitle = String(videoTitle || schedule.videoTitle || '').trim();
        let nextVideoSize = String(videoSize || schedule.videoSize || '').trim();
        if (nextType === 'reels') {
            const requestedVideoId = videoId || schedule.videoId;
            if (!requestedVideoId && !nextVideoPath) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn video cho lịch Reels' });
            }

            if (requestedVideoId) {
                const ownedVideo = await Video.findOne({ _id: requestedVideoId, userId: req.user._id }).select('_id').lean();
                if (!ownedVideo) {
                    return res.status(404).json({ success: false, message: 'Video không tồn tại hoặc không thuộc tài khoản hiện tại' });
                }
                ownedVideoId = ownedVideo._id;
                nextVideoPath = '';
                nextVideoTitle = '';
                nextVideoSize = '';
            }
        }

        let ownedShopeeLinkIds = [];
        if (nextShopeeLinkIds.length > 0) {
            ownedShopeeLinkIds = await ShopeeLink.distinct('_id', {
                _id: { $in: nextShopeeLinkIds },
                userId: req.user._id
            });
        }

        let selectedTargetGroups = [];
        let selectedSourceChannel = null;
        const hasTargetGroupSelection = nextType === 'post';   
  
        if (hasTargetGroupSelection) {
            if (!targetGroupSourceChannelId || !targetGroupIds) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook và group đích' });
            }

            selectedSourceChannel = await Channel.findOne({
                _id: targetGroupSourceChannelId,
                userId: req.user._id,
                platform: 'FB',
                isEnabled: true
            }).select('_id accountName accountType').lean();

            if (!selectedSourceChannel) {
                return res.status(404).json({ success: false, message: 'Tài khoản Facebook nguồn không tồn tại hoặc đã bị tắt' });
            }

            const { groups: joinedGroups } = await getJoinedFacebookGroupsCached(
                req.user._id,
                selectedSourceChannel._id
            );

            const targetGroupIdArray = typeof targetGroupIds === 'string' 
                ? (targetGroupIds.startsWith('[') ? JSON.parse(targetGroupIds) : [targetGroupIds])
                : (Array.isArray(targetGroupIds) ? targetGroupIds : [targetGroupIds]);

            selectedTargetGroups = joinedGroups.filter(group => 
                targetGroupIdArray.includes(String(group.groupId)) || 
                targetGroupIdArray.includes(String(group.groupUrl))
            );
            if (!selectedTargetGroups.length) {
                return res.status(404).json({ success: false, message: 'Group được chọn không thuộc danh sách group mà tài khoản này đã tham gia' });
            }
        }

        schedule.type = nextType;
        if (status && ['pending', 'posted', 'failed'].includes(status)) {
            schedule.status = status;
        }
        schedule.caption = caption || '';
        schedule.scheduledAt = new Date(scheduledAt);
        schedule.platforms = platforms || [];
        schedule.accounts = normalizedAccounts;
        schedule.targetGroupSourceChannelId = selectedSourceChannel?._id;
        schedule.targetGroupIds = selectedTargetGroups.map(g => g.groupUrl || g.groupId);
        schedule.targetGroupId = selectedTargetGroups[0]?.groupId || '';
        schedule.targetGroupName = selectedTargetGroups[0]?.groupName || '';
        schedule.targetGroupUrl = selectedTargetGroups[0]?.groupUrl || '';
        schedule.publishedUrl = '';
        if (nextType === 'reels') {
            schedule.videoId = ownedVideoId;
            schedule.videoPath = nextVideoPath;
            schedule.videoTitle = nextVideoTitle;
            schedule.videoSize = nextVideoSize;
            schedule.images = [];
            schedule.shopeeLinks = ownedShopeeLinkIds;
        } else {
            const existingImages = req.body.existingImages ? (Array.isArray(req.body.existingImages) ? req.body.existingImages : [req.body.existingImages]) : [];
            const newImagePaths = req.files && req.files.length > 0 ? req.files.map(f => '/uploads/images/' + f.filename) : [];
            schedule.images = [...existingImages, ...newImagePaths];
            schedule.videoId = undefined;
            schedule.videoPath = '';
            schedule.videoTitle = '';
            schedule.videoSize = '';
            schedule.shopeeLinks = ownedShopeeLinkIds;
        }

        if (nextType === 'reels' && req.file) {
            schedule.videoPath = '/uploads/reels/' + req.file.filename;
        }

        await schedule.save();

        if (schedule.shopeeLinks?.length) {
            await ShopeeLink.updateMany(
                { _id: { $in: schedule.shopeeLinks }, userId: req.user._id },
                { $set: { status: 'attached' } }
            );
        }

        console.log(`[Schedule API] updateSchedule => armed reels wakeup for schedule ${schedule._id} type=${schedule.type} at ${schedule.scheduledAt.toISOString()}`);
        await pokeReelsScheduleRunner().catch(() => {});

        await schedule.populate(buildSchedulePopulateOptions(req.user._id));
        res.json({ success: true, message: 'Đã cập nhật lịch đăng!', schedule });
    } catch (error) {
        console.error('Update Schedule Error:', error);
        res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

const getSchedulesAPI = async (req, res) => {
    try {
        const { type, month, year } = req.query;
        const filter = { userId: req.user._id };
        if (type) filter.type = type;
        if (month && year) {
            const start = new Date(year, month - 1, 1);
            const end = new Date(year, month, 0, 23, 59, 59);
            filter.scheduledAt = { $gte: start, $lte: end };
        }
        const schedules = await SchedulePost.find(filter)
            .populate(buildSchedulePopulateOptions(req.user._id))
            .sort({ scheduledAt: 1 })
            .lean();
        res.json({ success: true, schedules });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getScheduleByIdAPI = async (req, res) => {
    try {
        const schedule = await SchedulePost.findOne({ _id: req.params.id, userId: req.user._id })
            .populate(buildSchedulePopulateOptions(req.user._id))
            .lean();
        if (!schedule) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy lịch đăng' });
        }

        res.json({ success: true, schedule });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteSchedule = async (req, res) => {
    try {
        const result = await SchedulePost.deleteOne({ _id: req.params.id, userId: req.user._id });
        if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Không tìm thấy' });
        res.json({ success: true, message: 'Đã xóa lịch đăng' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getScheduleByDateAPI = async (req, res) => {
    try {
        const { type, date } = req.query;
        if (!date) return res.status(400).json({ success: false, message: 'Thiếu ngày cần tra cứu' });

        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        const filter = {
            userId: req.user._id,
            scheduledAt: { $gte: start, $lte: end }
        };
        if (type) filter.type = type;

        const schedules = await SchedulePost.find(filter)
            .populate(buildSchedulePopulateOptions(req.user._id))
            .sort({ scheduledAt: 1 })
            .lean();
        res.json({ success: true, schedules });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    showSchedulePost,
    showScheduleManager,
    showScheduleReels,
    createSchedule,
    updateSchedule,
    getSchedulesAPI,
    getScheduleByIdAPI,
    deleteSchedule,
    getScheduleByDateAPI
};