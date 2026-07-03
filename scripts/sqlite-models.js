// sqlite-models.js — Define all 30 SQLite model schemas
const { connectSQLite, createModel } = require('../db-sqlite.js');

connectSQLite();

const models = {};

// 1. User
models.User = createModel({
  tableName: 'users',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    username: { type: 'TEXT' },
    email: { type: 'TEXT', unique: true },
    phoneNumber: { type: 'TEXT' },
    avatarUrl: { type: 'TEXT' },
    password: { type: 'TEXT' },
    role: { type: 'TEXT', default: 'user' },
    devices: { type: 'TEXT', default: '[]' },
    resetPasswordToken: { type: 'TEXT' },
    resetPasswordExpires: { type: 'TEXT' },
    language: { type: 'TEXT', default: 'vi' },
    telegramChatId: { type: 'TEXT', unique: true },
    telegramLinked: { type: 'INTEGER', default: 0 },
    telegramLinkToken: { type: 'TEXT' },
    telegramUsername: { type: 'TEXT' },
    telegramLinkedAt: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
  },
  indexes: [{ columns: ['telegramChatId'], unique: true }],
});

// 2. Channel
models.Channel = createModel({
  tableName: 'channels',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    platform: { type: 'TEXT' },
    accountName: { type: 'TEXT' },
    accountType: { type: 'TEXT' },
    profileUrl: { type: 'TEXT' },
    avatarUrl: { type: 'TEXT' },
    followers: { type: 'TEXT' },
    apiStatus: { type: 'TEXT', default: 'active' },
    isEnabled: { type: 'INTEGER', default: 1 },
    accessToken: { type: 'TEXT' },
    storageStatePath: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
  },
  indexes: [
    { columns: ['userId', 'platform', 'accountName', 'accountType'] },
    { columns: ['userId'] },
  ],
});

// 3. SchedulePost
models.SchedulePost = createModel({
  tableName: 'schedule_posts',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    type: { type: 'TEXT', default: 'post' },
    caption: { type: 'TEXT' },
    postTitle: { type: 'TEXT' },
    images: { type: 'TEXT', default: '[]' },
    videoId: { type: 'TEXT' },
    videoPath: { type: 'TEXT' },
    videoTitle: { type: 'TEXT' },
    videoSize: { type: 'TEXT' },
    shopeeLinks: { type: 'TEXT', default: '[]' },
    targetGroupSourceChannelId: { type: 'TEXT' },
    postTargetType: { type: 'TEXT', default: 'group' },
    targetGroupIds: { type: 'TEXT', default: '[]' },
    targetGroupNames: { type: 'TEXT', default: '[]' },
    targetGroupId: { type: 'TEXT' },
    targetGroupName: { type: 'TEXT' },
    targetGroupUrl: { type: 'TEXT' },
    publishedUrl: { type: 'TEXT' },
    scheduledAt: { type: 'TEXT' },
    platforms: { type: 'TEXT', default: '[]' },
    accounts: { type: 'TEXT', default: '[]' },
    status: { type: 'TEXT', default: 'pending' },
    platformResults: { type: 'TEXT', default: '[]' },
    groupResults: { type: 'TEXT', default: '[]' },
    sourceTrackingPostId: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
  },
  indexes: [
    { columns: ['sourceTrackingPostId'] },
    { columns: ['userId'] },
    { columns: ['status'] },
  ],
});

// 4. Settings
models.Settings = createModel({
  tableName: 'settings',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT', unique: true },
    autoFlip: { type: 'INTEGER', default: 0 },
    autoMd5Change: { type: 'INTEGER', default: 0 },
    watermarkPosition: { type: 'TEXT' },
    watermarkUrl: { type: 'TEXT' },
    postInterval: { type: 'INTEGER', default: 30 },
    retryDelay: { type: 'INTEGER', default: 5 },
    maxPostsPerDay: { type: 'INTEGER', default: 10 },
    minIntervalBetweenPosts: { type: 'INTEGER', default: 30 },
    randomDelayEnabled: { type: 'INTEGER', default: 1 },
    randomDelayMin: { type: 'INTEGER', default: 5 },
    randomDelayMax: { type: 'INTEGER', default: 15 },
    quietHoursEnabled: { type: 'INTEGER', default: 0 },
    quietHoursStart: { type: 'TEXT' },
    quietHoursEnd: { type: 'TEXT' },
    telegramBotToken: { type: 'TEXT' },
    telegramChatId: { type: 'TEXT' },
    driveClientId: { type: 'TEXT' },
    driveApiKey: { type: 'TEXT' },
    driveFolderId: { type: 'TEXT' },
    driveConnected: { type: 'INTEGER', default: 0 },
    aiProvider: { type: 'TEXT' },
    openaiApiKey: { type: 'TEXT' },
    openaiModel: { type: 'TEXT' },
    openaiCompatibleApiKey: { type: 'TEXT' },
    openaiCompatibleBaseUrl: { type: 'TEXT' },
    openaiCompatibleModel: { type: 'TEXT' },
    anthropicApiKey: { type: 'TEXT' },
    anthropicModel: { type: 'TEXT' },
    dataEncryptionEnabled: { type: 'INTEGER', default: 0 },
    updatedAt: { type: 'TEXT' },
  },
});

// 5. AiComment
models.AiComment = createModel({
  tableName: 'ai_comments',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    name: { type: 'TEXT' },
    type: { type: 'TEXT' },
    content: { type: 'TEXT' },
    caption: { type: 'TEXT' },
    isActive: { type: 'INTEGER', default: 1 },
    tags: { type: 'TEXT', default: '[]' },
    order: { type: 'INTEGER', default: 0 },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
  indexes: [
    { columns: ['userId', 'isActive'] },
    { columns: ['userId'] },
  ],
});

// 6. AiScanConfig
models.AiScanConfig = createModel({
  tableName: 'ai_scan_configs',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    name: { type: 'TEXT' },
    channelId: { type: 'TEXT' },
    groupKeys: { type: 'TEXT', default: '[]' },
    scanScript: { type: 'TEXT' },
    scheduleEnabled: { type: 'INTEGER', default: 0 },
    scheduleHour: { type: 'INTEGER' },
    scheduleMinute: { type: 'INTEGER' },
    scheduleTimeStart: { type: 'TEXT', default: '06:00' },
    scheduleTimeEnd: { type: 'TEXT', default: '23:00' },
    maxDaysOld: { type: 'INTEGER', default: 3 },
    openaiApiKey: { type: 'TEXT' },
    scanIntervalMinutes: { type: 'INTEGER', default: 60 },
    maxPostsPerScan: { type: 'INTEGER', default: 20 },
    nextScanAt: { type: 'TEXT' },
    model: { type: 'TEXT' },
    aiProvider: { type: 'TEXT', default: 'openai' },
    openaiCompatibleApiKey: { type: 'TEXT' },
    openaiCompatibleBaseUrl: { type: 'TEXT' },
    openaiCompatibleModel: { type: 'TEXT' },
    anthropicApiKey: { type: 'TEXT' },
    anthropicModel: { type: 'TEXT' },
    useAiDetection: { type: 'INTEGER', default: 0 },
    keywordFilter: { type: 'TEXT', default: '[]' },
    minAiScore: { type: 'INTEGER', default: 50 },
    keepNonMatching: { type: 'INTEGER', default: 1 },
    commentItems: { type: 'TEXT', default: '[]' },
    isActive: { type: 'INTEGER', default: 1 },
    lastScanAt: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
  indexes: [{ columns: ['userId', 'isActive'] }],
});

// 7. AiScanResult
models.AiScanResult = createModel({
  tableName: 'ai_scan_results',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    configId: { type: 'TEXT' },
    channelId: { type: 'TEXT' },
    groupId: { type: 'TEXT' },
    groupName: { type: 'TEXT' },
    groupUrl: { type: 'TEXT' },
    postId: { type: 'TEXT' },
    postUrl: { type: 'TEXT' },
    postContent: { type: 'TEXT' },
    postImages: { type: 'TEXT', default: '[]' },
    postVideos: { type: 'TEXT', default: '[]' },
    postAuthor: { type: 'TEXT' },
    postPublishedAt: { type: 'TEXT' },
    aiAnalyzed: { type: 'INTEGER', default: 0 },
    aiAnalysis: { type: 'TEXT' },
    aiScore: { type: 'INTEGER', default: 0 },
    isMatching: { type: 'INTEGER', default: 0 },
    matchReason: { type: 'TEXT' },
    comments: { type: 'TEXT', default: '[]' },
    commentSent: { type: 'INTEGER', default: 0 },
    commentContent: { type: 'TEXT' },
    commentImage: { type: 'TEXT' },
    commentError: { type: 'TEXT' },
    commentedAt: { type: 'TEXT' },
    scannedAt: { type: 'TEXT' },
  },
  indexes: [
    { columns: ['postId', 'configId'], unique: true },
    { columns: ['userId'] },
    { columns: ['configId'] },
  ],
});

// 8. AiImage
models.AiImage = createModel({
  tableName: 'ai_images',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    name: { type: 'TEXT', default: 'Project mới' },
    entries: { type: 'TEXT', default: '[]' },
    isFavorite: { type: 'INTEGER', default: 0 },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 9. CommentPlay
models.CommentPlay = createModel({
  tableName: 'comment_plays',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    name: { type: 'TEXT' },
    description: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'active' },
    schedule: { type: 'TEXT', default: '{}' },
    channelId: { type: 'TEXT' },
    selectedCommentIds: { type: 'TEXT', default: '[]' },
    postAllComments: { type: 'INTEGER', default: 0 },
    selectionMode: { type: 'TEXT', default: 'manual' },
    tagsFilter: { type: 'TEXT', default: '[]' },
    target: { type: 'TEXT', default: '{}' },
    metrics: { type: 'TEXT', default: '{}' },
    lastResetDate: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
  indexes: [{ columns: ['userId', 'status'] }],
});

// 10. CommentPlayLog
models.CommentPlayLog = createModel({
  tableName: 'comment_play_logs',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    playId: { type: 'TEXT' },
    commentId: { type: 'TEXT' },
    commentText: { type: 'TEXT' },
    commentType: { type: 'TEXT' },
    targetUrl: { type: 'TEXT' },
    targetGroupId: { type: 'TEXT' },
    status: { type: 'TEXT' },
    errorMessage: { type: 'TEXT' },
    postedAt: { type: 'TEXT' },
  },
  indexes: [{ columns: ['playId', 'postedAt'] }],
});

// 11. CommentScrape
models.CommentScrape = createModel({
  tableName: 'comment_scrapes',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    channelId: { type: 'TEXT' },
    accountName: { type: 'TEXT' },
    postUrl: { type: 'TEXT' },
    postId: { type: 'TEXT' },
    postTitle: { type: 'TEXT' },
    status: { type: 'TEXT' },
    errorMessage: { type: 'TEXT' },
    progress: { type: 'INTEGER', default: 0 },
    stats: { type: 'TEXT', default: '{}' },
    options: { type: 'TEXT', default: '{}' },
    comments: { type: 'TEXT', default: '[]' },
    tree: { type: 'TEXT' },
    scrapedAt: { type: 'TEXT' },
  },
  indexes: [
    { columns: ['userId', 'scrapedAt'] },
    { columns: ['userId', 'status'] },
    { columns: ['userId', 'postUrl'] },
  ],
});

// 12. FacebookGroupCache
models.FacebookGroupCache = createModel({
  tableName: 'facebook_group_caches',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    channelId: { type: 'TEXT' },
    accountName: { type: 'TEXT' },
    accountType: { type: 'TEXT' },
    groups: { type: 'TEXT', default: '[]' },
    updatedAt: { type: 'TEXT' },
    scanStatus: { type: 'TEXT', default: 'idle' },
    scanStartedAt: { type: 'TEXT' },
    scanFinishedAt: { type: 'TEXT' },
    scanError: { type: 'TEXT' },
    scannedGroupsCount: { type: 'INTEGER', default: 0 },
  },
  indexes: [{ columns: ['userId', 'channelId'], unique: true }],
});

// 13. FeatureVisibility
models.FeatureVisibility = createModel({
  tableName: 'feature_visibilities',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    channels: { type: 'INTEGER', default: 1 },
    dashboard: { type: 'INTEGER', default: 1 },
    storage: { type: 'INTEGER', default: 1 },
    'schedule-manager': { type: 'INTEGER', default: 1 },
    'schedule-post': { type: 'INTEGER', default: 1 },
    'schedule-reels': { type: 'INTEGER', default: 1 },
    'schedule-archive': { type: 'INTEGER', default: 1 },
    'schedule-groups': { type: 'INTEGER', default: 1 },
    'ai-scan': { type: 'INTEGER', default: 1 },
    'ai-comments': { type: 'INTEGER', default: 1 },
    'comment-crawler': { type: 'INTEGER', default: 1 },
    'comment-play': { type: 'INTEGER', default: 1 },
    shopeeLink: { type: 'INTEGER', default: 1 },
    profile: { type: 'INTEGER', default: 1 },
    settings: { type: 'INTEGER', default: 1 },
    'ai-content': { type: 'INTEGER', default: 1 },
    feedback: { type: 'INTEGER', default: 1 },
    'ai-reply-messenger': { type: 'INTEGER', default: 1 },
    tracking: { type: 'INTEGER', default: 1 },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 14. Feedback
models.Feedback = createModel({
  tableName: 'feedbacks',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    feature: { type: 'TEXT' },
    type: { type: 'TEXT' },
    title: { type: 'TEXT' },
    description: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'open' },
    priority: { type: 'TEXT', default: 'medium' },
    attachments: { type: 'TEXT', default: '[]' },
    adminNote: { type: 'TEXT' },
    messages: { type: 'TEXT', default: '[]' },
    resolvedAt: { type: 'TEXT' },
    closedAt: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 15. LicenseKey
models.LicenseKey = createModel({
  tableName: 'license_keys',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    key: { type: 'TEXT', unique: true },
    productType: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'unused' },
    isUsed: { type: 'INTEGER', default: 0 },
    assignedTo: { type: 'TEXT', default: '{}' },
    maxDevices: { type: 'INTEGER', default: 1 },
    maxAccounts: { type: 'INTEGER', default: 1 },
    features: { type: 'TEXT', default: '[]' },
    activatedAt: { type: 'TEXT' },
    expiresAt: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    createdBy: { type: 'TEXT' },
  },
});

// 16. MusicTrending
models.MusicTrending = createModel({
  tableName: 'music_trendings',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    platform: { type: 'TEXT' },
    url: { type: 'TEXT' },
    title: { type: 'TEXT' },
    artist: { type: 'TEXT' },
    duration: { type: 'INTEGER' },
    thumbnail: { type: 'TEXT' },
    source: { type: 'TEXT' },
    filepath: { type: 'TEXT' },
    accountName: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 17. ShopeeLink
models.ShopeeLink = createModel({
  tableName: 'shopee_links',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    title: { type: 'TEXT' },
    shopeeUrl: { type: 'TEXT' },
    imageUrl: { type: 'TEXT' },
    platform: { type: 'TEXT', default: 'shopee' },
    createdAt: { type: 'TEXT' },
  },
});

// 18. Tracking
models.Tracking = createModel({
  tableName: 'trackings',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    name: { type: 'TEXT' },
    url: { type: 'TEXT' },
    type: { type: 'TEXT' },
    sourcePlatform: { type: 'TEXT' },
    sourceAccountId: { type: 'TEXT' },
    targetPlatforms: { type: 'TEXT', default: '[]' },
    cookiesPath: { type: 'TEXT' },
    isActive: { type: 'INTEGER', default: 1 },
    repostPaused: { type: 'INTEGER', default: 0 },
    scrapeSettings: { type: 'TEXT', default: '{}' },
    schedule: { type: 'TEXT', default: '{}' },
    stats: { type: 'TEXT', default: '{}' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
  indexes: [
    { columns: ['userId', 'isActive'] },
    { columns: ['userId', 'type'] },
  ],
});

// 19. TrackingPost
models.TrackingPost = createModel({
  tableName: 'tracking_posts',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    trackingId: { type: 'TEXT' },
    postId: { type: 'TEXT' },
    text: { type: 'TEXT' },
    permalink: { type: 'TEXT' },
    commentCount: { type: 'INTEGER', default: 0 },
    images: { type: 'TEXT', default: '[]' },
    videos: { type: 'TEXT', default: '[]' },
    authorName: { type: 'TEXT' },
    publishedAt: { type: 'TEXT' },
    publishedAtText: { type: 'TEXT' },
    scrapedAt: { type: 'TEXT' },
    repostResults: { type: 'TEXT', default: '[]' },
    repostEnqueuedAt: { type: 'TEXT' },
  },
  indexes: [
    { columns: ['trackingId', 'postId'], unique: true },
    { columns: ['userId', 'scrapedAt'] },
  ],
});

// 20. Video
models.Video = createModel({
  tableName: 'videos',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    title: { type: 'TEXT' },
    originalName: { type: 'TEXT' },
    filename: { type: 'TEXT' },
    filePath: { type: 'TEXT' },
    fileSize: { type: 'INTEGER' },
    thumbnailUrl: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'ready' },
    scheduleDate: { type: 'TEXT' },
    scheduleCaption: { type: 'TEXT' },
    scheduleAccounts: { type: 'TEXT', default: '[]' },
    createdAt: { type: 'TEXT' },
  },
});

// 21. VideoBug
models.VideoBug = createModel({
  tableName: 'video_bugs',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    videoPath: { type: 'TEXT' },
    originalName: { type: 'TEXT' },
    trackingId: { type: 'TEXT' },
    bugs: { type: 'TEXT', default: '[]' },
    status: { type: 'TEXT', default: 'pending' },
    fileSize: { type: 'INTEGER' },
    duration: { type: 'REAL' },
    md5Hash: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    verifiedAt: { type: 'TEXT' },
  },
  indexes: [{ columns: ['userId', 'trackingId'], unique: true }],
});

// 22. WritingStyle
models.WritingStyle = createModel({
  tableName: 'writing_styles',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    name: { type: 'TEXT' },
    sampleArticles: { type: 'TEXT', default: '[]' },
    styleAnalysis: { type: 'TEXT', default: '{}' },
    trainingVersion: { type: 'INTEGER', default: 0 },
    lastTrainedAt: { type: 'TEXT' },
    topics: { type: 'TEXT', default: '[]' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 23. ContentTrainingLog
models.ContentTrainingLog = createModel({
  tableName: 'content_training_logs',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    writingStyleId: { type: 'TEXT' },
    version: { type: 'INTEGER' },
    type: { type: 'TEXT' },
    topPosts: { type: 'TEXT', default: '[]' },
    analysis: { type: 'TEXT', default: '{}' },
    postsEvaluated: { type: 'INTEGER', default: 0 },
    avgScore: { type: 'REAL', default: 0 },
    topScore: { type: 'REAL', default: 0 },
    createdAt: { type: 'TEXT' },
  },
});

// 24. Product
models.Product = createModel({
  tableName: 'products',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    name: { type: 'TEXT' },
    description: { type: 'TEXT' },
    category: { type: 'TEXT' },
    price: { type: 'TEXT' },
    images: { type: 'TEXT', default: '[]' },
    targetAudience: { type: 'TEXT' },
    keySellingPoints: { type: 'TEXT', default: '[]' },
    competitorProducts: { type: 'TEXT' },
    direction: { type: 'TEXT' },
    aiAnalysis: { type: 'TEXT', default: '{}' },
    writingStyleId: { type: 'TEXT' },
    isActive: { type: 'INTEGER', default: 1 },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 25. AiGeneratedPost
models.AiGeneratedPost = createModel({
  tableName: 'ai_generated_posts',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    scheduleId: { type: 'TEXT' },
    title: { type: 'TEXT' },
    content: { type: 'TEXT' },
    images: { type: 'TEXT', default: '[]' },
    platforms: { type: 'TEXT', default: '[]' },
    accounts: { type: 'TEXT', default: '[]' },
    scheduledAt: { type: 'TEXT' },
    publishedAt: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'draft' },
    publishedUrls: { type: 'TEXT', default: '[]' },
    aiModel: { type: 'TEXT', default: 'gpt-4o-mini' },
    aiPrompt: { type: 'TEXT' },
    imagePrompt: { type: 'TEXT' },
    generationCost: { type: 'REAL', default: 0 },
    schedulePostId: { type: 'TEXT' },
    productId: { type: 'TEXT' },
    direction: { type: 'TEXT', default: 'unset' },
    pipelineId: { type: 'TEXT' },
    engagement: { type: 'TEXT', default: '{}' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 26. AutoContentPipeline
models.AutoContentPipeline = createModel({
  tableName: 'auto_content_pipelines',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    productId: { type: 'TEXT' },
    writingStyleId: { type: 'TEXT' },
    postsPerDay: { type: 'INTEGER', default: 1 },
    platforms: { type: 'TEXT', default: '[]' },
    accountIds: { type: 'TEXT', default: '[]' },
    groupIds: { type: 'TEXT', default: '[]' },
    timeSlots: { type: 'TEXT', default: '[]' },
    contentDirection: { type: 'TEXT' },
    contentConfig: { type: 'TEXT', default: '{}' },
    researchSources: { type: 'TEXT', default: '[]' },
    status: { type: 'TEXT', default: 'paused' },
    totalPosts: { type: 'INTEGER', default: 0 },
    totalEngagement: { type: 'INTEGER', default: 0 },
    lastRunAt: { type: 'TEXT' },
    nextRunAt: { type: 'TEXT' },
    lastError: { type: 'TEXT' },
    learningData: { type: 'TEXT', default: '{}' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 27. DouyinTracking
models.DouyinTracking = createModel({
  tableName: 'douyin_trackings',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    channelUrl: { type: 'TEXT' },
    channelName: { type: 'TEXT' },
    channelAvatar: { type: 'TEXT' },
    channelSecUid: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'active' },
    checkIntervalMinutes: { type: 'INTEGER', default: 60 },
    lastCheckedAt: { type: 'TEXT' },
    lastError: { type: 'TEXT' },
    cookiesPath: { type: 'TEXT' },
    cookiesExpiresAt: { type: 'TEXT' },
    telegramReview: { type: 'INTEGER', default: 0 },
    crossPostPlatforms: { type: 'TEXT', default: '[]' },
    crossPostAccounts: { type: 'TEXT', default: '[]' },
    totalDownloaded: { type: 'INTEGER', default: 0 },
    totalCrossPosted: { type: 'INTEGER', default: 0 },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
  indexes: [{ columns: ['userId', 'channelUrl'], unique: true }],
});

// 28. DouyinVideo
models.DouyinVideo = createModel({
  tableName: 'douyin_videos',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    trackingId: { type: 'TEXT' },
    douyinVideoId: { type: 'TEXT', unique: true },
    douyinUrl: { type: 'TEXT' },
    title: { type: 'TEXT' },
    description: { type: 'TEXT' },
    thumbnail: { type: 'TEXT' },
    duration: { type: 'INTEGER' },
    viewCount: { type: 'INTEGER', default: 0 },
    likeCount: { type: 'INTEGER', default: 0 },
    commentCount: { type: 'INTEGER', default: 0 },
    author: { type: 'TEXT' },
    authorAvatar: { type: 'TEXT' },
    downloadPath: { type: 'TEXT' },
    downloadSize: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'pending' },
    downloadError: { type: 'TEXT' },
    downloadMethod: { type: 'TEXT' },
    telegramReviewStatus: { type: 'TEXT' },
    telegramMsgId: { type: 'INTEGER' },
    crossPostResults: { type: 'TEXT', default: '[]' },
    publishedAt: { type: 'TEXT' },
    downloadedAt: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

// 29. TikTokTracking
models.TikTokTracking = createModel({
  tableName: 'tiktok_trackings',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    channelUrl: { type: 'TEXT' },
    channelName: { type: 'TEXT' },
    channelAvatar: { type: 'TEXT' },
    channelVideoCount: { type: 'INTEGER', default: 0 },
    status: { type: 'TEXT', default: 'active' },
    checkIntervalMinutes: { type: 'INTEGER', default: 60 },
    lastCheckedAt: { type: 'TEXT' },
    lastError: { type: 'TEXT' },
    cookiesPath: { type: 'TEXT' },
    cookiesExpiresAt: { type: 'TEXT' },
    telegramReview: { type: 'INTEGER', default: 0 },
    crossPostPlatforms: { type: 'TEXT', default: '[]' },
    crossPostAccounts: { type: 'TEXT', default: '[]' },
    totalDownloaded: { type: 'INTEGER', default: 0 },
    totalCrossPosted: { type: 'INTEGER', default: 0 },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
  indexes: [{ columns: ['userId', 'channelUrl'], unique: true }],
});

// 30. TikTokVideo
models.TikTokVideo = createModel({
  tableName: 'tiktok_videos',
  fields: {
    _id: { type: 'TEXT', primaryKey: true },
    userId: { type: 'TEXT' },
    trackingId: { type: 'TEXT' },
    tiktokVideoId: { type: 'TEXT', unique: true },
    tiktokUrl: { type: 'TEXT' },
    title: { type: 'TEXT' },
    description: { type: 'TEXT' },
    thumbnail: { type: 'TEXT' },
    duration: { type: 'INTEGER' },
    viewCount: { type: 'INTEGER', default: 0 },
    likeCount: { type: 'INTEGER', default: 0 },
    commentCount: { type: 'INTEGER', default: 0 },
    author: { type: 'TEXT' },
    authorAvatar: { type: 'TEXT' },
    downloadPath: { type: 'TEXT' },
    downloadSize: { type: 'TEXT' },
    status: { type: 'TEXT', default: 'pending' },
    downloadError: { type: 'TEXT' },
    downloadMethod: { type: 'TEXT' },
    telegramReviewStatus: { type: 'TEXT' },
    telegramMsgId: { type: 'INTEGER' },
    crossPostResults: { type: 'TEXT', default: '[]' },
    publishedAt: { type: 'TEXT' },
    downloadedAt: { type: 'TEXT' },
    createdAt: { type: 'TEXT' },
    updatedAt: { type: 'TEXT' },
  },
});

module.exports = models;
module.exports.getModel = (name) => models[name];
module.exports.generateObjectId = require('../db-sqlite').generateObjectId;
