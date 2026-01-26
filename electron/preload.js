const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    onFileOpened: (callback) => ipcRenderer.on('file-opened', (_event, value) => callback(value)),
    loadSettings: () => ipcRenderer.invoke('load-settings'),
    onUpdateSpellLocale: (callback) => ipcRenderer.on('update-spell-locale', (_event, value) => callback(value)),
    onRootInkLoaded: (callback) => ipcRenderer.on('root-ink-loaded', (_event, value) => callback(value)),
    onProjectLoaded: (callback) => ipcRenderer.on('project-loaded', (_event, value) => callback(value)),
    onSaveAll: (callback) => ipcRenderer.on('save-all', (_event, ...args) => callback(...args)),
    onSaveAndExit: (callback) => ipcRenderer.on('save-and-exit', (_event, ...args) => callback(...args)),
    saveFiles: (files) => ipcRenderer.invoke('save-files', files),
    compileInk: (content, filePath, projectFiles) => ipcRenderer.invoke('compile-ink', content, filePath, projectFiles),
    autoTagInk: (content, filePath, projectFiles) => ipcRenderer.invoke('auto-tag-ink', content, filePath, projectFiles),
    onThemeUpdated: (callback) => ipcRenderer.on('theme-updated', (_event, value) => callback(value)),
    log: (...args) => ipcRenderer.send('renderer-log', ...args),
    openProject: () => ipcRenderer.invoke('open-project'),
    openInkRoot: () => ipcRenderer.invoke('open-ink-root'),
    createInkRoot: () => ipcRenderer.invoke('create-ink-root'),
    newProject: () => ipcRenderer.invoke('new-project'),
    selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
    createNewProject: (name, parentPath) => ipcRenderer.invoke('create-new-project', name, parentPath),
    onShowNewProjectModal: (callback) => ipcRenderer.on('show-new-project-modal', (_event, value) => callback(value)),
    createNewInclude: (name, folderPath) => ipcRenderer.invoke('create-new-include', name, folderPath),
    onShowNewIncludeModal: (callback) => ipcRenderer.on('show-new-include-modal', (_event, value) => callback(value)),
    openNewIncludeUI: () => ipcRenderer.invoke('open-new-include-ui'),
    deleteInclude: (filePath) => ipcRenderer.invoke('delete-include', filePath), // Deprecated but kept for safety if needed, though removed from main
    removeInclude: (filePath) => ipcRenderer.invoke('remove-include', filePath),
    renameInclude: (oldPath, newName) => ipcRenderer.invoke('rename-include', oldPath, newName),
    renameInkRoot: (newName) => ipcRenderer.invoke('rename-ink-root', newName),
    createNewInkRoot: (name, folderPath) => ipcRenderer.invoke('create-new-ink-root', name, folderPath),
    openNewInkRootUI: () => ipcRenderer.invoke('open-new-ink-root-ui'),
    onShowNewInkRootModal: (callback) => ipcRenderer.on('show-new-ink-root-modal', (_event, value) => callback(value)),
    chooseExistingInclude: () => ipcRenderer.invoke('choose-existing-include'),
    onCheckUnsaved: (callback) => ipcRenderer.on('check-unsaved', (_event) => callback()),
    sendUnsavedStatus: (status) => ipcRenderer.send('unsaved-status', status),
    sendSaveExitComplete: () => ipcRenderer.send('save-exit-complete'),
    sendSaveExitComplete: () => ipcRenderer.send('save-exit-complete'),
    startTest: (rootPath, projectFiles, knotName) => ipcRenderer.invoke('start-test', rootPath, projectFiles, knotName),
    onStartStory: (callback) => ipcRenderer.on('start-story', (_event, value) => callback(value)),
    onTriggerStartTest: (callback) => ipcRenderer.on('trigger-start-test', (_event) => callback()),
    onTriggerTestKnot: (callback) => ipcRenderer.on('trigger-test-knot', (_event) => callback()),
    onTriggerRestartTest: (callback) => ipcRenderer.on('trigger-restart-test', (_event) => callback()),
    onCompilationError: (callback) => ipcRenderer.on('compilation-error', (_event, message) => callback(message)),
    requestTestRestart: () => ipcRenderer.send('request-test-restart'),
    onMenuFindId: (callback) => ipcRenderer.on('menu-find-id', (_event) => callback()),
    onMenuFind: (callback) => ipcRenderer.on('menu-find', (_event) => callback()),
    onMenuReplace: (callback) => ipcRenderer.on('menu-replace', (_event) => callback()),
    onMenuFindInFiles: (callback) => ipcRenderer.on('menu-find-in-files', (_event) => callback()),
    onMenuReplaceInFiles: (callback) => ipcRenderer.on('menu-replace-in-files', (_event) => callback()),

    // Search window API
    performSearch: (query) => ipcRenderer.invoke('perform-search', query),
    navigateToResult: (data) => ipcRenderer.send('navigate-to-result', data),
    performReplaceAll: (data) => ipcRenderer.invoke('perform-replace-all', data),
    onNavigationRequested: (callback) => ipcRenderer.on('navigate-to-match', (_event, value) => callback(value)),
    onSearchRequested: (callback) => ipcRenderer.on('request-search-results', (_event, value) => callback(value)),
    sendSearchResults: (results) => ipcRenderer.send('search-results-ready', results),
    onReplaceRequested: (callback) => ipcRenderer.on('request-replace-all', (_event, value) => callback(value)),
    sendReplaceComplete: (count) => ipcRenderer.send('replace-all-complete', count),

    // Search window specific
    onFocusSearchInput: (callback) => ipcRenderer.on('focus-search-input', (_event) => callback()),
    onClearSearchHighlights: (callback) => ipcRenderer.on('clear-search-highlights', (_event) => callback()),
    updateWindowTitle: (details) => ipcRenderer.send('update-window-title', details),
    loadProjectDictionary: () => ipcRenderer.invoke('load-project-dictionary'),
    loadProjectCharacters: () => ipcRenderer.invoke('load-project-characters'),
    addProjectCharacter: (id) => ipcRenderer.invoke('add-project-character', id),
    addToProjectDictionary: (word) => ipcRenderer.invoke('add-to-project-dictionary', word),
    editProjectDictionary: () => ipcRenderer.invoke('edit-project-dictionary'),
    setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
    setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
    onSettingsUpdated: (callback) => ipcRenderer.on('settings-updated', (_event, value) => callback(value)),

    // Compiler path API
    getCompilerPath: () => ipcRenderer.invoke('get-compiler-path'),

    // Compilation API
    runCompile: () => ipcRenderer.invoke('run-compile'),
    onCompileOutput: (callback) => ipcRenderer.on('compile-output', (_event, value) => callback(value)),
    onCompileComplete: (callback) => ipcRenderer.on('compile-complete', (_event, value) => callback(value)),
    onShowCompileModal: (callback) => ipcRenderer.on('show-compile-modal', (_event) => callback()),

    // Project Settings API
    getProjectConfig: () => ipcRenderer.invoke('get-project-config'),
    setProjectConfig: (key, value) => ipcRenderer.invoke('set-project-config', key, value),
    onProjectConfigUpdated: (callback) => ipcRenderer.on('project-config-updated', (_event, value) => callback(value)),
    openProjectSettings: () => ipcRenderer.send('open-project-settings'),

    // Characters API
    getCharacters: () => ipcRenderer.invoke('get-characters'),
    saveCharacters: (characters) => ipcRenderer.invoke('save-characters', characters),
    openCharacters: () => ipcRenderer.send('open-characters'),
    onCharactersUpdated: (callback) => ipcRenderer.on('characters-updated', (_event) => callback())
});

window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector);
        if (element) element.innerText = text;
    };
    for (const type of ['chrome', 'node', 'electron']) {
        replaceText(`${type}-version`, process.versions[type]);
    }
});
