// db-sqlite.js — SQLite adapter that mimics Mongoose API
// Uses better-sqlite3 (synchronous). Drop-in replacement for existing controllers/services.

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

let db = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateObjectId() {
    return crypto.randomBytes(12).toString('hex');
}

function nowISO() {
    return new Date().toISOString();
}

/** Resolve the database file path. */
function resolveDbPath() {
    if (global.USER_DATA_DIR) {
        return path.join(global.USER_DATA_DIR, 'fb-system.sqlite');
    }
    return path.join(process.cwd(), 'fb-system.sqlite');
}

/** Get the raw better-sqlite3 instance. */
function getDb() {
    if (!db) throw new Error('[SQLite] Database not initialized. Call connectSQLite() first.');
    return db;
}

/** Initialize / open the database. */
function connectSQLite() {
    if (db) return db;
    const dbPath = resolveDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    console.log(`[SQLite] Connected to ${dbPath}`);
    return db;
}

// ---------------------------------------------------------------------------
// Query filter matching engine
// ---------------------------------------------------------------------------

/**
 * Retrieve a nested value from an object using dot notation.
 * Supports traversal through arrays: for array fields, returns values from all elements.
 *   getNested({ a: [{ b: 1 }, { b: 2 }] }, 'a.b') → [1, 2]
 *   getNested({ a: { b: 1 } }, 'a.b') → 1
 */
function getNested(obj, path) {
    if (obj == null) return undefined;
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length; i++) {
        if (cur == null) return undefined;
        cur = cur[parts[i]];
    }
    return cur;
}

/**
 * Retrieve values through dot notation, expanding arrays along the path.
 * Returns an array of all matching leaf values (for filter matching).
 */
function getNestedExpanded(obj, path) {
    if (obj == null) return [undefined];
    const parts = path.split('.');
    let current = [obj];
    for (const part of parts) {
        const next = [];
        for (const item of current) {
            if (item == null) continue;
            const val = item[part];
            if (Array.isArray(val)) {
                next.push(...val);
            } else {
                next.push(val);
            }
        }
        current = next;
    }
    return current;
}

/**
 * Check whether a single document matches a MongoDB-style filter.
 * Supports: $in, $nin, $ne, $exists, $gt, $gte, $lt, $lte, $or, $and, $not, $regex, $elemMatch
 * and dot-notation nested field access.
 */
function matchFilter(doc, filter) {
    if (!filter || Object.keys(filter).length === 0) return true;

    for (const [key, condition] of Object.entries(filter)) {
        // Logical operators at top level
        if (key === '$or') {
            if (!Array.isArray(condition)) throw new Error('$or requires an array');
            if (!condition.some(sub => matchFilter(doc, sub))) return false;
            continue;
        }
        if (key === '$and') {
            if (!Array.isArray(condition)) throw new Error('$and requires an array');
            if (!condition.every(sub => matchFilter(doc, sub))) return false;
            continue;
        }

        // For dot-notation paths through arrays, expand and check each element
        const hasArrayInPath = key.includes('.') && _pathHasArray(doc, key);
        let fieldVals;
        if (hasArrayInPath) {
            fieldVals = getNestedExpanded(doc, key);
        } else {
            fieldVals = [getNested(doc, key)];
        }

        if (condition !== null && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
            // It's an operator object { $op: value }
            if (hasArrayInPath) {
                // For arrays: condition must match at least one element
                const anyMatch = fieldVals.some(fv => {
                    return Object.entries(condition).every(([op, opVal]) =>
                        evaluateOperator(fv, op, opVal, doc, key)
                    );
                });
                if (!anyMatch && fieldVals.every(v => v === undefined)) {
                    // All undefined, only $exists: false could match
                    if (!Object.entries(condition).every(([op, opVal]) =>
                        op === '$exists' && opVal === false
                    )) return false;
                } else if (!anyMatch) {
                    return false;
                }
            } else {
                const fieldVal = fieldVals[0];
                for (const [op, opVal] of Object.entries(condition)) {
                    if (!evaluateOperator(fieldVal, op, opVal, doc, key)) return false;
                }
            }
        } else {
            // Direct equality
            if (hasArrayInPath) {
                if (!fieldVals.some(fv => strictEqual(fv, condition))) return false;
            } else {
                if (!strictEqual(fieldVals[0], condition)) return false;
            }
        }
    }
    return true;
}

/** Check if any part of a dot-notation path resolves to an array along the way. */
function _pathHasArray(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const p of parts) {
        if (cur == null) return false;
        if (Array.isArray(cur)) return true;
        cur = cur[p];
    }
    return false;
}

function strictEqual(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    // Compare dates
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof Date) return a.getTime() === new Date(b).getTime();
    if (b instanceof Date) return new Date(a).getTime() === b.getTime();
    // Deep comparison for objects/arrays
    if (typeof a === 'object' && typeof b === 'object') {
        return JSON.stringify(a) === JSON.stringify(b);
    }
    return String(a) === String(b);
}

function compareValues(fieldVal, op, opVal) {
    let a = fieldVal;
    let b = opVal;
    if (a instanceof Date) a = a.getTime();
    else if (typeof a === 'string') { const t = Date.parse(a); if (!isNaN(t)) a = t; }
    if (b instanceof Date) b = b.getTime();
    else if (typeof b === 'string') { const t = Date.parse(b); if (!isNaN(t)) b = t; }
    if (typeof a === 'number' && typeof b === 'number') {
        if (op === '$gt') return a > b;
        if (op === '$gte') return a >= b;
        if (op === '$lt') return a < b;
        if (op === '$lte') return a <= b;
    }
    // Fallback: string comparison
    const sa = String(a), sb = String(b);
    if (op === '$gt') return sa > sb;
    if (op === '$gte') return sa >= sb;
    if (op === '$lt') return sa < sb;
    if (op === '$lte') return sa <= sb;
    return false;
}

function evaluateOperator(fieldVal, op, opVal, doc, fieldKey) {
    switch (op) {
        case '$in': {
            if (!Array.isArray(opVal)) return false;
            if (Array.isArray(fieldVal)) {
                return fieldVal.some(v => opVal.some(o => strictEqual(v, o)));
            }
            return opVal.some(o => strictEqual(fieldVal, o));
        }
        case '$nin': {
            if (!Array.isArray(opVal)) return false;
            if (Array.isArray(fieldVal)) {
                return !fieldVal.some(v => opVal.some(o => strictEqual(v, o)));
            }
            return !opVal.some(o => strictEqual(fieldVal, o));
        }
        case '$ne': {
            if (Array.isArray(fieldVal)) {
                return !fieldVal.some(v => strictEqual(v, opVal));
            }
            return !strictEqual(fieldVal, opVal);
        }
        case '$exists':
            return opVal ? fieldVal !== undefined && fieldVal !== null : fieldVal === undefined || fieldVal === null;
        case '$gt':
        case '$gte':
        case '$lt':
        case '$lte':
            return compareValues(fieldVal, op, opVal);
        case '$not': {
            if (typeof opVal === 'object' && opVal !== null && !Array.isArray(opVal)) {
                return !Object.entries(opVal).every(([subOp, subVal]) =>
                    evaluateOperator(fieldVal, subOp, subVal, doc, fieldKey)
                );
            }
            return !strictEqual(fieldVal, opVal);
        }
        case '$regex': {
            if (fieldVal == null) return false;
            const flags = typeof opVal === 'object' && opVal.flags ? opVal.flags : (typeof opVal === 'string' ? '' : '');
            const pattern = typeof opVal === 'object' && opVal.pattern ? opVal.pattern : opVal;
            try {
                return new RegExp(pattern, flags).test(String(fieldVal));
            } catch {
                return false;
            }
        }
        case '$elemMatch': {
            if (!Array.isArray(fieldVal)) return false;
            return fieldVal.some(item => {
                if (typeof opVal === 'object' && opVal !== null && !Array.isArray(opVal)) {
                    // opVal is a filter applied to each element
                    return matchFilter(item, opVal);
                }
                return strictEqual(item, opVal);
            });
        }
        // Array containment helpers
        case '$all': {
            if (!Array.isArray(fieldVal) || !Array.isArray(opVal)) return false;
            return opVal.every(o => fieldVal.some(v => strictEqual(v, o)));
        }
        case '$size': {
            if (!Array.isArray(fieldVal)) return false;
            return fieldVal.length === opVal;
        }
        default:
            // Unknown operator — treat as equality
            return strictEqual(fieldVal, { [op]: opVal });
    }
}

// ---------------------------------------------------------------------------
// Update operators engine
// ---------------------------------------------------------------------------

/**
 * Apply MongoDB-style update operators to a document (mutates doc in-place).
 * Returns the mutated document.
 */
function applyUpdate(doc, update) {
    if (!update) return doc;

    // If no $ operators, treat the whole thing as a $set
    const hasOperators = Object.keys(update).some(k => k.startsWith('$'));
    if (!hasOperators) {
        // Pure replacement (except _id)
        const _id = doc._id;
        Object.keys(doc).forEach(k => { if (k !== '_id') delete doc[k]; });
        Object.entries(update).forEach(([k, v]) => {
            if (k !== '_id') doc[k] = prepareValueForStorage(v);
        });
        return doc;
    }

    if (update.$set) {
        for (const [k, v] of Object.entries(update.$set)) {
            setNested(doc, k, prepareValueForStorage(v));
        }
    }
    if (update.$unset) {
        for (const k of Object.keys(update.$unset)) {
            unsetNested(doc, k);
        }
    }
    if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
            const cur = getNested(doc, k) || 0;
            setNested(doc, k, (typeof cur === 'number' ? cur : 0) + v);
        }
    }
    if (update.$push) {
        for (const [k, v] of Object.entries(update.$push)) {
            const cur = getNested(doc, k);
            const arr = Array.isArray(cur) ? cur : [];
            if (v && typeof v === 'object' && '$each' in v) {
                const items = Array.isArray(v.$each) ? v.$each : [v.$each];
                arr.push(...items.map(prepareValueForStorage));
                if (v.$sort) {
                    const sortFn = typeof v.$sort === 'object'
                        ? (a, b) => {
                            for (const [sk, sv] of Object.entries(v.$sort)) {
                                const aV = getNested(a, sk) || '';
                                const bV = getNested(b, sk) || '';
                                if (aV < bV) return -sv;
                                if (aV > bV) return sv;
                            }
                            return 0;
                        }
                        : ((a, b) => (a > b ? 1 : a < b ? -1 : 0));
                    arr.sort(sortFn);
                }
                if (typeof v.$slice === 'number') {
                    if (v.$slice < 0) arr.splice(0, arr.length + v.$slice);
                    else arr.splice(v.$slice);
                }
            } else {
                arr.push(prepareValueForStorage(v));
            }
            setNested(doc, k, arr);
        }
    }
    if (update.$pull) {
        for (const [k, v] of Object.entries(update.$pull)) {
            const cur = getNested(doc, k);
            if (!Array.isArray(cur)) continue;
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                // Filter-based pull
                const idx = cur.findIndex(item => matchFilter(item, v));
                if (idx !== -1) cur.splice(idx, 1);
            } else {
                const idx = cur.findIndex(item => strictEqual(item, v));
                if (idx !== -1) cur.splice(idx, 1);
            }
        }
    }
    if (update.$addToSet) {
        for (const [k, v] of Object.entries(update.$addToSet)) {
            const cur = getNested(doc, k);
            const arr = Array.isArray(cur) ? cur : [];
            if (v && typeof v === 'object' && '$each' in v) {
                const items = Array.isArray(v.$each) ? v.$each : [v.$each];
                for (const item of items) {
                    if (!arr.some(a => strictEqual(a, item))) {
                        arr.push(prepareValueForStorage(item));
                    }
                }
            } else {
                if (!arr.some(a => strictEqual(a, v))) {
                    arr.push(prepareValueForStorage(v));
                }
            }
            setNested(doc, k, arr);
        }
    }
    if (update.$setOnInsert) {
        // Only applied during upsert (handled at caller level)
        // For now, apply only if doc is new
    }
    if (update.$currentDate) {
        for (const [k, v] of Object.entries(update.$currentDate)) {
            if (v === true || (typeof v === 'object' && v.$type === 'date')) {
                setNested(doc, k, nowISO());
            }
        }
    }

    return doc;
}

function setNested(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (cur[p] == null || typeof cur[p] !== 'object' || Array.isArray(cur[p])) {
            cur[p] = {};
        }
        cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
}

function unsetNested(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) return;
        cur = cur[parts[i]];
    }
    delete cur[parts[parts.length - 1]];
}

/**
 * Prepare a value for SQLite storage: stringify objects/arrays.
 */
function prepareValueForStorage(v) {
    if (v === undefined) return null;
    if (v === null) return null;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object' && !Array.isArray(v)) {
        // Check if it's a plain object or a Date-like
        if (v instanceof Date) return v.toISOString();
        return v; // We'll handle JSON stringification at the column level
    }
    return v;
}

/**
 * Prepare a value for JSON column: stringify objects/arrays recursively.
 */
function prepareJsonValue(v) {
    const prepared = _prepareJsonRecursive(v);
    if (prepared === null || prepared === undefined) return null;
    if (typeof prepared === 'string') return prepared;
    return JSON.stringify(prepared);
}

function _prepareJsonRecursive(v) {
    if (v === undefined || v === null) return null;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(_prepareJsonRecursive);
    if (typeof v === 'object') {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
            out[k] = _prepareJsonRecursive(val);
        }
        return out;
    }
    return v;
}

/**
 * Parse a JSON column value back to an object/array.
 */
function parseJsonValue(v) {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'string') return v;
    try {
        return JSON.parse(v);
    } catch {
        return v;
    }
}

// ---------------------------------------------------------------------------
// Schema → SQL helpers
// ---------------------------------------------------------------------------

/** Map a schema field type to a SQLite column type. */
function sqliteType(type) {
    switch ((type || '').toUpperCase()) {
        case 'TEXT': case 'STRING': case 'MIXED': return 'TEXT';
        case 'NUMBER': case 'INTEGER': case 'INT': return 'INTEGER';
        case 'BOOLEAN': case 'BOOL': return 'INTEGER'; // 0/1
        case 'DATE': case 'DATETIME': return 'TEXT';    // ISO string
        case 'JSON': return 'TEXT';                     // JSON string
        case 'FLOAT': case 'DOUBLE': return 'REAL';
        default: return 'TEXT';
    }
}

/** Check if a schema field type should be stored as JSON. */
function isJsonType(type) {
    return (type || '').toUpperCase() === 'JSON';
}

/** Check if a schema field type is a boolean. */
function isBooleanType(type) {
    return (type || '').toUpperCase() === 'BOOLEAN' || (type || '').toUpperCase() === 'BOOL';
}

/** Check if a schema field type is a date. */
function isDateType(type) {
    const t = (type || '').toUpperCase();
    return t === 'DATE' || t === 'DATETIME';
}

/** Create the SQL table for a schema if it doesn't exist. */
function ensureTable(schema) {
    const d = getDb();
    const cols = [];
    const pkCols = [];

    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        const sqlColType = sqliteType(fieldDef.type);
        const parts = [`"${fieldName}" ${sqlColType}`];
        if (fieldDef.primaryKey) {
            parts.push('PRIMARY KEY');
            pkCols.push(fieldName);
        }
        if (fieldDef.unique && !fieldDef.primaryKey) {
            parts.push('UNIQUE');
        }
        if (fieldDef.notNull && !fieldDef.primaryKey) {
            parts.push('NOT NULL');
        }
        cols.push(parts.join(' '));
    }

    // If no explicit primary key, add _id
    if (pkCols.length === 0 && schema.fields._id) {
        // _id is already in fields
    }

    const sql = `CREATE TABLE IF NOT EXISTS "${schema.tableName}" (${cols.join(', ')})`;
    d.exec(sql);

    // Create indexes
    if (schema.indexes) {
        for (const idx of schema.indexes) {
            const cols = idx.columns.map(c => `"${c}"`).join(', ');
            const unique = idx.unique ? 'UNIQUE' : '';
            const ifNotExists = `CREATE ${unique} INDEX IF NOT EXISTS "idx_${schema.tableName}_${idx.columns.join('_')}" ON "${schema.tableName}" (${cols})`;
            try { d.exec(ifNotExists); } catch (e) { /* ignore */ }
        }
    }
}

// ---------------------------------------------------------------------------
// Row ↔ Object conversion
// ---------------------------------------------------------------------------

/**
 * Convert a SQLite row to a plain JS object, parsing JSON columns and booleans.
 */
function rowToObject(row, schema) {
    if (!row) return null;
    const obj = {};
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        let val = row[fieldName];
        if (val === undefined) val = null;

        if (isJsonType(fieldDef.type)) {
            obj[fieldName] = parseJsonValue(val);
        } else if (isBooleanType(fieldDef.type)) {
            obj[fieldName] = val === 1 || val === true || val === '1' || val === 'true';
        } else if (isDateType(fieldDef.type)) {
            obj[fieldName] = val ? new Date(val) : (fieldDef.default === null ? null : val);
        } else {
            obj[fieldName] = val;
        }
    }
    return obj;
}

/**
 * Convert a JS object to a row object suitable for SQLite, stringifying JSON columns.
 */
function objectToRow(obj, schema) {
    const row = {};
    for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
        let val = obj[fieldName];

        // Apply default if undefined
        if (val === undefined && fieldDef.default !== undefined) {
            val = typeof fieldDef.default === 'function' ? fieldDef.default() : fieldDef.default;
        }

        if (val === undefined || val === null) {
            row[fieldName] = null;
            continue;
        }

        if (isJsonType(fieldDef.type)) {
            row[fieldName] = prepareJsonValue(val);
        } else if (isBooleanType(fieldDef.type)) {
            row[fieldName] = val ? 1 : 0;
        } else if (isDateType(fieldDef.type)) {
            if (val instanceof Date) row[fieldName] = val.toISOString();
            else if (typeof val === 'number') row[fieldName] = new Date(val).toISOString();
            else row[fieldName] = String(val);
        } else {
            row[fieldName] = val;
        }
    }
    return row;
}

// ---------------------------------------------------------------------------
// Chainable query builder
// ---------------------------------------------------------------------------

function createQueryBuilder(schema, modelName) {
    const qb = {
        _filter: {},
        _sort: null,
        _skip: 0,
        _limit: null,
        _select: null,
        _lean: false,
        _chain: true,
        _populates: [],
    };

    qb.find = function (filter) { qb._filter = filter || {}; return qb; };
    qb.where = function (filter) { qb._filter = filter || {}; return qb; };
    qb.sort = function (s) { qb._sort = s; return qb; };
    qb.skip = function (n) { qb._skip = n; return qb; };
    qb.limit = function (n) { qb._limit = n; return qb; };
    qb.select = function (s) { qb._select = s; return qb; };
    qb.lean = function () { qb._lean = true; return qb; };

    // Support .populate('fieldName') or .populate({ path: 'fieldName', select: '...' })
    qb.populate = function (opts) {
        if (typeof opts === 'string') {
            qb._populates.push({ path: opts, select: null, model: null });
        } else if (opts && opts.path) {
            qb._populates.push(opts);
        } else if (Array.isArray(opts)) {
            opts.forEach(o => {
                if (typeof o === 'string') qb._populates.push({ path: o, select: null, model: null });
                else if (o && o.path) qb._populates.push(o);
            });
        }
        return qb;
    };

    qb.then = function (resolve, reject) {
        try {
            const results = executeFind(schema, qb._filter, qb._sort, qb._skip, qb._limit, qb._select, qb._populates);
            resolve(results);
        } catch (e) {
            if (reject) reject(e);
            else throw e;
        }
    };

    // Make it thenable (awaitable) + have .exec()
    qb.exec = function () {
        return executeFind(schema, qb._filter, qb._sort, qb._skip, qb._limit, qb._select, qb._populates);
    };

    // Also support being used as a promise
    qb[Symbol.toStringTag] = 'Promise';

    return qb;
}

function executeFind(schema, filter, sort, skip, limit, select, populates) {
    const d = getDb();
    const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
    let results = allRows.map(r => rowToObject(r, schema)).filter(doc => matchFilter(doc, filter));

    if (sort) {
        results = sortDocuments(results, sort);
    }
    if (skip) {
        results = results.slice(skip);
    }
    if (limit != null) {
        results = results.slice(0, limit);
    }
    if (select) {
        results = applySelect(results, select);
    }
    // Apply populates
    if (populates && populates.length > 0) {
        results = results.map(doc => applyPopulate(doc, populates));
    }
    return results;
}

function sortDocuments(docs, sort) {
    if (!sort) return docs;
    const sortEntries = typeof sort === 'string'
        ? sort.split(' ').filter(Boolean).map(s => s.startsWith('-') ? [s.slice(1), -1] : [s, 1])
        : Object.entries(sort);

    return [...docs].sort((a, b) => {
        for (const [key, dir] of sortEntries) {
            let aVal = getNested(a, key);
            let bVal = getNested(b, key);
            if (aVal == null && bVal == null) continue;
            if (aVal == null) return dir;
            if (bVal == null) return -dir;
            if (aVal instanceof Date) aVal = aVal.getTime();
            if (bVal instanceof Date) bVal = bVal.getTime();
            if (typeof aVal === 'string' && typeof bVal === 'string') {
                const cmp = aVal.localeCompare(bVal);
                if (cmp !== 0) return cmp * dir;
            } else {
                if (aVal < bVal) return -dir;
                if (aVal > bVal) return dir;
            }
        }
        return 0;
    });
}

function applySelect(results, select) {
    if (!select || typeof select !== 'object') return results;
    return results.map(doc => {
        const out = {};
        const hasInclude = Object.values(select).some(v => v === 1 || v === true);
        if (hasInclude) {
            // Inclusion mode
            out._id = doc._id;
            for (const [k, v] of Object.entries(select)) {
                if (k === '_id' && (v === 0 || v === false)) continue;
                if (v === 1 || v === true) {
                    out[k] = doc[k];
                }
            }
        } else {
            // Exclusion mode
            for (const [k, v] of Object.entries(doc)) {
                if (select[k] === 0 || select[k] === false) continue;
                out[k] = v;
            }
        }
        return out;
    });
}

// ---------------------------------------------------------------------------
// Populate engine — resolve referenced documents via JOIN
// ---------------------------------------------------------------------------

// Map model name → table name (populated lazily)
const _modelTableMap = {};
function getModelTableName(modelName) {
    if (_modelTableMap[modelName]) return _modelTableMap[modelName];
    const m = getModel(modelName);
    if (m && m._schema) { _modelTableMap[modelName] = m._schema.tableName; return m._schema.tableName; }
    const t = modelName.toLowerCase().replace(/([a-z])([A-Z])/g, '$1_$2') + 's';
    _modelTableMap[modelName] = t;
    return t;
}

// Map ref string → model name for common refs
const refModelMap = {
    User: 'User', Channel: 'Channel', Video: 'Video', ShopeeLink: 'ShopeeLink',
    SchedulePost: 'SchedulePost', Tracking: 'Tracking', TrackingPost: 'TrackingPost',
    AiScanConfig: 'AiScanConfig', AiComment: 'AiComment', CommentPlay: 'CommentPlay',
    AiContentSchedule: 'AiGeneratedPost', Product: 'Product', WritingStyle: 'WritingStyle',
    AutoContentPipeline: 'AutoContentPipeline', DouyinTracking: 'DouyinTracking',
    TikTokTracking: 'TikTokTracking', FacebookGroupCache: 'FacebookGroupCache',
};

// Try to determine the ref model from schema metadata
function findRefModelForField(schema, fieldName) {
    // Check if schema has a ref mapping
    if (schema.refs && schema.refs[fieldName]) return schema.refs[fieldName];
    // Fallback: guess from field name
    if (fieldName === 'userId') return 'User';
    if (fieldName === 'channelId' || fieldName === 'sourceChannelId' || fieldName === 'targetGroupSourceChannelId') return 'Channel';
    if (fieldName === 'videoId') return 'Video';
    if (fieldName === 'shopeeLinks') return 'ShopeeLink';
    if (fieldName === 'configId') return 'AiScanConfig';
    if (fieldName === 'playId') return 'CommentPlay';
    if (fieldName === 'commentId') return 'AiComment';
    if (fieldName === 'trackingId') return 'Tracking';
    if (fieldName === 'sourceAccountId') return 'Channel';
    if (fieldName === 'schedulePostId') return 'SchedulePost';
    if (fieldName === 'writingStyleId') return 'WritingStyle';
    if (fieldName === 'productId') return 'Product';
    if (fieldName === 'pipelineId') return 'AutoContentPipeline';
    if (fieldName === 'scheduleId') return 'SchedulePost';
    return null;
}

function applyPopulate(doc, populates) {
    if (!doc) return doc;
    const d = { ...doc };

    for (const pop of populates) {
        const fieldPath = pop.path;
        const selectFields = pop.select || null;

        // Handle nested paths like 'targetPlatforms.accountId'
        if (fieldPath.includes('.')) {
            const parts = fieldPath.split('.');
            const arrField = parts[0];
            const nestedField = parts[1];
            if (Array.isArray(d[arrField])) {
                d[arrField] = d[arrField].map(item => {
                    if (item && nestedField) {
                        const refModel = findRefModelForField(null, nestedField);
                        if (refModel && getModel(refModel)) {
                            const val = item[nestedField];
                            if (val && typeof val === 'string' && val.length >= 12) {
                                const refDoc = getModel(refModel).findById(val);
                                item[nestedField] = refDoc || val;
                            }
                        }
                    }
                    return item;
                });
            }
            continue;
        }

        const refModel = pop.model || findRefModelForField(null, fieldPath);
        if (!refModel || !getModel(refModel)) continue;

        const val = d[fieldPath];
        if (!val) continue;

        if (Array.isArray(val)) {
            // Array of ObjectIds (e.g., shopeeLinks: [id1, id2])
            d[fieldPath] = val.map(id => {
                if (typeof id === 'string' && id.length >= 12) {
                    const refDoc = getModel(refModel).findById(id);
                    if (refDoc && selectFields) {
                        return applySelectObject(refDoc, selectFields);
                    }
                    return refDoc || id;
                }
                return id;
            });
        } else if (typeof val === 'string' && val.length >= 12) {
            // Single ObjectId
            const refDoc = getModel(refModel).findById(val);
            if (refDoc && selectFields) {
                d[fieldPath] = applySelectObject(refDoc, selectFields);
            } else {
                d[fieldPath] = refDoc || val;
            }
        }
    }
    return d;
}

function applySelectObject(doc, select) {
    if (!select || typeof select !== 'object') return doc;
    const out = { _id: doc._id };
    for (const [k, v] of Object.entries(select)) {
        if (k === '_id' && (v === 0 || v === false)) continue;
        if (v === 1 || v === true) out[k] = doc[k];
    }
    return out;
}

// ---------------------------------------------------------------------------
// Model factory
// ---------------------------------------------------------------------------

function createModel(schema) {
    ensureTable(schema);

    const modelName = schema.tableName;

    const model = {
        _schema: schema,
        _tableName: schema.tableName,

        // --- Static methods (Mongoose-compatible) ---

        find(filter) {
            return createQueryBuilder(schema, modelName).find(filter);
        },

        findOne(filter) {
            // Return chainable query builder (Mongoose-compatible)
            const qb = createQueryBuilder(schema, modelName);
            qb._filter = filter || {};
            qb._limit = 1;
            // Override exec/then to return single doc
            const origThen = qb.then;
            qb.then = function (resolve, reject) {
                try {
                    const results = executeFind(schema, qb._filter, qb._sort, qb._skip, qb._limit, qb._select, qb._populates);
                    resolve(results.length > 0 ? results[0] : null);
                } catch (e) {
                    if (reject) reject(e);
                    else throw e;
                }
            };
            qb.exec = function () {
                const results = executeFind(schema, qb._filter, qb._sort, qb._skip, qb._limit, qb._select, qb._populates);
                return results.length > 0 ? results[0] : null;
            };
            return qb;
        },

        findById(id) {
            return this.findOne({ _id: id });
        },

        create(data) {
            const d = getDb();
            if (Array.isArray(data)) {
                return data.map(item => this._insertOne(item));
            }
            return this._insertOne(data);
        },

        _insertOne(data) {
            const d = getDb();
            // Ensure _id
            if (!data._id) {
                data = { _id: generateObjectId(), ...data };
            }
            const row = objectToRow(data, schema);
            const cols = Object.keys(row);
            const placeholders = cols.map(() => '?').join(', ');
            const sql = `INSERT INTO "${schema.tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
            d.prepare(sql).run(...cols.map(c => row[c]));
            return rowToObject(row, schema);
        },

        insertMany(arr) {
            if (!Array.isArray(arr) || arr.length === 0) return [];
            const d = getDb();
            const items = arr.map(item => {
                if (!item._id) item = { _id: generateObjectId(), ...item };
                return objectToRow(item, schema);
            });
            const cols = Object.keys(items[0]);
            const placeholders = cols.map(() => '?').join(', ');
            const sql = `INSERT INTO "${schema.tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`;
            const insert = d.prepare(sql);
            const tx = d.transaction((rows) => {
                const results = [];
                for (const row of rows) {
                    insert.run(...cols.map(c => row[c]));
                    results.push(rowToObject(row, schema));
                }
                return results;
            });
            return tx(items);
        },

        updateOne(filter, update, options = {}) {
            const d = getDb();
            const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            const docs = allRows.map(r => rowToObject(r, schema));
            const target = docs.find(doc => matchFilter(doc, filter));
            if (!target) {
                if (options.upsert) {
                    const newDoc = { _id: generateObjectId() };
                    // Apply filter equality fields
                    for (const [k, v] of Object.entries(filter)) {
                        if (k.startsWith('$')) continue;
                        if (typeof v !== 'object' || v === null) {
                            setNested(newDoc, k, v);
                        }
                    }
                    applyUpdate(newDoc, update);
                    if (update.$setOnInsert) applyUpdate(newDoc, { $set: update.$setOnInsert });
                    const inserted = this._insertOne(newDoc);
                    return { matchedCount: 0, modifiedCount: 0, upsertedId: inserted._id };
                }
                return { matchedCount: 0, modifiedCount: 0, upsertedId: null };
            }
            applyUpdate(target, update);
            // Write back
            const row = objectToRow(target, schema);
            const cols = Object.keys(row);
            const sets = cols.map(c => `"${c}" = ?`).join(', ');
            d.prepare(`UPDATE "${schema.tableName}" SET ${sets} WHERE "_id" = ?`).run(...cols.map(c => row[c]), target._id);
            return { matchedCount: 1, modifiedCount: 1, upsertedId: null };
        },

        updateMany(filter, update) {
            const d = getDb();
            const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            const docs = allRows.map(r => rowToObject(r, schema));
            const targets = docs.filter(doc => matchFilter(doc, filter));
            if (targets.length === 0) return { matchedCount: 0, modifiedCount: 0 };
            let modified = 0;
            for (const target of targets) {
                applyUpdate(target, update);
                const row = objectToRow(target, schema);
                const cols = Object.keys(row);
                const sets = cols.map(c => `"${c}" = ?`).join(', ');
                d.prepare(`UPDATE "${schema.tableName}" SET ${sets} WHERE "_id" = ?`).run(...cols.map(c => row[c]), target._id);
                modified++;
            }
            return { matchedCount: targets.length, modifiedCount: modified };
        },

        findOneAndUpdate(filter, update, options = {}) {
            const d = getDb();
            const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            const docs = allRows.map(r => rowToObject(r, schema));
            let target = docs.find(doc => matchFilter(doc, filter));

            if (!target) {
                if (options.upsert) {
                    const newDoc = { _id: generateObjectId() };
                    // Apply filter equality fields first
                    for (const [k, v] of Object.entries(filter)) {
                        if (k.startsWith('$')) continue;
                        if (typeof v !== 'object' || v === null) {
                            setNested(newDoc, k, v);
                        }
                    }
                    // Then apply update operators (overrides filter fields)
                    applyUpdate(newDoc, update);
                    this._insertOne(newDoc);
                    return options.new !== false ? this.findById(newDoc._id) : rowToObject(objectToRow(newDoc, schema), schema);
                }
                return null;
            }

            applyUpdate(target, update);
            const row = objectToRow(target, schema);
            const cols = Object.keys(row);
            const sets = cols.map(c => `"${c}" = ?`).join(', ');
            d.prepare(`UPDATE "${schema.tableName}" SET ${sets} WHERE "_id" = ?`).run(...cols.map(c => row[c]), target._id);
            return options.new ? rowToObject(row, schema) : rowToObject(row, schema);
        },

        findOneAndDelete(filter) {
            const d = getDb();
            const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            const docs = allRows.map(r => rowToObject(r, schema));
            const target = docs.find(doc => matchFilter(doc, filter));
            if (!target) return null;
            d.prepare(`DELETE FROM "${schema.tableName}" WHERE "_id" = ?`).run(target._id);
            return target;
        },

        findByIdAndUpdate(id, update, options = {}) {
            return this.findOneAndUpdate({ _id: id }, update, options);
        },

        findByIdAndDelete(id) {
            return this.findOneAndDelete({ _id: id });
        },

        deleteOne(filter) {
            const d = getDb();
            const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            const docs = allRows.map(r => rowToObject(r, schema));
            const target = docs.find(doc => matchFilter(doc, filter));
            if (!target) return { deletedCount: 0 };
            d.prepare(`DELETE FROM "${schema.tableName}" WHERE "_id" = ?`).run(target._id);
            return { deletedCount: 1 };
        },

        deleteMany(filter) {
            const d = getDb();
            const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            const docs = allRows.map(r => rowToObject(r, schema));
            const targets = docs.filter(doc => matchFilter(doc, filter));
            if (targets.length === 0) return { deletedCount: 0 };
            const del = d.prepare(`DELETE FROM "${schema.tableName}" WHERE "_id" = ?`);
            const tx = d.transaction((ids) => {
                for (const id of ids) del.run(id);
            });
            tx(targets.map(t => t._id));
            return { deletedCount: targets.length };
        },

        countDocuments(filter) {
            const d = getDb();
            let allRows;
            try {
                allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            } catch (e) {
                if (e.code === 'SQLITE_ERROR') return 0;
                throw e;
            }
            const docs = allRows.map(r => rowToObject(r, schema));
            if (!filter || Object.keys(filter).length === 0) return docs.length;
            return docs.filter(doc => matchFilter(doc, filter)).length;
        },

        distinct(field, filter) {
            const d = getDb();
            const allRows = d.prepare(`SELECT * FROM "${schema.tableName}"`).all();
            const docs = allRows.map(r => rowToObject(r, schema));
            const filtered = filter ? docs.filter(doc => matchFilter(doc, filter)) : docs;
            const seen = new Set();
            const result = [];
            for (const doc of filtered) {
                const val = getNested(doc, field);
                if (val === undefined || val === null) continue;
                const key = typeof val === 'object' ? JSON.stringify(val) : String(val);
                if (!seen.has(key)) {
                    seen.add(key);
                    result.push(val);
                }
            }
            return result;
        },

        aggregate(pipeline) {
            const d = getDb();
            let docs = d.prepare(`SELECT * FROM "${schema.tableName}"`).all().map(r => rowToObject(r, schema));

            for (const stage of pipeline) {
                if (stage.$match) {
                    docs = docs.filter(doc => matchFilter(doc, stage.$match));
                } else if (stage.$unwind) {
                    const field = stage.$unwind.startsWith('$') ? stage.$unwind.slice(1) : stage.$unwind;
                    const preserveNull = stage.preserveNullAndEmptyArrays;
                    const newDocs = [];
                    for (const doc of docs) {
                        const arr = getNested(doc, field);
                        if (Array.isArray(arr) && arr.length > 0) {
                            for (const item of arr) {
                                newDocs.push({ ...doc, [field]: item });
                            }
                        } else if (preserveNull) {
                            newDocs.push({ ...doc, [field]: null });
                        }
                    }
                    docs = newDocs;
                } else if (stage.$group) {
                    const groups = new Map();
                    const groupId = stage.$group._id;
                    for (const doc of docs) {
                        let key;
                        if (groupId === null) {
                            key = '__null__';
                        } else if (typeof groupId === 'string' && groupId.startsWith('$')) {
                            key = String(getNested(doc, groupId.slice(1)));
                        } else if (typeof groupId === 'object' && groupId !== null) {
                            key = JSON.stringify(Object.fromEntries(
                                Object.entries(groupId).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('$') ? getNested(doc, v.slice(1)) : v])
                            ));
                        } else {
                            key = String(groupId);
                        }
                        if (!groups.has(key)) {
                            groups.set(key, { _id: groupId === null ? null : (typeof groupId === 'string' && groupId.startsWith('$') ? getNested(doc, groupId.slice(1)) : groupId), _docs: [] });
                        }
                        groups.get(key)._docs.push(doc);
                    }
                    const result = [];
                    for (const [, group] of groups) {
                        const out = { _id: group._id };
                        for (const [k, v] of Object.entries(stage.$group)) {
                            if (k === '_id') continue;
                            if (typeof v === 'object' && v !== null) {
                                if ('$sum' in v) {
                                    if (v.$sum === 1) {
                                        out[k] = group._docs.length;
                                    } else if (typeof v.$sum === 'string' && v.$sum.startsWith('$')) {
                                        const f = v.$sum.slice(1);
                                        out[k] = group._docs.reduce((sum, d) => sum + (Number(getNested(d, f)) || 0), 0);
                                    } else {
                                        out[k] = group._docs.reduce((sum, d) => sum + (Number(v.$sum) || 0), 0);
                                    }
                                } else if ('$avg' in v) {
                                    const f = v.$avg.startsWith('$') ? v.$avg.slice(1) : null;
                                    if (f) {
                                        const sum = group._docs.reduce((s, d) => s + (Number(getNested(d, f)) || 0), 0);
                                        out[k] = group._docs.length ? sum / group._docs.length : 0;
                                    }
                                } else if ('$min' in v) {
                                    const f = v.$min.startsWith('$') ? v.$min.slice(1) : null;
                                    if (f) {
                                        out[k] = Math.min(...group._docs.map(d => Number(getNested(d, f)) || 0));
                                    }
                                } else if ('$max' in v) {
                                    const f = v.$max.startsWith('$') ? v.$max.slice(1) : null;
                                    if (f) {
                                        out[k] = Math.max(...group._docs.map(d => Number(getNested(d, f)) || 0));
                                    }
                                } else if ('$first' in v) {
                                    const f = v.$first.startsWith('$') ? v.$first.slice(1) : null;
                                    out[k] = f ? getNested(group._docs[0], f) : group._docs[0]?._id;
                                } else if ('$last' in v) {
                                    const f = v.$last.startsWith('$') ? v.$last.slice(1) : null;
                                    out[k] = f ? getNested(group._docs[group._docs.length - 1], f) : group._docs[group._docs.length - 1]?._id;
                                } else if ('$push' in v) {
                                    const f = v.$push.startsWith('$') ? v.$push.slice(1) : null;
                                    out[k] = f ? group._docs.map(d => getNested(d, f)) : [...group._docs];
                                } else {
                                    out[k] = group._docs.length;
                                }
                            } else {
                                out[k] = group._docs.length;
                            }
                        }
                        result.push(out);
                    }
                    docs = result;
                } else if (stage.$sort) {
                    docs = sortDocuments(docs, stage.$sort);
                } else if (stage.$project) {
                    docs = docs.map(doc => {
                        const out = {};
                        const hasInclude = Object.values(stage.$project).some(v => v === 1 || v === true);
                        if (hasInclude) {
                            out._id = stage.$project._id !== 0 ? doc._id : undefined;
                            for (const [k, v] of Object.entries(stage.$project)) {
                                if (v === 1 || v === true) out[k] = doc[k];
                            }
                        } else {
                            for (const [k, v] of Object.entries(doc)) {
                                if (stage.$project[k] === 0 || stage.$project[k] === false) continue;
                                out[k] = v;
                            }
                        }
                        return out;
                    });
                } else if (stage.$limit) {
                    docs = docs.slice(0, stage.$limit);
                } else if (stage.$skip) {
                    docs = docs.slice(stage.$skip);
                } else if (stage.$addFields) {
                    docs = docs.map(doc => {
                        const out = { ...doc };
                        for (const [k, v] of Object.entries(stage.$addFields)) {
                            if (typeof v === 'string' && v.startsWith('$')) {
                                out[k] = getNested(out, v.slice(1));
                            } else {
                                out[k] = v;
                            }
                        }
                        return out;
                    });
                } else if (stage.$replaceRoot) {
                    if (stage.$replaceRoot.newRoot) {
                        docs = docs.map(doc => {
                            if (typeof stage.$replaceRoot.newRoot === 'string' && stage.$replaceRoot.newRoot.startsWith('$')) {
                                return getNested(doc, stage.$replaceRoot.newRoot.slice(1));
                            }
                            return stage.$replaceRoot.newRoot;
                        });
                    }
                }
            }

            return docs;
        },

        populate(docs, options) {
            if (!docs) return docs;
            const wasArray = Array.isArray(docs);
            if (!wasArray) docs = [docs];
            if (docs.length === 0) return wasArray ? [] : null;

            const d = getDb();

            // options: { path, model, select, match }
            const populateList = Array.isArray(options) ? options : [options];
            const result = [...docs];

            for (const opt of populateList) {
                const { path, model: refModelName, localField, foreignField, select: selectFields, match: matchFilter } = opt;
                if (!path) continue;

                // Find the referenced model's schema
                const refSchema = getModelSchema(refModelName);
                if (!refSchema) continue;

                const refTable = refSchema.tableName;
                const refRows = d.prepare(`SELECT * FROM "${refTable}"`).all().map(r => rowToObject(r, refSchema));

                const local = localField || path;
                const foreign = foreignField || '_id';

                for (const doc of result) {
                    const lookupVal = getNested(doc, local);
                    if (lookupVal == null) {
                        doc[path] = null;
                        continue;
                    }

                    if (Array.isArray(lookupVal)) {
                        let matched = refRows.filter(r => {
                            const refVal = getNested(r, foreign);
                            return lookupVal.some(v => strictEqual(v, refVal));
                        });
                        if (matchFilter) matched = matched.filter(r => matchFilter(r, matchFilter));
                        if (selectFields) matched = applySelect(matched, parseSelectString(selectFields));
                        doc[path] = matched;
                    } else {
                        let matched = refRows.find(r => strictEqual(getNested(r, foreign), lookupVal));
                        if (matched && matchFilter && !matchFilter(matched)) matched = null;
                        if (matched && selectFields) {
                            const selected = applySelect([matched], parseSelectString(selectFields));
                            matched = selected[0] || null;
                        }
                        doc[path] = matched || null;
                    }
                }
            }

            return wasArray ? result : result[0];
        },

        /** Mongoose save() instance method — update or insert a document. */
        save(doc) {
            if (!doc || !doc._id) throw new Error('save() requires a document with _id');
            const d = getDb();
            const existing = d.prepare(`SELECT _id FROM "${schema.tableName}" WHERE "_id" = ?`).get(doc._id);
            const row = objectToRow(doc, schema);
            const cols = Object.keys(row);
            if (existing) {
                const sets = cols.map(c => `"${c}" = ?`).join(', ');
                d.prepare(`UPDATE "${schema.tableName}" SET ${sets} WHERE "_id" = ?`).run(...cols.map(c => row[c]), doc._id);
            } else {
                const placeholders = cols.map(() => '?').join(', ');
                d.prepare(`INSERT INTO "${schema.tableName}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`).run(...cols.map(c => row[c]));
            }
            return doc;
        },

        // Utility: list all rows
        findAll() {
            const d = getDb();
            return d.prepare(`SELECT * FROM "${schema.tableName}"`).all().map(r => rowToObject(r, schema));
        },

        // Utility: drop the table
        drop() {
            const d = getDb();
            d.exec(`DROP TABLE IF EXISTS "${schema.tableName}"`);
        },

        // Utility: truncate the table
        truncate() {
            const d = getDb();
            d.exec(`DELETE FROM "${schema.tableName}"`);
        },
    };

    // Store model reference for populate lookups
    registeredModels.set(modelName, model);

    return model;
}

// ---------------------------------------------------------------------------
// Model registry (for populate)
// ---------------------------------------------------------------------------

const registeredModels = new Map();

function getModelSchema(modelName) {
    const m = registeredModels.get(modelName);
    return m ? m._schema : null;
}

function getModel(modelName) {
    return registeredModels.get(modelName) || null;
}

// ---------------------------------------------------------------------------
// Select string parser (for populate)
// ---------------------------------------------------------------------------

function parseSelectString(sel) {
    if (!sel || typeof sel !== 'string') return sel;
    const parts = sel.split(/\s+/).filter(Boolean);
    const out = {};
    for (const p of parts) {
        if (p.startsWith('-')) {
            out[p.slice(1)] = 0;
        } else {
            out[p] = 1;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
    connectSQLite,
    getDb,
    createModel,
    generateObjectId,
    matchFilter,
    applyUpdate,
    registeredModels,
    getModel,
};
