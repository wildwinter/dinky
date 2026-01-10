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
