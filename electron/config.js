import { app, dialog } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { vcWriteText } from './vc'
import { safeReadJSON } from './safe-read'

// Config persistence
const configPath = path.join(app.getPath('userData'), 'config.json')
const MAX_RECENT_PROJECTS = 10;

const DEFAULT_SETTINGS = () => ({ theme: 'system', recentProjects: [], projectSettings: {}, windowStates: {} });

let settingsCache = null;
let loadPromise = null;
let saveQueue = Promise.resolve();
let debounceTimer = null;
// When the on-disk config exists but couldn't be read/parsed, we fall back to
// defaults so the app stays usable - but we refuse to write the defaults back
// over the (possibly recoverable) original. Cleared only by a successful read.
let isCorrupt = false;
let warnedCorrupt = false;

async function loadSettings() {
    if (settingsCache) return settingsCache;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            const result = await safeReadJSON(configPath);
            if (result.kind === 'ok') {
                settingsCache = result.data;
                isCorrupt = false;
            } else if (result.kind === 'absent') {
                // First run - legitimate, OK to write defaults later.
                settingsCache = DEFAULT_SETTINGS();
                isCorrupt = false;
            } else {
                // File exists but couldn't be read/parsed. Use defaults in
                // memory so the app runs, but block writes so the user's real
                // config isn't overwritten with empty defaults.
                settingsCache = DEFAULT_SETTINGS();
                isCorrupt = true;
                console.error('Config is corrupt; refusing to overwrite:', result.error);
                if (!warnedCorrupt) {
                    warnedCorrupt = true;
                    dialog.showErrorBox(
                        'Settings file could not be read',
                        `Dinky couldn't read its settings file:\n\n${configPath}\n\n` +
                        `Reason: ${result.error?.message || 'unknown error'}\n\n` +
                        `The app will use default settings for this session, but it ` +
                        `will NOT overwrite the existing file. Fix or remove it to ` +
                        `clear this warning.`
                    );
                }
            }
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
        if (isCorrupt) {
            // Don't write defaults over a config we couldn't read - that's how
            // recent projects / window state / per-project settings get wiped.
            console.warn('Skipping settings save: config is marked corrupt.');
            return { ok: false, reason: 'corrupt' };
        }
        try {
            vcWriteText(configPath, JSON.stringify(settingsCache, null, 2));
            return { ok: true };
        } catch (error) {
            console.error('Failed to save settings:', error);
            dialog.showErrorBox('Failed to save settings', error.message);
            return { ok: false, reason: 'write-failed', message: error.message };
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

// Viewer Path Helpers
async function getViewerPath() {
    const isWindows = process.platform === 'win32';
    const executableName = isWindows ? 'DinkViewer.exe' : 'DinkViewer';

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
    getCompilerPath,
    getViewerPath
}
