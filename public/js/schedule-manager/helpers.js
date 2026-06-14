/* ===================================
   SCHEDULE MANAGER HELPERS - Constants, utility functions
   =================================== */

const PAGE_SIZE = 8;
let currentPage = 1;
let filteredRows = [];

// Global var declarations — hoisted references for sub-modules
// These are set by schedule-manager.js DOMContentLoaded later
var searchInput, platformFilter, statusFilter, rows;
var managerData, editModal, editFields, btnSaveEdit, paginationEl, summaryFields, tableBody, btnRefreshGroups;

const PLATFORM_META = {
    FB: { label: 'Facebook', icon: 'fa-brands fa-facebook', color: '#1877f2' },
    IG: { label: 'Instagram', icon: 'fa-brands fa-instagram', color: '#e1306c' },
    TT: { label: 'TikTok Video', icon: 'fa-brands fa-tiktok', color: '#000000' },
    YT: { label: 'YouTube Short', icon: 'fa-brands fa-youtube', color: '#ff0000' },
    FR: { label: 'Facebook Reels', icon: 'fa-brands fa-facebook', color: '#1877f2' },
    TA: { label: 'TikTok Affiliate', icon: 'fa-solid fa-link', color: '#555555' }
};

const POST_PLATFORMS = ['FB', 'IG'];
const REELS_PLATFORMS = ['FR', 'YS', 'IG', 'TT', 'TA'];
const PLATFORM_TO_CHANNEL = { FR: 'FB', YS: 'YT', IG: 'IG', TT: 'TT', TA: 'TT', FB: 'FB' };

function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

function safeText(value = '') {
    return String(value)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#39;');
}

function formatForDateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getPayloadFromRow(row) {
    if (!row) return null;
    try {
        return JSON.parse(decodeURIComponent(row.dataset.row || '{}'));
    } catch (error) {
        return null;
    }
}

function formatReadableTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(date);
}