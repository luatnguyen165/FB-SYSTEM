#!/usr/bin/env node
// migrate-mongo-to-sqlite.js — Migrate all data from MongoDB to SQLite
// Usage: node scripts/migrate-mongo-to-sqlite.js

require('dotenv').config();
const mongoose = require('mongoose');
const { connectSQLite, createModel } = require('../db-sqlite.js');

// ---------------------------------------------------------------------------
// MongoDB connection
// ---------------------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('[Migration] MONGODB_URI not set in .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// All 30 Mongoose model definitions (lightweight, no validation)
// ---------------------------------------------------------------------------

const userSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const User = mongoose.model('User', userSchema);

const channelSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const Channel = mongoose.model('Channel', channelSchema);

const schedulePostSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const SchedulePost = mongoose.model('SchedulePost', schedulePostSchema);

const settingsSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const Settings = mongoose.model('Settings', settingsSchema);

const aiCommentSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const AiComment = mongoose.model('AiComment', aiCommentSchema);

const aiScanConfigSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const AiScanConfig = mongoose.model('AiScanConfig', aiScanConfigSchema);

const aiScanResultSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const AiScanResult = mongoose.model('AiScanResult', aiScanResultSchema);

const aiImageSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const AiImage = mongoose.model('AiImage', aiImageSchema);

const commentPlaySchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const CommentPlay = mongoose.model('CommentPlay', commentPlaySchema);

const commentPlayLogSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const CommentPlayLog = mongoose.model('CommentPlayLog', commentPlayLogSchema);

const commentScrapeSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const CommentScrape = mongoose.model('CommentScrape', commentScrapeSchema);

const facebookGroupCacheSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const FacebookGroupCache = mongoose.model('FacebookGroupCache', facebookGroupCacheSchema);

const featureVisibilitySchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const FeatureVisibility = mongoose.model('FeatureVisibility', featureVisibilitySchema);

const feedbackSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const Feedback = mongoose.model('Feedback', feedbackSchema);

const licenseKeySchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const LicenseKey = mongoose.model('LicenseKey', licenseKeySchema);

const musicTrendingSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const MusicTrending = mongoose.model('MusicTrending', musicTrendingSchema);

const shopeeLinkSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const ShopeeLink = mongoose.model('ShopeeLink', shopeeLinkSchema);

const trackingSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const Tracking = mongoose.model('Tracking', trackingSchema);

const trackingPostSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const TrackingPost = mongoose.model('TrackingPost', trackingPostSchema);

const videoSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const Video = mongoose.model('Video', videoSchema);

const videoBugSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const VideoBug = mongoose.model('VideoBug', videoBugSchema);

const writingStyleSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const WritingStyle = mongoose.model('WritingStyle', writingStyleSchema);

const contentTrainingLogSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const ContentTrainingLog = mongoose.model('ContentTrainingLog', contentTrainingLogSchema);

const productSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const Product = mongoose.model('Product', productSchema);

const aiGeneratedPostSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const AiGeneratedPost = mongoose.model('AiGeneratedPost', aiGeneratedPostSchema);

const autoContentPipelineSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const AutoContentPipeline = mongoose.model('AutoContentPipeline', autoContentPipelineSchema);

const douyinTrackingSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const DouyinTracking = mongoose.model('DouyinTracking', douyinTrackingSchema);

const douyinVideoSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const DouyinVideo = mongoose.model('DouyinVideo', douyinVideoSchema);

const tiktokTrackingSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const TikTokTracking = mongoose.model('TikTokTracking', tiktokTrackingSchema);

const tiktokVideoSchema = new mongoose.Schema({}, { strict: false, versionKey: false });
const TikTokVideo = mongoose.model('TikTokVideo', tiktokVideoSchema);

// ---------------------------------------------------------------------------
// Migration config: name → { mongoModel, sqliteModel }
// ---------------------------------------------------------------------------

const MODELS = [
  { name: 'User', mongo: User, sqliteKey: 'User' },
  { name: 'Channel', mongo: Channel, sqliteKey: 'Channel' },
  { name: 'SchedulePost', mongo: SchedulePost, sqliteKey: 'SchedulePost' },
  { name: 'Settings', mongo: Settings, sqliteKey: 'Settings' },
  { name: 'AiComment', mongo: AiComment, sqliteKey: 'AiComment' },
  { name: 'AiScanConfig', mongo: AiScanConfig, sqliteKey: 'AiScanConfig' },
  { name: 'AiScanResult', mongo: AiScanResult, sqliteKey: 'AiScanResult' },
  { name: 'AiImage', mongo: AiImage, sqliteKey: 'AiImage' },
  { name: 'CommentPlay', mongo: CommentPlay, sqliteKey: 'CommentPlay' },
  { name: 'CommentPlayLog', mongo: CommentPlayLog, sqliteKey: 'CommentPlayLog' },
  { name: 'CommentScrape', mongo: CommentScrape, sqliteKey: 'CommentScrape' },
  { name: 'FacebookGroupCache', mongo: FacebookGroupCache, sqliteKey: 'FacebookGroupCache' },
  { name: 'FeatureVisibility', mongo: FeatureVisibility, sqliteKey: 'FeatureVisibility' },
  { name: 'Feedback', mongo: Feedback, sqliteKey: 'Feedback' },
  { name: 'LicenseKey', mongo: LicenseKey, sqliteKey: 'LicenseKey' },
  { name: 'MusicTrending', mongo: MusicTrending, sqliteKey: 'MusicTrending' },
  { name: 'ShopeeLink', mongo: ShopeeLink, sqliteKey: 'ShopeeLink' },
  { name: 'Tracking', mongo: Tracking, sqliteKey: 'Tracking' },
  { name: 'TrackingPost', mongo: TrackingPost, sqliteKey: 'TrackingPost' },
  { name: 'Video', mongo: Video, sqliteKey: 'Video' },
  { name: 'VideoBug', mongo: VideoBug, sqliteKey: 'VideoBug' },
  { name: 'WritingStyle', mongo: WritingStyle, sqliteKey: 'WritingStyle' },
  { name: 'ContentTrainingLog', mongo: ContentTrainingLog, sqliteKey: 'ContentTrainingLog' },
  { name: 'Product', mongo: Product, sqliteKey: 'Product' },
  { name: 'AiGeneratedPost', mongo: AiGeneratedPost, sqliteKey: 'AiGeneratedPost' },
  { name: 'AutoContentPipeline', mongo: AutoContentPipeline, sqliteKey: 'AutoContentPipeline' },
  { name: 'DouyinTracking', mongo: DouyinTracking, sqliteKey: 'DouyinTracking' },
  { name: 'DouyinVideo', mongo: DouyinVideo, sqliteKey: 'DouyinVideo' },
  { name: 'TikTokTracking', mongo: TikTokTracking, sqliteKey: 'TikTokTracking' },
  { name: 'TikTokVideo', mongo: TikTokVideo, sqliteKey: 'TikTokVideo' },
];

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Convert a single MongoDB document to a flat SQLite-friendly object. */
function convertDoc(doc) {
  const plain = doc.toObject ? doc.toObject() : { ...doc };
  const result = {};

  for (const [key, value] of Object.entries(plain)) {
    // Skip Mongoose internal fields
    if (key === '__v') continue;

    const converted = convertValue(value);
    if (converted !== undefined) {
      result[key] = converted;
    }
  }

  return result;
}

/** Convert a MongoDB value to SQLite-compatible value. */
function convertValue(value) {
  if (value === undefined || value === null) return null;

  // ObjectId → string
  if (value && value._bsontype === 'ObjectId') {
    return value.toHexString();
  }

  // Date → ISO string
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Boolean → 0/1
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  // Mongoose ObjectId instance check
  if (value && typeof value.toHexString === 'function') {
    return value.toHexString();
  }

  // Array → JSON string
  if (Array.isArray(value)) {
    return JSON.stringify(value.map(v => {
      if (v && v._bsontype === 'ObjectId') return v.toHexString();
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'object' && v !== null) return convertObjectValues(v);
      return v;
    }));
  }

  // Object (nested subdocument) → JSON string
  if (typeof value === 'object' && value !== null) {
    // Check for special Mongoose types
    if (value._bsontype) {
      return value.toString();
    }
    return JSON.stringify(convertObjectValues(value));
  }

  return value;
}

/** Recursively convert nested object values. */
function convertObjectValues(obj) {
  if (obj === null || obj === undefined) return null;
  if (obj instanceof Date) return obj.toISOString();
  if (typeof obj === 'boolean') return obj ? 1 : 0;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(v => convertValue(v));
  }

  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = convertValue(v);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Migration logic
// ---------------------------------------------------------------------------

async function migrateModel(mongoModel, sqliteModel, name) {
  const startTime = Date.now();

  // Count MongoDB docs
  const mongoCount = await mongoModel.countDocuments();
  if (mongoCount === 0) {
    console.log(`[Migration] ${name}: MongoDB empty, skipping`);
    return { name, count: 0, skipped: true };
  }

  // Check if SQLite already has data (idempotent)
  const existingCount = sqliteModel.countDocuments();
  if (existingCount > 0) {
    console.log(`[Migration] ${name}: SQLite already has ${existingCount} rows, skipping`);
    return { name, count: existingCount, skipped: true };
  }

  // Read all documents from MongoDB in batches
  const BATCH_SIZE = 500;
  let totalInserted = 0;
  let offset = 0;

  while (offset < mongoCount) {
    const batch = await mongoModel.find().skip(offset).limit(BATCH_SIZE);
    const convertedBatch = batch.map(doc => convertDoc(doc));

    // Insert batch into SQLite
    for (const doc of convertedBatch) {
      try {
        sqliteModel._insertOne(doc);
        totalInserted++;
      } catch (err) {
        // Handle duplicate _id gracefully
        if (err.message && err.message.includes('UNIQUE constraint')) {
          console.log(`[Migration] ${name}: Duplicate key, skipping one doc`);
        } else {
          throw err;
        }
      }
    }

    offset += BATCH_SIZE;
    process.stdout.write(`[Migration] ${name}: ${totalInserted}/${mongoCount} docs...\r`);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Migration] ${name}: ${totalInserted} docs migrated in ${elapsed}ms`);
  return { name, count: totalInserted, skipped: false, elapsed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(60));
  console.log('[Migration] MongoDB → SQLite');
  console.log('='.repeat(60));

  const globalStart = Date.now();

  // 1. Connect to MongoDB
  console.log(`[Migration] Connecting to MongoDB...`);
  await mongoose.connect(MONGODB_URI);
  console.log(`[Migration] MongoDB connected`);

  // 2. Connect to SQLite (this also creates all tables via sqlite-models.js)
  console.log(`[Migration] Connecting to SQLite...`);
  const sqliteModels = require('./sqlite-models.js');
  console.log(`[Migration] SQLite connected, tables created`);

  // 3. Migrate each model
  const results = [];
  for (const config of MODELS) {
    const sqliteModel = sqliteModels[config.sqliteKey];
    if (!sqliteModel) {
      console.error(`[Migration] ERROR: SQLite model '${config.sqliteKey}' not found!`);
      continue;
    }

    try {
      const result = await migrateModel(config.mongo, sqliteModel, config.name);
      results.push(result);
    } catch (err) {
      console.error(`[Migration] ERROR migrating ${config.name}:`, err.message);
      results.push({ name: config.name, error: err.message });
    }
  }

  // 4. Summary
  const globalElapsed = Date.now() - globalStart;
  console.log('\n' + '='.repeat(60));
  console.log('[Migration] Summary:');
  console.log('='.repeat(60));

  let totalDocs = 0;
  for (const r of results) {
    const status = r.error ? `ERROR: ${r.error}` : r.skipped ? 'skipped' : `${r.count} docs`;
    console.log(`  ${r.name.padEnd(25)} ${status}`);
    if (!r.skipped && !r.error) totalDocs += r.count;
  }

  console.log('='.repeat(60));
  console.log(`[Migration] Total: ${totalDocs} documents in ${globalElapsed}ms`);
  console.log(`[Migration] Done!`);

  // 5. Disconnect
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('[Migration] Fatal error:', err);
  mongoose.disconnect().catch(() => {});
  process.exit(1);
});
