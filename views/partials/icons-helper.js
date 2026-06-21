/**
 * views/partials/icons-helper.js
 * ---------------------------------------------------------------
 * Icon helper chuẩn hóa toàn bộ FB-SYSTEM
 * ---------------------------------------------------------------
 *
 * CÁCH DÙNG (server-side EJS):
 *   const icon = require('./icons-helper');
 *   <%- icon.render('edit') %>
 *   <%- icon.render('trash', { text: 'Xóa' }) %>
 *   <%- icon.render('plus', { cssClass: 'btn-icon' }) %>
 *
 * Hoặc qua EJS locals (nếu đã set):
 *   <%- renderIcon('trash', { text: 'Xóa' }) %>
 */

const ICONS = {
  edit: 'fa-pen', pen: 'fa-pen',
  delete: 'fa-trash', trash: 'fa-trash',
  close: 'fa-xmark', xmark: 'fa-xmark',
  add: 'fa-plus', plus: 'fa-plus',
  check: 'fa-check', save: 'fa-floppy-disk',
  eye: 'fa-eye', search: 'fa-magnifying-glass',
  gear: 'fa-gear', settings: 'fa-gear',
  refresh: 'fa-arrows-rotate', reload: 'fa-arrows-rotate',
  download: 'fa-download', upload: 'fa-upload',
  copy: 'fa-copy', send: 'fa-paper-plane',
  calendar: 'fa-calendar', star: 'fa-star',
  heart: 'fa-heart', user: 'fa-user',
  bell: 'fa-bell', filter: 'fa-filter', sort: 'fa-sort',
  'chevron-left': 'fa-chevron-left', 'chevron-right': 'fa-chevron-right',
  'chevron-up': 'fa-chevron-up', 'chevron-down': 'fa-chevron-down',
  play: 'fa-play', pause: 'fa-pause', stop: 'fa-stop',
  back: 'fa-arrow-left', forward: 'fa-arrow-right',
  warning: 'fa-triangle-exclamation', error: 'fa-circle-xmark',
  success: 'fa-circle-check', info: 'fa-circle-info',
  image: 'fa-image', video: 'fa-video',
  file: 'fa-file', folder: 'fa-folder',
  link: 'fa-link', unlink: 'fa-link-slash',
  home: 'fa-house', tag: 'fa-tag',
  comment: 'fa-comment', share: 'fa-share-nodes',
  lock: 'fa-lock', unlock: 'fa-unlock',
  spinner: 'fa-spinner', magic: 'fa-wand-magic-sparkles',
  rocket: 'fa-rocket', crown: 'fa-crown',
  fire: 'fa-fire', chart: 'fa-chart-line'
};

function render(name, opts = {}) {
  const n = (name || 'info').toLowerCase();
  const cls = opts.cssClass ? ' ' + opts.cssClass : '';
  const text = (opts.text !== undefined && opts.text !== null) ? ' ' + opts.text : '';
  const title = opts.title ? ' title="' + escapeHtml(String(opts.title)) + '"' : '';
  const aria = opts.ariaLabel ? ' aria-label="' + escapeHtml(String(opts.ariaLabel)) + '"' : '';
  const spin = opts.spin ? ' fa-spin' : '';
  const extraStyle = opts.style ? ' style="' + escapeHtml(String(opts.style)) + '"' : '';

  let icon = ICONS[n];
  if (!icon) icon = n.indexOf('fa-') === 0 ? n : 'fa-' + n;
  let prefix = 'fa-solid';
  if (icon.indexOf('fa-brands') === 0 || icon.indexOf('fa-regular') === 0) prefix = '';

  if (text) {
    return '<button type="button" class="btn-icon-text' + cls + '"' + extraStyle + title + aria + '>' +
           '<i class="' + prefix + ' ' + icon + spin + '"></i>' + text + '</button>';
  }
  return '<i class="' + prefix + ' ' + icon + spin + cls + '"' + extraStyle + title + aria + '></i>';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { render, ICONS };
