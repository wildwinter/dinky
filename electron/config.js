import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'

// Config persistence
const configPath = path.join(app.getPath('userData'), 'config.json')
const MAX_RECENT_PROJECTS = 10;

let settingsCache = null;
let loadPromise = null;
let saveQueue = Promise.resolve();
let debounceTimer = null;

async function loadSettings() {
    if (settingsCache) return settingsCache;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const data = await fs.readFile(configPath, 'utf-8');
            settingsCache = JSON.parse(data);

            return settingsCache;
        } catch (e) {
            settingsCache = { theme: 'system', recentProjects: [], projectSettings: {}, windowStates: {} };
            return settingsCache;
        } finally {
            loadPromise = null;
        }
    })();

    return loadPromise;
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
    await saveSettings(settings); // Debounced by default
}

async function saveSettings(settings, immediate = false) {
    if (!settingsCache) await loadSettings();

    // Deep merge logic
    if (settings.projectSettings) {
        settingsCache.projectSettings = { ...(settingsCache.projectSettings || {}), ...settings.projectSettings };
    }
    if (settings.windowStates) {
        settingsCache.windowStates = { ...(settingsCache.windowStates || {}), ...settings.windowStates };
    }
    // Shallow merge for other keys
    Object.keys(settings).forEach(key => {
        if (key !== 'projectSettings' && key !== 'windowStates') {
            settingsCache[key] = settings[key];
        }
    });

    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }

    if (immediate) {
        return performSave();
    } else {
        return new Promise((resolve) => {
            debounceTimer = setTimeout(() => {
                resolve(performSave());
            }, 500);
        });
    }
}

async function performSave() {
    saveQueue = saveQueue.then(async () => {
        const tmpPath = `${configPath}.tmp`;
        try {
            await fs.writeFile(tmpPath, JSON.stringify(settingsCache, null, 2));
            await fs.rename(tmpPath, configPath);
        } catch (error) {
            console.error('Failed to save settings:', error);
            try { await fs.unlink(tmpPath); } catch { }
        }
    });
    return saveQueue;
}

async function flushSettings() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
        await performSave();
    }
    await saveQueue;
}

async function getWindowState(key) {
    const settings = await loadSettings();
    return settings.windowStates ? settings.windowStates[key] : null;
}

async function saveWindowState(key, bounds) {
    const windowStates = {};
    windowStates[key] = bounds;
    await saveSettings({ windowStates });
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
    await saveSettings({ recentProjects: recent }, true);
}

async function removeFromRecentProjects(filePath) {
    let recent = await getRecentProjects();
    recent = recent.filter(p => p !== filePath);
    await saveSettings({ recentProjects: recent }, true);
}

// Compiler Path Helpers
async function getCompilerPath() {
    const isWindows = process.platform === 'win32';
    const executableName = isWindows ? 'DinkCompiler.exe' : 'DinkCompiler';

    // In production (bundled), resources are in process.resourcesPath
    // In development, we can look in the project root's resources folder
    let basePath;
    if (app.isPackaged) {
        basePath = path.join(process.resourcesPath, 'compiler');
    } else {
        basePath = path.join(process.cwd(), 'resources', 'compiler');
    }

    return path.join(basePath, executableName);
}

export {
    loadSettings,
    saveSettings,
    getProjectSetting,
    setProjectSetting,
    getRecentProjects,
    addToRecentProjects,
    removeFromRecentProjects,
    getWindowState,
    saveWindowState,
    flushSettings,
    getCompilerPath
}
