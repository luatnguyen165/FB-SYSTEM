// models/CommentScrape.js - Lưu kết quả scrape comment từ Facebook (port logic từ facebook-comment-scraper.user.js)
// Tính năng FB Comment Crawler — tách biệt hoàn toàn với các model khác.
const mongoose = require('mongoose');

// Mỗi comment flat — lưu trong array `comments`
const FlatCommentSchema = new mongoose.Schema({
    // ID ổn định do server tự sinh, dùng làm FK cho parentId/rootId
    cid: { type: String, required: true },

    // Cấu trúc cây
    parentId: { type: String, default: null },    // cid của comment cha (null = main comment)
    rootId: { type: String, required: true },      // cid của main comment gốc
    depth: { type: Number, default: 0 },           // 0 = main, 1 = reply, 2 = reply of reply...
    threadPath: { type: String, default: '' },    // breadcrumb: "cid1.cid2.cid3"

    // Tác giả
    author: { type: String, default: '' },
    authorName: { type: String, default: '' },
    authorId: { type: String, default: '' },      // FB UID nếu extract được
    profileUrl: { type: String, default: '' },
    profileImage: { type: String, default: '' },

    // Nội dung
    text: { type: String, default: '' },
    timestamp: { type: String, default: '' },     // text gốc FB: "2 giờ"
    timestampAbs: { type: Date, default: null },  // parse sang Date nếu được
    likes: { type: Number, default: 0 },

    // Meta
    isReply: { type: Boolean, default: false },
    hasUnloadedReplies: { type: Boolean, default: false },
    replyToAuthor: { type: String, default: '' }, // comment này reply cho ai (nếu biết)
    detectionMethod: { type: String, default: '' },// strategy nào detect được depth
}, { _id: false });

const CommentScrapeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Channel FB dùng để scrape
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    accountName: { type: String, default: '' },   // cache tên account để hiển thị nhanh

    // Nguồn
    postUrl: { type: String, required: true },
    postId: { type: String, default: '' },        // extract từ URL (nếu được)
    postTitle: { type: String, default: '' },     // tiêu đề post nếu lấy được

    // Trạng thái job
    status: { type: String, enum: ['pending', 'running', 'success', 'failed', 'partial', 'stale_failed'], default: 'pending' },
    errorMessage: { type: String, default: '' },
    progress: { type: Number, default: 0 },        // 0-100

    // Stats tổng quan
    stats: {
        mainComments: { type: Number, default: 0 },
        replies: { type: Number, default: 0 },
        totalComments: { type: Number, default: 0 },
        buttonsClicked: { type: Number, default: 0 },
        maxDepth: { type: Number, default: 0 },
        hasIncompleteReplies: { type: Boolean, default: false },
        durationMs: { type: Number, default: 0 }
    },

    // Cấu hình lúc scrape
    options: {
        maxComments: { type: Number, default: 0 }, // 0 = unlimited
        maxDepth: { type: Number, default: 5 },
        scrollAttempts: { type: Number, default: 3 },
        expandIterations: { type: Number, default: 200 }
    },

    // Dữ liệu flat — query thread nhanh, expandable UI dễ
    comments: { type: [FlatCommentSchema], default: [] },

    // Dữ liệu tree — render UI dạng lồng nhau (cached để tránh build lại mỗi request)
    tree: { type: mongoose.Schema.Types.Mixed, default: null },

    scrapedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Index query phổ biến
CommentScrapeSchema.index({ userId: 1, scrapedAt: -1 });
CommentScrapeSchema.index({ userId: 1, status: 1 });
CommentScrapeSchema.index({ userId: 1, postUrl: 1 });
// unique: 1 postUrl chỉ giữ 1 bản ghi mới nhất cho mỗi user (đơn giản hóa)
CommentScrapeSchema.index({ userId: 1, postUrl: 1, scrapedAt: -1 });

module.exports = mongoose.model('CommentScrape', CommentScrapeSchema);
