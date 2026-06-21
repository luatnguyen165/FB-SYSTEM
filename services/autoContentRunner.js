// services/autoContentRunner.js
const AutoContentPipeline = require('../models/AutoContentPipeline');
const Product = require('../models/Product');
const WritingStyle = require('../models/WritingStyle');
const SchedulePost = require('../models/SchedulePost');
const AiGeneratedPost = require('../models/AiGeneratedPost');
const { callAI } = require('./aiContentService');
const { getUserApiConfig } = require('../utils/aiConfig');
const { parseAIJsonResponse } = require('../utils/aiResponse');

const CHECK_INTERVAL_MS = 60 * 1000;
let isWorkerStarted = false;
let isProcessing = false;          // Re-entrant guard
let timer = null;
let firstRunTimer = null;

/**
 * Chọn topic dựa trên learning data và slot index
 */
function selectTopic(pipeline, slotIndex) {
    const learning = pipeline.learningData || {};
    const product = pipeline.productId;

    // Ưu tiên topic từ learning data
    if (learning.bestTopics && learning.bestTopics.length > 0) {
        return learning.bestTopics[slotIndex % learning.bestTopics.length];
    }

    // Fallback: dùng tên sản phẩm + category
    if (product) {
        const topics = [
            product.name,
            `${product.category} ${product.name}`,
            `review ${product.name}`,
            `so sánh ${product.name}`,
            `ưu điểm ${product.name}`,
        ];
        return topics[slotIndex % topics.length];
    }

    return 'Chung';
}

/**
 * Chọn hook tốt nhất từ learning data
 */
function selectHook(pipeline) {
    const hooks = pipeline.learningData?.bestHooks || [];
    if (hooks.length === 0) return null;
    return hooks[Math.floor(Math.random() * hooks.length)];
}

/**
 * Chọn strategy cho từng slot
 */
function selectStrategy(slotIndex, postsPerDay) {
    const strategies = [
        { name: 'trend_hook', desc: 'Hook trending + gắn sản phẩm' },
        { name: 'pain_solution', desc: 'Giải quyết pain point + sản phẩm' },
        { name: 'social_proof', desc: 'Review/testimonial sản phẩm' },
        { name: 'story_telling', desc: 'Kể chuyện thương hiệu' },
        { name: 'educational', desc: 'Chia sẻ kiến thức + sản phẩm' },
    ];
    return strategies[slotIndex % strategies.length];
}

/**
 * Gather insights từ research sources (đơn giản hóa)
 */
async function gatherInsights(researchSources) {
    const insights = {
        trendingTopics: [],
        topHooks: [],
        topCTAs: [],
        keywords: [],
    };

    if (!researchSources || researchSources.length === 0) return insights;

    // TODO: Crawl từ sources thực tế
    // Hiện tại trả về placeholder
    for (const source of researchSources) {
        if (source.type === 'fb_group') {
            insights.trendingTopics.push(source.name || 'Chủ đề từ group');
        }
    }

    return insights;
}

/**
 * Build prompt thông minh dựa trên strategy + learning data
 */
function buildSmartPrompt(pipeline, product, strategy, topic, hook, direction, contentConfig) {
    const minWords = contentConfig.minWords || 200;
    const maxWords = contentConfig.maxWords || 500;
    const customInstructions = contentConfig.customInstructions || '';
    const language = contentConfig.language === 'en' ? 'English' : 'Tiếng Việt';

    const learning = pipeline.learningData || {};
    const analysis = product?.aiAnalysis || {};

    let directionInstruction = '';
    if (direction === 'advertising') {
        directionInstruction = `📢 HƯỚNG QUẢNG CÁO: Tạo nhận biết thương hiệu, thu hút sự chú ý, xây dựng uy tín. KHÔNG kêu gọi mua ngay.`;
    } else if (direction === 'purchase') {
        directionInstruction = `🛒 HƯỚNG MUA HÀNG: Thúc đẩy mua ngay. Nêu bật ưu đãi, giảm giá, số lượng có hạn, FOMO.`;
    } else {
        directionInstruction = `🎯 HƯỚNG KẾT HỢP: Xây dựng thương hiệu + kêu gọi mua hàng tinh tế.`;
    }

    let strategyInstruction = '';
    switch (strategy.name) {
        case 'trend_hook':
            strategyInstruction = `Sử dụng hook bắt trend, tạo sự tò mò, gắn sản phẩm một cách tự nhiên.`;
            break;
        case 'pain_solution':
            strategyInstruction = `Nêu rõ pain point của khách hàng, sau đó đưa sản phẩm là giải pháp.`;
            break;
        case 'social_proof':
            strategyInstruction = `Viết dạng review/testimonial, chia sẻ trải nghiệm thực tế với sản phẩm.`;
            break;
        case 'story_telling':
            strategyInstruction = `Kể câu chuyện liên quan đến sản phẩm, tạo cảm xúc cho người đọc.`;
            break;
        case 'educational':
            strategyInstruction = `Chia sẻ kiến thức hữu ích, sau đó gợi ý sản phẩm liên quan.`;
            break;
    }

    const hookInstruction = hook ? `Sử dụng hook này: "${hook}"` : '';
    const ctaInstruction = learning.bestCTAs?.length > 0
        ? `CTA nên dùng: ${learning.bestCTAs.slice(0, 3).join(', ')}`
        : '';

    return `Viết bài viết mạng xã hội:

📌 CHỦ ĐỀ: ${topic}

✍️ CHIẾN LƯỢC: ${strategyInstruction}

${directionInstruction}

📦 THÔNG TIN SẢN PHẨM:
- Tên: ${product?.name || 'N/A'}
- Mô tả: ${product?.description || 'N/A'}
- Giá: ${product?.price || 'N/A'}
- Đối tượng: ${product?.targetAudience || 'Mọi người'}
- Ưu điểm: ${(product?.keySellingPoints || []).join(', ') || 'N/A'}

${hookInstruction ? `🪝 ${hookInstruction}` : ''}
${ctaInstruction ? `📢 ${ctaInstruction}` : ''}
${customInstructions ? `📌 HƯỚNG DẪN THÊM: ${customInstructions}` : ''}

📏 Độ dài: ${minWords}-${maxWords} từ
🌐 Ngôn ngữ: ${language}

Format trả về:
TIÊU ĐỀ: [Tiêu đề]

NỘI DUNG:
[Nội dung bài viết]`;
}

/**
 * Parse bài viết từ AI response
 */
function parsePostResponse(raw) {
    let title = '';
    let content = raw;

    const titleMatch = raw.match(/TIÊU ĐỀ:\s*(.+)/i);
    if (titleMatch) {
        title = titleMatch[1].trim();
        const contentStart = raw.indexOf('NỘI DUNG:');
        content = contentStart >= 0 ? raw.substring(contentStart + 10).trim() : raw.replace(titleMatch[0], '').trim();
    } else {
        const lines = raw.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
            title = lines[0].replace(/^#+\s*/, '').trim();
            content = lines.slice(1).join('\n').trim();
        }
    }

    return { title, content };
}

/**
 * Chạy pipeline cho một user
 */
async function runPipeline(pipelineId) {
    const pipeline = await AutoContentPipeline.findById(pipelineId)
        .populate('productId')
        .lean();

    if (!pipeline || pipeline.status !== 'active') {
        console.log(`[Auto Content] Pipeline ${pipelineId} không active, bỏ qua`);
        return 0;
    }

    const product = pipeline.productId;
    if (!product) {
        console.error(`[Auto Content] Pipeline ${pipelineId}: không tìm thấy sản phẩm`);
        return 0;
    }

    // Lấy writing style
    const writingStyleId = pipeline.writingStyleId || product.writingStyleId;
    let writingStyle = null;
    if (writingStyleId) {
        writingStyle = await WritingStyle.findById(writingStyleId).lean();
    }

    // Nếu chưa có writing style, tạo style mặc định từ sản phẩm
    if (!writingStyle || !writingStyle.styleAnalysis?.tone) {
        writingStyle = {
            name: 'Default',
            styleAnalysis: {
                tone: 'Thân mật, gần gũi, chân thật',
                vocabulary: 'Từ ngữ đời thường, dễ hiểu',
                sentenceStructure: 'Câu ngắn gọn, dễ đọc',
                keywords: [product.name, product.category].filter(Boolean),
                summary: 'Văn phong bán hàng tự nhiên trên mạng xã hội',
            }
        };
    }

    // Lấy AI config
    const aiConfig = await getUserApiConfig(pipeline.userId);
    if (!aiConfig.apiKey) {
        console.error(`[Auto Content] Pipeline ${pipelineId}: chưa cấu hình API key`);
        await AutoContentPipeline.findByIdAndUpdate(pipelineId, {
            lastError: 'Chưa cấu hình API key',
            updatedAt: new Date(),
        });
        return 0;
    }

    // Gather insights
    const insights = await gatherInsights(pipeline.researchSources);

    let created = 0;

    for (let i = 0; i < pipeline.postsPerDay; i++) {
        try {
            const strategy = selectStrategy(i, pipeline.postsPerDay);
            const topic = selectTopic(pipeline, i);
            const hook = selectHook(pipeline);

            // Build prompt
            const prompt = buildSmartPrompt(
                pipeline, product, strategy, topic, hook,
                pipeline.contentDirection, pipeline.contentConfig
            );

            // Gọi AI tạo bài
            const raw = await callAI([
                { role: 'system', content: 'Bạn là chuyên gia tạo nội dung marketing trên mạng xã hội. Viết bài thu hút, chân thật, có chiều sâu.' },
                { role: 'user', content: prompt }
            ], {
                apiKey: aiConfig.apiKey,
                temperature: 0.8,
                maxTokens: 2500,
                provider: aiConfig.provider,
                model: aiConfig.model,
                baseUrl: aiConfig.baseUrl,
            });

            const { title, content } = parsePostResponse(raw);

            if (!content || content.length < 50) {
                console.warn(`[Auto Content] Pipeline ${pipelineId}: bài ${i + 1} quá ngắn, bỏ qua`);
                continue;
            }

            // Tính thời gian đăng: ưu tiên slot hôm nay nếu còn sớm, không thì ngày mai
            const slot = pipeline.timeSlots[i] || pipeline.timeSlots[0] || { hour: 9, minute: 0 };
            const now = new Date();
            const scheduledAt = new Date();
            scheduledAt.setHours(slot.hour, slot.minute || 0, 0, 0);

            // Nếu slot hôm nay đã qua, chuyển sang ngày mai
            if (scheduledAt <= now) {
                scheduledAt.setDate(scheduledAt.getDate() + 1);
            }

            // Resolve account IDs
            const accountIds = (pipeline.accountIds || []).map(id => String(id));

            // Tạo SchedulePost
            const schedulePost = await SchedulePost.create({
                userId: pipeline.userId,
                type: 'post',
                caption: content,
                images: product.images || [],
                platforms: pipeline.platforms || ['FB'],
                accounts: accountIds,
                targetGroupIds: pipeline.groupIds || [],
                scheduledAt,
                status: 'pending',
            });

            // Tạo AiGeneratedPost
            await AiGeneratedPost.create({
                userId: pipeline.userId,
                title,
                content,
                platforms: pipeline.platforms || ['FB'],
                accounts: accountIds,
                scheduledAt,
                status: 'pending',
                aiModel: aiConfig.model,
                aiPrompt: prompt,
                productId: product._id,
                direction: pipeline.contentDirection,
                schedulePostId: schedulePost._id,
            });

            created++;
            console.log(`[Auto Content] Pipeline ${pipelineId}: tạo bài ${i + 1}/${pipeline.postsPerDay} - "${title.substring(0, 50)}"`);
        } catch (err) {
            console.error(`[Auto Content] Pipeline ${pipelineId}: lỗi tạo bài ${i + 1}: ${err.message}`);
        }
    }

    // Cập nhật pipeline
    await AutoContentPipeline.findByIdAndUpdate(pipelineId, {
        lastRunAt: new Date(),
        totalPosts: (pipeline.totalPosts || 0) + created,
        lastError: created === 0 ? 'Không tạo được bài nào' : null,
        updatedAt: new Date(),
    });

    console.log(`[Auto Content] Pipeline ${pipelineId}: tạo ${created}/${pipeline.postsPerDay} bài`);
    return created;
}

/**
 * Xử lý tất cả pipeline active đến hạn
 */
async function processActivePipelines() {
    // Re-entrant guard: skip nếu tick trước còn đang chạy
    if (isProcessing) {
        console.log('[Auto Content] Skipped - previous tick still running');
        return;
    }
    isProcessing = true;
    const startedAt = Date.now();

    try {
        const now = new Date();

        // Tìm pipeline active và đến hạn chạy
        const pipelines = await AutoContentPipeline.find({
            status: 'active',
            $or: [
                { lastRunAt: null },
                { lastRunAt: { $exists: false } },
                { lastRunAt: { $lte: new Date(now.getTime() - 20 * 60 * 60 * 1000) } } // Chạy lại sau 20h
            ]
        }).lean();

    if (pipelines.length === 0) return;

    console.log(`[Auto Content] Tìm thấy ${pipelines.length} pipeline(s) đến hạn`);

    for (const pipeline of pipelines) {
        try {
            await runPipeline(pipeline._id);
        } catch (err) {
            console.error(`[Auto Content] Lỗi pipeline ${pipeline._id}: ${err.message}`);
            await AutoContentPipeline.findByIdAndUpdate(pipeline._id, {
                lastError: err.message,
                updatedAt: new Date(),
            }).catch(() => {});
        }
    }
    } finally {
        isProcessing = false;
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        if (elapsed > 5) {
            console.log(`[Auto Content] Tick xong trong ${elapsed}s`);
        }
    }
}

/**
 * Khởi động worker
 */
function startAutoContentRunner() {
    if (isWorkerStarted) return;
    isWorkerStarted = true;

    // Chạy lần đầu sau 30s
    firstRunTimer = setTimeout(() => {
        processActivePipelines().catch(console.error);
    }, 30000);

    // Chạy mỗi phút
    timer = setInterval(() => {
        processActivePipelines().catch(console.error);
    }, CHECK_INTERVAL_MS);

    console.log('[Auto Content Runner] Started');
}

function stopAutoContentRunner() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    if (firstRunTimer) {
        clearTimeout(firstRunTimer);
        firstRunTimer = null;
    }
    isProcessing = false;
    isWorkerStarted = false;
    console.log('[Auto Content Runner] Stopped');
}

function getAutoContentRunnerStatus() {
    return { started: isWorkerStarted, processing: isProcessing };
}

/**
 * Chạy pipeline ngay lập tức
 */
async function runPipelineNow(pipelineId) {
    return await runPipeline(pipelineId);
}

/**
 * Cập nhật learning data từ engagement
 */
async function updateLearningData(pipelineId) {
    const pipeline = await AutoContentPipeline.findById(pipelineId).lean();
    if (!pipeline) return;

    // Lấy các bài đã đăng của pipeline này
    const posts = await AiGeneratedPost.find({
        userId: pipeline.userId,
        productId: pipeline.productId,
        status: 'posted',
    }).sort({ publishedAt: -1 }).limit(20).lean();

    if (posts.length < 3) return; // Cần ít nhất 3 bài

    // Phân tích engagement
    const scored = posts.map(post => {
        const likes = post.engagement?.likes || 0;
        const comments = post.engagement?.comments || 0;
        const shares = post.engagement?.shares || 0;
        const score = likes + comments * 2 + shares * 3;
        return { ...post, score };
    }).sort((a, b) => b.score - a.score);

    const topPosts = scored.slice(0, 5);
    const avgScore = scored.reduce((s, p) => s + p.score, 0) / scored.length;

    // Gọi AI phân tích pattern từ top posts
    const aiConfig = await getUserApiConfig(pipeline.userId);
    if (!aiConfig.apiKey) return;

    try {
        const postsText = topPosts.map((p, i) =>
            `--- Bài ${i + 1} (Điểm: ${p.score}) ---\nTiêu đề: ${p.title}\nNội dung: ${(p.content || '').substring(0, 300)}`
        ).join('\n\n');

        const analysisPrompt = `Phân tích các bài viết có hiệu quả cao sau và trích xuất pattern:

${postsText}

Trả về JSON:
{
  "bestHooks": ["hook 1", "hook 2"],
  "bestCTAs": ["CTA 1", "CTA 2"],
  "bestTopics": ["topic 1", "topic 2"]
}`;

        const raw = await callAI([
            { role: 'system', content: 'Phân tích pattern bài viết hiệu quả. Trả về JSON hợp lệ.' },
            { role: 'user', content: analysisPrompt }
        ], { apiKey: aiConfig.apiKey, temperature: 0.3, provider: aiConfig.provider, model: aiConfig.model, baseUrl: aiConfig.baseUrl });

        const analysis = parseAIJsonResponse(raw) || {};

        await AutoContentPipeline.findByIdAndUpdate(pipelineId, {
            learningData: {
                bestHooks: analysis.bestHooks || [],
                bestCTAs: analysis.bestCTAs || [],
                bestTopics: analysis.bestTopics || [],
                avgEngagement: avgScore,
                improvementRate: 0,
                lastUpdated: new Date(),
            },
            totalEngagement: scored.reduce((s, p) => s + p.score, 0),
            updatedAt: new Date(),
        });

        console.log(`[Auto Content] Updated learning data for pipeline ${pipelineId}`);
    } catch (err) {
        console.error(`[Auto Content] Lỗi update learning data: ${err.message}`);
    }
}

module.exports = {
    startAutoContentRunner,
    stopAutoContentRunner,
    getAutoContentRunnerStatus,
    runPipelineNow,
    processActivePipelines,
    updateLearningData,
};
