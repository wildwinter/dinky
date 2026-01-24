/**
 * Monaco Editor initialization and setup
 * Handles editor creation, theme management, and worker configuration
 */

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

/**
 * Configure Monaco's worker environment
 * Maps language labels to appropriate worker implementations
 */
export function configureMonacoWorkers() {
    self.MonacoEnvironment = {
        getWorker(_, label) {
            if (label === 'json') {
                return new jsonWorker();
            }
            if (label === 'css' || label === 'scss' || label === 'less') {
                return new cssWorker();
            }
            if (label === 'html' || label === 'handlebars' || label === 'razor') {
                return new htmlWorker();
            }
            if (label === 'typescript' || label === 'javascript') {
                return new tsWorker();
            }
            return new editorWorker();
        },
    };
}

/**
 * Determine the appropriate initial theme based on system preference
 * @returns {'dinky-dark' | 'dinky-light'}
 */
export function getInitialTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dinky-dark' : 'dinky-light';
}

/**
 * Apply theme to DOM
 * @param {string} theme - 'dinky-dark' or 'dinky-light'
 */
export function applyThemeToDOM(theme) {
    if (theme === 'dinky-light') {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    } else {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    }
}

/**
 * Create and configure the Monaco editor instance
 * @param {string} containerId - ID of the DOM element to mount the editor
 * @param {string} initialTheme - Initial theme to apply
 * @returns {typeof import('monaco-editor').editor.IStandaloneCodeEditor}
 */
export function createEditor(containerId, initialTheme) {
    const editor = monaco.editor.create(document.getElementById(containerId), {
        value: '',
        language: 'ink',
        theme: initialTheme,
        automaticLayout: true,
        readOnly: true,
        glyphMargin: true
    });

    return editor;
}

/**
 * Setup theme change listener
 * @param {Function} onThemeChange - Callback when theme changes
 */
export function setupThemeListener(onThemeChange) {
    window.electronAPI.onThemeUpdated((theme) => {
        const newTheme = theme === 'vs' ? 'dinky-light' : 'dinky-dark';
        monaco.editor.setTheme(newTheme);
        applyThemeToDOM(newTheme);
        if (onThemeChange) {
            onThemeChange(newTheme);
        }
    });
}

export { monaco };
