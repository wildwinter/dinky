// IPC for Edit > "Refresh Out-of-Date IDs": confirming the refresh, then
// carrying the project's audio files and re-record flags over to the new IDs.
//
// The renderer works out which lines are out of date and their new IDs, asks
// here for confirmation, saves the .ink with the new IDs, and only then asks
// here to rename the audio - so a failed save can't leave audio named for IDs
// the script doesn't have.
//
// Imported for side effects only (registers the handlers).

import { BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { getCurrentProject } from './project-manager'
import { vcRename, vcWriteText } from './vc'
import { safeReadJSON } from './safe-read'
import { safeSend } from './utils'
import { planAudioRenames, renameIdsInList } from './id-refresh-plan'

// Every audio-status folder (recorded, TTS, scratch and so on) and the folders
// inside them, each with its file names. Subfolders count because the dink
// compiler finds audio in them too.
async function listAudioFolders(project) {
    const projectDir = path.dirname(project.path)
    const folders = {}
    async function walk(folder) {
        if (folders[folder]) return
        let entries
        try {
            entries = await fs.readdir(folder, { withFileTypes: true })
        } catch {
            return // a configured folder that doesn't exist yet has nothing to rename
        }
        folders[folder] = entries.filter(e => e.isFile()).map(e => e.name)
        for (const e of entries) {
            if (e.isDirectory()) await walk(path.join(folder, e.name))
        }
    }
    for (const status of project.content?.audioStatus || []) {
        if (status.folder) await walk(path.resolve(projectDir, status.folder))
    }
    return folders
}

ipcMain.handle('refresh-ids-confirm', async (event, fileName, renames) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!renames?.length) {
        await dialog.showMessageBox(win, {
            type: 'info',
            message: `Every line ID in ${fileName} is up to date.`,
            detail: 'Each ID already matches the file, knot and stitch its line is in.'
        })
        return false
    }
    const project = getCurrentProject()
    const { moves } = project && !project.isAdhoc
        ? planAudioRenames(await listAudioFolders(project), renames)
        : { moves: [] }

    const lines = renames.length === 1 ? '1 line' : `${renames.length} lines`
    const files = moves.length === 1 ? '1 audio file' : `${moves.length} audio files`
    const listed = renames.slice(0, 12).map(r => `${r.oldId}  →  ${r.newId}`).join('\n')
    const more = renames.length > 12 ? `\n...and ${renames.length - 12} more` : ''

    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Refresh IDs', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        message: `Give ${lines} in ${fileName} new IDs that match where they now are?`,
        detail: `${listed}${more}\n\n` +
            (moves.length ? `${files} will be renamed to match. ` : 'No audio files use these IDs. ') +
            `The file will be saved. Translations already made for these lines ` +
            `use the old IDs and won't carry over.`
    })
    return response === 0
})

ipcMain.handle('refresh-ids-apply-assets', async (event, renames) => {
    const project = getCurrentProject()
    const result = { renamed: 0, conflicts: [], errors: [] }
    if (!project || project.isAdhoc || !renames?.length) return result

    const { moves, conflicts } = planAudioRenames(await listAudioFolders(project), renames)
    result.conflicts = conflicts.map(c => `${path.basename(c.from)} (${path.basename(c.to)} already exists)`)
    for (const move of moves) {
        try {
            vcRename(move.from, move.to)
            result.renamed++
        } catch (e) {
            result.errors.push(e.message)
        }
    }

    // Move any re-record flags to the new IDs.
    const reRecordFile = path.join(path.dirname(project.path), 'rerecord.json')
    const existing = await safeReadJSON(reRecordFile, { allowComments: true })
    if (existing.kind === 'ok' && Array.isArray(existing.data)) {
        const updated = renameIdsInList(existing.data, renames)
        if (updated.some((id, i) => id !== existing.data[i])) {
            try {
                vcWriteText(reRecordFile, JSON.stringify(updated, null, 2) + '\n')
                BrowserWindow.getAllWindows().forEach(win => {
                    if (!win.isDestroyed()) safeSend(win, 'rerecord-updated')
                })
            } catch (e) {
                result.errors.push(e.message)
            }
        }
    } else if (existing.kind === 'broken') {
        result.errors.push(`${reRecordFile} couldn't be read, so its re-record flags still use the old IDs.`)
    }

    if (result.conflicts.length || result.errors.length) {
        const win = BrowserWindow.fromWebContents(event.sender)
        dialog.showMessageBox(win, {
            type: 'warning',
            message: 'Some audio files were not renamed.',
            detail: [
                ...result.conflicts.map(c => `Skipped ${c}`),
                ...result.errors
            ].join('\n')
        })
    }
    return result
})
