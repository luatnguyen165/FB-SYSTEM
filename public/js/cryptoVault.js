/* ===================================
   CRYPTO VAULT - Mã hoá dữ liệu nhạy cảm ở client
   Dùng chung cho Settings / Storage / Channels
   =================================== */

(function () {
    const SECURITY_ENDPOINT = '/settings/api/security';
    let cachedSecurityConfig = null;
    let securityConfigPromise = null;
    const importedKeyCache = new Map();

    function base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function pemToArrayBuffer(pem) {
        const base64 = pem
            .replace(/-----BEGIN PUBLIC KEY-----/g, '')
            .replace(/-----END PUBLIC KEY-----/g, '')
            .replace(/\s+/g, '');
        return base64ToArrayBuffer(base64);
    }

    async function getSecurityConfig() {
        if (cachedSecurityConfig) return cachedSecurityConfig;
        if (!securityConfigPromise) {
            securityConfigPromise = fetch(SECURITY_ENDPOINT)
                .then(res => res.json())
                .then(data => {
                    cachedSecurityConfig = data?.success ? data : { success: false, dataEncryptionEnabled: false };
                    return cachedSecurityConfig;
                })
                .catch(() => {
                    cachedSecurityConfig = { success: false, dataEncryptionEnabled: false };
                    return cachedSecurityConfig;
                });
        }
        return securityConfigPromise;
    }

    async function importPublicKey(publicKeyPem) {
        if (!publicKeyPem) throw new Error('Missing public key');
        if (importedKeyCache.has(publicKeyPem)) return importedKeyCache.get(publicKeyPem);

        const importedKey = await window.crypto.subtle.importKey(
            'spki',
            pemToArrayBuffer(publicKeyPem),
            {
                name: 'RSA-OAEP',
                hash: 'SHA-256'
            },
            false,
            ['encrypt']
        );

        importedKeyCache.set(publicKeyPem, importedKey);
        return importedKey;
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    async function encryptText(text, publicKeyPem) {
        if (text === undefined || text === null || text === '') return '';
        const key = await importPublicKey(publicKeyPem);
        const encryptedBuffer = await window.crypto.subtle.encrypt(
            { name: 'RSA-OAEP' },
            key,
            new TextEncoder().encode(String(text))
        );
        return `rsa:v1:${arrayBufferToBase64(encryptedBuffer)}`;
    }

    async function encryptPayload(payload, fields = []) {
        const config = await getSecurityConfig();
        if (!config?.dataEncryptionEnabled) return payload;

        const publicKey = config.publicKey;
        if (!publicKey) return payload;

        const result = { ...payload };
        for (const field of fields) {
            if (Object.prototype.hasOwnProperty.call(result, field) && result[field] !== undefined && result[field] !== null && result[field] !== '') {
                result[field] = await encryptText(result[field], publicKey);
            }
        }
        return result;
    }

    async function encryptFormDataEntries(entries = []) {
        const config = await getSecurityConfig();
        if (!config?.dataEncryptionEnabled || !config.publicKey) return entries;

        const result = [];
        for (const entry of entries) {
            if (entry && entry.encrypt && entry.value !== undefined && entry.value !== null && entry.value !== '') {
                result.push({ ...entry, value: await encryptText(entry.value, config.publicKey) });
            } else {
                result.push(entry);
            }
        }
        return result;
    }

    window.cryptoVault = {
        getSecurityConfig,
        encryptText,
        encryptPayload,
        encryptFormDataEntries
    };
})();