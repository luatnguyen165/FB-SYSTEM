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

// === Auto Updater Config ===
autoUpdater.autoDownload = false; // Don't auto-download, ask user first
autoUpdater.autoInstallOnAppQuit = true; // Auto install when quitting

// === Ensure writable directories exist in userData ===
function ensureUserDirectories() {
    const dirs = ['uploads', 'uploads/ai-images', 'uploads/competitor-posts', 
                  'uploads/crypto-keys', 'uploads/images', 'uploads/video-projects', 
                  'uploads/videos', 'page_post', 'page_post/PANZI', 
                  'views/fb_session', 'public/music', 'public/output'];
    
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

// === Auto Update Handlers ===
function setupAutoUpdater() {
    // Only check for updates in production (packaged app)
    if (isDev) {
        console.log('[AutoUpdater] Skipping update check in development mode');
        return;
    }

    // Check for updates after app starts
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 5000); // Check after 5 seconds

    // Update available (but not downloaded yet)
    autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdater] Update available:', info.version);
        
        // Show notification
        if (mainWindow) {
            mainWindow.webContents.send('update-available', info);
        }

        // Ask user to download
        dialog.showMessageBox({
            type: 'info',
            title: 'Có cập nhật mới',
            message: `Phiên bản ${info.version} đã có sẵn.`,
            detail: 'Bạn có muốn tải về và cài đặt ngay không?',
            buttons: ['Có, tải ngay', 'Để sau'],
            defaultId: 0,
            cancelId: 1
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.downloadUpdate();
            }
        });
    });

    // No update available
    autoUpdater.on('update-not-available', (info) => {
        console.log('[AutoUpdater] No update available, current:', info.version);
        if (mainWindow) {
            mainWindow.webContents.send('update-not-available', info);
        }
    });

    // Download progress
    autoUpdater.on('download-progress', (progressObj) => {
        let logMessage = `Download speed: ${progressObj.bytesPerSecond}`;
        logMessage = logMessage + ` - Downloaded ${progressObj.percent}%`;
        logMessage = logMessage + ` (${progressObj.transferred}/${progressObj.total})`;
        console.log('[AutoUpdater]', logMessage);
        
        if (mainWindow) {
            mainWindow.webContents.send('update-progress', progressObj);
        }
    });

    // Update downloaded, ready to install
    autoUpdater.on('update-downloaded', (info) => {
        console.log('[AutoUpdater] Update downloaded:', info.version);
        
        if (mainWindow) {
            mainWindow.webContents.send('update-downloaded', info);
        }

        dialog.showMessageBox({
            type: 'info',
            title: 'Cập nhật đã sẵn sàng',
            message: `Phiên bản ${info.version} đã được tải về.`,
            detail: 'Khởi động lại ứng dụng để cài đặt bản cập nhật?',
            buttons: ['Khởi động lại ngay', 'Để sau'],
            defaultId: 0,
            cancelId: 1
        }).then(({ response }) => {
            if (response === 0) {
                autoUpdater.quitAndInstall(false, true);
            }
        });
    });

    // Error
    autoUpdater.on('error', (error) => {
        console.error('[AutoUpdater] Error:', error.message);
        if (mainWindow) {
            mainWindow.webContents.send('update-error', error.message);
        }
    });
}

// === IPC Handlers (for renderer to communicate) ===
ipcMain.handle('check-for-updates', async () => {
    try {
        autoUpdater.checkForUpdates();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('download-update', async () => {
    try {
        autoUpdater.downloadUpdate();
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