"use strict";
const { app, BrowserWindow, Menu, dialog, nativeTheme, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs/promises");
app.setName("Dinky");
let currentDinkProject = null;
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
const configPath = path.join(app.getPath("userData"), "config.json");
async function loadSettings() {
  try {
    const data = await fs.readFile(configPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return { theme: "system" };
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
  const isMac = process.platform === "darwin";
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
                currentDinkProject = { path: filePath, content: initialContent };
                console.log("Created and loaded new project:", filePath);
                win.setTitle(`Dinky - ${path.basename(filePath)}`);
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
              try {
                const content = await fs.readFile(filePaths[0], "utf-8");
                const jsonContent = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
                currentDinkProject = { path: filePaths[0], content: JSON.parse(jsonContent) };
                console.log("Loaded project:", filePaths[0]);
                win.setTitle(`Dinky - ${path.basename(filePaths[0])}`);
              } catch (e) {
                console.error("Failed to open project:", e);
                dialog.showErrorBox("Error", "Failed to open project file.");
              }
            }
          }
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
  const updateTheme = () => {
    const theme = nativeTheme.shouldUseDarkColors ? "vs-dark" : "vs";
    win.webContents.send("theme-updated", theme);
  };
  nativeTheme.on("updated", updateTheme);
  win.webContents.on("did-finish-load", () => {
    updateTheme();
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
