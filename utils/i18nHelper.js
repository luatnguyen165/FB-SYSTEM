// utils/i18nHelper.js
// Wrapper cho i18n.t() với các tính năng:
// - Auto-log missing keys để dev phát hiện
// - Fallback chain: lang → vi → key → fallback param
// - Hỗ trợ interpolation {key}
// - Detect duplicate translation keys
// - Track missing keys per-request

const { t: originalT, translations } = require('../locales/i18n');

const SUPPORTED_LANGS = ['vi', 'en'];
const DEFAULT_LANG = 'vi';

const _missingKeys = new Map(); // key → count
let _missingKeysLoggingEnabled = process.env.NODE_ENV !== 'production';

/**
 * Bật/tắt log missing keys (mặc định: chỉ log ở dev).
 */
function setMissingKeysLogging(enabled) {
    _missingKeysLoggingEnabled = !!enabled;
}

/**
 * Lấy danh sách missing keys (để admin debug).
 */
function getMissingKeysReport() {
    const report = {};
    for (const [key, count] of _missingKeys) {
        report[key] = count;
    }
    return report;
}

/**
 * Reset missing keys tracking.
 */
function resetMissingKeys() {
    _missingKeys.clear();
}

/**
 * Track missing key + log warning 1 lần mỗi 50 lần để tránh spam.
 */
function _trackMissing(key, lang) {
    const fullKey = `${lang}:${key}`;
    const count = _missingKeys.get(fullKey) || 0;
    _missingKeys.set(fullKey, count + 1);

    if (_missingKeysLoggingEnabled && count === 0) {
        console.warn(`[i18n] Missing key "${key}" for lang="${lang}"`);
    } else if (_missingKeysLoggingEnabled && count % 100 === 0) {
        console.warn(`[i18n] Missing key "${key}" hit ${count + 1} times`);
    }
}

/**
 * Interpolation: "Hello {name}" + {name: "World"} → "Hello World"
 * Hỗ trợ nested object qua dot notation: {user.name}
 */
function _interpolate(text, vars) {
    if (!vars || typeof text !== 'string') return text;
    return text.replace(/\{([\w.]+)\}/g, (match, key) => {
        const keys = key.split('.');
        let val = vars;
        for (const k of keys) {
            if (val && typeof val === 'object' && k in val) {
                val = val[k];
            } else {
                return match;
            }
        }
        return val !== undefined ? String(val) : match;
    });
}

/**
 * T chính — wrap lại hàm t() gốc.
 *
 * @param {string} key - Dot notation key (VD: 'common.save')
 * @param {string} lang - Ngôn ngữ ('vi' | 'en'), mặc định 'vi'
 * @param {string|Object} [fallbackOrVars] - Nếu là string: dùng làm fallback text; nếu là object: dùng để interpolate
 * @param {Object} [vars] - Variables cho interpolation (chỉ dùng khi fallbackOrVars là string)
 * @returns {string}
 */
function t(key, lang = DEFAULT_LANG, fallbackOrVars, vars) {
    // Normalize params: t(key, fallback) hoặc t(key, lang, fallback) hoặc t(key, lang, vars, fallback)
    let actualLang = lang;
    let actualFallback = null;
    let actualVars = null;

    if (typeof fallbackOrVars === 'string') {
        actualFallback = fallbackOrVars;
        actualVars = vars;
    } else if (typeof fallbackOrVars === 'object' && fallbackOrVars !== null) {
        actualVars = fallbackOrVars;
    } else if (vars && typeof vars === 'string') {
        actualFallback = vars;
    }

    // Fallback chain: requested lang → vi → fallback → key
    let translation = null;

    if (actualLang && translations[actualLang] && translations[actualLang][key] !== undefined) {
        translation = translations[actualLang][key];
    } else {
        if (actualLang !== DEFAULT_LANG) {
            _trackMissing(key, actualLang);
        }
        if (translations[DEFAULT_LANG] && translations[DEFAULT_LANG][key] !== undefined) {
            translation = translations[DEFAULT_LANG][key];
        }
    }

    let result;
    if (translation !== null && translation !== undefined) {
        result = _interpolate(translation, actualVars);
    } else if (actualFallback !== null) {
        result = _interpolate(actualFallback, actualVars);
    } else {
        // Không có gì → trả về key để dev dễ thấy
        result = key;
    }

    return result;
}

/**
 * Hỗ trợ EJS: t('key') không cần truyền lang (lấy từ res.locals.lang).
 *
 * @param {string} key
 * @param {string|Object} [fallbackOrVars]
 * @param {Object} [vars]
 */
function tEjs(key, fallbackOrVars, vars) {
    // Trong EJS, lang được set qua res.locals.lang bởi i18nMiddleware
    // Hàm này dùng global.LANG nếu không tìm thấy
    const lang = (typeof LANG !== 'undefined') ? LANG : DEFAULT_LANG;
    return t(key, lang, fallbackOrVars, vars);
}

/**
 * Lấy ngôn ngữ hiện tại từ user/session.
 */
function getLang(req) {
    if (req?.user?.language && SUPPORTED_LANGS.includes(req.user.language)) return req.user.language;
    if (req?.session?.user?.language && SUPPORTED_LANGS.includes(req.session.user.language)) return req.session.user.language;
    if (typeof LANG !== 'undefined' && SUPPORTED_LANGS.includes(LANG)) return LANG;
    return DEFAULT_LANG;
}

/**
 * Lấy tất cả translations của 1 namespace (VD: t('sidebar.*')).
 * Hữu ích cho client-side i18n hoặc debug.
 */
function getNamespace(namespace, lang = DEFAULT_LANG) {
    const result = {};
    const dict = translations[lang] || translations[DEFAULT_LANG] || {};
    const prefix = namespace + '.';
    for (const key of Object.keys(dict)) {
        if (key.startsWith(prefix)) {
            result[key.substring(prefix.length)] = dict[key];
        }
    }
    return result;
}

/**
 * Validate: check key tồn tại ở cả 2 ngôn ngữ (dev tool).
 */
function validateTranslations() {
    const issues = [];
    const allKeys = new Set();
    for (const lang of Object.keys(translations)) {
        for (const key of Object.keys(translations[lang])) {
            allKeys.add(key);
        }
    }
    for (const key of allKeys) {
        if (!translations.vi || translations.vi[key] === undefined) {
            issues.push({ key, issue: 'missing_vi' });
        }
        if (!translations.en || translations.en[key] === undefined) {
            issues.push({ key, issue: 'missing_en' });
        }
    }
    return { totalKeys: allKeys.size, issues };
}

module.exports = {
    t,
    tEjs,
    getLang,
    getNamespace,
    SUPPORTED_LANGS,
    DEFAULT_LANG,
    setMissingKeysLogging,
    getMissingKeysReport,
    resetMissingKeys,
    validateTranslations
};
