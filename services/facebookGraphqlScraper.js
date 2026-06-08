// services/facebookGraphqlScraper.js
// 1:1 port from Python group_post_scraper_v2.py

const fs = require('fs');
const path = require('path');
const https = require('https');

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';
const DOC_ID = '25716860671307636';

let GROUP_NAME = null;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildCookieString(cookies) {
    if (!cookies || typeof cookies !== 'object') return '';
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function httpPost(url, headers, body, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = https.request({
            hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
            headers, timeout
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve({ status: res.statusCode, text: data }));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function extractDataBlocks(rawText) {
    const blocks = [];
    let i = 0;
    const n = rawText.length;
    while (true) {
        const idx = rawText.indexOf('"data"', i);
        if (idx === -1) break;
        const bs = rawText.indexOf('{', idx);
        if (bs === -1) break;
        let depth = 0, j;
        for (j = bs; j < n; j++) {
            if (rawText[j] === '{') depth++;
            else if (rawText[j] === '}') { depth--; if (depth === 0) { try { blocks.push(JSON.parse(rawText.slice(bs, j+1))); } catch(e){} i = j+1; break; } }
        }
        if (j >= n) break;
    }
    return blocks;
}

function cleanDataBlocks(blocks) {
    return blocks.filter(b => { if (!b || typeof b !== 'object') return false; delete b.errors; delete b.extensions; return true; });
}

function parseFbResponse(text) {
    return cleanDataBlocks(extractDataBlocks(text.replace('for (;;);', '').trim()));
}

function extractGroupName(node) {
    try {
        const cs = node.comet_sections || {};
        const story1 = (cs.context_layout || {}).story || {};
        const title = (story1.comet_sections || {}).title || {};
        const titleStory = title.story || {};
        const to = titleStory.to || {};
        if (to.__typename === 'Group') return to.name;
        const contentStory = (cs.content || {}).story || {};
        const tg = contentStory.target_group || {};
        if (tg.name) return tg.name;
        const ag = (node.feedback || {}).associated_group || {};
        if (ag.name) return ag.name;
        return null;
    } catch(e) { return null; }
}

function extractCommentCount(node) {
    try {
        const fb = node.feedback || {};
        const p1 = (fb.comment_rendering_instance || {}).comments || {};
        if (p1.total_count != null) return p1.total_count;

        const cs = node.comet_sections || {};
        const story = (cs.feedback || {}).story || {};
        const ufiStory = (story.story_ufi_container || {}).story || {};
        const ft = (ufiStory.feedback_context || {}).feedback_target_with_context || {};
        const p2 = (ft.comment_rendering_instance || {}).comments || {};
        if (p2.total_count != null) return p2.total_count;

        const uf = (ft.comet_ufi_summary_and_actions_renderer || {}).feedback || {};
        const p3 = (uf.comment_rendering_instance || {}).comments || {};
        if (p3.total_count != null) return p3.total_count;

        const csr = (fb.comments_count_summary_renderer || {}).feedback || {};
        const p5 = (csr.comment_rendering_instance || {}).comments || {};
        if (p5.total_count != null) return p5.total_count;

        return 0;
    } catch(e) { return 0; }
}

function isReelOrVideoPost(node) {
    if (!node || node.__typename !== 'Story') return false;
    const cs = node.comet_sections || {};
    const ct = cs.content || {};
    if ((ct.__typename || '').toLowerCase().includes('reel')) return true;
    for (const att of (node.attachments || [])) {
        if ((att.media || {}).__typename === 'Video') return true;
        if (JSON.stringify(att.media || '').toLowerCase().includes('reel')) return true;
        for (const sub of ((att.all_subattachments || {}).nodes || [])) {
            if ((sub.media || {}).__typename === 'Video') return true;
        }
    }
    return false;
}

function downloadImage(url, postId, idx = 1, saveDir = 'group_post') {
    if (!url || !postId) return Promise.resolve(null);
    return new Promise(resolve => {
        try {
            const dir = path.join(saveDir, String(postId));
            fs.mkdirSync(dir, { recursive: true });
            let ext = '.jpg'; if (url.toLowerCase().includes('.png')) ext = '.png'; else if (url.toLowerCase().includes('.jpeg')) ext = '.jpeg';
            const file = idx === 1 ? `${postId}${ext}` : `${postId}_${idx}${ext}`;
            const fp = path.join(dir, file);
            https.get(url, {timeout:30000}, res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => { fs.writeFileSync(fp, Buffer.concat(chunks)); console.log(`  📥 Downloaded: ${file}`); resolve(file); });
                res.on('error', () => resolve(null));
            }).on('error', () => resolve(null));
        } catch(e) { resolve(null); }
    });
}

async function extractMedia(node, postId, saveDir) {
    const media = { photos: [], videos: [] };
    let idx = 0, lastId = null;
    for (const att of (node.attachments||[])) {
        const m = att.media || {};
        if (m.__typename === 'Photo') {
            const pd = (((att.styles||{}).attachment||{}).media||{});
            if (pd.photo_image) { idx++; lastId = m.id; const u = pd.photo_image.uri; const f = await downloadImage(u, postId, idx, saveDir); media.photos.push({id:m.id,url:u,width:pd.photo_image.width,height:pd.photo_image.height,saved_as:f}); }
        }
        for (const sub of ((att.all_subattachments||{}).nodes||[])) {
            const sm = sub.media||{};
            if (sm.__typename === 'Photo') { idx++; lastId = sm.id; if (sm.image) { const u = sm.image.uri; const f = await downloadImage(u, postId, idx, saveDir); media.photos.push({id:sm.id,url:u,width:sm.image.width,height:sm.image.height,saved_as:f}); } }
        }
        if (m.__typename === 'Video') { media.videos.push({id:m.id,url:m.playable_url,thumbnail:((m.preferred_thumbnail||{}).image||{}).uri}); }
    }
    return media;
}

function extractPostData(node, groupName, saveDir) {
    if (!node || node.__typename !== 'Story') return null;
    const cs = ((node.comet_sections||{}).content||{}).story||{};
    const msg = (cs.message||{}).text || '';
    const pid = node.post_id;
    if (!pid) return null;
    if (!groupName) groupName = extractGroupName(node);
    const nf = groupName ? groupName.replace(/[^a-zA-Z0-9\s\-_]/g,'').trim()||'Unknown' : 'Unknown';
    return { id: node.id, post_id: pid, message: msg, comment_count: extractCommentCount(node), group_name: groupName, permalink: node.permalink_url||'', postUrl: node.permalink_url||`https://www.facebook.com/groups/${pid}`, photos: [], videos: [] };
}

module.exports = { fetchGroupPosts, parseFbResponse, extractDataBlocks, extractGroupName, extractCommentCount, isReelOrVideoPost, extractPostData, extractMedia, downloadImage };

async function fetchGroupPosts({ groupId, cookies = {}, fbDtsg = '', limit = 10, minComments = 0 }) {
    console.log(`[GraphQL Scraper] Starting: groupId=${groupId}, limit=${limit}`);

    const allPosts = [];
    let cursor = null, pageNum = 1;
    GROUP_NAME = null;

    const headers = { 'user-agent': 'Mozilla/5.0', 'content-type': 'application/x-www-form-urlencoded', 'origin': 'https://www.facebook.com', 'referer': `https://www.facebook.com/groups/${groupId}/` };
    const cookieStr = buildCookieString(cookies);

    while (allPosts.length < limit) {
        console.log(`\nFetching page ${pageNum}...`);

        const variables = { count: 3, cursor, feedLocation: 'GROUP', feedType: 'DISCUSSION', feedbackSource: 0, filterTopicId: null, focusCommentID: null, privacySelectorRenderLocation: 'COMET_STREAM', renderLocation: 'group', scale: 2, stream_initial_count: 1, useDefaultActor: false, id: groupId };
        const payload = new URLSearchParams({ av: cookies.c_user||'0', __user: cookies.c_user||'0', __a: '1', fb_dtsg: fbDtsg||'', doc_id: DOC_ID, variables: JSON.stringify(variables) });

        let r;
        try { r = await httpPost(GRAPHQL_URL, {...headers, cookie: cookieStr}, payload.toString()); } catch(e) { console.log(`  ⚠️ Request failed: ${e.message}`); break; }
        if (r.status !== 200) { console.log(`  ⚠️ Status ${r.status}, response: ${r.text.substring(0,200)}`); break; }

        console.log(`  Response length: ${r.text.length}`);
        console.log(`  Response preview: ${r.text.substring(0,200)}`);

        const data = parseFbResponse(r.text);
        console.log(`  Parsed blocks: ${data.length}`);
        if (!data.length) break;

        let postsFound = 0, nextCursor = null;
        for (const item of data) {
            if (typeof item !== 'object' || !item) continue;
            const node = item.node || {};
            const storyNodes = [];
            if (node.__typename === 'Story') storyNodes.push(node);
            else if (node.__typename === 'Group') { for (const e of ((node.group_feed||{}).edges||[])) { if ((e.node||{}).__typename === 'Story') storyNodes.push(e.node); } }

            for (const sn of storyNodes) {
                if (allPosts.length >= limit) break;
                if (isReelOrVideoPost(sn)) { console.log(`  ⏭️ Skip reel/video`); continue; }
                const cc = extractCommentCount(sn);
                if (minComments > 0 && cc < minComments) continue;
                if (!GROUP_NAME) { GROUP_NAME = extractGroupName(sn); if (GROUP_NAME) console.log(`📂 Group: ${GROUP_NAME}`); }
                const pd = extractPostData(sn, GROUP_NAME);
                if (pd) { allPosts.push(pd); postsFound++; console.log(`  - Post: ${pd.post_id}`); }
            }
            if (allPosts.length >= limit) break;
            if (item.page_info && item.page_info.has_next_page) nextCursor = item.page_info.end_cursor;
        }

        console.log(`Found ${postsFound} posts on page ${pageNum}`);
        if (!nextCursor || allPosts.length >= limit) break;
        cursor = nextCursor;
        pageNum++;
        await wait(2000);
    }

    console.log(`[GraphQL Scraper] Total: ${allPosts.length} posts`);
    return allPosts;
}

module.exports = { fetchGroupPosts, parseFbResponse, extractDataBlocks, extractGroupName, extractCommentCount, isReelOrVideoPost, extractPostData, extractMedia, downloadImage };