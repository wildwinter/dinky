import { dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { modify as jsoncModify, applyEdits as jsoncApplyEdits } from 'jsonc-parser'
import { addToRecentProjects, getProjectSetting, removeFromRecentProjects, setProjectSetting } from './config'
import { safeSend } from './utils'
import { vcWriteText, vcDelete, vcRename } from './vc'

let currentDinkProject = null;
let currentInkRoot = null;
let rebuildMenuCallback = null;

// Monotonic revision counter for the ink-file structure. Every structural
// change (load, switch, rename, add include, remove include, etc.) bumps this
// when its 'root-ink-loaded' event is emitted. Sidebar-only refreshes
// (window focus, post-save refresh) carry the rev they were *captured* at,
// so the renderer can drop refreshes that have been overtaken by a more
// recent structural change — avoiding the race where a stale focus refresh
// deletes a file that was just renamed.
let _inkRootRev = 0;
function sendRootInkLoaded(win, files) {
    _inkRootRev++;
    safeSend(win, 'root-ink-loaded', files, _inkRootRev);
}
function getInkRootRev() { return _inkRootRev; }

function setMenuRebuildCallback(fn) {
    rebuildMenuCallback = fn;
}

function getCurrentProject() {
    return currentDinkProject;
}

function getCurrentInkRoot() {
    return currentInkRoot;
}

// When the user opens an Ink file directly (no .dinkproj), we create an
// "adhoc" project. Most project-scoped features (Project Settings, exports,
// recording scripts) need a real .dinkproj — this helper writes one for the
// current adhoc session in place, without reloading the editor, so the user
// keeps any unsaved edits.
async function adoptDinkprojForAdhoc(win, dinkprojPath) {
    if (!currentDinkProject || !currentDinkProject.isAdhoc) {
        throw new Error('No adhoc project to upgrade');
    }
    if (!currentInkRoot) {
        throw new Error('No ink file currently loaded');
    }

    // Refuse to overwrite an existing .dinkproj — pickAnotherName / "Open
    // Project" is the right path if one already exists.
    try {
        await fs.access(dinkprojPath);
        dialog.showErrorBox(
            'Project file already exists',
            `A project file already exists at:\n${dinkprojPath}\n\nPick a different name, or use "Open Project" to open it instead.`
        );
        return false;
    } catch {
        // Good — doesn't exist
    }

    const inkPath = currentInkRoot;

    // Try the template first, fall back to a minimal default.
    const templatePath = path.join(__dirname, '../build/template.dinkproj');
    let projectContent;
    try {
        const templateData = await fs.readFile(templatePath, 'utf-8');
        const jsonContent = templateData.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
        projectContent = JSON.parse(jsonContent);
    } catch {
        projectContent = { destFolder: 'output' };
    }

    // Point `source` at the current ink file, relative to the .dinkproj dir
    // (handles the case where the user picks a different folder for the
    // project file). Forward slashes for cross-platform consistency.
    projectContent.source = path.relative(path.dirname(dinkprojPath), inkPath).replace(/\\/g, '/');

    try {
        vcWriteText(dinkprojPath, JSON.stringify(projectContent, null, 2));
    } catch (e) {
        dialog.showErrorBox('Failed to create project file', e.message);
        return false;
    }

    // Pin the current ink file as this project's preferred root so subsequent
    // opens of the .dinkproj go straight to it.
    await setProjectSetting(dinkprojPath, 'lastInkRoot', inkPath);
    await addToRecentProjects(dinkprojPath);

    // Adopt in place — DON'T reload files. The editor still has the same
    // ink open; we're just upgrading the project metadata around it.
    currentDinkProject = {
        path: dinkprojPath,
        content: projectContent,
        isAdhoc: false
    };

    if (win && !win.isDestroyed()) {
        const projectName = path.basename(dinkprojPath, '.dinkproj');
        const fileName = path.basename(inkPath, '.ink');
        win.setTitle(`Dinky - ${projectName} - ${fileName}`);
    }

    // Renderer: the project state went adhoc → real. No file reload needed;
    // this is purely for UI elements that gate on isAdhoc.
    safeSend(win, 'project-loaded', { hasRoot: true, isAdhoc: false });

    // Rebuild menu so previously-disabled items (Export, Recording Script,
    // Localization, Stats) become enabled.
    if (rebuildMenuCallback) await rebuildMenuCallback(win);

    return true;
}

async function updateProjectConfig(key, value) {
    if (!currentDinkProject || currentDinkProject.isAdhoc) {
        throw new Error('No project loaded or project is adhoc');
    }

    // Update the in-memory config (supports dot notation for nested keys e.g. "dinky.spellCheckerLocale")
    const keys = key.split('.');
    if (keys.length === 1) {
        currentDinkProject.content[key] = value;
    } else {
        let obj = currentDinkProject.content;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) {
                obj[keys[i]] = {};
            }
            obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
    }

    // Write to disk preserving the existing file's comments and formatting.
    // Previously we did JSON.stringify(currentDinkProject.content) which would
    // silently destroy any // or /* */ comments the user had in their
    // .dinkproj. jsonc-parser surgically updates just the key path.
    let rawText = null;
    try {
        rawText = await fs.readFile(currentDinkProject.path, 'utf-8');
    } catch {
        // File doesn't exist yet — fall through to a full write.
    }

    let outputText;
    if (rawText !== null) {
        try {
            const edits = jsoncModify(rawText, keys, value, {
                formattingOptions: { tabSize: 2, insertSpaces: true, eol: '\n' }
            });
            outputText = jsoncApplyEdits(rawText, edits);
        } catch (e) {
            // jsonc-parser couldn't produce an edit (very malformed source) —
            // refuse to write rather than fall back to a destructive overwrite.
            console.error('updateProjectConfig: jsonc-parser failed for', currentDinkProject.path, e);
            throw new Error(`Could not surgically update ${path.basename(currentDinkProject.path)}: ${e.message}`);
        }
    } else {
        outputText = JSON.stringify(currentDinkProject.content, null, 2);
    }

    vcWriteText(currentDinkProject.path, outputText);
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
                    // INCLUDES are always relative to the root Ink file, not the current file
                    const nextAbsPath = path.resolve(rootDir, includePath)
                    await traverse(nextAbsPath)
                }
            }
        } catch (error) {
            // File can't be read (deleted, permission, etc.) — drop it from the
            // list so the sidebar reflects what actually exists on disk. The
            // broken INCLUDE statement will surface as an Ink compile error.
            console.warn('Skipping unreadable ink file:', currentPath, error.message);
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
        currentDinkProject = { path: filePath, content: JSON.parse(jsonContent), isAdhoc: false };

        if (!win.isDestroyed()) {
            win.setTitle(`Dinky - ${path.basename(filePath, '.dinkproj')}`);
        }

        // Update Recent Projects
        await addToRecentProjects(filePath);
        if (rebuildMenuCallback) await rebuildMenuCallback(win); // Rebuild menu to update recent list

        // Auto-load Ink Root logic
        // First check: Last Ink Root loaded for this project (user preference)
        const lastInkRoot = await getProjectSetting(filePath, 'lastInkRoot');
        let inkFileToLoad = null;

        if (lastInkRoot) {
            // Verify it still exists
            try {
                await fs.access(lastInkRoot);
                inkFileToLoad = lastInkRoot;
            } catch {
                // Fallback handled below
            }
        }

        // Second check: "source" in project JSON
        if (!inkFileToLoad && currentDinkProject.content.source) {
            const sourcePath = path.resolve(path.dirname(filePath), currentDinkProject.content.source);
            try {
                await fs.access(sourcePath);
                inkFileToLoad = sourcePath;
            } catch (e) {
                // Fallback handled below
            }
        }

        if (inkFileToLoad) {
            currentInkRoot = inkFileToLoad;
            const files = await loadRootInk(inkFileToLoad);
            sendRootInkLoaded(win, files);
            safeSend(win, 'project-loaded', { hasRoot: true });
        } else {
            safeSend(win, 'project-loaded', { hasRoot: false });
        }

        return true;
    } catch (e) {
        console.error('Failed to open project:', e);
        if (e.message.includes('not found')) {
            // Remove from recent if not found
            await removeFromRecentProjects(filePath);
            if (rebuildMenuCallback) await rebuildMenuCallback(win);
        }
        dialog.showErrorBox('Error', `Failed to open project file.\n${e.message}`);
        return false;
    }
}

async function loadAdhocInkProject(win, inkFilePath) {
    try {
        await fs.access(inkFilePath);

        const fileName = path.basename(inkFilePath);

        // Create a fake project structure
        currentDinkProject = {
            path: inkFilePath, // Use the ink file path as the project path "anchor"
            content: {
                source: fileName
            },
            isAdhoc: true
        };

        if (!win.isDestroyed()) {
            win.setTitle(`Dinky - ${fileName} (Adhoc)`);
        }

        // We don't add adhoc `.ink` files to recent projects in the same way as .dinkproj 
        currentInkRoot = inkFilePath;
        const files = await loadRootInk(inkFilePath);
        sendRootInkLoaded(win, files);

        // We say hasRoot is true because we specifically loaded a root
        safeSend(win, 'project-loaded', { hasRoot: true, isAdhoc: true });

        return true;
    } catch (e) {
        console.error('Failed to open adhoc ink file:', e);
        dialog.showErrorBox('Error', `Failed to open ink file.\n${e.message}`);
        return false;
    }
}



async function switchToInkRoot(win, inkFilePath) {
    if (!currentDinkProject) return false;

    try {
        await fs.access(inkFilePath);

        // Update preference
        await setProjectSetting(currentDinkProject.path, 'lastInkRoot', inkFilePath);

        // Load it
        currentInkRoot = inkFilePath;
        const files = await loadRootInk(inkFilePath);
        sendRootInkLoaded(win, files);
        safeSend(win, 'project-loaded', { hasRoot: true });

        return true;
    } catch (e) {
        console.error('Failed to switch ink root:', e);
        return false;
    }
}

async function createNewProject(win, name, parentPath) {
    if (!name || !parentPath) return false;

    const projectDir = path.join(parentPath, name);
    const projectFile = path.join(projectDir, `${name}.dinkproj`);
    const inkFile = path.join(projectDir, 'main.ink');

    try {
        await fs.mkdir(projectDir, { recursive: true });

        // Refuse to clobber an existing project. mkdir({recursive:true}) above
        // is happy to re-use an existing dir, so without this check we'd blow
        // away any real .dinkproj/main.ink already sitting there.
        const collisions = [];
        try { await fs.access(projectFile); collisions.push(path.basename(projectFile)); } catch {}
        try { await fs.access(inkFile); collisions.push(path.basename(inkFile)); } catch {}
        if (collisions.length > 0) {
            dialog.showErrorBox(
                'Project already exists',
                `Cannot create a new project at:\n\n${projectDir}\n\n` +
                `The following file(s) already exist there:\n${collisions.join('\n')}\n\n` +
                `Pick a different name or location.`
            );
            return false;
        }

        // Load template from build directory
        const templatePath = path.join(__dirname, '../build/template.dinkproj');
        let projectContent;
        try {
            const templateData = await fs.readFile(templatePath, 'utf-8');
            const jsonContent = templateData.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
            projectContent = JSON.parse(jsonContent);
        } catch (templateError) {
            console.warn('Failed to load template, using default:', templateError);
            // Fallback to default structure if template is missing
            projectContent = {
                source: 'main.ink',
                destFolder: 'output'
            };
        }

        vcWriteText(projectFile, JSON.stringify(projectContent, null, 2));

        // Default Ink content
        vcWriteText(inkFile, '// Add Ink content here');

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
}

async function createNewInclude(win, name, folderPath) {
    if (!name || !folderPath || !currentInkRoot) return false;

    // Ensure .ink extension
    const fileName = name.endsWith('.ink') ? name : `${name}.ink`;
    const fullIncludePath = path.join(folderPath, fileName);

    // Refuse to clobber an existing .ink file. `createNewInkRoot` / `createInkRoot`
    // do this check already; this brings the include path in line.
    try {
        await fs.access(fullIncludePath);
        dialog.showErrorBox(
            'Include already exists',
            `A file named "${fileName}" already exists in:\n\n${folderPath}\n\n` +
            `Pick a different name, or use "Add existing include" to reference the existing file.`
        );
        return false;
    } catch {
        // ENOENT — good, path is free
    }

    try {
        // Create file with valid Ink comment
        vcWriteText(fullIncludePath, '// Type Ink here');

        const rootContent = await fs.readFile(currentInkRoot, 'utf-8');
        const relativePath = path.relative(path.dirname(currentInkRoot), fullIncludePath);

        // Ensure forward slashes for cross-platform compatibility in Ink INCLUDE
        const includeLine = `INCLUDE ${relativePath.replace(/\\/g, '/')}`;

        if (rootContent.includes(includeLine)) return true;

        const newContent = insertIncludeIntoContent(rootContent, includeLine);

        vcWriteText(currentInkRoot, newContent);

        const files = await loadRootInk(currentInkRoot);
        sendRootInkLoaded(win, files);

        return true;
    } catch (e) {
        console.error('Failed to add new include:', e);
        dialog.showErrorBox('Error', `Failed to add new include: ${e.message}`);
        return false;
    }
}


async function openInkRootUI(win) {
    const currentProject = getCurrentProject();
    const defaultPath = currentProject ? path.dirname(currentProject.path) : undefined;

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        defaultPath: defaultPath,
        properties: ['openFile'],
        filters: [{ name: 'Ink Files', extensions: ['ink'] }]
    })
    if (!canceled && filePaths.length > 0) {
        const files = await loadRootInk(filePaths[0])
        sendRootInkLoaded(win, files);
        safeSend(win, 'project-loaded', { hasRoot: true });

        // Save as preference if a project is open
        if (currentProject) {
            await setProjectSetting(currentProject.path, 'lastInkRoot', filePaths[0]);
            console.log('Saved Ink Root preference:', filePaths[0]);
        }
    }
}

function openNewIncludeUI(win) {
    if (!currentInkRoot) {
        dialog.showErrorBox('Error', 'No Ink project loaded. Please open a project first.');
        return;
    }
    const defaultFolder = path.dirname(currentInkRoot);
    safeSend(win, 'show-new-include-modal', defaultFolder);
}

async function createInkRoot(win) {
    if (!currentDinkProject) {
        dialog.showErrorBox('Error', 'No project loaded.');
        return false;
    }

    const projectFile = currentDinkProject.path;
    const projectDir = path.dirname(projectFile);
    const inkFile = path.join(projectDir, 'main.ink');

    try {
        // Create main.ink if it doesn't exist
        try {
            await fs.access(inkFile);
            const { response } = await dialog.showMessageBox(win, {
                type: 'warning',
                buttons: ['Cancel', 'Overwrite'],
                defaultId: 0,
                title: 'File Exists',
                message: 'main.ink already exists. Do you want to overwrite it?',
            });
            if (response === 0) return false;
        } catch {
            // File doesn't exist, proceed
        }

        vcWriteText(inkFile, '// Add Ink content here');

        // Update project JSON
        currentDinkProject.content.source = 'main.ink';
        vcWriteText(projectFile, JSON.stringify(currentDinkProject.content, null, 2));

        // Set preference
        await setProjectSetting(projectFile, 'lastInkRoot', inkFile);

        // Load it
        const files = await loadRootInk(inkFile);
        currentInkRoot = inkFile;
        sendRootInkLoaded(win, files);
        safeSend(win, 'project-loaded', { hasRoot: true });

        return true;
    } catch (e) {
        console.error('Failed to create ink root:', e);
        dialog.showErrorBox('Error', `Failed to create ink root: ${e.message}`);
        return false;
    }
}

async function renameInkRoot(win, newName) {
    if (!currentInkRoot || !newName) return false;

    // Ensure .ink extension
    const validName = newName.endsWith('.ink') ? newName : `${newName}.ink`;
    const newPath = path.join(path.dirname(currentInkRoot), validName);

    if (currentInkRoot === newPath) return false;

    try {
        // Check destination
        try {
            await fs.access(newPath);
            dialog.showErrorBox('Error', 'A file with that name already exists.');
            return false;
        } catch {
            // Safe
        }

        // Rename the file, informing VC (git mv / p4 move / svn move as appropriate)
        vcRename(currentInkRoot, newPath);

        // Update Project settings and source if needed
        const oldRootPath = currentInkRoot;
        currentInkRoot = newPath; // Update global tracking first

        if (currentDinkProject) {
            // Update lastInkRoot preference
            await setProjectSetting(currentDinkProject.path, 'lastInkRoot', newPath);

            // Check if source needs update
            if (currentDinkProject.content.source) {
                // Check if the old source points to our old file
                const projectDir = path.dirname(currentDinkProject.path);
                const resolvedSource = path.resolve(projectDir, currentDinkProject.content.source);

                if (resolvedSource === oldRootPath) {
                    // It matched! Update source.
                    // Calculate new relative path for source
                    const newRelativeSource = path.relative(projectDir, newPath);
                    currentDinkProject.content.source = newRelativeSource.replace(/\\/g, '/'); // Normalize slashes

                    // Save proj file
                    vcWriteText(currentDinkProject.path, JSON.stringify(currentDinkProject.content, null, 2));
                }
            }
        }

        // Reload
        const files = await loadRootInk(currentInkRoot);
        sendRootInkLoaded(win, files);

        return true;
    } catch (e) {
        console.error('Failed to rename ink root:', e);
        dialog.showErrorBox('Error', `Failed to rename ink root: ${e.message}`);
        return false;
    }
}

async function createNewInkRoot(win, name, folderPath) {
    if (!currentDinkProject || !name || !folderPath) return false;

    const validName = name.endsWith('.ink') ? name : `${name}.ink`;
    const inkFile = path.join(folderPath, validName);

    try {
        // Create file
        try {
            await fs.access(inkFile);
            dialog.showErrorBox('Error', 'A file with that name already exists.');
            return false;
        } catch {
            // Good
        }

        vcWriteText(inkFile, '// Add Ink content here');

        // Update Project settings and source if needed
        // If we are creating a new root via this UI, we assume the user wants to switch to it

        // Update source in dinkproj if the new file is inside the project directory structure
        const projectDir = path.dirname(currentDinkProject.path);
        const relative = path.relative(projectDir, inkFile);

        // Check if it's actually inside (not starting with ..)
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
            currentDinkProject.content.source = relative.replace(/\\/g, '/');
            vcWriteText(currentDinkProject.path, JSON.stringify(currentDinkProject.content, null, 2));
        }

        // Set preference
        await setProjectSetting(currentDinkProject.path, 'lastInkRoot', inkFile);

        // Load it
        currentInkRoot = inkFile;
        const files = await loadRootInk(inkFile);
        sendRootInkLoaded(win, files);
        safeSend(win, 'project-loaded', { hasRoot: true });

        return true;
    } catch (e) {
        console.error('Failed to create new ink root:', e);
        dialog.showErrorBox('Error', `Failed to create ink root: ${e.message}`);
        return false;
    }
}

function openNewInkRootUI(win) {
    if (!currentDinkProject) {
        dialog.showErrorBox('Error', 'No project loaded.');
        return;
    }
    // Default to project dir
    const defaultFolder = path.dirname(currentDinkProject.path);
    safeSend(win, 'show-new-ink-root-modal', defaultFolder);
}

export {
    loadProject,
    loadAdhocInkProject,
    switchToInkRoot,
    createNewProject,
    loadRootInk,
    getCurrentProject,
    setMenuRebuildCallback,
    getCurrentInkRoot,
    getInkRootRev,
    updateProjectConfig,
    adoptDinkprojForAdhoc,
    createNewInclude,
    openNewIncludeUI,
    openInkRootUI,
    createInkRoot,
    removeInclude,
    chooseExistingInclude,
    renameInclude,
    renameInkRoot,
    createNewInkRoot,
    openNewInkRootUI
}

async function chooseExistingInclude(win) {
    if (!currentInkRoot) {
        dialog.showErrorBox('Error', 'No Ink project loaded.');
        return false;
    }

    const defaultPath = path.dirname(currentInkRoot);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        defaultPath: defaultPath,
        properties: ['openFile'],
        filters: [{ name: 'Ink Files', extensions: ['ink'] }]
    });

    if (canceled || filePaths.length === 0) return false;

    const selectedFile = filePaths[0];

    // Prevent recursive include of root
    if (selectedFile === currentInkRoot) {
        dialog.showErrorBox('Error', 'Cannot include the root file into itself.');
        return false;
    }

    try {
        // Add INCLUDE line
        const rootContent = await fs.readFile(currentInkRoot, 'utf-8');
        const relativePath = path.relative(path.dirname(currentInkRoot), selectedFile);

        // Ensure forward slashes
        const includeLine = `INCLUDE ${relativePath.replace(/\\/g, '/')}`;

        // Check if already included
        if (rootContent.includes(includeLine)) {
            dialog.showMessageBox(win, {
                type: 'info',
                message: 'File is already included.',
            });
            return false;
        }

        const newContent = insertIncludeIntoContent(rootContent, includeLine);

        vcWriteText(currentInkRoot, newContent);

        const files = await loadRootInk(currentInkRoot);
        sendRootInkLoaded(win, files);

        return true;

    } catch (e) {
        console.error('Failed to choose existing include:', e);
        dialog.showErrorBox('Error', `Failed to include file: ${e.message}`);
        return false;
    }
}

async function removeInclude(win, filePathToDelete) {
    if (!currentInkRoot || !filePathToDelete) return false;

    if (filePathToDelete === currentInkRoot) {
        dialog.showErrorBox('Error', 'Cannot remove the main Ink Root file.');
        return false;
    }

    const fileName = path.basename(filePathToDelete);
    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Delete File', 'Remove from Project', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Remove Include',
        message: `What do you want to do with "${fileName}"?`,
        detail: 'Deleting the file will permanently remove it from your disk.\nRemoving it from project will only remove the INCLUDE reference.'
    });

    if (response === 2) { // Cancel
        return false;
    }

    const shouldDeleteFile = (response === 0);

    try {
        // Remove INCLUDE line
        const rootContent = await fs.readFile(currentInkRoot, 'utf-8');
        const lines = rootContent.split(/\r?\n/);
        const relativeToDelete = path.relative(path.dirname(currentInkRoot), filePathToDelete);
        const normalizedRelative = relativeToDelete.replace(/\\/g, '/');

        let entryFound = false;
        const newLines = lines.filter(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('INCLUDE ')) {
                const includePath = trimmed.substring(8).trim();
                const resolvedIncludePath = path.resolve(path.dirname(currentInkRoot), includePath);
                if (resolvedIncludePath === filePathToDelete) {
                    entryFound = true;
                    return false;
                }
            }
            return true;
        });

        if (!entryFound) {
            console.warn('Could not find corresponding INCLUDE line for', normalizedRelative);
        }

        const newContent = newLines.join('\n');
        vcWriteText(currentInkRoot, newContent);

        if (shouldDeleteFile) {
            vcDelete(filePathToDelete);
        }

        const files = await loadRootInk(currentInkRoot);
        sendRootInkLoaded(win, files);

        return true;

    } catch (e) {
        console.error('Failed to remove include:', e);
        dialog.showErrorBox('Error', `Failed to remove include: ${e.message}`);
        return false;
    }
}

async function renameInclude(win, oldPath, newName) {
    if (!currentInkRoot || !oldPath || !newName) return false;

    // Ensure .ink extension
    const validName = newName.endsWith('.ink') ? newName : `${newName}.ink`;
    const newPath = path.join(path.dirname(oldPath), validName);

    if (oldPath === newPath) return false;

    try {
        // Check if destination exists
        try {
            await fs.access(newPath);
            dialog.showErrorBox('Error', 'A file with that name already exists.');
            return false;
        } catch {
            // Good, it doesn't exist
        }

        // Rename the file, informing VC (git mv / p4 move / svn move as appropriate)
        vcRename(oldPath, newPath);

        // Update INCLUDE in Root file
        // We need to find the include line that corresponds to the old relative path
        const rootDir = path.dirname(currentInkRoot);
        const oldRelative = path.relative(rootDir, oldPath).replace(/\\/g, '/');
        const newRelative = path.relative(rootDir, newPath).replace(/\\/g, '/');

        const rootContent = await fs.readFile(currentInkRoot, 'utf-8');
        const lines = rootContent.split(/\r?\n/);

        let updated = false;
        const newLines = lines.map(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('INCLUDE ')) {
                const includePath = trimmed.substring(8).trim();
                // Check if this include path matches our old file
                if (includePath.replace(/\\/g, '/') === oldRelative) {
                    updated = true;
                    return `INCLUDE ${newRelative}`;
                }
            }
            return line;
        });

        if (updated) {
            vcWriteText(currentInkRoot, newLines.join('\n'));
        } else {
            console.warn('Could not find INCLUDE line to update for rename.');
        }

        // Reload project
        const files = await loadRootInk(currentInkRoot);
        sendRootInkLoaded(win, files);

        return true;

    } catch (e) {
        console.error('Failed to rename include:', e);
        dialog.showErrorBox('Error', `Failed to rename file: ${e.message}`);
        return false;
    }
}

/**
 * Helper to insert an INCLUDE line into ink content
 * @param {string} content - Current file content
 * @param {string} includeLine - The full INCLUDE line to insert (e.g. "INCLUDE foo.ink")
 * @returns {string} New content
 */
function insertIncludeIntoContent(content, includeLine) {
    const lines = content.split(/\r?\n/);
    let lastIncludeIdx = -1;

    // Find last existing INCLUDE
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim().startsWith('INCLUDE ')) {
            lastIncludeIdx = i;
        }
    }

    let insertIndex = -1;
    if (lastIncludeIdx !== -1) {
        // After any previous INCLUDE lines
        insertIndex = lastIncludeIdx + 1;
    } else {
        // If none exist, after the first comment
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith('//')) {
                insertIndex = i + 1;
                break;
            }
        }
    }

    // Default to top if no includes or comments found
    if (insertIndex === -1) {
        insertIndex = 0;
    }

    lines.splice(insertIndex, 0, includeLine);
    return lines.join('\n');
}
