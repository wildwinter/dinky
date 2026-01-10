import { BrowserWindow, nativeTheme } from 'electron'
import path from 'path'
import { compileStory } from './compiler'

let testWindow = null

export async function openTestWindow(rootPath, projectFiles) {
    if (testWindow) {
        testWindow.show()
        testWindow.focus()
        // If args provided, re-run test
        if (rootPath && projectFiles) {
            await runTestSequence(rootPath, projectFiles);
        }
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
        },
        show: false
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

    testWindow.once('ready-to-show', () => {
        testWindow.show();
    });

    // Wait for load to finish before running test if we have data
    testWindow.webContents.on('did-finish-load', async () => {
        updateTheme()
        if (rootPath && projectFiles) {
            await runTestSequence(rootPath, projectFiles);
        }
    })

    if (process.env.VITE_DEV_SERVER_URL) {
        await testWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}test-window.html`)
    } else {
        const indexPath = path.join(__dirname, '../dist/test-window.html')
        await testWindow.loadFile(indexPath).catch(e => console.error('Failed to load test-window.html:', e))
    }
}

async function runTestSequence(rootPath, projectFiles) {
    if (!testWindow || testWindow.isDestroyed()) return;

    // Get content from projectFiles map
    const rootContent = projectFiles[rootPath];
    if (!rootContent) {
        console.error('Root file content not found in projectFiles for path:', rootPath);
        return;
    }

    try {
        const storyJson = await compileStory(rootContent, rootPath, projectFiles);
        if (testWindow && !testWindow.isDestroyed()) {
            testWindow.webContents.send('start-story', storyJson);
        }
    } catch (e) {
        console.error('Test compilation failed:', e);
        // TODO: Send error to renderer?
        if (testWindow && !testWindow.isDestroyed()) {
            // Maybe a specific error channel or just log console
            testWindow.webContents.executeJavaScript(`console.error("Compilation failed: ${e.message.replace(/"/g, '\\"')}")`);
        }
    }
}
