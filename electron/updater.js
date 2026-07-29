import { app, dialog, BrowserWindow, ipcMain } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import { safeSend } from './utils'

const { autoUpdater, CancellationToken } = electronUpdater

let updateDownloaded = null
// Remember the last background error so the manual "Check for Updates"
// dialog can show it. Otherwise a broken update feed (network policy,
// expired cert, GitHub outage) stays invisible - user has no idea why
// updates aren't arriving.
let lastBackgroundError = null

// Persistent updater log (userData/updater.log). electron-updater is silent by
// default; a Windows download that stalls without emitting `error` (seen in
// Patterpad, patterkit/patter#33) leaves nothing to diagnose without one.
const logPath = join(app.getPath('userData'), 'updater.log')
const writeLog = (level, args) => {
    try {
        appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${args.map((a) => (a instanceof Error ? a.stack || a.message : String(a))).join(' ')}\n`)
    } catch { /* logging must never throw */ }
}
autoUpdater.logger = {
    info: (...a) => writeLog('info', a),
    warn: (...a) => writeLog('warn', a),
    error: (...a) => writeLog('error', a),
    debug: (...a) => writeLog('debug', a)
}

// Downloads are driven by the download manager below, NOT autoDownload: holding
// the CancellationToken ourselves is what lets the stall watchdog kill and retry
// a download that hangs without ever erroring (patterkit/patter#33 - a hung
// stream emits neither progress nor `error`, so nothing event-driven recovers it).
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true
// Full download instead of the block-by-block differential: the differential path
// has stalled silently on Windows, and across an Electron bump it downloads nearly
// everything anyway. No-op on macOS (Squirrel.Mac always fetches the whole zip).
autoUpdater.disableDifferentialDownload = true

autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err?.message || err)
    lastBackgroundError = err?.message || String(err)
})

// ---------------------------------------------------------------------------
// Download manager: start, watch, retry. Ported from Patterpad's updater
// (patterkit/patter, updater.ts) - platform-agnostic, it rides electron-updater's
// shared events (NSIS / zip / AppImage alike).
// ---------------------------------------------------------------------------

const STALL_MS = 3 * 60 * 1000    // no progress event for this long = the download is hung
const WATCH_EVERY_MS = 30 * 1000  // how often the watchdog looks at the clock
const RETRY_DELAY_MS = 15 * 1000  // pause before re-attempting a killed/failed download
const MAX_ATTEMPTS = 3            // per check cycle; the next check starts a fresh cycle

let download = null      // { info, token, attempts, lastProgressAt, cancelledByWatchdog, watchdog }
let lastProgress = null  // latest ProgressInfo, for the manual dialog's snapshot

function clearDownload() {
    if (download) clearInterval(download.watchdog)
    download = null
    lastProgress = null
}

// Begin (or re-attempt) downloading `info`.
function beginDownload(info, attempts) {
    clearDownload()
    const token = new CancellationToken()
    const state = {
        info,
        token,
        attempts: attempts + 1,
        lastProgressAt: Date.now(),
        cancelledByWatchdog: false,
        watchdog: setInterval(() => {
            if (download !== state) return
            const quiet = Date.now() - state.lastProgressAt
            if (quiet < STALL_MS) return
            // Hung: no progress and no error for STALL_MS. Kill it; the download promise's catch retries.
            writeLog('warn', [`watchdog: no download progress for ${Math.round(quiet / 1000)}s - cancelling (attempt ${state.attempts}/${MAX_ATTEMPTS})`])
            state.cancelledByWatchdog = true
            state.token.cancel()
        }, WATCH_EVERY_MS)
    }
    download = state
    writeLog('info', [`download: starting ${info.version} (attempt ${state.attempts}/${MAX_ATTEMPTS})`])

    autoUpdater.downloadUpdate(token).then(() => {
        // Success is reported via the update-downloaded event; it clears the state.
    }).catch((err) => {
        if (download !== state) return // superseded by a newer attempt/cycle
        const why = state.cancelledByWatchdog ? 'stalled (killed by the watchdog)' : (err?.message || String(err))
        clearDownload()
        if (state.attempts < MAX_ATTEMPTS) {
            writeLog('warn', [`download: attempt ${state.attempts} failed - ${why}; retrying in ${RETRY_DELAY_MS / 1000}s`])
            setTimeout(() => { if (!download && !updateDownloaded) beginDownload(info, state.attempts) }, RETRY_DELAY_MS)
        } else {
            // Out of attempts for this cycle. Surface it in the manual check; the next
            // background check (or Check for Updates) starts a fresh cycle.
            lastBackgroundError = `Downloading ${info.version} failed ${MAX_ATTEMPTS} times (last: ${why}). Will retry on the next check.`
            writeLog('error', [`download: giving up on ${info.version} this cycle - ${why}`])
        }
    })
}

autoUpdater.on('update-available', (info) => {
    if (download || updateDownloaded) return // already downloading it, or already have it
    beginDownload(info, 0)
})

autoUpdater.on('download-progress', (p) => {
    if (download) download.lastProgressAt = Date.now()
    lastProgress = p
})

// Ask the renderer (one-shot, timeout-guarded) whether the project has unsaved
// edits. Returns false on any error/timeout so we err on the side of letting
// the install proceed - the renderer's own dirty tracking is the only source
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
// "Restart Now" silently bypasses the window-close save prompt - clicking it
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

    if (response === 2) return // Cancel - abort the install

    if (response === 0) {
        const result = await triggerRendererSave(win)
        if (!result.ok) {
            // Save failed or timed out - don't proceed; the user can retry.
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
    clearDownload()
    updateDownloaded = info
    lastBackgroundError = null // it got here in the end; stale retry noise would only mislead
    writeLog('info', [`download: ${info.version} downloaded and ready to install`])
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

let periodicCheck = null

export function startBackgroundUpdateCheck() {
    if (!app.isPackaged) return
    const check = () => autoUpdater.checkForUpdates().catch((err) => {
        console.error('AutoUpdater background check failed:', err?.message || err)
    })
    check()
    // Re-check every 6 hours (Patterpad's cadence): an app left running for days
    // used to check once at launch and never again.
    if (!periodicCheck) periodicCheck = setInterval(check, 6 * 60 * 60 * 1000)
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

    if (download) {
        // A download is already in flight: show where it's got to (a snapshot; native
        // message boxes can't live-update).
        const pct = lastProgress ? ` (${lastProgress.percent.toFixed(0)}% downloaded so far)` : ''
        await dialog.showMessageBox(parent, {
            type: 'info',
            message: 'Update available',
            detail: `Dinky ${download.info.version} is downloading${pct}. You'll be prompted to restart when it's ready.`,
            buttons: ['OK']
        })
        return
    }

    try {
        // A manual check starts a fresh retry cycle: if the last one gave up, this is the user asking again.
        await autoUpdater.checkForUpdates()
        // With autoDownload off, `update-available` (fired during the await) starts the managed
        // download, so by here `download` is set iff the feed had something newer.
        if (download) {
            const pct = lastProgress ? ` (${lastProgress.percent.toFixed(0)}% downloaded so far)` : ''
            await dialog.showMessageBox(parent, {
                type: 'info',
                message: 'Update available',
                detail: `Dinky ${download.info.version} is downloading${pct}. You'll be prompted to restart when it's ready.`,
                buttons: ['OK']
            })
            lastBackgroundError = null
        } else if (updateDownloaded) {
            // The check completed a download between our earlier guard and now (tiny window).
            const { response } = await dialog.showMessageBox(parent, {
                type: 'info',
                buttons: ['Restart Now', 'Later'],
                defaultId: 0,
                cancelId: 1,
                message: 'Update ready to install',
                detail: `Dinky ${updateDownloaded.version} has been downloaded. Restart now to apply.`
            })
            if (response === 0) await quitAndInstallSafely()
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
