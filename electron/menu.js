import { app, Menu, dialog, nativeTheme } from 'electron'
import path from 'path'
import { getRecentProjects, saveSettings, setProjectSetting } from './config'
import { loadProject, loadRootInk, getCurrentProject, getCurrentInkRoot, openNewIncludeUI } from './project-manager'
import { openTestWindow } from './test-runner'
import { openSearchWindow } from './search'

async function buildMenu(win) {
    const recentProjects = await getRecentProjects();
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
                        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                            win.webContents.send('show-new-project-modal');
                        }
                    }
                },
                {
                    label: 'Open Project...',
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
                    label: 'Open Ink Root...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const currentProject = getCurrentProject();
                        const defaultPath = currentProject ? path.dirname(currentProject.path) : undefined;

                        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                            defaultPath: defaultPath,
                            properties: ['openFile'],
                            filters: [{ name: 'Ink Files', extensions: ['ink'] }]
                        })
                        if (!canceled && filePaths.length > 0) {
                            const files = await loadRootInk(filePaths[0])
                            if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                                win.webContents.send('root-ink-loaded', files)
                            }

                            // Save as preference if a project is open
                            const currentDinkProject = getCurrentProject();
                            if (currentDinkProject) {
                                await setProjectSetting(currentDinkProject.path, 'lastInkRoot', filePaths[0]);
                                console.log('Saved Ink Root preference:', filePaths[0]);
                            }
                        }
                    }
                },
                {
                    label: 'Add New Include...',
                    click: async () => {
                        // Use helper
                        openNewIncludeUI(win);
                    }
                },
                { label: 'Save', accelerator: isMac ? 'Cmd+S' : 'Ctrl+S', click: async () => { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('save-all'); } },
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
                { label: 'Find', accelerator: 'CmdOrCtrl+F', click: (menuItem, browserWindow) => { browserWindow.webContents.send('menu-find'); } },
                { label: 'Replace', accelerator: 'CmdOrCtrl+Alt+F', click: (menuItem, browserWindow) => { browserWindow.webContents.send('menu-replace'); } },
                { type: 'separator' },
                { label: 'Find In Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => { openSearchWindow(); } },
                { label: 'Replace In Files', accelerator: 'CmdOrCtrl+Shift+H', click: () => { openSearchWindow(); } }
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
                        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                            win.webContents.send('trigger-start-test');
                        }
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
                    { type: 'separator' },
                    { role: 'window' }
                ] : [
                    { role: 'close' }
                ])
            ]
        }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
}

export {
    buildMenu
}
