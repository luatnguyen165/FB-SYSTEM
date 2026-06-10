const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_DIR = path.join(global.USER_DATA_DIR || path.join(__dirname, '..'), 'uploads', 'crypto-keys');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'public.pem');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'private.pem');

const RSA_PREFIX = 'rsa:v1:';
const REST_PREFIX = 'enc:v1:';

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// In-memory caches — keys don't change at runtime, so compute/read once.
let _keyPairCache = null;
let _restKeyCache = null;

function ensureKeyPair() {
    if (_keyPairCache) return _keyPairCache;

    ensureDir(KEY_DIR);

    if (fs.existsSync(PUBLIC_KEY_PATH) && fs.existsSync(PRIVATE_KEY_PATH)) {
        _keyPairCache = {
            publicKey: fs.readFileSync(PUBLIC_KEY_PATH, 'utf8'),
            privateKey: fs.readFileSync(PRIVATE_KEY_PATH, 'utf8')
        };
        return _keyPairCache;
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, 'utf8');
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, 'utf8');

    _keyPairCache = { publicKey, privateKey };
    return _keyPairCache;
}

function getPublicKey() {
    return ensureKeyPair().publicKey;
}

function getPrivateKey() {
    return ensureKeyPair().privateKey;
}

function getRestKey() {
    if (_restKeyCache) return _restKeyCache;
    _restKeyCache = crypto.createHash('sha256').update(
        process.env.DATA_ENCRYPTION_SECRET || process.env.SESSION_SECRET || 'fb-system-encryption'
    ).digest();
    return _restKeyCache;
}

function isEncryptedValue(value) {
    return typeof value === 'string' && (value.startsWith(RSA_PREFIX) || value.startsWith(REST_PREFIX));
}

function bufferToBase64(buffer) {
    return Buffer.from(buffer).toString('base64');
}

function base64ToBuffer(value) {
    return Buffer.from(String(value), 'base64');
}

function encryptForTransport(value) {
    if (value === undefined || value === null || value === '') return '';

    const encrypted = crypto.publicEncrypt(
        {
            key: getPublicKey(),
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        },
        Buffer.from(String(value), 'utf8')
    );

    return `${RSA_PREFIX}${bufferToBase64(encrypted)}`;
}

function decryptTransportValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !value.startsWith(RSA_PREFIX)) return value;

    const payload = base64ToBuffer(value.slice(RSA_PREFIX.length));
    const decrypted = crypto.privateDecrypt(
        {
            key: getPrivateKey(),
            padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        },
        payload
    );

    return decrypted.toString('utf8');
}

function encryptAtRest(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'string' && value.startsWith(REST_PREFIX)) return value;

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getRestKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, authTag, encrypted]);

    return `${REST_PREFIX}${bufferToBase64(payload)}`;
}

function decryptAtRest(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !value.startsWith(REST_PREFIX)) return value;

    const payload = base64ToBuffer(value.slice(REST_PREFIX.length));
    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', getRestKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
}

function normalizeEncryptedValue(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') return value;
    if (value.startsWith(RSA_PREFIX)) return decryptTransportValue(value);
    if (value.startsWith(REST_PREFIX)) return decryptAtRest(value);
    return value;
}

function prepareSensitiveValue(value, encryptedAtRest = false) {
    const plainValue = normalizeEncryptedValue(value);
    if (plainValue === undefined || plainValue === null || plainValue === '') return '';
    return encryptedAtRest ? encryptAtRest(plainValue) : String(plainValue);
}

function decryptRecord(record, fields = []) {
    if (!record) return record;
    const clone = Array.isArray(record) ? record.map(item => decryptRecord(item, fields)) : { ...record };

    fields.forEach((field) => {
        if (clone[field] !== undefined) {
            clone[field] = normalizeEncryptedValue(clone[field]);
        }
    });

    return clone;
}

function restoreRecordForView(record, fields = []) {
    return decryptRecord(record, fields);
}

module.exports = {
    RSA_PREFIX,
    REST_PREFIX,
    getPublicKey,
    encryptForTransport,
    decryptTransportValue,
    encryptAtRest,
    decryptAtRest,
    normalizeEncryptedValue,
    prepareSensitiveValue,
    decryptRecord,
    restoreRecordForView,
    isEncryptedValue
};