import { BrowserWindow, nativeTheme } from 'electron'
import path from 'path'
import { compileStory } from './compiler'
import { safeSend } from './utils'
import { getWindowState, saveWindowState } from './config'

let testWindow = null

export async function openTestWindow(rootPath, projectFiles) {
    if (testWindow) {
        testWindow.show()
        testWindow.focus()
        if (rootPath && projectFiles) {
            await runTestSequence(rootPath, projectFiles);
        }
        return
    }

    // Load saved window state
    const windowState = await getWindowState('test');

    testWindow = new BrowserWindow({
        title: 'Test',
        width: windowState?.width || 800,
        height: windowState?.height || 600,
        x: windowState?.x,
        y: windowState?.y,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
        show: false
    })

    const updateTheme = () => {
        const theme = nativeTheme.shouldUseDarkColors ? 'vs-dark' : 'vs'
        const sent = safeSend(testWindow, 'theme-updated', theme);
        if (sent) {
            testWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff')
        }
    }

    const themeListener = () => updateTheme()
    nativeTheme.on('updated', themeListener)

    testWindow.on('move', () => saveWindowState('test', testWindow.getBounds()));
    testWindow.on('resize', () => saveWindowState('test', testWindow.getBounds()));

    testWindow.on('closed', () => {
        nativeTheme.off('updated', themeListener)
        testWindow = null
    })

    testWindow.once('ready-to-show', () => {
        testWindow.show();
    });

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

    const rootContent = projectFiles[rootPath];
    if (!rootContent) {
        console.error('Root file content not found for path:', rootPath);
        return;
    }

    try {
        const storyJson = await compileStory(rootContent, rootPath, projectFiles);
        safeSend(testWindow, 'start-story', storyJson);
    } catch (e) {
        console.error('Test compilation failed:', e);
        safeSend(testWindow, 'compilation-error', e.message);
    }
}
