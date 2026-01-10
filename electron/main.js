const { app, BrowserWindow, Menu, dialog, nativeTheme, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs/promises')

app.setName('Dinky')

let currentDinkProject = null;
const MAX_RECENT_PROJECTS = 10;

// Config persistence
const configPath = path.join(app.getPath('userData'), 'config.json')

async function loadSettings() {
    try {
        const data = await fs.readFile(configPath, 'utf-8')
        return JSON.parse(data)
    } catch {
        return { theme: 'system', recentProjects: [], projectSettings: {} }
    }
}

async function getProjectSetting(projectPath, key) {
    const settings = await loadSettings();
    if (!settings.projectSettings) return null;
    if (!settings.projectSettings[projectPath]) return null;
    return settings.projectSettings[projectPath][key];
}

async function setProjectSetting(projectPath, key, value) {
    const settings = await loadSettings();
    if (!settings.projectSettings) settings.projectSettings = {};
    if (!settings.projectSettings[projectPath]) settings.projectSettings[projectPath] = {};
    settings.projectSettings[projectPath][key] = value;
    await saveSettings(settings);
}

async function saveSettings(settings) {
    try {
        const current = await loadSettings()
        await fs.writeFile(configPath, JSON.stringify({ ...current, ...settings }, null, 2))
    } catch (error) {
        console.error('Failed to save settings:', error)
    }
}

// Recent Projects Helpers
async function getRecentProjects() {
    const settings = await loadSettings();
    return settings.recentProjects || [];
}

async function addToRecentProjects(filePath) {
    let recent = await getRecentProjects();
    // Remove if exists to move to top
    recent = recent.filter(p => p !== filePath);
    recent.unshift(filePath);
    if (recent.length > MAX_RECENT_PROJECTS) {
        recent = recent.slice(0, MAX_RECENT_PROJECTS);
    }
    await saveSettings({ recentProjects: recent });
}

async function removeFromRecentProjects(filePath) {
    let recent = await getRecentProjects();
    recent = recent.filter(p => p !== filePath);
    await saveSettings({ recentProjects: recent });
}

// Helper to recursively load ink files
async function loadRootInk(rootFilePath) {
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

async function loadProject(win, filePath) {
    try {
        // Verify file exists first
        try {
            await fs.access(filePath);
        } catch {
            throw new Error(`Project file not found: ${filePath}`);
        }

        const content = await fs.readFile(filePath, 'utf-8');
        // Strip comments (single - // and multi-line - /**/)
        const jsonContent = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        currentDinkProject = { path: filePath, content: JSON.parse(jsonContent) };

        console.log('Loaded project:', filePath);
        win.setTitle(`Dinky - ${path.basename(filePath, '.dinkproj')}`);

        // Update Recent Projects
        await addToRecentProjects(filePath);
        await buildMenu(win); // Rebuild menu to update recent list

        // Auto-load Ink Root logic
        // Priority 1: Last Ink Root loaded for this project (user preference)
        const lastInkRoot = await getProjectSetting(filePath, 'lastInkRoot');
        let inkFileToLoad = null;

        if (lastInkRoot) {
            // Verify it still exists
            try {
                await fs.access(lastInkRoot);
                inkFileToLoad = lastInkRoot;
                console.log('Using stored preference for Ink Root:', inkFileToLoad);
            } catch {
                console.log('Stored last Ink Root not found, falling back.');
            }
        }

        // Priority 2: "source" in project JSON
        if (!inkFileToLoad && currentDinkProject.content.source) {
            const sourcePath = path.resolve(path.dirname(filePath), currentDinkProject.content.source);
            try {
                await fs.access(sourcePath);
                inkFileToLoad = sourcePath;
                console.log('Using project source for Ink Root:', inkFileToLoad);
            } catch (e) {
                console.warn('Project source file not found:', sourcePath);
            }
        }

        if (inkFileToLoad) {
            const files = await loadRootInk(inkFileToLoad);
            win.webContents.send('root-ink-loaded', files);
        }

        return true;
    } catch (e) {
        console.error('Failed to open project:', e);
        if (e.message.includes('not found')) {
            // Remove from recent if not found
            await removeFromRecentProjects(filePath);
            await buildMenu(win);
        }
        dialog.showErrorBox('Error', `Failed to open project file.\n${e.message}`);
        return false;
    }
}

async function handleNewProject(win, filePath) {
    try {
        const initialContent = {};
        await fs.writeFile(filePath, JSON.stringify(initialContent, null, 4), 'utf-8');
        await loadProject(win, filePath);
    } catch (e) {
        console.error('Failed to create new project:', e);
        dialog.showErrorBox('Error', 'Failed to create new project file.');
    }
}

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
                    label: 'New Project...',
                    click: async () => {
                        win.webContents.send('show-new-project-modal');
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
                        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
                            properties: ['openFile'],
                            filters: [{ name: 'Ink Files', extensions: ['ink'] }]
                        })
                        if (!canceled && filePaths.length > 0) {
                            const files = await loadRootInk(filePaths[0])
                            win.webContents.send('root-ink-loaded', files)

                            // Save as preference if a project is open
                            if (currentDinkProject) {
                                await setProjectSetting(currentDinkProject.path, 'lastInkRoot', filePaths[0]);
                                console.log('Saved Ink Root preference:', filePaths[0]);
                            }
                        }
                    }
                },
                { label: 'Save', accelerator: isMac ? 'Cmd+S' : 'Ctrl+S', click: async () => { win.webContents.send('save-all'); } },
                ...(isMac ? [] : [{ role: 'quit' }])
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
    // Strip BOM from main content
    if (content && typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    // console.log('IPC Handler: Compiling', filePath)
    const collectedErrors = []
    let parseError = null

    try {
        // inkjs.Compiler is available in the library (requires /full export)
        const inkjs = require('inkjs/full')
        const fsSync = require('fs')

        // console.log('Using inkjs.CompilerOptions:', !!inkjs.CompilerOptions)

        const fileHandler = {
            ResolveInkFilename: (filename) => {
                const baseDir = filePath ? path.dirname(filePath) : process.cwd()
                const resolved = path.resolve(baseDir, filename)
                // console.log('Resolving:', filename, '->', resolved)
                return resolved
            },
            LoadInkFileContents: (filename) => {
                // Check memory cache first (supports unsaved changes)
                if (projectFiles && projectFiles[filename]) {
                    // console.log(`Loaded memory: ${filename}`)

                    let val = projectFiles[filename]
                    if (val && typeof val === 'string' && val.charCodeAt(0) === 0xFEFF) {
                        val = val.slice(1)
                    }
                    return val
                }

                // console.log('Memory miss for:', filename)

                try {
                    return fsSync.readFileSync(filename, 'utf-8')
                } catch (e) {
                    console.error('Failed to load included file:', filename, e)
                    return ''
                }
            }
        }

        const errorHandler = (message, errorType) => {
            collectedErrors.push(message)
        }

        // Use CompilerOptions class if available to ensure correct structure
        let options
        if (inkjs.CompilerOptions) {

            options = new inkjs.CompilerOptions(
                filePath, // sourceFilename passed for better context
                [],   // pluginNames
                false, // countAllVisits
                errorHandler,
                fileHandler
            )
        } else {
            options = {
                sourceFilename: filePath,
                fileHandler,
                errorHandler
            }
        }

        // Basic InkJS compiler usage with file handler and custom error handler
        // console.log('Compiler Content Start:', content.substring(0, 100).replace(/\n/g, '\\n'))

        const compiler = new inkjs.Compiler(content, options)
        compiler.Compile()
    } catch (error) {
        if (collectedErrors.length === 0) {
            console.error('Compilation failed (unexpected):', error)
        }
        parseError = error
    }

    const errors = []

    // Process explicitly collected errors
    if (collectedErrors.length > 0) {
        collectedErrors.forEach(errStr => {
            // Determine severity (simple heuristic or default to Error)
            const severity = errStr.includes('WARNING') ? 4 : 8 // 4=Warning, 8=Error

            // Parse error string: "ERROR: 'path' line X: message" or "Line X: message"
            const parts = errStr.match(/^(?:ERROR: )?(?:'([^']+)' )?line (\d+): (.+)/i)

            if (parts) {
                const errFilePath = parts[1] || null // Capture file path if present
                const line = parseInt(parts[2])
                const msg = parts[3]

                errors.push({
                    startLineNumber: line,
                    endLineNumber: line,
                    startColumn: 1,
                    endColumn: 1000,
                    message: msg,
                    severity: severity,
                    filePath: errFilePath
                })
            } else {
                errors.push({
                    startLineNumber: 1,
                    endLineNumber: 1,
                    startColumn: 1,
                    endColumn: 1000,
                    message: errStr,
                    severity: severity,
                    filePath: null
                })
            }
        })
    }

    // If we found explicit compiler errors, return them
    if (errors.length > 0) {
        return errors
    }

    // Fallback if no errors collected but crashed
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

ipcMain.handle('save-files', async (event, files) => {
    const fs = require('fs/promises');
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
    if (!name || !parentPath) return false;

    const projectDir = path.join(parentPath, name);
    const projectFile = path.join(projectDir, `${name}.dinkproj`);
    const inkFile = path.join(projectDir, 'main.ink');

    try {
        await fs.mkdir(projectDir, { recursive: true });

        // precise content as requested: empty JSON
        await fs.writeFile(projectFile, '{}', 'utf-8');

        // precise content as requested
        await fs.writeFile(inkFile, '// Add Ink content here', 'utf-8');

        // Set this as the preferred ink root for this project immediately
        // This ensures it loads automatically and is remembered
        await setProjectSetting(projectFile, 'lastInkRoot', inkFile);

        // Load it
        await loadProject(win, projectFile);
        return true;
    } catch (e) {
        console.error('Failed to create new project:', e);
        dialog.showErrorBox('Error', `Failed to create new project: ${e.message}`);
        return false;
    }
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
