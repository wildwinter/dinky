import { app, BrowserWindow, nativeTheme, ipcMain, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { spawn } from 'child_process'

import { loadSettings, getRecentProjects, removeFromRecentProjects, getWindowState, saveWindowState, flushSettings, getCompilerPath, getViewerPath } from './config'
import { buildMenu } from './menu'
import { compileInk, parseInk } from './compiler'
import { openTestWindow } from './test-runner'
import { generateIdsForUntagged } from './tagger'
import { loadProject, loadAdhocInkProject, switchToInkRoot, createNewProject, createNewInclude, openNewIncludeUI, openInkRootUI, createInkRoot, removeInclude, chooseExistingInclude, renameInclude, renameInkRoot, createNewInkRoot, openNewInkRootUI, setMenuRebuildCallback, getCurrentProject, getCurrentInkRoot, loadRootInk, getInkRootRev } from './project-manager'
import { initSearch, openSearchWindow } from './search'
import './project-settings' // Import to register IPC handlers
import './characters-editor' // Import to register IPC handlers
import './audio-lookup' // Import to register IPC handlers
import { safeSend, setupThemeListener } from './utils'
import { vcWriteText } from './vc'
import { safeReadText, safeReadJSON } from './safe-read'
import pkg from '../package.json'
import { startBackgroundUpdateCheck } from './updater'

if (process.platform === 'win32') {
    app.setAppUserModelId('net.wildwinter.dinky')
}
app.setName('Dinky')
app.commandLine.appendSwitch('disable-features', 'Autofill')
app.setAboutPanelOptions({
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Ian Thomas',
    credits: `Powered by inkjs v${pkg.inkjsVersion}, Dink v${pkg.dinkVersion} and simple-vc-lib v${__VC_LIB_VERSION__}`
})

// Wire up the menu rebuild callback
setMenuRebuildCallback(buildMenu);


let mainWindow = null;
let fileToOpen = null; // Store file path to open on startup
let inkFileToOpen = null; // Optional .ink file to activate after loading a project
let pendingAction = null; // { type: 'close' } or { type: 'load', path: '...', inkPath: '...' }

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

            // Extract file paths from command line arguments
            const filePath = commandLine.find(arg => arg.endsWith('.dinkproj'));
            const inkPath = commandLine.find(arg => arg.endsWith('.ink'));
            if (filePath) {
                pendingAction = { type: 'load', path: filePath, inkPath: inkPath || null };
                safeSend(mainWindow, 'check-unsaved');
            } else if (inkPath) {
                pendingAction = { type: 'load', path: inkPath };
                safeSend(mainWindow, 'check-unsaved');
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
            icon: process.platform === 'win32'
                ? (app.isPackaged
                    ? path.join(process.resourcesPath, 'DinkyApp.ico')
                    : path.join(__dirname, '../build/DinkyApp.ico'))
                : path.join(__dirname, '../build/DinkyApp.icns')
        })

        mainWindow = win;
        initSearch(win);

        // Initial menu build
        await buildMenu(win);


        // Theme handling
        const { update: updateTheme } = setupThemeListener(win);

        win.webContents.on('did-finish-load', async () => {
            updateTheme()

            // Check command line args for files to open (all platforms).
            // On macOS, fileToOpen may already be set via the open-file event (file association).
            if (!fileToOpen) {
                const argProjPath = process.argv.find(arg => arg.endsWith('.dinkproj'));
                const argInkPath = process.argv.find(arg => arg.endsWith('.ink'));
                if (argProjPath) {
                    fileToOpen = argProjPath;
                    inkFileToOpen = argInkPath || null;
                } else if (argInkPath) {
                    fileToOpen = argInkPath;
                }
            }

            if (fileToOpen) {
                console.log('Opening file from association:', fileToOpen);

                if (fileToOpen.endsWith('.dinkproj')) {
                    const loaded = await loadProject(win, fileToOpen);
                    if (loaded && inkFileToOpen) {
                        await switchToInkRoot(win, inkFileToOpen);
                    }
                } else if (fileToOpen.endsWith('.ink')) {
                    await openInkFile(win, fileToOpen);
                }

                fileToOpen = null;
                inkFileToOpen = null;
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

        // When the user returns to the app, re-traverse the Ink root so the
        // sidebar reflects files that may have been added/deleted on disk.
        // This sends 'ink-files-refreshed' (sidebar-only reconcile), NOT
        // 'root-ink-loaded' which would clobber the editor and lose unsaved edits.
        //
        // We capture the structural revision at the start. The renderer drops
        // refreshes whose rev is older than the most recent 'root-ink-loaded'
        // it has seen — that's how we avoid the race where a slow focus
        // refresh emits stale file paths after a rename has already happened.
        win.on('focus', async () => {
            const inkRoot = getCurrentInkRoot();
            if (!inkRoot) return;
            const revAtStart = getInkRootRev();
            try {
                const files = await loadRootInk(inkRoot);
                safeSend(win, 'ink-files-refreshed', files, revAtStart);
            } catch (e) {
                console.error('Focus refresh failed:', e);
            }
        });

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
                const loaded = await loadProject(win, pendingAction.path);
                if (loaded && pendingAction.inkPath) {
                    await switchToInkRoot(win, pendingAction.inkPath);
                }
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
            // parseInk already logs the underlying error. Log here too so the
            // breadcrumb explicitly says "auto-tag skipped" — otherwise it
            // looks like auto-tag silently does nothing.
            console.warn('[auto-tag-ink] parse failed for', filePath, '— skipping auto-tag for this file.');
            return [];
        }

        // Extract filename without .ink for ID prefix, keeping only alphanumerics and hyphens
        const filePrefix = path.basename(filePath, '.ink').replace(/[^a-zA-Z0-9-]/g, '');

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

    // Save files handling. Returns per-file outcome so the renderer can:
    //   - keep the dirty marker (asterisk) on files that didn't actually save
    //   - leave originalContent untouched for failed files (so the next save
    //     retries the right content rather than silently treating them clean)
    ipcMain.handle('save-files', async (event, files) => {
        const savedPaths = [];
        const errors = [];      // [{ path, message }]
        const refused = [];     // [{ path, reason }]

        for (const { path: filePath, content } of files) {
            // Safety net: refuse to write content that looks like the legacy
            // "// Error reading file: ENOENT…" placeholder from an old codepath.
            // If we ever see this in memory it means the load failed and the
            // in-memory content is junk — saving it would destroy the real file.
            if (typeof content !== 'string' || /^\/\/ Error reading file:/.test(content)) {
                console.error('Refusing to save error-placeholder content for', filePath);
                refused.push({ path: filePath, reason: 'error-placeholder content' });
                continue;
            }

            // Belt-and-suspenders: refuse to truncate a non-empty file with an
            // empty string. A legitimate "delete all content" save would have
            // had a non-empty file at some point and the user typed it to ''
            // — that's a manual action, but if it ever happens via a bug
            // (model swap race, init order issue, etc.), we'd silently zero
            // out the file. Compare against on-disk size to allow real empties.
            if (content === '') {
                let onDiskSize = 0;
                try {
                    const stat = await fs.stat(filePath);
                    onDiskSize = stat.size;
                } catch {
                    // File doesn't exist yet — empty write is fine (legit new file).
                }
                if (onDiskSize > 0) {
                    console.error('Refusing to truncate non-empty file with empty content:', filePath, `(disk size ${onDiskSize})`);
                    refused.push({ path: filePath, reason: 'empty content over non-empty file' });
                    continue;
                }
            }

            try {
                vcWriteText(filePath, content);
                savedPaths.push(filePath);
            } catch (e) {
                console.error('Failed to save file', filePath, e);
                errors.push({ path: filePath, message: e.message });
            }
        }

        if (errors.length > 0) {
            dialog.showErrorBox(
                'Failed to save files',
                errors.map(e => `${path.basename(e.path)}: ${e.message}`).join('\n')
            );
        }
        if (refused.length > 0) {
            dialog.showErrorBox(
                'Refused to overwrite files',
                `These files were not saved because their in-memory content looked like an error placeholder. ` +
                `Restore them from version control if needed:\n\n${refused.map(r => path.basename(r.path)).join('\n')}`
            );
        }

        return { savedPaths, errors, refused };
    });

    // Re-traverse INCLUDE statements from disk and notify the renderer.
    // Used after saves and on window focus to keep the sidebar in sync with
    // INCLUDEs that were added/removed (either via the UI or by editing the
    // root file directly). Emits 'ink-files-refreshed' — the renderer reconciles
    // the sidebar without touching the editor model.
    ipcMain.handle('refresh-ink-root', async (event) => {
        const inkRoot = getCurrentInkRoot();
        if (!inkRoot) return null;
        const win = BrowserWindow.fromWebContents(event.sender);
        const revAtStart = getInkRootRev();
        try {
            const files = await loadRootInk(inkRoot);
            safeSend(win, 'ink-files-refreshed', files, revAtStart);
            return files;
        } catch (e) {
            console.error('refresh-ink-root failed:', e);
            return null;
        }
    });





    async function openInkFile(win, filePath) {
        // Walk up the directory tree to find a .dinkproj (like git finds .git)
        async function findDinkProj(dir) {
            while (true) {
                try {
                    const files = await fs.readdir(dir);
                    const dinkProj = files.find(f => f.endsWith('.dinkproj'));
                    if (dinkProj) return path.join(dir, dinkProj);
                } catch {
                    return null;
                }
                const parent = path.dirname(dir);
                if (parent === dir) return null; // reached filesystem root
                dir = parent;
            }
        }

        try {
            const projectPath = await findDinkProj(path.dirname(filePath));

            if (projectPath) {
                console.log('Found project, loading:', projectPath);
                const loaded = await loadProject(win, projectPath);
                if (loaded) {
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

    ipcMain.handle('select-file', async (event, defaultPath, filters) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const { canceled, filePaths } = await dialog.showOpenDialog(win, {
            defaultPath: defaultPath,
            filters: filters || [],
            properties: ['openFile']
        });
        if (!canceled && filePaths.length > 0) {
            return filePaths[0];
        }
        return null;
    });

    ipcMain.handle('save-file', async (event, defaultPath, filters) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
            defaultPath: defaultPath,
            filters: filters || []
        });
        if (!canceled && filePath) {
            return filePath;
        }
        return null;
    });

    ipcMain.handle('create-new-project', async (event, name, parentPath) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        return await createNewProject(win, name, parentPath);
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

    ipcMain.handle('export-html', async (event, destFile) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const compilerPath = await getCompilerPath();
        const viewerPath = await getViewerPath();
        const project = getCurrentProject();

        if (!compilerPath) {
            return { success: false, error: 'No compiler path set' };
        }

        if (!viewerPath) {
            return { success: false, error: 'No viewer path set' };
        }

        if (!project || !project.path) {
            return { success: false, error: 'No project loaded' };
        }

        const projectPath = path.resolve(project.path);

        // Step 1: Run DinkCompiler with --dinkStructure
        safeSend(win, 'compile-output', { type: 'command', data: 'Step 1: Preparing Dink structure...\n' });
        const compilerArgs = ['--project', projectPath, '--dinkStructure'];
        const compilerCmd = `${compilerPath} ${compilerArgs.join(' ')}\n\n`;
        safeSend(win, 'compile-output', { type: 'command', data: compilerCmd });

        return new Promise((resolve) => {
            const compiler = spawn(compilerPath, compilerArgs);

            compiler.stdout.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stdout', data: data.toString() });
            });

            compiler.stderr.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stderr', data: data.toString() });
            });

            compiler.on('error', (error) => {
                safeSend(win, 'compile-output', { type: 'error', data: `Failed to start compiler: ${error.message}\n` });
                safeSend(win, 'compile-complete', { code: -1, destFile: null, exportType: 'html' });
                resolve({ success: false, error: error.message });
            });

            compiler.on('close', (compilerCode) => {
                if (compilerCode !== 0) {
                    safeSend(win, 'compile-output', { type: 'error', data: `\nCompiler failed with exit code ${compilerCode}\n` });
                    safeSend(win, 'compile-complete', { code: compilerCode, destFile: null, exportType: 'html' });
                    resolve({ success: false, error: `Compiler failed with exit code ${compilerCode}` });
                    return;
                }

                // Step 2: Run DinkViewer
                safeSend(win, 'compile-output', { type: 'command', data: '\n\nStep 2: Exporting Interactive HTML...\n' });
                const viewerArgs = ['--project', projectPath, '--destFile', destFile, '--silent'];
                const viewerCmd = `${viewerPath} ${viewerArgs.join(' ')}\n\n`;
                safeSend(win, 'compile-output', { type: 'command', data: viewerCmd });

                const viewer = spawn(viewerPath, viewerArgs);

                viewer.stdout.on('data', (data) => {
                    safeSend(win, 'compile-output', { type: 'stdout', data: data.toString() });
                });

                viewer.stderr.on('data', (data) => {
                    safeSend(win, 'compile-output', { type: 'stderr', data: data.toString() });
                });

                viewer.on('error', (error) => {
                    safeSend(win, 'compile-output', { type: 'error', data: `Failed to start viewer: ${error.message}\n` });
                    safeSend(win, 'compile-complete', { code: -1, destFile: null, exportType: 'html' });
                    resolve({ success: false, error: error.message });
                });

                viewer.on('close', (viewerCode) => {
                    safeSend(win, 'compile-complete', { code: viewerCode, destFile: viewerCode === 0 ? destFile : null, exportType: 'html' });
                    resolve({ success: viewerCode === 0, exitCode: viewerCode });
                });
            });
        });
    });

    ipcMain.handle('export-pdf', async (event, destFile) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const compilerPath = await getCompilerPath();
        const viewerPath = await getViewerPath();
        const project = getCurrentProject();

        if (!compilerPath) {
            return { success: false, error: 'No compiler path set' };
        }

        if (!viewerPath) {
            return { success: false, error: 'No viewer path set' };
        }

        if (!project || !project.path) {
            return { success: false, error: 'No project loaded' };
        }

        const projectPath = path.resolve(project.path);

        // Step 1: Run DinkCompiler with --dinkStructure
        safeSend(win, 'compile-output', { type: 'command', data: 'Step 1: Preparing Dink structure...\n' });
        const compilerArgs = ['--project', projectPath, '--dinkStructure'];
        const compilerCmd = `${compilerPath} ${compilerArgs.join(' ')}\n\n`;
        safeSend(win, 'compile-output', { type: 'command', data: compilerCmd });

        return new Promise((resolve) => {
            const compiler = spawn(compilerPath, compilerArgs);

            compiler.stdout.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stdout', data: data.toString() });
            });

            compiler.stderr.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stderr', data: data.toString() });
            });

            compiler.on('error', (error) => {
                safeSend(win, 'compile-output', { type: 'error', data: `Failed to start compiler: ${error.message}\n` });
                safeSend(win, 'compile-complete', { code: -1, destFile: null, exportType: 'pdf' });
                resolve({ success: false, error: error.message });
            });

            compiler.on('close', (compilerCode) => {
                if (compilerCode !== 0) {
                    safeSend(win, 'compile-output', { type: 'error', data: `\nCompiler failed with exit code ${compilerCode}\n` });
                    safeSend(win, 'compile-complete', { code: compilerCode, destFile: null, exportType: 'pdf' });
                    resolve({ success: false, error: `Compiler failed with exit code ${compilerCode}` });
                    return;
                }

                // Step 2: Run DinkViewer with --pdf
                safeSend(win, 'compile-output', { type: 'command', data: '\n\nStep 2: Exporting PDF...\n' });
                const viewerArgs = ['--project', projectPath, '--destFile', destFile, '--silent', '--pdf'];
                const viewerCmd = `${viewerPath} ${viewerArgs.join(' ')}\n\n`;
                safeSend(win, 'compile-output', { type: 'command', data: viewerCmd });

                const viewer = spawn(viewerPath, viewerArgs);

                viewer.stdout.on('data', (data) => {
                    safeSend(win, 'compile-output', { type: 'stdout', data: data.toString() });
                });

                viewer.stderr.on('data', (data) => {
                    safeSend(win, 'compile-output', { type: 'stderr', data: data.toString() });
                });

                viewer.on('error', (error) => {
                    safeSend(win, 'compile-output', { type: 'error', data: `Failed to start viewer: ${error.message}\n` });
                    safeSend(win, 'compile-complete', { code: -1, destFile: null, exportType: 'pdf' });
                    resolve({ success: false, error: error.message });
                });

                viewer.on('close', (viewerCode) => {
                    safeSend(win, 'compile-complete', { code: viewerCode, destFile: viewerCode === 0 ? destFile : null, exportType: 'pdf' });
                    resolve({ success: viewerCode === 0, exitCode: viewerCode });
                });
            });
        });
    });

    ipcMain.handle('export-word', async (event, destFile) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const compilerPath = await getCompilerPath();
        const viewerPath = await getViewerPath();
        const project = getCurrentProject();

        if (!compilerPath) {
            return { success: false, error: 'No compiler path set' };
        }

        if (!viewerPath) {
            return { success: false, error: 'No viewer path set' };
        }

        if (!project || !project.path) {
            return { success: false, error: 'No project loaded' };
        }

        const projectPath = path.resolve(project.path);

        // Step 1: Run DinkCompiler with --dinkStructure
        safeSend(win, 'compile-output', { type: 'command', data: 'Step 1: Preparing Dink structure...\n' });
        const compilerArgs = ['--project', projectPath, '--dinkStructure'];
        const compilerCmd = `${compilerPath} ${compilerArgs.join(' ')}\n\n`;
        safeSend(win, 'compile-output', { type: 'command', data: compilerCmd });

        return new Promise((resolve) => {
            const compiler = spawn(compilerPath, compilerArgs);

            compiler.stdout.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stdout', data: data.toString() });
            });

            compiler.stderr.on('data', (data) => {
                safeSend(win, 'compile-output', { type: 'stderr', data: data.toString() });
            });

            compiler.on('error', (error) => {
                safeSend(win, 'compile-output', { type: 'error', data: `Failed to start compiler: ${error.message}\n` });
                safeSend(win, 'compile-complete', { code: -1, destFile: null, exportType: 'word' });
                resolve({ success: false, error: error.message });
            });

            compiler.on('close', (compilerCode) => {
                if (compilerCode !== 0) {
                    safeSend(win, 'compile-output', { type: 'error', data: `\nCompiler failed with exit code ${compilerCode}\n` });
                    safeSend(win, 'compile-complete', { code: compilerCode, destFile: null, exportType: 'word' });
                    resolve({ success: false, error: `Compiler failed with exit code ${compilerCode}` });
                    return;
                }

                // Step 2: Run DinkViewer with --word
                safeSend(win, 'compile-output', { type: 'command', data: '\n\nStep 2: Exporting Word...\n' });
                const viewerArgs = ['--project', projectPath, '--destFile', destFile, '--silent', '--word'];
                const viewerCmd = `${viewerPath} ${viewerArgs.join(' ')}\n\n`;
                safeSend(win, 'compile-output', { type: 'command', data: viewerCmd });

                const viewer = spawn(viewerPath, viewerArgs);

                viewer.stdout.on('data', (data) => {
                    safeSend(win, 'compile-output', { type: 'stdout', data: data.toString() });
                });

                viewer.stderr.on('data', (data) => {
                    safeSend(win, 'compile-output', { type: 'stderr', data: data.toString() });
                });

                viewer.on('error', (error) => {
                    safeSend(win, 'compile-output', { type: 'error', data: `Failed to start viewer: ${error.message}\n` });
                    safeSend(win, 'compile-complete', { code: -1, destFile: null, exportType: 'word' });
                    resolve({ success: false, error: error.message });
                });

                viewer.on('close', (viewerCode) => {
                    safeSend(win, 'compile-complete', { code: viewerCode, destFile: viewerCode === 0 ? destFile : null, exportType: 'word' });
                    resolve({ success: viewerCode === 0, exitCode: viewerCode });
                });
            });
        });
    });

    app.whenReady().then(() => {
        createWindow()
        startBackgroundUpdateCheck()

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow()
            }
        })
    });

    ipcMain.handle('get-viewer-path', async () => {
        return await getViewerPath();
    });

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

        const read = await safeReadText(dictPath);
        if (read.kind === 'broken') {
            // File exists but we can't read it — refuse to overwrite with a
            // one-word file. The user's real dictionary may be recoverable.
            console.error('Refusing to update unreadable dictionary:', read.error);
            dialog.showErrorBox(
                'Project dictionary unreadable',
                `Couldn't read ${dictPath}\n\n${read.error?.message || 'unknown error'}\n\n` +
                `Word not added. Fix or restore the file and try again.`
            );
            return;
        }

        const existing = read.kind === 'ok' ? read.content : '';
        const lines = existing.split('\n').map(l => l.trim()).filter(l => l);
        if (lines.includes(word)) return;
        lines.push(word);

        try {
            vcWriteText(dictPath, lines.join('\n') + '\n');
        } catch (e) {
            console.error('Failed to update dictionary', e);
            dialog.showErrorBox('Failed to update dictionary', e.message);
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
                vcWriteText(dictPath, '');
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

        // Prefer .json, fall back to .jsonc. ENOENT on both → no character file.
        let result = await safeReadJSON(jsonPath, { allowComments: true });
        let triedPath = jsonPath;
        if (result.kind === 'absent') {
            result = await safeReadJSON(jsoncPath, { allowComments: true });
            triedPath = jsoncPath;
        }

        if (result.kind === 'absent') return [];
        if (result.kind === 'broken') {
            console.error('Failed to read/parse characters file', triedPath, result.error);
            dialog.showErrorBox(
                'Characters file is invalid',
                `Couldn't parse ${triedPath}\n\n${result.error?.message || 'unknown error'}\n\n` +
                `Character validation is disabled until this file is fixed.`
            );
            return [];
        }
        return Array.isArray(result.data) ? result.data : [];
    });

    ipcMain.handle('add-project-character', async (event, characterId) => {
        const project = getCurrentProject();
        if (!project) return false;

        const projectDir = path.dirname(project.path);
        const jsonPath = path.join(projectDir, 'characters.json');
        const jsoncPath = path.join(projectDir, 'characters.jsonc');

        // Pick the existing file (.json or .jsonc). If neither exists, write
        // a fresh characters.json.
        let result = await safeReadJSON(jsonPath, { allowComments: true });
        let targetPath = jsonPath;
        if (result.kind === 'absent') {
            const jsoncResult = await safeReadJSON(jsoncPath, { allowComments: true });
            if (jsoncResult.kind !== 'absent') {
                result = jsoncResult;
                targetPath = jsoncPath;
            }
        }

        if (result.kind === 'broken') {
            // Don't overwrite a file we can't parse — that would silently
            // destroy the entire character list.
            console.error('Refusing to add character to broken file', targetPath, result.error);
            dialog.showErrorBox(
                'Characters file is invalid',
                `Couldn't parse ${targetPath}\n\n${result.error?.message || 'unknown error'}\n\n` +
                `Refusing to overwrite. Fix the file manually, then try again.`
            );
            return false;
        }

        const chars = result.kind === 'ok' && Array.isArray(result.data) ? result.data : [];

        if (chars.find(c => c.ID === characterId)) return true;
        chars.push({ ID: characterId, Actor: "" });

        try {
            vcWriteText(targetPath, JSON.stringify(chars, null, 4));
            return true;
        } catch (e) {
            console.error('Failed to add character to project', e);
            dialog.showErrorBox('Failed to add character', e.message);
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
