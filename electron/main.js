import { app, BrowserWindow, nativeTheme, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'

import { loadSettings, getRecentProjects, removeFromRecentProjects } from './config'
import { buildMenu } from './menu'
import { compileInk } from './compiler'
import { loadProject, createNewProject, setMenuRebuildCallback } from './project-manager'

app.setName('Dinky')

// Wire up the menu rebuild callback
setMenuRebuildCallback(buildMenu);

async function createWindow() {
    // Load settings
    const settings = await loadSettings()
    nativeTheme.themeSource = settings.theme || 'system'

    const win = new BrowserWindow({
        title: 'Dinky',
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    })

    // Initial menu build
    await buildMenu(win);

    // Theme handling
    const updateTheme = () => {
        const theme = nativeTheme.shouldUseDarkColors ? 'vs-dark' : 'vs'
        win.webContents.send('theme-updated', theme)
    }

    nativeTheme.on('updated', updateTheme)

    win.webContents.on('did-finish-load', async () => {
        updateTheme()

        // Load last used project if available
        const recent = await getRecentProjects();
        if (recent.length > 0) {
            const lastProject = recent[0];
            try {
                // Check if file exists
                await fs.access(lastProject);
                // If it exists, load it
                console.log('Auto-loading last project:', lastProject);

                await loadProject(win, lastProject);
            } catch (e) {
                console.log('Last project not found or invalid, removing from history:', lastProject);
                await removeFromRecentProjects(lastProject);
                await buildMenu(win);
            }
        }
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
        // Load the index.html when not in dev mode (for production builds)
        const indexPath = path.join(__dirname, '../dist/index.html')
        win.loadFile(indexPath).catch(e => console.error('Failed to load index.html:', e))
    }
}

// Renderer logging
ipcMain.on('renderer-log', (event, ...args) => {
    console.log('[Renderer]', ...args)
})

// Compile handling
ipcMain.handle('compile-ink', async (event, content, filePath, projectFiles = {}) => {
    return await compileInk(content, filePath, projectFiles);
})

// Save files handling
ipcMain.handle('save-files', async (event, files) => {
    for (const { path: filePath, content } of files) {
        try {
            await fs.writeFile(filePath, content, 'utf-8');
        } catch (e) {
            console.error('Failed to save file', filePath, e);
        }
    }
});

ipcMain.handle('open-project', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Dink Project', extensions: ['dinkproj'] }]
    })
    if (!canceled && filePaths.length > 0) {
        await loadProject(win, filePaths[0]);
    }
});

ipcMain.handle('new-project', async (event) => {
    // This is called from the renderer "New Project" button in empty state
    // We want to reuse the same modal flow
    const win = BrowserWindow.fromWebContents(event.sender);
    win.webContents.send('show-new-project-modal');
});

ipcMain.handle('select-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory']
    });
    if (!canceled && filePaths.length > 0) {
        return filePaths[0];
    }
    return null;
});

ipcMain.handle('create-new-project', async (event, name, parentPath) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return await createNewProject(win, name, parentPath);
});

app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})
