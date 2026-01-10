import { dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { addToRecentProjects, getProjectSetting, removeFromRecentProjects, setProjectSetting } from './config'

let currentDinkProject = null;
let rebuildMenuCallback = null;

function setMenuRebuildCallback(fn) {
    rebuildMenuCallback = fn;
}

function getCurrentProject() {
    return currentDinkProject;
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


export {
    loadProject,
    createNewProject,
    loadRootInk,
    getCurrentProject,
    setMenuRebuildCallback
}
