import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const vcLibVersion = JSON.parse(
    readFileSync(resolve('./node_modules/@wildwinter/simple-vc-lib/package.json'), 'utf-8')
).version;

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
                    define: {
                        __VC_LIB_VERSION__: JSON.stringify(vcLibVersion),
                    },
                    build: {
                        rollupOptions: {
                            external: ['inkjs', 'inkjs/full', 'electron-updater', 'jsonc-parser'],
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
