const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, value) => callback(value)),
    onProjectLoaded: (callback) => ipcRenderer.on('project-loaded', (_event, value) => callback(value)),
    onThemeUpdated: (callback) => ipcRenderer.on('theme-updated', (_event, value) => callback(value))
})

window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector)
        if (element) element.innerText = text
    }

    for (const type of ['chrome', 'node', 'electron']) {
        replaceText(`${type}-version`, process.versions[type])
    }
})
