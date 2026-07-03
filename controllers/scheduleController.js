// controllers/scheduleController.js
// Re-exports from sub-modules for backward compatibility
const { showSchedulePost, showScheduleManager, showScheduleReels, createSchedule, updateSchedule, getSchedulesAPI, getScheduleByIdAPI, deleteSchedule, getScheduleByDateAPI } = require('./schedule/crud');
const { showPublishedArchive, exportPublishedArchive } = require('./schedule/archive');
const { showScheduleGroups, scanFacebookGroupsAPI, scrapeGroupMembersAPI, scrapeGroupsFromJoinsAPI, getGroupsAPI, clearAllGroupsAPI, deleteSelectedGroupsAPI } = require('./schedule/groups');
const { uploadInstantReels, uploadLocalReelsVideo, getReelsRunnerStatusAPI, runReelsRunnerNowAPI, runReelsScheduleByIdNowAPI, runScheduleByIdNowAPI } = require('./schedule/reels');

module.exports = {
    showSchedulePost,
    showScheduleReels,
    showScheduleManager,
    showPublishedArchive,
    exportPublishedArchive,
    uploadInstantReels,
    uploadLocalReelsVideo,
    createSchedule,
    updateSchedule,
    getSchedulesAPI,
    getScheduleByIdAPI,
    getScheduleByDateAPI,
    getReelsRunnerStatusAPI,
    runReelsRunnerNowAPI,
    runReelsScheduleByIdNowAPI,
    runScheduleByIdNowAPI,
    deleteSchedule,
    showScheduleGroups,
    scanFacebookGroupsAPI,
    scrapeGroupMembersAPI,
    scrapeGroupsFromJoinsAPI,
    getGroupsAPI,
    clearAllGroupsAPI,
    deleteSelectedGroupsAPI
};