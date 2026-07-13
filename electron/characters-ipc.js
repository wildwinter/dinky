// IPC handlers for reading and writing the project's characters.json /
// characters.jsonc. Imported for side effects only (registers the handlers) -
// there is no standalone Characters window; the editing UI lives in the
// Characters tab of Project Settings (src/project-settings-renderer.js).

import { BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { safeSend } from './utils'
import { getCurrentProject } from './project-manager'
import { vcWriteText } from './vc'
import { safeReadJSON } from './safe-read'
import { createScanner, SyntaxKind } from 'jsonc-parser'

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
            `The character list will show empty, but saving is disabled until ` +
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
    // empty-fallback from a failed `get-characters` - refuse to overwrite.
    const { path: filePath, result } = await resolveCharactersFile(project);
    const parentWindow = BrowserWindow.fromWebContents(event.sender);

    if (result.kind === 'broken') {
        console.error('Refusing to save: existing characters file is unparseable', filePath, result.error);
        dialog.showErrorBox(
            'Save refused',
            `${filePath}\n\nexists but couldn't be parsed (${result.error?.message || 'unknown error'}).\n\n` +
            `Refusing to overwrite - fix the file manually first, then reopen Project Settings.`
        );
        return false;
    }

    // Also refuse to write [] over a non-empty existing list. The characters
    // UI has no way to legitimately wipe everything in one go; an empty save
    // almost always means we got here via a parse-failure path.
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
    // characters UI sends the whole array on every save and we re-serialize
    // through JSON.stringify, which discards comments. Users who annotated
    // their characters.jsonc would otherwise lose those notes silently on the
    // next "Add character" click.
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

// Detect real JSONC comments, using the scanner so that "//" or "/*" appearing
// *inside string values* (a Notes field containing a URL, say) isn't mistaken
// for a comment. A regex here would nag on every save of a character whose
// notes mention "http://...".
function hasJsoncComments(text) {
    const scanner = createScanner(text, /* ignoreTrivia */ false);
    let kind;
    while ((kind = scanner.scan()) !== SyntaxKind.EOF) {
        if (kind === SyntaxKind.LineCommentTrivia || kind === SyntaxKind.BlockCommentTrivia) {
            return true;
        }
    }
    return false;
}
