// services/facebook/commentCrawler.js
// Port logic từ facebook-comment-scraper.user.js sang Playwright (Node.js).
// Dùng page.evaluate() để chạy JS trong browser context — giữ logic userscript gần như nguyên bản.
//
// Cách dùng:
//   const result = await scrapePostComments({
//     userId, channel, postUrl, maxComments, maxDepth,
//     onProgress: (p) => { /* emit socket */ }
//   });
//
// Return: { success, comments, tree, stats, error }

const fs = require('fs');
const path = require('path');
const { getOrOpenFacebookContext, ACTIVE_FB_SESSIONS } = require('./session');
const { normalizeEncryptedValue } = require('../../utils/cryptoVault');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// Helper: extract postId từ URL FB (best-effort)
function extractPostId(url) {
    if (!url) return '';
    try {
        // /posts/<id> — id có thể là số HOẶC pfbid<alphanumeric> (dạng mới của FB)
        let m = url.match(/\/posts\/([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        // story.php?story_fbid=<id>
        m = url.match(/story_fbid=([a-zA-Z0-9]+)/);
        if (m) return m[1];
        // /permalink/<id>
        m = url.match(/permalink\/([a-zA-Z0-9]+)/);
        if (m) return m[1];
        // /videos/<id>
        m = url.match(/\/videos\/([a-zA-Z0-9]+)/);
        if (m) return m[1];
        // /share/v/<shortId> (share link video)
        m = url.match(/\/share\/[pv]\/([a-zA-Z0-9_-]+)/);
        if (m) return 'share_' + m[1];
        // /share/r/<shortId> (share post)
        m = url.match(/\/share\/r\/([a-zA-Z0-9_-]+)/);
        if (m) return 'share_' + m[1];
        // /reel/<id>
        m = url.match(/\/reel\/([a-zA-Z0-9]+)/);
        if (m) return m[1];
        // /watch/?v=<id>
        m = url.match(/[?&]v=([a-zA-Z0-9]+)/);
        if (m) return m[1];
        // /<username>/<slug>/<id>
        m = url.match(/facebook\.com\/[^\/]+\/[\w.-]+\/([a-zA-Z0-9]+)/);
        if (m) return m[1];
        // fallback: hash url để tạo key ổn định
        const crypto = require('crypto');
        return 'urlhash:' + crypto.createHash('md5').update(url).digest('hex').substring(0, 16);
    } catch (e) {
        return '';
    }
}

// Strip query params thừa (rdid, __cft__, __tn__, mibextid...) để URL clean hơn
function cleanFbUrl(url) {
    if (!url) return '';
    try {
        // Bỏ fragment (#...)
        let u = url.split('#')[0];
        // Bỏ một số query param tracking không cần thiết
        const skipParams = ['rdid', '__cft__', '__tn__', 'mibextid', 'ref', 'hc_ref'];
        try {
            const parsed = new URL(u);
            skipParams.forEach(p => parsed.searchParams.delete(p));
            return parsed.toString();
        } catch (e) {
            return u; // không phải URL hợp lệ, trả nguyên
        }
    } catch (e) {
        return url;
    }
}

// Click dropdown "Phù hợp nhất" → "Tất cả bình luận" trên feed
// (bước này mở modal riêng chứa TẤT CẢ comments, không phải top 19)
async function openAllCommentsViaSort(page) {
    try {
        // Bước 1: Tìm và click "Phù hợp nhất" / "Most relevant"
        const sortBtnCandidates = [
            'span[dir="auto"]:has-text("Phù hợp nhất")',
            'span[dir="auto"]:has-text("Most relevant")',
            'span[dir="auto"]:has-text("Phù hợp")',
            'span[dir="auto"]:has-text("Top comments")',
            'div[role="button"]:has-text("Phù hợp nhất")',
            'div[role="button"]:has-text("Most relevant")',
            'span.x193iq5w:has-text("Phù hợp nhất")'
        ];
        let sortClicked = false;
        let sortBtnText = '';
        for (const sel of sortBtnCandidates) {
            const allMatching = await page.locator(sel).all();
            console.log('[Comment Crawler] Sort candidate:', sel, '→', allMatching.length, 'matches');
            for (const btn of allMatching) {
                if (await btn.isVisible().catch(() => false)) {
                    await btn.scrollIntoViewIfNeeded().catch(() => {});
                    await wait(300);
                    sortBtnText = (await btn.textContent().catch(() => '')).trim();
                    await btn.click({ force: true }).catch(() => {});
                    console.log('[Comment Crawler] ✅ Clicked sort:', sortBtnText, '| selector:', sel);
                    sortClicked = true;
                    break;
                }
            }
            if (sortClicked) break;
        }
        if (!sortClicked) {
            console.log('[Comment Crawler] ❌ Sort dropdown not found, skip');
            return false;
        }
        await wait(2000);

        // Bước 2: Chờ menu hiện → click "Tất cả bình luận" / "All comments"
        // LƯU Ý: phải match CHÍNH XÁC "Tất cả bình luận", KHÔNG match "Mới nhất" hay "Phù hợp nhất"
        const allCommentsCandidates = [
            'span[dir="auto"]:text-is("Tất cả bình luận")',
            'span[dir="auto"]:text-is("All comments")',
            'div[role="menuitem"]:text-is("Tất cả bình luận")',
            'div[role="menuitem"]:text-is("All comments")',
            'span[dir="auto"]:has-text("Tất cả bình luận")',
            'span[dir="auto"]:has-text("All comments")',
            'div[role="menuitem"]:has-text("Tất cả bình luận")',
            'div[role="menuitem"]:has-text("All comments")',
            'div[role="button"]:has-text("Tất cả bình luận")',
            'div[role="button"]:has-text("All comments")',
            'span:has-text("Tất cả bình luận")',
            'span:has-text("All comments")'
        ];
        for (const sel of allCommentsCandidates) {
            const allMatching = await page.locator(sel).all();
            for (const btn of allMatching) {
                const txt = (await btn.textContent().catch(() => '')).trim();
                // BỎ QUA "Mới nhất", "Phù hợp nhất", "Top comments" — chỉ lấy exact "Tất cả bình luận"
                if (!txt) continue;
                if (/^(mới nhất|newest|top comments|phù hợp nhất|most relevant|relevant|oldest|cũ nhất)$/i.test(txt)) continue;
                if (!/(tất cả|all)/i.test(txt)) continue;
                if (await btn.isVisible().catch(() => false)) {
                    await btn.click({ force: true }).catch(() => {});
                    console.log('[Comment Crawler] ✅ Clicked "Tất cả bình luận" (text="' + txt + '") | selector:', sel);
                    await wait(4000);
                    return true;
                }
            }
        }
        console.log('[Comment Crawler] ❌ "Tất cả bình luận" not found in menu');
        return false;
    } catch (e) {
        console.log('[Comment Crawler] openAllCommentsViaSort error:', e.message);
        return false;
    }
}

// Script chạy trong browser context để click "Xem bình luận" / mở modal.
// Trả về true nếu mở được modal.
async function openCommentModal(page) {
    // Tìm button mở comment box / view all comments
    const candidates = [
        '[aria-label*="Bình luận"]',
        '[aria-label*="Comment"]',
        'div[role="button"][aria-label*="comment" i]',
        'span[role="button"]:has-text("Bình luận")',
        'span[role="button"]:has-text("Comment")',
        'div[role="button"]:has-text("Xem tất cả bình luận")',
        'div[role="button"]:has-text("View all comments")',
        'div[role="button"]:has-text("Xem bình luận")'
    ];
    for (const sel of candidates) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
                await btn.click({ force: true }).catch(() => {});
                await wait(1500);
                // Check modal xuất hiện chưa
                const hasModal = await page.locator('[role="dialog"]').count() > 0;
                if (hasModal) return true;
            }
        } catch (e) { /* thử selector tiếp */ }
    }
    return false;
}

// === CORE SCRAPER (chạy trong browser context qua page.evaluate) ===
// Logic port thẳng từ userscript, giữ nguyên 5 strategies detect depth.
// Trả về JSON-string array of comments để tránh vấn đề serialize qua Playwright.

function buildScrapeInBrowserScript() {
    // Trả về function source — sẽ được page.evaluate() chạy.
    return `
    (async function() {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const stats = { mainComments: 0, replies: 0, buttonsClicked: 0 };
        const scrapedComments = new Set();
        const articleToCommentMap = new Map();
        const replyButtonParentMap = new Map();

        function findCommentModal() {
            const dialogs = document.querySelectorAll('[role="dialog"]');
            for (let d of dialogs) {
                if (d.querySelectorAll('[role="article"]').length > 0) return d;
            }
            return null;
        }

        function isInModalViewport(element, modal) {
            if (!element || !modal) return false;
            if (!modal.contains(element)) return false;
            const rect = element.getBoundingClientRect();
            const modalRect = modal.getBoundingClientRect();
            return rect.top < modalRect.bottom + 1000 && rect.bottom > modalRect.top - 1000;
        }

        async function scrollModalIncremental(modal) {
            const scrollContainer = modal.querySelector('[style*="overflow"]') || modal.querySelector('.xb57i2i') || modal;
            const prevHeight = scrollContainer.scrollHeight;
            for (let i = 0; i < 3; i++) {
                scrollContainer.scrollTop = scrollContainer.scrollHeight;
                await sleep(800);
            }
            const newHeight = scrollContainer.scrollHeight;
            scrollContainer.scrollTop = 0;
            await sleep(300);
            return newHeight > prevHeight;
        }

        function getCurrentCommentCount(modal) {
            const articles = modal.querySelectorAll('[role="article"]');
            let count = 0;
            articles.forEach(article => {
                const ariaLabel = article.getAttribute('aria-label');
                if (ariaLabel && /Opmerking|Comment|comment|Antwoord|Reply/i.test(ariaLabel)) {
                    const textDivs = article.querySelectorAll('div[dir="auto"]');
                    for (let div of textDivs) {
                        const t = div.textContent.trim();
                        if (t.length > 5) { count++; break; }
                    }
                }
            });
            return count;
        }

        async function expandAllReplies(modal, maxComments) {
            const replyPatterns = [
                /alle\s+\d+\s+antwoorden\s+weergeven/i,
                /\\d+\\s+antwoord\\s+bekijken/i,
                /\\d+\\s+antwoorden\\s+bekijken/i,
                /view\\s+\\d+\\s+repl/i,
                /view\\s+more\\s+repl/i,
                /view\\s+previous\\s+repl/i,
                /heeft\\s+geantwoord/i,
                /replied/i,
                /\\d+\\s+antwoorden/i,
                /\\d+\\s+replies/i,
                /\\d+\\s+reply/i,
                /xem\\s+\\d+\\s+phản\\s+hồi/i,
                /xem\\s+thêm\\s+phản\\s+hồi/i,
                /đã\\s+trả\\s+lời/i,
                /xem\\s+các\\s+phản\\s+hồi/i
            ];
            let iteration = 0;
            let totalClicked = 0;
            let consecutiveEmpty = 0;

            while (iteration < 200) {
                let clickedRound = 0;
                let notInViewport = 0;
                const allButtons = modal.querySelectorAll('div[role="button"], span[role="button"], a[href], span');

                for (let btn of allButtons) {
                    if (btn.tagName === 'A') {
                        const href = btn.getAttribute('href');
                        if (href && (href.startsWith('#') || href.startsWith('http'))) continue;
                    }
                    const text = btn.innerText || btn.textContent || '';
                    const matches = replyPatterns.some(p => p.test(text));
                    if (!matches) continue;
                    try {
                        btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await sleep(500);
                        if (!isInModalViewport(btn, modal)) { notInViewport++; continue; }
                        const parentArticle = btn.closest('[role="article"]');
                        if (parentArticle) {
                            const beforeClick = new Set(modal.querySelectorAll('[role="article"]'));
                            replyButtonParentMap.set(parentArticle, { clickedAt: Date.now(), articlesBeforeClick: beforeClick });
                        }
                        if (btn.tagName === 'A') {
                            btn.addEventListener('click', e => e.preventDefault(), { once: true });
                        }
                        btn.click();
                        clickedRound++;
                        totalClicked++;
                        stats.buttonsClicked++;
                        await sleep(900);
                    } catch (e) { /* skip */ }
                }

                const countAfter = getCurrentCommentCount(modal);
                // báo progress qua window để server đọc lại được
                window.__scrapeProgress = {
                    iteration: iteration + 1,
                    buttonsClicked: stats.buttonsClicked,
                    visibleComments: countAfter,
                    phase: 'expand-replies'
                };

                if (clickedRound === 0 && notInViewport === 0) {
                    consecutiveEmpty++;
                    if (consecutiveEmpty >= 2) break;
                } else if (clickedRound === 0 && notInViewport > 0) {
                    const scrollContainer = modal.querySelector('[style*="overflow"]') || modal;
                    const before = scrollContainer.scrollTop;
                    scrollContainer.scrollTop += 1000;
                    await sleep(800);
                    if (scrollContainer.scrollTop === before) break;
                } else {
                    consecutiveEmpty = 0;
                }
                iteration++;
                await sleep(300);
            }
            return totalClicked;
        }

        async function expandMoreComments(modal) {
            const viewMorePatterns = [
                /view\s+more\s+comment/i,
                /view\s+previous\s+comment/i,
                /meer\s+reacties/i,
                /meer\s+opmerkingen/i,
                /vorige\s+reacties/i,
                /bekijk\s+meer\s+reacties/i,
                /weitere\s+kommentare/i,
                /view\s+\d+\s+more\s+comment/i,
                /xem\s+thêm\s+bình\s+luận/i,
                /xem\s+thêm\s+comment/i,
                /tải\s+thêm\s+bình\s+luận/i,
                /xem\s+tất\s+cả\s+bình\s+luận/i,
                /xem\s+tất\s+cả\s+(\d+\s+)?bình\s+luận/i,
                /xem\s+thêm\s+(\d+\s+)?bình\s+luận/i,
                /xem\s+(\d+)\s+bình\s+luận\s+khác/i,
                /xem\s+(\d+)\s+bình\s+luận\s+trước/i,
                /tất\s+cả\s+bình\s+luận/i,
                /view\s+all\s+comment/i,
                /view\s+all\s+(\d+\s+)?comment/i,
                /hiển\s+thị\s+tất\s+cả\s+bình\s+luận/i
            ];
            let clicked = 0;
            const allButtons = modal.querySelectorAll('div[role="button"], span[role="button"], a[href], span');
            for (let btn of allButtons) {
                if (btn.tagName === 'A') {
                    const href = btn.getAttribute('href');
                    if (href && (href.startsWith('#') || href.startsWith('http'))) continue;
                }
                if (!isInModalViewport(btn, modal)) continue;
                const text = btn.innerText || btn.textContent || '';
                if (!viewMorePatterns.some(p => p.test(text))) continue;
                try {
                    btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await sleep(300);
                    if (btn.tagName === 'A') btn.addEventListener('click', e => e.preventDefault(), { once: true });
                    btn.click();
                    clicked++;
                    stats.buttonsClicked++;
                    await sleep(800);
                } catch (e) { /* skip */ }
            }
            return clicked;
        }

        async function expandAllInModal(modal, maxComments) {
            let cycle = 0;
            let emptyCycles = 0;
            while (cycle < 100) {
                const repliesClicked = await expandAllReplies(modal, maxComments);
                const countAfter = getCurrentCommentCount(modal);
                const hasEnough = maxComments > 0 && countAfter >= maxComments * 1.5;
                let moreClicked = 0, scrolledNew = false;
                if (!hasEnough) {
                    moreClicked = await expandMoreComments(modal);
                    scrolledNew = await scrollModalIncremental(modal);
                }
                window.__scrapeProgress = {
                    cycle: cycle + 1,
                    buttonsClicked: stats.buttonsClicked,
                    visibleComments: countAfter,
                    phase: 'cycle'
                };
                if (repliesClicked === 0 && moreClicked === 0 && !scrolledNew) {
                    emptyCycles++;
                    if (emptyCycles >= 3) break;
                } else emptyCycles = 0;
                cycle++;
                await sleep(500);
            }
            return stats.buttonsClicked;
        }

        function extractNameFromLink(link) {
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#') || href === '/') return null;
            const basePath = href.split('?')[0];
            if (basePath.includes('/comment/') || basePath.includes('/reply/')) return null;
            const diAutoSpans = link.querySelectorAll('span[dir="auto"]');
            for (let span of diAutoSpans) {
                const text = span.textContent.trim();
                if (text && text.length > 0 && text.length < 100) return text;
            }
            const allSpans = link.querySelectorAll('span');
            for (let span of allSpans) {
                const text = span.textContent.trim();
                if (text && text.length > 0 && text.length < 100 &&
                    !text.includes('geleden') && !text.includes('ago') &&
                    text !== 'u' && !/^\\d+[u]?$/.test(text)) return text;
            }
            const linkText = link.textContent.trim();
            if (linkText && linkText.length > 0 && linkText.length < 100 &&
                !linkText.includes('geleden') && !linkText.includes('ago')) return linkText;
            return null;
        }

        function extractAuthorName(article) {
            const links = article.querySelectorAll('a[href*="facebook.com"], a[href^="/"]');
            for (let link of links) {
                const name = extractNameFromLink(link);
                if (name) return name;
            }
            return null;
        }

        function extractComment(article, commentIndex) {
            try {
                const comment = {
                    cid: 'c_' + commentIndex + '_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                    parentId: null,
                    author: '', authorName: '', profileUrl: '', profileImage: '',
                    text: '', timestamp: '', likes: 0,
                    isReply: false, depth: 0, hasUnloadedReplies: false,
                    replyToAuthor: ''
                };

                const imageElements = article.querySelectorAll('image[xlink\\\\:href], image[href]');
                for (let img of imageElements) {
                    const href = img.getAttribute('xlink:href') || img.getAttribute('href');
                    if (href && href.includes('fbcdn.net') && !href.includes('static.xx.fbcdn')) {
                        comment.profileImage = href.split('?')[0];
                        break;
                    }
                }

                const allLinks = article.querySelectorAll('a[href*="facebook.com"], a[href^="/"]');
                for (let link of allLinks) {
                    const href = link.getAttribute('href');
                    if (!href) continue;
                    const basePath = href.split('?')[0];
                    if (basePath.includes('/comment/') || basePath.includes('/reply/')) continue;
                    if (basePath.includes('/photo/') || basePath.includes('/photos/')) continue;
                    if (basePath.includes('/hashtag/')) continue;
                    let linkText = '';
                    const spans = link.querySelectorAll('span');
                    for (let span of spans) {
                        const t = span.textContent.trim();
                        if (t && t.length > 0 && t.length < 100) { linkText = t; break; }
                    }
                    if (!linkText) linkText = link.textContent.trim();
                    if (linkText && linkText.length > 0 && linkText.length < 100 &&
                        !linkText.includes('•') && !linkText.includes('geleden') &&
                        !linkText.includes('ago') && !linkText.includes('Like') &&
                        !linkText.includes('Reply') && !linkText.includes('Share') &&
                        !linkText.includes('Reageren') && !linkText.includes('Delen') &&
                        !/^\\d+\\s*(min|hr|h|d|w|m|s|uur|dag)/i.test(linkText) &&
                        !/^\\d+$/.test(linkText)) {
                        comment.author = linkText;
                        comment.authorName = linkText;
                        comment.profileUrl = href.startsWith('/') ? 'https://www.facebook.com' + href.split('?')[0] : href.split('?')[0];
                        break;
                    }
                }

                if (!comment.author) {
                    const strongTags = article.querySelectorAll('strong, b, h3, h4');
                    for (let tag of strongTags) {
                        const text = tag.textContent.trim();
                        if (text && text.length > 0 && text.length < 100 &&
                            !text.includes('geleden') && !text.includes('ago') &&
                            !/^\\d+/.test(text)) {
                            comment.author = text; comment.authorName = text; break;
                        }
                    }
                }

                const textDivs = article.querySelectorAll('div[dir="auto"]');
                for (let div of textDivs) {
                    const t = div.textContent.trim();
                    if (t.length > 1 && t !== comment.author &&
                        !/^\\d+\\s*(min|hr|h|d|w|m|s|uur|dag|geleden|ago)/i.test(t) &&
                        !t.includes('heeft geantwoord') && !t.includes('replied') &&
                        !t.includes('antwoord bekijken') && !t.includes('antwoorden bekijken') &&
                        !t.includes('Xem thêm') && !t.includes('View more') &&
                        !t.includes('Tất cả') && !t.includes('All comments') &&
                        !t.includes('Mới nhất') && !t.includes('Phù hợp nhất') &&
                        !t.includes('Phản hồi') && !t.includes('Reply')) {
                        comment.text = t; break;
                    }
                }

                const ariaLabel = article.getAttribute('aria-label');
                if (ariaLabel) {
                    const m = ariaLabel.match(/(\\d+\\s+\\w+\\s+geleden|\\d+\\s+\\w+\\s+ago|yesterday|gisteren|vandaag|today|\\d+\\s+(giờ|phút|giây|ngày|tuần|tháng|năm)\\s+(trước)?)/i);
                    if (m) comment.timestamp = m[0];
                }

                if (!comment.timestamp) {
                    const timeLinks = article.querySelectorAll('a[href*="comment_id"], a[href*="reply_comment_id"]');
                    for (let link of timeLinks) {
                        const t = link.textContent.trim();
                        if (/\\d+\\s*(min|hr|h|d|w|m|s|uur|dag|week|maand|jaar|geleden|ago|giờ|phút|giây|ngày)/i.test(t)) {
                            comment.timestamp = t; break;
                        }
                    }
                }

                const fullText = article.textContent;
                if (/heeft geantwoord|replied|\\d+\\s+antwoorden|\\d+\\s+replies|\\d+\\s+antwoord\\s+bekijken|đã\\s+trả\\s+lời/i.test(fullText)) {
                    comment.hasUnloadedReplies = true;
                }

                const reactionButtons = article.querySelectorAll('[role="button"]');
                for (let btn of reactionButtons) {
                    const t = btn.textContent.trim();
                    if (/^\\d+$/.test(t)) {
                        const c = parseInt(t);
                        if (c > 0 && c < 1000000) { comment.likes = c; break; }
                    }
                }

                // Depth detect — 5 strategies (giống userscript)
                let parent = article.parentElement;
                let depth = 0;
                let immediateParentArticle = null;
                let currentArticle = article;

                // Strategy 0: nested DOM
                let currentElement = article.parentElement;
                let parentArticlesNested = [];
                while (currentElement) {
                    if (currentElement !== article && currentElement.matches && currentElement.matches('[role="article"]')) {
                        parentArticlesNested.push(currentElement);
                    }
                    currentElement = currentElement.parentElement;
                }
                if (parentArticlesNested.length > 0) {
                    depth = parentArticlesNested.length;
                    immediateParentArticle = parentArticlesNested[0];
                }

                // Strategy 0b: aria-label "Antwoord van X op de opmerking van Y"
                if (depth === 0) {
                    const ariaLab = article.getAttribute('aria-label') || '';
                    if (ariaLab.includes('Antwoord van') || ariaLab.includes('Reply from')) {
                        const dutchMatch = ariaLab.match(/Antwoord van (.+?) op de opmerking van (.+?)( \\d+| een| a )/);
                        const englishMatch = ariaLab.match(/Reply from (.+?) to comment from (.+?)( \\d+| a )/);
                        if (dutchMatch || englishMatch) {
                            depth = 1;
                        }
                    }
                }

                // Strategy 1: author mention link (search previous articles)
                if (depth === 0) {
                    const textLinks = article.querySelectorAll('a[href*="facebook.com"], a[href^="/"]');
                    const currentAuthor = extractAuthorName(article);
                    const allText = article.textContent || '';
                    for (let link of textLinks) {
                        const linkText = extractNameFromLink(link);
                        if (!linkText || linkText === currentAuthor) continue;
                        const pos = allText.indexOf(linkText);
                        if (pos < 0 || pos > 100) continue;
                        depth = 1;
                        break;
                    }
                }

                // Strategy 2: @mention
                if (depth === 0) {
                    const commentText = article.textContent || '';
                    if (/@[\\w\\s]+/.test(commentText)) depth = 1;
                }

                // Strategy 3: visual indent
                if (depth === 0) {
                    const cs = window.getComputedStyle(article);
                    const pl = parseInt(cs.paddingLeft) || 0;
                    const ml = parseInt(cs.marginLeft) || 0;
                    if (pl > 20 || ml > 20) depth = Math.floor((pl + ml) / 40);
                }

                // Strategy 4: container grouping
                if (depth === 0) {
                    let c = article.parentElement;
                    let cd = 0;
                    while (c && cd < 5) {
                        const cn = c.className || '';
                        if (cn.includes('comment_replies') || cn.includes('reply') || c.getAttribute('role') === 'list') cd++;
                        c = c.parentElement;
                    }
                    if (cd > 0) depth = cd;
                }

                comment.depth = depth;
                comment.isReply = depth > 0;

                // Lookup parentId từ articleToCommentMap
                if (immediateParentArticle && articleToCommentMap.has(immediateParentArticle)) {
                    comment.parentId = articleToCommentMap.get(immediateParentArticle);
                }

                return comment;
            } catch (e) {
                return null;
            }
        }

        // MAIN
        try {
            const modal = findCommentModal();
            if (!modal) {
                // Fallback: thử scrape articles ngoài dialog (FB mobile view / single-page view)
                const allArticlesOutside = document.querySelectorAll('[role="article"]');
                if (allArticlesOutside.length > 0) {
                    window.__scrapeDebug = {
                        modal: false,
                        fallback: 'outside-dialog',
                        totalArticles: allArticlesOutside.length,
                        sampleLabels: Array.from(allArticlesOutside).slice(0, 8).map(a => a.getAttribute('aria-label')?.substring(0, 100))
                    };
                } else {
                    window.__scrapeDebug = { modal: false, totalArticles: 0, bodySample: document.body.textContent.substring(0, 300) };
                }
                return JSON.stringify({ success: false, error: 'Modal not found' });
            }

            const maxComments = window.__scrapeMax || 0;
            // Mặc định KHÔNG lấy reply — chỉ main comment
            const includeReplies = window.__scrapeIncludeReplies === true;
            const previousAuthors = (window.__scrapePreviousAuthors || []).map(a => String(a).trim().toLowerCase());
            await expandAllInModal(modal, maxComments);

            // settle
            await sleep(5000);

            const articles = Array.from(modal.querySelectorAll('[role="article"]'));
            // Diagnostic: trước khi filter, đếm & sample
            const allArticleLabels = articles.map(a => a.getAttribute('aria-label') || '').filter(l => l);
            const matchedLabels = allArticleLabels.filter(l => /Opmerking|Antwoord|Comment|Reply|comment|reply|Bình luận|Phản hồi|Trả lời|bình luận|phản hồi|trả lời/i.test(l));
            window.__scrapeDebug = {
                modal: true,
                totalArticles: articles.length,
                withAriaLabel: allArticleLabels.length,
                matchedAriaLabel: matchedLabels.length,
                includeReplies: includeReplies,
                sampleAllLabels: allArticleLabels.slice(0, 10),
                sampleMatchedLabels: matchedLabels.slice(0, 5)
            };
            const comments = [];
            let scrapedCount = 0;
            let skippedCount = 0;
            let skippedNoAria = 0;
            let skippedNoText = 0;
            let skipNoMatchLabel = 0;
            let skippedIsReply = 0;
            let skippedPreviousUser = 0;

            for (let i = 0; i < articles.length; i++) {
                const article = articles[i];
                if (maxComments > 0 && scrapedCount >= maxComments) break;
                const ariaLabel = article.getAttribute('aria-label');
                if (!ariaLabel) { skippedNoAria++; continue; }
                if (!/Opmerking|Antwoord|Comment|Reply|comment|reply|Bình luận|Phản hồi|Trả lời|bình luận|phản hồi|trả lời/i.test(ariaLabel)) { skipNoMatchLabel++; continue; }
                // Lọc bỏ reply nếu includeReplies=false
                if (!includeReplies && /^Phản hồi|^Reply|^Antwoord|^phản hồi|^reply|^antwoord/i.test(ariaLabel)) {
                    skippedIsReply++;
                    continue;
                }

                // Trích xuất author tạm thời để check skip
                const tmpAuthor = extractAuthorName(article);
                if (previousAuthors.length > 0 && tmpAuthor) {
                    const key = String(tmpAuthor).trim().toLowerCase();
                    if (previousAuthors.includes(key)) {
                        skippedPreviousUser++;
                        continue;
                    }
                }

                const articleId = article.outerHTML.substring(0, 300);
                if (scrapedComments.has(articleId)) { skippedCount++; continue; }
                scrapedComments.add(articleId);

                const comment = extractComment(article, scrapedCount);
                if (comment && comment.text && comment.text.length > 0) {
                    articleToCommentMap.set(article, comment.cid);
                    if (comment.depth === 0) stats.mainComments++;
                    else stats.replies++;
                    comments.push(comment);
                    scrapedCount++;

                    // Emit từng user mới realtime — để UI modal hiển thị danh sách
                    window.__scrapeProgress = {
                        phase: 'extracting',
                        scrapedCount,
                        mainComments: stats.mainComments,
                        replies: stats.replies,
                        newUser: {
                            name: comment.author || comment.authorName || '[No author]',
                            text: comment.text || '',
                            depth: comment.depth || 0,
                            timestamp: comment.timestamp || ''
                        }
                    };
                } else { skippedNoText++; }
            }
            // Ghi diagnostic ra window
            window.__scrapeDebug.scraped = scrapedCount;
            window.__scrapeDebug.skippedNoAria = skippedNoAria;
            window.__scrapeDebug.skippedNoMatchLabel = skipNoMatchLabel;
            window.__scrapeDebug.skippedNoText = skippedNoText;
            window.__scrapeDebug.skippedIsReply = skippedIsReply;
            window.__scrapeDebug.skippedPreviousUser = skippedPreviousUser;
            window.__scrapeDebug.skippedDuplicates = skippedCount;
            window.__scrapeDebug.previousAuthorsCount = previousAuthors.length;

            // Build rootId, threadPath sau khi có parentId
            const cidMap = new Map(comments.map(c => [c.cid, c]));
            comments.forEach(c => {
                // Tìm root: walk lên parent chain
                let root = c;
                let visited = new Set();
                while (root.parentId && cidMap.has(root.parentId) && !visited.has(root.cid)) {
                    visited.add(root.cid);
                    root = cidMap.get(root.parentId);
                }
                c.rootId = root.cid;
                // Build thread path
                const path = [];
                let cur = c;
                while (cur && cur.parentId && cidMap.has(cur.parentId)) {
                    path.unshift(cur.parentId);
                    cur = cidMap.get(cur.parentId);
                }
                path.push(c.cid);
                c.threadPath = path.join('.');
            });

            // Build tree
            const commentMap = new Map();
            const roots = [];
            comments.forEach(c => commentMap.set(c.cid, { ...c, replies: [] }));
            comments.forEach(c => {
                const node = commentMap.get(c.cid);
                if (c.parentId && commentMap.has(c.parentId)) {
                    commentMap.get(c.parentId).replies.push(node);
                } else {
                    roots.push(node);
                }
            });

            const maxDepth = comments.reduce((m, c) => Math.max(m, c.depth || 0), 0);
            const hasIncomplete = comments.some(c => c.hasUnloadedReplies);

            return JSON.stringify({
                success: true,
                comments,
                tree: roots,
                stats: {
                    mainComments: stats.mainComments,
                    replies: stats.replies,
                    totalComments: comments.length,
                    buttonsClicked: stats.buttonsClicked,
                    maxDepth,
                    hasIncompleteReplies: hasIncomplete,
                    skippedDuplicates: skippedCount
                }
            });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message + ' | ' + (e.stack || '') });
        }
    })();
    `;
}

/**
 * Main entry: scrape comments từ 1 post URL.
 * @param {Object} params
 * @param {String} params.userId - ObjectId string
 * @param {Object} params.channel - Channel doc (Mongo) của FB account
 * @param {String} params.postUrl - URL post FB
 * @param {Number} params.maxComments - 0 = unlimited
 * @param {Number} params.maxDepth - giới hạn depth (giữ để tương thích)
 * @param {Function} params.onProgress - callback({ phase, scrapedCount, buttonsClicked, ... })
 * @returns {Object} { success, comments, tree, stats, postId, durationMs, error }
 */
async function scrapePostComments(params = {}) {
    const { userId, channel, postUrl } = params;
    const maxComments = parseInt(params.maxComments) || 0;
    // Mặc định: KHÔNG lấy reply — chỉ main comment
    const includeReplies = params.includeReplies === true;
    const skipPreviousUsers = params.skipPreviousUsers === true;
    const previousAuthors = Array.isArray(params.previousAuthors) ? params.previousAuthors : [];
    const onProgress = typeof params.onProgress === 'function' ? params.onProgress : () => {};
    const keepOpenMs = parseInt(params.keepOpenMs) || 5000;

    const startTime = Date.now();
    const cleanedUrl = cleanFbUrl(postUrl);
    const postId = extractPostId(cleanedUrl);

    if (!userId) return { success: false, error: 'Missing userId' };
    if (!channel) return { success: false, error: 'Missing channel' };
    if (!postUrl) return { success: false, error: 'Missing postUrl' };

    let context = null;
    let sessionKey = null;
    let createdNewSession = false;

    try {
        console.log('[Comment Crawler] ========== START ==========');
        console.log('[Comment Crawler] userId:', userId);
        console.log('[Comment Crawler] account:', channel.accountName);
        console.log('[Comment Crawler] postUrl:', postUrl);
        console.log('[Comment Crawler] maxComments:', maxComments || 'unlimited');

        onProgress({ phase: 'init', statusText: 'Đang mở browser...' });

        // Mở context FB — chạy ngầm (headless=true) mặc định, có thể bật visible qua param `visible`
        const decryptedStoragePath = channel.storageStatePath ? normalizeEncryptedValue(channel.storageStatePath) : '';
        const headless = params.visible !== true; // mặc định: headless (chạy ngầm)
        const ctx = await getOrOpenFacebookContext(
            userId,
            channel.accountName,
            channel.accountType || 'Cá nhân',
            'FB',
            { headless, existingSessionDir: decryptedStoragePath ? path.dirname(decryptedStoragePath) : '' }
        );
        context = ctx.context;
        sessionKey = ctx.sessionKey;
        createdNewSession = !ctx.reusedSession;
        console.log('[Comment Crawler] Context OK, reused:', ctx.reusedSession);

        const page = context.pages()[0] || await context.newPage();
        await page.bringToFront().catch(() => {});

        // Navigate tới post
        onProgress({ phase: 'navigate', statusText: 'Đang tải bài viết...' });
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => {
            console.log('[Comment Crawler] Goto warning:', e.message);
        });
        await wait(2500);

        // Tiêu đề post (best-effort)
        let postTitle = '';
        try {
            postTitle = await page.title();
        } catch (e) { /* skip */ }

        // Bước 1: Click "Phù hợp nhất" → "Tất cả bình luận" để mở modal chứa tất cả comments
        onProgress({ phase: 'open-sort', statusText: 'Đang click "Phù hợp nhất"...' });
        const sortOpened = await openAllCommentsViaSort(page);
        if (sortOpened) {
            console.log('[Comment Crawler] Đã click "Tất cả bình luận" qua sort dropdown');
        } else {
            console.log('[Comment Crawler] Không click được sort dropdown, thử cách cũ');
        }

        // Bước 2: Mở modal comment (fallback nếu sort dropdown không hoạt động)
        onProgress({ phase: 'open-modal', statusText: 'Đang mở comment modal...' });
        const opened = sortOpened || await openCommentModal(page);
        if (!opened) {
            // Fallback: comment có thể đã hiện sẵn ngoài feed, thử scrape trực tiếp
            console.log('[Comment Crawler] Không mở được modal, thử scrape trực tiếp ngoài feed...');
            onProgress({ phase: 'open-modal', statusText: 'Modal không mở — thử ngoài feed' });
        }
        await wait(2000);

        // ===== DEBUG MODE =====
        if (process.env.CRAWLER_DEBUG === 'true' || global.CRAWLER_DEBUG === true) {
            try {
                const debugInfo = await page.evaluate(() => {
                    const articles = document.querySelectorAll('[role="article"]');
                    const dialogs = document.querySelectorAll('[role="dialog"]');
                    const allDivs = document.querySelectorAll('div[aria-label*="Bình luận" i], div[aria-label*="Comment" i]');
                    const url = location.href;
                    return {
                        url,
                        title: document.title,
                        articleCount: articles.length,
                        dialogCount: dialogs.length,
                        commentBtnCount: allDivs.length,
                        articleLabels: Array.from(articles).slice(0, 5).map(a => a.getAttribute('aria-label')?.substring(0, 80)),
                        bodyHasCommentText: document.body.textContent.includes('Bình luận') || document.body.textContent.includes('Comment')
                    };
                });
                console.log('[Comment Crawler DEBUG]', JSON.stringify(debugInfo, null, 2));
                onProgress({ phase: 'debug', debug: debugInfo });
            } catch (e) {
                console.log('[Comment Crawler DEBUG] Failed:', e.message);
            }
        }

        // Inject maxComments cho script trong browser
        await page.evaluate((data) => {
            window.__scrapeMax = data.maxComments;
            window.__scrapeIncludeReplies = data.includeReplies;
            window.__scrapePreviousAuthors = data.previousAuthors || [];
        }, { maxComments, includeReplies, previousAuthors });

        // Đợi browser ready
        await wait(1000);

        // Pre-check: đếm articles trong dialog (nếu có) + articles ngoài
        try {
            const preCheck = await page.evaluate(() => {
                const dialogs = document.querySelectorAll('[role="dialog"]');
                let dialogArticles = 0;
                dialogs.forEach(d => { dialogArticles += d.querySelectorAll('[role="article"]').length; });
                const allArticles = document.querySelectorAll('[role="article"]').length;
                const allLabels = Array.from(document.querySelectorAll('[role="article"]'))
                    .map(a => a.getAttribute('aria-label') || '').filter(l => l);
                return {
                    dialogCount: dialogs.length,
                    dialogArticles,
                    allArticles,
                    sampleLabels: allLabels.slice(0, 10),
                    bodyHasFBContent: document.body.textContent.includes('Facebook') || document.body.textContent.includes('facebook'),
                    url: location.href
                };
            });
            console.log('[Comment Crawler PRE-CHECK]', JSON.stringify(preCheck, null, 2));
        } catch (e) {
            console.log('[Comment Crawler PRE-CHECK] failed:', e.message);
        }

        // Run script scrape chính
        onProgress({ phase: 'scraping', statusText: 'Đang expand + scrape...' });
        const scriptText = buildScrapeInBrowserScript();

        // Poll progress song song với việc chạy script (vì page.evaluate không emit event ra ngoài)
        let progressPoller = null;
        progressPoller = setInterval(async () => {
            try {
                const p = await page.evaluate(() => window.__scrapeProgress || null);
                if (p) onProgress({ ...p, phase: p.phase || 'scraping' });
            } catch (e) { /* skip */ }
        }, 1500);

        let rawResult;
        try {
            rawResult = await page.evaluate(scriptText);
        } finally {
            if (progressPoller) clearInterval(progressPoller);
        }

        // Post-check: dump __scrapeDebug từ browser
        try {
            const dbg = await page.evaluate(() => window.__scrapeDebug || null);
            if (dbg) {
                console.log('[Comment Crawler SCRAPE-DEBUG]', JSON.stringify(dbg, null, 2));
            }
        } catch (e) { /* skip */ }

        const result = JSON.parse(rawResult);
        const durationMs = Date.now() - startTime;

        if (!result.success) {
            console.log('[Comment Crawler] Scrape failed:', result.error);
            onProgress({ phase: 'failed', error: result.error });
            return { success: false, error: result.error, postId, durationMs };
        }

        console.log('[Comment Crawler] OK:', result.stats);
        onProgress({
            phase: 'success',
            statusText: 'Xong!',
            ...result.stats
        });

        return {
            success: true,
            postId,
            postTitle,
            comments: result.comments,
            tree: result.tree,
            stats: { ...result.stats, durationMs },
            durationMs
        };
    } catch (e) {
        console.error('[Comment Crawler] FATAL:', e.message);
        console.error('[Comment Crawler] stack:', e.stack);
        onProgress({ phase: 'failed', error: e.message });
        return { success: false, error: e.message, postId, durationMs: Date.now() - startTime };
    } finally {
        // Tự đóng context sau khi scrape xong (giống các service khác trong hệ thống)
        try {
            if (context && !context.isClosed()) {
                if (keepOpenMs > 0) {
                    console.log('[Comment Crawler] Giữ browser mở thêm ' + keepOpenMs + 'ms...');
                    await wait(keepOpenMs);
                }
                await context.close();
                if (sessionKey) ACTIVE_FB_SESSIONS.delete(sessionKey);
                console.log('[Comment Crawler] Đã đóng context, cleanup xong');
            }
        } catch (e) {
            console.log('[Comment Crawler] Lỗi khi đóng context:', e.message);
        }
        const m = Date.now() - startTime;
        console.log('[Comment Crawler] ========== END (' + Math.round(m / 1000) + 's) ==========');
    }
}

module.exports = {
    scrapePostComments,
    extractPostId,
    cleanFbUrl
};
