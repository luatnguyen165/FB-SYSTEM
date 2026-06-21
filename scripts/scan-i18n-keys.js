#!/usr/bin/env node
// scripts/scan-i18n-keys.js
// Quét các view .ejs để tìm text tiếng Việt cứng (hardcoded) cần chuyển sang t('key')
// Usage: node scripts/scan-i18n-keys.js [--write-suggestions]
// Output: Báo cáo console + file i18n-suggestions.json (nếu --write-suggestions)

const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', 'views');
const OUTPUT_FILE = path.join(__dirname, '..', 'i18n-suggestions.json');

// Pattern: bắt text tiếng Việt có dấu (ưu tiên text > 2 ký tự có dấu)
const VN_TEXT_PATTERN = /[\p{L}][\p{L}\p{M}\s\d.,:;!?()\-_'"+/\\@#&%*=<>[\]{}|`~]{1,80}/gu;
const HAS_VN_CHARS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđĐ]/;

// Loại trừ: class names, attribute names, JS code, comments
const SKIP_PATTERNS = [
    /^\s*<%/,
    /class\s*=/,
    /id\s*=/,
    /data-/,
    /aria-/,
    /onclick\s*=/,
    /<script/i,
    /\/\//,
    /\/\*/,                  // JS comment
    /<!--/,                  // HTML comment
    /^\s*\/\*/,              // CSS comment
];

function isLikelyVietnameseText(text) {
    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    if (!HAS_VN_CHARS.test(trimmed)) return false;
    // Bỏ qua nếu chỉ là HTML attr value (có dấu "=" trước)
    if (/=\s*['"]$/.test(text)) return false;
    return true;
}

function shouldSkip(text) {
    return SKIP_PATTERNS.some(p => p.test(text));
}

function scanFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const findings = [];

    lines.forEach((line, idx) => {
        // Bỏ qua comment line
        if (shouldSkip(line)) return;

        // Tìm text trong tag > text </tag>, hoặc placeholder=..., hoặc > text <
        // Match chuỗi có dấu tiếng Việt
        const matches = line.matchAll(/>([^<>]{3,})</g);
        for (const m of matches) {
            const text = m[1].trim();
            if (isLikelyVietnameseText(text) && !shouldSkip(text)) {
                findings.push({ line: idx + 1, text, type: 'tag-content' });
            }
        }

        // Match placeholder="text"
        const placeholderMatches = line.matchAll(/placeholder=["']([^"']{3,})["']/g);
        for (const m of placeholderMatches) {
            const text = m[1].trim();
            if (isLikelyVietnameseText(text)) {
                findings.push({ line: idx + 1, text, type: 'placeholder' });
            }
        }

        // Match title="text"
        const titleMatches = line.matchAll(/\btitle=["']([^"']{3,})["']/g);
        for (const m of titleMatches) {
            const text = m[1].trim();
            if (isLikelyVietnameseText(text)) {
                findings.push({ line: idx + 1, text, type: 'title-attr' });
            }
        }
    });

    return findings;
}

function findEjsFiles(dir) {
    const files = [];
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            files.push(...findEjsFiles(fullPath));
        } else if (item.name.endsWith('.ejs')) {
            files.push(fullPath);
        }
    }
    return files;
}

function generateKey(text) {
    // "Đăng nhập" → "Đăng nhập" (giữ nguyên để dev dễ đọc, sau đó tự refactor)
    return text
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .trim()
        .substring(0, 60);
}

function main() {
    const writeFile = process.argv.includes('--write-suggestions');
    console.log('🔍 Scanning EJS files for hardcoded Vietnamese text...\n');

    const ejsFiles = findEjsFiles(VIEWS_DIR);
    const allFindings = {};
    let totalIssues = 0;

    for (const file of ejsFiles) {
        const relPath = path.relative(path.join(__dirname, '..'), file);
        const findings = scanFile(file);

        if (findings.length > 0) {
            allFindings[relPath] = findings;
            totalIssues += findings.length;
            console.log(`📄 ${relPath}: ${findings.length} issues`);
            // In 3 mẫu đầu
            for (const f of findings.slice(0, 3)) {
                console.log(`   Line ${f.line} [${f.type}]: "${f.text.substring(0, 50)}${f.text.length > 50 ? '...' : ''}"`);
            }
            if (findings.length > 3) {
                console.log(`   ... and ${findings.length - 3} more`);
            }
        }
    }

    console.log(`\n📊 Total: ${totalIssues} hardcoded strings in ${Object.keys(allFindings).length} files`);

    if (writeFile) {
        // Convert to suggestion format: { namespace: { key: viText } }
        const suggestions = {};
        for (const file of Object.keys(allFindings)) {
            const ns = file.replace(/^views\//, '').replace(/\.ejs$/, '').replace(/[\/\\]/g, '.');
            suggestions[ns] = suggestions[ns] || {};
            for (const f of allFindings[file]) {
                const key = generateKey(f.text);
                if (key && !suggestions[ns][key]) {
                    suggestions[ns][key] = f.text;
                }
            }
        }
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(suggestions, null, 2), 'utf8');
        console.log(`\n✅ Suggestions written to: ${OUTPUT_FILE}`);
        console.log(`   → Import file này vào locales/i18n.js để thêm translation mới.`);
    } else {
        console.log('\n💡 Run with --write-suggestions to generate i18n-suggestions.json');
    }
}

main();
