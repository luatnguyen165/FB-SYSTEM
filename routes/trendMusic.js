const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// GET - Trend Music page
router.get('/', (req, res) => {
    // Đọc tracks.json từ public/music
const tracksPath = path.join(__dirname, '..', 'public', 'music', 'tracks.json');
    let tracks = [];
    
    try {
        if (fs.existsSync(tracksPath)) {
            tracks = JSON.parse(fs.readFileSync(tracksPath, 'utf-8'));
        }
    } catch (err) {
        console.error('[Trend Music] Error reading tracks.json:', err.message);
    }

    res.render('trend-music', {
        currentPage: 'trend-music',
        user: req.session.user,
        features: req.features || {},
        tracks,
        title: 'Trend Music'
    });
});

module.exports = router;