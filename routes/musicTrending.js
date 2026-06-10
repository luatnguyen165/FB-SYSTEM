const express = require('express');
const router = express.Router();
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const MusicTrending = require('../models/MusicTrending');
const Channel = require('../models/Channel');
const { requireAuth } = require('../middlewares/authMiddleware');

// Auto-seed tracks vào DB nếu chưa có
async function autoSeedTracks(userId) {
    const existing = await MusicTrending.countDocuments({ userId });
    if (existing > 0) return; // Đã có tracks rồi

    const trackDir = path.join(__dirname, '..', 'public', 'music', 'tracks');
    let trackFiles = [];
    try {
        trackFiles = fs.readdirSync(trackDir).filter(f => f.endsWith('.wav')).sort();
    } catch {
        // thư mục chưa tồn tại
    }

    if (trackFiles.length === 0) return;

    const trackNames = [
        { title: 'Sunset Dreams', artist: 'Luna Wave' },
        { title: 'Neon Nights', artist: 'Cyber Pulse' },
        { title: 'Ocean Breeze', artist: 'Coral Reef' },
        { title: 'Midnight Run', artist: 'Urban Beats' },
        { title: 'Starlight', artist: 'Cosmic Drift' },
        { title: 'Electric Soul', artist: 'Neon Heart' },
        { title: 'Golden Hour', artist: 'Sunset Blvd' },
        { title: 'Deep Focus', artist: 'Ambient Mind' },
    ];

    const docs = trackFiles.map((file, i) => {
        const meta = trackNames[i] || { title: 'Unknown', artist: 'Unknown' };
        return {
            userId,
            platform: 'TT',
            url: `/music/tracks/${file}`,
            title: meta.title,
            artist: meta.artist,
            duration: 30,
            accountName: 'TikTok Trending'
        };
    });

    await MusicTrending.insertMany(docs);
}

// GET /music-trending - Trang chính
router.get('/', requireAuth, async (req, res) => {
    try {
        // Tự động seed tracks nếu chưa có
        await autoSeedTracks(req.session.userId);

        const musicList = await MusicTrending.find({ userId: req.session.userId })
            .sort({ createdAt: -1 })
            .limit(50);

        const channels = await Channel.find({ userId: req.session.userId, isEnabled: true })
            .select('_id platform accountName avatarUrl')
            .sort({ platform: 1, createdAt: -1 })
            .lean();

        res.render('music-trending', {
            musicList,
            channels,
            currentPage: 'music-trending',
            user: req.session.user,
            features: req.features || {}
        });
    } catch (err) {
        console.error('[MusicTrending] Error loading page:', err.message);
        res.redirect('/dashboard');
    }
});

// GET /music-trending/fetch?platform=TT - Lấy nhạc trending từ nền tảng
router.get('/fetch', requireAuth, async (req, res) => {
    try {
        const platform = req.query.platform || 'TT';
        const results = [];

        if (platform === 'TT') {
            // Tracks from generated WAV files
            const trackFiles = fs.readdirSync(path.join(__dirname, '..', 'public', 'music', 'tracks'))
                .filter(f => f.endsWith('.wav'))
                .sort();

            const trackNames = [
                { title: 'Sunset Dreams', artist: 'Luna Wave' },
                { title: 'Neon Nights', artist: 'Cyber Pulse' },
                { title: 'Ocean Breeze', artist: 'Coral Reef' },
                { title: 'Midnight Run', artist: 'Urban Beats' },
                { title: 'Starlight', artist: 'Cosmic Drift' },
                { title: 'Electric Soul', artist: 'Neon Heart' },
                { title: 'Golden Hour', artist: 'Sunset Blvd' },
                { title: 'Deep Focus', artist: 'Ambient Mind' },
            ];

            trackFiles.forEach((file, i) => {
                const meta = trackNames[i] || { title: 'Unknown', artist: 'Unknown' };
                results.push({
                    userId: req.session.userId,
                    platform: 'TT',
                    url: `/music/tracks/${file}`,
                    title: meta.title,
                    artist: meta.artist,
                    duration: 30,
                    accountName: 'TikTok Trending'
                });
            });
        }

        // Lưu vào DB
        if (results.length > 0) {
            await MusicTrending.insertMany(results);
        }

        res.json({ success: true, count: results.length, message: `Đã lấy ${results.length} bài nhạc từ ${platform}` });
    } catch (err) {
        console.error('[MusicTrending] Fetch error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /music-trending/delete/:id
router.post('/delete/:id', requireAuth, async (req, res) => {
    try {
        await MusicTrending.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;