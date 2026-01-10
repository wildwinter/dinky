"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("electronAPI", {
  onFileOpened: (callback) => ipcRenderer.on("file-opened", (_event, value) => callback(value)),
  onRootInkLoaded: (callback) => ipcRenderer.on("root-ink-loaded", (_event, value) => callback(value)),
  onSaveAll: (callback) => ipcRenderer.on("save-all", (_event, ...args) => callback(...args)),
  saveFiles: (files) => ipcRenderer.invoke("save-files", files),
  compileInk: (content, filePath, projectFiles) => ipcRenderer.invoke("compile-ink", content, filePath, projectFiles),
  onThemeUpdated: (callback) => ipcRenderer.on("theme-updated", (_event, value) => callback(value)),
  log: (...args) => ipcRenderer.send("renderer-log", ...args),
  openProject: () => ipcRenderer.invoke("open-project"),
  newProject: () => ipcRenderer.invoke("new-project"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  createNewProject: (name, parentPath) => ipcRenderer.invoke("create-new-project", name, parentPath),
  onShowNewProjectModal: (callback) => ipcRenderer.on("show-new-project-modal", (_event, value) => callback(value)),
  createNewInclude: (name, folderPath) => ipcRenderer.invoke("create-new-include", name, folderPath),
  onShowNewIncludeModal: (callback) => ipcRenderer.on("show-new-include-modal", (_event, value) => callback(value))
});
window.addEventListener("DOMContentLoaded", () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };
  for (const type of ["chrome", "node", "electron"]) {
    replaceText(`${type}-version`, process.versions[type]);
  }
});
