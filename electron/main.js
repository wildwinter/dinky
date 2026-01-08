const { app, BrowserWindow, Menu, dialog, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs/promises')

app.setName('Dinky')

// Helper to recursively load ink files
async function loadInkProject(rootFilePath) {
    const rootDir = path.dirname(rootFilePath)
    const files = []
    const visited = new Set()

    async function traverse(currentPath) {
        if (visited.has(currentPath)) return
        visited.add(currentPath)

        try {
            const content = await fs.readFile(currentPath, { encoding: 'utf-8' })
            const relativePath = path.relative(rootDir, currentPath)

            files.push({
                absolutePath: currentPath,
                relativePath: relativePath === '' ? path.basename(currentPath) : relativePath,
                content
            })

            const lines = content.split(/\r?\n/)
            for (const line of lines) {
                const match = line.match(/^\s*INCLUDE\s+(.+)/)
                if (match) {
                    const includePath = match[1].trim()
                    // INCLUDES are relative to the file they are in
                    const nextAbsPath = path.resolve(path.dirname(currentPath), includePath)
                    await traverse(nextAbsPath)
                }
            }
        } catch (error) {
            console.error(`Failed to load file ${currentPath}:`, error)
            // Still add it to list but maybe with error content? Or just skip
        }
    }

    await traverse(rootFilePath)
    return files
}

// Config persistence
const configPath = path.join(app.getPath('userData'), 'config.json')

async function loadSettings() {
    try {
        const data = await fs.readFile(configPath, 'utf-8')
        return JSON.parse(data)
    } catch {
        return { theme: 'system' }
    }
}

async function saveSettings(settings) {
    try {
        const current = await loadSettings()
        await fs.writeFile(configPath, JSON.stringify({ ...current, ...settings }, null, 2))
    } catch (error) {
        console.error('Failed to save settings:', error)
    }
}

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

    const isMac = process.platform === 'darwin'

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
                    label: 'Open...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                            properties: ['openFile'],
                            filters: [{ name: 'Ink Files', extensions: ['ink'] }]
                        })
                        if (!canceled && filePaths.length > 0) {
                            const files = await loadInkProject(filePaths[0])
                            win.webContents.send('project-loaded', files)
                        }
                    }
                },
                isMac ? { label: 'Close', role: 'close' } : { role: 'quit' }
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
        }
    ]

    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)

    // Theme handling
    const updateTheme = () => {
        const theme = nativeTheme.shouldUseDarkColors ? 'vs-dark' : 'vs'
        win.webContents.send('theme-updated', theme)
    }

    nativeTheme.on('updated', updateTheme)

    win.webContents.on('did-finish-load', () => {
        updateTheme()
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        win.loadURL(process.env.VITE_DEV_SERVER_URL)
    } else {
        // Load the index.html when not in dev mode (for production builds)
        const indexPath = path.join(__dirname, '../dist/index.html')
        win.loadFile(indexPath).catch(e => console.error('Failed to load index.html:', e))
    }
}

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
