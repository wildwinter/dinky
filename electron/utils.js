import { nativeTheme } from 'electron'

/**
 * Safely sends an IPC message to a BrowserWindow's webContents.
 * Checks if the window and webContents are still valid and not destroyed.
 * 
 * @param {import('electron').BrowserWindow} win The window to send to
 * @param {string} channel The IPC channel name
 * @param {...any} args The arguments to send
 */
export function safeSend(win, channel, ...args) {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, ...args);
        return true;
    }
    return false;
}

/**
 * Sets up a theme listener for a window to keep it in sync with system theme.
 * Returns a cleanup function to remove the listener.
 * 
 * @param {import('electron').BrowserWindow} win 
 * @param {string} [bgColorDark] 
 * @param {string} [bgColorLight] 
 */
export function setupThemeListener(win, bgColorDark, bgColorLight) {
    const updateTheme = () => {
        const theme = nativeTheme.shouldUseDarkColors ? 'vs-dark' : 'vs'
        const sent = safeSend(win, 'theme-updated', theme)
        if (sent && win && !win.isDestroyed() && bgColorDark && bgColorLight) {
            win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? bgColorDark : bgColorLight)
        }
    }

    nativeTheme.on('updated', updateTheme)

    // Initial run
    updateTheme()

    return () => {
        nativeTheme.off('updated', updateTheme)
    }
}
