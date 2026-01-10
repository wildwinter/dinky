import { dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { addToRecentProjects, getProjectSetting, removeFromRecentProjects, setProjectSetting } from './config'

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
                console.log('Using stored preference for Ink Root:', inkFileToLoad);
            } catch {
                console.log('Stored last Ink Root not found, falling back.');
            }
        }

        // Second check: "source" in project JSON
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
            currentInkRoot = inkFileToLoad;
            const files = await loadRootInk(inkFileToLoad);
            win.webContents.send('root-ink-loaded', files);
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

async function createNewProject(win, name, parentPath) {
    if (!name || !parentPath) return false;

    const projectDir = path.join(parentPath, name);
    const projectFile = path.join(projectDir, `${name}.dinkproj`);
    const inkFile = path.join(projectDir, 'main.ink');

    try {
        await fs.mkdir(projectDir, { recursive: true });

        // Create project JSON with source reference
        const projectContent = {
            source: 'main.ink'
        };
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

        // Modify Ink Root to add INCLUDE
        const rootContent = await fs.readFile(currentInkRoot, 'utf-8');
        const lines = rootContent.split(/\r?\n/);
        const relativePath = path.relative(path.dirname(currentInkRoot), fullIncludePath);

        // Ensure forward slashes for cross-platform compatibility in Ink INCLUDE
        const includeLine = `INCLUDE ${relativePath.replace(/\\/g, '/')}`;

        // Find insertion point
        let insertIndex = -1;

        // Find last existing INCLUDE
        for (let i = lines.length - 1; i >= 0; i--) {
            if (lines[i].trim().startsWith('INCLUDE ')) {
                insertIndex = i + 1;
                break;
            }
        }

        if (insertIndex === -1) {
            // No INCLUDEs found, try to skip header comments
            // We'll skip lines starting with // or enclosed in /* */
            // Simple check for line comments and empty lines

            insertIndex = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.startsWith('//') || line === '') {
                    insertIndex = i + 1;
                } else {
                    // Stop at first non-comment code
                    break;
                }
            }
        }

        lines.splice(insertIndex, 0, includeLine);
        const newContent = lines.join('\n'); // Standardize on \n

        await fs.writeFile(currentInkRoot, newContent, 'utf-8');

        const files = await loadRootInk(currentInkRoot);
        win.webContents.send('root-ink-loaded', files);

        return true;
    } catch (e) {
        console.error('Failed to add new include:', e);
        dialog.showErrorBox('Error', `Failed to add new include: ${e.message}`);
        return false;
    }
}


function openNewIncludeUI(win) {
    if (!currentInkRoot) {
        dialog.showErrorBox('Error', 'No Ink project loaded. Please open a project first.');
        return;
    }
    const defaultFolder = path.dirname(currentInkRoot);
    win.webContents.send('show-new-include-modal', defaultFolder);
}

export {
    loadProject,
    createNewProject,
    loadRootInk,
    getCurrentProject,
    setMenuRebuildCallback,
    getCurrentInkRoot,
    createNewInclude,
    openNewIncludeUI,
    deleteInclude
}

async function deleteInclude(win, filePathToDelete) {
    if (!currentInkRoot || !filePathToDelete) return false;

    // Safety check: cannot delete the root itself
    if (filePathToDelete === currentInkRoot) {
        dialog.showErrorBox('Error', 'Cannot delete the main Ink Root file.');
        return false;
    }

    // Confirmation Dialog
    const fileName = path.basename(filePathToDelete);
    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        title: 'Delete File',
        message: `Are you sure you want to delete file "${fileName}"?`,
        detail: 'This action cannot be undone. The file will be deleted and the INCLUDE line removed from the root file.'
    });

    if (response === 0) { // Cancel (0 since it's the first button)
        return false;
    }

    try {
        // Remove INCLUDE line from Ink Root
        const rootContent = await fs.readFile(currentInkRoot, 'utf-8');
        const lines = rootContent.split(/\r?\n/);

        const relativeToDelete = path.relative(path.dirname(currentInkRoot), filePathToDelete);
        // Normalize slashes for matching
        const normalizedRelative = relativeToDelete.replace(/\\/g, '/');

        let entryFound = false;
        const newLines = lines.filter(line => {
            const trimmed = line.trim();
            if (trimmed.startsWith('INCLUDE ')) {
                const includePath = trimmed.substring(8).trim();

                // Robust check: resolve the include path to absolute path
                // and compare with the file we want to delete
                const resolvedIncludePath = path.resolve(path.dirname(currentInkRoot), includePath);

                if (resolvedIncludePath === filePathToDelete) {
                    entryFound = true;
                    return false; // Remove this line
                }
            }
            return true;
        });
        if (!entryFound) {
            console.warn('Could not find corresponding INCLUDE line for', normalizedRelative);
        }

        const newContent = newLines.join('\n');
        await fs.writeFile(currentInkRoot, newContent, 'utf-8');

        // Delete the file
        await fs.unlink(filePathToDelete);

        // Reload project
        const files = await loadRootInk(currentInkRoot);
        win.webContents.send('root-ink-loaded', files);

        return true;

    } catch (e) {
        console.error('Failed to delete include:', e);
        dialog.showErrorBox('Error', `Failed to delete file: ${e.message}`);
        return false;
    }
}
