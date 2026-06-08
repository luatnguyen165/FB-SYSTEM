/* ===================================
   TOAST.JS - Toast Notification System
   =================================== */

// Create toast container if not exists
const toastContainer = document.createElement('div');
toastContainer.className = 'toast-container';
document.body.appendChild(toastContainer);

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 */
function showToast(message, type = 'success') {
    console.log('[TOAST DEBUG] called:', message, type);
    const icons = {
        success: 'fa-solid fa-circle-check',
        error: 'fa-solid fa-circle-xmark',
        warning: 'fa-solid fa-triangle-exclamation',
        info: 'fa-solid fa-circle-info'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="toast-icon ${icons[type]}"></i>
        <span class="toast-message">${message}</span>
        <button class="toast-close" type="button" data-toast-close>&times;</button>
    `;

    toast.querySelector('[data-toast-close]')?.addEventListener('click', () => toast.remove());

    toastContainer.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 3000);
}

// Make globally available
if (typeof window !== 'undefined') {
    window.showToast = showToast;
}

// Auto show flash message from <body data-flash-message data-flash-type>
const bodyFlashMessage = document.body?.dataset?.flashMessage;
const bodyFlashType = document.body?.dataset?.flashType || 'success';

if (bodyFlashMessage) {
    try {
        showToast(JSON.parse(bodyFlashMessage), bodyFlashType);
    } catch (error) {
        showToast(bodyFlashMessage, bodyFlashType);
    }
}
