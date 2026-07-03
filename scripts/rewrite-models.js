// Batch rewrite all models/*.js to use SQLite
const fs = require('fs');
const path = require('path');

const modelsDir = path.join(__dirname, '..', 'models');

const modelFiles = {
    'AiComment.js': 'AiComment',
    'AiGeneratedPost.js': 'AiGeneratedPost',
    'AiImage.js': 'AiImage',
    'AiScanConfig.js': 'AiScanConfig',
    'AiScanResult.js': 'AiScanResult',
    'AutoContentPipeline.js': 'AutoContentPipeline',
    'Channel.js': 'Channel',
    'CommentPlay.js': 'CommentPlay',
    'CommentPlayLog.js': 'CommentPlayLog',
    'CommentScrape.js': 'CommentScrape',
    'ContentTrainingLog.js': 'ContentTrainingLog',
    'DouyinTracking.js': 'DouyinTracking',
    'DouyinVideo.js': 'DouyinVideo',
    'FacebookGroupCache.js': 'FacebookGroupCache',
    'FeatureVisibility.js': 'FeatureVisibility',
    'Feedback.js': 'Feedback',
    'LicenseKey.js': 'LicenseKey',
    'MusicTrending.js': 'MusicTrending',
    'Product.js': 'Product',
    'SchedulePost.js': 'SchedulePost',
    'Settings.js': 'Settings',
    'ShopeeLink.js': 'ShopeeLink',
    'TikTokTracking.js': 'TikTokTracking',
    'TikTokVideo.js': 'TikTokVideo',
    'Tracking.js': 'Tracking',
    'TrackingPost.js': 'TrackingPost',
    'Video.js': 'Video',
    'VideoBug.js': 'VideoBug',
    'WritingStyle.js': 'WritingStyle',
};

for (const [fileName, modelName] of Object.entries(modelFiles)) {
    const filePath = path.join(modelsDir, fileName);

    // Skip User.js and Channel.js — already rewritten
    if (fileName === 'User.js') continue;

    const content = `// models/${fileName} — SQLite adapter
const { getModel } = require('../scripts/sqlite-models');

module.exports = getModel('${modelName}');
`;

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Rewrote ${fileName}`);
}

// Special: LicenseKey with pre-save hook
const licenseKeyContent = `// models/LicenseKey.js — SQLite adapter (with pre-save hook)
const { getModel, generateObjectId } = require('../scripts/sqlite-models');

const LicenseKey = getModel('LicenseKey');

// Pre-save hook: auto-set expiresAt to 1 year from now
const originalSave = LicenseKey.save;
LicenseKey.save = function(doc) {
    if (!doc.expiresAt) {
        const oneYear = new Date();
        oneYear.setFullYear(oneYear.getFullYear() + 1);
        doc.expiresAt = oneYear.toISOString();
    }
    return originalSave ? originalSave.call(this, doc) : doc;
};

module.exports = LicenseKey;
`;
fs.writeFileSync(path.join(modelsDir, 'LicenseKey.js'), licenseKeyContent, 'utf8');
console.log('Rewrote LicenseKey.js (with hook)');

// Special: Channel.js with useful helpers
const channelContent = `// models/Channel.js — SQLite adapter
const { getModel } = require('../scripts/sqlite-models');

const Channel = getModel('Channel');

module.exports = Channel;
`;
fs.writeFileSync(path.join(modelsDir, 'Channel.js'), channelContent, 'utf8');
console.log('Rewrote Channel.js');

console.log('Done! All model files rewritten for SQLite.');
