import { app, dialog, BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

let updateDownloaded = null

autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('error', (err) => {
    console.error('AutoUpdater error:', err?.message || err)
})

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
        if (response === 0) autoUpdater.quitAndInstall()
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
        if (response === 0) autoUpdater.quitAndInstall()
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
        } else {
            await dialog.showMessageBox(parent, {
                type: 'info',
                message: "You're on the latest version.",
                detail: `Dinky ${app.getVersion()} is up to date.`,
                buttons: ['OK']
            })
        }
    } catch (err) {
        await dialog.showMessageBox(parent, {
            type: 'error',
            message: 'Update check failed',
            detail: err?.message || String(err),
            buttons: ['OK']
        })
    }
}
