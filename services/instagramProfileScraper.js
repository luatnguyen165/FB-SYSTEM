// services/instagramProfileScraper.js
// Scrape thông tin profile Instagram (avatar, username, fullName, profileUrl)
// Dùng XPath selectors dựa trên HTML structure của Instagram

const { getOrOpenSocialContext } = require('./socialPlaywrightService');

/**
 * Scrape Instagram profile (dùng cho profile page, vd: instagram.com/username/)
 * @param {Object} opts
 * @param {string} opts.userId - User ID trong hệ thống
 * @param {string} opts.accountName - Tên tài khoản Instagram (tài khoản đang login)
 * @param {string} opts.accountType - Loại tài khoản (Personal/Business)
 * @param {string} opts.targetUrl - URL profile cần scrape (vd: https://www.instagram.com/nluat6868/)
 * @param {boolean} opts.headless - Chạy headless hay không
 * @param {string} opts.existingSessionDir - Thư mục session hiện có
 * @returns {Object} { avatarUrl, username, fullName, profileUrl, bio, followers, following, posts }
 */
async function scrapeInstagramProfile({ userId, accountName, accountType = 'Personal', targetUrl, headless = false, existingSessionDir = '' }) {
    console.log(`[IG Profile] ===== BẮT ĐẦU scrape: ${targetUrl} =====`);

    if (!userId || !accountName) throw new Error('Thiếu userId hoặc accountName');
    if (!targetUrl) throw new Error('Thiếu targetUrl');

    // Normalize URL
    if (!targetUrl.startsWith('http')) {
        targetUrl = `https://www.instagram.com/${targetUrl.replace(/^\//, '')}`;
    }

    try {
        console.log(`[IG Profile] STEP 1 - Mở context desktop...`);
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'IG', { headless, existingSessionDir });
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.bringToFront().catch(() => {});

        console.log(`[IG Profile] STEP 2 - Navigate to ${targetUrl}...`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        // Kiểm tra login
        if (page.url().includes('login')) {
            throw new Error('Chưa đăng nhập Instagram');
        }

        // Kiểm tra trang tồn tại
        const pageContent = await page.content();
        if (pageContent.includes('Sorry, this page') || pageContent.includes('Page Not Found')) {
            throw new Error('Profile không tồn tại');
        }

        console.log(`[IG Profile] STEP 3 - Đợi trang load...`);
        await page.waitForTimeout(2000);

        // Scrape data bằng page.evaluate + XPath
        console.log(`[IG Profile] STEP 4 - Scrape profile data...`);
        const profileData = await page.evaluate(() => {
            const result = {
                avatarUrl: '',
                username: '',
                fullName: '',
                profileUrl: '',
                bio: '',
                followers: '',
                following: '',
                posts: '',
                isVerified: false,
                isPrivate: false
            };

            // XPath helper
            function xpathNode(xpath, ctx) {
                return document.evaluate(xpath, ctx || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
            }
            function xpathNodes(xpath, ctx) {
                const r = document.evaluate(xpath, ctx || document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                const nodes = [];
                for (let i = 0; i < r.snapshotLength; i++) nodes.push(r.snapshotItem(i));
                return nodes;
            }

            // ═══════════════════════════════════════════════════════
            // BƯỚC 1: TÌM USERNAME (ưu tiên từ URL)
            // ═══════════════════════════════════════════════════════

            // Trên profile page, username có trong URL: /username/
            const urlMatch = window.location.pathname.match(/^\/([^/]+)\/?$/);
            if (urlMatch && urlMatch[1] !== 'explore' && urlMatch[1] !== 'direct' &&
                urlMatch[1] !== 'accounts' && urlMatch[1] !== 'reels' && urlMatch[1] !== 'stories') {
                result.username = urlMatch[1];
                result.profileUrl = 'https://www.instagram.com/' + result.username + '/';
            }

            // Fallback: tìm từ link trong header
            if (!result.username) {
                const headerLinks = xpathNodes("//header//a[@role='link']");
                for (const link of headerLinks) {
                    const href = link.getAttribute('href') || '';
                    const text = link.textContent?.trim() || '';
                    if (href.match(/^\/[^/]+\/$/) && text.length > 0 && text.length < 50 &&
                        !text.includes('Edit') && !text.includes('Chỉnh sửa') &&
                        !text.includes('profile')) {
                        result.username = text;
                        result.profileUrl = 'https://www.instagram.com' + href;
                        break;
                    }
                }
            }

            // ═══════════════════════════════════════════════════════
            // BƯỚC 2: TÌM AVATAR ĐÚNG với username
            // ═══════════════════════════════════════════════════════

            if (result.username) {
                // XPath: //img[contains(@alt,'username')] - alt="Ảnh đại diện của username"
                const avatarXPath = `//img[contains(@alt,'${result.username}')]`;
                const avatarEl = xpathNode(avatarXPath);
                if (avatarEl && avatarEl.src) {
                    result.avatarUrl = avatarEl.src;
                }

                // Fallback: img trong link có href="/username/"
                if (!result.avatarUrl) {
                    const linkImgXPath = `//a[@href='/${result.username}/']//img`;
                    const linkImg = xpathNode(linkImgXPath);
                    if (linkImg && linkImg.src) {
                        result.avatarUrl = linkImg.src;
                    }
                }
            }

            // Fallback: header img có crossorigin + alt chứa "Ảnh đại diện"
            if (!result.avatarUrl) {
                const fallbackXPath = "//header//img[contains(@alt,'Ảnh đại diện') and @crossorigin]";
                const fallbackEl = xpathNode(fallbackXPath);
                if (fallbackEl && fallbackEl.src) {
                    result.avatarUrl = fallbackEl.src;
                }
            }

            // Fallback: header img có crossorigin
            if (!result.avatarUrl) {
                const fallbackEl = xpathNode("//header//img[@crossorigin]");
                if (fallbackEl && fallbackEl.src) {
                    result.avatarUrl = fallbackEl.src;
                }
            }

            // ═══════════════════════════════════════════════════════
            // BƯỚC 3: TÌM FULL NAME
            // ═══════════════════════════════════════════════════════

            // FullName nằm trong header, span không nằm trong <a>
            const headerSpans = xpathNodes("//header//span[not(ancestor::a)]");
            for (const span of headerSpans) {
                const text = span.textContent?.trim() || '';
                if (text.length > 0 && text !== result.username &&
                    !text.match(/^\d/) && !text.includes('followers') &&
                    !text.includes('following') && !text.includes('posts') &&
                    !text.includes('người theo dõi') && !text.includes('bài viết') &&
                    !text.includes('đang theo dõi') && text.length < 100) {
                    const parent = span.parentElement;
                    if (parent && !parent.querySelector('a')) {
                        result.fullName = text;
                        break;
                    }
                }
            }

            // ═══════════════════════════════════════════════════════
            // BƯỚC 4: BIO
            // ═══════════════════════════════════════════════════════

            const bioSection = document.querySelector('header section');
            if (bioSection) {
                const bioSpans = bioSection.querySelectorAll('span[dir="auto"]');
                for (const span of bioSpans) {
                    const text = span.textContent?.trim() || '';
                    if (text.length > 0 && text !== result.username && text !== result.fullName &&
                        !text.match(/^\d/) && !text.includes('followers') && !text.includes('following')) {
                        result.bio = text;
                        break;
                    }
                }
            }

            // ═══════════════════════════════════════════════════════
            // BƯỚC 5: STATS (Posts, Followers, Following)
            // ═══════════════════════════════════════════════════════

            // XPath: //a[contains(@href,'followers')]//span[@title]
            const followersLink = xpathNode("//a[contains(@href,'followers')]");
            if (followersLink) {
                const spanWithTitle = followersLink.querySelector('span[title]');
                if (spanWithTitle) {
                    result.followers = spanWithTitle.getAttribute('title') || '';
                } else {
                    result.followers = followersLink.textContent?.replace(/[^\d.,KkMm]/g, '') || '';
                }
            }

            // XPath: //a[contains(@href,'following')]//span[@title]
            const followingLink = xpathNode("//a[contains(@href,'following')]");
            if (followingLink) {
                const spanWithTitle = followingLink.querySelector('span[title]');
                if (spanWithTitle) {
                    result.following = spanWithTitle.getAttribute('title') || '';
                } else {
                    result.following = followingLink.textContent?.replace(/[^\d.,KkMm]/g, '') || '';
                }
            }

            // Posts: //header//ul/li[contains(.,'posts') or contains(.,'bài viết')]
            const statsList = document.querySelectorAll('header ul li, header section ul li');
            for (const li of statsList) {
                const text = li.textContent?.trim() || '';
                const spanWithTitle = li.querySelector('span[title]');
                if (text.includes('posts') || text.includes('bài viết')) {
                    result.posts = spanWithTitle?.getAttribute('title') || text.replace(/[^\d.,KkMm]/g, '');
                }
            }

            // ═══════════════════════════════════════════════════════
            // BƯỚC 6: VERIFIED & PRIVATE
            // ═══════════════════════════════════════════════════════

            result.isVerified = !!xpathNode("//header//svg[@aria-label='Verified' or @aria-label='Đã xác minh']");
            result.isPrivate = !!document.querySelector('[aria-label="Đây là tài khoản riêng tư"]') ||
                               !!document.querySelector('h2')?.textContent?.includes('Private') ||
                               !!document.querySelector('h2')?.textContent?.includes('Riêng tư');

            return result;
        });

        console.log(`[IG Profile] KẾT QUẢ:`);
        console.log(`  Username: ${profileData.username}`);
        console.log(`  FullName: ${profileData.fullName}`);
        console.log(`  Avatar: ${profileData.avatarUrl?.substring(0, 80)}...`);
        console.log(`  ProfileUrl: ${profileData.profileUrl}`);
        console.log(`  Followers: ${profileData.followers}`);
        console.log(`  Posts: ${profileData.posts}`);
        console.log(`  Verified: ${profileData.isVerified}`);
        console.log(`  Private: ${profileData.isPrivate}`);

        return {
            success: true,
            data: profileData
        };

    } catch (error) {
        console.error(`[IG Profile] LỖI: ${error.message}`);
        return {
            success: false,
            data: null,
            message: error.message
        };
    }
}

/**
 * Scrape Instagram profile bằng Playwright locators (XPath thuần)
 * Dùng khi cần lấy thêm data từ DOM phức tạp
 */
async function scrapeInstagramProfileByXPath({ userId, accountName, accountType = 'Personal', targetUrl, headless = false, existingSessionDir = '' }) {
    console.log(`[IG Profile XPath] ===== BẮT ĐẦU: ${targetUrl} =====`);

    if (!userId || !accountName) throw new Error('Thiếu userId hoặc accountName');
    if (!targetUrl) throw new Error('Thiếu targetUrl');

    if (!targetUrl.startsWith('http')) {
        targetUrl = `https://www.instagram.com/${targetUrl.replace(/^\//, '')}`;
    }

    try {
        const { context } = await getOrOpenSocialContext(userId, accountName, accountType, 'IG', { headless, existingSessionDir });
        const pages = context.pages();
        const page = pages.length > 0 ? pages[0] : await context.newPage();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.bringToFront().catch(() => {});

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(3000);

        if (page.url().includes('login')) throw new Error('Chưa đăng nhập Instagram');

        const profileData = {
            avatarUrl: '',
            username: '',
            fullName: '',
            profileUrl: '',
            bio: '',
            followers: '',
            following: '',
            posts: '',
            isVerified: false,
            isPrivate: false
        };

        // === USERNAME từ URL (chính xác nhất) ===
        const urlMatch = page.url().match(/instagram\.com\/([^/?]+)/);
        if (urlMatch && urlMatch[1] !== 'explore' && urlMatch[1] !== 'direct' &&
            urlMatch[1] !== 'accounts' && urlMatch[1] !== 'reels' && urlMatch[1] !== 'stories') {
            profileData.username = urlMatch[1];
            profileData.profileUrl = `https://www.instagram.com/${profileData.username}/`;
            console.log(`[IG Profile XPath] Username từ URL: ${profileData.username}`);
        }

        // === AVATAR bằng XPath (dùng username để filter) ===
        if (profileData.username) {
            // //img[contains(@alt,'username')] - alt="Ảnh đại diện của username"
            const avatarXPath = `//img[contains(@alt,'${profileData.username}')]`;
            const avatarEl = page.locator(avatarXPath).first();
            if (await avatarEl.count() > 0) {
                profileData.avatarUrl = await avatarEl.getAttribute('src') || '';
                console.log(`[IG Profile XPath] Avatar: ${profileData.avatarUrl.substring(0, 60)}...`);
            }

            // Fallback: img trong link href="/username/"
            if (!profileData.avatarUrl) {
                const linkImgXPath = `//a[@href='/${profileData.username}/']//img`;
                const linkImgEl = page.locator(linkImgXPath).first();
                if (await linkImgEl.count() > 0) {
                    profileData.avatarUrl = await linkImgEl.getAttribute('src') || '';
                    console.log(`[IG Profile XPath] Avatar (fallback link): ${profileData.avatarUrl.substring(0, 60)}...`);
                }
            }
        }

        // Fallback: header img crossorigin + alt "Ảnh đại diện"
        if (!profileData.avatarUrl) {
            const fallbackXPath = "//header//img[contains(@alt,'Ảnh đại diện') and @crossorigin]";
            const fallbackEl = page.locator(fallbackXPath).first();
            if (await fallbackEl.count() > 0) {
                profileData.avatarUrl = await fallbackEl.getAttribute('src') || '';
            }
        }

        // === FULL NAME bằng XPath ===
        const fullNameXPath = "//header//span[not(ancestor::a)][string-length(normalize-space(text())) > 0][string-length(normalize-space(text())) < 100]";
        const fullNameEls = page.locator(fullNameXPath);
        const fnCount = await fullNameEls.count();
        for (let i = 0; i < fnCount; i++) {
            const text = (await fullNameEls.nth(i).textContent() || '').trim();
            if (text && text !== profileData.username &&
                !text.match(/^\d/) && !text.includes('followers') &&
                !text.includes('following') && !text.includes('posts') &&
                !text.includes('người theo dõi') && !text.includes('bài viết')) {
                profileData.fullName = text;
                console.log(`[IG Profile XPath] FullName: ${profileData.fullName}`);
                break;
            }
        }

        // === FOLLOWERS bằng XPath ===
        const followersXPath = "//a[contains(@href,'followers')]";
        const followersEl = page.locator(followersXPath).first();
        if (await followersEl.count() > 0) {
            const spanWithTitle = followersEl.locator("span[title]");
            if (await spanWithTitle.count() > 0) {
                profileData.followers = await spanWithTitle.first().getAttribute('title') || '';
            } else {
                profileData.followers = (await followersEl.textContent() || '').replace(/[^\d.,KkMm]/g, '');
            }
            console.log(`[IG Profile XPath] Followers: ${profileData.followers}`);
        }

        // === FOLLOWING bằng XPath ===
        const followingXPath = "//a[contains(@href,'following')]";
        const followingEl = page.locator(followingXPath).first();
        if (await followingEl.count() > 0) {
            const spanWithTitle = followingEl.locator("span[title]");
            if (await spanWithTitle.count() > 0) {
                profileData.following = await spanWithTitle.first().getAttribute('title') || '';
            } else {
                profileData.following = (await followingEl.textContent() || '').replace(/[^\d.,KkMm]/g, '');
            }
            console.log(`[IG Profile XPath] Following: ${profileData.following}`);
        }

        // === POSTS bằng XPath ===
        const postsXPath = "//header//ul/li[contains(.,'posts') or contains(.,'bài viết')]";
        const postsEl = page.locator(postsXPath).first();
        if (await postsEl.count() > 0) {
            const spanWithTitle = postsEl.locator("span[title]");
            if (await spanWithTitle.count() > 0) {
                profileData.posts = await spanWithTitle.first().getAttribute('title') || '';
            } else {
                profileData.posts = (await postsEl.textContent() || '').replace(/[^\d.,KkMm]/g, '');
            }
            console.log(`[IG Profile XPath] Posts: ${profileData.posts}`);
        }

        // === VERIFIED bằng XPath ===
        const verifiedXPath = "//header//svg[@aria-label='Verified' or @aria-label='Đã xác minh']";
        profileData.isVerified = await page.locator(verifiedXPath).count() > 0;
        console.log(`[IG Profile XPath] Verified: ${profileData.isVerified}`);

        // === PRIVATE bằng XPath ===
        const privateXPath = "//h2[contains(text(),'Private') or contains(text(),'Riêng tư')]";
        profileData.isPrivate = await page.locator(privateXPath).count() > 0;
        console.log(`[IG Profile XPath] Private: ${profileData.isPrivate}`);

        console.log(`[IG Profile XPath] HOÀN THÀNH`);
        return { success: true, data: profileData };

    } catch (error) {
        console.error(`[IG Profile XPath] LỖI: ${error.message}`);
        return { success: false, data: null, message: error.message };
    }
}

module.exports = { scrapeInstagramProfile, scrapeInstagramProfileByXPath };
