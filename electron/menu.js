import { app, Menu, dialog, nativeTheme, BrowserWindow, shell, ipcMain } from 'electron'
import path from 'path'
import { getRecentProjects, saveSettings, loadSettings } from './config'
import { loadProject, openNewIncludeUI, openNewInkRootUI, openInkRootUI, getCurrentProject, getCurrentInkRoot } from './project-manager'
import { openSearchWindow } from './search'
import { openSettingsWindow } from './settings'
import { openProjectSettingsWindow, offerToCreateDinkprojForAdhoc } from './project-settings'
import { safeSend } from './utils'
import { manualCheckForUpdates } from './updater'

let recordingMode = false;
// "Show IDs" (View menu) reveals the hidden #id: tags inline in the editor for
// manual repair. Session-only and deliberately NOT persisted to settings, so it
// always starts off. Mirrors the recordingMode toggle pattern below.
let showIdsEnabled = false;

/**
 * Opens an output file (xlsx) from the project's destFolder using the platform's default application
 * @param {object} project - The current project object
 * @param {string} suffix - The file suffix (e.g., '-recording.xlsx', '-loc.xlsx', '-stats.xlsx')
 */
/**
 * Click-handler shared by the "Open Recording Script / Localization / Stats"
 * menu items. Promotes adhoc → real project if needed, then either opens the
 * configured output file or - if the user hasn't enabled this output yet -
 * directs them to Project Settings. Returns true on a successful open or a
 * clean abort; false isn't currently meaningful but keeps the API uniform.
 */
async function openConfiguredOutput(win, configKey, label, suffix) {
    if (!await requireNonAdhocProject(win)) return false;
    // Re-read project state - requireNonAdhocProject may have promoted it.
    const project = getCurrentProject();
    if (!project) return false;

    if (!project.content?.[configKey]) {
        const { response } = await dialog.showMessageBox(win, {
            type: 'info',
            buttons: ['Open Project Settings', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            message: `${label} output isn't enabled for this project.`,
            detail: `Open Project Settings to enable it, then compile to generate the file.`
        });
        if (response === 0) await openProjectSettingsWindow(win);
        return true;
    }

    await openOutputFile(project, suffix);
    return true;
}

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

/**
 * Guard used by menu items that need a real .dinkproj on disk. When the
 * current project is adhoc (Ink file opened directly, no .dinkproj), prompts
 * the user to create one - same flow as Project Settings. Returns true if
 * the project is now non-adhoc and the caller should proceed; false on
 * cancel/no-project.
 */
async function requireNonAdhocProject(win) {
    const project = getCurrentProject();
    if (!project) {
        dialog.showErrorBox(
            'No project open',
            'Open or create a project before using this feature.'
        );
        return false;
    }
    if (!project.isAdhoc) return true;
    return await offerToCreateDinkprojForAdhoc(win, project);
}

async function buildMenu(win) {
    const recentProjects = await getRecentProjects();
    const settings = await loadSettings();
    const currentLocale = settings.spellCheckerLocale || 'en-GB';
    // Word wrap is on by default; only an explicit false turns it off.
    const wordWrap = settings.wordWrap !== false;
    const currentProject = getCurrentProject();

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
                {
                    label: 'Check for Updates...',
                    click: () => manualCheckForUpdates(win)
                },
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
                            enabled: !!currentProject,
                            click: async () => {
                                if (!await requireNonAdhocProject(win)) return;
                                safeSend(win, 'show-export-html-modal');
                            }
                        },
                        {
                            label: 'Export Word',
                            enabled: !!currentProject,
                            click: async () => {
                                if (!await requireNonAdhocProject(win)) return;
                                safeSend(win, 'show-export-word-modal');
                            }
                        },
                        {
                            label: 'Export PDF',
                            enabled: !!currentProject,
                            click: async () => {
                                if (!await requireNonAdhocProject(win)) return;
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
                    label: 'Word Wrap',
                    type: 'checkbox',
                    accelerator: 'Alt+Z',
                    checked: wordWrap,
                    click: async () => {
                        const newValue = !wordWrap;
                        await saveSettings({ wordWrap: newValue });
                        BrowserWindow.getAllWindows().forEach(w => {
                            if (!w.isDestroyed()) {
                                safeSend(w, 'settings-updated', { wordWrap: newValue });
                            }
                        });
                        await buildMenu(win);
                    }
                },
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
                { role: 'togglefullscreen' },
                { type: 'separator' },
                {
                    // Belt-and-braces repair aid: reveal the normally-hidden
                    // #id: tags inline so they can be edited/deleted by hand.
                    // Not persisted - always starts off.
                    label: 'Show IDs',
                    type: 'checkbox',
                    checked: showIdsEnabled,
                    click: async (menuItem) => {
                        showIdsEnabled = menuItem.checked;
                        safeSend(win, 'set-show-ids', showIdsEnabled);
                        await buildMenu(win);
                    }
                }
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
                    // Enabled for any open project, including adhoc - opening
                    // it on an adhoc project prompts the user to create a
                    // .dinkproj first.
                    enabled: !!currentProject,
                    click: () => {
                        openProjectSettingsWindow(win);
                    }
                },
                { type: 'separator' },
                {
                    label: 'Open Recording Script...',
                    // Enabled if there's an output configured OR the project is
                    // adhoc (offer the create-dinkproj flow on click). A real
                    // project without the output enabled stays disabled - the
                    // greyed-out state tells the user to enable it in Settings.
                    enabled: !!currentProject && (currentProject.isAdhoc || !!currentProject.content?.outputRecordingScript),
                    click: async () => {
                        if (!await openConfiguredOutput(win, 'outputRecordingScript', 'Recording Script', '-recording.xlsx')) return;
                    }
                },
                {
                    label: 'Open Localization Spreadsheet...',
                    enabled: !!currentProject && (currentProject.isAdhoc || !!currentProject.content?.outputLocalization),
                    click: async () => {
                        if (!await openConfiguredOutput(win, 'outputLocalization', 'Localization', '-loc.xlsx')) return;
                    }
                },
                {
                    label: 'Open Statistics...',
                    enabled: !!currentProject && (currentProject.isAdhoc || !!currentProject.content?.outputStats),
                    click: async () => {
                        if (!await openConfiguredOutput(win, 'outputStats', 'Statistics', '-stats.xlsx')) return;
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
                    label: 'Check for Updates...',
                    click: () => manualCheckForUpdates(win)
                },
                { type: 'separator' },
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

// The renderer can turn "Show IDs" off itself (e.g. when saving or switching
// files it materialises the inline IDs back to hidden decorations). Keep the
// View-menu checkbox in sync when that happens.
ipcMain.on('show-ids-changed', async (event, enabled) => {
    showIdsEnabled = !!enabled;
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) await buildMenu(win);
});

export {
    buildMenu
}
