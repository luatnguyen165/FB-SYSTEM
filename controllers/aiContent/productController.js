// controllers/aiContent/productController.js
const Product = require('../../models/Product');
const aiContentService = require('../../services/aiContentService');
const { getUserId, errorResponse, getUserApiConfig } = require('./helpers');

/** GET /ai-content/api/products */
exports.getProducts = async (req, res) => {
    try {
        const userId = getUserId(req);
        const products = await Product.find({ userId, isActive: true }).populate('writingStyleId', 'name').sort({ createdAt: -1 }).lean();
        res.json({ success: true, products });
    } catch (err) { errorResponse(res, err, 'getProducts'); }
};

/** GET /ai-content/api/products/:id */
exports.getProduct = async (req, res) => {
    try {
        const userId = getUserId(req);
        const product = await Product.findOne({ _id: req.params.id, userId, isActive: true }).populate('writingStyleId', 'name').lean();
        if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        res.json(product);
    } catch (err) { errorResponse(res, err, 'getProduct'); }
};

/** POST /ai-content/api/products */
exports.createProduct = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { name, description, category, price, audience, sellingPoints, competitors, writingStyleId, direction } = req.body;
        if (!name) return res.status(400).json({ error: 'Cần tên sản phẩm' });
        const product = await Product.create({ userId, name, description: description || '', category: category || '', price: price || '', targetAudience: audience || '', keySellingPoints: Array.isArray(sellingPoints) ? sellingPoints : [], competitorProducts: Array.isArray(competitors) ? competitors.join(', ') : (competitors || ''), writingStyleId: writingStyleId || null, direction: direction || 'unset' });
        res.json({ success: true, product });
    } catch (err) { errorResponse(res, err, 'createProduct'); }
};

/** PUT /ai-content/api/products/:id */
exports.updateProduct = async (req, res) => {
    try {
        const userId = getUserId(req);
        const product = await Product.findOne({ _id: req.params.id, userId });
        if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        const updates = req.body;
        const allowedFields = ['name', 'description', 'category', 'price', 'targetAudience', 'keySellingPoints', 'competitorProducts', 'writingStyleId', 'direction'];
        for (const field of allowedFields) { if (updates[field] !== undefined) product[field] = updates[field]; }
        product.updatedAt = new Date();
        await product.save();
        res.json({ success: true, product });
    } catch (err) { errorResponse(res, err, 'updateProduct'); }
};

/** DELETE /ai-content/api/products/:id */
exports.deleteProduct = async (req, res) => {
    try {
        const userId = getUserId(req);
        const product = await Product.findOneAndUpdate({ _id: req.params.id, userId }, { isActive: false, updatedAt: new Date() });
        if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        res.json({ success: true });
    } catch (err) { errorResponse(res, err, 'deleteProduct'); }
};

/** POST /ai-content/api/products/:id/analyze */
exports.analyzeProduct = async (req, res) => {
    try {
        const userId = getUserId(req);
        const aiConfig = await getUserApiConfig(userId);
        const product = await Product.findOne({ _id: req.params.id, userId });
        if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
        if (!aiConfig.apiKey?.trim()) return res.status(400).json({ error: 'Chưa cấu hình API Key.', code: 'MISSING_API_KEY' });
        const analysis = await aiContentService.analyzeProduct(product, aiConfig.apiKey, aiConfig);
        product.aiAnalysis = { suggestedDirection: analysis.suggestedDirection, recommendedAngles: analysis.recommendedAngles, hookIdeas: analysis.hookIdeas, targetEmotions: analysis.targetEmotions, keywords: analysis.keywords, summary: analysis.summary };
        product.direction = analysis.suggestedDirection;
        product.updatedAt = new Date();
        await product.save();
        res.json({ success: true, analysis });
    } catch (err) {
        if (err.response?.status === 401) return res.status(400).json({ error: 'API Key không hợp lệ.', code: 'UNAUTHORIZED_API_KEY' });
        errorResponse(res, err, 'analyzeProduct');
    }
};
