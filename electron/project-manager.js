import { dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { addToRecentProjects, getProjectSetting, removeFromRecentProjects, setProjectSetting } from './config'
import { safeSend } from './utils'

let currentDinkProject = null;
let currentInkRoot = null;
let rebuildMenuCallback = null;

function setMenuRebuildCallback(fn) {
    rebuildMenuCallback = fn;
}

function getCurrentProject() {
    return currentDinkProject;
}

function getCurrentInkRoot() {
    return currentInkRoot;
}

async function updateProjectConfig(key, value) {
    if (!currentDinkProject || currentDinkProject.isAdhoc) {
        throw new Error('No project loaded or project is adhoc');
    }

    // Update the in-memory config
    currentDinkProject.content[key] = value;

    // Write to disk
    await fs.writeFile(currentDinkProject.path, JSON.stringify(currentDinkProject.content, null, 2), 'utf-8');
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
            console.error('Error loading ink file:', currentPath, error);
            // Still add it to list if possible? No, we can't get content.
            // Maybe add a placeholder?
            files.push({
                absolutePath: currentPath,
                relativePath: path.relative(rootDir, currentPath) || path.basename(currentPath),
                content: `// Error reading file: ${error.message}`,
                error: true
            });
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
            safeSend(win, 'root-ink-loaded', files);
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
        safeSend(win, 'root-ink-loaded', files);

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
        safeSend(win, 'root-ink-loaded', files);
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

        // Load template from build directory
        const templatePath = path.join(__dirname, '../build/template.dinkproj');
        let projectContent;
        try {
            const templateData = await fs.readFile(templatePath, 'utf-8');
            projectContent = JSON.parse(templateData);
        } catch (templateError) {
            console.warn('Failed to load template, using default:', templateError);
            // Fallback to default structure if template is missing
            projectContent = {
                source: 'main.ink',
                destFolder: 'output'
            };
        }

        await fs.writeFile(projectFile, JSON.stringify(projectContent, null, 2), 'utf-8');

        // Default Ink content
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
}

async function createNewInclude(win, name, folderPath) {
    if (!name || !folderPath || !currentInkRoot) return false;

    // Ensure .ink extension
    const fileName = name.endsWith('.ink') ? name : `${name}.ink`;
    const fullIncludePath = path.join(folderPath, fileName);

    try {
        // Create file with valid Ink comment
        await fs.writeFile(fullIncludePath, '// Type Ink here', 'utf-8');

        const rootContent = await fs.readFile(currentInkRoot, 'utf-8');
        const relativePath = path.relative(path.dirname(currentInkRoot), fullIncludePath);

        // Ensure forward slashes for cross-platform compatibility in Ink INCLUDE
        const includeLine = `INCLUDE ${relativePath.replace(/\\/g, '/')}`;

        const newContent = insertIncludeIntoContent(rootContent, includeLine);

        await fs.writeFile(currentInkRoot, newContent, 'utf-8');

        const files = await loadRootInk(currentInkRoot);
        safeSend(win, 'root-ink-loaded', files);

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
        safeSend(win, 'root-ink-loaded', files)
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

        await fs.writeFile(inkFile, '// Add Ink content here', 'utf-8');

        // Update project JSON
        currentDinkProject.content.source = 'main.ink';
        await fs.writeFile(projectFile, JSON.stringify(currentDinkProject.content, null, 2), 'utf-8');

        // Set preference
        await setProjectSetting(projectFile, 'lastInkRoot', inkFile);

        // Load it
        const files = await loadRootInk(inkFile);
        currentInkRoot = inkFile;
        safeSend(win, 'root-ink-loaded', files);
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

        // Rename file
        await fs.rename(currentInkRoot, newPath);

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
                    await fs.writeFile(currentDinkProject.path, JSON.stringify(currentDinkProject.content, null, 2), 'utf-8');
                }
            }
        }

        // Reload
        const files = await loadRootInk(currentInkRoot);
        safeSend(win, 'root-ink-loaded', files);

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

        await fs.writeFile(inkFile, '// Add Ink content here', 'utf-8');

        // Update Project settings and source if needed
        // If we are creating a new root via this UI, we assume the user wants to switch to it

        // Update source in dinkproj if the new file is inside the project directory structure
        const projectDir = path.dirname(currentDinkProject.path);
        const relative = path.relative(projectDir, inkFile);

        // Check if it's actually inside (not starting with ..)
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
            currentDinkProject.content.source = relative.replace(/\\/g, '/');
            await fs.writeFile(currentDinkProject.path, JSON.stringify(currentDinkProject.content, null, 2), 'utf-8');
        }

        // Set preference
        await setProjectSetting(currentDinkProject.path, 'lastInkRoot', inkFile);

        // Load it
        currentInkRoot = inkFile;
        const files = await loadRootInk(inkFile);
        safeSend(win, 'root-ink-loaded', files);
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
    updateProjectConfig,
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

        await fs.writeFile(currentInkRoot, newContent, 'utf-8');

        const files = await loadRootInk(currentInkRoot);
        safeSend(win, 'root-ink-loaded', files);

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
        await fs.writeFile(currentInkRoot, newContent, 'utf-8');

        if (shouldDeleteFile) {
            await fs.unlink(filePathToDelete);
        }

        const files = await loadRootInk(currentInkRoot);
        safeSend(win, 'root-ink-loaded', files);

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

        // Rename physical file
        await fs.rename(oldPath, newPath);

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
            await fs.writeFile(currentInkRoot, newLines.join('\n'), 'utf-8');
        } else {
            console.warn('Could not find INCLUDE line to update for rename.');
        }

        // Reload project
        const files = await loadRootInk(currentInkRoot);
        safeSend(win, 'root-ink-loaded', files);

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
