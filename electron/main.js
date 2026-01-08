const { app, BrowserWindow, Menu, dialog, nativeTheme, ipcMain } = require('electron')
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

// Compile handling
ipcMain.handle('compile-ink', async (event, content) => {
    let compiler = null
    let parseError = null

    try {
        // console.log('Compiling ink content, length:', content.length); // Optional: keep or remove debug

        // inkjs.Compiler is available in the library (requires /full export)
        const inkjs = require('inkjs/full')

        // Basic InkJS compiler usage for single file content:
        compiler = new inkjs.Compiler(content)
        compiler.Compile()
    } catch (error) {
        console.error('Compilation failed:', error)
        parseError = error
    }

    const errors = []

    // 1. Try to get standard internal errors from the compiler instance
    if (compiler && compiler.errors && compiler.errors.length > 0) {
        compiler.errors.forEach(errStr => {
            const lineMatch = errStr.match(/Line (\d+): (.+)/i)
            if (lineMatch) {
                const line = parseInt(lineMatch[1])
                const msg = lineMatch[2]
                errors.push({
                    startLineNumber: line,
                    endLineNumber: line,
                    startColumn: 1,
                    endColumn: 1000,
                    message: msg,
                    severity: 8 // MarkerSeverity.Error
                })
            } else {
                errors.push({
                    startLineNumber: 1,
                    endLineNumber: 1,
                    startColumn: 1,
                    endColumn: 1000,
                    message: errStr,
                    severity: 8
                })
            }
        })
    }

    // 2. If we found explicit compiler errors, return them (they usually contain the true syntax error)
    if (errors.length > 0) {
        return errors
    }

    // 3. If no internal errors were recorded but usage threw an exception (e.g. crash), use heuristics
    if (parseError) {
        // Heuristic: Check for common crash causes
        let errorLine = 1
        let errorMsg = 'Compiler Error: ' + parseError.message

        if (parseError.message.includes('not a function') || parseError.message.includes('undefined')) {
            const lines = content.split(/\r?\n/)
            for (let i = 0; i < lines.length; i++) {
                // Known crash: bare '~'
                if (lines[i].trim() === '~') {
                    errorLine = i + 1
                    errorMsg = "Syntax Error: Incomplete logic line. '~' must be followed by code."
                    break
                }
            }
        }

        return [{
            startLineNumber: errorLine,
            endLineNumber: errorLine,
            startColumn: 1,
            endColumn: 1000,
            message: errorMsg,
            severity: 8
        }]
    }

    return []
})

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
