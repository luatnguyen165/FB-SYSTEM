// controllers/aiImageController.js
// Video Project Controller - upload ảnh + prompt, không gọi API AI
const AiImage = require('../models/AiImage');
const videoService = require('../services/aiImageService');
const path = require('path');

// ============================================================
// PAGE RENDERING
// ============================================================

const showProjects = async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const limit = 12;
        const skip = (page - 1) * limit;

        const [projects, total] = await Promise.all([
            AiImage.find({ userId: req.user._id })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AiImage.countDocuments({ userId: req.user._id })
        ]);

        const totalPages = Math.ceil(total / limit);

        const stats = {
            total,
            totalEntries: projects.reduce((sum, p) => sum + (p.entries ? p.entries.length : 0), 0),
            completed: projects.reduce((sum, p) => sum + (p.entries ? p.entries.filter(e => e.status === 'completed').length : 0), 0),
            failed: projects.reduce((sum, p) => sum + (p.entries ? p.entries.filter(e => e.status === 'failed').length : 0), 0)
        };

        res.render('ai-images', {
            user: req.user,
            projects,
            stats,
            currentPage: 'video-create',
            pagination: { page, totalPages, total }
        });
    } catch (error) {
        console.error('[Video Project] Show Error:', error);
        res.render('ai-images', {
            user: req.user,
            projects: [],
            stats: { total: 0, totalEntries: 0, completed: 0, failed: 0 },
            currentPage: 'video-create',
            pagination: { page: 1, totalPages: 0, total: 0 }
        });
    }
};

// ============================================================
// API: Tạo project mới
// ============================================================

const createProject = async (req, res) => {
    try {
        const { name } = req.body;
        const project = await AiImage.create({
            userId: req.user._id,
            name: (name || 'Project mới').trim(),
            entries: []
        });
        return res.json({ success: true, project });
    } catch (error) {
        console.error('[Video Project] Create Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// API: Upload ảnh + prompt cùng lúc
// ============================================================

const uploadAndSave = async (req, res) => {
    try {
        const { projectId } = req.params;
        const { prompt } = req.body;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Vui lòng chọn ảnh' });
        }

        const project = await AiImage.findOne({ _id: projectId, userId: req.user._id });
        if (!project) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy project' });
        }

        const projectBaseDir = global.USER_DATA_DIR || path.join(__dirname, '..');
        const relativePath = path.relative(projectBaseDir, req.file.path).replace(/\\/g, '/');

        const entry = {
            originalImage: {
                filename: req.file.originalname,
                path: relativePath,
                mimetype: req.file.mimetype
            },
            prompt: (prompt || '').trim(),
            status: 'completed'
        };

        project.entries.push(entry);
        await project.save();

        const newEntry = project.entries[project.entries.length - 1];

        return res.json({
            success: true,
            message: 'Đã thêm entry thành công',
            entry: {
                _id: newEntry._id,
                originalImage: newEntry.originalImage,
                prompt: newEntry.prompt,
                status: newEntry.status,
                createdAt: newEntry.createdAt
            }
        });
    } catch (error) {
        console.error('[Video Project] Upload Error:', error);
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// API: Lấy trạng thái project
// ============================================================

const getProjectStatus = async (req, res) => {
    try {
        const { projectId } = req.params;
        const project = await AiImage.findOne({ _id: projectId, userId: req.user._id }).lean();
        if (!project) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy project' });
        }

        return res.json({
            success: true,
            project: {
                _id: project._id,
                name: project.name,
                entries: (project.entries || []).map(e => ({
                    _id: e._id,
                    originalImage: e.originalImage,
                    prompt: e.prompt,
                    status: e.status,
                    errorMessage: e.errorMessage,
                    createdAt: e.createdAt
                })),
                isFavorite: project.isFavorite,
                createdAt: project.createdAt
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// API: Cập nhật tên project
// ============================================================

const updateProjectName = async (req, res) => {
    try {
        const { projectId } = req.params;
        const { name } = req.body;
        const project = await AiImage.findOne({ _id: projectId, userId: req.user._id });
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy project' });
        project.name = (name || project.name).trim();
        await project.save();
        return res.json({ success: true, name: project.name });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// API: Xóa project
// ============================================================

const deleteProject = async (req, res) => {
    try {
        const { projectId } = req.params;
        const project = await AiImage.findOne({ _id: projectId, userId: req.user._id });
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy project' });

        for (const entry of (project.entries || [])) {
            if (entry.originalImage && entry.originalImage.path) {
                videoService.deleteLocalImage(path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), entry.originalImage.path));
            }
        }
        await AiImage.deleteOne({ _id: projectId });
        return res.json({ success: true, message: 'Đã xóa project' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi xóa: ' + error.message });
    }
};

// ============================================================
// API: Toggle yêu thích
// ============================================================

const toggleFavorite = async (req, res) => {
    try {
        const { projectId } = req.params;
        const project = await AiImage.findOne({ _id: projectId, userId: req.user._id });
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy project' });
        project.isFavorite = !project.isFavorite;
        await project.save();
        return res.json({ success: true, isFavorite: project.isFavorite });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// API: Cập nhật prompt entry
// ============================================================

const updateEntryPrompt = async (req, res) => {
    try {
        const { projectId, entryId } = req.params;
        const { prompt } = req.body;

        const project = await AiImage.findOne({ _id: projectId, userId: req.user._id });
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy project' });

        const entry = project.entries.id(entryId);
        if (!entry) return res.status(404).json({ success: false, message: 'Không tìm thấy entry' });

        if (prompt !== undefined) entry.prompt = String(prompt).trim();
        await project.save();

        return res.json({ success: true, message: 'Đã cập nhật prompt' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

// ============================================================
// API: Xóa entry
// ============================================================

const deleteEntry = async (req, res) => {
    try {
        const { projectId, entryId } = req.params;
        const project = await AiImage.findOne({ _id: projectId, userId: req.user._id });
        if (!project) return res.status(404).json({ success: false, message: 'Không tìm thấy project' });

        const entry = project.entries.id(entryId);
        if (!entry) return res.status(404).json({ success: false, message: 'Không tìm thấy entry' });

        if (entry.originalImage && entry.originalImage.path) {
            videoService.deleteLocalImage(path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), entry.originalImage.path));
        }
        project.entries.pull({ _id: entryId });
        await project.save();
        return res.json({ success: true, message: 'Đã xóa entry' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi: ' + error.message });
    }
};

module.exports = {
    showProjects,
    createProject,
    uploadAndSave,
    getProjectStatus,
    updateProjectName,
    updateEntryPrompt,
    deleteProject,
    toggleFavorite,
    deleteEntry
};
