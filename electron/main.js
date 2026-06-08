const { app, BrowserWindow, Tray, Menu, nativeImage, Notification, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// === Config ===
const isDev = !app.isPackaged;
const USER_DATA_DIR = app.getPath('userData'); // Ví dụ: C:\Users\<user>\AppData\Roaming\FB System
const PORT = parseInt(process.env.PORT, 10) || 4000;
const APP_PATH = path.join(__dirname, '..', 'app.js');

let mainWindow = null;
let tray = null;
let serverStarted = false;
let SERVER_URL = `http://localhost:${PORT}`;

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
            // Set environment variables so app.js knows where to store data
            process.env.USER_DATA_DIR = USER_DATA_DIR;
            
            // Import the Express app – this triggers app.js to start listening
            require(APP_PATH);

            // Poll until server is ready
            const checkServer = (attempt = 0) => {
                if (attempt > 60) { // timeout after 30s (give more time for MongoDB)
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
            
            // Start checking after a small delay to let server initialize
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

    // Load the Express app
    mainWindow.loadURL(SERVER_URL);

    // Show window when ready
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        mainWindow.focus();
    });

    // Open DevTools in development
    if (isDev) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    // Handle external links – open in browser
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

// === App Lifecycle ===
app.whenReady().then(async () => {
    console.log('[Electron] Starting FB System...');

    try {
        // Ensure user data directories exist
        ensureUserDirectories();
        
        // Start Express server first
        await startExpressServer();
        console.log('[Electron] Server started successfully');

        // Create UI
        createMainWindow();
        createTray();

        // macOS: re-create window when dock icon is clicked
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

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    app.isQuitting = true;
});

// Handle second instance (single instance lock)
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