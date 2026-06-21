#!/usr/bin/env node
// scripts/import-i18n-suggestions.js
// Đọc i18n-suggestions.json → merge vào locales/i18n.js
// Tự động:
//   - Convert namespace "views.dashboard" → "dashboard"
//   - Generate key từ text: "Tỷ lệ hoàn thành" → "dashboard.ty_le_hoan_thanh"
//   - Thêm vào vi với text gốc
//   - Tạo EN placeholder "[VI] Tỷ lệ hoàn thành" để dev nhận biết cần dịch
//   - KHÔNG ghi đè key đã tồn tại (chỉ thêm mới)
//
// Usage:
//   node scripts/import-i18n-suggestions.js              # Merge suggestions vào locales
//   node scripts/import-i18n-suggestions.js --dry-run   # Chỉ báo cáo, không ghi file
//   node scripts/import-i18n-suggestions.js --reset     # Reset en = "[VI] ..." cho missing

const fs = require('fs');
const path = require('path');

const SUGGESTIONS_FILE = path.join(__dirname, '..', 'i18n-suggestions.json');
const LOCALES_FILE = path.join(__dirname, '..', 'locales', 'i18n.js');

const dryRun = process.argv.includes('--dry-run');
const reset = process.argv.includes('--reset');

function loadSuggestions() {
    if (!fs.existsSync(SUGGESTIONS_FILE)) {
        console.error(`❌ Không tìm thấy ${SUGGESTIONS_FILE}. Chạy 'node scripts/scan-i18n-keys.js --write-suggestions' trước.`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf8'));
}

/**
 * Convert tiếng Việt → slug key hợp lệ (chỉ a-z0-9_)
 * VD: "Tỷ lệ hoàn thành" → "ty_le_hoan_thanh"
 *      "Đăng Reels / Video" → "dang_reels_video"
 */
function slugify(text) {
    return String(text)
        .normalize('NFD')                          // tách dấu
        .replace(/[̀-ͯ]/g, '')           // xóa dấu
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')              // gộp nhiều ký tự đặc biệt thành _
        .replace(/^_+|_+$/g, '')                   // bỏ _ ở đầu/cuối
        .substring(0, 50)                          // max 50 chars
        .replace(/^(\d)/, '_$1')                   // nếu bắt đầu bằng số → thêm _
        || 'text';
}

/**
 * Convert namespace "views.dashboard" → "dashboard" (bỏ prefix views.)
 */
function normalizeNamespace(ns) {
    return ns.replace(/^views\./, '').replace(/[\/\\]/g, '.');
}

/**
 * Sinh key ổn định từ text + namespace, đảm bảo unique trong namespace.
 */
function makeKey(namespace, viText, existingKeys) {
    const baseSlug = slugify(viText);
    let candidate = `${namespace}.${baseSlug}`;
    let suffix = 1;
    while (existingKeys.has(candidate)) {
        suffix++;
        candidate = `${namespace}.${baseSlug}_${suffix}`;
    }
    existingKeys.add(candidate);
    return candidate;
}

/**
 * Parse file locales/i18n.js hiện tại để lấy translations object.
 * Tránh eval: dùng require cache hoặc regex parse.
 */
function readExistingTranslations(filePath) {
    // Cách an toàn: require file → lấy translations
    // (file phải là CommonJS, không có side effect)
    try {
        const mod = require(filePath);
        return mod.translations || { vi: {}, en: {} };
    } catch (e) {
        console.error(`❌ Không thể require ${filePath}:`, e.message);
        process.exit(1);
    }
}

function main() {
    console.log('🔄 Importing i18n suggestions → locales/i18n.js\n');
    if (dryRun) console.log('   (DRY RUN — không ghi file)\n');

    const suggestions = loadSuggestions();
    const existing = readExistingTranslations(LOCALES_FILE);

    const stats = {
        added_vi: 0,
        added_en: 0,
        skipped_existing: 0,
        en_placeholders: 0
    };

    // Build existing keys index (set of "namespace.key")
    const existingKeys = new Set();
    for (const lang of Object.keys(existing)) {
        for (const key of Object.keys(existing[lang])) {
            existingKeys.add(key);
        }
    }

    // Build new translations (chỉ thêm mới, không overwrite)
    const newVi = { ...existing.vi };
    const newEn = { ...existing.en };

    for (const rawNamespace of Object.keys(suggestions)) {
        const namespace = normalizeNamespace(rawNamespace);
        const nsSuggestions = suggestions[rawNamespace];

        for (const viText of Object.keys(nsSuggestions)) {
            const text = nsSuggestions[viText];
            // Make a namespace-scoped key set
            const nsKeySet = new Set();
            for (const k of existingKeys) {
                if (k.startsWith(`${namespace}.`)) nsKeySet.add(k);
            }
            const fullKey = makeKey(namespace, text, nsKeySet);

            // === VI ===
            if (!newVi[fullKey]) {
                newVi[fullKey] = text;
                stats.added_vi++;
            } else {
                stats.skipped_existing++;
            }

            // === EN ===
            if (!newEn[fullKey]) {
                // Tạo placeholder EN: "[VI] original text" — dev nhận biết cần dịch
                newEn[fullKey] = `[VI] ${text}`;
                stats.added_en++;
                stats.en_placeholders++;
            }

            existingKeys.add(fullKey);
        }
    }

    // ===== Nếu --reset: chuyển tất cả key có [VI] thành chuẩn =====
    if (reset) {
        let resetCount = 0;
        for (const key of Object.keys(newEn)) {
            if (typeof newEn[key] === 'string' && newEn[key].startsWith('[VI] ')) {
                // Reset về "[VI] <text>" nếu VI có sẵn, fallback key
                newEn[key] = newVi[key] ? `[VI] ${newVi[key]}` : `[VI] ${key}`;
                resetCount++;
            }
        }
        console.log(`   Reset ${resetCount} EN placeholders\n`);
    }

    // ===== Tạo file output =====
    if (dryRun) {
        console.log('📊 DRY RUN Summary:');
        console.log(`   Added VI:      ${stats.added_vi}`);
        console.log(`   Added EN:      ${stats.added_en} (placeholders)`);
        console.log(`   Skipped:       ${stats.skipped_existing}`);
        console.log(`   Total keys VI: ${Object.keys(newVi).length}`);
        console.log(`   Total keys EN: ${Object.keys(newEn).length}`);
        return;
    }

    // ===== Generate file content =====
    const lines = [];
    lines.push('// locales/i18n.js - Internationalization dictionary');
    lines.push('// Auto-generated bởi scripts/import-i18n-suggestions.js');
    lines.push('// Add new keys here when adding new UI text');
    lines.push('');
    lines.push('const translations = {');
    lines.push('    vi: {');

    const viKeys = Object.keys(newVi).sort();
    for (let i = 0; i < viKeys.length; i++) {
        const key = viKeys[i];
        const value = newVi[key];
        const comma = i < viKeys.length - 1 ? ',' : '';
        const escaped = String(value).replace(/'/g, "\\'");
        lines.push(`        '${key}': '${escaped}'${comma}`);
    }

    lines.push('    },');
    lines.push('');
    lines.push('    en: {');

    const enKeys = Object.keys(newEn).sort();
    for (let i = 0; i < enKeys.length; i++) {
        const key = enKeys[i];
        const value = newEn[key];
        const comma = i < enKeys.length - 1 ? ',' : '';
        const escaped = String(value).replace(/'/g, "\\'");
        lines.push(`        '${key}': '${escaped}'${comma}`);
    }

    lines.push('    },');
    lines.push('};');
    lines.push('');
    lines.push('function t(key, lang = \'vi\', fallback = null) {');
    lines.push('    const dict = translations[lang] || translations.vi;');
    lines.push('    return dict[key] !== undefined ? dict[key] : (fallback !== null ? fallback : key);');
    lines.push('}');
    lines.push('');
    lines.push('function getLang(req) {');
    lines.push('    if (req.user && req.user.language) return req.user.language;');
    lines.push('    if (req.session && req.session.user && req.session.user.language) return req.session.user.language;');
    lines.push('    return \'vi\';');
    lines.push('}');
    lines.push('');
    lines.push('module.exports = { translations, t, getLang };');
    lines.push('');

    const content = lines.join('\n');
    fs.writeFileSync(LOCALES_FILE, content, 'utf8');

    console.log('✅ Import xong!');
    console.log(`   Added VI:           ${stats.added_vi}`);
    console.log(`   Added EN:           ${stats.added_en} (placeholders)`);
    console.log(`   Skipped (existing): ${stats.skipped_existing}`);
    console.log(`   Total keys VI:      ${Object.keys(newVi).length}`);
    console.log(`   Total keys EN:      ${Object.keys(newEn).length}`);
    console.log(`\n📄 Updated: ${LOCALES_FILE}`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Refactor views/ dùng t('namespace.key') thay hardcoded text`);
    console.log(`   2. Dịch các key EN có prefix [VI] sang tiếng Anh thật`);
    console.log(`   3. Test: node -e "require('./locales/i18n').t('test', 'en', 'fallback')"`);
}

main();
