// ============================================================
// REBROWSER-PATCHES: Fix CDP Runtime.Enable leak
// PHẢI set TRƯỚC KHI require playwright ở bất kỳ đâu
// ============================================================
process.env.REBROWSER_PATCHES_RUNTIME_FIX_MODE = 'addBinding';

const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const http = require('http');
const fs = require('fs');

// === Config ===
const isDev = !app.isPackaged;
const USER_DATA_DIR = app.getPath('userData');
const PORT = parseInt(process.env.PORT, 10) || 4000;
const APP_PATH = path.join(__dirname, '..', 'app.js');

let mainWindow = null;
let tray = null;
let serverStarted = false;
let SERVER_URL = `http://localhost:${PORT}`;

// === Auto Updater Config (Tự động hoàn toàn) ===
autoUpdater.autoDownload = true;  // Tự động tải về khi có bản cập nhật
autoUpdater.autoInstallOnAppQuit = true; // Tự động cài đặt khi thoát app
autoUpdater.allowPrerelease = false; // Chỉ nhận bản stable

// === Ensure writable directories exist in userData ===
function ensureUserDirectories() {
    const dirs = ['uploads', 'uploads/ai-images', 'uploads/competitor-posts', 
                  'uploads/crypto-keys', 'uploads/images', 'uploads/video-projects', 
                  'uploads/videos', 'page_post', 'page_post/PANZI',
                  'social-sessions', 'views/fb_session', 'public/music', 'public/output'];
    
    dirs.forEach(dir => {
        const fullPath = path.join(USER_DATA_DIR, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
            console.log(`[Electron] Created directory: ${fullPath}`);
        }
    });
}

// === Start Express Server ===
function startExpressServer() {
    return new Promise((resolve, reject) => {
        try {
            process.env.USER_DATA_DIR = USER_DATA_DIR;
            require(APP_PATH);

            const checkServer = (attempt = 0) => {
                if (attempt > 60) {
                    return reject(new Error('Express server did not start in time'));
                }
                http.get(SERVER_URL, (res) => {
                    serverStarted = true;
                    console.log(`[Electron] Express server ready at ${SERVER_URL}`);
                    resolve();
                }).on('error', () => {
                    setTimeout(() => checkServer(attempt + 1), 500);
                });
            };
            
            setTimeout(() => checkServer(), 1000);
        } catch (err) {
            reject(err);
        }
    });
}

// === Create Main Window ===
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1024,
        minHeight: 680,
        icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false
        },
        show: false,
        autoHideMenuBar: true,
        title: 'FB System'
    });

    mainWindow.loadURL(SERVER_URL);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(SERVER_URL)) {
            return { action: 'allow' };
        }
        require('electron').shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// === System Tray ===
function createTray() {
    const iconPath = path.join(__dirname, '..', 'public', 'favicon.ico');
    let trayIcon;
    try {
        trayIcon = nativeImage.createFromPath(iconPath);
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
    } catch {
        trayIcon = nativeImage.createEmpty();
    }

    tray = new Tray(trayIcon);
    tray.setToolTip('FB System');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Mở FB System',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Kiểm tra cập nhật...',
            click: () => {
                autoUpdater.checkForUpdates();
            }
        },
        { type: 'separator' },
        {
            label: 'Thoát',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// === Auto Update Handlers (Tự động hoàn toàn) ===
function setupAutoUpdater() {
    if (isDev) {
        console.log('[AutoUpdater] Skipping update in dev mode');
        return;
    }

    // Kiểm tra cập nhật sau 5 giây
    setTimeout(() => {
        console.log('[AutoUpdater] Checking for updates...');
        autoUpdater.checkForUpdates();
    }, 5000);

    // Có bản cập nhật - tự động tải về
    autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdater] Update available:', info.version);
        
        // Gửi thông báo đến window
        if (mainWindow) {
            mainWindow.webContents.send('update-available', info);
            mainWindow.webContents.executeJavaScript(`
                window.dispatchEvent(new CustomEvent('update-available', { 
                    detail: { version: '${info.version}' } 
                }));
            `);
        }

        // Hiển thị notification
        const notification = new Notification({
            title: 'Đang tải bản cập nhật...',
            body: `Phiên bản ${info.version} đang được tải về.`,
            icon: path.join(__dirname, '..', 'public', 'favicon.ico')
        });
        notification.show();
    });

    // Không có cập nhật
    autoUpdater.on('update-not-available', (info) => {
        console.log('[AutoUpdater] No update available:', info.version);
    });

    // Tiến trình tải
    autoUpdater.on('download-progress', (progressObj) => {
        const percent = Math.round(progressObj.percent);
        console.log(`[AutoUpdater] Downloading: ${percent}%`);
        
        if (mainWindow) {
            mainWindow.webContents.send('update-progress', progressObj);
        }

        // Update tray tooltip
        if (tray) {
            tray.setToolTip(`FB System - Đang tải cập nhật (${percent}%)`);
        }
    });

    // Tải xong - thông báo user khởi động lại
    autoUpdater.on('update-downloaded', (info) => {
        console.log('[AutoUpdater] Update downloaded:', info.version);
        
        if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', info);
        }

        // Khôi phục tooltip
        if (tray) {
            tray.setToolTip('FB System');
        }

        // Notification
        const notification = new Notification({
            title: 'Cập nhật đã sẵn sàng',
            body: `Phiên bản ${info.version} đã được tải. Ứng dụng sẽ cập nhật khi thoát.`,
            icon: path.join(__dirname, '..', 'public', 'favicon.ico')
        });
        notification.show();

        notification.on('click', () => {
            // User click notification -> restart ngay
            autoUpdater.quitAndInstall(false, true);
        });

        // Hoặc hỏi user có muốn restart ngay không
        if (mainWindow) {
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Cập nhật đã sẵn sàng',
                message: `Phiên bản ${info.version} đã được tải về.`,
                detail: 'Khởi động lại ngay để cập nhật?',
                buttons: ['Khởi động lại ngay', 'Để sau (sẽ cập nhật khi thoát)'],
                defaultId: 0,
                cancelId: 1
            }).then(({ response }) => {
                if (response === 0) {
                    autoUpdater.quitAndInstall(false, true);
                }
            });
        }
    });

    // Lỗi
    autoUpdater.on('error', (error) => {
        console.error('[AutoUpdater] Error:', error.message);
        if (mainWindow) {
            mainWindow.webContents.send('update-error', error.message);
        }
    });
}

// === IPC Handlers ===
ipcMain.handle('check-for-updates', async () => {
    try {
        autoUpdater.checkForUpdates();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('quit-and-install', async () => {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
});

// === App Lifecycle ===
app.whenReady().then(async () => {
    console.log('[Electron] Starting FB System...');

    try {
        ensureUserDirectories();
        await startExpressServer();
        console.log('[Electron] Server started successfully');

        createMainWindow();
        createTray();
        setupAutoUpdater();

        app.on('activate', () => {
            if (mainWindow === null) {
                createMainWindow();
            } else {
                mainWindow.show();
            }
        });

    } catch (err) {
        console.error('[Electron] Failed to start:', err);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    app.isQuitting = true;
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}