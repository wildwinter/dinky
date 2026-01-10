"use strict";
const { app, BrowserWindow, Menu, dialog, nativeTheme, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");
app.setName("Dinky");
let currentDinkProject = null;
const MAX_RECENT_PROJECTS = 10;
const configPath = path.join(app.getPath("userData"), "config.json");
async function loadSettings() {
  try {
    const data = await fs.readFile(configPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return { theme: "system", recentProjects: [] };
  }
}
async function saveSettings(settings) {
  try {
    const current = await loadSettings();
    await fs.writeFile(configPath, JSON.stringify({ ...current, ...settings }, null, 2));
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
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
  await saveSettings({ recentProjects: recent });
}
async function removeFromRecentProjects(filePath) {
  let recent = await getRecentProjects();
  recent = recent.filter((p) => p !== filePath);
  await saveSettings({ recentProjects: recent });
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
    console.log("Loaded project:", filePath);
    win.setTitle(`Dinky - ${path.basename(filePath)}`);
    await addToRecentProjects(filePath);
    await buildMenu(win);
    return true;
  } catch (e) {
    console.error("Failed to open project:", e);
    if (e.message.includes("not found")) {
      await removeFromRecentProjects(filePath);
      await buildMenu(win);
    }
    dialog.showErrorBox("Error", `Failed to open project file.
${e.message}`);
    return false;
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
      label: app.name,
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
          label: "New Dink Project...",
          click: async () => {
            const { canceled, filePath } = await dialog.showSaveDialog(win, {
              filters: [{ name: "Dink Project", extensions: ["dinkproj"] }]
            });
            if (!canceled && filePath) {
              try {
                const initialContent = {};
                await fs.writeFile(filePath, JSON.stringify(initialContent, null, 4), "utf-8");
                await loadProject(win, filePath);
              } catch (e) {
                console.error("Failed to create new project:", e);
                dialog.showErrorBox("Error", "Failed to create new project file.");
              }
            }
          }
        },
        {
          label: "Open Dink Project...",
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [{ name: "Dink Project", extensions: ["dinkproj"] }]
            });
            if (!canceled && filePaths.length > 0) {
              await loadProject(win, filePaths[0]);
            }
          }
        },
        {
          label: "Open Recent",
          submenu: recentMenu
        },
        { type: "separator" },
        {
          label: "Open Ink Root...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const { canceled, filePaths } = await dialog.showOpenDialog(win, {
              properties: ["openFile"],
              filters: [{ name: "Ink Files", extensions: ["ink"] }]
            });
            if (!canceled && filePaths.length > 0) {
              const files = await loadRootInk(filePaths[0]);
              win.webContents.send("root-ink-loaded", files);
            }
          }
        },
        { label: "Save", accelerator: isMac ? "Cmd+S" : "Ctrl+S", click: async () => {
          win.webContents.send("save-all");
        } },
        ...isMac ? [] : [{ role: "quit" }]
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
              checked: nativeTheme.themeSource === "system",
              click: () => {
                nativeTheme.themeSource = "system";
                saveSettings({ theme: "system" });
              }
            },
            {
              label: "Light",
              type: "radio",
              checked: nativeTheme.themeSource === "light",
              click: () => {
                nativeTheme.themeSource = "light";
                saveSettings({ theme: "light" });
              }
            },
            {
              label: "Dark",
              type: "radio",
              checked: nativeTheme.themeSource === "dark",
              click: () => {
                nativeTheme.themeSource = "dark";
                saveSettings({ theme: "dark" });
              }
            }
          ]
        },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
async function createWindow() {
  const settings = await loadSettings();
  nativeTheme.themeSource = settings.theme || "system";
  const win = new BrowserWindow({
    title: "Dinky",
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  await buildMenu(win);
  const updateTheme = () => {
    const theme = nativeTheme.shouldUseDarkColors ? "vs-dark" : "vs";
    win.webContents.send("theme-updated", theme);
  };
  nativeTheme.on("updated", updateTheme);
  win.webContents.on("did-finish-load", async () => {
    updateTheme();
    const recent = await getRecentProjects();
    if (recent.length > 0) {
      const lastProject = recent[0];
      try {
        await fs.access(lastProject);
        console.log("Auto-loading last project:", lastProject);
        await loadProject(win, lastProject);
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
}
ipcMain.on("renderer-log", (event, ...args) => {
  console.log("[Renderer]", ...args);
});
ipcMain.handle("compile-ink", async (event, content, filePath, projectFiles = {}) => {
  if (content && typeof content === "string" && content.charCodeAt(0) === 65279) {
    content = content.slice(1);
  }
  const collectedErrors = [];
  let parseError = null;
  try {
    const inkjs = require("inkjs/full");
    const fsSync = require("fs");
    const fileHandler = {
      ResolveInkFilename: (filename) => {
        const baseDir = filePath ? path.dirname(filePath) : process.cwd();
        const resolved = path.resolve(baseDir, filename);
        return resolved;
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
  const errors = [];
  if (collectedErrors.length > 0) {
    collectedErrors.forEach((errStr) => {
      const severity = errStr.includes("WARNING") ? 4 : 8;
      const parts = errStr.match(/^(?:ERROR: )?(?:'([^']+)' )?line (\d+): (.+)/i);
      if (parts) {
        const errFilePath = parts[1] || null;
        const line = parseInt(parts[2]);
        const msg = parts[3];
        errors.push({
          startLineNumber: line,
          endLineNumber: line,
          startColumn: 1,
          endColumn: 1e3,
          message: msg,
          severity,
          filePath: errFilePath
        });
      } else {
        errors.push({
          startLineNumber: 1,
          endLineNumber: 1,
          startColumn: 1,
          endColumn: 1e3,
          message: errStr,
          severity,
          filePath: null
        });
      }
    });
  }
  if (errors.length > 0) {
    return errors;
  }
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
});
ipcMain.handle("save-files", async (event, files) => {
  const fs2 = require("fs/promises");
  for (const { path: filePath, content } of files) {
    try {
      await fs2.writeFile(filePath, content, "utf-8");
    } catch (e) {
      console.error("Failed to save file", filePath, e);
    }
  }
});
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
