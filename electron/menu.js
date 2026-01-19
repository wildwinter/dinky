import { app, Menu, dialog, nativeTheme, BrowserWindow } from 'electron'
import path from 'path'
import { getRecentProjects, saveSettings, loadSettings } from './config'
import { loadProject, openNewIncludeUI, openNewInkRootUI } from './project-manager'
import { openSearchWindow } from './search'
import { openSettingsWindow } from './settings'
import { safeSend } from './utils'

async function buildMenu(win) {
    const recentProjects = await getRecentProjects();
    const settings = await loadSettings();
    const currentLocale = settings.spellCheckerLocale || 'en_GB';

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
                            checked: currentLocale === 'en_GB',
                            click: async () => {
                                await saveSettings({ spellCheckerLocale: 'en_GB' });
                                BrowserWindow.getAllWindows().forEach(w => {
                                    if (!w.isDestroyed()) {
                                        safeSend(w, 'settings-updated', { spellCheckerLocale: 'en_GB' });
                                    }
                                });
                                await buildMenu(win);
                            }
                        },
                        {
                            label: 'English (US)',
                            type: 'radio',
                            checked: currentLocale === 'en_US',
                            click: async () => {
                                await saveSettings({ spellCheckerLocale: 'en_US' });
                                BrowserWindow.getAllWindows().forEach(w => {
                                    if (!w.isDestroyed()) {
                                        safeSend(w, 'settings-updated', { spellCheckerLocale: 'en_US' });
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
        }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}

export {
    buildMenu
}
