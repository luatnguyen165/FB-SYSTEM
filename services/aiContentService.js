// services/aiContentService.js
const axios = require('axios');
const WritingStyle = require('../models/WritingStyle');
const AiContentSchedule = require('../models/AiContentSchedule');
const AiGeneratedPost = require('../models/AiGeneratedPost');
const ContentTrainingLog = require('../models/ContentTrainingLog');
const SchedulePost = require('../models/SchedulePost');
const Channel = require('../models/Channel');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Gọi AI API với hỗ trợ đa provider (OpenAI, OpenAI Compatible, Anthropic)
 */
async function callAI(messages, options = {}) {
    const provider = options.provider || 'openai';
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Chưa cấu hình API Key cho AI provider.');

    try {
        if (provider === 'anthropic') {
            // Anthropic API
            const model = options.model || 'claude-3-haiku-20240307';
            // Chuyển đổi messages từ format OpenAI sang Anthropic
            let systemMsg = '';
            const anthropicMessages = [];
            for (const msg of messages) {
                if (msg.role === 'system') {
                    systemMsg += (systemMsg ? '\n' : '') + msg.content;
                } else {
                    anthropicMessages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    });
                }
            }
            const requestBody = {
                model,
                max_tokens: options.maxTokens || 2000,
                messages: anthropicMessages
            };
            if (systemMsg) {
                requestBody.system = systemMsg;
            }
            if (options.temperature !== undefined) {
                requestBody.temperature = options.temperature;
            }
            const response = await axios.post(ANTHROPIC_API_URL, requestBody, {
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                },
                timeout: 60000,
            });
            return response.data?.content?.[0]?.text || '';
        } else if (provider === 'openai-compatible') {
            // OpenAI Compatible (e.g., Groq, Together, v.v.)
            const baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
            const response = await axios.post(`${baseUrl}/chat/completions`, {
                model: options.model || 'gpt-3.5-turbo',
                messages,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 2000,
            }, {
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 60000,
            });
            return response.data?.choices?.[0]?.message?.content || '';
        } else {
            // Default: OpenAI
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: options.model || 'gpt-4o-mini',
                messages,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 2000,
            }, {
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                timeout: 60000,
            });
            return response.data?.choices?.[0]?.message?.content || '';
        }
    } catch (err) {
        handleAIError(err);
    }
}

/**
 * Kiểm tra và throw lỗi chi tiết cho các lỗi từ AI API
 */
function handleAIError(err) {
    if (err.response?.status === 401) {
        throw new Error('API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại API key trong Cài đặt.');
    }
    if (err.response?.status === 429) {
        throw new Error('Đã vượt quá giới hạn API (rate limit). Vui lòng thử lại sau ít phút.');
    }
    if (err.response?.status === 403) {
        throw new Error('API Key không có quyền truy cập model này. Vui lòng kiểm tra quyền hạn của API key.');
    }
    throw err;
}

// Hàm kiểm tra API key hợp lệ
function isValidApiKey(key) {
    return key && key.trim() && key.trim().startsWith('sk-') && key.trim().length > 10;
}

/**
 * Phân tích văn phong từ bài viết mẫu
 */
async function analyzeWritingStyle(userId, articles, apiKey, options = {}) {
    const articlesText = articles.map((a, i) =>
        `--- Bài ${i + 1}: ${a.title || '(Không tiêu đề)'} ---\n${a.content}`
    ).join('\n\n');

    const systemPrompt = `Bạn là chuyên gia phân tích văn phong viết lách. 
Phân tích kỹ lưỡng văn phong từ các bài viết được cung cấp.
Trả về kết quả dưới dạng JSON hợp lệ, KHÔNG có markdown code block.`;

    const userPrompt = `Hãy phân tích văn phong của các bài viết sau:

${articlesText}

Trả về JSON với cấu trúc:
{
  "tone": "Mô tả giọng văn (VD: Thân mật, gần gũi, có sức hút)",
  "vocabulary": "Đặc điểm từ ngữ thường dùng (VD: Dùng từ ngữ đời thường, gần gũi, có dùng từ lóng)",
  "sentenceStructure": "Cấu trúc câu thường thấy (VD: Câu ngắn gọn, dùng nhiều câu cảm thán)",
  "keywords": ["từ khóa 1", "từ khóa 2", "từ khóa 3"],
  "avgLength": 300,
  "summary": "Tóm tắt toàn bộ văn phong trong 2-3 câu"
}`;

    const raw = await callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ], { apiKey, temperature: 0.3, provider: options.provider || 'openai', model: options.model || 'gpt-4o-mini', baseUrl: options.baseUrl });

    // Parse JSON
    try {
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
            tone: parsed.tone || '',
            vocabulary: parsed.vocabulary || '',
            sentenceStructure: parsed.sentenceStructure || '',
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
            avgLength: parseInt(parsed.avgLength) || 300,
            summary: parsed.summary || '',
            rawAnalysis: raw,
        };
    } catch (e) {
        // Nếu parse fail, trả về raw
        return {
            tone: '',
            vocabulary: '',
            sentenceStructure: '',
            keywords: [],
            avgLength: 300,
            summary: raw.substring(0, 500),
            rawAnalysis: raw,
        };
    }
}

/**
 * Tạo bài viết mới theo văn phong đã phân tích
 */
async function generatePost(writingStyle, topic, contentConfig = {}, apiKey, options = {}) {
    const { styleAnalysis } = writingStyle;
    const minWords = contentConfig.minWords || 200;
    const maxWords = contentConfig.maxWords || 500;
    const customInstructions = contentConfig.customInstructions || '';
    const language = contentConfig.language === 'en' ? 'English' : 'Tiếng Việt';

    const systemPrompt = `Bạn là chuyên gia tạo nội dung marketing trên mạng xã hội.
Bạn phải viết bài THỰC SỰ theo đúng văn phong được mô tả.
KHÔNG được viết chung chung, phải có chiều sâu và thu hút người đọc.
Bài viết phải có tiêu đề và nội dung.`;

    const userPrompt = `Viết một bài viết trên mạng xã hội với các yêu cầu sau:

📌 CHỦ ĐỀ: ${topic}

✍️ VĂN PHONG CẦN THEO:
- Giọng văn: ${styleAnalysis.tone || 'Thân mật, gần gũi'}
- Từ ngữ: ${styleAnalysis.vocabulary || 'Dùng từ đời thường'}
- Cấu trúc câu: ${styleAnalysis.sentenceStructure || 'Câu ngắn gọn'}
- Từ khóa nên dùng: ${(styleAnalysis.keywords || []).join(', ')}
- Độ dài: ${minWords}-${maxWords} từ
- Ngôn ngữ: ${language}
${customInstructions ? `\n📌 HƯỚNG DẪN THÊM:\n${customInstructions}` : ''}

Hãy viết bài viết với format:
TIÊU ĐỀ: [Tiêu đề bài viết]

NỘI DUNG:
[Nội dung bài viết]`;

    const raw = await callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ], { apiKey, temperature: 0.8, maxTokens: 2000, provider: options.provider || 'openai', model: options.model || 'gpt-4o-mini', baseUrl: options.baseUrl });

    // Parse tiêu đề và nội dung
    let title = '';
    let content = raw;

    const titleMatch = raw.match(/TIÊU ĐỀ:\s*(.+)/i);
    if (titleMatch) {
        title = titleMatch[1].trim();
        const contentStart = raw.indexOf('NỘI DUNG:');
        content = contentStart >= 0 ? raw.substring(contentStart + 10).trim() : raw.replace(titleMatch[0], '').trim();
    } else {
        // Thử tách dòng đầu làm title
        const lines = raw.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
            title = lines[0].replace(/^#+\s*/, '').trim();
            content = lines.slice(1).join('\n').trim();
        }
    }

    return { title, content, rawPrompt: raw };
}

/**
 * Tạo lịch trình bài viết theo schedule config
 * Tính toán thời gian đăng cho từng bài
 */
function calculateScheduleSlots(schedule, topicIndex) {
    const slots = [];
    const { dateRange, timeSlots, contentConfig } = schedule;
    const topics = contentConfig.topics || ['Chung'];

    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate);

    // Duyệt từng ngày trong khoảng
    const current = new Date(start);
    while (current <= end) {
        // Với mỗi time slot trong ngày
        for (const slot of timeSlots) {
            const scheduledAt = new Date(current);
            scheduledAt.setHours(slot.hour, slot.minute, 0, 0);

            if (scheduledAt > new Date()) {
                slots.push({
                    scheduledAt: new Date(scheduledAt),
                    platforms: slot.platforms,
                    accountIds: slot.accountIds,
                    topic: topics[topicIndex % topics.length],
                    postType: slot.postType || 'personal',
                    groupIds: slot.groupIds || [],
                });
                topicIndex++;
            }
        }
        current.setDate(current.getDate() + 1);
    }

    return slots;
}

/**
 * Tạo bài viết theo schedule và lưu vào DB
 * Trả về số bài đã tạo
 */
async function generatePostsForSchedule(scheduleId, apiKey, options = {}) {
    const schedule = await AiContentSchedule.findById(scheduleId)
        .populate('writingStyleId')
        .lean();

    if (!schedule) throw new Error('Không tìm thấy lịch');
    if (schedule.status !== 'active') throw new Error('Lịch không ở trạng thái active');

    const writingStyle = await WritingStyle.findById(schedule.writingStyleId._id || schedule.writingStyleId).lean();
    if (!writingStyle) throw new Error('Không tìm thấy văn phong mẫu');
    if (!writingStyle.styleAnalysis?.summary && !writingStyle.styleAnalysis?.tone) {
        throw new Error('Văn phong chưa được phân tích. Vui lòng phân tích lại.');
    }

    // Tính số bài cần tạo:Slots có scheduledAt > now
    const slots = calculateScheduleSlots(schedule, schedule.postsGenerated || 0);

    if (slots.length === 0) {
        // Hết slot → đánh dấu completed
        await AiContentSchedule.findByIdAndUpdate(scheduleId, { status: 'completed' });
        return 0;
    }

    let created = 0;
    for (const slot of slots) {
        try {
            const { title, content, rawPrompt } = await generatePost(
                writingStyle,
                slot.topic,
                schedule.contentConfig,
                apiKey,
                options
            );

            // Tạo AiGeneratedPost
            const generatedPost = await AiGeneratedPost.create({
                userId: schedule.userId,
                scheduleId: schedule._id,
                title,
                content,
                platforms: slot.platforms,
                accounts: slot.accountIds,
                scheduledAt: slot.scheduledAt,
                status: 'pending',
                aiModel: 'gpt-4o-mini',
                aiPrompt: rawPrompt,
            });

            // Tạo SchedulePost tương ứng
            const selectedAccountId = slot.accountIds?.[0];
            const schedulePostObj = {
                userId: schedule.userId,
                type: 'post',
                caption: content,
                images: [],
                platforms: slot.platforms,
                accounts: slot.accountIds.map(id => String(id)),
                scheduledAt: slot.scheduledAt,
                status: 'pending',
            };

            // Nếu đăng vào nhóm, gắn group info
            if (slot.postType === 'group' && slot.groupIds?.length > 0) {
                schedulePostObj.targetGroupSourceChannelId = selectedAccountId;
                schedulePostObj.targetGroupIds = slot.groupIds;
            }

            const schedulePost = await SchedulePost.create(schedulePostObj);

            // Link lại
            await AiGeneratedPost.findByIdAndUpdate(generatedPost._id, {
                schedulePostId: schedulePost._id,
            });

            created++;
        } catch (err) {
            console.error(`[AI Content] Lỗi tạo bài: ${err.message}`);
        }
    }

    // Cập nhật schedule
    await AiContentSchedule.findByIdAndUpdate(scheduleId, {
        postsGenerated: (schedule.postsGenerated || 0) + created,
        lastGeneratedAt: new Date(),
        updatedAt: new Date(),
    });

    return created;
}

/**
 * Xử lý tất cả schedule active: tạo bài cho các schedule đến hạn
 */
async function processActiveSchedules(apiKey, options = {}) {
    const now = new Date();
    const activeSchedules = await AiContentSchedule.find({
        status: 'active',
        'dateRange.endDate': { $gte: now },
    }).lean();

    let totalGenerated = 0;
    for (const schedule of activeSchedules) {
        try {
            // Chỉ tạo bài nếu startDate đã tới
            if (new Date(schedule.dateRange.startDate) <= now) {
                const count = await generatePostsForSchedule(schedule._id, apiKey, options);
                totalGenerated += count;
            }
        } catch (err) {
            console.error(`[AI Content Scheduler] Lỗi schedule ${schedule._id}: ${err.message}`);
        }
    }
    return totalGenerated;
}

/**
 * Tạo chủ đề hot dựa trên văn phong
 */
async function generateTopics(userId, writingStyleId, apiKey, options = {}) {
    let styleAnalysis = '';
    let existingTopics = [];

    if (writingStyleId) {
        const style = await WritingStyle.findOne({ _id: writingStyleId, userId });
        if (style && style.styleAnalysis) {
            styleAnalysis = `
Tone: ${style.styleAnalysis.tone || 'N/A'}
Từ vựng: ${style.styleAnalysis.vocabulary || 'N/A'}
Cấu trúc câu: ${style.styleAnalysis.sentenceStructure || 'N/A'}
Từ khóa thường dùng: ${(style.styleAnalysis.keywords || []).join(', ')}
Tóm tắt văn phong: ${style.styleAnalysis.summary || 'N/A'}`;
        }
        if (style && style.topics && style.topics.length) {
            existingTopics = style.topics;
        }
    }

    const systemPrompt = `Bạn là chuyên gia marketing nội dung trên mạng xã hội.
Nhiệm vụ: Tạo danh sách các CHỦ ĐỀ HOT, THÚ VỊ, thu hút người dùng mạng xã hội.
Mỗi chủ đề phải ngắn gọn (1 dòng), thực tế, và có khả năng tạo tương tác cao.
KHÔNG lặp lại các chủ đề đã có.
Trả về kết quả dạng JSON, KHÔNG có markdown code block.`;

    const userPrompt = `${styleAnalysis ? `Văn phong cần viết:\n${styleAnalysis}\n` : ''}
${existingTopics.length ? `Các chủ đề đã có (KHÔNG lặp lại):\n${existingTopics.join(', ')}\n` : ''}
Hãy tạo 10-15 chủ đề hot, thú vị phù hợp với văn phong trên.
Mỗi chủ đề nên ngắn gọn, dễ hiểu, phù hợp đăng lên mạng xã hội (Facebook, TikTok, Instagram).

Trả về JSON:
{
  "topics": ["Chủ đề 1", "Chủ đề 2", ...]
}`;

    const raw = await callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ], { apiKey, temperature: 0.8, maxTokens: 1000, provider: options.provider || 'openai', model: options.model || 'gpt-4o-mini', baseUrl: options.baseUrl });

    try {
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return Array.isArray(parsed.topics) ? parsed.topics : [];
    } catch (e) {
        const lines = raw.split('\n').filter(l => l.trim().match(/^\d+[\.\)\-]\s/));
        if (lines.length) {
            return lines.map(l => l.replace(/^\d+[\.\)\-]\s*/, '').trim()).filter(Boolean);
        }
        throw new Error('Không thể parse kết quả từ AI. Vui lòng thử lại.');
    }
}

/**
 * Đánh giá bài viết đã đăng (lấy engagement data)
 * Tính điểm: likes + comments*2 + shares*3
 */
async function evaluatePostPerformance(userId, writingStyleId) {
    const posts = await AiGeneratedPost.find({
        userId,
        status: 'posted',
        publishedAt: { $exists: true, $ne: null },
    }).sort({ publishedAt: -1 }).limit(50).lean();

    if (!posts.length) return [];

    // Tính điểm cho mỗi bài
    const scored = posts.map(post => {
        const likes = post.engagement?.likes || 0;
        const comments = post.engagement?.comments || 0;
        const shares = post.engagement?.shares || 0;
        const score = likes + comments * 2 + shares * 3;
        return { ...post, score, likes, comments, shares };
    }).sort((a, b) => b.score - a.score);

    return scored;
}

/**
 * Train lại văn phong từ top bài viết tốt nhất
 * Gọi AI phân tích lại style dựa trên bài tốt
 */
async function retrainFromBestPosts(userId, writingStyleId, apiKey, options = {}) {
    const style = await WritingStyle.findOne({ _id: writingStyleId, userId });
    if (!style) throw new Error('Không tìm thấy văn phong');

    // Lấy bài viết đã đăng
    const scoredPosts = await evaluatePostPerformance(userId, writingStyleId);
    if (!scoredPosts.length) {
        throw new Error('Chưa có bài viết nào đã đăng. Cần có bài viết đã đăng để train lại.');
    }

    // Lấy top 5 bài tốt nhất
    const topPosts = scoredPosts.slice(0, 5);

    // Tạo text cho AI phân tích
    const postsText = topPosts.map((p, i) =>
        `--- Bài ${i + 1} (Điểm: ${p.score}, Likes: ${p.likes}, Comments: ${p.comments}, Shares: ${p.shares}) ---\nTiêu đề: ${p.title || '(Không tiêu đề)'}\nNội dung: ${p.content}`
    ).join('\n\n');

    const existingAnalysis = style.styleAnalysis || {};
    const existingStyle = `
Tone hiện tại: ${existingAnalysis.tone || 'N/A'}
Từ vựng: ${existingAnalysis.vocabulary || 'N/A'}
Cấu trúc câu: ${existingAnalysis.sentenceStructure || 'N/A'}
Từ khóa: ${(existingAnalysis.keywords || []).join(', ')}
Công thức viết: ${(existingAnalysis.writingFormulas || []).join(', ')}`;

    const systemPrompt = `Bạn là chuyên gia phân tích văn phong viết lách.
Nhiệm vụ: Phân tích các bài viết có hiệu quả cao nhất (nhiều like, comment, share) và so sánh với văn phong hiện tại.
Từ đó, đưa ra phân tích văn phong CẬP NHẬT, tốt hơn.
Trả về JSON hợp lệ, KHÔNG có markdown code block.`;

    const userPrompt = `Văn phong hiện tại:
${existingStyle}

Các bài viết có hiệu quả cao nhất (đã đăng và được tương tác nhiều):
${postsText}

Hãy phân tích và đưa ra văn phong CẬP NHẬT dựa trên các bài viết tốt nhất này.
Trả về JSON với cấu trúc:
{
  "tone": "Giọng văn cập nhật",
  "vocabulary": "Từ ngữ đặc trưng cập nhật",
  "sentenceStructure": "Cấu trúc câu cập nhật",
  "keywords": ["từ khóa 1", "từ khóa 2"],
  "hookPatterns": ["Mẫu mở đầu 1", "Mẫu mở đầu 2"],
  "ctaPatterns": ["Mẫu kêu gọi 1", "Mẫu kêu gọi 2"],
  "emojiPatterns": "Quy tắc dùng emoji",
  "writingFormulas": ["Công thức 1", "Công thức 2"],
  "summary": "Tóm tắt văn phong cập nhật trong 2-3 câu"
}`;

    const raw = await callAI([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ], { apiKey, temperature: 0.3, provider: options.provider || 'openai', model: options.model || 'gpt-4o-mini', baseUrl: options.baseUrl });

    // Parse kết quả
    let analysis = {};
    try {
        const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        analysis = JSON.parse(cleaned);
    } catch (e) {
        throw new Error('Không thể parse kết quả từ AI. Vui lòng thử lại.');
    }

    // Cập nhật WritingStyle
    const newVersion = (style.trainingVersion || 0) + 1;
    const bestExamples = topPosts.map(p => ({
        postId: p._id,
        score: p.score,
        reasons: [
            `${p.likes} likes`,
            `${p.comments} comments`,
            `${p.shares} shares`,
        ],
    }));

    await WritingStyle.findByIdAndUpdate(writingStyleId, {
        styleAnalysis: {
            tone: analysis.tone || existingAnalysis.tone || '',
            vocabulary: analysis.vocabulary || existingAnalysis.vocabulary || '',
            sentenceStructure: analysis.sentenceStructure || existingAnalysis.sentenceStructure || '',
            keywords: Array.isArray(analysis.keywords) ? analysis.keywords : existingAnalysis.keywords || [],
            avgLength: existingAnalysis.avgLength || 300,
            summary: analysis.summary || existingAnalysis.summary || '',
            rawAnalysis: raw,
            hookPatterns: Array.isArray(analysis.hookPatterns) ? analysis.hookPatterns : existingAnalysis.hookPatterns || [],
            ctaPatterns: Array.isArray(analysis.ctaPatterns) ? analysis.ctaPatterns : existingAnalysis.ctaPatterns || [],
            emojiPatterns: analysis.emojiPatterns || existingAnalysis.emojiPatterns || '',
            writingFormulas: Array.isArray(analysis.writingFormulas) ? analysis.writingFormulas : existingAnalysis.writingFormulas || [],
            bestExamples,
        },
        trainingVersion: newVersion,
        lastTrainedAt: new Date(),
        updatedAt: new Date(),
    });

    // Tạo training log
    await ContentTrainingLog.create({
        userId,
        writingStyleId,
        version: newVersion,
        type: 'retrain',
        topPosts: topPosts.map(p => ({
            postId: p._id,
            title: p.title || '',
            content: (p.content || '').substring(0, 500),
            score: p.score,
            likes: p.likes,
            comments: p.comments,
            shares: p.shares,
            platform: (p.platforms || [])[0] || '',
        })),
        analysis: {
            tone: analysis.tone || '',
            vocabulary: analysis.vocabulary || '',
            sentenceStructure: analysis.sentenceStructure || '',
            keywords: Array.isArray(analysis.keywords) ? analysis.keywords : [],
            hookPatterns: Array.isArray(analysis.hookPatterns) ? analysis.hookPatterns : [],
            ctaPatterns: Array.isArray(analysis.ctaPatterns) ? analysis.ctaPatterns : [],
            emojiPatterns: analysis.emojiPatterns || '',
            writingFormulas: Array.isArray(analysis.writingFormulas) ? analysis.writingFormulas : [],
            summary: analysis.summary || '',
        },
        postsEvaluated: scoredPosts.length,
        avgScore: scoredPosts.length ? Math.round(scoredPosts.reduce((s, p) => s + p.score, 0) / scoredPosts.length) : 0,
        topScore: topPosts[0]?.score || 0,
    });

    return {
        version: newVersion,
        topPosts: topPosts.length,
        avgScore: scoredPosts.length ? Math.round(scoredPosts.reduce((s, p) => s + p.score, 0) / scoredPosts.length) : 0,
        topScore: topPosts[0]?.score || 0,
    };
}

/**
 * Tự động train lại: kiểm tra bài mới → train nếu đủ data
 */
async function autoRetrainLoop(apiKey) {
    const styles = await WritingStyle.find({
        trainingVersion: { $gt: 0 },
        lastTrainedAt: { $exists: true, $ne: null },
    }).lean();

    let retrained = 0;
    for (const style of styles) {
        try {
            // Chỉ train lại nếu có bài mới (sau lần train cuối)
            const newPosts = await AiGeneratedPost.countDocuments({
                userId: style.userId,
                status: 'posted',
                publishedAt: { $gt: style.lastTrainedAt },
            });

            if (newPosts >= 3) {
                await retrainFromBestPosts(style.userId, style._id, apiKey);
                retrained++;
                console.log(`[AI Content] Đã train lại văn phong ${style.name} (v${(style.trainingVersion || 0) + 1})`);
            }
        } catch (err) {
            console.error(`[AI Content] Lỗi train lại ${style._id}: ${err.message}`);
        }
    }
    return retrained;
}

/**
 * Lấy thống kê training
 */
async function getTrainingStats(userId, writingStyleId) {
    const style = await WritingStyle.findOne({ _id: writingStyleId, userId }).lean();
    if (!style) return null;

    const logs = await ContentTrainingLog.find({ userId, writingStyleId })
        .sort({ version: -1 })
        .limit(10)
        .lean();

    const totalPosts = await AiGeneratedPost.countDocuments({ userId, status: 'posted' });
    const totalGenerated = await AiGeneratedPost.countDocuments({ userId });

    return {
        trainingVersion: style.trainingVersion || 0,
        lastTrainedAt: style.lastTrainedAt,
        totalPosts,
        totalGenerated,
        logs,
        bestExamples: style.styleAnalysis?.bestExamples || [],
    };
}

module.exports = {
    callAI,
    analyzeWritingStyle,
    generatePost,
    generateTopics,
    calculateScheduleSlots,
    generatePostsForSchedule,
    processActiveSchedules,
    evaluatePostPerformance,
    retrainFromBestPosts,
    autoRetrainLoop,
    getTrainingStats,
    isValidApiKey,
};
