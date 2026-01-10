"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const inkjs = require("inkjs/full");
const configPath = path.join(electron.app.getPath("userData"), "config.json");
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
      const data = await fs.readFile(configPath, "utf-8");
      settingsCache = JSON.parse(data);
      return settingsCache;
    } catch (e) {
      settingsCache = { theme: "system", recentProjects: [], projectSettings: {}, windowStates: {} };
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
  await saveSettings(settings);
}
async function saveSettings(settings, immediate = false) {
  if (!settingsCache) await loadSettings();
  if (settings.projectSettings) {
    settingsCache.projectSettings = { ...settingsCache.projectSettings || {}, ...settings.projectSettings };
  }
  if (settings.windowStates) {
    settingsCache.windowStates = { ...settingsCache.windowStates || {}, ...settings.windowStates };
  }
  Object.keys(settings).forEach((key) => {
    if (key !== "projectSettings" && key !== "windowStates") {
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
      console.error("Failed to save settings:", error);
      try {
        await fs.unlink(tmpPath);
      } catch {
      }
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
async function getRecentProjects() {
  const settings = await loadSettings();
  return settings.recentProjects || [];
}
async function addToRecentProjects(filePath) {
  let recent = await getRecentProjects();
  recent = recent.filter((p) => p !== filePath);
  recent.unshift(filePath);
  if (recent.length > MAX_RECENT_PROJECTS) {
    recent = recent.slice(0, MAX_RECENT_PROJECTS);
  }
  await saveSettings({ recentProjects: recent }, true);
}
async function removeFromRecentProjects(filePath) {
  let recent = await getRecentProjects();
  recent = recent.filter((p) => p !== filePath);
  await saveSettings({ recentProjects: recent }, true);
}
function safeSend(win, channel, ...args) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args);
    return true;
  }
  return false;
}
let currentDinkProject = null;
let currentInkRoot = null;
let rebuildMenuCallback = null;
function setMenuRebuildCallback(fn) {
  rebuildMenuCallback = fn;
}
function getCurrentProject() {
  return currentDinkProject;
}
async function loadRootInk(rootFilePath) {
  const rootDir = path.dirname(rootFilePath);
  const files = [];
  const visited = /* @__PURE__ */ new Set();
  async function traverse(currentPath) {
    if (visited.has(currentPath)) return;
    visited.add(currentPath);
    try {
      const content = await fs.readFile(currentPath, { encoding: "utf-8" });
      const relativePath = path.relative(rootDir, currentPath);
      files.push({
        absolutePath: currentPath,
        relativePath: relativePath === "" ? path.basename(currentPath) : relativePath,
        content
      });
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const match = line.match(/^\s*INCLUDE\s+(.+)/);
        if (match) {
          const includePath = match[1].trim();
          const nextAbsPath = path.resolve(path.dirname(currentPath), includePath);
          await traverse(nextAbsPath);
        }
      }
    } catch (error) {
      console.error(`Failed to load file ${currentPath}:`, error);
    }
  }
  await traverse(rootFilePath);
  return files;
}
async function loadProject(win, filePath) {
  try {
    try {
      await fs.access(filePath);
    } catch {
      throw new Error(`Project file not found: ${filePath}`);
    }
    const content = await fs.readFile(filePath, "utf-8");
    const jsonContent = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    currentDinkProject = { path: filePath, content: JSON.parse(jsonContent) };
    if (!win.isDestroyed()) {
      win.setTitle(`Dinky - ${path.basename(filePath, ".dinkproj")}`);
    }
    await addToRecentProjects(filePath);
    if (rebuildMenuCallback) await rebuildMenuCallback(win);
    const lastInkRoot = await getProjectSetting(filePath, "lastInkRoot");
    let inkFileToLoad = null;
    if (lastInkRoot) {
      try {
        await fs.access(lastInkRoot);
        inkFileToLoad = lastInkRoot;
      } catch {
      }
    }
    if (!inkFileToLoad && currentDinkProject.content.source) {
      const sourcePath = path.resolve(path.dirname(filePath), currentDinkProject.content.source);
      try {
        await fs.access(sourcePath);
        inkFileToLoad = sourcePath;
      } catch (e) {
      }
    }
    if (inkFileToLoad) {
      currentInkRoot = inkFileToLoad;
      const files = await loadRootInk(inkFileToLoad);
      safeSend(win, "root-ink-loaded", files);
      safeSend(win, "project-loaded", { hasRoot: true });
    } else {
      safeSend(win, "project-loaded", { hasRoot: false });
    }
    return true;
  } catch (e) {
    console.error("Failed to open project:", e);
    if (e.message.includes("not found")) {
      await removeFromRecentProjects(filePath);
      if (rebuildMenuCallback) await rebuildMenuCallback(win);
    }
    electron.dialog.showErrorBox("Error", `Failed to open project file.
${e.message}`);
    return false;
  }
}
async function createNewProject(win, name, parentPath) {
  if (!name || !parentPath) return false;
  const projectDir = path.join(parentPath, name);
  const projectFile = path.join(projectDir, `${name}.dinkproj`);
  const inkFile = path.join(projectDir, "main.ink");
  try {
    await fs.mkdir(projectDir, { recursive: true });
    const projectContent = {
      source: "main.ink"
    };
    await fs.writeFile(projectFile, JSON.stringify(projectContent, null, 2), "utf-8");
    await fs.writeFile(inkFile, "// Add Ink content here", "utf-8");
    await setProjectSetting(projectFile, "lastInkRoot", inkFile);
    await loadProject(win, projectFile);
    return true;
  } catch (e) {
    console.error("Failed to create new project:", e);
    electron.dialog.showErrorBox("Error", `Failed to create new project: ${e.message}`);
    return false;
  }
}
async function createNewInclude(win, name, folderPath) {
  if (!name || !folderPath || !currentInkRoot) return false;
  const fileName = name.endsWith(".ink") ? name : `${name}.ink`;
  const fullIncludePath = path.join(folderPath, fileName);
  try {
    await fs.writeFile(fullIncludePath, "// Type Ink here", "utf-8");
    const rootContent = await fs.readFile(currentInkRoot, "utf-8");
    const lines = rootContent.split(/\r?\n/);
    const relativePath = path.relative(path.dirname(currentInkRoot), fullIncludePath);
    const includeLine = `INCLUDE ${relativePath.replace(/\\/g, "/")}`;
    let insertIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().startsWith("INCLUDE ")) {
        insertIndex = i + 1;
        break;
      }
    }
    if (insertIndex === -1) {
      insertIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("//") || line === "") {
          insertIndex = i + 1;
        } else {
          break;
        }
      }
    }
    lines.splice(insertIndex, 0, includeLine);
    const newContent = lines.join("\n");
    await fs.writeFile(currentInkRoot, newContent, "utf-8");
    const files = await loadRootInk(currentInkRoot);
    safeSend(win, "root-ink-loaded", files);
    return true;
  } catch (e) {
    console.error("Failed to add new include:", e);
    electron.dialog.showErrorBox("Error", `Failed to add new include: ${e.message}`);
    return false;
  }
}
async function openInkRootUI$1(win) {
  const currentProject = getCurrentProject();
  const defaultPath = currentProject ? path.dirname(currentProject.path) : void 0;
  const { canceled, filePaths } = await electron.dialog.showOpenDialog(win, {
    defaultPath,
    properties: ["openFile"],
    filters: [{ name: "Ink Files", extensions: ["ink"] }]
  });
  if (!canceled && filePaths.length > 0) {
    const files = await loadRootInk(filePaths[0]);
    safeSend(win, "root-ink-loaded", files);
    safeSend(win, "project-loaded", { hasRoot: true });
    if (currentProject) {
      await setProjectSetting(currentProject.path, "lastInkRoot", filePaths[0]);
      console.log("Saved Ink Root preference:", filePaths[0]);
    }
  }
}
function openNewIncludeUI(win) {
  if (!currentInkRoot) {
    electron.dialog.showErrorBox("Error", "No Ink project loaded. Please open a project first.");
    return;
  }
  const defaultFolder = path.dirname(currentInkRoot);
  safeSend(win, "show-new-include-modal", defaultFolder);
}
async function createInkRoot(win) {
  if (!currentDinkProject) {
    electron.dialog.showErrorBox("Error", "No project loaded.");
    return false;
  }
  const projectFile = currentDinkProject.path;
  const projectDir = path.dirname(projectFile);
  const inkFile = path.join(projectDir, "main.ink");
  try {
    try {
      await fs.access(inkFile);
      const { response } = await electron.dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Cancel", "Overwrite"],
        defaultId: 0,
        title: "File Exists",
        message: "main.ink already exists. Do you want to overwrite it?"
      });
      if (response === 0) return false;
    } catch {
    }
    await fs.writeFile(inkFile, "// Add Ink content here", "utf-8");
    currentDinkProject.content.source = "main.ink";
    await fs.writeFile(projectFile, JSON.stringify(currentDinkProject.content, null, 2), "utf-8");
    await setProjectSetting(projectFile, "lastInkRoot", inkFile);
    const files = await loadRootInk(inkFile);
    currentInkRoot = inkFile;
    safeSend(win, "root-ink-loaded", files);
    safeSend(win, "project-loaded", { hasRoot: true });
    return true;
  } catch (e) {
    console.error("Failed to create ink root:", e);
    electron.dialog.showErrorBox("Error", `Failed to create ink root: ${e.message}`);
    return false;
  }
}
async function deleteInclude(win, filePathToDelete) {
  if (!currentInkRoot || !filePathToDelete) return false;
  if (filePathToDelete === currentInkRoot) {
    electron.dialog.showErrorBox("Error", "Cannot delete the main Ink Root file.");
    return false;
  }
  const fileName = path.basename(filePathToDelete);
  const { response } = await electron.dialog.showMessageBox(win, {
    type: "question",
    buttons: ["Cancel", "Delete"],
    defaultId: 0,
    title: "Delete File",
    message: `Are you sure you want to delete file "${fileName}"?`,
    detail: "This action cannot be undone. The file will be deleted and the INCLUDE line removed from the root file."
  });
  if (response === 0) {
    return false;
  }
  try {
    const rootContent = await fs.readFile(currentInkRoot, "utf-8");
    const lines = rootContent.split(/\r?\n/);
    const relativeToDelete = path.relative(path.dirname(currentInkRoot), filePathToDelete);
    const normalizedRelative = relativeToDelete.replace(/\\/g, "/");
    let entryFound = false;
    const newLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("INCLUDE ")) {
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
      console.warn("Could not find corresponding INCLUDE line for", normalizedRelative);
    }
    const newContent = newLines.join("\n");
    await fs.writeFile(currentInkRoot, newContent, "utf-8");
    await fs.unlink(filePathToDelete);
    const files = await loadRootInk(currentInkRoot);
    safeSend(win, "root-ink-loaded", files);
    return true;
  } catch (e) {
    console.error("Failed to delete include:", e);
    electron.dialog.showErrorBox("Error", `Failed to delete file: ${e.message}`);
    return false;
  }
}
function createFileHandler(filePath, projectFiles) {
  return {
    ResolveInkFilename: (filename) => {
      const baseDir = filePath ? path.dirname(filePath) : process.cwd();
      return path.resolve(baseDir, filename);
    },
    LoadInkFileContents: (filename) => {
      if (projectFiles && projectFiles[filename]) {
        let val = projectFiles[filename];
        if (val && typeof val === "string" && val.charCodeAt(0) === 65279) {
          val = val.slice(1);
        }
        return val;
      }
      try {
        return fsSync.readFileSync(filename, "utf-8");
      } catch (e) {
        console.error("Failed to load included file:", filename, e);
        return "";
      }
    }
  };
}
async function compileInk(content, filePath, projectFiles = {}) {
  if (content && typeof content === "string" && content.charCodeAt(0) === 65279) {
    content = content.slice(1);
  }
  const collectedErrors = [];
  let parseError = null;
  try {
    const fileHandler = createFileHandler(filePath, projectFiles);
    const errorHandler = (message, errorType) => {
      collectedErrors.push(message);
    };
    let options;
    if (inkjs.CompilerOptions) {
      options = new inkjs.CompilerOptions(
        filePath,
        // sourceFilename passed for better context
        [],
        // pluginNames
        false,
        // countAllVisits
        errorHandler,
        fileHandler
      );
    } else {
      options = {
        sourceFilename: filePath,
        fileHandler,
        errorHandler
      };
    }
    const compiler = new inkjs.Compiler(content, options);
    compiler.Compile();
  } catch (error) {
    if (collectedErrors.length === 0) {
      console.error("Compilation failed (unexpected):", error);
    }
    parseError = error;
  }
  const errors = collectedErrors.map((errStr) => {
    const severity = errStr.includes("WARNING") ? 4 : 8;
    const parts = errStr.match(/^(?:ERROR: )?(?:'([^']+)' )?line (\d+): (.+)/i);
    if (parts) {
      const [, errFilePath, lineStr, msg] = parts;
      const line = parseInt(lineStr);
      return {
        startLineNumber: line,
        endLineNumber: line,
        startColumn: 1,
        endColumn: 1e3,
        message: msg,
        severity,
        filePath: errFilePath || null
      };
    }
    return {
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 1,
      endColumn: 1e3,
      message: errStr,
      severity,
      filePath: null
    };
  });
  if (errors.length > 0) return errors;
  if (parseError) {
    let errorLine = 1;
    let errorMsg = "Compiler Error: " + parseError.message;
    if (parseError.message.includes("not a function") || parseError.message.includes("undefined")) {
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === "~") {
          errorLine = i + 1;
          errorMsg = "Syntax Error: Incomplete logic line. '~' must be followed by code.";
          break;
        }
      }
    }
    return [{
      startLineNumber: errorLine,
      endLineNumber: errorLine,
      startColumn: 1,
      endColumn: 1e3,
      message: errorMsg,
      severity: 8
    }];
  }
  return [];
}
async function compileStory(content, filePath, projectFiles = {}) {
  if (content && typeof content === "string" && content.charCodeAt(0) === 65279) {
    content = content.slice(1);
  }
  const collectedErrors = [];
  const fileHandler = createFileHandler(filePath, projectFiles);
  const errorHandler = (message) => {
    collectedErrors.push(message);
  };
  let options;
  if (inkjs.CompilerOptions) {
    options = new inkjs.CompilerOptions(
      filePath,
      [],
      false,
      errorHandler,
      fileHandler
    );
  } else {
    options = {
      sourceFilename: filePath,
      fileHandler,
      errorHandler
    };
  }
  const compiler = new inkjs.Compiler(content, options);
  const story = compiler.Compile();
  if (!story) {
    throw new Error("Compilation failed: " + collectedErrors.join("\n"));
  }
  return story.ToJson();
}
let testWindow = null;
async function openTestWindow(rootPath, projectFiles) {
  if (testWindow) {
    testWindow.show();
    testWindow.focus();
    if (rootPath && projectFiles) {
      await runTestSequence(rootPath, projectFiles);
    }
    await saveSettings({ testWindowOpen: true });
    return;
  }
  const windowState = await getWindowState("test");
  testWindow = new electron.BrowserWindow({
    title: "Test",
    width: (windowState == null ? void 0 : windowState.width) || 800,
    height: (windowState == null ? void 0 : windowState.height) || 600,
    x: windowState == null ? void 0 : windowState.x,
    y: windowState == null ? void 0 : windowState.y,
    backgroundColor: electron.nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  });
  const updateTheme = () => {
    const theme = electron.nativeTheme.shouldUseDarkColors ? "vs-dark" : "vs";
    const sent = safeSend(testWindow, "theme-updated", theme);
    if (sent) {
      testWindow.setBackgroundColor(electron.nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff");
    }
  };
  const themeListener = () => updateTheme();
  electron.nativeTheme.on("updated", themeListener);
  testWindow.on("move", () => saveWindowState("test", testWindow.getBounds()));
  testWindow.on("resize", () => saveWindowState("test", testWindow.getBounds()));
  testWindow.on("closed", async () => {
    electron.nativeTheme.off("updated", themeListener);
    testWindow = null;
    await saveSettings({ testWindowOpen: false });
    electron.ipcMain.emit("rebuild-menu");
  });
  testWindow.once("ready-to-show", async () => {
    testWindow.show();
    await saveSettings({ testWindowOpen: true });
    electron.ipcMain.emit("rebuild-menu");
  });
  testWindow.webContents.on("did-finish-load", async () => {
    updateTheme();
    if (rootPath && projectFiles) {
      await runTestSequence(rootPath, projectFiles);
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    await testWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}test-window.html`);
  } else {
    const indexPath = path.join(__dirname, "../dist/test-window.html");
    await testWindow.loadFile(indexPath).catch((e) => console.error("Failed to load test-window.html:", e));
  }
}
async function runTestSequence(rootPath, projectFiles) {
  if (!testWindow || testWindow.isDestroyed()) return;
  const rootContent = projectFiles[rootPath];
  if (!rootContent) {
    console.error("Root file content not found for path:", rootPath);
    return;
  }
  try {
    const storyJson = await compileStory(rootContent, rootPath, projectFiles);
    safeSend(testWindow, "start-story", storyJson);
  } catch (e) {
    console.error("Test compilation failed:", e);
    safeSend(testWindow, "compilation-error", e.message);
  }
}
let searchWindow = null;
let mainWindow$1 = null;
function initSearch(win) {
  mainWindow$1 = win;
  electron.ipcMain.on("open-search-window", () => {
    openSearchWindow();
  });
  electron.ipcMain.handle("perform-search", async (event, { query, caseSensitive }) => {
    return await new Promise((resolve) => {
      const sent = safeSend(mainWindow$1, "request-search-results", { query, caseSensitive });
      if (!sent) return resolve([]);
      electron.ipcMain.once("search-results-ready", (_event, results) => {
        resolve(results);
      });
    });
  });
  electron.ipcMain.on("navigate-to-result", (event, { path: path2, line, query }) => {
    safeSend(mainWindow$1, "navigate-to-match", { path: path2, line, query });
  });
  electron.ipcMain.handle("perform-replace-all", async (event, { query, replacement, caseSensitive }) => {
    return await new Promise((resolve) => {
      const sent = safeSend(mainWindow$1, "request-replace-all", { query, replacement, caseSensitive });
      if (!sent) return resolve(0);
      electron.ipcMain.once("replace-all-complete", (_event, count) => {
        resolve(count);
      });
    });
  });
}
async function openSearchWindow() {
  if (searchWindow && !searchWindow.isDestroyed()) {
    searchWindow.show();
    searchWindow.focus();
    safeSend(searchWindow, "focus-search-input");
    await saveSettings({ searchWindowOpen: true });
    return;
  }
  const currentWindow = mainWindow$1;
  if (currentWindow) {
    const [winX, winY] = currentWindow.getPosition();
    const [winW, winH] = currentWindow.getSize();
  }
  const windowState = await getWindowState("search");
  searchWindow = new electron.BrowserWindow({
    title: "Find In Files",
    width: (windowState == null ? void 0 : windowState.width) || 400,
    height: (windowState == null ? void 0 : windowState.height) || 500,
    x: windowState == null ? void 0 : windowState.x,
    y: windowState == null ? void 0 : windowState.y,
    type: "panel",
    parent: mainWindow$1,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    frame: true,
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 10, y: 10 },
    resizable: true,
    alwaysOnTop: true,
    backgroundColor: electron.nativeTheme.shouldUseDarkColors ? "#252526" : "#f3f3f3",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    },
    show: false
  });
  const updateTheme = () => {
    const theme = electron.nativeTheme.shouldUseDarkColors ? "vs-dark" : "vs";
    const sent = safeSend(searchWindow, "theme-updated", theme);
    if (sent) {
      searchWindow.setBackgroundColor(electron.nativeTheme.shouldUseDarkColors ? "#252526" : "#f3f3f3");
    }
  };
  const themeListener = () => updateTheme();
  electron.nativeTheme.on("updated", themeListener);
  searchWindow.on("move", () => saveWindowState("search", searchWindow.getBounds()));
  searchWindow.on("resize", () => saveWindowState("search", searchWindow.getBounds()));
  searchWindow.on("closed", async () => {
    electron.nativeTheme.off("updated", themeListener);
    searchWindow = null;
    safeSend(mainWindow$1, "clear-search-highlights");
    await saveSettings({ searchWindowOpen: false });
    if (mainWindow$1) await safeSend(mainWindow$1, "rebuild-menu");
  });
  searchWindow.once("ready-to-show", async () => {
    searchWindow.show();
    updateTheme();
    await saveSettings({ searchWindowOpen: true });
    if (mainWindow$1) await safeSend(mainWindow$1, "rebuild-menu");
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    searchWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}search.html`);
  } else {
    const indexPath = path.join(__dirname, "../dist/search.html");
    searchWindow.loadFile(indexPath).catch((e) => console.error("Failed to load search.html:", e));
  }
}
async function buildMenu(win) {
  const recentProjects = await getRecentProjects();
  const isMac = process.platform === "darwin";
  const recentMenu = recentProjects.length > 0 ? recentProjects.map((p) => ({
    label: path.basename(p),
    click: () => loadProject(win, p)
  })) : [{ label: "No Recent Projects", enabled: false }];
  if (recentProjects.length > 0) {
    recentMenu.push({ type: "separator" });
    recentMenu.push({
      label: "Clear Recently Opened",
      click: async () => {
        await saveSettings({ recentProjects: [] });
        await buildMenu(win);
      }
    });
  }
  const template = [
    ...isMac ? [{
      label: electron.app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    }] : [],
    {
      label: "File",
      submenu: [
        {
          label: "New Project...",
          click: async () => {
            safeSend(win, "show-new-project-modal");
          }
        },
        {
          label: "Open Project...",
          click: async () => {
            const { canceled, filePaths } = await electron.dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [{ name: "Dink Project", extensions: ["dinkproj"] }]
            });
            if (!canceled && filePaths.length > 0) {
              await loadProject(win, filePaths[0]);
            }
          }
        },
        {
          label: "Open Recent Project",
          submenu: recentMenu
        },
        { type: "separator" },
        {
          label: "Open Ink Root...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            await openInkRootUI(win);
          }
        },
        {
          label: "Add New Include...",
          click: async () => {
            openNewIncludeUI(win);
          }
        },
        { label: "Save", accelerator: isMac ? "Cmd+S" : "Ctrl+S", click: async () => {
          safeSend(win, "save-all");
        } },
        ...isMac ? [] : [{ role: "quit" }]
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Find", accelerator: "CmdOrCtrl+F", click: (menuItem, browserWindow) => {
          safeSend(browserWindow, "menu-find");
        } },
        { label: "Replace", accelerator: "CmdOrCtrl+Alt+F", click: (menuItem, browserWindow) => {
          safeSend(browserWindow, "menu-replace");
        } },
        { type: "separator" },
        { label: "Find In Files", accelerator: "CmdOrCtrl+Shift+F", click: () => {
          openSearchWindow();
        } },
        { label: "Replace In Files", accelerator: "CmdOrCtrl+Shift+H", click: () => {
          openSearchWindow();
        } }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        {
          label: "Theme",
          submenu: [
            {
              label: "System",
              type: "radio",
              checked: electron.nativeTheme.themeSource === "system",
              click: () => {
                electron.nativeTheme.themeSource = "system";
                saveSettings({ theme: "system" });
              }
            },
            {
              label: "Light",
              type: "radio",
              checked: electron.nativeTheme.themeSource === "light",
              click: () => {
                electron.nativeTheme.themeSource = "light";
                saveSettings({ theme: "light" });
              }
            },
            {
              label: "Dark",
              type: "radio",
              checked: electron.nativeTheme.themeSource === "dark",
              click: () => {
                electron.nativeTheme.themeSource = "dark";
                saveSettings({ theme: "dark" });
              }
            }
          ]
        },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Test",
      submenu: [
        {
          label: "Start Test",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            safeSend(win, "trigger-start-test");
          }
        }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...isMac ? [
          { type: "separator" },
          { role: "front" },
          { type: "separator" }
        ] : [
          { role: "close" },
          { type: "separator" }
        ],
        ...electron.BrowserWindow.getAllWindows().map((w, index) => ({
          label: w.getTitle() || `Window ${index + 1}`,
          accelerator: isMac ? `Cmd+${index + 1}` : `Ctrl+${index + 1}`,
          click: () => {
            if (w.isMinimized()) w.restore();
            w.show();
            w.focus();
          }
        }))
      ]
    }
  ];
  const menu = electron.Menu.buildFromTemplate(template);
  electron.Menu.setApplicationMenu(menu);
}
electron.app.setName("Dinky");
setMenuRebuildCallback(buildMenu);
let mainWindow = null;
async function createWindow() {
  const settings = await loadSettings();
  electron.nativeTheme.themeSource = settings.theme || "system";
  const windowState = await getWindowState("main");
  const win = new electron.BrowserWindow({
    title: "Dinky",
    width: (windowState == null ? void 0 : windowState.width) || 800,
    height: (windowState == null ? void 0 : windowState.height) || 600,
    x: windowState == null ? void 0 : windowState.x,
    y: windowState == null ? void 0 : windowState.y,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  mainWindow = win;
  initSearch(win);
  await buildMenu(win);
  electron.ipcMain.emit("rebuild-menu");
  const updateTheme = () => {
    const theme = electron.nativeTheme.shouldUseDarkColors ? "vs-dark" : "vs";
    safeSend(win, "theme-updated", theme);
  };
  electron.nativeTheme.on("updated", updateTheme);
  win.webContents.on("did-finish-load", async () => {
    updateTheme();
    const recent = await getRecentProjects();
    if (recent.length > 0) {
      const lastProject = recent[0];
      try {
        await fs.access(lastProject);
        console.log("Auto-loading last project:", lastProject);
        await loadProject(win, lastProject);
        const currentSettings = await loadSettings();
        if (currentSettings.searchWindowOpen) {
          await openSearchWindow();
        }
        if (currentSettings.testWindowOpen) {
          safeSend(win, "trigger-start-test");
        }
      } catch (e) {
        console.log("Last project not found or invalid, removing from history:", lastProject);
        await removeFromRecentProjects(lastProject);
        await buildMenu(win);
      }
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    win.loadFile(indexPath).catch((e) => console.error("Failed to load index.html:", e));
  }
  win.forceClose = false;
  win.on("move", () => saveWindowState("main", win.getBounds()));
  win.on("resize", () => saveWindowState("main", win.getBounds()));
  win.on("close", (e) => {
    if (win.forceClose) return;
    if (win.webContents.isDestroyed()) return;
    e.preventDefault();
    safeSend(win, "check-unsaved");
  });
}
electron.ipcMain.on("unsaved-status", (event, hasUnsaved) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (!hasUnsaved) {
    win.forceClose = true;
    win.close();
  } else {
    const choice = electron.dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Save", "Discard", "Cancel"],
      defaultId: 0,
      title: "Unsaved Changes",
      message: "Do you want to save the changes you made in the project?",
      detail: "Your changes will be lost if you don't save them.",
      cancelId: 2,
      noLink: true
    });
    if (choice === 0) {
      safeSend(win, "save-and-exit");
    } else if (choice === 1) {
      win.forceClose = true;
      win.close();
    }
  }
});
electron.ipcMain.on("save-exit-complete", (event) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  if (win) {
    win.forceClose = true;
    win.close();
  }
});
electron.ipcMain.on("renderer-log", (event, ...args) => {
  console.log("[Renderer]", ...args);
});
electron.ipcMain.handle("compile-ink", async (event, content, filePath, projectFiles = {}) => {
  return await compileInk(content, filePath, projectFiles);
});
electron.ipcMain.handle("save-files", async (event, files) => {
  for (const { path: filePath, content } of files) {
    try {
      await fs.writeFile(filePath, content, "utf-8");
    } catch (e) {
      console.error("Failed to save file", filePath, e);
    }
  }
});
electron.ipcMain.handle("open-project", async (event) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await electron.dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Dink Project", extensions: ["dinkproj"] }]
  });
  if (!canceled && filePaths.length > 0) {
    await loadProject(win, filePaths[0]);
  }
});
electron.ipcMain.handle("open-ink-root", async (event) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  if (win) await openInkRootUI$1(win);
});
electron.ipcMain.handle("create-ink-root", async (event) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  if (win) return await createInkRoot(win);
});
electron.ipcMain.handle("new-project", async (event) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  safeSend(win, "show-new-project-modal");
});
electron.ipcMain.handle("select-folder", async (event, defaultPath) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await electron.dialog.showOpenDialog(win, {
    defaultPath,
    properties: ["openDirectory", "createDirectory"]
  });
  if (!canceled && filePaths.length > 0) {
    return filePaths[0];
  }
  return null;
});
electron.ipcMain.handle("create-new-project", async (event, name, parentPath) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  return await createNewProject(win, name, parentPath);
});
electron.app.whenReady().then(() => {
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.ipcMain.handle("create-new-include", async (event, name, folderPath) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  return await createNewInclude(win, name, folderPath);
});
electron.ipcMain.handle("open-new-include-ui", (event) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  if (win) openNewIncludeUI(win);
});
electron.ipcMain.handle("delete-include", async (event, filePath) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  return await deleteInclude(win, filePath);
});
electron.ipcMain.handle("start-test", (event, rootPath, projectFiles) => {
  openTestWindow(rootPath, projectFiles);
});
electron.ipcMain.on("request-test-restart", () => {
  safeSend(mainWindow, "trigger-start-test");
});
electron.ipcMain.on("rebuild-menu", () => {
  if (mainWindow) buildMenu(mainWindow);
});
electron.app.on("window-all-closed", () => {
  electron.app.quit();
});
let isQuitting = false;
electron.app.on("before-quit", async (e) => {
  if (isQuitting) return;
  e.preventDefault();
  await flushSettings();
  isQuitting = true;
  electron.app.quit();
});
