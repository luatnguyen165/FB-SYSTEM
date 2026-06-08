// public/js/device.js
// Device fingerprinting - captures device info and registers with server

(function () {
    'use strict';

    /**
     * Generate a device fingerprint based on browser/system characteristics
     * Uses multiple signals to create a unique hash
     */
    async function generateDeviceId() {
        const signals = [
            navigator.userAgent || '',
            navigator.platform || '',
            navigator.language || '',
            screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
            new Date().getTimezoneOffset(),
            navigator.hardwareConcurrency || '',
            navigator.deviceMemory || '',
            // Canvas fingerprint (disabled if too restrictive)
        ];

        const fingerprint = signals.join('|||');

        // Use SHA-256 hash via SubtleCrypto if available
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(fingerprint);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) {
            // Fallback: simple hash
            let hash = 0;
            for (let i = 0; i < fingerprint.length; i++) {
                const char = fingerprint.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return 'fallback_' + Math.abs(hash).toString(16);
        }
    }

    /**
     * Register this device with the server
     */
    async function registerDevice(userId) {
        if (!userId) return;

        try {
            const deviceId = await generateDeviceId();
            const platform = navigator.platform || '';

            const response = await fetch('/auth/api/device', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, deviceId, platform })
            });

            const data = await response.json();
            if (data.success) {
                console.log('[Device] Registered successfully. Total devices:', data.deviceCount);
                // Store deviceId locally for reference
                try {
                    localStorage.setItem('fb_device_id', deviceId);
                } catch (e) { /* ignore */ }
            } else {
                console.warn('[Device] Registration failed:', data.message);
            }
        } catch (err) {
            console.warn('[Device] Registration error:', err.message);
        }
    }

    // Auto-run when DOM is ready - check if user is logged in
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDeviceTracking);
    } else {
        initDeviceTracking();
    }

    /**
     * Check if we're on the login page and intercept form submit
     */
    function setupLoginPageTracking() {
        const loginForm = document.querySelector('#loginForm');
        if (!loginForm) return;

        loginForm.addEventListener('submit', async function (e) {
            // Let the form submit naturally, then after redirect
            // the new page will have __USER_ID__
        });
    }

    function initDeviceTracking() {
        // Check for userId from data attribute or global variable
        let userId = null;

        // From window.__USER_ID__ (set by EJS templates)
        if (window.__USER_ID__) {
            userId = window.__USER_ID__;
        }

        // From meta tag
        const meta = document.querySelector('meta[name="user-id"]');
        if (meta) {
            userId = meta.getAttribute('content');
        }

        // Store userId for later use
        if (userId) {
            window.__DEVICE_USER_ID__ = userId;
            // Register device after a short delay (don't block page load)
            setTimeout(function () {
                registerDevice(userId);
            }, 2000);
        }

        // Also try from cookie (for login page redirect)
        if (!userId) {
            try {
                const token = document.cookie.split('; ').find(row => row.startsWith('remember_token='));
                if (token) {
                    userId = token.split('=')[1];
                    setTimeout(function () {
                        registerDevice(userId);
                    }, 3000);
                }
            } catch (e) { /* ignore */ }
        }
    }

    // Export for manual use
    window.__registerDevice = registerDevice;
    window.__getDeviceId = generateDeviceId;
})();