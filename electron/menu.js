import { app, Menu, dialog, nativeTheme, BrowserWindow } from 'electron'
import path from 'path'
import { getRecentProjects, saveSettings, loadSettings } from './config'
import { loadProject, openNewIncludeUI, openNewInkRootUI } from './project-manager'
import { openSearchWindow } from './search'
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
                { type: 'separator' },
                { label: 'Find In Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => { openSearchWindow(); } },
                { label: 'Replace In Files', accelerator: 'CmdOrCtrl+Shift+H', click: () => { openSearchWindow(); } },
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
                                safeSend(win, 'update-spell-locale', 'en_GB');
                                await buildMenu(win);
                            }
                        },
                        {
                            label: 'English (US)',
                            type: 'radio',
                            checked: currentLocale === 'en_US',
                            click: async () => {
                                await saveSettings({ spellCheckerLocale: 'en_US' });
                                safeSend(win, 'update-spell-locale', 'en_US');
                                // Rebuild menu to update selection state visual
                                await buildMenu(win);
                            }
                        }
                    ]
                }
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
                {
                    label: 'Theme',
                    submenu: [
                        {
                            label: 'System',
                            type: 'radio',
                            checked: nativeTheme.themeSource === 'system',
                            click: () => {
                                nativeTheme.themeSource = 'system'
                                saveSettings({ theme: 'system' })
                            }
                        },
                        {
                            label: 'Light',
                            type: 'radio',
                            checked: nativeTheme.themeSource === 'light',
                            click: () => {
                                nativeTheme.themeSource = 'light'
                                saveSettings({ theme: 'light' })
                            }
                        },
                        {
                            label: 'Dark',
                            type: 'radio',
                            checked: nativeTheme.themeSource === 'dark',
                            click: () => {
                                nativeTheme.themeSource = 'dark'
                                saveSettings({ theme: 'dark' })
                            }
                        }
                    ]
                },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Test',
            submenu: [
                {
                    label: 'Start Test',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => {
                        safeSend(win, 'trigger-start-test');
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
