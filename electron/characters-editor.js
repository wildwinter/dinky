import { BrowserWindow, nativeTheme, ipcMain, dialog } from 'electron'
import path from 'path'
import { getWindowState, saveWindowState } from './config'
import { setupThemeListener, safeSend } from './utils'
import { getCurrentProject } from './project-manager'
import { vcWriteText } from './vc'
import { safeReadJSON } from './safe-read'

let charactersWindow = null;

export async function openCharactersWindow(parentWindow) {
    if (charactersWindow && !charactersWindow.isDestroyed()) {
        charactersWindow.show();
        charactersWindow.focus();
        return;
    }

    const windowState = await getWindowState('characters');

    charactersWindow = new BrowserWindow({
        title: 'Characters',
        width: windowState?.width || 600,
        height: windowState?.height || 450,
        minWidth: 400,
        minHeight: 300,
        x: windowState?.x,
        y: windowState?.y,
        parent: parentWindow,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        resizable: true,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 10, y: 10 },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        show: false,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
        titleBarOverlay: {
            color: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
            symbolColor: nativeTheme.shouldUseDarkColors ? '#cccccc' : '#333333',
        },
    });

    // Theme listener for the window itself
    const { cleanup: cleanupTheme, update: updateTheme } = setupThemeListener(charactersWindow, '#252526', '#f3f3f3');

    const updateOverlay = () => {
        if (charactersWindow && !charactersWindow.isDestroyed() && typeof charactersWindow.setTitleBarOverlay === 'function') {
            charactersWindow.setTitleBarOverlay({
                color: nativeTheme.shouldUseDarkColors ? '#252526' : '#f3f3f3',
                symbolColor: nativeTheme.shouldUseDarkColors ? '#cccccc' : '#333333',
            })
        }
    }

    nativeTheme.on('updated', updateOverlay)

    charactersWindow.on('ready-to-show', () => {
        charactersWindow.show();
    });

    charactersWindow.on('close', () => {
        saveWindowState('characters', charactersWindow.getBounds());
    });

    charactersWindow.on('closed', () => {
        cleanupTheme();
        nativeTheme.off('updated', updateOverlay);
        charactersWindow = null;
    });

    charactersWindow.webContents.on('did-finish-load', () => {
        updateTheme();
    });

    if (process.env.VITE_DEV_SERVER_URL) {
        charactersWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}characters.html`);
    } else {
        const indexPath = path.join(__dirname, '../dist/characters.html');
        charactersWindow.loadFile(indexPath).catch(e => console.error('Failed to load characters.html:', e));
    }
}

// Resolve which characters file currently exists for the project. Returns
// { path, result } where result is the safeReadJSON outcome (absent/ok/broken).
// Prefers .json over .jsonc; if both absent, returns .json as the create target.
async function resolveCharactersFile(project) {
    const projectDir = path.dirname(project.path);
    const jsonPath = path.join(projectDir, 'characters.json');
    const jsoncPath = path.join(projectDir, 'characters.jsonc');

    const jsonRes = await safeReadJSON(jsonPath, { allowComments: true });
    if (jsonRes.kind !== 'absent') return { path: jsonPath, result: jsonRes };

    const jsoncRes = await safeReadJSON(jsoncPath, { allowComments: true });
    if (jsoncRes.kind !== 'absent') return { path: jsoncPath, result: jsoncRes };

    return { path: jsonPath, result: { kind: 'absent' } };
}

// IPC handler to get characters
ipcMain.handle('get-characters', async (event) => {
    const project = getCurrentProject();
    if (!project) return [];

    const { path: filePath, result } = await resolveCharactersFile(project);

    if (result.kind === 'absent') return [];
    if (result.kind === 'broken') {
        console.error('Failed to parse characters file', filePath, result.error);
        dialog.showErrorBox(
            'Characters file is invalid',
            `Couldn't parse ${filePath}\n\n${result.error?.message || 'unknown error'}\n\n` +
            `The Characters editor will open empty, but saving is disabled until ` +
            `the file is fixed (it would otherwise replace your character list ` +
            `with the empty editor contents).`
        );
        return [];
    }
    return Array.isArray(result.data) ? result.data : [];
});

// IPC handler to save characters
ipcMain.handle('save-characters', async (event, characters) => {
    const project = getCurrentProject();
    if (!project) return false;

    // Re-check the on-disk file before overwriting. If it exists and we can't
    // parse it, the renderer's `characters` array is almost certainly a stale
    // empty-fallback from a failed `get-characters` — refuse to overwrite.
    const { path: filePath, result } = await resolveCharactersFile(project);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);

    if (result.kind === 'broken') {
        console.error('Refusing to save: existing characters file is unparseable', filePath, result.error);
        dialog.showErrorBox(
            'Save refused',
            `${filePath}\n\nexists but couldn't be parsed (${result.error?.message || 'unknown error'}).\n\n` +
            `Refusing to overwrite — fix the file manually first, then reopen the Characters editor.`
        );
        return false;
    }

    // Also refuse to write [] over a non-empty existing list. The Characters
    // editor doesn't have a way to legitimately wipe everything in one go;
    // an empty save almost always means we got here via a parse-failure path.
    if (Array.isArray(characters) && characters.length === 0
        && result.kind === 'ok' && Array.isArray(result.data) && result.data.length > 0) {
        console.error('Refusing to save: empty character list would replace', result.data.length, 'existing entries');
        dialog.showErrorBox(
            'Save refused',
            `Refusing to overwrite ${filePath} with an empty character list ` +
            `(it currently has ${result.data.length} entries). ` +
            `Delete characters one-by-one if that's really what you want.`
        );
        return false;
    }

    // If the existing file has comments, warn before stripping them. The
    // Characters editor sends the whole array on every save and we re-
    // serialize through JSON.stringify, which discards comments. Users
    // who annotated their characters.jsonc would otherwise lose those
    // notes silently on the next "Add character" click.
    if (result.kind === 'ok' && typeof result.raw === 'string' && hasJsoncComments(result.raw)) {
        const { response } = await dialog.showMessageBox(parentWindow || BrowserWindow.getFocusedWindow(), {
            type: 'warning',
            buttons: ['Save (lose comments)', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            title: 'Comments will be lost',
            message: `${path.basename(filePath)} contains comments that won't survive this save.`,
            detail: `If you continue, all // and /* */ comments in this file will be removed. Click Cancel and edit the file directly if you want to keep them.`
        });
        if (response !== 0) return false;
    }

    try {
        vcWriteText(filePath, JSON.stringify(characters, null, 4));

        // Notify all windows that characters have been updated
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
                safeSend(win, 'characters-updated');
            }
        });

        return true;
    } catch (error) {
        console.error('Failed to save characters:', error);
        dialog.showErrorBox('Failed to save characters', error.message);
        return false;
    }
});

// Cheap check for the presence of JSONC-style comments. Doesn't try to be
// perfect — it'll false-positive on strings containing "//" inside the data
// (e.g. a URL field). That's fine: a false positive just makes the user
// confirm an extra time; a false negative would silently strip comments.
function hasJsoncComments(text) {
    return /\/\/|\/\*/.test(text);
}

ipcMain.on('open-characters', (event) => {
    const parentWindow = BrowserWindow.getFocusedWindow();
    if (parentWindow) {
        openCharactersWindow(parentWindow);
    }
});
