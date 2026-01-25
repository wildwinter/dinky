import { BrowserWindow, nativeTheme, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { getWindowState, saveWindowState } from './config'
import { setupThemeListener, safeSend } from './utils'
import { getCurrentProject } from './project-manager'

let charactersWindow = null;

export async function openCharactersWindow(parentWindow) {
    if (charactersWindow && !charactersWindow.isDestroyed()) {
        charactersWindow.show();
        charactersWindow.focus();
        return;
    }

    const windowState = await getWindowState('characters');

    charactersWindow = new BrowserWindow({
        title: 'Characters',
        width: windowState?.width || 600,
        height: windowState?.height || 450,
        minWidth: 400,
        minHeight: 300,
        x: windowState?.x,
        y: windowState?.y,
        parent: parentWindow,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        resizable: true,
        titleBarStyle: 'hidden',
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
    const { cleanup: cleanupTheme, update: updateTheme } = setupThemeListener(charactersWindow, '#252526', '#f3f3f3');

    const updateOverlay = () => {
        if (charactersWindow && !charactersWindow.isDestroyed() && typeof charactersWindow.setTitleBarOverlay === 'function') {
            charactersWindow.setTitleBarOverlay({
                color: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
                symbolColor: nativeTheme.shouldUseDarkColors ? '#cccccc' : '#333333',
            })
        }
    }

    nativeTheme.on('updated', updateOverlay)

    charactersWindow.on('ready-to-show', () => {
        charactersWindow.show();
    });

    charactersWindow.on('close', () => {
        saveWindowState('characters', charactersWindow.getBounds());
    });

    charactersWindow.on('closed', () => {
        cleanupTheme();
        nativeTheme.off('updated', updateOverlay);
        charactersWindow = null;
    });

    charactersWindow.webContents.on('did-finish-load', () => {
        updateTheme();
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        charactersWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}characters.html`);
    } else {
        const indexPath = path.join(__dirname, '../dist/characters.html');
        charactersWindow.loadFile(indexPath).catch(e => console.error('Failed to load characters.html:', e));
    }
}

// Helper function to get the characters file path
function getCharactersFilePath() {
    const project = getCurrentProject();
    if (!project) return null;

    const projectDir = path.dirname(project.path);
    return path.join(projectDir, 'characters.json');
}

// IPC handler to get characters
ipcMain.handle('get-characters', async (event) => {
    const project = getCurrentProject();
    if (!project) return [];

    const projectDir = path.dirname(project.path);
    const jsonPath = path.join(projectDir, 'characters.json');
    const jsoncPath = path.join(projectDir, 'characters.jsonc');

    let content = null;
    try {
        content = await fs.readFile(jsonPath, 'utf-8');
    } catch {
        try {
            content = await fs.readFile(jsoncPath, 'utf-8');
        } catch {
            return []; // No character file found
        }
    }

    if (!content) return [];

    try {
        // Strip comments for JSONC support
        const cleanContent = content.replace(/\/\/.*(?:\r?\n|$)/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        const chars = JSON.parse(cleanContent);
        return Array.isArray(chars) ? chars : [];
    } catch {
        return [];
    }
});

// IPC handler to save characters
ipcMain.handle('save-characters', async (event, characters) => {
    const filePath = getCharactersFilePath();
    if (!filePath) return false;

    try {
        await fs.writeFile(filePath, JSON.stringify(characters, null, 4), 'utf-8');

        // Notify all windows that characters have been updated
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
                safeSend(win, 'characters-updated');
            }
        });

        return true;
    } catch (error) {
        console.error('Failed to save characters:', error);
        return false;
    }
});

ipcMain.on('open-characters', (event) => {
    const parentWindow = BrowserWindow.getFocusedWindow();
    if (parentWindow) {
        openCharactersWindow(parentWindow);
    }
});
