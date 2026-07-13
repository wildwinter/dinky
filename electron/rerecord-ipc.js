// IPC handlers for the project's re-record list - rerecord.json, a plain JSON
// array of line IDs the writer has flagged to be re-recorded in the next
// session. Lives next to the .dinkproj, is hand-editable, and is read by the
// dink compiler to mark those lines "Re-record" in the recording script/stats.
//
// Imported for side effects only (registers the handlers). Written through
// simple-vc-lib (vcWriteText) so version control is informed.

import { BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import { safeSend } from './utils'
import { getCurrentProject } from './project-manager'
import { vcWriteText } from './vc'
import { safeReadJSON } from './safe-read'

const FILE_NAME = 'rerecord.json'

function reRecordPath(project) {
    return path.join(path.dirname(project.path), FILE_NAME)
}

// Normalise loaded data to an array of unique, non-empty string IDs.
function normaliseIds(data) {
    if (!Array.isArray(data)) return []
    const seen = new Set()
    const out = []
    for (const item of data) {
        if (typeof item !== 'string') continue
        const id = item.trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push(id)
    }
    return out
}

ipcMain.handle('get-rerecord-list', async () => {
    const project = getCurrentProject()
    if (!project) return []

    const filePath = reRecordPath(project)
    // allowComments so a hand-edited file with notes still parses.
    const result = await safeReadJSON(filePath, { allowComments: true })

    if (result.kind === 'absent') return []
    if (result.kind === 'broken') {
        console.error('Failed to parse re-record file', filePath, result.error)
        dialog.showErrorBox(
            'Re-record file is invalid',
            `Couldn't parse ${filePath}\n\n${result.error?.message || 'unknown error'}\n\n` +
            `Re-record flags are disabled until the file is fixed (saving would ` +
            `otherwise overwrite whatever is in it).`
        )
        return { error: 'broken' }
    }
    return normaliseIds(result.data)
})

ipcMain.handle('save-rerecord-list', async (event, ids) => {
    const project = getCurrentProject()
    if (!project) return false

    const filePath = reRecordPath(project)

    // Re-read before overwriting: if the on-disk file exists but is unparseable,
    // the in-memory list is unreliable - refuse rather than clobber it. (Unlike
    // characters, an EMPTY list is legitimate here - unflagging the last line -
    // so there is no "refuse empty over non-empty" guard.)
    const existing = await safeReadJSON(filePath, { allowComments: true })
    if (existing.kind === 'broken') {
        console.error('Refusing to save: existing re-record file is unparseable', filePath, existing.error)
        dialog.showErrorBox(
            'Save refused',
            `${filePath}\n\nexists but couldn't be parsed (${existing.error?.message || 'unknown error'}).\n\n` +
            `Fix the file manually first.`
        )
        return false
    }

    try {
        vcWriteText(filePath, JSON.stringify(normaliseIds(ids), null, 2) + '\n')
        BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) safeSend(win, 'rerecord-updated')
        })
        return true
    } catch (error) {
        console.error('Failed to save re-record list:', error)
        dialog.showErrorBox('Failed to save re-record list', error.message)
        return false
    }
})
