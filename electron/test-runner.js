import { BrowserWindow, nativeTheme } from 'electron'
import path from 'path'

let testWindow = null

export function openTestWindow() {
    if (testWindow) {
        testWindow.show()
        testWindow.focus()
        return
    }

    let x, y
    const currentWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
    if (currentWindow) {
        const [currentX, currentY] = currentWindow.getPosition()
        x = currentX + 50
        y = currentY + 50
    }

    testWindow = new BrowserWindow({
        title: 'Test',
        width: 800,
        height: 600,
        x,
        y,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        }
    })

    const updateTheme = () => {
        if (!testWindow || testWindow.isDestroyed()) return
        const theme = nativeTheme.shouldUseDarkColors ? 'vs-dark' : 'vs'
        testWindow.webContents.send('theme-updated', theme)
        testWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff')
    }

    const themeListener = () => updateTheme()
    nativeTheme.on('updated', themeListener)

    testWindow.on('closed', () => {
        nativeTheme.off('updated', themeListener)
        testWindow = null
    })

    testWindow.webContents.on('did-finish-load', () => {
        updateTheme()
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        testWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}test-window.html`)
    } else {
        const indexPath = path.join(__dirname, '../dist/test-window.html')
        testWindow.loadFile(indexPath).catch(e => console.error('Failed to load test-window.html:', e))
    }
}
