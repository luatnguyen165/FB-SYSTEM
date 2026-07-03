const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        // Uu tien dung MONGODB_URI tu .env, fallback ve local MongoDB
        const dbString = process.env.MONGODB_URI || 'mongodb://localhost:27017/reelsflow';

        console.log('[DB] Dang ket noi MongoDB: ' + dbString.replace(/\/\/.*@/, '//***@'));

        await mongoose.connect(dbString, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 5000,
        });
        console.log('✅ MongoDB connected successfully (local)');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        process.exit(1);
    }
}

module.exports = connectDB;
