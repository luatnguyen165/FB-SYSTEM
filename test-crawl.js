// test-crawl.js — CLI test script cho FB Comment Crawler
// Cách dùng:
//   node test-crawl.js <postUrl> [maxComments=50] [maxDepth=5] [headless=true|false]
//
// Ví dụ:
//   node test-crawl.js "https://www.facebook.com/share/v/191btjzQ6t/" 30 5 false
//   node test-crawl.js "https://www.facebook.com/PAGE/posts/123" 100 5 true --debug
//
// Flags:
//   --debug    Bật debug mode (in chi tiết DOM, buttons, articles...)
//   --keep=N   Giữ browser mở N ms sau khi xong (mặc định 5000)
//   --no-close Không đóng browser khi kết thúc
//
// Tự tìm FB session đã login (folder con trong social-sessions/).
// Kết quả: in JSON + lưu file test-output-<timestamp>.json.

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const { scrapePostComments, extractPostId, cleanFbUrl } = require('./services/facebook/commentCrawler');

// === Parse args ===
const args = process.argv.slice(2);
const flags = new Set();
let keepOpenMs = 5000;

for (const a of args) {
    if (a.startsWith('--')) {
        if (a === '--debug') flags.add('debug');
        else if (a === '--no-close') flags.add('no-close');
        else if (a.startsWith('--keep=')) keepOpenMs = parseInt(a.split('=')[1]) || 0;
    }
}
const positional = args.filter(a => !a.startsWith('--'));

const postUrl = positional[0] || 'https://www.facebook.com/share/v/191btjzQ6t/';
const maxComments = parseInt(positional[1]) || 30;
const maxDepth = parseInt(positional[2]) || 5;
const headless = (positional[3] || 'false').toLowerCase() !== 'false';

if (flags.has('debug')) {
    global.CRAWLER_DEBUG = true;
    process.env.CRAWLER_DEBUG = 'true';
}

console.log('========================================');
console.log('🧪 FB Comment Crawler — TEST MODE');
console.log('========================================');
console.log('Post URL    :', postUrl);
console.log('Cleaned URL :', cleanFbUrl(postUrl));
console.log('Post ID     :', extractPostId(cleanFbUrl(postUrl)));
console.log('Max Comments:', maxComments);
console.log('Max Depth   :', maxDepth);
console.log('Headless    :', headless);
console.log('Debug mode  :', flags.has('debug') ? '✅ ON' : '❌ OFF');
console.log('Keep open   :', flags.has('no-close') ? 'never' : keepOpenMs + 'ms');
console.log('========================================\n');

// === Tìm 1 FB session đã login để dùng ===
function findFbSession() {
    const root = path.join(__dirname, 'social-sessions');
    if (!fs.existsSync(root)) return null;
    const users = fs.readdirSync(root);
    for (const userDir of users) {
        const userPath = path.join(root, userDir);
        if (!fs.statSync(userPath).isDirectory()) continue;
        const sessions = fs.readdirSync(userPath).filter(s => s.includes('-FB') || s.startsWith('fb_'));
        for (const sess of sessions) {
            const sessPath = path.join(userPath, sess);
            // Check có Cookies file hoặc Default/Cookies không
            const hasCookies = fs.existsSync(path.join(sessPath, 'Default', 'Cookies')) ||
                              fs.existsSync(path.join(sessPath, 'Cookies')) ||
                              fs.existsSync(path.join(sessPath, 'default', 'Cookies'));
            if (hasCookies) {
                console.log('📂 Found FB session:', sessPath);
                return { userId: userDir, accountName: sess, accountType: 'Cá nhân', storageStatePath: sessPath };
            }
        }
    }
    return null;
}

async function dumpDebugSnapshot(page) {
    try {
        const info = await page.evaluate(() => {
            const articles = document.querySelectorAll('[role="article"]');
            const dialogs = document.querySelectorAll('[role="dialog"]');
            const commentBtns = document.querySelectorAll('[aria-label*="Bình luận" i], [aria-label*="Comment" i]');
            // Tìm tất cả button có thể liên quan đến comment
            const replyBtns = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'))
                .map(b => (b.innerText || b.textContent || '').trim())
                .filter(t => t.length > 0 && t.length < 100)
                .slice(0, 20);
            return {
                url: location.href,
                title: document.title,
                articleCount: articles.length,
                dialogCount: dialogs.length,
                commentBtnCount: commentBtns.length,
                sampleArticleLabels: Array.from(articles).slice(0, 5).map(a => a.getAttribute('aria-label')?.substring(0, 80)),
                sampleReplyBtns: replyBtns,
                bodyTextSample: document.body.textContent.substring(0, 500)
            };
        });
        console.log('\n🔍 [DEBUG SNAPSHOT]');
        console.log('   URL              :', info.url);
        console.log('   Title            :', info.title);
        console.log('   Articles         :', info.articleCount);
        console.log('   Dialogs          :', info.dialogCount);
        console.log('   Comment Btn Count:', info.commentBtnCount);
        console.log('   Sample Labels    :', JSON.stringify(info.sampleArticleLabels, null, 2));
        console.log('   Sample Reply Btns:', JSON.stringify(info.sampleReplyBtns, null, 2));
        console.log('   Body Sample (500):', info.bodyTextSample);
        console.log('');
    } catch (e) {
        console.log('⚠️ Debug snapshot failed:', e.message);
    }
}

async function main() {
    const channel = findFbSession();
    if (!channel) {
        console.error('❌ Không tìm thấy FB session nào trong social-sessions/');
        console.error('   Hãy đăng nhập 1 FB account trong FB-SYSTEM trước.');
        process.exit(1);
    }

    const fakeUserId = '000000000000000000000000';

    const onProgress = (p) => {
        const parts = [];
        if (p.phase) parts.push(`[${p.phase}]`);
        if (p.statusText) parts.push(p.statusText);
        if (p.buttonsClicked != null) parts.push(`clicked=${p.buttonsClicked}`);
        if (p.scrapedCount != null) parts.push(`scraped=${p.scrapedCount}`);
        if (p.mainComments != null) parts.push(`main=${p.mainComments}`);
        if (p.replies != null) parts.push(`reply=${p.replies}`);
        if (p.visibleComments != null) parts.push(`visible=${p.visibleComments}`);
        if (p.debug) {
            console.log('  🐛 [DEBUG from progress]', JSON.stringify(p.debug));
            return;
        }
        console.log('  ⏳', parts.join(' | '));
    };

    const result = await scrapePostComments({
        userId: fakeUserId,
        channel: {
            userId: fakeUserId,
            accountName: channel.accountName,
            accountType: channel.accountType,
            storageStatePath: channel.storageStatePath
        },
        postUrl,
        maxComments,
        maxDepth,
        keepOpenMs: flags.has('no-close') ? 999999999 : keepOpenMs,
        onProgress
    });

    // Nếu 0 comment và đang debug, dump thêm snapshot
    if (flags.has('debug') && (!result.comments || result.comments.length === 0)) {
        try {
            const { ACTIVE_FB_SESSIONS } = require('./services/facebook/session');
            for (const [, sess] of ACTIVE_FB_SESSIONS) {
                if (sess.context && !sess.context.isClosed()) {
                    const page = sess.context.pages()[0];
                    if (page) {
                        console.log('\n⚠️ 0 comment nhưng đang DEBUG → dump DOM snapshot trước khi đóng...');
                        await dumpDebugSnapshot(page);
                    }
                }
            }
        } catch (e) {
            console.log('Debug dump error:', e.message);
        }
    }

    console.log('\n========================================');
    console.log('📊 RESULT');
    console.log('========================================');
    console.log('Success     :', result.success);
    console.log('Error       :', result.error || '(none)');
    console.log('Post ID     :', result.postId);
    console.log('Post Title  :', result.postTitle);
    console.log('Duration    :', Math.round((result.durationMs || 0) / 1000) + 's');
    console.log('Stats       :', JSON.stringify(result.stats || {}, null, 2));
    console.log('Comments    :', (result.comments || []).length, 'flat items');
    console.log('Tree roots  :', (result.tree || []).length);

    if (result.comments && result.comments.length > 0) {
        console.log('\n--- TOP 5 COMMENTS (preview) ---');
        result.comments.slice(0, 5).forEach((c, i) => {
            console.log(`\n[${i + 1}] depth=${c.depth} | ${c.author || '[NO AUTHOR]'} | ${c.timestamp || ''}`);
            console.log(`    ${c.text.substring(0, 200)}${c.text.length > 200 ? '...' : ''}`);
            if (c.likes) console.log(`    ❤ ${c.likes}`);
        });
    } else {
        console.log('\n❌ KHÔNG CÓ COMMENT NÀO ĐƯỢC SCRAPE');
        console.log('   Nguyên nhân có thể:');
        console.log('   1. Post thật sự 0 comment (kiểm tra bằng browser thường)');
        console.log('   2. Modal comment không mở được (FB đổi layout)');
        console.log('   3. FB account scrape chưa login / bị checkpoint');
        console.log('   4. Post bị restrict theo vùng / bạn bè');
        console.log('\n   💡 Chạy lại với --debug để xem chi tiết DOM:');
        console.log('      node test-crawl.js "<url>" 30 5 false --debug');
    }

    // Lưu file output
    const outFile = path.join(__dirname, `test-output-${Date.now()}.json`);
    fs.writeFileSync(outFile, JSON.stringify({
        input: { postUrl, maxComments, maxDepth, headless, debug: flags.has('debug') },
        postId: result.postId,
        postTitle: result.postTitle,
        durationMs: result.durationMs,
        stats: result.stats,
        comments: result.comments,
        tree: result.tree,
        error: result.error
    }, null, 2));
    console.log('\n💾 Saved to:', outFile);

    // Cleanup
    if (!flags.has('no-close')) {
        try {
            const { ACTIVE_FB_SESSIONS } = require('./services/facebook/session');
            for (const [, sess] of ACTIVE_FB_SESSIONS) {
                if (sess.context && !sess.context.isClosed()) {
                    await sess.context.close().catch(() => {});
                }
            }
        } catch (e) { /* skip */ }
    } else {
        console.log('\n⚠️ --no-close: browser vẫn mở, tự tắt khi thoát Node.');
    }

    process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
    console.error('💥 FATAL:', err.message);
    console.error(err.stack);
    process.exit(1);
});
