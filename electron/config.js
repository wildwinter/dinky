import { app } from 'electron'
import path from 'path'
import fs from 'fs/promises'

// Config persistence
const configPath = path.join(app.getPath('userData'), 'config.json')
const MAX_RECENT_PROJECTS = 10;

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

export {
    loadSettings,
    saveSettings,
    getProjectSetting,
    setProjectSetting,
    getRecentProjects,
    addToRecentProjects,
    removeFromRecentProjects
}
