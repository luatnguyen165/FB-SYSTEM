// controllers/dashboardController.js
const Video = require('../models/Video');
const Channel = require('../models/Channel');
const SchedulePost = require('../models/SchedulePost');
const ShopeeLink = require('../models/ShopeeLink');

const showDashboard = async (req, res) => {
    try {
        const userId = req.user._id;
        const [
            totalVideos,
            totalChannels,
            totalScheduled,
            totalPosted,
            totalFailed,
            totalPendingSchedules,
            totalShopeeLinks,
            recentVideos,
            recentSchedules,
            recentChannels,
            recentLinks,
            upcomingSchedules,
            scheduledByPlatform,
            schedulesByType,
            latestPostedSchedules
        ] = await Promise.all([
            Video.countDocuments({ userId }),
            Channel.countDocuments({ userId }),
            SchedulePost.countDocuments({ userId, status: 'pending' }),
            SchedulePost.countDocuments({ userId, status: 'posted' }),
            SchedulePost.countDocuments({ userId, status: 'failed' }),
            SchedulePost.countDocuments({ userId, status: 'pending' }),
            ShopeeLink.countDocuments({ userId }),
            Video.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
            SchedulePost.find({ userId }).sort({ createdAt: -1 }).limit(8).populate('videoId', 'title filePath thumbnailUrl').populate('shopeeLinks', 'title imageUrl shopeeUrl').lean(),
            Channel.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
            ShopeeLink.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
            SchedulePost.find({ userId, scheduledAt: { $gte: new Date() } }).sort({ scheduledAt: 1 }).limit(8).populate('videoId', 'title filePath thumbnailUrl').lean(),
            SchedulePost.aggregate([
                { $match: { userId } },
                { $unwind: { path: '$platforms', preserveNullAndEmptyArrays: true } },
                { $group: { _id: '$platforms', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            SchedulePost.aggregate([
                { $match: { userId } },
                { $group: { _id: '$type', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            SchedulePost.find({ userId, status: 'posted' }).sort({ scheduledAt: -1 }).limit(8).populate('videoId', 'title filePath thumbnailUrl').lean()
        ]);

        const channelPlatforms = ['FB', 'IG', 'TT', 'YT'];
        const channelDistribution = channelPlatforms.map(platform => ({
            platform,
            count: recentChannels.filter(c => c.platform === platform).length
        }));

        const pendingToPostRatio = totalPosted + totalPendingSchedules > 0
            ? Math.round((totalPosted / (totalPosted + totalPendingSchedules)) * 100)
            : 0;

        const activityFeed = [
            ...recentSchedules.map(item => ({
                type: 'schedule',
                title: item.caption || `${item.type === 'reels' ? 'Reels' : 'Post'} đã lên lịch`,
                subtitle: `${item.type.toUpperCase()} • ${new Date(item.scheduledAt).toLocaleString('vi-VN')}`,
                status: item.status,
                createdAt: item.createdAt,
                date: item.scheduledAt,
                data: item
            })),
            ...recentVideos.map(item => ({
                type: 'video',
                title: item.title,
                subtitle: `Upload video • ${new Date(item.createdAt).toLocaleString('vi-VN')}`,
                status: item.status,
                createdAt: item.createdAt,
                date: item.createdAt,
                data: item
            })),
            ...recentLinks.map(item => ({
                type: 'link',
                title: item.title,
                subtitle: `Shopee link • ${new Date(item.createdAt).toLocaleString('vi-VN')}`,
                status: item.status,
                createdAt: item.createdAt,
                date: item.createdAt,
                data: item
            }))
        ]
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 8);

        res.render('dashboard', {
            user: req.user,
            stats: {
                totalVideos,
                totalChannels,
                totalScheduled,
                totalPosted,
                totalFailed,
                totalPendingSchedules,
                totalShopeeLinks,
                pendingToPostRatio
            },
            dashboards: {
                recentVideos,
                recentSchedules,
                recentChannels,
                recentLinks,
                upcomingSchedules,
                channelDistribution,
                scheduledByPlatform,
                schedulesByType,
                latestPostedSchedules,
                activityFeed
            }
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.render('dashboard', {
            user: req.user,
            stats: {
                totalVideos: 0,
                totalChannels: 0,
                totalScheduled: 0,
                totalPosted: 0,
                totalFailed: 0,
                totalPendingSchedules: 0,
                totalShopeeLinks: 0,
                pendingToPostRatio: 0
            },
            dashboards: {
                recentVideos: [],
                recentSchedules: [],
                recentChannels: [],
                recentLinks: [],
                upcomingSchedules: [],
                channelDistribution: [],
                scheduledByPlatform: [],
                schedulesByType: [],
                latestPostedSchedules: [],
                activityFeed: []
            }
        });
    }
};

module.exports = { showDashboard };
