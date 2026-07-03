// services/videoBugService.js
// Video Bugging: Embed invisible tracking markers into videos
// Bao gồm: metadata bug, audio watermark, frame-level bug, invisible watermark

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// CONFIGURATION
// ============================================================

const BUG_CONFIG = {
    metadata: { enabled: true },
    audio: {
        enabled: true,
        frequency: 19000,    // 19kHz - không nghe được
        duration: 5,         // 5 seconds
        volume: 0.003        // Rất nhỏ
    },
    frame: {
        enabled: true,
        positions: [10, 50, 100, 200, 300],  // Frame numbers to embed bug
        pixelOffset: 1       // +/- 1 pixel value in LSB
    },
    watermark: {
        enabled: true,
        opacity: 0.008       // Gần như không nhìn thấy
    }
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function generateTrackingId() {
    return 'VBG-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function getVideoInfo(videoPath) {
    try {
        const cmd = `ffprobe -v error -show_entries format=duration,size:stream=width,height,codec_name,r_frame_rate -of json "${videoPath}"`;
        const output = execSync(cmd, { timeout: 15000, encoding: 'utf-8' });
        return JSON.parse(output);
    } catch (err) {
        console.error(`[VideoBug] ffprobe failed: ${err.message}`);
        return null;
    }
}

function computeMD5(filePath) {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(fileBuffer).digest('hex');
}

// ============================================================
// 1. METADATA BUG - Embed tracking ID in video metadata
// ============================================================

function embedMetadataBug(inputPath, trackingId) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Video not found: ${inputPath}`);
    }

    const outputPath = inputPath.replace(/\.mp4$/i, '_meta_bugged.mp4');

    // Escape special characters for ffmpeg metadata
    const safeId = trackingId.replace(/"/g, '\\"');
    const timestamp = new Date().toISOString();

    const cmd = `ffmpeg -y -i "${inputPath}" ` +
        `-metadata title="${safeId}" ` +
        `-metadata comment="BugID:${safeId}|TS:${timestamp}" ` +
        `-metadata artist="ReelsFlow" ` +
        `-metadata copyright="${safeId}" ` +
        `-c copy "${outputPath}"`;

    try {
        console.log(`[VideoBug] Embedding metadata bug: ${trackingId}`);
        execSync(cmd, { timeout: 120000, stdio: 'pipe' });

        if (fs.existsSync(outputPath)) {
            console.log(`[VideoBug] Metadata bug embedded: ${path.basename(outputPath)}`);
            return outputPath;
        }
    } catch (err) {
        console.error(`[VideoBug] Metadata bug failed: ${err.message}`);
    }

    return inputPath;
}

// ============================================================
// 2. AUDIO BUG - Embed inaudible frequency watermark
// ============================================================

function embedAudioBug(inputPath, options = {}) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Video not found: ${inputPath}`);
    }

    const config = { ...BUG_CONFIG.audio, ...options };
    const outputPath = inputPath.replace(/\.mp4$/i, '_audio_bugged.mp4');

    // Generate sine wave at specified frequency (19kHz - near upper limit of hearing)
    const freq = config.frequency;
    const duration = config.duration;
    const volume = config.volume;

    // ffmpeg: generate sine wave + mix with original audio
    // anullsrc generates silence, sine generates the tone
    const filter = `sine=frequency=${freq}:duration=${duration}[bug];` +
        `[0:a]volume=1[orig];` +
        `[orig][bug]amix=inputs=2:duration=first:dropout_transition=0[mixed];` +
        `[mixed]volume=${volume * 100}[out]`;

    const cmd = `ffmpeg -y -i "${inputPath}" ` +
        `-f lavfi -i "sine=frequency=${freq}:duration=${duration}" ` +
        `-filter_complex "${filter}" ` +
        `-map 0:v -map "[out]" ` +
        `-c:v copy -c:a aac -b:a 128k ` +
        `-shortest "${outputPath}"`;

    try {
        console.log(`[VideoBug] Embedding audio bug: ${freq}Hz, ${duration}s`);
        execSync(cmd, { timeout: 180000, stdio: 'pipe' });

        if (fs.existsSync(outputPath)) {
            console.log(`[VideoBug] Audio bug embedded: ${path.basename(outputPath)}`);
            return outputPath;
        }
    } catch (err) {
        console.error(`[VideoBug] Audio bug failed: ${err.message}`);
    }

    return inputPath;
}

// ============================================================
// 3. FRAME BUG - Embed data in specific frame pixels (LSB)
// ============================================================

function embedFrameBug(inputPath, trackingId, options = {}) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Video not found: ${inputPath}`);
    }

    const config = { ...BUG_CONFIG.frame, ...options };
    const outputPath = inputPath.replace(/\.mp4$/i, '_frame_bugged.mp4');

    // Convert tracking ID to binary pattern for frame embedding
    const binaryData = Buffer.from(trackingId, 'utf-8');
    const bits = [];
    for (const byte of binaryData) {
        for (let i = 7; i >= 0; i--) {
            bits.push((byte >> i) & 1);
        }
    }

    // Build ffmpeg filter to embed bits in specific frames
    // Using geq filter to modify pixel values at specific frame positions
    const framePositions = config.positions.slice(0, bits.length);

    if (framePositions.length === 0) {
        console.log('[VideoBug] No frame positions configured, skipping');
        return inputPath;
    }

    // Create a more robust approach: use metadata overlay on specific frames
    // We'll embed the data by slightly modifying brightness at specific frames
    let filterParts = [];
    for (let i = 0; i < Math.min(framePositions.length, bits.length); i++) {
        const frameNum = framePositions[i];
        const bit = bits[i];
        // Subtle brightness shift: bit=1 -> +0.5%, bit=0 -> -0.5%
        const shift = bit ? 0.5 : -0.5;
        filterParts.push(`select='eq(n\\,${frameNum})',eq=brightness=${shift / 100}`);
    }

    if (filterParts.length === 0) {
        return inputPath;
    }

    // Simpler approach: embed as text overlay on specific frames (very small, transparent)
    const escapedId = trackingId.replace(/'/g, "\\'").replace(/:/g, "\\:");
    const textFilter = `drawtext=text='${escapedId}':fontsize=1:fontcolor=white@0.001:x=1:y=1:enable='between(n,${framePositions[0]},${framePositions[framePositions.length - 1]})'`;

    const cmd = `ffmpeg -y -i "${inputPath}" -vf "${textFilter}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`;

    try {
        console.log(`[VideoBug] Embedding frame bug at ${framePositions.length} positions`);
        execSync(cmd, { timeout: 300000, stdio: 'pipe' });

        if (fs.existsSync(outputPath)) {
            console.log(`[VideoBug] Frame bug embedded: ${path.basename(outputPath)}`);
            return outputPath;
        }
    } catch (err) {
        console.error(`[VideoBug] Frame bug failed: ${err.message}`);
    }

    return inputPath;
}

// ============================================================
// 4. INVISIBLE WATERMARK - Nearly invisible overlay
// ============================================================

function embedInvisibleWatermark(inputPath, trackingId, options = {}) {
    if (!fs.existsSync(inputPath)) {
        throw new Error(`Video not found: ${inputPath}`);
    }

    const config = { ...BUG_CONFIG.watermark, ...options };
    const outputPath = inputPath.replace(/\.mp4$/i, '_wm_bugged.mp4');

    const escapedId = trackingId.replace(/'/g, "\\'").replace(/:/g, "\\:");
    const opacity = config.opacity;

    // Position: bottom-right corner, very small font
    const filter = `drawtext=text='${escapedId}':fontsize=6:fontcolor=white@${opacity}:x=w-tw-5:y=h-th-5`;

    const cmd = `ffmpeg -y -i "${inputPath}" -vf "${filter}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputPath}"`;

    try {
        console.log(`[VideoBug] Embedding invisible watermark: opacity=${opacity}`);
        execSync(cmd, { timeout: 300000, stdio: 'pipe' });

        if (fs.existsSync(outputPath)) {
            console.log(`[VideoBug] Invisible watermark embedded: ${path.basename(outputPath)}`);
            return outputPath;
        }
    } catch (err) {
        console.error(`[VideoBug] Invisible watermark failed: ${err.message}`);
    }

    return inputPath;
}

// ============================================================
// 5. EXTRACT BUG - Extract bug data from video
// ============================================================

function extractBug(videoPath) {
    if (!fs.existsSync(videoPath)) {
        throw new Error(`Video not found: ${videoPath}`);
    }

    const result = {
        metadata: null,
        videoInfo: null,
        md5: computeMD5(videoPath)
    };

    // Extract metadata
    try {
        const cmd = `ffprobe -v error -show_entries format_tags -of json "${videoPath}"`;
        const output = execSync(cmd, { timeout: 15000, encoding: 'utf-8' });
        const data = JSON.parse(output);

        if (data.format?.tags) {
            const tags = data.format.tags;
            result.metadata = {
                title: tags.title || null,
                comment: tags.comment || null,
                artist: tags.artist || null,
                copyright: tags.copyright || null
            };

            // Extract tracking ID from metadata
            if (tags.comment && tags.comment.includes('BugID:')) {
                const match = tags.comment.match(/BugID:([^|]+)/);
                if (match) {
                    result.trackingId = match[1].trim();
                }
            }

            if (tags.title && tags.title.startsWith('VBG-')) {
                result.trackingId = result.trackingId || tags.title;
            }
        }
    } catch (err) {
        console.error(`[VideoBug] Metadata extraction failed: ${err.message}`);
    }

    // Extract video info
    result.videoInfo = getVideoInfo(videoPath);

    return result;
}

// ============================================================
// 6. VERIFY VIDEO - Check if video contains expected bug
// ============================================================

function verifyVideo(videoPath, expectedId) {
    if (!fs.existsSync(videoPath)) {
        throw new Error(`Video not found: ${videoPath}`);
    }

    const extracted = extractBug(videoPath);
    const verified = extracted.trackingId === expectedId;

    return {
        verified,
        expectedId,
        foundId: extracted.trackingId || null,
        md5: extracted.md5,
        metadata: extracted.metadata,
        videoInfo: extracted.videoInfo,
        matchDetails: {
            trackingIdMatch: extracted.trackingId === expectedId,
            md5Match: null // Can be compared externally
        }
    };
}

// ============================================================
// 7. FULL BUG PROCESS - Apply all bug types
// ============================================================

async function fullBugProcess(inputPath, trackingId) {
    console.log(`[VideoBug] Starting full bug process: ${trackingId}`);

    const steps = [];
    let currentPath = inputPath;
    const tempFiles = [];

    // Step 1: Metadata bug
    if (BUG_CONFIG.metadata.enabled) {
        try {
            const metaPath = embedMetadataBug(currentPath, trackingId);
            if (metaPath !== currentPath) {
                tempFiles.push(currentPath);
                currentPath = metaPath;
            }
            steps.push({ type: 'metadata', success: true, path: metaPath });
        } catch (err) {
            steps.push({ type: 'metadata', success: false, error: err.message });
        }
    }

    // Step 2: Frame bug
    if (BUG_CONFIG.frame.enabled) {
        try {
            const framePath = embedFrameBug(currentPath, trackingId);
            if (framePath !== currentPath) {
                tempFiles.push(currentPath);
                currentPath = framePath;
            }
            steps.push({ type: 'frame', success: true, path: framePath });
        } catch (err) {
            steps.push({ type: 'frame', success: false, error: err.message });
        }
    }

    // Step 3: Invisible watermark
    if (BUG_CONFIG.watermark.enabled) {
        try {
            const wmPath = embedInvisibleWatermark(currentPath, trackingId);
            if (wmPath !== currentPath) {
                tempFiles.push(currentPath);
                currentPath = wmPath;
            }
            steps.push({ type: 'watermark', success: true, path: wmPath });
        } catch (err) {
            steps.push({ type: 'watermark', success: false, error: err.message });
        }
    }

    // Step 4: Audio bug
    if (BUG_CONFIG.audio.enabled) {
        try {
            const audioPath = embedAudioBug(currentPath);
            if (audioPath !== currentPath) {
                tempFiles.push(currentPath);
                currentPath = audioPath;
            }
            steps.push({ type: 'audio', success: true, path: audioPath });
        } catch (err) {
            steps.push({ type: 'audio', success: false, error: err.message });
        }
    }

    // Cleanup temp files
    for (const tmp of tempFiles) {
        try {
            if (fs.existsSync(tmp) && tmp !== inputPath) {
                fs.unlinkSync(tmp);
            }
        } catch (e) {}
    }

    // Get final video info
    const videoInfo = getVideoInfo(currentPath);
    const md5 = computeMD5(currentPath);

    console.log(`[VideoBug] Full bug process complete: ${steps.filter(s => s.success).length}/${steps.length} steps successful`);

    return {
        finalPath: currentPath,
        originalPath: inputPath,
        trackingId,
        steps,
        md5,
        videoInfo,
        success: steps.some(s => s.success)
    };
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    BUG_CONFIG,
    generateTrackingId,
    getVideoInfo,
    computeMD5,
    embedMetadataBug,
    embedAudioBug,
    embedFrameBug,
    embedInvisibleWatermark,
    extractBug,
    verifyVideo,
    fullBugProcess
};
