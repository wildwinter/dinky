import { BrowserWindow, nativeTheme, ipcMain } from 'electron'
import path from 'path'
import { safeSend, setupThemeListener } from './utils'
import { getWindowState, saveWindowState, saveSettings } from './config'

let searchWindow = null
let mainWindow = null

export function initSearch(win) {
    mainWindow = win;

    ipcMain.on('open-search-window', () => {
        openSearchWindow();
    });

    ipcMain.handle('perform-search', async (event, { query, caseSensitive }) => {
        return await new Promise((resolve) => {
            const sent = safeSend(mainWindow, 'request-search-results', { query, caseSensitive });
            if (!sent) return resolve([]);

            ipcMain.once('search-results-ready', (_event, results) => {
                resolve(results);
            });
        });
    });

    ipcMain.on('navigate-to-result', (event, { path, line, query }) => {
        safeSend(mainWindow, 'navigate-to-match', { path, line, query });
    });

    ipcMain.handle('perform-replace-all', async (event, { query, replacement, caseSensitive }) => {
        return await new Promise((resolve) => {
            const sent = safeSend(mainWindow, 'request-replace-all', { query, replacement, caseSensitive });
            if (!sent) return resolve(0);

            ipcMain.once('replace-all-complete', (_event, count) => {
                resolve(count);
            });
        });
    });
}

export async function openSearchWindow() {
    if (searchWindow && !searchWindow.isDestroyed()) {
        searchWindow.show()
        searchWindow.focus()
        safeSend(searchWindow, 'focus-search-input');
        await saveSettings({ searchWindowOpen: true });
        return
    }

    const currentWindow = mainWindow;
    let x, y
    if (currentWindow) {
        const [winX, winY] = currentWindow.getPosition()
        const [winW, winH] = currentWindow.getSize()
        x = winX + (winW / 2) - 200
        y = winY + 100
    }

    // Load saved window state
    const windowState = await getWindowState('search');

    searchWindow = new BrowserWindow({
        title: 'Find In Files',
        width: windowState?.width || 400,
        height: windowState?.height || 500,
        x: windowState?.x,
        y: windowState?.y,
        type: 'panel',
        parent: mainWindow,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        frame: true,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 10, y: 10 },
        resizable: true,
        alwaysOnTop: true,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        show: false
    })

    const { cleanup: cleanupTheme, update: updateTheme } = setupThemeListener(searchWindow, '#252526', '#f3f3f3');

    searchWindow.on('move', () => saveWindowState('search', searchWindow.getBounds()));
    searchWindow.on('resize', () => saveWindowState('search', searchWindow.getBounds()));

    searchWindow.on('closed', async () => {
        cleanupTheme()
        searchWindow = null
        safeSend(mainWindow, 'clear-search-highlights');
        await saveSettings({ searchWindowOpen: false });
        if (mainWindow) await safeSend(mainWindow, 'rebuild-menu');
    })

    searchWindow.once('ready-to-show', async () => {
        searchWindow.show();
        await saveSettings({ searchWindowOpen: true });
        if (mainWindow) await safeSend(mainWindow, 'rebuild-menu');
    });

    searchWindow.webContents.on('did-finish-load', () => {
        updateTheme();
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        searchWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}search.html`)
    } else {
        const indexPath = path.join(__dirname, '../dist/search.html')
        searchWindow.loadFile(indexPath).catch(e => console.error('Failed to load search.html:', e))
    }
}
