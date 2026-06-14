// services/facebook/reels.js
const fs = require('fs');
const path = require('path');
const { getOrOpenFacebookContext, ACTIVE_FB_SESSIONS } = require('./session');
const { normalizePublishedFacebookUrl } = require('./utils');
const { warmUp, simulateHumanAfterPost } = require('../humanBehaviorService');

const FACEBOOK_REELS_URL = 'https://www.facebook.com/reels/';

function normalizeShopeeLinksInput(shopeeLinks) {
    if (!shopeeLinks) return [];
    if (Array.isArray(shopeeLinks)) {
        return shopeeLinks.map(link => String(link || '').trim()).filter(Boolean);
    }
    if (typeof shopeeLinks === 'string') {
        return shopeeLinks.split(/[\n,;]/).map(link => String(link || '').trim()).filter(Boolean);
    }
    return [String(shopeeLinks).trim()].filter(Boolean);
}

function buildAffiliateCommentTexts(shopeeLinks = []) {
    if (!Array.isArray(shopeeLinks) || !shopeeLinks.length) return [];
    return shopeeLinks
        .map((link) => String(link || '').trim())
        .filter(Boolean)
        .map((link) => `Mua san pham trong video tai day nha moi nguoi: ${link}`);
}

function resolveLocalVideoPath(videoPath = '') {
    const rawPath = String(videoPath || '').trim();
    if (!rawPath) return '';
    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
    const projectRoot = global.USER_DATA_DIR || path.join(__dirname, '..', '..');
    const normalizedRelative = rawPath.replace(/^\/+/, '').replace(/^\.\/+/, '');
    const candidates = [
        path.join(projectRoot, normalizedRelative),
        path.join(projectRoot, 'uploads', 'videos', path.basename(normalizedRelative))
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return rawPath;
}

async function runBotUploadInstant({ page, post }) {
    const videoPath = resolveLocalVideoPath(post?.videoPath || '');
    const shopeeLinks = normalizeShopeeLinksInput(post?.shopeeLinks);
    const { normalizeFacebookProfileUrl } = require('./utils');
    const linkedProfileUrl = normalizeFacebookProfileUrl(post?.profileUrl || '');
    const targetReelsUrl = buildFacebookReelsTargetUrl(linkedProfileUrl);
    const finalCaption = String(post?.content || post?.caption || '').trim();
    const fileInputSelector = 'input[type="file"][accept*="video"]';

    console.log('[Reels Upload] ===== START =====');
    console.log('[Reels Upload] videoPath =', videoPath);
    console.log('[Reels Upload] caption =', JSON.stringify(finalCaption));
    console.log('[Reels Upload] shopeeLinks =', JSON.stringify(shopeeLinks));
    console.log('[Reels Upload] profileUrl =', linkedProfileUrl || '(empty)');

    if (!videoPath) throw new Error('Thieu videoPath de upload Reels');
    if (!fs.existsSync(videoPath)) throw new Error('Khong tim thay file video tren server');

    console.log('[Reels Upload] Bat dau dang Reels...');

    // fanpageUrl phai la https://facebook.com/{fanpageUrl}/reels
    const fanpageUrl = targetReelsUrl;
    console.log('[Reels Upload] Di chuyen den Fanpage Reels:', fanpageUrl);
    await page.goto(fanpageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    // Neu URL chua co /reels thi click vao tab Reels
    if (!fanpageUrl.includes('/reels')) {
        console.log('[Reels Upload] Dang tim va click vao Tab [Reels]...');
        const reelsTabMain = page.locator('xpath=//span[text()="Reels"]').first();
        await reelsTabMain.waitFor({ state: 'visible', timeout: 30000 });
        await reelsTabMain.click();
        console.log('[Reels Upload] Da click vao Tab Reels');
        await page.waitForTimeout(3000);
    } else {
        console.log('[Reels Upload] Da co /reels trong URL, bo qua tab Reels');
    }

    console.log('[Reels Upload] Dang tim nut [Tao thuoc phim]...');
    const createReelsButton = page.locator('xpath=//span[text()="Tạo thước phim"]');
    await createReelsButton.waitFor({ state: 'visible', timeout: 15000 });
    await createReelsButton.click();
    console.log('[Reels Upload] Da click nut Tao thuoc phim');
    await page.waitForTimeout(3000);

    console.log('[Reels Upload] Dang chon file video...');
    await page.waitForSelector(fileInputSelector, { state: 'hidden', timeout: 15000 });
    await page.setInputFiles(fileInputSelector, videoPath);
    console.log('[Reels Upload] Da day file video thanh cong!');

    const nextButtonXpath = 'xpath=//span[text()="Tiếp"]';
    const nextButton = page.locator(nextButtonXpath).first();
    console.log('[Reels Upload] Dang doi nut [Tiep] (Lan 1) sang len...');
    await nextButton.waitFor({ state: 'visible', timeout: 300000 });
    console.log('[Reels Upload] Nut Tiep da hien thi, doi 8s de Facebook check ban quyen xong...');
    await page.waitForTimeout(8000);
    console.log('[Reels Upload] Bam Tiep (Lan 1) - Qua man hinh check ban quyen...');
    await nextButton.click({ force: true });
    await page.waitForTimeout(5000);

    console.log('[Reels Upload] Dang dien mo ta bai viet...');
    const captionSelectors = [
        'div[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        'textarea'
    ];
    let captionInput = null;
    for (const sel of captionSelectors) {
        const loc = page.locator(sel).first();
        const visible = await loc.isVisible().catch(() => false);
        if (visible) { captionInput = loc; break; }
    }
    if (captionInput && finalCaption) {
        await captionInput.click();
        await page.waitForTimeout(500);
        await captionInput.fill(finalCaption);
        console.log('[Reels Upload] Caption da dien xong');
    } else {
        console.log('[Reels Upload] Khong tim thay o caption hoac caption rong');
    }
    await page.waitForTimeout(1000);

    console.log('[Reels Upload] Dang tim nut [Tiep] (Lan 2) dang hien thi...');
    const nextButtonVisible = page.locator('xpath=//span[text()="Tiếp"] >> visible=true').first();
    await nextButtonVisible.waitFor({ state: 'visible', timeout: 15000 });
    await nextButtonVisible.click();
    console.log('[Reels Upload] Da bam Tiep (Lan 2) - Qua tab Cai dat chia se.');
    await page.waitForTimeout(3000);

    console.log('[Reels Upload] Dang tim nut [Dang]...');
    const publishButton = page.locator('xpath=//span[text()="Đăng"] >> visible=true').last();
    await publishButton.waitFor({ state: 'visible', timeout: 15000 });
    await publishButton.click();
    console.log('[Reels Upload] DA BAM DANG THANH CONG!');

    console.log('[Reels Upload] Dang doi 25s de Facebook xuat ban...');
    await page.waitForTimeout(25000);
    console.log('[Reels Upload] Da qua 25s!');

    const reelsTabUrl = targetReelsUrl || 'https://www.facebook.com/reels/';
    console.log('[Reels Upload] Di chuyen vao Tab Reels:', reelsTabUrl);
    await page.goto(reelsTabUrl, { waitUntil: 'load' });
    await page.waitForTimeout(8000);

    const publishedUrlCandidates = [
        page.url(),
        await page.locator('a[href*="/reel/"]').first().getAttribute('href').catch(() => ''),
        await page.locator('a[href*="/reels/"]').first().getAttribute('href').catch(() => ''),
        await page.locator('a[href*="/posts/"]').first().getAttribute('href').catch(() => '')
    ].filter(Boolean);
    const publishedUrl = publishedUrlCandidates
        .map(normalizePublishedFacebookUrl)
        .find(Boolean) || '';
    console.log('[Reels Upload] publishedUrl =', publishedUrl || '(empty)');

    let commentPosted = false;
    if (shopeeLinks.length) {
        console.log('[Reels Upload] Click mo Video Reels moi nhat (O dau tien)...');
        const firstReelCard = page.locator('xpath=(//span[text()="0"])[1] >> visible=true');
        await firstReelCard.waitFor({ state: 'visible', timeout: 15000 });
        await firstReelCard.click();
        await page.waitForTimeout(2000);

        console.log('[Reels Upload] Tiep can o binh luan Reels...');
        const commentSelector = 'div[role="textbox"][aria-label*="Bình luận dưới tên"] >> visible=true';
        const commentInput = page.locator(commentSelector).first();
        await commentInput.waitFor({ state: 'visible', timeout: 15000 });
        await commentInput.focus();
        await commentInput.click();
        await page.waitForTimeout(1000);

        const submitCommentBtn = page.locator('div[role="button"][aria-label="Đăng bình luận"] >> visible=true').first();
        await submitCommentBtn.waitFor({ state: 'visible', timeout: 10000 });

        const affiliateCommentTexts = buildAffiliateCommentTexts(shopeeLinks);
        console.log('[Reels Upload] So comment affiliate:', affiliateCommentTexts.length);
        for (const commentText of affiliateCommentTexts) {
            await commentInput.focus();
            await commentInput.click();
            await page.waitForTimeout(800);
            await commentInput.pressSequentially(commentText, { delay: 30 });
            await page.waitForTimeout(1500);
            await submitCommentBtn.click();
            await page.waitForTimeout(5000);
            commentPosted = true;
            console.log('[Reels Upload] Da gui binh luan affiliate thanh cong!');
        }
        await page.waitForTimeout(4000);
    }

    console.log('[Reels Upload] Warming up after posting video...');
    await warmUp(page, { minInteractions: 3, maxInteractions: 6 });
    console.log('[Reels Upload] Warm-up complete');

    console.log('[Reels Upload] Simulating human behavior after posting...');
    await simulateHumanAfterPost(page, { minWait: 5000, maxWait: 10000, shouldLikeOwnPost: true });
    console.log('[Reels Upload] Post-publish behavior complete');

    console.log('[Reels Upload] ===== END =====');

    return {
        success: true,
        message: commentPosted
            ? 'Da upload Reels va dang binh luan Shopee thanh cong'
            : 'Da upload Reels thanh cong',
        shopeeLinksUsed: shopeeLinks,
        publishedUrl
    };
}

async function runBotUploadInstantWithAccount({ userId, accountName, accountType = 'Cá nhân', post, headless = false }) {
    const { context, sessionKey, isExternal } = await getOrOpenFacebookContext(userId, accountName, accountType, 'FB', { headless });

    try {
        const page = context.pages()[0] || await context.newPage();
        const result = await runBotUploadInstant({ page, post });
        return result;
    } finally {
        console.log(`[Reels Upload] Đợi 15s rồi đóng Chromium...`);
        await new Promise(resolve => setTimeout(resolve, 15000)).catch(() => {});
        try { await context.close(); } catch(e) {}
        ACTIVE_FB_SESSIONS.delete(sessionKey);
        console.log(`[Reels Upload] Chromium đã đóng.`);
    }
}

function buildFacebookReelsTargetUrl(profileUrl = '') {
    const { normalizeFacebookProfileUrl } = require('./utils');
    const normalizedProfileUrl = normalizeFacebookProfileUrl(profileUrl);
    if (!normalizedProfileUrl) return FACEBOOK_REELS_URL;

    try {
        const url = new URL(normalizedProfileUrl);
        const pathname = url.pathname.toLowerCase();

        if (pathname.includes('/reels')) {
            return normalizedProfileUrl;
        }

        if (pathname.includes('profile.php')) {
            return FACEBOOK_REELS_URL;
        }

        const basePath = url.pathname.replace(/\/+$/, '');
        return `${url.origin}${basePath}/reels/`;
    } catch (err) {
        return FACEBOOK_REELS_URL;
    }
}

module.exports = {
    FACEBOOK_REELS_URL,
    normalizeShopeeLinksInput,
    buildAffiliateCommentTexts,
    resolveLocalVideoPath,
    runBotUploadInstant,
    runBotUploadInstantWithAccount,
    buildFacebookReelsTargetUrl
};