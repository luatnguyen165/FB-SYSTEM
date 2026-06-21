/* ===================================
   SCRIPT: Xóa cache groups Facebook
   Chạy: node scripts/clear-groups-cache.js
   ===================================
   Script này xóa toàn bộ documents trong collection FacebookGroupCache
   để dọn dẹp duplicate và buộc user quét lại từ đầu.
   =================================== */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');
const FacebookGroupCache = require('../models/FacebookGroupCache');

async function main() {
    console.log('===========================================');
    console.log('XÓA CACHE GROUPS FACEBOOK');
    console.log('===========================================');

    // Check MONGODB_URI
    if (!process.env.MONGODB_URI) {
        console.error('❌ Thiếu MONGODB_URI trong .env');
        process.exit(1);
    }

    try {
        // Connect
        console.log('🔌 Đang kết nối MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 10000
        });
        console.log('✅ Đã kết nối MongoDB');

        // Đếm trước
        const totalDocs = await FacebookGroupCache.countDocuments({});
        const totalGroups = await FacebookGroupCache.aggregate([
            { $project: { count: { $size: { $ifNull: ['$groups', []] } } } },
            { $group: { _id: null, total: { $sum: '$count' } } }
        ]);
        const groupsCount = totalGroups[0]?.total || 0;

        console.log('');
        console.log('📊 Thống kê hiện tại:');
        console.log(`   - Số channel có cache: ${totalDocs}`);
        console.log(`   - Tổng số group trong cache: ${groupsCount}`);
        console.log('');

        if (totalDocs === 0) {
            console.log('ℹ️ Collection trống, không có gì để xóa.');
            await mongoose.disconnect();
            return;
        }

        // Hiển thị chi tiết
        const allCaches = await FacebookGroupCache.find({})
            .select('accountName accountType channelId groups updatedAt')
            .lean();

        console.log('📋 Chi tiết các cache sẽ bị xóa:');
        allCaches.forEach((c, idx) => {
            console.log(`   ${idx + 1}. ${c.accountName} (${c.accountType}) - ${c.groups?.length || 0} groups - cập nhật: ${c.updatedAt?.toLocaleString('vi-VN') || '—'}`);
        });
        console.log('');

        // Hỏi xác nhận
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const answer = await new Promise(resolve => {
            rl.question('⚠️ Bạn có chắc muốn XÓA HẾT? (gõ "yes" để xác nhận): ', resolve);
        });
        rl.close();

        if (answer.trim().toLowerCase() !== 'yes') {
            console.log('❌ Đã hủy.');
            await mongoose.disconnect();
            return;
        }

        // Xóa
        console.log('🗑️ Đang xóa...');
        const result = await FacebookGroupCache.deleteMany({});
        console.log(`✅ Đã xóa ${result.deletedCount} documents.`);
        console.log('');
        console.log('💡 Bây giờ bạn có thể vào /schedule/groups để quét lại từ đầu.');
        console.log('   Dữ liệu mới sẽ KHÔNG bị duplicate (đã fix ở 3 lớp: scan → merge → save DB).');

    } catch (err) {
        console.error('❌ Lỗi:', err.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect().catch(() => {});
        console.log('🔌 Đã ngắt kết nối MongoDB');
    }
}

main();
