import { BrowserWindow, nativeTheme, ipcMain, dialog } from 'electron'
import path from 'path'
import { getWindowState, saveWindowState } from './config'
import { safeSend, setupThemeListener } from './utils'
import { getCurrentProject, updateProjectConfig, adoptDinkprojForAdhoc } from './project-manager'

let projectSettingsWindow = null;

// Prompt the user to create a .dinkproj for an adhoc-opened Ink file.
// Defaults the filename to `<inkbasename>.dinkproj` next to the Ink file,
// but the user can rename or relocate via the save dialog.
// Returns true if a project file was created and adopted, false otherwise.
export async function offerToCreateDinkprojForAdhoc(parentWindow, adhocProject) {
    const inkPath = adhocProject.path; // adhoc uses ink path as the anchor
    const inkDir = path.dirname(inkPath);
    const inkBase = path.basename(inkPath, '.ink');
    const suggestedName = `${inkBase}.dinkproj`;

    const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
        title: 'Create Project File',
        message: 'Project Settings needs a project file (.dinkproj). ' +
            'Dinky will create one for this Ink file:',
        defaultPath: path.join(inkDir, suggestedName),
        filters: [{ name: 'Dink Project', extensions: ['dinkproj'] }],
        buttonLabel: 'Create',
        // Don't show "Replace?" — adoptDinkprojForAdhoc refuses overwrites,
        // and we want a clean error rather than a silent replace.
        properties: ['createDirectory', 'showOverwriteConfirmation']
    });

    if (canceled || !filePath) return false;

    // Enforce .dinkproj extension if the user typed something else.
    const finalPath = filePath.endsWith('.dinkproj') ? filePath : filePath + '.dinkproj';

    return await adoptDinkprojForAdhoc(parentWindow, finalPath);
}

export async function openProjectSettingsWindow(parentWindow) {
    if (projectSettingsWindow && !projectSettingsWindow.isDestroyed()) {
        projectSettingsWindow.show();
        projectSettingsWindow.focus();
        return;
    }

    // Project Settings needs a real .dinkproj on disk — updateProjectConfig
    // throws if the project is adhoc, so the settings window would silently
    // fail to persist any change. Offer to create a .dinkproj next to the
    // user's Ink file instead.
    const project = getCurrentProject();
    if (!project) {
        dialog.showErrorBox(
            'No project open',
            'Open or create a project before changing project settings.'
        );
        return;
    }
    if (project.isAdhoc) {
        const created = await offerToCreateDinkprojForAdhoc(parentWindow, project);
        if (!created) return;
        // currentDinkProject has been upgraded in place; continue to open the window.
    }

    const windowState = await getWindowState('project-settings');

    projectSettingsWindow = new BrowserWindow({
        title: 'Project Settings',
        width: windowState?.width || 870,
        height: windowState?.height || 450,
        minWidth: 950,
        minHeight: 600,
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

ipcMain.handle('set-project-config', async (event, key, value, expectedProjectPath) => {
    // If the caller pinned this write to a specific project (the project-
    // settings window does, see project-settings-renderer.js), refuse the
    // write if the main window has switched projects since the window was
    // opened. Otherwise the edit lands on the *new* current project silently.
    const project = getCurrentProject();
    if (expectedProjectPath && (!project || project.path !== expectedProjectPath)) {
        console.warn('Refusing set-project-config: project switched since window opened.', {
            expected: expectedProjectPath,
            current: project?.path || '(none)'
        });
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
            dialog.showMessageBox(win, {
                type: 'warning',
                message: 'Project changed',
                detail: `This Project Settings window was opened for:\n\n${path.basename(expectedProjectPath)}\n\n` +
                    `but the main window is now showing a different project. ` +
                    `Your change was NOT saved. Close this window and reopen ` +
                    `Project Settings to edit the current project.`,
                buttons: ['OK']
            }).catch(() => {});
        }
        return false;
    }

    try {
        await updateProjectConfig(key, value);

        // Notify all windows of the update
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                safeSend(win, 'project-config-updated', { [key]: value });
            }
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

ipcMain.on('open-project-settings', (event) => {
    const parentWindow = BrowserWindow.getFocusedWindow();
    if (parentWindow) {
        openProjectSettingsWindow(parentWindow);
    }
});
