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
            currentInkRoot = inkFileToLoad; // Track it
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
}

async function createNewInclude(win, name, folderPath) {
    if (!name || !folderPath || !currentInkRoot) return false;

    // Ensure .ink extension
    const fileName = name.endsWith('.ink') ? name : `${name}.ink`;
    const fullIncludePath = path.join(folderPath, fileName);

    try {
        // 1. Create file with valid Ink comment
        await fs.writeFile(fullIncludePath, '// Type Ink here', 'utf-8');

        // 2. Modify Ink Root to add INCLUDE
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
            // Simple heuristic based on prompt: "after any comment lines"
            // We'll skip lines starting with // or enclosed in /* */
            // But doing robust comment skipping is hard with regex. 
            // Let's just find the first non-comment/non-empty line and insert before it, 
            // OR if file starts with comments, insert after them.

            insertIndex = 0;
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                // Simple check for line comments and empty lines
                if (line.startsWith('//') || line === '') {
                    insertIndex = i + 1;
                } else {
                    // Stop at first non-comment code
                    break;
                }
            }
        }

        lines.splice(insertIndex, 0, includeLine);
        const newContent = lines.join('\n'); // Standardize on \n or preserve? split uses regex so we lose original endings. 
        // Let's use os.EOL or just \n. Ink handles \n fine.

        await fs.writeFile(currentInkRoot, newContent, 'utf-8');

        // 3. Reload project files
        // We can just reload the root ink
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
        dialog.showErrorBox('Error', 'No Ink Root loaded so where should I put the INCLUDE? Please open an Ink file first.');
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
    openNewIncludeUI
}
