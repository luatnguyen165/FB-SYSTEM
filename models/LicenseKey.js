// models/LicenseKey.js — SQLite adapter (with pre-save hook)
const { getModel, generateObjectId } = require('../scripts/sqlite-models');

const LicenseKey = getModel('LicenseKey');

// Pre-save hook: auto-set expiresAt to 1 year from now
const originalSave = LicenseKey.save;
LicenseKey.save = function(doc) {
    if (!doc.expiresAt) {
        const oneYear = new Date();
        oneYear.setFullYear(oneYear.getFullYear() + 1);
        doc.expiresAt = oneYear.toISOString();
    }
    return originalSave ? originalSave.call(this, doc) : doc;
};

module.exports = LicenseKey;
