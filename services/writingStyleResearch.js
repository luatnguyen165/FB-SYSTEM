// services/writingStyleResearch.js
const WritingStyle = require('../models/WritingStyle');
const { crawlGroupPosts } = require('./aiScan/crawler');
const { callAI } = require('./aiContentService');
const { getOrOpenSocialContext } = require('./socialPlaywrightService');
const { parseAIJsonResponse } = require('../utils/aiResponse');

/**
 * Crawl bài viết từ Facebook group
 */
async function crawlFromGroup(userId, groupUrl, accountName, maxPosts = 20) {
    console.log(`[Research] Crawl from group: ${groupUrl}, max: ${maxPosts}`);

    let context;
    try {
        // Mở browser context
        const result = await getOrOpenSocialContext(userId, accountName, 'Cá nhân', 'FB', { headless: true });
        context = result.context;
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();

        // Crawl posts
        const posts = await crawlGroupPosts(page, groupUrl, maxPosts, 30); // 30 ngày gần nhất

        console.log(`[Research] Crawled ${posts.length} posts from group`);
        return posts;
    } catch (err) {
        console.error(`[Research] Crawl group error: ${err.message}`);
        return [];
    }
}

/**
 * Crawl bài viết từ Facebook profile (đối thủ)
 */
async function crawlFromProfile(userId, profileUrl, accountName, maxPosts = 20) {
    console.log(`[Research] Crawl from profile: ${profileUrl}, max: ${maxPosts}`);

    let context;
    try {
        const result = await getOrOpenSocialContext(userId, accountName, 'Cá nhân', 'FB', { headless: true });
        context = result.context;
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();

        // Vào trang profile
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);

        // Scroll để load bài viết
        const posts = [];
        let scrollAttempts = 0;
        while (posts.length < maxPosts && scrollAttempts < 15) {
            scrollAttempts++;
            const newPosts = await page.evaluate(() => {
                const articles = Array.from(document.querySelectorAll('div[role="article"]'));
                return articles.map(article => {
                    const textEl = article.querySelector('div[data-ad-preview="message"], div.xdj266r.x11i5rnm.xat24cr.x1mh8g0r, span.x193iq5w');
                    const content = textEl ? textEl.innerText.trim() : article.innerText.trim().substring(0, 1000);
                    return { content };
                }).filter(p => p.content.length > 20);
            });

            for (const p of newPosts) {
                if (posts.length >= maxPosts) break;
                if (!posts.find(x => x.content === p.content)) {
                    posts.push(p);
                }
            }

            await page.mouse.wheel(0, 800);
            await page.waitForTimeout(1500);
        }

        console.log(`[Research] Crawled ${posts.length} posts from profile`);
        return posts;
    } catch (err) {
        console.error(`[Research] Crawl profile error: ${err.message}`);
        return [];
    }
}

/**
 * Phân tích văn phong từ bài viết đã crawl
 */
async function analyzeStyleFromPosts(posts, apiKey, options = {}) {
    if (!posts || posts.length === 0) {
        throw new Error('Không có bài viết nào để phân tích');
    }

    // Lấy tối đa 15 bài viết có nội dung dài nhất
    const sortedPosts = posts
        .filter(p => p.content && p.content.length > 30)
        .sort((a, b) => b.content.length - a.content.length)
        .slice(0, 15);

    if (sortedPosts.length === 0) {
        throw new Error('Không có bài viết nào đủ dài để phân tích');
    }

    const articlesText = sortedPosts.map((p, i) =>
        `--- Bài ${i + 1} ---\n${p.content.substring(0, 800)}`
    ).join('\n\n');

    const systemPrompt = `Bạn là chuyên gia phân tích văn phong viết lách trên mạng xã hội.
Phân tích kỹ lưỡng văn phong từ các bài viết được cung cấp.
Tập trung vào: câu mở đầu (hook), cách kể chuyện, từ ngữ đặc trưng, cấu trúc bài, kêu gọi hành động (CTA).
Trả về JSON hợp lệ, KHÔNG có markdown code block.`;

    const userPrompt = `Phân tích văn phong của các bài viết sau:

${articlesText}

Trả về JSON:
{
  "tone": "Giọng văn (VD: Thân mật, kể chuyện, chuyên nghiệp)",
  "vocabulary": "Đặc điểm từ ngữ thường dùng",
  "sentenceStructure": "Cấu trúc câu (ngắn/dài, dùng emoji...)",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"],
  "hookPatterns": ["Mẫu câu mở đầu 1", "Mẫu câu mở đầu 2"],
  "ctaPatterns": ["Mẫu kêu gọi hành động 1", "Mẫu kêu gọi hành động 2"],
  "writingFormulas": ["Công thức viết 1 (VD: Hook → Story → CTA)", "Công thức viết 2"],
  "emojiPatterns": "Cách dùng emoji (VD: nhiều emoji, ít emoji, emoji đầu dòng)",
  "avgLength": 300,
  "summary": "Tóm tắt văn phong trong 2-3 câu"
}`;

    const raw = await callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ], {
        apiKey,
        temperature: 0.3,
        maxTokens: 2000,
        provider: options.provider || 'openai',
        model: options.model || 'gpt-4o-mini',
        baseUrl: options.baseUrl,
    });

    try {
        const parsed = parseAIJsonResponse(raw) || {};
        return {
            tone: parsed.tone || '',
            vocabulary: parsed.vocabulary || '',
            sentenceStructure: parsed.sentenceStructure || '',
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
            hookPatterns: Array.isArray(parsed.hookPatterns) ? parsed.hookPatterns : [],
            ctaPatterns: Array.isArray(parsed.ctaPatterns) ? parsed.ctaPatterns : [],
            writingFormulas: Array.isArray(parsed.writingFormulas) ? parsed.writingFormulas : [],
            emojiPatterns: parsed.emojiPatterns || '',
            avgLength: parseInt(parsed.avgLength) || 300,
            summary: parsed.summary || '',
            rawAnalysis: raw,
        };
    } catch (e) {
        return {
            tone: '', vocabulary: '', sentenceStructure: '',
            keywords: [], hookPatterns: [], ctaPatterns: [],
            writingFormulas: [], emojiPatterns: '',
            avgLength: 300, summary: raw.substring(0, 500), rawAnalysis: raw,
        };
    }
}

/**
 * Research & tạo WritingStyle từ group hoặc đối thủ
 * @param {Object} options
 * @param {string} options.userId
 * @param {string} options.type - 'group' | 'profile'
 * @param {string} options.url - URL group hoặc profile
 * @param {string} options.accountName - Tên tài khoản FB để crawl
 * @param {string} options.styleName - Tên văn phong mới
 * @param {number} options.maxPosts - Số bài crawl tối đa
 * @param {string} options.apiKey
 * @param {Object} options.aiConfig
 * @returns {Object} WritingStyle đã tạo
 */
async function researchAndCreateStyle({ userId, type, url, accountName, styleName, maxPosts = 20, apiKey, aiConfig = {} }) {
    console.log(`[Research] Bắt đầu research: type=${type} url=${url}`);

    // Step 1: Crawl posts
    let posts = [];
    if (type === 'group') {
        posts = await crawlFromGroup(userId, url, accountName, maxPosts);
    } else if (type === 'profile') {
        posts = await crawlFromProfile(userId, url, accountName, maxPosts);
    } else {
        throw new Error('Loại nguồn không hợp lệ: ' + type);
    }

    if (posts.length === 0) {
        throw new Error('Không crawl được bài viết nào. Kiểm tra URL và tài khoản Facebook.');
    }

    console.log(`[Research] Đã crawl ${posts.length} bài, bắt đầu phân tích...`);

    // Step 2: Analyze writing style
    const analysis = await analyzeStyleFromPosts(posts, apiKey, aiConfig);

    console.log(`[Research] Phân tích xong: tone="${analysis.tone}"`);

    // Step 3: Tạo WritingStyle
    const style = await WritingStyle.create({
        userId,
        name: styleName || `Văn phong từ ${type === 'group' ? 'Group' : 'Đối thủ'} (${new Date().toLocaleDateString('vi-VN')})`,
        sampleArticles: posts.slice(0, 10).map(p => ({
            title: '',
            content: p.content.substring(0, 2000),
            category: type === 'group' ? 'group' : 'competitor',
        })),
        styleAnalysis: {
            tone: analysis.tone,
            vocabulary: analysis.vocabulary,
            sentenceStructure: analysis.sentenceStructure,
            keywords: analysis.keywords,
            avgLength: analysis.avgLength,
            summary: analysis.summary,
            rawAnalysis: analysis.rawAnalysis,
            hookPatterns: analysis.hookPatterns,
            ctaPatterns: analysis.ctaPatterns,
            emojiPatterns: analysis.emojiPatterns,
            writingFormulas: analysis.writingFormulas,
        },
        topics: [],
    });

    console.log(`[Research] Đã tạo WritingStyle: ${style._id} - "${style.name}"`);

    return {
        style,
        postsCount: posts.length,
        analysis,
    };
}

module.exports = {
    crawlFromGroup,
    crawlFromProfile,
    analyzeStyleFromPosts,
    researchAndCreateStyle,
};
