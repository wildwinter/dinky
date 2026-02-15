import { app, Menu, dialog, nativeTheme, BrowserWindow, shell, ipcMain } from 'electron'
import path from 'path'
import { getRecentProjects, saveSettings, loadSettings } from './config'
import { loadProject, openNewIncludeUI, openNewInkRootUI, openInkRootUI, getCurrentProject, getCurrentInkRoot } from './project-manager'
import { openSearchWindow } from './search'
import { openSettingsWindow } from './settings'
import { openProjectSettingsWindow } from './project-settings'
import { safeSend } from './utils'

let recordingMode = false;

/**
 * Opens an output file (xlsx) from the project's destFolder using the platform's default application
 * @param {object} project - The current project object
 * @param {string} suffix - The file suffix (e.g., '-recording.xlsx', '-loc.xlsx', '-stats.xlsx')
 */
async function openOutputFile(project, suffix) {
    if (!project || !project.content) return;

    const projectDir = path.dirname(project.path);
    const destFolder = project.content.destFolder || './output';
    const inkRoot = getCurrentInkRoot();

    if (!inkRoot) return;

    // Get basename of the ink root file (without .ink extension)
    const basename = path.basename(inkRoot, '.ink');

    // Build the full path: projectDir / destFolder / basename + suffix
    const filePath = path.resolve(projectDir, destFolder, basename + suffix);

    // Open with the platform's default application
    const result = await shell.openPath(filePath);
    if (result) {
        // shell.openPath returns an error string if it fails, empty string on success
        dialog.showErrorBox('Error', `Could not open file: ${result}`);
    }
}

async function buildMenu(win) {
    const recentProjects = await getRecentProjects();
    const settings = await loadSettings();
    const currentLocale = settings.spellCheckerLocale || 'en-GB';
    const currentProject = getCurrentProject();
    const hasNonAdhocProject = currentProject && !currentProject.isAdhoc;

    const isMac = process.platform === 'darwin'

    const recentMenu = recentProjects.length > 0 ? recentProjects.map(p => ({
        label: path.basename(p),
        click: () => loadProject(win, p)
    })) : [{ label: 'No Recent Projects', enabled: false }];

    // Add clear option if there are items
    if (recentProjects.length > 0) {
        recentMenu.push({ type: 'separator' });
        recentMenu.push({
            label: 'Clear Recently Opened',
            click: async () => {
                await saveSettings({ recentProjects: [] });
                await buildMenu(win);
            }
        });
    }

    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                {
                    label: 'Settings...',
                    accelerator: 'Cmd+,',
                    click: () => openSettingsWindow(win)
                },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Project...',
                    click: async () => {
                        safeSend(win, 'show-new-project-modal');
                    }
                },
                {
                    label: 'Open Project...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                            properties: ['openFile'],
                            filters: [{ name: 'Dink Project', extensions: ['dinkproj'] }]
                        })
                        if (!canceled && filePaths.length > 0) {
                            await loadProject(win, filePaths[0]);
                        }
                    }
                },
                {
                    label: 'Open Recent Project',
                    submenu: recentMenu
                },
                { type: 'separator' },
                {
                    label: 'Add New Ink Root...',
                    click: async () => {
                        openNewInkRootUI(win);
                    }
                },
                {
                    label: 'Switch Ink Root...',
                    click: async () => {
                        await openInkRootUI(win);
                    }
                },
                {
                    label: 'Add New Include...',
                    click: async () => {
                        // Use helper
                        openNewIncludeUI(win);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Export',
                    submenu: [
                        {
                            label: 'Export Interactive HTML',
                            enabled: hasNonAdhocProject,
                            click: () => {
                                safeSend(win, 'show-export-html-modal');
                            }
                        },
                        {
                            label: 'Export Word',
                            enabled: hasNonAdhocProject,
                            click: () => {
                                safeSend(win, 'show-export-word-modal');
                            }
                        },
                        {
                            label: 'Export PDF',
                            enabled: hasNonAdhocProject,
                            click: () => {
                                safeSend(win, 'show-export-pdf-modal');
                            }
                        }
                    ]
                },
                {type: 'separator'},
                { label: 'Save', accelerator: isMac ? 'Cmd+S' : 'Ctrl+S', click: async () => { safeSend(win, 'save-all'); } },
                ...(isMac ? [] : [{ role: 'quit' }])
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'delete' },
                { type: 'separator' },
                { role: 'selectAll' },
                { type: 'separator' },
                { label: 'Find', accelerator: 'CmdOrCtrl+F', click: (menuItem, browserWindow) => { safeSend(browserWindow, 'menu-find'); } },
                { label: 'Replace', accelerator: 'CmdOrCtrl+Alt+F', click: (menuItem, browserWindow) => { safeSend(browserWindow, 'menu-replace'); } },
                { label: 'Find In Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => { openSearchWindow(); } },
                { label: 'Replace In Files', accelerator: 'CmdOrCtrl+Shift+H', click: () => { openSearchWindow(); } },
                { type: 'separator' },
                { label: 'Jump to ID', accelerator: 'CmdOrCtrl+J', click: (menuItem, browserWindow) => { safeSend(browserWindow, 'menu-find-id'); } },
                { type: 'separator' },
                {
                    label: 'Spelling',
                    submenu: [
                        {
                            label: 'English (UK)',
                            type: 'radio',
                            checked: currentLocale === 'en-GB',
                            click: async () => {
                                await saveSettings({ spellCheckerLocale: 'en-GB' });
                                BrowserWindow.getAllWindows().forEach(w => {
                                    if (!w.isDestroyed()) {
                                        safeSend(w, 'settings-updated', { spellCheckerLocale: 'en-GB' });
                                    }
                                });
                                await buildMenu(win);
                            }
                        },
                        {
                            label: 'English (US)',
                            type: 'radio',
                            checked: currentLocale === 'en-US',
                            click: async () => {
                                await saveSettings({ spellCheckerLocale: 'en-US' });
                                BrowserWindow.getAllWindows().forEach(w => {
                                    if (!w.isDestroyed()) {
                                        safeSend(w, 'settings-updated', { spellCheckerLocale: 'en-US' });
                                    }
                                });
                                // Rebuild menu to update selection state visual
                                await buildMenu(win);
                            }
                        }
                    ]
                },
                ...(isMac ? [] : [
                    { type: 'separator' },
                    {
                        label: 'Settings...',
                        accelerator: 'Ctrl+,',
                        click: () => openSettingsWindow(win)
                    }
                ])
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Project',
            submenu: [
                {
                    label: 'Compile...',
                    accelerator: 'F5',
                    click: () => {
                        safeSend(win, 'show-compile-modal');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Project Settings...',
                    accelerator: 'CmdOrCtrl+Shift+,',
                    enabled: hasNonAdhocProject,
                    click: () => {
                        openProjectSettingsWindow(win);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Recording Script...',
                    enabled: hasNonAdhocProject && !!currentProject?.content?.outputRecordingScript,
                    click: () => {
                        openOutputFile(currentProject, '-recording.xlsx');
                    }
                },
                {
                    label: 'Open Localization Spreadsheet...',
                    enabled: hasNonAdhocProject && !!currentProject?.content?.outputLocalization,
                    click: () => {
                        openOutputFile(currentProject, '-loc.xlsx');
                    }
                },
                {
                    label: 'Open Statistics...',
                    enabled: hasNonAdhocProject && !!currentProject?.content?.outputStats,
                    click: () => {
                        openOutputFile(currentProject, '-stats.xlsx');
                    }
                }
            ]
        },
        {
            label: 'Test',
            submenu: [
                {
                    label: 'Test Root',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => {
                        safeSend(win, 'trigger-start-test');
                    }
                },
                {
                    label: 'Test Knot',
                    accelerator: 'CmdOrCtrl+Shift+T',
                    click: () => {
                        safeSend(win, 'trigger-test-knot');
                    }
                }
            ]
        },
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front' },
                    { type: 'separator' }
                ] : [
                    { role: 'close' },
                    { type: 'separator' }
                ]),
                ...BrowserWindow.getAllWindows().map((w, index) => ({
                    label: w.getTitle() || `Window ${index + 1}`,
                    accelerator: isMac ? `Cmd+${index + 1}` : `Ctrl+${index + 1}`,
                    click: () => {
                        if (w.isMinimized()) w.restore();
                        w.show();
                        w.focus();
                    }
                }))
            ]
        },
        ...(isMac ? [] : [{
            label: 'Help',
            submenu: [
                {
                    label: 'About Dinky',
                    click: () => app.showAboutPanel()
                }
            ]
        }])
    ]

    // In recording mode, disable all menu items except Quit and About
    if (recordingMode) {
        disableMenuItems(template);
    }

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}

/**
 * Recursively disable all menu items except Quit and About roles
 */
function disableMenuItems(items) {
    const allowedRoles = ['quit', 'about'];
    for (const item of items) {
        if (item.submenu) {
            disableMenuItems(item.submenu);
        } else if (item.type === 'separator') {
            // Leave separators alone
        } else if (item.role && allowedRoles.includes(item.role)) {
            // Leave Quit and About enabled
        } else {
            item.enabled = false;
        }
    }
}

// IPC handler for recording mode toggle
ipcMain.on('set-recording-mode', async (event, enabled) => {
    recordingMode = !!enabled;
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) await buildMenu(win);
});

export {
    buildMenu
}
