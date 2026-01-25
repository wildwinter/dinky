import { app, BrowserWindow, nativeTheme, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { spawn } from 'child_process'

import { loadSettings, getRecentProjects, removeFromRecentProjects, getWindowState, saveWindowState, flushSettings, getCompilerPath, setCompilerPath } from './config'
import { buildMenu } from './menu'
import { compileInk, parseInk } from './compiler'
import { openTestWindow } from './test-runner'
import { generateIdsForUntagged } from './tagger'
import { loadProject, loadAdhocInkProject, switchToInkRoot, createNewProject, createNewInclude, openNewIncludeUI, openInkRootUI, createInkRoot, removeInclude, chooseExistingInclude, renameInclude, renameInkRoot, createNewInkRoot, openNewInkRootUI, setMenuRebuildCallback, getCurrentProject, getCurrentInkRoot } from './project-manager'
import { initSearch, openSearchWindow } from './search'
import './project-settings' // Import to register IPC handlers
import './characters-editor' // Import to register IPC handlers
import { safeSend, setupThemeListener } from './utils'

app.setName('Dinky')
app.commandLine.appendSwitch('disable-features', 'Autofill')
app.setAboutPanelOptions({
    copyright: 'Copyright © 2026 Ian Thomas',
    credits: `Powered by inkjs v2.3.2`
})

// Wire up the menu rebuild callback
setMenuRebuildCallback(buildMenu);


let mainWindow = null;
let fileToOpen = null; // Store file path to open on startup
let pendingAction = null; // { type: 'close' } or { type: 'load', path: '...' }

// Handle file association on macOS
app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();

        // Trigger safe load check
        pendingAction = { type: 'load', path: filePath };
        safeSend(mainWindow, 'check-unsaved');
    } else {
        fileToOpen = filePath;
    }
});

// Single instance lock for Windows
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Focus existing window when second instance is launched
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();

            // Windows: Extract file path from command line arguments
            const filePath = commandLine.find(arg => arg.endsWith('.dinkproj'));
            if (filePath) {
                // Trigger safe load check
                pendingAction = { type: 'load', path: filePath };
                safeSend(mainWindow, 'check-unsaved');
            } else {
                const inkPath = commandLine.find(arg => arg.endsWith('.ink'));
                if (inkPath) {
                    pendingAction = { type: 'load', path: inkPath };
                    safeSend(mainWindow, 'check-unsaved');
                }
            }
        }
    });



    async function createWindow() {
        // Load settings
        const settings = await loadSettings()
        nativeTheme.themeSource = settings.theme || 'system'

        ipcMain.handle('load-settings', async () => {
            return await loadSettings();
        });

        // Load saved window state
        const windowState = await getWindowState('main');

        const win = new BrowserWindow({
            title: 'Dinky',
            width: windowState?.width || 800,
            height: windowState?.height || 600,
            x: windowState?.x,
            y: windowState?.y,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
            },
            icon: path.join(__dirname, '../build/DinkyApp.' + (process.platform === 'win32' ? 'ico' : 'icns'))
        })

        mainWindow = win;
        initSearch(win);

        // Initial menu build
        await buildMenu(win);
        ipcMain.emit('rebuild-menu');

        // Theme handling
        const { update: updateTheme } = setupThemeListener(win);

        win.webContents.on('did-finish-load', async () => {
            updateTheme()

            // Check if we have a file to open (Mac or Windows/Linux)
            if (process.platform === 'win32') {
                const filePath = process.argv.find(arg => arg.endsWith('.dinkproj'));
                if (filePath) {
                    fileToOpen = filePath;
                } else {
                    const inkPath = process.argv.find(arg => arg.endsWith('.ink'));
                    if (inkPath) fileToOpen = inkPath;
                }
            }

            if (fileToOpen) {
                console.log('Opening file from association:', fileToOpen);

                if (fileToOpen.endsWith('.dinkproj')) {
                    await loadProject(win, fileToOpen);
                } else if (fileToOpen.endsWith('.ink')) {
                    await openInkFile(win, fileToOpen);
                }

                fileToOpen = null; // Clear it
                return;
            }

            // Load last used project if available

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

                    // Restore other windows if they were open
                    const currentSettings = await loadSettings();
                    if (currentSettings.searchWindowOpen) {
                        await openSearchWindow();
                    }
                    if (currentSettings.testWindowOpen) {
                        // Start test (which opens the window)
                        safeSend(win, 'trigger-start-test');
                    }
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

        win.forceClose = false;

        win.on('move', () => saveWindowState('main', win.getBounds()));
        win.on('resize', () => saveWindowState('main', win.getBounds()));

        win.on('close', (e) => {
            if (win.forceClose) return;
            if (win.webContents.isDestroyed()) return;
            e.preventDefault();
            pendingAction = { type: 'close' };
            safeSend(win, 'check-unsaved');
        });

        win.on('closed', () => {
            mainWindow = null;
            app.quit();
        });
    }

    // IPC Handlers for Unsaved Check
    ipcMain.on('unsaved-status', async (event, hasUnsaved) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;

        if (!hasUnsaved) {
            performPendingAction(win);
        } else {
            const choice = dialog.showMessageBoxSync(win, {
                type: 'question',
                buttons: ['Save', 'Discard', 'Cancel'],
                defaultId: 0,
                title: 'Unsaved Changes',
                message: 'Do you want to save the changes you made in the project?',
                detail: "Your changes will be lost if you don't save them.",
                cancelId: 2,
                noLink: true
            });

            if (choice === 0) { // Save
                safeSend(win, 'save-and-exit'); // Triggers save, then 'save-exit-complete'
            } else if (choice === 1) { // Discard
                performPendingAction(win);
            }
            // Choice 2 is Cancel:
            else {
                pendingAction = null;
            }
        }
    });

    ipcMain.on('save-exit-complete', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) {
            performPendingAction(win);
        }
    });

    async function performPendingAction(win) {
        if (!pendingAction) return;

        if (pendingAction.type === 'close') {
            win.forceClose = true;
            win.close();
        } else if (pendingAction.type === 'load') {
            if (pendingAction.path.endsWith('.dinkproj')) {
                await loadProject(win, pendingAction.path);
            } else if (pendingAction.path.endsWith('.ink')) {
                await openInkFile(win, pendingAction.path);
            }
        }
        pendingAction = null;
    }

    // Renderer logging
    ipcMain.on('renderer-log', (event, ...args) => {
        console.log('[Renderer]', ...args)
    })

    // Compile handling
    ipcMain.handle('compile-ink', async (event, content, filePath, projectFiles = {}) => {
        return await compileInk(content, filePath, projectFiles);
    })

    // Auto-tag handling
    ipcMain.handle('auto-tag-ink', async (event, content, filePath, projectFiles = {}) => {
        // Parse the ink content to get the AST
        const parsedStory = parseInk(content, filePath, projectFiles);

        if (!parsedStory) {
            return [];
        }

        // Extract filename without .ink for ID prefix
        const filePrefix = path.basename(filePath, '.ink');

        // Generate IDs for untagged lines
        const edits = generateIdsForUntagged(parsedStory, filePrefix);

        // Filter edits to only include those for the current file
        const filteredEdits = edits.filter(edit => {
            if (!edit.file) return false;
            // Normalize paths for comparison to avoid issues with separators
            return path.normalize(edit.file) === path.normalize(filePath);
        });

        return filteredEdits;
    })

    // Save files handling
    ipcMain.handle('save-files', async (event, files) => {
        for (const { path: filePath, content } of files) {
            try {
                await fs.writeFile(filePath, content, 'utf-8');
            } catch (e) {
                console.error('Failed to save file', filePath, e);
            }
        }
    });





    async function openInkFile(win, filePath) {
        const dir = path.dirname(filePath);

        try {
            // Check for sibling .dinkproj
            const files = await fs.readdir(dir);
            const dinkProj = files.find(f => f.endsWith('.dinkproj'));

            if (dinkProj) {
                const projectPath = path.join(dir, dinkProj);
                console.log('Found sibling project, loading that:', projectPath);

                const loaded = await loadProject(win, projectPath);
                if (loaded) {
                    // Force switch to the opened file as the root
                    await switchToInkRoot(win, filePath);
                }
            } else {
                await loadAdhocInkProject(win, filePath);
            }
        } catch (e) {
            console.error('Error opening ink file:', e);
            await loadAdhocInkProject(win, filePath);
        }
    }

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

    ipcMain.handle('open-ink-root', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) await openInkRootUI(win);
    });

    ipcMain.handle('create-ink-root', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) return await createInkRoot(win);
    });

    ipcMain.handle('new-project', async (event) => {
        // This is called from the renderer "New Project" button in empty state
        // We want to reuse the same modal flow
        const win = BrowserWindow.fromWebContents(event.sender);
        safeSend(win, 'show-new-project-modal');
    });

    ipcMain.handle('select-folder', async (event, defaultPath) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            defaultPath: defaultPath,
            properties: ['openDirectory', 'createDirectory']
        });
        if (!canceled && filePaths.length > 0) {
            return filePaths[0];
        }
        return null;
    });

    ipcMain.handle('create-new-project', async (event, name, parentPath) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await createNewProject(win, name, parentPath);
    });

    ipcMain.handle('select-compiler', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const currentPath = await getCompilerPath();

        const isWindows = process.platform === 'win32';
        const expectedFilename = isWindows ? 'DinkCompiler.exe' : 'DinkCompiler';

        const dialogOptions = {
            defaultPath: currentPath || undefined,
            properties: ['openFile', 'showHiddenFiles'],
            title: 'Select Dink Compiler',
            message: isWindows ? 'Select DinkCompiler.exe' : 'Select the DinkCompiler executable',
            buttonLabel: 'Select Compiler'
        };

        // Only add filters on Windows where they're effective
        if (isWindows) {
            dialogOptions.filters = [{ name: 'Dink Compiler (DinkCompiler.exe)', extensions: ['exe'] }];
        }

        const { canceled, filePaths } = await dialog.showOpenDialog(win, dialogOptions);

        if (!canceled && filePaths.length > 0) {
            const selectedPath = filePaths[0];
            const selectedFilename = path.basename(selectedPath);

            // Validate the filename
            const isValidFilename = isWindows
                ? selectedFilename.toLowerCase() === 'dinkcompiler.exe'
                : selectedFilename === 'DinkCompiler';

            if (!isValidFilename) {
                dialog.showErrorBox(
                    'Invalid Compiler Selection',
                    `Please select the Dink Compiler executable named "${expectedFilename}".`
                );
                return null;
            }

            await setCompilerPath(selectedPath);

            // Rebuild menu to update the disabled state
            if (mainWindow) {
                await buildMenu(mainWindow);
            }

            return selectedPath;
        }
        return null;
    });

    ipcMain.handle('get-compiler-path', async () => {
        return await getCompilerPath();
    });

    ipcMain.handle('run-compile', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const compilerPath = await getCompilerPath();
        const project = getCurrentProject();
        const inkRoot = getCurrentInkRoot();

        if (!compilerPath) {
            return { success: false, error: 'No compiler path set' };
        }

        if (!project || !project.path) {
            return { success: false, error: 'No project loaded' };
        }

        if (!inkRoot) {
            return { success: false, error: 'No ink root file selected' };
        }

        const projectPath = path.resolve(project.path);
        const sourcePath = path.resolve(inkRoot);

        const args = ['--project', projectPath, '--source', sourcePath];

        // Send the command line being executed
        const commandLine = `${compilerPath} ${args.join(' ')}\n\n`;
        safeSend(win, 'compile-output', { type: 'command', data: commandLine });

        return new Promise((resolve) => {
            const compiler = spawn(compilerPath, args);

            compiler.stdout.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stdout', data: data.toString() });
            });

            compiler.stderr.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stderr', data: data.toString() });
            });

            compiler.on('error', (error) => {
                safeSend(win, 'compile-output', { type: 'error', data: `Failed to start compiler: ${error.message}` });
                resolve({ success: false, error: error.message });
            });

            compiler.on('close', (code) => {
                // Get destFolder from project content
                let destFolderPath = null;
                if (project.content && project.content.destFolder) {
                    // Resolve relative to project directory
                    const projectDir = path.dirname(projectPath);
                    destFolderPath = path.resolve(projectDir, project.content.destFolder);
                }

                safeSend(win, 'compile-complete', { code, destFolder: destFolderPath });
                resolve({ success: true, exitCode: code });
            });
        });
    });

    app.whenReady().then(() => {
        createWindow()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow()
            }
        })
    })


    ipcMain.handle('create-new-include', async (event, name, folderPath) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await createNewInclude(win, name, folderPath);
    });

    ipcMain.handle('open-new-include-ui', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) openNewIncludeUI(win);
    });

    ipcMain.handle('choose-existing-include', async (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await chooseExistingInclude(win);
    });

    ipcMain.handle('remove-include', async (event, filePath) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await removeInclude(win, filePath);
    });

    ipcMain.handle('rename-include', async (event, oldPath, newName) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await renameInclude(win, oldPath, newName);
    });

    ipcMain.handle('rename-ink-root', async (event, newName) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await renameInkRoot(win, newName);
    });

    ipcMain.handle('create-new-ink-root', async (event, name, folderPath) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await createNewInkRoot(win, name, folderPath);
    });

    ipcMain.handle('open-new-ink-root-ui', (event) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win) openNewInkRootUI(win);
    });

    ipcMain.handle('start-test', (event, rootPath, projectFiles, knotName) => {
        openTestWindow(rootPath, projectFiles, knotName);
    });
    ipcMain.on('request-test-restart', () => {
        safeSend(mainWindow, 'trigger-restart-test');
    });
    ipcMain.on('rebuild-menu', () => {
        if (mainWindow) buildMenu(mainWindow);
    });

    ipcMain.on('update-window-title', (event, { fileName }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const project = getCurrentProject();
        if (project && win) {
            const projectName = path.basename(project.path, '.dinkproj');
            const simpleFileName = fileName ? fileName.replace(/\.ink$/i, '') : '';
            win.setTitle(`Dinky - ${projectName} - ${simpleFileName}`);
        }
    });

    app.on('window-all-closed', () => {
        app.quit()
    })

    ipcMain.handle('load-project-dictionary', async (event) => {
        const project = getCurrentProject();
        if (!project) return [];

        const projectDir = path.dirname(project.path);
        const dictPath = path.join(projectDir, 'project-dictionary.txt');

        try {
            // Check if path exists
            try {
                await fs.access(dictPath);
            } catch {
                // Doesn't exist
                return [];
            }

            const content = await fs.readFile(dictPath, 'utf-8');
            return content.split('\n').map(w => w.trim()).filter(w => w);
        } catch (e) {
            console.error('Failed to load project dictionary', e);
            return [];
        }
    });

    ipcMain.handle('add-to-project-dictionary', async (event, word) => {
        const project = getCurrentProject();
        if (!project) return;

        const projectDir = path.dirname(project.path);
        const dictPath = path.join(projectDir, 'project-dictionary.txt');

        try {
            let content = '';
            try {
                content = await fs.readFile(dictPath, 'utf-8');
            } catch (e) { }

            // Cleanly add the word to a list of lines
            let lines = content.split('\n').map(l => l.trim()).filter(l => l);
            if (!lines.includes(word)) {
                lines.push(word);
                await fs.writeFile(dictPath, lines.join('\n') + '\n', 'utf-8');
            }
        } catch (e) {
            console.error('Failed to update dictionary', e);
        }
    });

    ipcMain.handle('edit-project-dictionary', async (event) => {
        const project = getCurrentProject();
        if (!project) return;

        const projectDir = path.dirname(project.path);
        const dictPath = path.join(projectDir, 'project-dictionary.txt');

        try {
            // Check if it exists, if not create it empty
            try {
                await fs.access(dictPath);
            } catch {
                await fs.writeFile(dictPath, '', 'utf-8');
            }

            // Open with system default
            await shell.openPath(dictPath);
        } catch (e) {
            console.error('Failed to open project dictionary', e);
        }
    });

    ipcMain.handle('load-project-characters', async (event) => {
        const project = getCurrentProject();
        if (!project) return [];

        const projectDir = path.dirname(project.path);
        const jsonPath = path.join(projectDir, 'characters.json');
        const jsoncPath = path.join(projectDir, 'characters.jsonc');

        let content = null;
        try {
            content = await fs.readFile(jsonPath, 'utf-8');
        } catch {
            try {
                content = await fs.readFile(jsoncPath, 'utf-8');
            } catch {
                return []; // No character file found
            }
        }

        if (!content) return [];

        try {
            // Strip comments from JSONC content (handles // and /* */ style comments)
            const cleanContent = content.replace(/\/\/.*(?:\r?\n|$)/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            return JSON.parse(cleanContent);
        } catch (e) {
            console.error('Failed to parse characters file', e);
            return [];
        }
    });

    ipcMain.handle('add-project-character', async (event, characterId) => {
        const project = getCurrentProject();
        if (!project) return false;

        const projectDir = path.dirname(project.path);
        const jsonPath = path.join(projectDir, 'characters.json');
        const jsoncPath = path.join(projectDir, 'characters.jsonc');

        let targetPath = null;
        let content = null;

        // Determine which file to use
        try {
            content = await fs.readFile(jsonPath, 'utf-8');
            targetPath = jsonPath;
        } catch {
            try {
                content = await fs.readFile(jsoncPath, 'utf-8');
                targetPath = jsoncPath;
            } catch {
                // Neither exists, create characters.json
                targetPath = jsonPath;
                content = '[]';
            }
        }

        try {

            let chars = [];
            try {
                // clean for parsing
                const cleanContent = content.replace(/\/\/.*(?:\r?\n|$)/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
                chars = JSON.parse(cleanContent);
                if (!Array.isArray(chars)) chars = [];
            } catch {
                chars = [];
            }

            // Check if ID exists
            if (chars.find(c => c.ID === characterId)) return true;

            chars.push({ ID: characterId, Actor: "" });

            await fs.writeFile(targetPath, JSON.stringify(chars, null, 4), 'utf-8');
            return true;

        } catch (e) {
            console.error('Failed to add character to project', e);
            return false;
        }
    });

    // Ensure config is saved before quit
    let isQuitting = false;
    app.on('before-quit', async (e) => {
        if (isQuitting) return;

        e.preventDefault();
        await flushSettings();
        isQuitting = true;
        app.quit();
    });
}
