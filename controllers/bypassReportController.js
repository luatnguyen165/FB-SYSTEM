// controllers/bypassReportController.js
const path = require('path');
const fs = require('fs');

exports.showReport = async (req, res) => {
    try {
        const userId = req.session.userId || req.user?.id;
        if (!userId) return res.redirect('/auth/login');

        // Collect bypass config info
        let config = {};
        try {
            const bp = require('../services/facebookBypassService');
            config = {
                rebrowserPatches: !!process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE,
                stealthPlugin: true,
                antiDetectScript: !!bp.ANTI_DETECT_SCRIPT,
                humanBehavior: typeof bp.humanMouseMove === 'function',
                videoFingerprint: bp.BYPASS_CONFIG?.video || {},
                watermark: bp.BYPASS_CONFIG?.watermark || {},
                delays: bp.BYPASS_CONFIG?.delays || {},
            };
        } catch (e) {
            config = { error: e.message };
        }

        res.render('bypass-report', {
            currentPage: 'bypass-report',
            config,
            features: res.locals.features || {},
            user: req.session.user || req.user || null,
        });
    } catch (err) {
        console.error('[BypassReport] Error:', err.message);
        res.redirect('/dashboard');
    }
};
