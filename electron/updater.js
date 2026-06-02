import { app, dialog, BrowserWindow, ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { safeSend } from './utils'

const { autoUpdater } = electronUpdater

let updateDownloaded = null
// Remember the last background error so the manual "Check for Updates"
// dialog can show it. Otherwise a broken update feed (network policy,
// expired cert, GitHub outage) stays invisible — user has no idea why
// updates aren't arriving.
let lastBackgroundError = null

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err?.message || err)
    lastBackgroundError = err?.message || String(err)
})

// Ask the renderer (one-shot, timeout-guarded) whether the project has unsaved
// edits. Returns false on any error/timeout so we err on the side of letting
// the install proceed — the renderer's own dirty tracking is the only source
// of truth here.
function askRendererIsDirty(win) {
    return new Promise((resolve) => {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
            resolve(false)
            return
        }
        const onReply = (_event, isDirty) => {
            clearTimeout(timeout)
            resolve(!!isDirty)
        }
        ipcMain.once('updater-is-dirty-reply', onReply)
        const timeout = setTimeout(() => {
            ipcMain.removeListener('updater-is-dirty-reply', onReply)
            console.warn('Updater dirty-check timed out; assuming clean.')
            resolve(false)
        }, 2000)
        safeSend(win, 'updater-is-dirty')
    })
}

// Trigger a saveAllFiles in the renderer, wait for completion. Saves can run
// auto-tagging across every file, so the timeout is generous; if it exceeds,
// we abort the install rather than continue with a half-saved project.
function triggerRendererSave(win) {
    return new Promise((resolve) => {
        if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
            resolve({ ok: false })
            return
        }
        const onReply = (_event, result) => {
            clearTimeout(timeout)
            resolve(result || { ok: false })
        }
        ipcMain.once('updater-save-done', onReply)
        const timeout = setTimeout(() => {
            ipcMain.removeListener('updater-save-done', onReply)
            console.warn('Updater save timed out.')
            resolve({ ok: false })
        }, 30000)
        safeSend(win, 'updater-save-before-install')
    })
}

// Wraps autoUpdater.quitAndInstall with an unsaved-edits check. Without this,
// "Restart Now" silently bypasses the window-close save prompt — clicking it
// while editing would lose work. autoInstallOnAppQuit (the install-on-next-
// normal-quit path) routes through win.on('close') already, so it's safe.
async function quitAndInstallSafely() {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]

    const isDirty = await askRendererIsDirty(win)

    if (!isDirty) {
        autoUpdater.quitAndInstall()
        return
    }

    const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Save and Restart', 'Discard and Restart', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved Changes',
        message: 'You have unsaved changes.',
        detail: `Save them before restarting to install Dinky ${updateDownloaded?.version || ''}?`
    })

    if (response === 2) return // Cancel — abort the install

    if (response === 0) {
        const result = await triggerRendererSave(win)
        if (!result.ok) {
            // Save failed or timed out — don't proceed; the user can retry.
            await dialog.showMessageBox(win, {
                type: 'error',
                message: 'Save failed',
                detail: 'Your changes could not be saved. The update install was cancelled. Try again or save manually before restarting.',
                buttons: ['OK']
            })
            return
        }
    }
    // response === 1 (Discard) falls through.

    autoUpdater.quitAndInstall()
}

autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = info
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (!win) return
    dialog.showMessageBox(win, {
        type: 'info',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        message: 'Update ready to install',
        detail: `Dinky ${info.version} has been downloaded. Restart now to apply, or it will install automatically next time you quit.`
    }).then(({ response }) => {
        if (response === 0) quitAndInstallSafely()
    }).catch(() => {})
})

export function startBackgroundUpdateCheck() {
    if (!app.isPackaged) return
    autoUpdater.checkForUpdates().catch((err) => {
        console.error('AutoUpdater background check failed:', err?.message || err)
    })
}

export async function manualCheckForUpdates(win) {
    const parent = win || BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]

    if (!app.isPackaged) {
        await dialog.showMessageBox(parent, {
            type: 'info',
            message: 'Updates unavailable in development build',
            detail: `Auto-update only runs in packaged builds.\n\nCurrent version: ${app.getVersion()}`,
            buttons: ['OK']
        })
        return
    }

    if (updateDownloaded) {
        const { response } = await dialog.showMessageBox(parent, {
            type: 'info',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            message: 'Update ready to install',
            detail: `Dinky ${updateDownloaded.version} has been downloaded. Restart now to apply.`
        })
        if (response === 0) await quitAndInstallSafely()
        return
    }

    try {
        const result = await autoUpdater.checkForUpdates()
        if (result?.downloadPromise) {
            await dialog.showMessageBox(parent, {
                type: 'info',
                message: 'Update available',
                detail: `Dinky ${result.updateInfo.version} is downloading in the background. You'll be prompted to restart when it's ready.`,
                buttons: ['OK']
            })
            lastBackgroundError = null
        } else if (lastBackgroundError) {
            // A previous background check failed (probably at startup). The
            // manual check just succeeded enough to return a result, but
            // surface the prior error so the user knows updates have been
            // intermittently broken.
            await dialog.showMessageBox(parent, {
                type: 'warning',
                message: "You're on the latest version, but updates have had errors.",
                detail: `Current version: Dinky ${app.getVersion()}\n\nLast update error:\n${lastBackgroundError}`,
                buttons: ['OK']
            })
            lastBackgroundError = null
        } else {
            await dialog.showMessageBox(parent, {
                type: 'info',
                message: "You're on the latest version.",
                detail: `Dinky ${app.getVersion()} is up to date.`,
                buttons: ['OK']
            })
        }
    } catch (err) {
        // Surface either this error or a prior background error if there is one.
        const message = err?.message || String(err)
        const detail = lastBackgroundError && lastBackgroundError !== message
            ? `${message}\n\nA previous background check also failed with:\n${lastBackgroundError}`
            : message
        await dialog.showMessageBox(parent, {
            type: 'error',
            message: 'Update check failed',
            detail,
            buttons: ['OK']
        })
        lastBackgroundError = null
    }
}
