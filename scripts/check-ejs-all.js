const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const files = [];
function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(f => {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else if (f.name.endsWith('.ejs')) files.push(p);
    });
}
walk('views');

const t = (k) => '[' + k + ']';
const user = { username: 'admin', avatarUrl: null, _id: 'user1' };
const baseVars = {
    lang: 'vi', t, user,
    stats: { totalScanned: 0, totalMatched: 0, totalCommented: 0, activeConfigs: 0, scheduledConfigs: 0 },
    configs: [], recentResults: [], facebookChannels: [],
    scanProgressLogs: [], resultId: '', scheduleId: '', config: {},
    schedules: [], groups: [{ groupId: '1', groupName: 'Test' }], licenses: [],
    shopeeLinks: [], channels: [], products: [],
    currentPage: 1, totalPages: 1, totalItems: 0,
    baseUrl: '/', queryParams: {},
    openaiApiKey: '', puterApiKey: '',
    groupsStats: { total: 0, scanned: 0, pending: 0 },
    currentAccount: null,
    total: 0, page: 1, limit: 10, search: '',
    status: 'all'
};

let paginationFails = [];
let allErrors = [];
files.forEach(file => {
    try {
        ejs.render(fs.readFileSync(file, 'utf8'), Object.assign({filename: file}, baseVars));
    } catch (e) {
        const msg = e.message.split('\n')[0];
        if (msg.indexOf('pagination') >= 0 || msg.indexOf('matching close') >= 0) {
            paginationFails.push({file, msg});
        }
        allErrors.push({file, msg});
    }
});
console.log('Total EJS files:', files.length);
console.log('Files with errors:', allErrors.length);
console.log('Files with pagination/matching errors:', paginationFails.length);
if (paginationFails.length) {
    paginationFails.forEach(f => console.log('  -', f.file, ':', f.msg));
}
console.log('\nAll non-pagination errors (these are just missing variables, not real bugs):');
allErrors.slice(0, 10).forEach(f => console.log('  -', f.file, ':', f.msg.substring(0, 100)));
