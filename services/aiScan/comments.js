// services/aiScan/comments.js
const fs = require('fs');
const { resolveFilePath, randomInt, wait } = require('./helpers');

async function humanLikeTyping(page, text) {
    for (const char of text) {
        await page.keyboard.type(char, { delay: randomInt(20, 60) });
        if (Math.random() < 0.01) await wait(randomInt(300, 700));
    }
}

async function uploadFileToComment(page, filePath, isVideo = false) {
    try {
        const resolvedPath = resolveFilePath(filePath);
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
            console.log(`[Comment] File not found: ${filePath} (resolved: ${resolvedPath})`);
            return false;
        }

        const fileSize = fs.statSync(resolvedPath).size;
        console.log(`[Comment] Uploading ${isVideo ? 'video' : 'image'}: ${resolvedPath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

        // Tìm file input - thử nhiều selector
        const fileInputSelectors = [
            'input[type="file"][accept*="video"]',
            'input[type="file"][accept*="image"]',
            'input[type="file"][accept*="media"]',
            'form input[type="file"]',
            'input[type="file"]'
        ];

        for (const sel of fileInputSelectors) {
            const input = page.locator(sel).first();
            if (await input.count().catch(() => 0) > 0) {
                await input.setInputFiles(resolvedPath);
                // Video cần thời gian upload lâu hơn
                const waitTime = isVideo ? Math.max(5000, fileSize / 1024 / 10) : 3000;
                console.log(`[Comment] Waiting ${waitTime}ms for upload...`);
                await page.waitForTimeout(waitTime);
                return true;
            }
        }

        // Fallback: click nút đính kèm
        const attachBtns = [
            'div[aria-label="Đính kèm ảnh hoặc video"]',
            'div[aria-label="Attach a photo or video"]',
            'div[aria-label="Ảnh/video"]',
            'div[aria-label="Đính kèm ảnh"]',
            'div[aria-label="Attach a photo"]',
            'div[aria-label="Add a photo or video"]'
        ];

        for (const sel of attachBtns) {
            const btn = page.locator(sel).first();
            if (await btn.count().catch(() => 0) > 0) {
                await btn.click({ force: true });
                await page.waitForTimeout(1500);
                const fi = page.locator('input[type="file"]').first();
                if (await fi.count().catch(() => 0) > 0) {
                    await fi.setInputFiles(resolvedPath);
                    const waitTime = isVideo ? Math.max(8000, fileSize / 1024 / 10) : 3000;
                    console.log(`[Comment] Waiting ${waitTime}ms for upload via attach button...`);
                    await page.waitForTimeout(waitTime);
                    return true;
                }
                break;
            }
        }

        console.log(`[Comment] No file input found`);
        return false;
    } catch (e) {
        console.error(`[Comment] Upload error:`, e.message);
        return false;
    }
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
    if (!resolvedPath || !fs.existsSync(resolvedPath)) return { sent: false, error: 'File not found: ' + filePath };

    const isVideo = mediaType === 'video' || filePath.match(/\.(mp4|mov|avi|mkv|webm)$/i);
    console.log(`[Comment] Sending ${isVideo ? 'video' : 'image'} comment: ${resolvedPath}`);

    try {
        const selectors = ['div[aria-label="Viết bình luận"]', 'div[aria-label="Write a comment"]', 'div[role="textbox"][contenteditable="true"]'];

        // Focus vào ô comment
        let focused = false;
        for (const sel of selectors) {
            const loc = page.locator(sel).first();
            if (await loc.count().catch(() => 0) > 0) {
                await loc.click({ force: true });
                await page.waitForTimeout(500);
                focused = true;
                break;
            }
        }
        if (!focused) return { sent: false, error: 'Không tìm thấy ô comment' };

        // Upload file
        if (!await uploadFileToComment(page, resolvedPath, isVideo)) {
            return { sent: false, error: 'Không thể upload file' };
        }

        // Đợi video upload xong (hiển thị progress bar biến mất)
        if (isVideo) {
            console.log(`[Comment] Waiting for video processing...`);
            await page.waitForTimeout(randomInt(3000, 6000));
        }

        // Nhập caption nếu có
        if (caption) {
            await page.waitForTimeout(500);
            for (const sel of selectors) {
                const loc = page.locator(sel).first();
                if (await loc.count().catch(() => 0) > 0) {
                    await loc.click({ force: true });
                    await page.waitForTimeout(300);
                    await humanLikeTyping(page, ' ' + caption);
                    await page.waitForTimeout(500);
                    break;
                }
            }
        }

        // Gửi comment
        await page.keyboard.press('Enter');
        await page.waitForTimeout(isVideo ? 5000 : 3000);

        console.log(`[Comment] ✓ Sent successfully`);
        return { sent: true, error: '' };
    } catch (e) {
        console.error(`[Comment] Error:`, e.message);
        return { sent: false, error: e.message };
    }
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

async function commentOnPostLegacy(page, postUrl, commentText, filePath = '') {
    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const items = [];
    if (commentText && filePath) {
        const isVideo = filePath.match(/\.(mp4|mov|avi|mkv|webm)$/i);
        items.push({ type: isVideo ? 'video' : 'image', content: filePath, caption: commentText });
    } else if (filePath) {
        const isVideo = filePath.match(/\.(mp4|mov|avi|mkv|webm)$/i);
        items.push({ type: isVideo ? 'video' : 'image', content: filePath, caption: '' });
    } else if (commentText) {
        items.push({ type: 'text', content: commentText, caption: '' });
    }
    if (items.length === 0) return false;
    const results = await sendMultipleComments(page, items);
    return results.some(r => r.sent);
}

async function commentOnMatchingResults(page, results, config) {
    for (const doc of results) {
        if (!doc.isMatching) continue;

        // Lấy commentItems từ config (chỉ lấy những item được chọn)
        const selectedComments = (config.commentItems || []).filter(ci => ci.selected !== false);
        let itemsToSend = [];

        if (selectedComments.length > 0) {
            // Chọn ngẫu nhiên 1 comment từ danh sách đã chọn
            const picked = selectedComments[randomInt(0, selectedComments.length - 1)];
            itemsToSend = [{ type: picked.type, content: picked.content, caption: picked.caption || '' }];
            console.log(`[Comment] Picked: type=${picked.type}, name="${picked.name || ''}"`);
        }

        if (itemsToSend.length === 0) continue;

        await page.goto(doc.postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        const commentResults = await sendMultipleComments(page, itemsToSend);
        const anySent = commentResults.some(r => r.sent);
        doc.comments = commentResults;
        doc.commentSent = anySent;
        doc.commentContent = commentResults.filter(r => r.type === 'text').map(r => r.content).join(' | ');
        doc.commentImage = commentResults.find(r => r.type === 'image' || r.type === 'video')?.content || '';
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