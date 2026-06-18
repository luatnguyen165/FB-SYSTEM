// services/facebook/comment.js
const fs = require('fs');
const { getOrOpenFacebookContext, ACTIVE_FB_SESSIONS } = require('./session');
const { normalizeEncryptedValue } = require('../../utils/cryptoVault');

const wait = ms => new Promise(r => setTimeout(r, ms));

async function uploadFileToComment(page, filePath) {
    console.log('  step=upload: Bat dau upload file', filePath);
    try {
        if (!filePath || !fs.existsSync(filePath)) {
            console.log('  step=upload: File khong ton tai ->', filePath);
            return false;
        }

        const attachBtns = [
            'div[aria-label="Đính kèm một ảnh hoặc video"]',
            'div[aria-label="Attach a photo"]',
            'div[aria-label="Anh/video"]'
        ];

        for (const selBtn of attachBtns) {
            const btn = page.locator(selBtn).first();
            if (await btn.count() > 0) {
                console.log('  step=upload: Dang click vao nut:', selBtn);
                const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 5000 });
                await btn.click({ force: true });
                try {
                    const fileChooser = await fileChooserPromise;
                    await fileChooser.setFiles(filePath);
                    await page.waitForTimeout(2000);
                    console.log('  step=upload: Upload OK qua filechooser');
                    return true;
                } catch (e) {
                    console.log('  step=upload: Khong bat duoc filechooser qua click, thu cach thay the...');
                }
            }
        }

        console.log('  step=upload: KHONG tim thay input file nao');
        return false;
    } catch (e) {
        console.log('  step=upload: LOI ->', e.message);
        return false;
    }
}

async function sendTextComment(page, text) {
    console.log('  step=sendText: Bat dau gui text comment');
    if (!text) {
        console.log('  step=sendText: Text rong, bo qua');
        return { sent: false, error: 'Empty text' };
    }
    var txtStr = String(text);
    console.log('  step=sendText: Text length=', txtStr.length, 'preview=', JSON.stringify(txtStr.substring(0, 60)));

    var selectors = [
        'div[role="textbox"][aria-label*="Bình luận dưới tên"] >> visible=true',
        'div[aria-label*="Comment as"]',
        'div[aria-label="Viet binh luan"]',
        'div[aria-label="Write a comment"]',
        'div[role="textbox"][contenteditable="true"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        var loc = page.locator(sel).first();
        var cnt = await loc.count().catch(function () { return 0; });
        var visible = cnt > 0 ? await loc.isVisible().catch(function () { return false; }) : false;
        console.log('  step=sendText: Selector[' + i + '] =', sel, '| count=', cnt, '| visible=', visible);
        if (cnt > 0) {
            try {
                console.log('  step=sendText: Found comment box via', sel);
                await loc.waitFor({ state: 'visible', timeout: 8000 }).catch(function () { });
                await loc.focus().catch(function () { });
                await loc.click().catch(function () { });
                await wait(1000);

                console.log('  step=sendText: Bat dau go tung ky tu (human-like)...');
                for (var k = 0; k < txtStr.length; k++) {
                    await page.keyboard.type(txtStr[k], { delay: Math.floor(Math.random()*20, 60) });
                }
                console.log('  step=sendText: Da go xong', txtStr.length, 'ky tu');
                await wait(800);
                console.log('  step=sendText: Nhan Enter de post...');
                await page.keyboard.press('Enter');
                await wait(2500);
                console.log('  step=sendText: Da gui Enter xong, doi 2.5s');
                return { sent: true, error: '' };
            } catch (e) {
                console.log('  step=sendText: LOI voi selector nay ->', e.message, '| thu selector tiep theo');
            }
        }
    }
    console.log('  step=sendText: KHONG tim thay o comment nao hoat dong');
    return { sent: false, error: 'Khong tim thay o comment' };
}

async function sendMediaComment(page, filePath, caption, mediaType) {
    console.log('  step=sendMedia: Bat dau gui', mediaType, 'comment');
    if (!filePath) {
        console.log('  step=sendMedia: Thieu filePath');
        return { sent: false, error: 'Missing file path' };
    }
    if (!fs.existsSync(filePath)) {
        console.log('  step=sendMedia: File khong ton tai ->', filePath);
        return { sent: false, error: 'File not found' };
    }

    var selectors = [
        'div[role="textbox"][aria-label*="Bình luận dưới tên"] >> visible=true',
        'div[aria-label*="Comment as"]',
        'div[aria-label="Viet binh luan"]',
        'div[aria-label="Write a comment"]',
        'div[role="textbox"][contenteditable="true"]'
    ];
    var focused = false;
    for (var i = 0; i < selectors.length; i++) {
        var sel = selectors[i];
        var loc = page.locator(sel).first();
        var cnt = await loc.count().catch(function () { return 0; });
        if (cnt > 0) {
            console.log('  step=sendMedia: Found comment box via', sel);
            await loc.waitFor({ state: 'visible', timeout: 8000 }).catch(function () { });
            await loc.focus().catch(function () { });
            await loc.click().catch(function () { });
            await wait(1000);
            focused = true;
            break;
        }
    }
    if (!focused) {
        console.log('  step=sendMedia: KHONG tim thay o comment');
        return { sent: false, error: 'Khong tim thay o comment' };
    }

    var uploadOk = await uploadFileToComment(page, filePath);
    if (!uploadOk) {
        console.log('  step=sendMedia: Upload file that bai');
        return { sent: false, error: 'Khong the upload file' };
    }

    await wait(Math.floor(Math.random()*1500, 3000));

    if (caption) {
        console.log('  step=sendMedia: Go caption (length=', String(caption).length, ')');
        for (var j = 0; j < selectors.length; j++) {
            var selCap = selectors[j];
            var locCap = page.locator(selCap).first();
            if (await locCap.count().catch(function () { return 0; }) > 0) {
                await locCap.click({ force: true });
                await wait(200);
                var cap = ' ' + String(caption);
                for (var m = 0; m < cap.length; m++) {
                    await page.keyboard.type(cap[m], { delay: Math.floor(Math.random()*20, 60) });
                }
                await wait(400);
                break;
            }
        }
    }
    console.log('  step=sendMedia: Nhan Enter de post...');
    await page.keyboard.press('Enter');
    await wait(3500);
    console.log('  step=sendMedia: Da gui xong');
    return { sent: true, error: '' };
}

async function commentOnPost(params) {
    params = params || {};
    var channel = params.channel;
    var postUrl = params.postUrl;
    var commentType = params.commentType || 'text';
    var commentContent = params.commentContent || '';
    var commentFilePath = params.commentFilePath || null;
    var keepOpenMs = params.keepOpenMs != null ? params.keepOpenMs : 10000;
    var comments = params.comments || null;

    console.log("=======================================")
    console.log('BAT DAU CHAY PLAY COMMENT');
    console.log("=======================================")
    console.log('Tham so dau vao:');
    console.log('  - accountName    :', channel && channel.accountName || '(null)');
    console.log('  - accountType    :', channel && channel.accountType || '(null)');
    console.log('  - postUrl        :', postUrl || '(null)');
    console.log('  - commentType    :', commentType);
    console.log('  - commentContent :', JSON.stringify(String(commentContent || '').substring(0, 100)));
    console.log('  - commentFilePath:', commentFilePath || '(null)');
    console.log('  - keepOpenMs     :', keepOpenMs);
    console.log('  - comments count :', comments ? comments.length : 'N/A (single mode)');

    if (!channel) {
        console.log('LOI: Missing channel');
        return { success: false, error: 'Missing channel' };
    }
    if (!postUrl) {
        console.log('LOI: Missing postUrl');
        return { success: false, error: 'Missing postUrl' };
    }

    var context = null;
    var sessionKey = null;

    try {
        console.log('step=1: Goi getOrOpenFacebookContext(headless: false) cho account', channel.accountName);
        const decryptedStoragePath = channel.storageStatePath ? normalizeEncryptedValue(channel.storageStatePath) : '';
        var ctx = await getOrOpenFacebookContext(
            channel.userId,
            channel.accountName,
            channel.accountType || 'Ca nhan',
            'FB',
            { headless: false, existingSessionDir: decryptedStoragePath ? require('path').dirname(decryptedStoragePath) : '' }
        );
        context = ctx.context;
        sessionKey = ctx.sessionKey;
        console.log('step=2: Context da mo thanh cong, sessionKey=', sessionKey);
        console.log('step=2: So page dang mo trong context =', context.pages().length);

        var page = context.pages()[0] || await context.newPage();
        console.log('step=3: Lay page thanh cong');
        console.log('step=3: URL hien tai cua page =', page.url());

        console.log('step=4: bringToFront()...');
        await page.bringToFront().catch(function (e) { console.log('step=4: bringToFront warning ->', e.message); });

        console.log('step=5: Navigate toi postUrl =', postUrl);
        console.log('step=5: (co the mat 3-10s cho FB load)...');
        await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(function (e) {
            console.log('step=5: Page goto warning ->', e.message);
        });
        await wait(2500);
        console.log('step=5: Da navigate xong, URL hien tai =', page.url());

        console.log('step=6: title page =', JSON.stringify(await page.title().catch(function () { return ''; })));

        var allResults = [];
        var commentList = comments && comments.length > 0 ? comments : [{
            type: commentType,
            content: commentContent,
            filePath: commentFilePath
        }];

        for (var i = 0; i < commentList.length; i++) {
            var cmt = commentList[i];
            console.log("=======================================")
            console.log('COMMENT #' + (i + 1) + '/' + commentList.length);
            console.log("=======================================")
            console.log('  - type    :', cmt.type);
            console.log('  - content :', JSON.stringify(String(cmt.content || '').substring(0, 100)));
            console.log('  - filePath:', cmt.filePath || '(null)');
            console.log('  - caption :', JSON.stringify(String(cmt.caption || '').substring(0, 100)));

            var result = { sent: false, error: 'Invalid comment type' };
            if (cmt.type === 'text' && cmt.content) {
                console.log('  -> Nhanh text comment...');
                result = await sendTextComment(page, cmt.content);
            } else if ((cmt.type === 'image' || cmt.type === 'video') && cmt.filePath) {
                console.log('  -> Nhanh', cmt.type, 'comment...');
                result = await sendMediaComment(page, cmt.filePath, cmt.caption || cmt.content, cmt.type);
            } else {
                console.log('  -> LOI - type/content/file khong hop le');
                result = { sent: false, error: 'Invalid: type=' + cmt.type + ', content=' + (!!cmt.content) + ', file=' + (!!cmt.filePath) };
            }

            allResults.push({
                index: i,
                type: cmt.type,
                success: !!result.sent,
                error: result.error || null
            });

            console.log("=======================================")
            if (result.sent) {
                console.log('KET QUA COMMENT #' + (i + 1) + ': THANH CONG');
            } else {
                console.log('KET QUA COMMENT #' + (i + 1) + ': THAT BAI ->', result.error);
            }

            if (i < commentList.length - 1) {
                var delayMs = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000;
                console.log('Delay ' + delayMs + 'ms truoc comment tiep theo...');
                await wait(delayMs);
            }
        }

        console.log("=======================================")
        console.log('TONG KET: ' + allResults.filter(r => r.success).length + '/' + allResults.length + ' comment thanh cong');
        console.log('Buoc tiep theo: GIU BROWSER MO', keepOpenMs, 'ms de ban xem...');
        console.log("=======================================")

        await wait(keepOpenMs);

        console.log('step=final: Dong context va don dep...');
        var successCount = allResults.filter(r => r.success).length;
        return { 
            success: successCount > 0, 
            error: successCount === 0 ? allResults[0]?.error : null,
            results: allResults,
            postedCount: successCount
        };
    } catch (err) {
        console.log('LOI TONG: ', err.message);
        console.log('LOI stack: ', err.stack);
        return { success: false, error: err.message };
    } finally {
        try {
            if (context) {
                await context.close();
                ACTIVE_FB_SESSIONS.delete(sessionKey);
                console.log('step=final: Da dong context, cleanup xong');
            }
        } catch (e) {
            console.log('step=final: Loi khi dong context ->', e.message);
        }
        console.log("=======================================")
        console.log('KET THUC');
        console.log("=======================================")
    }
}

module.exports = {
    uploadFileToComment,
    sendTextComment,
    sendMediaComment,
    commentOnPost
};