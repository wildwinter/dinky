import { BrowserWindow, nativeTheme, ipcMain } from 'electron'
import path from 'path'
import { getWindowState, saveWindowState } from './config'
import { safeSend, setupThemeListener } from './utils'
import { getCurrentProject, updateProjectConfig } from './project-manager'

let projectSettingsWindow = null;

export async function openProjectSettingsWindow(parentWindow) {
    if (projectSettingsWindow && !projectSettingsWindow.isDestroyed()) {
        projectSettingsWindow.show();
        projectSettingsWindow.focus();
        return;
    }

    const windowState = await getWindowState('project-settings');

    projectSettingsWindow = new BrowserWindow({
        title: 'Project Settings',
        width: windowState?.width || 800,
        height: windowState?.height || 450,
        minWidth: 780,
        minHeight: 550,
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
    const { cleanup: cleanupTheme, update: updateTheme } = setupThemeListener(projectSettingsWindow, '#252526', '#f3f3f3');

    const updateOverlay = () => {
        if (projectSettingsWindow && !projectSettingsWindow.isDestroyed() && typeof projectSettingsWindow.setTitleBarOverlay === 'function') {
            projectSettingsWindow.setTitleBarOverlay({
                color: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
                symbolColor: nativeTheme.shouldUseDarkColors ? '#cccccc' : '#333333',
            })
        }
    }

    nativeTheme.on('updated', updateOverlay)

    projectSettingsWindow.on('ready-to-show', () => {
        projectSettingsWindow.show();
    });

    projectSettingsWindow.on('close', () => {
        saveWindowState('project-settings', projectSettingsWindow.getBounds());
    });

    projectSettingsWindow.on('closed', () => {
        cleanupTheme();
        nativeTheme.off('updated', updateOverlay);
        projectSettingsWindow = null;
    });

    projectSettingsWindow.webContents.on('did-finish-load', () => {
        updateTheme();
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        projectSettingsWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}project-settings.html`);
    } else {
        const indexPath = path.join(__dirname, '../dist/project-settings.html');
        projectSettingsWindow.loadFile(indexPath).catch(e => console.error('Failed to load project-settings.html:', e));
    }
}

// IPC handlers for project settings logic
ipcMain.handle('get-project-config', async (event) => {
    const project = getCurrentProject();
    if (!project) {
        return null;
    }
    // Include project path so renderer can calculate relative paths
    return {
        ...project.content,
        _projectPath: project.path
    };
});

// Keys that affect menu state and require a menu rebuild when changed
const menuAffectingKeys = ['outputRecordingScript', 'outputLocalization', 'outputStats'];

ipcMain.handle('set-project-config', async (event, key, value) => {
    try {
        await updateProjectConfig(key, value);

        // Notify the project settings window of the update
        if (projectSettingsWindow && !projectSettingsWindow.isDestroyed()) {
            safeSend(projectSettingsWindow, 'project-config-updated', { [key]: value });
        }

        // Rebuild menu if this key affects menu item enablement
        if (menuAffectingKeys.includes(key)) {
            ipcMain.emit('rebuild-menu');
        }

        return true;
    } catch (error) {
        console.error('Failed to update project config:', error);
        return false;
    }
});
