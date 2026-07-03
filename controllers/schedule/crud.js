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
    validateVideoForPlatforms,
    validatePinterestBusinessAccount,
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
        console.log('[schedule-create] req.body keys:', Object.keys(req.body || {}));
        console.log('[schedule-create] accounts raw:', req.body?.accounts);
        console.log('[schedule-create] platforms:', req.body?.platforms);

        let platforms = req.body.platforms;
        if (typeof platforms === 'string') {
            platforms = platforms ? [platforms] : [];
        } else if (!Array.isArray(platforms)) {
            platforms = [];
        }

        const { type, caption, postTitle, scheduledAt, accounts, videoId, videoPath, videoTitle, videoSize, shopeeLinks, targetGroupId, targetGroupIds, targetGroupSourceChannelId, postTargetType } = req.body;
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
        console.log('[schedule-create] normalizedAccounts:', normalizedAccounts);

        // Nếu chọn IG/TH/PI (Instagram/Threads/Pinterest) cho post, bắt buộc phải có ảnh
        const hasIg = platforms.includes('IG');
        const hasTh = platforms.includes('TH');
        const hasPi = platforms.includes('PI');
        if (nextType === 'post' && (hasIg || hasTh || hasPi)) {
            const hasNewImages = req.files && req.files.length > 0;
            if (!hasNewImages) {
                const names = [];
                if (hasIg) names.push('Instagram');
                if (hasTh) names.push('Threads');
                if (hasPi) names.push('Pinterest');
                return res.status(400).json({ success: false, message: `${names.join('/')} yêu cầu phải có ít nhất 1 hình ảnh!` });
            }
        }

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

        // Nếu là reels, bắt buộc phải có video
        if (nextType === 'reels') {
            const normalizedVideoPath = normalizeScheduleVideoPath(videoPath || '');
            if (!requestedVideoId && !normalizedVideoPath) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn video cho lịch Reels!' });
            }

            // Validate duration theo platform TH/PI nếu user chọn
            const hasTH = platforms.includes('TH');
            const hasPI = platforms.includes('PI');
            if (hasTH || hasPI) {
                let videoPathToCheck = normalizedVideoPath;
                if (requestedVideoId && !videoPathToCheck) {
                    const ownedVideo = await Video.findOne({ _id: requestedVideoId, userId: req.user._id }).select('filePath').lean();
                    if (ownedVideo?.filePath) videoPathToCheck = ownedVideo.filePath;
                }
                const videoValidation = await validateVideoForPlatforms(platforms, videoPathToCheck);
                if (!videoValidation.valid) {
                    return res.status(400).json({ success: false, message: videoValidation.message });
                }
            }
            // Note: Pinterest Idea Pin cho phép cả tài khoản Personal + Business.
            // Không check accountType ở đây — scheduler sẽ tự xử lý nếu Pinterest reject.

            // Pinterest Idea Pin (Reels) bắt buộc phải có tiêu đề video
            if (hasPi && !String(videoTitle || '').trim()) {
                return res.status(400).json({ success: false, message: 'Pinterest Idea Pin yêu cầu phải có tiêu đề video!' });
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
            const effectiveTargetType = postTargetType || 'group';

            // Only validate groups if target type is 'group'
            if (effectiveTargetType === 'group') {
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
            } else {
                // For personal/fanpage targets, use targetGroupSourceChannelId or first FB account
                if (targetGroupSourceChannelId) {
                    selectedSourceChannel = await Channel.findOne({
                        _id: targetGroupSourceChannelId,
                        userId: req.user._id,
                        platform: 'FB',
                        isEnabled: true
                    }).select('_id accountName accountType').lean();
                } else if (normalizedAccounts.length > 0) {
                    selectedSourceChannel = await Channel.findOne({
                        _id: normalizedAccounts[0],
                        userId: req.user._id,
                        platform: 'FB',
                        isEnabled: true
                    }).select('_id accountName accountType').lean();
                }
                if (!selectedSourceChannel) {
                    return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook nguồn' });
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
            postTargetType: postTargetType || 'group',
            targetGroupIds: selectedTargetGroups.map(g => g.groupUrl || g.groupId),
            targetGroupNames: selectedTargetGroups.map(g => g.groupName || ''),
            targetGroupId: selectedTargetGroups[0]?.groupId || '',
            targetGroupName: selectedTargetGroups[0]?.groupName || '',
            targetGroupUrl: selectedTargetGroups[0]?.groupUrl || '',
            scheduledAt: new Date(scheduledAt),
            platforms: platforms || [],
            accounts: normalizedAccounts,
            postTitle: nextType === 'post' ? String(postTitle || '').trim() : ''
        });
        console.log('[schedule-create] saved schedule.accounts:', schedule.accounts);

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

        const { scheduleId, type, status, caption, scheduledAt, accounts, videoId, videoPath, videoTitle, videoSize, shopeeLinks, targetGroupSourceChannelId, postTargetType: reqPostTargetType } = req.body;
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

        if (schedule.status !== 'pending' && schedule.status !== 'failed') {
            return res.status(400).json({ success: false, message: 'Lịch đã chạy rồi, không thể sửa nữa' });
        }

        // Nếu lịch đang failed → tự động reset về pending để scheduler chạy lại
        // User vẫn phải chọn thời gian hiện tại/tương lai, không được giữ thời gian quá khứ.
        const wasFailed = schedule.status === 'failed';

        const nextType = type || schedule.type;
        const nextShopeeLinkIds = normalizeIdArray(shopeeLinks);
        const normalizedAccounts = normalizeScheduleAccounts(accounts);

        // Validate lại scheduledAt lần 2 (sau khi đã có schedule + wasFailed) để
        // cho phép chỉnh sửa thời gian trong quá khứ khi update lịch failed.
        const scheduledAtErrorRetry = validateScheduledAt(scheduledAt, { allowPastForFailed: wasFailed });
        if (scheduledAtErrorRetry) {
            return res.status(400).json({ success: false, message: scheduledAtErrorRetry });
        }

        // Nếu chọn IG/TH/PI (Instagram/Threads/Pinterest) cho post, bắt buộc phải có ảnh
        const hasIg = platforms.includes('IG');
        const hasTh = platforms.includes('TH');
        const hasPi = platforms.includes('PI');
        if (nextType === 'post' && (hasIg || hasTh || hasPi)) {
            const hasExistingImagesObj = Array.isArray(schedule.images) && schedule.images.length > 0;
            const hasExistingImagesBody = req.body.existingImages ? (Array.isArray(req.body.existingImages) ? req.body.existingImages.length > 0 : true) : false;
            const hasNewImages = req.files && req.files.length > 0;
            if (!hasExistingImagesObj && !hasExistingImagesBody && !hasNewImages) {
                const names = [];
                if (hasIg) names.push('Instagram');
                if (hasTh) names.push('Threads');
                if (hasPi) names.push('Pinterest');
                return res.status(400).json({ success: false, message: `${names.join('/')} yêu cầu phải có ít nhất 1 hình ảnh!` });
            }
        }

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

            // Validate duration theo platform TH/PI
            const hasTH = platforms.includes('TH');
            const hasPI = platforms.includes('PI');
            if (hasTH || hasPI) {
                let videoPathToCheck = nextVideoPath;
                if (ownedVideoId && !videoPathToCheck) {
                    const ownedVideo = await Video.findOne({ _id: ownedVideoId, userId: req.user._id }).select('filePath').lean();
                    if (ownedVideo?.filePath) videoPathToCheck = ownedVideo.filePath;
                }
                const videoValidation = await validateVideoForPlatforms(platforms, videoPathToCheck);
                if (!videoValidation.valid) {
                    return res.status(400).json({ success: false, message: videoValidation.message });
                }
            }

            // Pinterest Idea Pin (Reels) bắt buộc phải có tiêu đề video
            if (hasPI && !nextVideoTitle) {
                return res.status(400).json({ success: false, message: 'Pinterest Idea Pin yêu cầu phải có tiêu đề video!' });
            }
            // Note: Pinterest Idea Pin cho phép cả tài khoản Personal + Business.
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
        const effectivePostTargetType = reqPostTargetType || schedule.postTargetType || 'group';
        // Chỉ yêu cầu group FB khi post có chọn platform FB và target type là 'group'
        const hasTargetGroupSelection = nextType === 'post' && platforms.includes('FB') && effectivePostTargetType === 'group';

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
        } else if (nextType === 'post' && platforms.includes('FB') && effectivePostTargetType !== 'group') {
            // For personal/fanpage targets, use targetGroupSourceChannelId or first FB account
            if (targetGroupSourceChannelId) {
                selectedSourceChannel = await Channel.findOne({
                    _id: targetGroupSourceChannelId,
                    userId: req.user._id,
                    platform: 'FB',
                    isEnabled: true
                }).select('_id accountName accountType').lean();
            } else if (normalizedAccounts.length > 0) {
                selectedSourceChannel = await Channel.findOne({
                    _id: normalizedAccounts[0],
                    userId: req.user._id,
                    platform: 'FB',
                    isEnabled: true
                }).select('_id accountName accountType').lean();
            }
            if (!selectedSourceChannel) {
                return res.status(400).json({ success: false, message: 'Vui lòng chọn tài khoản Facebook nguồn' });
            }
        }

        schedule.type = nextType;
        // Nếu lịch đang failed → tự động reset về pending để scheduler chạy lại
        if (wasFailed) {
            schedule.status = 'pending';
        } else if (status && ['pending', 'posted', 'failed'].includes(status)) {
            schedule.status = status;
        }
        schedule.caption = caption || '';
        schedule.scheduledAt = new Date(scheduledAt);
        schedule.platforms = platforms || [];
        schedule.accounts = normalizedAccounts;
        schedule.targetGroupSourceChannelId = selectedSourceChannel?._id;
        schedule.postTargetType = effectivePostTargetType;
        schedule.targetGroupIds = selectedTargetGroups.map(g => g.groupUrl || g.groupId);
        schedule.targetGroupNames = selectedTargetGroups.map(g => g.groupName || '');
        schedule.targetGroupId = selectedTargetGroups[0]?.groupId || '';
        schedule.targetGroupName = selectedTargetGroups[0]?.groupName || '';
        schedule.targetGroupUrl = selectedTargetGroups[0]?.groupUrl || '';
        schedule.publishedUrl = '';
        if (nextType === 'post') {
            schedule.postTitle = String(postTitle || '').trim();
        }
        if (nextType === 'reels') {
            schedule.videoId = ownedVideoId;
            schedule.videoPath = nextVideoPath;
            schedule.videoTitle = nextVideoTitle;
            schedule.videoSize = nextVideoSize;
            schedule.images = [];
            schedule.shopeeLinks = ownedShopeeLinkIds;
        } else {
            // existingImages: danh sách URL ảnh cũ client muốn GIỮ LẠI.
            // Nếu client không gửi existingImages (undefined) → giữ nguyên ảnh cũ trong DB (backward-compat cho modal edit không gửi field này).
            // Nếu client gửi mảng rỗng → user đã xoá hết ảnh, set rỗng.
            let mergedImages;
            if (req.body.existingImages === undefined || req.body.existingImages === null || req.body.existingImages === '') {
                mergedImages = Array.isArray(schedule.images) ? [...schedule.images] : [];
            } else {
                const existingImages = Array.isArray(req.body.existingImages) ? req.body.existingImages : [req.body.existingImages];
                mergedImages = existingImages.filter(Boolean);
            }
            const newImagePaths = req.files && req.files.length > 0 ? req.files.map(f => '/uploads/images/' + f.filename) : [];
            schedule.images = [...mergedImages, ...newImagePaths];
            schedule.videoId = undefined;
            schedule.videoPath = '';
            schedule.videoTitle = '';
            schedule.videoSize = '';
            schedule.shopeeLinks = ownedShopeeLinkIds;
        }

        if (nextType === 'reels' && req.file) {
            schedule.videoPath = '/uploads/reels/' + req.file.filename;
        }

        // Nếu trước đó là failed và user đã edit xong → reset về pending
        // để scheduler chạy lại lịch này.
        if (wasFailed) {
            schedule.status = 'pending';
            // Xóa log lỗi cũ nếu có
            schedule.lastError = '';
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