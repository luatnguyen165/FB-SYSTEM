// db.js — SQLite adapter (replaces MongoDB)
const { connectSQLite } = require('./db-sqlite');

// Load all models (creates tables + indexes)
require('./scripts/sqlite-models');

const connectDB = async () => {
    try {
        connectSQLite();
        console.log('✅ SQLite connected and tables initialized');
    } catch (error) {
        console.error('❌ SQLite connection error:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;
