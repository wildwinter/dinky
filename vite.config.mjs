import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                test: 'test-window.html',
                search: 'search.html',
                settings: 'settings.html',
                projectSettings: 'project-settings.html',
                characters: 'characters.html'
            }
        }
    },
    plugins: [
        electron([
            {
                // Main-Process entry file of the Electron App.
                entry: 'electron/main.js',
                vite: {
                    build: {
                        rollupOptions: {
                            external: ['inkjs', 'inkjs/full'],
                        },
                    },
                },
            },
            {
                entry: 'electron/preload.js',
                onstart(options) {
                    // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete, 
                    // instead of restarting the entire Electron App.
                    options.reload()
                },
            },
        ]),
        renderer(),
    ],
})
