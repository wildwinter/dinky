import { BrowserWindow } from 'electron'

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
        backgroundColor: '#ffffff'
    })

    testWindow.on('closed', () => {
        testWindow = null
    })

    // Load a blank page to ensure it's not just a completely uninitialized window (though uninitialized is often fine)
    // Using data url to ensure it's clean and doesn't depend on external files for now.
    testWindow.loadURL('data:text/html,<html><body></body></html>');
}
