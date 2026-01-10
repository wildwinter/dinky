import { BrowserWindow, nativeTheme, ipcMain } from 'electron'
import path from 'path'

let searchWindow = null
let mainWindow = null

export function initSearch(win) {
    mainWindow = win;

    ipcMain.on('open-search-window', () => {
        openSearchWindow();
    });

    ipcMain.handle('perform-search', async (event, { query, caseSensitive }) => {
        if (!mainWindow) return [];
        return await new Promise((resolve) => {
            mainWindow.webContents.send('request-search-results', { query, caseSensitive });
            ipcMain.once('search-results-ready', (_event, results) => {
                resolve(results);
            });
        });
    });

    ipcMain.on('navigate-to-result', (event, { path, line, query }) => {
        if (mainWindow) {
            mainWindow.webContents.send('navigate-to-match', { path, line, query });
        }
    });

    ipcMain.handle('perform-replace-all', async (event, { query, replacement, caseSensitive }) => {
        if (!mainWindow) return 0;
        return await new Promise((resolve) => {
            mainWindow.webContents.send('request-replace-all', { query, replacement, caseSensitive });
            ipcMain.once('replace-all-complete', (_event, count) => {
                resolve(count);
            });
        });
    });
}

export function openSearchWindow() {
    if (searchWindow) {
        searchWindow.show()
        searchWindow.focus()
        searchWindow.webContents.send('focus-search-input');
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

    searchWindow = new BrowserWindow({
        title: 'Find In Files',
        width: 400,
        height: 500,
        x,
        y,
        frame: true,
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

    const updateTheme = () => {
        if (!searchWindow || searchWindow.isDestroyed()) return
        const theme = nativeTheme.shouldUseDarkColors ? 'vs-dark' : 'vs'
        searchWindow.webContents.send('theme-updated', theme)
        searchWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3')
    }

    const themeListener = () => updateTheme()
    nativeTheme.on('updated', themeListener)

    searchWindow.on('closed', () => {
        nativeTheme.off('updated', themeListener)
        searchWindow = null
        if (mainWindow) {
            mainWindow.webContents.send('clear-search-highlights');
        }
    })

    searchWindow.once('ready-to-show', () => {
        searchWindow.show();
        updateTheme();
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        searchWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}search.html`)
    } else {
        const indexPath = path.join(__dirname, '../dist/search.html')
        searchWindow.loadFile(indexPath).catch(e => console.error('Failed to load search.html:', e))
    }
}
