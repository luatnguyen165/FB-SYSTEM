const bcrypt = require('bcryptjs');

/**
 * Hàm băm mật khẩu (Hash password)
 * @param {string} password - Mật khẩu thuần từ người dùng
 * @returns {Promise<string>} - Mật khẩu đã băm
 */
const hashPassword = async (password) => {
    try {
        const salt = await bcrypt.genSalt(10);
        return await bcrypt.hash(password, salt);
    } catch (error) {
        throw new Error('Lỗi khi băm mật khẩu: ' + error.message);
    }
};

/**
 * Hàm kiểm tra mật khẩu (Compare password)
 * @param {string} password - Mật khẩu người dùng nhập
 * @param {string} hash - Mật khẩu đã lưu trong DB
 * @returns {Promise<boolean>}
 */
const comparePassword = async (password, hash) => {
    return await bcrypt.compare(password, hash);
};

module.exports = { hashPassword, comparePassword };