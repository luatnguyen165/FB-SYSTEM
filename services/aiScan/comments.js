// services/aiScan/comments.js
const fs = require('fs');
const AiComment = require('../../models/AiComment');
const { resolveFilePath, randomInt, wait } = require('./helpers');

async function humanLikeTyping(page, text) {
    for (const char of text) {
        await page.keyboard.type(char, { delay: randomInt(20, 60) });
        if (Math.random() < 0.01) await wait(randomInt(300, 700));
    }
}

async function uploadFileToComment(page, filePath) {
    try {
        const resolvedPath = resolveFilePath(filePath);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) return false;
        const selectors = ['input[type="file"][accept*="image"]', 'input[type="file"][accept*="video"]', 'input[type="file"][accept*="media"]', 'form input[type="file"]'];
        for (const sel of selectors) {
            const input = page.locator(sel).first();
            if (await input.count().catch(() => 0) > 0) { await input.setInputFiles(resolvedPath); await page.waitForTimeout(2000); return true; }
        }
        const attachBtns = ['div[aria-label="Đính kèm ảnh"]', 'div[aria-label="Attach a photo"]', 'div[aria-label="Ảnh/video"]'];
        for (const sel of attachBtns) {
            const btn = page.locator(sel).first();
            if (await btn.count().catch(() => 0) > 0) {
                await btn.click({ force: true }); await page.waitForTimeout(1000);
                const fi = page.locator('input[type="file"]').first();
                if (await fi.count().catch(() => 0) > 0) { await fi.setInputFiles(resolvedPath); await page.waitForTimeout(2000); return true; }
                break;
            }
        }
        return false;
    } catch (e) { return false; }
}

async function sendTextComment(page, text) {
    if (!text) return { sent: false, error: 'Empty text' };
    const selectors = ['div[aria-label="Viết bình luận"]', 'div[aria-label="Write a comment"]', 'div[role="textbox"][contenteditable="true"]'];
    for (const sel of selectors) {
        const loc = page.locator(sel).first();
        if (await loc.count().catch(() => 0) > 0) {
            try {
                await loc.click({ force: true }); await page.waitForTimeout(400);
                await humanLikeTyping(page, text); await page.waitForTimeout(800);
                await page.keyboard.press('Enter'); await page.waitForTimeout(2500);
                return { sent: true, error: '' };
            } catch (e) { /* try next */ }
        }
    }
    return { sent: false, error: 'Không tìm thấy ô comment' };
}

async function sendMediaComment(page, filePath, caption, mediaType) {
    if (!filePath) return { sent: false, error: 'Missing file path' };
    const resolvedPath = resolveFilePath(filePath);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) return { sent: false, error: 'File not found' };
    try {
        const selectors = ['div[aria-label="Viết bình luận"]', 'div[aria-label="Write a comment"]', 'div[role="textbox"][contenteditable="true"]'];
        let focused = false;
        for (const sel of selectors) {
            const loc = page.locator(sel).first();
            if (await loc.count().catch(() => 0) > 0) { await loc.click({ force: true }); await page.waitForTimeout(400); focused = true; break; }
        }
        if (!focused) return { sent: false, error: 'Không tìm thấy ô comment' };
        if (!await uploadFileToComment(page, resolvedPath)) return { sent: false, error: 'Không thể upload file' };
        await page.waitForTimeout(randomInt(1500, 3000));
        if (caption) {
            for (const sel of selectors) {
                const loc = page.locator(sel).first();
                if (await loc.count().catch(() => 0) > 0) { await loc.click({ force: true }); await page.waitForTimeout(200); await humanLikeTyping(page, ' ' + caption); await page.waitForTimeout(400); break; }
            }
        }
        await page.keyboard.press('Enter'); await page.waitForTimeout(3500);
        return { sent: true, error: '' };
    } catch (e) { return { sent: false, error: e.message }; }
}

async function sendCommentItem(page, item) {
    if (item.type === 'text') return sendTextComment(page, item.content);
    if (item.type === 'image') return sendMediaComment(page, item.content, item.caption, 'image');
    if (item.type === 'video') return sendMediaComment(page, item.content, item.caption, 'video');
    return { sent: false, error: 'Unknown type' };
}

async function sendMultipleComments(page, items) {
    const results = [];
    for (const item of items) {
        const r = await sendCommentItem(page, item);
        results.push({ type: item.type, content: item.content, caption: item.caption || '', sent: r.sent, error: r.error, sentAt: r.sent ? new Date() : null });
        if (items.length > 1) await wait(randomInt(1500, 4000));
    }
    return results;
}

async function commentOnPostLegacy(page, postUrl, commentText, imagePath = '') {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const items = [];
    if (commentText && imagePath) items.push({ type: 'image', content: imagePath, caption: commentText });
    else if (imagePath) items.push({ type: 'image', content: imagePath, caption: '' });
    else if (commentText) items.push({ type: 'text', content: commentText, caption: '' });
    if (items.length === 0) return false;
    const results = await sendMultipleComments(page, items);
    return results.some(r => r.sent);
}

async function commentOnMatchingResults(page, results, config) {
    for (const doc of results) {
        if (!doc.isMatching) continue;

        let bankComments = await AiComment.find({ userId: config.userId, isActive: true }).sort({ order: 1 }).lean();
        let itemsToSend = [];

        if (bankComments && bankComments.length > 0) {
            itemsToSend = bankComments.map(bc => ({ type: bc.type, content: bc.content, caption: bc.caption || '' }));
        } else if (config.commentItems && config.commentItems.length > 0) {
            itemsToSend = config.commentItems.map(ci => ({ type: ci.type, content: ci.content, caption: ci.caption || '' }));
        } else if (config.commentScripts && config.commentScripts.length > 0) {
            const script = config.commentScripts[randomInt(0, config.commentScripts.length - 1)];
            const img = (config.commentImages && config.commentImages.length > 0) ? config.commentImages[randomInt(0, config.commentImages.length - 1)] : '';
            let comment = script.replace(/\{ten_sp\}/g, config.niche || 'sản phẩm').replace(/\{gia\}/g, 'Liên hệ').replace(/\{nganh\}/g, config.niche || '');
            try {
                const ok = await commentOnPostLegacy(page, doc.postUrl, comment, img);
                doc.commentSent = ok;
                doc.commentContent = comment;
                doc.commentImage = img;
                doc.commentedAt = ok ? new Date() : null;
                const legacy = [];
                if (comment) legacy.push({ type: 'text', content: comment, sent: ok, error: ok ? '' : 'Không tìm thấy ô comment', sentAt: ok ? new Date() : null });
                if (img) legacy.push({ type: 'image', content: img, caption: comment, sent: ok, error: ok ? '' : 'Không tìm thấy ô comment', sentAt: ok ? new Date() : null });
                doc.comments = legacy;
                if (!ok) doc.commentError = 'Không tìm thấy ô comment';
            } catch (err) { doc.commentError = err.message; }
            await doc.save();
            await wait(randomInt(1500, 3000));
            continue;
        }

        if (itemsToSend.length === 0) continue;

        await page.goto(doc.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const commentResults = await sendMultipleComments(page, itemsToSend);
        const anySent = commentResults.some(r => r.sent);
        doc.comments = commentResults;
        doc.commentSent = anySent;
        doc.commentContent = commentResults.filter(r => r.type === 'text').map(r => r.content).join(' | ');
        doc.commentImage = commentResults.find(r => r.type === 'image')?.content || '';
        doc.commentError = commentResults.find(r => r.error)?.error || '';
        doc.commentedAt = anySent ? new Date() : null;
        await doc.save();
        await wait(randomInt(1500, 4000));
    }
}

module.exports = {
    humanLikeTyping,
    uploadFileToComment,
    sendTextComment,
    sendMediaComment,
    sendCommentItem,
    sendMultipleComments,
    commentOnPostLegacy,
    commentOnMatchingResults
};