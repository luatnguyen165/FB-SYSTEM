// models/User.js — SQLite adapter
const bcrypt = require('bcryptjs');
const { getModel } = require('../scripts/sqlite-models');

const User = getModel('User');

// Preserve bcrypt password comparison (used in auth routes)
User.comparePassword = async function (candidatePassword, hashedPassword) {
    return bcrypt.compare(candidatePassword, hashedPassword);
};

User.hashPassword = async function (password) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
};

module.exports = User;
