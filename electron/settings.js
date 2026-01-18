import { BrowserWindow, nativeTheme, ipcMain } from 'electron'
import path from 'path'
import { loadSettings, saveSettings, getWindowState, saveWindowState } from './config'
import { safeSend, setupThemeListener } from './utils'

let settingsWindow = null;

export async function openSettingsWindow(parentWindow) {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.show();
        settingsWindow.focus();
        return;
    }

    const windowState = await getWindowState('settings');

    settingsWindow = new BrowserWindow({
        title: 'Settings',
        width: windowState?.width || 500,
        height: windowState?.height || 400,
        x: windowState?.x,
        y: windowState?.y,
        parent: parentWindow, // Optional: make it independent or attached. Standard Mac preferences are usually independent or sheet. Independent is safer.
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        resizable: true, // Settings windows often fixed size, but resizable is fine
        titleBarStyle: 'hidden', // Unified look
        trafficLightPosition: { x: 10, y: 10 },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        show: false,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
        titleBarOverlay: {
            color: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#cccccc' : '#333333',
        },
    });

    // Theme listener for the window itself
    const { cleanup: cleanupTheme, update: updateTheme } = setupThemeListener(settingsWindow, '#252526', '#f3f3f3');

    const updateOverlay = () => {
        if (settingsWindow && !settingsWindow.isDestroyed() && typeof settingsWindow.setTitleBarOverlay === 'function') {
            settingsWindow.setTitleBarOverlay({
                color: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
                symbolColor: nativeTheme.shouldUseDarkColors ? '#cccccc' : '#333333',
            })
        }
    }

    nativeTheme.on('updated', updateOverlay)

    settingsWindow.on('ready-to-show', () => {
        settingsWindow.show();
    });

    settingsWindow.on('close', () => {
        saveWindowState('settings', settingsWindow.getBounds());
    });

    settingsWindow.on('closed', () => {
        cleanupTheme();
        nativeTheme.off('updated', updateOverlay);
        settingsWindow = null;
    });

    settingsWindow.webContents.on('did-finish-load', () => {
        updateTheme();
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        settingsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}settings.html`);
    } else {
        const indexPath = path.join(__dirname, '../dist/settings.html');
        settingsWindow.loadFile(indexPath).catch(e => console.error('Failed to load settings.html:', e));
    }
}

// IPC handlers for settings logic
ipcMain.handle('set-theme', async (event, themeMode) => {
    nativeTheme.themeSource = themeMode;
    await saveSettings({ theme: themeMode });

    // Notify all windows? setupThemeListener handles the nativeTheme 'updated' event for UI colors,
    // but we might want to ensure 'themeSource' prop is propagated if needed.
    // Actually nativeTheme.themeSource change triggers 'updated' event on nativeTheme, 
    // which our listeners in other windows pick up to change background colors.

    // We should also notify renderer in case they need to update UI state (like the dropdown)
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        safeSend(settingsWindow, 'settings-updated', { theme: themeMode });
    }
});

ipcMain.handle('set-setting', async (event, key, value) => {
    const s = {};
    s[key] = value;
    await saveSettings(s);

    // Broadcast to all windows
    BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
            safeSend(w, 'settings-updated', s);
        }
    });
});
