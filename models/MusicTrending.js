const mongoose = require('mongoose');

const musicTrendingSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    platform: {
        type: String,
        required: true,
        enum: ['TT', 'YT', 'FB']
    },
    url: {
        type: String,
        required: true
    },
    title: {
        type: String,
        default: ''
    },
    artist: {
        type: String,
        default: ''
    },
    duration: {
        type: Number,
        default: 0
    },
    thumbnail: {
        type: String,
        default: ''
    },
    source: {
        type: String,
        default: ''
    },
    filepath: {
        type: String,
        default: ''
    },
    accountName: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('MusicTrending', musicTrendingSchema);