// public/js/competitors.js
(function () {
    'use strict';

    var API = '/competitors/api';
    var postsId = null;
    var postsPage = 1;
    var gridEl = null;
    var currentPlatform = '';
    var allPostsPage = 1;

    function api(url, opts) {
        opts = opts || {};
        return fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            method: opts.method || 'GET',
            body: opts.body || undefined
        }).then(function (r) { return r.json(); }).then(function (d) {
            if (!d.success) throw new Error(d.message || 'Lỗi');
            return d.data || d;
        });
    }

    function toast(msg, type) {
        type = type || 'success';
        if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
        var el = document.createElement('div');
        el.className = 'toast toast--' + type;
        el.textContent = msg;
        el.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;z-index:9999;font-size:14px;background:' + (type === 'error' ? '#ef4444' : '#10b981');
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 3000);
    }

    function modalOpen(id) {
        var el = document.getElementById(id);
        if (el) { el.style.display = 'flex'; void el.offsetHeight; el.classList.add('is-visible'); document.body.style.overflow = 'hidden'; }
    }
    function modalClose(id) {
        var el = document.getElementById(id);
        if (el) { el.classList.remove('is-visible'); setTimeout(function () { el.style.display = 'none'; document.body.style.overflow = ''; }, 300); }
    }

    function getMediaHtml(media, mediaUrl) {
        var url = '';
        if (mediaUrl && /\.(jpg|jpeg|png|gif|webp)/i.test(mediaUrl)) url = mediaUrl;
        else if (media && media.length > 0) {
            var first = media[0];
            if (first.saved_as && /\.(jpg|jpeg|png|gif|webp)/i.test(first.saved_as)) url = first.saved_as;
            else if (first.url && /\.(jpg|jpeg|png|gif|webp)/i.test(first.url)) url = first.url;
        }
        if (url) {
            return '<img src="' + url + '" data-act="preview" data-src="' + url + '" style="width:40px;height:40px;border-radius:4px;object-fit:cover;cursor:pointer;border:1px solid var(--border);" title="Click xem ảnh">';
        }
        if (media && media.length) return '<i class="fa-solid fa-images"></i> ' + media.length;
        return '--';
    }

    function handleClick(e) {
        var t = e.target.closest('[data-act]');
        if (!t) return;
        var act = t.getAttribute('data-act');
        var id = t.getAttribute('data-id');
        var pg = t.getAttribute('data-page');
        if (!id && !pg) return;

        switch (act) {
            case 'scrape': {
                var scrapeBtn = t;
                scrapeBtn.disabled = true;
                scrapeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
                scrapeBtn.title = 'Đang scrape...';
                api(API + '/' + id + '/scrape', { method: 'POST' }).then(function () {
                    toast('Đang scrape...', 'success');
                    var pollCount = 0;
                    var maxPolls = 120;
                    var pollInterval = setInterval(function() {
                        pollCount++;
                        api(API + '/' + id + '/status').then(function(st) {
                            if (!st.scraping) {
                                clearInterval(pollInterval);
                                toast('Scrape hoàn tất!', 'success');
                                setTimeout(function() { location.reload(); }, 500);
                            } else if (pollCount >= maxPolls) {
                                clearInterval(pollInterval);
                                toast('Quá lâu, thử lại', 'error');
                                scrapeBtn.disabled = false;
                                scrapeBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
                                scrapeBtn.title = 'Lấy bài viết';
                            }
                        }).catch(function() {});
                    }, 3000);
                }).catch(function(err) {
                    toast(err.message, 'error');
                    scrapeBtn.disabled = false;
                    scrapeBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
                    scrapeBtn.title = 'Lấy bài viết';
                });
                break;
            }
            case 'edit':
                api(API + '/list').then(function (data) {
                    var c = data.find(function (x) { return x._id === id; });
                    if (!c) { toast('Không tìm thấy', 'error'); return; }
                    document.getElementById('modalTitle').textContent = 'Chỉnh Sửa';
                    var formSubmitSpan = document.getElementById('formSubmitText');
                    if (formSubmitSpan) formSubmitSpan.textContent = 'Cập nhật';
                    document.getElementById('formCompetitorId').value = c._id;
                    document.getElementById('formName').value = c.name;
                    document.getElementById('formPlatform').value = c.platform;
                    document.getElementById('formProfileUrl').value = c.profileUrl;
                    document.getElementById('formAvatarUrl').value = c.avatarUrl || '';
                    document.getElementById('formNotes').value = c.notes || '';
                    if (document.getElementById('formChannelId')) document.getElementById('formChannelId').value = c.channelId || '';
                    if (document.getElementById('formPostLimit')) document.getElementById('formPostLimit').value = c.postLimit || 10;
                    updateProfileUrlField();
                    modalOpen('competitorModal');
                });
                break;
            case 'toggle':
                api(API + '/' + id + '/toggle', { method: 'PATCH' }).then(function () { toast('Đã cập nhật'); setTimeout(function () { location.reload(); }, 500); });
                break;
            case 'delete':
                var card = document.querySelector('[data-id="' + id + '"]');
                var nm = card ? (card.querySelector('.competitor-card__info h4')?.textContent || '') : '';
                if (!confirm('Xóa "' + (nm || 'đối thủ') + '"?')) return;
                api(API + '/' + id, { method: 'DELETE' }).then(function () { toast('Đã xóa'); setTimeout(function () { location.reload(); }, 500); });
                break;
            case 'posts':
                postsId = id; postsPage = 1;
                var n1 = '';
                var c1 = document.querySelector('[data-id="' + id + '"]');
                if (c1) { var h1 = c1.querySelector('.competitor-card__info h4'); if (h1) n1 = h1.textContent || ''; }
                document.getElementById('postsModalTitle').textContent = 'Bài Viết' + (n1 ? ' - ' + n1 : '');
                document.getElementById('btnAddPost').onclick = function () { document.getElementById('postFormCompetitorId').value = id; document.getElementById('addPostForm').reset(); modalOpen('addPostModal'); };
                modalOpen('postsModal');
                loadPosts(id, 1);
                break;
            case 'trend':
                var n2 = '';
                var c2 = document.querySelector('[data-id="' + id + '"]');
                if (c2) { var h2 = c2.querySelector('.competitor-card__info h4'); if (h2) n2 = h2.textContent || ''; }
                document.getElementById('trendModalTitle').textContent = 'Xu Hướng' + (n2 ? ' - ' + n2 : '');
                modalOpen('trendModal');
                api(API + '/' + id + '/trend?days=30').then(function (d) {
                    if (!d) return;
                    var s = document.getElementById('trendSummary');
                    var dir = d.trend >= 0 ? 'up' : 'down';
                    s.innerHTML = '<div class="trend-summary__item"><div class="trend-summary__label">Followers</div><div class="trend-summary__value">' + (d.currentFollowers || 0).toLocaleString() + '</div></div><div class="trend-summary__item"><div class="trend-summary__label">Thay đổi</div><div class="trend-summary__value trend-summary__value--' + dir + '">' + (d.trend >= 0 ? '+' : '') + (d.trend || 0).toLocaleString() + '</div></div><div class="trend-summary__item"><div class="trend-summary__label">Lần</div><div class="trend-summary__value">' + (d.history ? d.history.length : 0) + '</div></div>';
                });
                break;
            case 'editpost':
            case 'editpostall':
                openEditPostModal(id);
                break;
            case 'deletepost':
            case 'deletepostall':
                if (!confirm('Xóa bài viết này?')) return;
                var delUrl = act === 'deletepostall' ? '/competitors/api/posts/' : API + '/posts/';
                api(delUrl + id, { method: 'DELETE' }).then(function() {
                    toast('Đã xóa');
                    if (postsId) loadPosts(postsId, postsPage);
                    loadAllPosts(allPostsPage);
                }).catch(function(err) { toast(err.message, 'error'); });
                break;
            case 'page':
                if (pg) { allPostsPage = parseInt(pg); loadAllPosts(allPostsPage); }
                break;
            case 'preview':
                var imgSrc = t.getAttribute('data-src') || t.getAttribute('src') || '';
                if (imgSrc) {
                    document.getElementById('previewImage').src = imgSrc;
                    modalOpen('previewModal');
                }
                break;
            case 'previewclose':
                modalClose('previewModal');
                break;
        }
    }

    function openEditPostModal(postId) {
        var row = document.querySelector('tr[data-post-id="' + postId + '"]');
        if (!row) { toast('Không tìm thấy dữ liệu bài viết', 'error'); return; }
        document.getElementById('editPostId').value = postId;
        document.getElementById('editPostContent').value = row.getAttribute('data-content') || '';
        document.getElementById('editPostUrl').value = row.getAttribute('data-posturl') || '';
        document.getElementById('editPostMediaType').value = row.getAttribute('data-mediatype') || 'unknown';
        document.getElementById('editPostLikes').value = row.getAttribute('data-likes') || '0';
        document.getElementById('editPostComments').value = row.getAttribute('data-comments') || '0';
        document.getElementById('editPostShares').value = row.getAttribute('data-shares') || '0';
        document.getElementById('editPostSentiment').value = row.getAttribute('data-sentiment') || '';
        modalOpen('editPostModal');
    }

    function loadPosts(id, page) {
        var p = new URLSearchParams({ page: page, limit: 10 });
        var mt = document.getElementById('postsFilterType')?.value;
        if (mt) p.set('mediaType', mt);
        api(API + '/' + id + '/posts?' + p.toString()).then(function (d) {
            var list = document.getElementById('postsList');
            if (!list) return;
            var pag = document.getElementById('postsPagination');
            if (!d.posts || !d.posts.length) {
                list.innerHTML = '<div style="text-align:center;padding:30px;"><p style="color:var(--text-muted);">Chưa có bài viết</p></div>';
                if (pag) pag.innerHTML = '';
                return;
            }
            var html = '<div class="posts-table-wrap"><table class="posts-data-table"><thead><tr><th>#</th><th>Post ID</th><th>Nội dung</th><th>Media</th><th><i class="fa-solid fa-comment"></i></th><th><i class="fa-solid fa-heart"></i></th><th>Ngày</th><th></th></tr></thead><tbody>';
            for (var i = 0; i < d.posts.length; i++) {
                var p = d.posts[i];
                var esc = (p.content || '').replace(/"/g, '"').replace(/'/g, '&#39;');
                var short = p.content ? (p.content.length > 60 ? p.content.substring(0, 60) + '...' : p.content) : '--';
                html += '<tr data-post-id="' + p._id + '" data-content="' + esc + '" data-posturl="' + (p.postUrl || '') + '" data-mediatype="' + (p.mediaType || 'unknown') + '" data-likes="' + (p.likes || 0) + '" data-comments="' + (p.comments || 0) + '" data-shares="' + (p.shares || 0) + '" data-sentiment="' + (p.sentiment || '') + '">'
                    + '<td>' + ((page - 1) * 10 + i + 1) + '</td>'
                    + '<td style="font-family:monospace;font-size:0.7rem;color:var(--primary)">' + (p.postId ? p.postId.substring(0, 10) + '...' : '--') + '</td>'
                    + '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc + '">' + short + '</td>'
                    + '<td style="text-align:center">' + getMediaHtml(p.media, p.mediaUrl) + '</td>'
                    + '<td style="text-align:center">' + (p.comments || 0) + '</td>'
                    + '<td style="text-align:center">' + (p.likes || 0) + '</td>'
                    + '<td style="font-size:0.7rem;color:var(--text-muted)">' + (p.postedAt ? new Date(p.postedAt).toLocaleDateString('vi-VN') : '--') + '</td>'
                    + '<td style="white-space:nowrap">'
                    + (p.postUrl ? '<a href="' + p.postUrl + '" target="_blank" class="btn-sm-icon" title="Mở"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : '')
                    + '<button class="btn-sm-icon" data-act="editpost" data-id="' + p._id + '" title="Sửa"><i class="fa-solid fa-pen"></i></button>'
                    + '<button class="btn-sm-icon btn-sm-icon--danger" data-act="deletepost" data-id="' + p._id + '" title="Xóa"><i class="fa-solid fa-trash"></i></button>'
                    + '</td></tr>';
            }
            html += '</tbody></table></div>';
            list.innerHTML = html;
            if (pag) {
                if (d.totalPages <= 1) { pag.innerHTML = ''; return; }
                var pagHtml = '';
                for (var i = 1; i <= d.totalPages; i++) {
                    pagHtml += '<button class="' + (i === d.page ? 'active' : '') + '" data-act="page" data-page="' + i + '">' + i + '</button>';
                }
                pag.innerHTML = pagHtml;
            }
        });
    }

    function filterGrid() {
        var p = new URLSearchParams();
        if (currentPlatform) p.set('platform', currentPlatform);
        var q = document.getElementById('searchInput')?.value;
        if (q) p.set('search', q);
        api(API + '/list?' + p.toString()).then(function (d) {
            if (!gridEl) return;
            if (!d || !d.length) { gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;"><h3>Không tìm thấy</h3></div>'; return; }
            gridEl.innerHTML = d.map(function (c) {
                var lc = c.lastCheckedAt ? new Date(c.lastCheckedAt).toLocaleDateString('vi-VN') : '--';
                var ov = c.isActive ? '' : '<div class="competitor-card__disabled-overlay"><span>Đã tạm dừng</span></div>';
                return '<div class="competitor-card" data-id="' + c._id + '"><div class="competitor-card__header"><div class="competitor-card__avatar"><div class="avatar-placeholder" data-platform="' + c.platform + '">' + (c.name || '').substring(0, 2).toUpperCase() + '</div></div><div class="competitor-card__info"><h4>' + (c.name || '') + '</h4></div><div class="competitor-card__actions"><button class="card-action-btn" data-act="scrape" data-id="' + c._id + '" title="Scrape"><i class="fa-solid fa-play"></i></button><button class="card-action-btn" data-act="edit" data-id="' + c._id + '" title="Sửa"><i class="fa-solid fa-pen"></i></button><button class="card-action-btn" data-act="toggle" data-id="' + c._id + '" title="' + (c.isActive ? 'Tạm dừng' : 'Bật') + '"><i class="fa-solid fa-' + (c.isActive ? 'pause' : 'play') + '"></i></button><button class="card-action-btn" data-act="delete" data-id="' + c._id + '" title="Xóa"><i class="fa-solid fa-trash"></i></button></div></div><div class="competitor-card__body"><div class="comp-stats-row"><div class="comp-stat-item"><span class="comp-stat-val">' + (c.followers || 0).toLocaleString() + '</span><span class="comp-stat-lbl">Followers</span></div><div class="comp-stat-item"><span class="comp-stat-val">' + (c.postsCount || 0) + '</span><span class="comp-stat-lbl">Bài viết</span></div><div class="comp-stat-item"><span class="comp-stat-val">' + lc + '</span><span class="comp-stat-lbl">Lần cuối</span></div></div></div><div class="competitor-card__footer"><button class="footer-action-btn" data-act="posts" data-id="' + c._id + '"><i class="fa-solid fa-list"></i> Bài viết</button><a href="' + (c.profileUrl || '#') + '" target="_blank" class="footer-action-btn"><i class="fa-solid fa-arrow-up-right-from-square"></i> Mở</a></div>' + ov + '</div>';
            }).join('');
        });
    }

    function loadAllPosts(page) {
        page = page || 1;
        var tbody = document.getElementById('allPostsBody');
        var countEl = document.getElementById('allPostsCount');
        var pagEl = document.getElementById('allPostsPagination');
        if (!tbody) return;

        var p = new URLSearchParams({ page: page, limit: 20 });
        var compFilter = document.getElementById('allPostsFilterCompetitor')?.value;
        var mediaFilter = document.getElementById('allPostsFilterMedia')?.value;
        if (compFilter) p.set('competitorId', compFilter);
        if (mediaFilter) p.set('mediaType', mediaFilter);

        api('/competitors/api/posts/all?' + p.toString()).then(function (d) {
            if (countEl) countEl.textContent = d.total + ' bài viết';
            if (!d.posts || !d.posts.length) {
                tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--text-muted);">Chưa có dữ liệu</td></tr>';
                if (pagEl) pagEl.innerHTML = '';
                return;
            }
            var html = '';
            for (var i = 0; i < d.posts.length; i++) {
                var post = d.posts[i];
                var compName = post.competitorId?.name || '--';
                var esc = (post.content || '').replace(/"/g, '"').replace(/'/g, '&#39;');
                var short = post.content ? (post.content.length > 60 ? post.content.substring(0, 60) + '...' : post.content) : '--';
                html += '<tr data-post-id="' + post._id + '" data-content="' + esc + '" data-posturl="' + (post.postUrl || '') + '" data-mediatype="' + (post.mediaType || 'unknown') + '" data-likes="' + (post.likes || 0) + '" data-comments="' + (post.comments || 0) + '" data-shares="' + (post.shares || 0) + '" data-sentiment="' + (post.sentiment || '') + '">'
                    + '<td>' + ((page - 1) * 20 + i + 1) + '</td>'
                    + '<td><span class="pt-comp-badge">' + compName + '</span></td>'
                    + '<td style="font-family:monospace;font-size:0.7rem;color:var(--primary)">' + (post.postId ? post.postId.substring(0, 10) + '...' : '--') + '</td>'
                    + '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc + '">' + short + '</td>'
                    + '<td style="text-align:center">' + getMediaHtml(post.media, post.mediaUrl) + '</td>'
                    + '<td style="text-align:center">' + (post.comments || 0) + '</td>'
                    + '<td style="text-align:center">' + (post.likes || 0) + '</td>'
                    + '<td style="font-size:0.7rem;color:var(--text-muted)">' + (post.postedAt ? new Date(post.postedAt).toLocaleDateString('vi-VN') : '--') + '</td>'
                    + '<td style="font-size:0.7rem;color:var(--text-muted)">' + (post.scrapedAt ? new Date(post.scrapedAt).toLocaleDateString('vi-VN') : '--') + '</td>'
                    + '<td style="text-align:center;font-size:1rem">' + (post.sentiment === 'positive' ? '😊' : post.sentiment === 'negative' ? '😞' : post.sentiment === 'neutral' ? '😐' : '') + '</td>'
                    + '<td style="white-space:nowrap">'
                    + (post.postUrl ? '<a href="' + post.postUrl + '" target="_blank" class="btn-sm-icon" title="Mở"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>' : '')
                    + '<button class="btn-sm-icon" data-act="editpostall" data-id="' + post._id + '" title="Sửa"><i class="fa-solid fa-pen"></i></button>'
                    + '<button class="btn-sm-icon btn-sm-icon--danger" data-act="deletepostall" data-id="' + post._id + '" title="Xóa"><i class="fa-solid fa-trash"></i></button>'
                    + '</td></tr>';
            }
            tbody.innerHTML = html;
            allPostsPage = d.page;
            if (pagEl && d.totalPages > 1) {
                var ph = '<div class="pagination-wrap">';
                for (var j = 1; j <= d.totalPages; j++) {
                    ph += '<button class="' + (j === d.page ? 'active' : '') + '" onclick="loadAllPosts(' + j + ')">' + j + '</button>';
                }
                ph += '</div>';
                pagEl.innerHTML = ph;
            } else if (pagEl) {
                pagEl.innerHTML = '';
            }
        }).catch(function(err) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:30px;color:var(--danger);">Lỗi</td></tr>';
        });
    }
    window.loadAllPosts = function(page) { loadAllPosts(page); };

    function updateProfileUrlField() {
        var urlInput = document.getElementById('formProfileUrl');
        var urlHint = document.getElementById('formProfileUrlHint');
        if (!urlInput || !urlHint) return;
        var platform = (document.getElementById('formPlatform')?.value || 'FB').toLowerCase();
        var placeholder = urlInput.getAttribute('data-placeholder-' + platform);
        var hint = urlHint.getAttribute('data-hint-' + platform);
        if (placeholder) urlInput.placeholder = placeholder;
        if (hint) urlHint.textContent = hint;
    }

    function validateProfileUrl() {
        var urlInput = document.getElementById('formProfileUrl');
        if (!urlInput) return true;
        var url = urlInput.value.trim();
        if (!url) return true;
        var platform = (document.getElementById('formPlatform')?.value || 'FB').toLowerCase();
        var patternAttr = urlInput.getAttribute('data-pattern-' + platform);
        if (!patternAttr) return true;
        try {
            var regex = new RegExp(patternAttr, 'i');
            if (!regex.test(url)) {
                urlInput.classList.add('input-error');
                toast('URL không đúng định dạng', 'error');
                urlInput.focus();
                return false;
            }
            urlInput.classList.remove('input-error');
            return true;
        } catch (e) {
            return true;
        }
    }

    function init() {
        gridEl = document.getElementById('competitorsGrid');
        if (!gridEl) return;

        document.querySelectorAll('#competitorsGrid, #allPostsBody, #allPostsTableWrap, #postsDataTableSection, #postsList, #allPostsPagination, #postsPagination').forEach(function(el) {
            if (el) el.addEventListener('click', handleClick);
        });
        document.getElementById('previewModal')?.addEventListener('click', function(e) {
            if (e.target === this) modalClose('previewModal');
        });

        document.getElementById('btnAddCompetitor')?.addEventListener('click', function () { 
            document.getElementById('modalTitle').textContent = 'Thêm Đối Thủ Mới';
            document.getElementById('formSubmitText').textContent = 'Thêm mới';
            document.getElementById('formCompetitorId').value = '';
            document.getElementById('competitorForm').reset();
            updateProfileUrlField();
            modalOpen('competitorModal');
        });
        document.getElementById('btnFirstAdd')?.addEventListener('click', function () { document.getElementById('btnAddCompetitor')?.click(); });

        document.getElementById('modalClose')?.addEventListener('click', function () { modalClose('competitorModal'); });
        document.getElementById('formCancel')?.addEventListener('click', function () { modalClose('competitorModal'); });
        document.getElementById('postsModalClose')?.addEventListener('click', function () { modalClose('postsModal'); });
        document.getElementById('addPostModalClose')?.addEventListener('click', function () { modalClose('addPostModal'); });
        document.getElementById('addPostCancel')?.addEventListener('click', function () { modalClose('addPostModal'); });
        document.getElementById('editPostModalClose')?.addEventListener('click', function () { modalClose('editPostModal'); });
        document.getElementById('editPostCancel')?.addEventListener('click', function () { modalClose('editPostModal'); });
        document.getElementById('previewModalClose')?.addEventListener('click', function () { modalClose('previewModal'); });
        document.getElementById('trendModalClose')?.addEventListener('click', function () { modalClose('trendModal'); });
        document.getElementById('compareModalClose')?.addEventListener('click', function () { modalClose('compareModal'); });

        ['competitorModal', 'postsModal', 'addPostModal', 'editPostModal', 'previewModal', 'trendModal', 'compareModal'].forEach(function (mid) {
            var el = document.getElementById(mid);
            if (el) el.addEventListener('click', function (e) { if (e.target === this) modalClose(mid); });
        });

        document.getElementById('competitorForm')?.addEventListener('submit', function (e) {
            e.preventDefault();
            if (!validateProfileUrl()) return;
            var formId = document.getElementById('formCompetitorId').value;
            var payload = {
                name: document.getElementById('formName').value.trim(),
                platform: document.getElementById('formPlatform').value,
                profileUrl: document.getElementById('formProfileUrl').value.trim(),
                avatarUrl: document.getElementById('formAvatarUrl').value.trim(),
                channelId: document.getElementById('formChannelId').value,
                notes: document.getElementById('formNotes').value.trim(),
                postLimit: document.getElementById('formPostLimit').value
            };
            var url = formId ? API + '/' + formId + '/update' : API + '/create';
            var method = formId ? 'PATCH' : 'POST';
            api(url, { method: method, body: JSON.stringify(payload) }).then(function () { toast(formId ? 'Đã cập nhật' : 'Đã thêm'); modalClose('competitorModal'); setTimeout(function () { location.reload(); }, 500); });
        });

        document.getElementById('formPlatform')?.addEventListener('change', function () { updateProfileUrlField(); });
        updateProfileUrlField();

        document.getElementById('addPostForm')?.addEventListener('submit', function (e) {
            e.preventDefault();
            var cid = document.getElementById('postFormCompetitorId').value;
            if (!cid) return;
            var g = function (x) { return document.getElementById(x); };
            var payload = {
                postUrl: g('postFormUrl').value.trim(),
                content: g('postFormContent').value.trim(),
                mediaType: g('postFormMediaType').value,
                postedAt: g('postFormDate').value || undefined,
                likes: parseInt(g('postFormLikes').value) || 0,
                comments: parseInt(g('postFormComments').value) || 0,
                shares: parseInt(g('postFormShares').value) || 0,
                views: parseInt(g('postFormViews').value) || 0,
                engagementRate: parseFloat(g('postFormEngagement').value) || 0,
                sentiment: g('postFormSentiment').value
            };
            api(API + '/' + cid + '/posts', { method: 'POST', body: JSON.stringify(payload) }).then(function () { toast('Đã thêm bài viết'); modalClose('addPostModal'); if (postsId) loadPosts(postsId, 1); });
        });

        document.getElementById('editPostForm')?.addEventListener('submit', function (e) {
            e.preventDefault();
            var postId = document.getElementById('editPostId').value;
            if (!postId) return;
            var g = function (x) { return document.getElementById(x); };
            var payload = { content: g('editPostContent').value.trim(), postUrl: g('editPostUrl').value.trim(), mediaType: g('editPostMediaType').value, likes: parseInt(g('editPostLikes').value) || 0, comments: parseInt(g('editPostComments').value) || 0, shares: parseInt(g('editPostShares').value) || 0, sentiment: g('editPostSentiment').value };
            api(API + '/posts/' + postId, { method: 'PATCH', body: JSON.stringify(payload) }).then(function () {
                toast('Đã cập nhật');
                modalClose('editPostModal');
                if (postsId) loadPosts(postsId, postsPage);
                loadAllPosts(allPostsPage);
            }).catch(function(err) { toast(err.message, 'error'); });
        });

        document.querySelectorAll('.platform-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                document.querySelectorAll('.platform-tab').forEach(function (t) { t.classList.remove('is-active'); });
                this.classList.add('is-active');
                currentPlatform = this.getAttribute('data-platform') || '';
                filterGrid();
            });
        });

        var st;
        document.getElementById('searchInput')?.addEventListener('input', function () { clearTimeout(st); st = setTimeout(filterGrid, 300); });

        document.getElementById('btnCompare')?.addEventListener('click', function () {
            var chk = document.querySelectorAll('.competitor-check:checked');
            var ids = Array.from(chk).map(function (cb) { return cb.getAttribute('data-id'); });
            if (ids.length < 2) { toast('Chọn ít nhất 2', 'warning'); return; }
            api(API + '/compare', { method: 'POST', body: JSON.stringify({ ids: ids }) }).then(function (d) {
                if (!d) return;
                document.getElementById('compareGrid').innerHTML = d.map(function (c) {
                    var al = Math.round((c.postStats?.totalLikes || 0) / Math.max(c.postStats?.totalPosts || 1, 1));
                    var eg = (c.postStats?.avgEngagement || 0).toFixed(2);
                    return '<div class="compare-card"><h3>' + c.name + '</h3><div class="compare-card__stats"><div>Followers: ' + (c.followers || 0).toLocaleString() + '</div><div>Bài viết: ' + (c.postStats?.totalPosts || 0) + '</div><div>Likes TB: ' + al.toLocaleString() + '</div><div>Engagement: ' + eg + '%</div></div></div>';
                }).join('');
                modalOpen('compareModal');
            });
        });

        document.getElementById('postsFilterType')?.addEventListener('change', function () { if (postsId) loadPosts(postsId, 1); });
        document.getElementById('allPostsFilterCompetitor')?.addEventListener('change', function () { loadAllPosts(1); });
        document.getElementById('allPostsFilterMedia')?.addEventListener('change', function () { loadAllPosts(1); });
        loadAllPosts(1);
    }

    document.addEventListener('DOMContentLoaded', init);
})();