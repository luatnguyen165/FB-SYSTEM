// utils/facebookUrlUtils.js
// Ported from Python facebook_post_comment_scraper/main.py
// Extract Facebook IDs (user, group, post) from URLs or HTML

const https = require('https');
const http = require('http');

/**
 * Simple HTTP GET helper (no external deps)
 * @param {string} url
 * @param {object} [options] - { cookies: 'key=val;...', timeout: 20000 }
 * @returns {Promise<{ status: number, text: string }>}
 */
function httpGet(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const mod = parsedUrl.protocol === 'https:' ? https : http;
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept-Language': 'en-US,en;q=0.9'
        };
        if (options.cookies) {
            headers['Cookie'] = typeof options.cookies === 'string'
                ? options.cookies
                : Object.entries(options.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        }
        const req = mod.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers,
            timeout: options.timeout || 20000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, text: data }));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.end();
    });
}

// ============================================================
// EXTRACT USER/PAGE ID FROM URL
// Ported from: main.py extract_user_id_from_url()
// ============================================================

/**
 * Extract Facebook User/Page ID from a profile/page URL.
 *
 * Strategy:
 *   1. Try regex on URL patterns (fast, no network):
 *      - profile.php?id=12345
 *      - /profile/12345
 *      - ?id=12345
 *   2. If no match, fetch the HTML page and search for:
 *      - fb://profile/12345
 *      - "profile_owner":"12345"
 *      - "userID":"12345"
 *      - owner_id=12345
 *
 * @param {string} url - Facebook page/profile URL
 * @param {object} [options] - { cookies, timeout }
 * @returns {Promise<string|null>} - The user/page ID or null
 */
async function extractUserIdFromUrl(url, options = {}) {
    // Step 1: Try regex on URL
    const urlPatterns = [
        /profile\.php\?id=(\d+)/,
        /\/profile\/(\d+)/,
        /[?&]id=(\d+)/
    ];

    for (const pattern of urlPatterns) {
        const match = url.match(pattern);
        if (match) {
            console.log(`  ✅ Found User ID in URL: ${match[1]}`);
            return match[1];
        }
    }

    // Step 2: Fetch HTML and search
    console.log(`  No ID in URL, fetching page: ${url}`);
    try {
        const response = await httpGet(url, { cookies: options.cookies, timeout: options.timeout || 20000 });
        const html = response.text;

        const htmlPatterns = [
            /fb:\/\/profile\/(\d+)/,           // BEST signal
            /"profile_owner":"(\d+)"/,
            /"userID":"(\d+)"/,
            /owner_id=(\d+)/
        ];

        for (const pattern of htmlPatterns) {
            const match = html.match(pattern);
            if (match) {
                console.log(`  ✅ Found User ID: ${match[1]}`);
                return match[1];
            }
        }

        console.log('  ❌ User ID not found (profile may be private or login wall)');
        return null;
    } catch (e) {
        console.log(`  ❌ Error fetching URL: ${e.message}`);
        return null;
    }
}

// ============================================================
// EXTRACT GROUP ID FROM URL
// Ported from: main.py extract_group_id_from_url()
// ============================================================

/**
 * Extract Facebook Group ID from a group URL.
 *
 * Strategy:
 *   1. Try regex on URL patterns (fast, no network):
 *      - /groups/12345
 *      - group_id=12345
 *      - gid=12345
 *   2. If no match, fetch the HTML page and search for:
 *      - fb://group/12345
 *      - fb://group/?id=12345
 *      - "group_id":"12345"
 *      - "groupID":"12345"
 *
 * @param {string} url - Facebook group URL
 * @param {object} [options] - { cookies, timeout }
 * @returns {Promise<string|null>} - The group ID or null
 */
async function extractGroupIdFromUrl(url, options = {}) {
    // Step 1: Try regex on URL
    const urlPatterns = [
        /\/groups\/(\d+)/,
        /group_id=(\d+)/,
        /gid=(\d+)/
    ];

    for (const pattern of urlPatterns) {
        const match = url.match(pattern);
        if (match) {
            console.log(`  ✅ Found Group ID in URL: ${match[1]}`);
            return match[1];
        }
    }

    // Step 2: Fetch HTML and search
    console.log(`  No ID in URL, fetching group page: ${url}`);
    try {
        const response = await httpGet(url, { cookies: options.cookies, timeout: options.timeout || 20000 });
        const html = response.text;

        const htmlPatterns = [
            /fb:\/\/group\/(\d+)/,              // BEST signal
            /fb:\/\/group\/\?id=(\d+)/,         // iOS URL format
            /"group_id":"(\d+)"/,
            /"groupID":"(\d+)"/
        ];

        for (const pattern of htmlPatterns) {
            const match = html.match(pattern);
            if (match) {
                console.log(`  ✅ Found Group ID: ${match[1]}`);
                return match[1];
            }
        }

        console.log('  ❌ Group ID not found (group may be private or login wall)');
        return null;
    } catch (e) {
        console.log(`  ❌ Error fetching URL: ${e.message}`);
        return null;
    }
}

// ============================================================
// EXTRACT POST ID FROM URL
// Ported from: main.py extract_post_id_from_url()
// ============================================================

/**
 * Extract Facebook Post ID from a post URL.
 *
 * Strategy:
 *   1. Try regex on URL patterns (fast, no network):
 *      - /groups/NAME/posts/12345
 *      - /posts/12345
 *   2. If no match, fetch HTML and search for:
 *      - storyID (base64 encoded, decode and extract last segment)
 *      - og:url meta tag → extract post ID from permalink
 *
 * @param {string} url - Facebook post URL
 * @param {object} [options] - { cookies, timeout }
 * @returns {Promise<string|null>} - The post ID or null
 */
async function extractPostIdFromUrl(url, options = {}) {
    // Step 1: Try regex on URL
    const urlPatterns = [
        /\/groups\/[^/]+\/posts\/(\d+)/,           // /groups/MemeAddiction/posts/4471339869798423
        /\/posts\/(\d+)/,                           // /posts/12345
    ];

    for (const pattern of urlPatterns) {
        const match = url.match(pattern);
        if (match) {
            console.log(`  ✅ Found Post ID in URL: ${match[1]}`);
            return match[1];
        }
    }

    // Step 2: Fetch HTML and search
    console.log(`  No direct ID in URL, fetching post: ${url}`);
    try {
        const response = await httpGet(url, { cookies: options.cookies, timeout: options.timeout || 20000 });
        const html = response.text;

        let postId = null;

        // Method 1: Try storyID (works with authenticated requests)
        if (options.cookies) {
            const storyIdMatch = html.match(/"storyID":"([^"]+)"/);
            if (storyIdMatch) {
                const storyIdEncoded = storyIdMatch[1];
                try {
                    const storyIdDecoded = Buffer.from(storyIdEncoded, 'base64').toString('utf-8');
                    console.log(`  📝 Decoded storyID: ${storyIdDecoded}`);

                    // Format: S:_USER_ID:POST_ID:POST_ID or similar
                    const parts = storyIdDecoded.split(':');
                    if (parts.length >= 2) {
                        postId = parts[parts.length - 1]; // Last part is the post ID
                        console.log(`  ✅ Found Post ID from storyID: ${postId}`);
                        return postId;
                    }
                } catch (e) {
                    console.log(`  ⚠️ Could not decode storyID: ${e.message}`);
                }
            }
        }

        // Method 2: Extract og:url meta tag (fallback)
        const ogUrlMatch = html.match(/<meta property="og:url" content="([^"]+)"/);
        if (ogUrlMatch) {
            const ogUrl = ogUrlMatch[1].replace(/&/g, '&');

            // Case 1: /posts/POST_ID/
            let m = ogUrl.match(/\/posts\/(?:[^/]+\/)?(\d+)/);
            // Case 2: permalink.php?story_fbid=POST_ID
            if (!m) m = ogUrl.match(/story_fbid=(\d+)/);

            if (m) postId = m[1];
        }

        if (postId) {
            console.log(`  ✅ Found Post ID from og:url: ${postId}`);
            return postId;
        }

        console.log('  ❌ Post ID not found in URL');
        return null;
    } catch (e) {
        console.log(`  ❌ Error fetching URL: ${e.message}`);
        return null;
    }
}

// ============================================================
// POST ID → FEEDBACK ID (for GraphQL comment queries)
// Ported from: main.py convert_post_id_to_feedback_id()
// ============================================================

/**
 * Convert a post ID to a feedback ID using base64 encoding.
 * Used for GraphQL comment/reaction queries.
 *
 * @param {string} postId
 * @returns {string} - Base64 encoded feedback ID
 */
function convertPostIdToFeedbackId(postId) {
    return Buffer.from(`feedback:${postId}`).toString('base64');
}

module.exports = {
    extractUserIdFromUrl,
    extractGroupIdFromUrl,
    extractPostIdFromUrl,
    convertPostIdToFeedbackId,
    httpGet
};