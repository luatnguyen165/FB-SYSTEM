// middlewares/validation.js
// Request validation and sanitization middleware

/**
 * Validates required fields in request body
 * @param {string[]} fields - Array of required field names
 * @returns {function} Express middleware
 */
function requireFields(fields) {
    return (req, res, next) => {
        const missing = [];
        for (const field of fields) {
            const value = field.includes('.') 
                ? field.split('.').reduce((obj, key) => obj?.[key], req.body)
                : req.body[field];
            if (value === undefined || value === null || value === '') {
                missing.push(field);
            }
        }
        if (missing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Thiếu trường bắt buộc: ${missing.join(', ')}`
            });
        }
        next();
    };
}

/**
 * Sanitizes string fields in request body (trim + strip HTML)
 * @param {string[]} fields - Array of field names to sanitize
 * @returns {function} Express middleware
 */
function sanitizeFields(fields) {
    return (req, res, next) => {
        for (const field of fields) {
            if (typeof req.body[field] === 'string') {
                req.body[field] = req.body[field].trim().replace(/<[^>]*>/g, '');
            }
        }
        next();
    };
}

/**
 * Validates that a field is a valid MongoDB ObjectId
 * @param {string} fieldName - The field name to validate (supports dot notation)
 * @returns {function} Express middleware
 */
function validateObjectId(fieldName) {
    return (req, res, next) => {
        const value = fieldName === 'id' || fieldName === '_id' 
            ? req.params?.id || req.params?.playId || req.params?.configId || req.params?.channelId
            : req.body[fieldName] || req.params[fieldName];
        
        if (!value) return next();
        
        // MongoDB ObjectId is a 24-character hex string
        if (!/^[0-9a-fA-F]{24}$/.test(value)) {
            return res.status(400).json({
                success: false,
                message: `${fieldName} không hợp lệ`
            });
        }
        next();
    };
}

/**
 * Validates pagination parameters
 */
function validatePagination(req, res, next) {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    if (page < 1) {
        return res.status(400).json({ success: false, message: 'Page phải >= 1' });
    }
    if (limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, message: 'Limit phải từ 1-100' });
    }
    
    req.query.page = page;
    req.query.limit = limit;
    next();
}

/**
 * Validates time format (HH:MM)
 */
function validateTimeFormat(fieldName) {
    return (req, res, next) => {
        const value = req.body[fieldName];
        if (!value) return next();
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
            return res.status(400).json({
                success: false,
                message: `${fieldName} phải ở định dạng HH:MM (ví dụ: 08:00, 23:30)`
            });
        }
        next();
    };
}

/**
 * Validates URL format
 */
function validateUrls(fieldName) {
    return (req, res, next) => {
        const urls = req.body[fieldName];
        if (!urls || !Array.isArray(urls)) return next();
        
        const invalidUrls = urls.filter(url => {
            try {
                new URL(url);
                return false;
            } catch {
                return true;
            }
        });
        
        if (invalidUrls.length > 0) {
            return res.status(400).json({
                success: false,
                message: `URL không hợp lệ: ${invalidUrls.join(', ')}`
            });
        }
        next();
    };
}

module.exports = {
    requireFields,
    sanitizeFields,
    validateObjectId,
    validatePagination,
    validateTimeFormat,
    validateUrls
};