// middlewares/aiValidation.js
// Input validation cho AI Content API

/**
 * Validate và sanitize input cho AI endpoints
 */
function validateAIInput(fields) {
    return (req, res, next) => {
        const errors = [];
        const sanitized = {};

        for (const [key, config] of Object.entries(fields)) {
            let value = req.body[key];

            // Required check
            if (config.required && (value === undefined || value === null || value === '')) {
                errors.push(`${key} là bắt buộc`);
                continue;
            }

            if (value === undefined || value === null) {
                sanitized[key] = config.default !== undefined ? config.default : value;
                continue;
            }

            // Type check
            if (config.type === 'string') {
                value = String(value).trim();
                if (config.maxLength && value.length > config.maxLength) {
                    errors.push(`${key} tối đa ${config.maxLength} ký tự`);
                    continue;
                }
                if (config.enum && !config.enum.includes(value)) {
                    errors.push(`${key} không hợp lệ`);
                    continue;
                }
            }

            if (config.type === 'number') {
                value = Number(value);
                if (isNaN(value)) {
                    errors.push(`${key} phải là số`);
                    continue;
                }
                if (config.min !== undefined && value < config.min) {
                    errors.push(`${key} phải >= ${config.min}`);
                    continue;
                }
                if (config.max !== undefined && value > config.max) {
                    errors.push(`${key} phải <= ${config.max}`);
                    continue;
                }
            }

            if (config.type === 'array') {
                if (!Array.isArray(value)) {
                    errors.push(`${key} phải là mảng`);
                    continue;
                }
                if (config.maxItems && value.length > config.maxItems) {
                    errors.push(`${key} tối đa ${config.maxItems} phần tử`);
                    continue;
                }
            }

            sanitized[key] = value;
        }

        if (errors.length > 0) {
            return res.status(400).json({ error: errors.join('; ') });
        }

        req.validated = { ...(req.validated || {}), ...sanitized };
        next();
    };
}

/**
 * Validate MongoDB ObjectId
 */
function isValidObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(String(id));
}

/**
 * Validate URL
 */
function isValidUrl(url) {
    try {
        const u = new URL(url);
        return ['http:', 'https:'].includes(u.protocol);
    } catch {
        return false;
    }
}

module.exports = { validateAIInput, isValidObjectId, isValidUrl };
