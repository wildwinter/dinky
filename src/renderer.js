import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { DinkySpellChecker } from './spellchecker';
import { IdPreservationManager } from './id-manager';
import { ModalHelper } from './modal-helper';

import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Add platform-specific CSS class
if (window.electronAPI.platform === 'win32') {
    document.body.classList.add('windows');
} else if (window.electronAPI.platform === 'darwin') {
    document.body.classList.add('macos');
} else {
    document.body.classList.add('linux');
}

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

// ModalHelper moved to ./modal-helper.js



// Define custom themes
monaco.editor.defineTheme('dinky-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: 'code', foreground: 'C586C0' }, // Magenta
        { token: 'dinky.name', foreground: 'D7BA7D' }, // Gold
        { token: 'dinky.qualifier', foreground: '6A9955', fontStyle: 'italic' }, // Green Italic
        { token: 'dinky.direction', foreground: '569CD6', fontStyle: 'italic' }, // Blue Italic
        { token: 'dinky.text', foreground: '9CDCFE' }, // Light Blue
    ],
    colors: {}
});

monaco.editor.defineTheme('dinky-light', {
    base: 'vs',
    inherit: true,
    rules: [
        { token: 'code', foreground: '800080' }, // Purple
        { token: 'dinky.name', foreground: '795E26' }, // Dark Gold
        { token: 'dinky.qualifier', foreground: '008000', fontStyle: 'italic' }, // Green Italic
        { token: 'dinky.direction', foreground: '0000FF', fontStyle: 'italic' }, // Blue Italic
        { token: 'dinky.text', foreground: '001080' }, // Dark Blue
    ],
    colors: {}
});

// Common Tokenizer Pattern Parts
const commonInkStates = {
    codeMode: [
        [/\/\/.*$/, 'comment', '@pop'],
        [/\/\*/, 'comment', '@comment'],
        [/[^/*]+$/, 'code', '@pop'],
        [/\/(?!\/|\*)$/, 'code', '@pop'],
        [/\*(?!\/)$/, 'code', '@pop'],
        [/[^/*]+/, 'code'],
        [/\//, 'code'],
        [/\*/, 'code'],
        [/$/, 'code', '@pop']
    ],
    tagMode: [
        [/\/\/.*$/, 'comment', '@pop'],
        [/\/\*/, 'comment', '@comment'],
        [/\]/, '@rematch', '@pop'],
        [/[^\]\/]+$/, 'annotation', '@pop'],
        [/\/(?!\/|\*)$/, 'annotation', '@pop'],
        [/[^\]\/]+/, 'annotation'],
        [/\/(?!\/|\*)/, 'annotation'],
        [/$/, 'annotation', '@pop']
    ],
    comment: [
        [/[^\/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[\/*]/, 'comment']
    ]
};

const standardInkRules = [
    // Comments (Top priority)
    [/\/\/.*$/, 'comment'],
    [/\/\*/, 'comment', '@comment'],

    // Code Lines - Solitary
    [/^\s*~$/, 'code'],
    [/^\s*(?:INCLUDE|VAR|CONST|LIST)$/, 'code'],

    // Code Lines - Start
    [/^\s*(?:INCLUDE|VAR|CONST|LIST)\b/, 'code', '@codeMode'],
    [/^\s*~/, 'code', '@codeMode'],

    // Code Blocks
    [/^\s*\{[^}]*$/, 'code'],
    [/^[^\{]*\}\s*$/, 'code'],
    [/\{[^\{\}]*\}/, 'code'],

    // Diverts
    [/->\s*[\w_\.]+/, 'keyword'],

    // Stitches (= Name) - Knots handled by state machine or root override
    [/^=\s*\w+/, 'type.identifier'],

    // Choices
    [/^[\*\+]+/, 'keyword'],

    // Gather points
    [/^\-/, 'keyword'],

    // Tags
    [/#(?=$)/, 'annotation'],
    [/#/, 'annotation', '@tagMode'],

    // Logic
    [/[{}]/, 'delimiter.bracket'],
    [/\w+(?=\()/, 'function'],
];

const dinkyDialogueRule = [
    // NAME (qual): (dir) Text
    /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/,
    ['white', 'dinky.name', 'white', 'dinky.qualifier', 'white', 'delimiter', 'white', 'dinky.direction', 'white', 'dinky.text']
];

const dinkyDialogueGatherRule = [
    // - NAME (qual): (dir) Text
    /^(\s*)(-)(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/,
    ['white', 'keyword', 'white', 'dinky.name', 'white', 'dinky.qualifier', 'white', 'delimiter', 'white', 'dinky.direction', 'white', 'dinky.text']
];

const dinkyDialogueBracketedRule = [
    // * [NAME (qual): (dir) Text
    /^(\s*)([\*\+-]+)(\s*)(\[)(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^\]/#]|\/(?![/*]))*)/,
    ['white', 'keyword', 'white', 'delimiter.bracket', 'white', 'dinky.name', 'white', 'dinky.qualifier', 'white', 'delimiter', 'white', 'dinky.direction', 'white', 'dinky.text']
];

monaco.languages.register({ id: 'ink' });
monaco.languages.register({ id: 'ink-dinky' });

// Ink Dinky (Global Mode)
monaco.languages.setMonarchTokensProvider('ink-dinky', {
    tokenizer: {
        root: [
            dinkyDialogueBracketedRule,
            dinkyDialogueGatherRule,
            dinkyDialogueRule,
            // Knot Header - simple highlight, no state reset in global mode
            [/^\s*={2,}.*$/, 'type.identifier'],
            ...standardInkRules
        ],
        ...commonInkStates
    }
});

// Standard Ink (Stateful)
monaco.languages.setMonarchTokensProvider('ink', {
    defaultToken: '',
    tokenizer: {
        root: [
            { include: 'normalMode' }
        ],
        knotStart: [
            // Check for #dink
            [/\s*#\s*dink(?=\s|$)/, { token: 'annotation', next: '@dinkyMode' }],
            // Comments/Whitespace don't change state
            [/\/\/.*$/, 'comment'],
            [/\/\*/, 'comment', '@comment'],
            [/\s+/, 'white'],
            // Transition to normal on anything else
            [/^/, { token: '@rematch', next: '@normalMode' }]
        ],
        dinkyMode: [
            // Knot -> Reset to knotStart
            [/^\s*={2,}.*$/, { token: 'type.identifier', next: '@knotStart' }],
            dinkyDialogueBracketedRule,
            dinkyDialogueGatherRule,
            dinkyDialogueRule,
            ...standardInkRules
        ],
        normalMode: [
            // Knot -> Reset to knotStart
            [/^\s*={2,}.*$/, { token: 'type.identifier', next: '@knotStart' }],
            ...standardInkRules
        ],
        ...commonInkStates
    }
});

// Detect initial theme based on system preference
const initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dinky-dark' : 'dinky-light';
if (initialTheme === 'dinky-light') {
    document.body.classList.add('light');
    document.body.classList.remove('dark');
} else {
    document.body.classList.add('dark');
    document.body.classList.remove('light');
}

const editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '',
    language: 'ink',
    theme: initialTheme,
    automaticLayout: true,
    readOnly: true,
    glyphMargin: true
});

const spellChecker = new DinkySpellChecker();
window.electronAPI.loadSettings().then(async settings => {
    const locale = settings.spellCheckerLocale || 'en_GB';
    await spellChecker.init(locale);
    // Check spelling for any auto-loaded project
    if (rootInkPath) {
        checkSpelling();
    }
});

// ID Preservation Manager
const idManager = new IdPreservationManager(editor, monaco);
// Decoration collection for jump highlighting
const jumpHighlightCollection = editor.createDecorationsCollection();


window.electronAPI.onSettingsUpdated(async (newSettings) => {
    if (newSettings.spellCheckerLocale) {
        await spellChecker.switchLocale(newSettings.spellCheckerLocale);
        // Clear spell check cache when locale changes
        spellCheckMarkersByLine.clear();
        lastSpellCheckedFilePath = null;
        lastSpellCheckContent = null;
        checkSpelling();
    }
});

// Rerun spellcheck on window focus to catch external dictionary edits
window.addEventListener('focus', async () => {
    if (rootInkPath) {
        console.log('Window focused, rerunning spellcheck...');
        const projectDict = await window.electronAPI.loadProjectDictionary();
        spellChecker.setPersonalDictionary(projectDict);
        // Clear spell check cache when dictionary updates
        spellCheckMarkersByLine.clear();
        lastSpellCheckedFilePath = null;
        lastSpellCheckContent = null;
        checkSpelling();
    }
});

// Initial load check - Settings not needed for this manager but kept for structure if needed later
window.electronAPI.loadSettings().then(settings => {
    // idManager settings if any
});



['ink', 'ink-dinky'].forEach(lang => {
    monaco.languages.registerCodeActionProvider(lang, {
        provideCodeActions: (model, range, context, token) => {
            const markers = context.markers;
            if (markers.length === 0) return { actions: [], dispose: () => { } };

            const actions = [];
            for (const marker of markers) {
                if (marker.source === 'dinky-validator') {
                    if (monaco.Range.containsRange(marker, range) || monaco.Range.intersectRanges(marker, range)) {
                        const invalidName = marker.code; // We stored name in code
                        if (invalidName) {
                            // Find suggestions if we have characters
                            if (projectCharacters.length > 0) {
                                const candidates = projectCharacters.map(c => c.ID);
                                // Simple distance filter
                                const suggestions = candidates
                                    .map(c => ({ name: c, dist: levenshtein(invalidName, c) }))
                                    .filter(c => c.dist <= 3) // arbitrary threshold
                                    .sort((a, b) => a.dist - b.dist)
                                    .slice(0, 3) // Top 3
                                    .map(c => c.name);

                                suggestions.forEach(s => {
                                    actions.push({
                                        title: `Change to "${s}"`,
                                        kind: 'quickfix',
                                        isPreferred: true,
                                        diagnostics: [marker],
                                        edit: {
                                            edits: [{
                                                resource: model.uri,
                                                textEdit: {
                                                    range: marker,
                                                    text: s
                                                }
                                            }]
                                        }
                                    });
                                });
                            }

                            // Add "Add character name to project" - Always available
                            actions.push({
                                title: `Add "${invalidName}" as project character`,
                                kind: 'quickfix',
                                isPreferred: false,
                                diagnostics: [marker],
                                command: {
                                    id: 'add-project-character',
                                    title: 'Add Character to Project',
                                    arguments: [invalidName]
                                }
                            });
                        }
                    }
                }
                else if (marker.source === 'spellcheck') {
                    if (monaco.Range.containsRange(marker, range) || monaco.Range.intersectRanges(marker, range)) {
                        const word = marker.code;
                        if (word) {
                            actions.push({
                                title: `Add "${word}" to dictionary`,
                                kind: 'quickfix',
                                isPreferred: false,
                                diagnostics: [marker],
                                command: {
                                    id: 'add-to-dictionary',
                                    title: 'Add to Dictionary',
                                    arguments: [word]
                                }
                            });

                            const suggestions = spellChecker.getSuggestions(word);
                            suggestions.slice(5).forEach(s => {
                                actions.push({
                                    title: `Replace with "${s}"`,
                                    kind: 'quickfix',
                                    isPreferred: true,
                                    diagnostics: [marker],
                                    edit: {
                                        edits: [{
                                            resource: model.uri,
                                            textEdit: {
                                                range: marker,
                                                text: s
                                            }
                                        }]
                                    }
                                });
                            });
                        }
                    }
                }
                else if (marker.source === 'ws-validator') {
                    if (monaco.Range.containsRange(marker, range) || monaco.Range.intersectRanges(marker, range)) {
                        const invalidTag = marker.code; // We stored tag in code
                        if (invalidTag && projectWritingStatusTags.length > 0) {
                            // Suggest all valid writing status tags
                            projectWritingStatusTags.forEach(ws => {
                                const fullTag = `#ws:${ws.wstag}`;
                                actions.push({
                                    title: `Change to "${fullTag}"`,
                                    kind: 'quickfix',
                                    isPreferred: true,
                                    diagnostics: [marker],
                                    edit: {
                                        edits: [{
                                            resource: model.uri,
                                            textEdit: {
                                                range: marker,
                                                text: fullTag
                                            }
                                        }]
                                    }
                                });
                            });
                        }
                    }
                }
            }
            return { actions: actions, dispose: () => { } };
        }
    });
});

monaco.editor.registerCommand('add-to-dictionary', async (accessor, word) => {
    spellChecker.add(word);
    await window.electronAPI.addToProjectDictionary(word);
    checkSpelling();
});

monaco.editor.registerCommand('add-project-character', async (accessor, characterId) => {
    const success = await window.electronAPI.addProjectCharacter(characterId);
    if (success) {
        // Trigger compile/validate to refresh errors
        checkSyntax();
    }
});

function checkSpelling() {
    const model = editor.getModel();
    if (!model) return;

    const currentContent = model.getValue();
    const currentFilePath = model.uri.path;
    
    // Check if content has actually changed since last spell check
    if (lastSpellCheckedFilePath === currentFilePath && lastSpellCheckContent === currentContent) {
        // Content unchanged, restore cached markers instead of rechecking
        const cachedMarkers = spellCheckMarkersByLine.get(currentFilePath);
        if (cachedMarkers && cachedMarkers.length > 0) {
            monaco.editor.setModelMarkers(model, 'spellcheck', cachedMarkers);
            // Update error banner with spell check errors if there are no compilation errors
            if (currentErrors.length === 0) {
                currentErrors = cachedMarkers;
                errorBannerIndex = 0;
                updateErrorBanner();
            }
        }
        return;
    }
    
    // Content changed - perform full spell check
    const markers = spellChecker.checkModel(model, monaco);
    
    // Cache markers for this file
    spellCheckMarkersByLine.set(currentFilePath, markers);
    lastSpellCheckedFilePath = currentFilePath;
    lastSpellCheckContent = currentContent;
    
    // Update error banner with spell check errors if there are no compilation errors
    if (currentErrors.length === 0 && markers.length > 0) {
        currentErrors = markers;
        errorBannerIndex = 0;
        updateErrorBanner();
    }
    
    monaco.editor.setModelMarkers(model, 'spellcheck', markers);
}




let loadedInkFiles = new Map();
let projectCharacters = [];
let projectWritingStatusTags = [];
let currentFilePath = null;
let rootInkPath = null;
let isUpdatingContent = false;
let lastTestKnot = null;

// Spell check optimization - track changed lines
let lastSpellCheckedFilePath = null;
let lastSpellCheckContent = null; // Content hash or full text of last spell check
let spellCheckMarkersByLine = new Map(); // filePath -> Map of line -> markers

// Error banner state
let currentErrors = []; // Array of all current errors (compilation errors + spell check)
let errorBannerIndex = 0; // Current error being displayed in the banner
let previousErrorsCount = 0; // Track previous error count to detect changes

// Navigation history for back/forward functionality
let navigationHistory = [];
let navigationHistoryIndex = -1;
let lastNavigationLocation = { filePath: null, knotName: null };
let isNavigatingHistory = false; // Flag to prevent adding history while navigating via back/forward

// Navigation structure caching for performance
let cachedNavigationStructure = null;
let navigationStructureDirty = true; // Mark as dirty when file list changes

// Error banner management functions
function updateErrorBanner() {
    const banner = document.getElementById('error-banner');
    const bannerText = document.getElementById('error-banner-text');
    const prevBtn = document.getElementById('error-banner-prev');
    const nextBtn = document.getElementById('error-banner-next');
    
    if (!currentErrors || currentErrors.length === 0) {
        banner.style.display = 'none';
        currentErrors = [];
        errorBannerIndex = 0;
        return;
    }
    
    // Reset index if out of bounds
    if (errorBannerIndex >= currentErrors.length) {
        errorBannerIndex = 0;
    }
    
    // Show the banner
    banner.style.display = 'block';
    
    const error = currentErrors[errorBannerIndex];
    const errorCount = currentErrors.length;
    const errorMessage = error.message || 'Unknown error';
    const lineNumber = error.startLineNumber ? ` [${error.startLineNumber}:${error.startColumn || 1}]` : '';
    
    // Build file info if error has a filePath
    let fileInfo = '';
    if (error.filePath) {
        // Get just the filename for display
        const filename = error.filePath.replace(/^.*[\\\/]/, '');
        fileInfo = ` in ${filename}`;
    }
    
    bannerText.textContent = `Error (${errorBannerIndex + 1}/${errorCount}): ${errorMessage}${lineNumber}${fileInfo}`;
    
    // Buttons are always enabled since navigation wraps around
    prevBtn.disabled = false;
    nextBtn.disabled = false;
}

// Helper function to find a file in loadedInkFiles, handling path format differences
function findFileByPath(errorPath) {
    if (!errorPath) return null;
    
    // Try exact match first
    if (loadedInkFiles.has(errorPath)) {
        return loadedInkFiles.get(errorPath);
    }
    
    // Normalize paths for comparison (handle separators, case sensitivity on some OS)
    const normalizePath = (p) => p.replace(/\\/g, '/').toLowerCase();
    const normalizedErrorPath = normalizePath(errorPath);
    
    // Try to find by normalized path
    for (const [storedPath, file] of loadedInkFiles) {
        if (normalizePath(storedPath) === normalizedErrorPath) {
            return file;
        }
    }
    
    // Try to match by filename if full path doesn't work
    const errorFileName = errorPath.replace(/^.*[\\\/]/, '');
    for (const [storedPath, file] of loadedInkFiles) {
        const storedFileName = storedPath.replace(/^.*[\\\/]/, '');
        if (storedFileName === errorFileName) {
            return file;
        }
    }
    
    return null;
}

// Helper function to sort errors by file path and line number
// File order matches the order of files in loadedInkFiles (root first, then includes)
function sortErrors(errors) {
    // Create a map of file paths to their order in the sidebar
    const fileOrder = new Map();
    let order = 0;
    for (const [filePath, file] of loadedInkFiles) {
        fileOrder.set(filePath, order++);
    }
    
    // Helper to find file order, handling path format differences
    function getFileOrder(errorPath) {
        if (!errorPath) return -1;
        
        // Try exact match first
        if (fileOrder.has(errorPath)) {
            return fileOrder.get(errorPath);
        }
        
        // Normalize paths for comparison
        const normalizePath = (p) => p.replace(/\\/g, '/').toLowerCase();
        const normalizedErrorPath = normalizePath(errorPath);
        
        // Try to find by normalized path
        for (const [storedPath, order] of fileOrder) {
            if (normalizePath(storedPath) === normalizedErrorPath) {
                return order;
            }
        }
        
        // Try to match by filename if full path doesn't work
        const errorFileName = errorPath.replace(/^.*[\\\/]/, '');
        for (const [storedPath, order] of fileOrder) {
            const storedFileName = storedPath.replace(/^.*[\\\/]/, '');
            if (storedFileName === errorFileName) {
                return order;
            }
        }
        
        return fileOrder.size; // Unknown files go to the end
    }
    
    return errors.slice().sort((a, b) => {
        // First, sort by file order (as shown in the sidebar)
        const orderA = getFileOrder(a.filePath);
        const orderB = getFileOrder(b.filePath);
        
        if (orderA !== orderB) {
            return orderA - orderB;
        }
        
        // If same file, sort by line number
        const lineA = a.startLineNumber || 0;
        const lineB = b.startLineNumber || 0;
        
        return lineA - lineB;
    });
}

function navigateToBannerError() {
    if (!currentErrors || currentErrors.length === 0) return;
    
    const error = currentErrors[errorBannerIndex];
    if (!error) return;
    
    // Check if error is in a different file
    if (error.filePath && error.filePath !== currentFilePath) {
        const file = findFileByPath(error.filePath);
        if (file && file.listItem) {
            // Click the file in the list to switch to it
            file.listItem.click();
            // Wait for the file to load and model to be swapped before navigating
            // Use a longer timeout to ensure model swap completes
            setTimeout(() => {
                const line = error.startLineNumber || 1;
                const column = error.startColumn || 1;
                const model = editor.getModel();
                if (model) {
                    editor.revealLineInCenter(line);
                    editor.setPosition({ lineNumber: line, column: column });
                    editor.focus();
                }
            }, 200);
            return;
        }
    }
    
    // Navigate to the error location in current file
    const line = error.startLineNumber || 1;
    const column = error.startColumn || 1;
    
    if (editor && editor.getModel()) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: column });
        editor.focus();
    }
}

function previousError() {
    if (currentErrors.length === 0) return;
    errorBannerIndex = (errorBannerIndex - 1 + currentErrors.length) % currentErrors.length;
    updateErrorBanner();
    navigateToBannerError();
}

function nextError() {
    if (currentErrors.length === 0) return;
    errorBannerIndex = (errorBannerIndex + 1) % currentErrors.length;
    updateErrorBanner();
    navigateToBannerError();
}

function closeErrorBanner() {
    currentErrors = [];
    errorBannerIndex = 0;
    updateErrorBanner();
}
// Model pooling for efficient reuse of Monaco editor models
const modelPool = new Map(); // filePath -> MonacoModel
const MAX_POOLED_MODELS = 5; // Keep up to 5 models in memory
let pooledModelOrder = []; // Track LRU order

function getOrCreateModel(filePath, content, langId) {
    // Check if model exists in pool
    if (modelPool.has(filePath)) {
        const model = modelPool.get(filePath);
        // Update LRU order
        pooledModelOrder = pooledModelOrder.filter(p => p !== filePath);
        pooledModelOrder.push(filePath);
        return model;
    }

    // Create new model
    const newModel = monaco.editor.createModel(content, langId);
    
    // Add to pool and track order
    modelPool.set(filePath, newModel);
    pooledModelOrder.push(filePath);
    
    // Evict oldest model if pool exceeds max size
    if (modelPool.size > MAX_POOLED_MODELS) {
        const oldestPath = pooledModelOrder.shift();
        const oldModel = modelPool.get(oldestPath);
        if (oldModel) {
            oldModel.dispose();
        }
        modelPool.delete(oldestPath);
    }
    
    return newModel;
}

function clearModelPool() {
    // Dispose all pooled models
    for (const [filePath, model] of modelPool) {
        if (model) {
            model.dispose();
        }
    }
    modelPool.clear();
    pooledModelOrder = [];
}

document.getElementById('btn-load-project').addEventListener('click', () => {
    window.electronAPI.openProject();
});

document.getElementById('btn-new-project').addEventListener('click', () => {
    window.electronAPI.newProject();
});

document.getElementById('btn-select-compiler-path').addEventListener('click', async () => {
    await window.electronAPI.selectCompiler();
});

document.getElementById('btn-set-ink-root').addEventListener('click', () => {
    window.electronAPI.openInkRoot();
});

document.getElementById('btn-create-ink-root').addEventListener('click', () => {
    window.electronAPI.createInkRoot();
});

// Error banner event listeners
document.getElementById('error-banner-prev').addEventListener('click', previousError);
document.getElementById('error-banner-next').addEventListener('click', nextError);
document.getElementById('error-banner-close').addEventListener('click', closeErrorBanner);
document.getElementById('error-banner-text').addEventListener('click', navigateToBannerError);

window.electronAPI.onProjectLoaded(({ hasRoot }) => {
    if (!hasRoot) {
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('no-root-state').style.display = 'flex';
        document.getElementById('editor-container').style.display = 'none';
    } else {
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('no-root-state').style.display = 'none';
        // editor-container will be shown by onRootInkLoaded
    }
});

window.electronAPI.onRootInkLoaded(async (files) => {
    // Load project dictionary
    const projectDict = await window.electronAPI.loadProjectDictionary();
    spellChecker.setPersonalDictionary(projectDict);

    loadedInkFiles.clear();
    // Clear model pool when loading new project
    clearModelPool();
    // Clear spell check cache when loading new project
    spellCheckMarkersByLine.clear();
    lastSpellCheckedFilePath = null;
    lastSpellCheckContent = null;
    // Invalidate navigation structure cache when files change
    navigationStructureDirty = true;
    cachedNavigationStructure = null;
    
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    const rootFileStepInfo = document.getElementById('ink-root-file-item');

    // Toggle view
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('no-root-state').style.display = 'none';
    const editorContainer = document.getElementById('editor-container');
    editorContainer.style.display = 'block';
    // Defer layout to next frame to batch with other DOM updates
    requestAnimationFrame(() => {
        editor.layout();
    });

    if (files.length > 0) {
        rootInkPath = files[0].absolutePath;
        editor.updateOptions({ readOnly: false });
    }

    files.forEach((file, index) => {
        file.originalContent = file.content;
        loadedInkFiles.set(file.absolutePath, file);

        if (index === 0) {
            // Root File
            file.listItem = rootFileStepInfo;
            rootFileStepInfo.textContent = file.relativePath;

            rootFileStepInfo.onclick = () => {
                loadFileToEditor(file, rootFileStepInfo, false);
            };

            // Initial load
            loadFileToEditor(file, rootFileStepInfo, true);
        } else {
            // Include Files
            const li = document.createElement('li');
            file.listItem = li;
            li.textContent = file.relativePath;

            li.onclick = () => {
                loadFileToEditor(file, li);
            };
            fileList.appendChild(li);
        }
    });

    if (rootInkPath) {
        checkSyntax();
        checkSpelling();
        updateNavigationDropdown();
    }
});


// -- Rename Include Logic --
let currentRenamePath = null;
const renameIncludeModal = new ModalHelper({
    overlayId: 'modal-rename-include-overlay',
    confirmBtnId: 'btn-confirm-rename',
    cancelBtnId: 'btn-cancel-rename',
    onShow: (filePath) => {
        currentRenamePath = filePath;
        const parts = currentRenamePath.split(/[/\\]/);
        const fileName = parts[parts.length - 1];
        document.getElementById('rename-include-name').value = fileName.replace(/\.ink$/i, '');
    },
    onValidate: () => !!document.getElementById('rename-include-name').value.trim(),
    onConfirm: async () => {
        const newName = document.getElementById('rename-include-name').value.trim();
        if (currentRenamePath && newName) {
            return await window.electronAPI.renameInclude(currentRenamePath, newName);
        }
        return false;
    },
    onCancel: () => { currentRenamePath = null; }
});

document.getElementById('rename-include-name').addEventListener('input', () => renameIncludeModal.validate());

document.getElementById('btn-rename-include').addEventListener('click', () => {
    if (!currentFilePath) return;
    renameIncludeModal.open(currentFilePath);
});


// -- Rename Root Logic --
const renameRootModal = new ModalHelper({
    overlayId: 'modal-rename-root-overlay',
    confirmBtnId: 'btn-confirm-rename-root',
    cancelBtnId: 'btn-cancel-rename-root',
    onShow: () => {
        if (!rootInkPath) return;
        const parts = rootInkPath.split(/[/\\]/);
        const fileName = parts[parts.length - 1];
        document.getElementById('rename-root-name').value = fileName.replace(/\.ink$/i, '');
    },
    onValidate: () => !!document.getElementById('rename-root-name').value.trim(),
    onConfirm: async () => {
        const newName = document.getElementById('rename-root-name').value.trim();
        if (newName) {
            return await window.electronAPI.renameInkRoot(newName);
        }
        return false;
    }
});

document.getElementById('rename-root-name').addEventListener('input', () => renameRootModal.validate());

document.getElementById('btn-rename-root').addEventListener('click', () => {
    if (!rootInkPath) return;
    renameRootModal.open();
});


// -- New Ink Root Logic --
const newInkRootModal = new ModalHelper({
    overlayId: 'modal-new-ink-root-overlay',
    confirmBtnId: 'btn-confirm-new-ink-root',
    cancelBtnId: 'btn-cancel-new-ink-root',
    onShow: (defaultFolder) => {
        document.getElementById('new-ink-root-name').value = '';
        document.getElementById('new-ink-root-folder').value = defaultFolder || '';
    },
    onValidate: () => {
        const name = document.getElementById('new-ink-root-name').value.trim();
        const folder = document.getElementById('new-ink-root-folder').value.trim();
        return name && folder;
    },
    onConfirm: async () => {
        const name = document.getElementById('new-ink-root-name').value.trim();
        const folder = document.getElementById('new-ink-root-folder').value.trim();
        return await window.electronAPI.createNewInkRoot(name, folder);
    }
});

const inputNewInkRootName = document.getElementById('new-ink-root-name');
inputNewInkRootName.addEventListener('input', () => newInkRootModal.validate());

window.electronAPI.onShowNewInkRootModal((defaultFolder) => {
    newInkRootModal.open(defaultFolder);
});

document.getElementById('btn-select-ink-root-folder').addEventListener('click', async () => {
    const input = document.getElementById('new-ink-root-folder');
    const path = await window.electronAPI.selectFolder(input.value);
    if (path) {
        input.value = path;
        newInkRootModal.validate();
    }
});

document.getElementById('btn-add-ink-root').addEventListener('click', () => {
    window.electronAPI.openNewInkRootUI();
});


document.getElementById('btn-switch-ink-root').addEventListener('click', () => {
    window.electronAPI.openInkRoot();
});


// -- Find ID Logic --
const findIdModal = new ModalHelper({
    overlayId: 'modal-find-id-overlay',
    confirmBtnId: 'btn-confirm-find-id',
    cancelBtnId: 'btn-cancel-find-id',
    onShow: () => {
        document.getElementById('find-id-input').value = '';
        document.getElementById('find-id-error').textContent = '';
    },
    onValidate: () => true, // Always allow clicking Go, we validate in confirm
    onConfirm: async () => {
        const idToFind = document.getElementById('find-id-input').value.trim();
        const errorEl = document.getElementById('find-id-error');
        errorEl.textContent = '';

        if (!idToFind) return false;

        // Search through loaded files
        let found = false;

        for (const [path, file] of loadedInkFiles) {
            let content = file.content;
            if (path === currentFilePath) {
                // Reconstruct IDs from editor content since they are stripped for display
                content = idManager.reconstructContent(editor.getValue());
            }

            // Extract IDs from this content
            // We use extractIds from idManager, which is stateless for extraction
            const { extractedIds } = idManager.extractIds(content);

            const match = extractedIds.find(item => item.id === idToFind);

            if (match) {
                found = true;

                // Switch to the file containing the ID if needed
                if (path !== currentFilePath) {
                    if (file.listItem) {
                        file.listItem.click();
                    }
                }

                // Focus the line containing the ID (convert from 0-based to 1-based)
                const lineNum = match.lineIndex + 1;

                // Reveal and select
                editor.revealLineInCenter(lineNum);
                editor.setPosition({ lineNumber: lineNum, column: 1 });
                editor.focus();

                // Highlight the line
                jumpHighlightCollection.set([{
                    range: new monaco.Range(lineNum, 1, lineNum, 1),
                    options: {
                        isWholeLine: true,
                        className: 'jump-highlight-line'
                    }
                }]);

                break;
            }
        }

        if (!found) {
            errorEl.textContent = 'ID not found';
            return false; // Keep modal open
        }

        return true; // Close modal
    }
});

document.getElementById('find-id-input').addEventListener('keydown', (e) => {
    // Clear error on type
    document.getElementById('find-id-error').textContent = '';
});

window.electronAPI.onMenuFindId(() => {
    findIdModal.open();
});

// Compile Modal
const compileModalOverlay = document.getElementById('modal-compile-overlay');
const compileOutput = document.getElementById('compile-output');
const compileOutputContainer = document.getElementById('compile-output-container');
const btnCloseCompile = document.getElementById('btn-close-compile');

async function openCompileModal() {
    compileModalOverlay.style.display = 'flex';
    compileOutput.textContent = '';
    btnCloseCompile.disabled = true;

    // Reset scroll to top
    compileOutputContainer.scrollTop = 0;

    // Save all files before compiling
    compileOutput.textContent = 'Saving files...\n';
    try {
        await saveAllFiles();
        compileOutput.textContent += 'Files saved.\n\n';
    } catch (error) {
        compileOutput.textContent = `Error saving files: ${error.message}\n`;
        btnCloseCompile.disabled = false;
        return;
    }

    // Start compilation
    const result = await window.electronAPI.runCompile();

    // If compilation failed to start, show error and enable close button
    if (result && !result.success) {
        compileOutput.textContent += `Error: ${result.error}\n`;
        btnCloseCompile.disabled = false;
        compileOutputContainer.scrollTop = compileOutputContainer.scrollHeight;
    }
}

function closeCompileModal() {
    compileModalOverlay.style.display = 'none';
    compileOutput.textContent = '';
}

btnCloseCompile.addEventListener('click', () => {
    closeCompileModal();
});

// Escape key to close (only when enabled)
compileModalOverlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !btnCloseCompile.disabled) {
        closeCompileModal();
    }
});

window.electronAPI.onShowCompileModal(() => {
    openCompileModal();
});

window.electronAPI.onCompileOutput(({ type, data }) => {
    const outputEl = document.getElementById('compile-output');
    const container = document.getElementById('compile-output-container');
    outputEl.textContent += data;

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
});

window.electronAPI.onCompileComplete(({ code, destFolder }) => {
    const outputEl = document.getElementById('compile-output');
    const container = document.getElementById('compile-output-container');

    // Add spacing
    outputEl.textContent += '\n\n';

    // Add colored status message
    const statusSpan = document.createElement('span');
    statusSpan.style.fontWeight = 'bold';
    statusSpan.style.fontSize = '14px';
    statusSpan.style.display = 'block';
    statusSpan.style.padding = '5px';
    statusSpan.style.marginTop = '5px';
    statusSpan.style.marginBottom = '5px';
    statusSpan.style.borderRadius = '3px';

    if (code === 0) {
        statusSpan.textContent = '✓ COMPILE SUCCESSFUL';
        statusSpan.style.color = '#4CAF50';
        statusSpan.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        statusSpan.style.border = '1px solid #4CAF50';
    } else {
        statusSpan.textContent = `✗ COMPILE FAILED (Exit Code: ${code})`;
        statusSpan.style.color = '#f44336';
        statusSpan.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
        statusSpan.style.border = '1px solid #f44336';
    }

    // Append the status message
    outputEl.appendChild(statusSpan);
    outputEl.appendChild(document.createTextNode('\n'));

    // Add output folder location if compilation was successful
    if (code === 0 && destFolder) {
        outputEl.appendChild(document.createTextNode(`Files are available in ${destFolder}`));
    }

    // Enable close button
    btnCloseCompile.disabled = false;

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
});

// Update loadFileToEditor to handle rename button state
function loadFileToEditor(file, element, forceRefresh = false) {
    // UI updates: remove active class from everything
    document.getElementById('ink-root-file-item').classList.remove('active');
    const fileList = document.getElementById('file-list');
    Array.from(fileList.children).forEach(c => c.classList.remove('active'));

    // Add active to current
    element.classList.add('active');

    // Update delete and rename button states
    // Use setTimeout to ensure this runs after any potential file reloads (though async nature of list loading usually handles this)
    // Actually, simple sync update is fine here as we just clicked an element
    const isRoot = (file.absolutePath === rootInkPath);

    // Update delete state
    updateDeleteButtonState(isRoot);

    // Update rename state (same logic as delete: only for includes)
    const renameBtn = document.getElementById('btn-rename-include');
    if (isRoot) {
        renameBtn.style.opacity = '0.5';
        renameBtn.style.pointerEvents = 'none';
    } else {
        renameBtn.style.opacity = '1';
        renameBtn.style.pointerEvents = 'auto';
    }

    if (!forceRefresh && currentFilePath === file.absolutePath) return;

    window.electronAPI.updateWindowTitle({ fileName: file.relativePath });

    isUpdatingContent = true;
    // Save existing file state before switching
    // BUG FIX: Don't save if we are force-refreshing the SAME file, 
    // because that means we want the NEW content from disk, not the STALE content from the editor.
    if (currentFilePath && loadedInkFiles.has(currentFilePath) && !(forceRefresh && currentFilePath === file.absolutePath)) {
        const currentContent = editor.getValue();
        // Reconstruct with IDs before saving to memory
        const fullContent = idManager.reconstructContent(currentContent);
        loadedInkFiles.get(currentFilePath).content = fullContent;
    }

    currentFilePath = file.absolutePath;

    // ATOMIC MODEL SWAP STRATEGY with pooling
    const oldModel = editor.getModel();

    // Extract IDs and clean content
    const { cleanContent, extractedIds } = idManager.extractIds(file.content);

    // Get or create model from pool (reuses existing models when available)
    const isDinky = detectDinkyGlobal(cleanContent);
    const langId = isDinky ? 'ink-dinky' : 'ink';
    const newModel = getOrCreateModel(file.absolutePath, cleanContent, langId);

    // Swap the model
    editor.setModel(newModel);

    // Apply decorations to track the IDs
    idManager.setupDecorations(extractedIds);

    // Return old model to pool instead of immediately disposing
    // This preserves its state for quick reuse when switching back
    if (oldModel && oldModel.uri.path !== newModel.uri.path) {
        // Old model is different, keep it in pool for later reuse
        // Don't dispose it immediately - the pool will manage lifecycle
    }

    // Reset spell check cache when switching files
    lastSpellCheckedFilePath = null;
    lastSpellCheckContent = null;

    isUpdatingContent = false;

    // Defer non-critical operations to keep UI responsive immediately after model swap
    // Use requestIdleCallback for background checks that don't block interaction
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            checkSyntax();
            checkSpelling();
            autoTag();
            refreshNavigationDropdown();
        });
    } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => {
            checkSyntax();
            checkSpelling();
            autoTag();
            refreshNavigationDropdown();
        }, 0);
    }
    
    // Track navigation when switching files (but not if we're in the middle of back/forward navigation)
    if (!isNavigatingHistory) {
        addToNavigationHistory(file.absolutePath, 1);
    }
    
    // Update last navigation location to the file start
    lastNavigationLocation = { filePath: file.absolutePath, knotName: null };
}

function updateDeleteButtonState(isRoot) {
    // Logic for Include buttons
    const deleteBtn = document.getElementById('btn-delete-include');
    if (isRoot) {
        deleteBtn.title = "Delete Include (Disabled for Root)";
        deleteBtn.style.opacity = '0.5';
        deleteBtn.style.pointerEvents = 'none';
    } else {
        deleteBtn.title = "Remove Include...";
        deleteBtn.style.opacity = '1';
        deleteBtn.style.pointerEvents = 'auto';
    }

    // Logic for Rename Root button
    const renameRootBtn = document.getElementById('btn-rename-root');
    if (rootInkPath) {
        renameRootBtn.style.opacity = '1';
        renameRootBtn.style.pointerEvents = 'auto';
    } else {
        renameRootBtn.style.opacity = '0.5';
        renameRootBtn.style.pointerEvents = 'none';
    }

}



// Debounce helper
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function getProjectFilesContent() {
    const projectFiles = {};
    for (const [path, file] of loadedInkFiles) {
        projectFiles[path] = file.content;
    }
    return projectFiles;
}

async function checkSyntax() {
    if (!rootInkPath) return;

    const projectFiles = getProjectFilesContent();
    const rootFileObj = loadedInkFiles.get(rootInkPath);
    if (!rootFileObj) return;

    const contentToCompile = rootFileObj.content;

    try {
        // Load characters on compile (dynamic update)
        try {
            projectCharacters = await window.electronAPI.loadProjectCharacters();
        } catch (e) {
            console.error('Failed to load project characters', e);
            projectCharacters = [];
        }

        // Load writing status tags from project config
        try {
            const projectConfig = await window.electronAPI.getProjectConfig();
            projectWritingStatusTags = (projectConfig && projectConfig.writingStatus) || [];
        } catch (e) {
            console.error('Failed to load writing status tags', e);
            projectWritingStatusTags = [];
        }

        const errors = await window.electronAPI.compileInk(contentToCompile, rootInkPath, projectFiles);


        const model = editor.getModel();
        if (model) {


            // Filter errors to display only those relevant to the current file (for Monaco markers)
            const visibleErrors = errors.filter(e => {
                if (!e.filePath) return true;

                const activePath = currentFilePath || rootInkPath;

                // Exact match
                if (e.filePath === activePath) return true;

                // Loose match: check if filename matches
                // currentFilePath is absolute, e.filePath might be relative
                // Simple heuristic: does one end with the other?
                // Or just match basenames
                if (activePath) {
                    const currentFileName = activePath.replace(/^.*[\\\/]/, '');
                    const errorFileName = e.filePath.replace(/^.*[\\\/]/, '');
                    return currentFileName === errorFileName;
                }

                return false;
            });

            // Run Dinky Character Validation for all files
            let allCharErrors = [];
            for (const [filePath, fileObj] of loadedInkFiles) {
                const charErrors = validateCharacterNamesInText(fileObj.content);
                // Add filePath to each character error
                const charErrorsWithPath = charErrors.map(err => ({
                    ...err,
                    filePath: filePath
                }));
                allCharErrors = allCharErrors.concat(charErrorsWithPath);
            }

            // Run Writing Status Tag Validation for all files
            let allWsErrors = [];
            for (const [filePath, fileObj] of loadedInkFiles) {
                const wsErrors = validateWritingStatusTagsInText(fileObj.content);
                // Add filePath to each writing status error
                const wsErrorsWithPath = wsErrors.map(err => ({
                    ...err,
                    filePath: filePath
                }));
                allWsErrors = allWsErrors.concat(wsErrorsWithPath);
            }

            // For Monaco markers, only show character errors for the current file
            const currentFileCharErrors = validateCharacterNames(model);

            // For Monaco markers, only show writing status errors for the current file
            const currentFileWsErrors = validateWritingStatusTags(model);

            // Update error banner with ALL errors from all files (compilation + character validation + writing status validation)
            const newErrors = sortErrors([...(errors || []), ...allCharErrors, ...allWsErrors]);
            
            // Update banner index intelligently
            if (newErrors.length !== previousErrorsCount) {
                // Error count changed, try to show an error in the current file, preferably near the cursor
                const position = editor.getPosition();
                const cursorLine = position ? position.lineNumber : -1;
                
                // Get the file object for the current file using the same path-matching that works for navigation
                const currentFileObj = findFileByPath(currentFilePath);
                
                // Find all errors in the current file using the same matching strategy as findFileByPath
                const errorsInCurrentFile = newErrors.filter(err => {
                    if (!err.filePath) return false;
                    const errorFileObj = findFileByPath(err.filePath);
                    return errorFileObj === currentFileObj;
                });
                
                if (errorsInCurrentFile.length > 0) {
                    // Prioritize errors in the current file
                    // Try to find one on the cursor line first
                    let selectedErrorIndex = errorsInCurrentFile.findIndex(err => err.startLineNumber === cursorLine);
                    
                    // If no error on exact cursor line, find the closest one
                    if (selectedErrorIndex === -1) {
                        let closestError = 0;
                        let minDistance = Math.abs(errorsInCurrentFile[0].startLineNumber - cursorLine);
                        
                        for (let i = 1; i < errorsInCurrentFile.length; i++) {
                            const distance = Math.abs(errorsInCurrentFile[i].startLineNumber - cursorLine);
                            if (distance < minDistance) {
                                minDistance = distance;
                                closestError = i;
                            }
                        }
                        selectedErrorIndex = closestError;
                    }
                    
                    // Find the index of this error in the full sorted list
                    const selectedError = errorsInCurrentFile[selectedErrorIndex];
                    errorBannerIndex = newErrors.findIndex(err => 
                        err === selectedError
                    );
                } else {
                    // No errors in current file, show the first error
                    errorBannerIndex = 0;
                }
                previousErrorsCount = newErrors.length;
            }
            
            currentErrors = newErrors;
            updateErrorBanner();

            // Update Monaco markers with visible errors + character errors + writing status errors for current file
            monaco.editor.setModelMarkers(model, 'ink', [...(visibleErrors || []), ...currentFileCharErrors, ...currentFileWsErrors]);
        }
    } catch (e) {
        window.electronAPI.log('checkSyntax failed:', e.toString())
    }
}


async function autoTag() {
    if (!rootInkPath || !currentFilePath) return;

    // Use current content
    const content = editor.getValue();
    const projectFiles = getProjectFilesContent();
    // Pass reconstructed content (with existing IDs) to tagger
    // This ensures we generating IDs for lines that truly don't have them
    const reconstructedContent = idManager.reconstructContent(content);

    try {
        const edits = await window.electronAPI.autoTagInk(reconstructedContent, currentFilePath, projectFiles);
        if (edits && edits.length > 0) {
            edits.forEach(edit => {
                console.log('[AutoTag] Edit for:', edit.file, 'Current:', currentFilePath);
                // Register the new ID.
                // edit.line is 1-based.
                // edit.newId is the ID string (e.g. "prefix_1234")
                // We don't modify the text, just start tracking it.
                idManager.addId(edit.line, edit.newId);
            });
        }

    } catch (e) {
        window.electronAPI.log('autoTag failed:', e.toString());
    }
}

const debouncedCheck = debounce(checkSyntax, 1000);
const debouncedCheckSpelling = debounce(checkSpelling, 400);
const debouncedAutoTag = debounce(autoTag, 2000);
const debouncedDinkyModeCheck = debounce(() => {
    const text = editor.getValue();
    const isDinky = detectDinkyGlobal(text);
    const model = editor.getModel();
    if (model) {
        const currentLang = model.getLanguageId();
        const targetLang = isDinky ? 'ink-dinky' : 'ink';
        if (currentLang !== targetLang) {
            monaco.editor.setModelLanguage(model, targetLang);
        }
    }
}, 500);

editor.onDidChangeModelContent(() => {
    if (isUpdatingContent) return;

    // Clear spellcheck markers immediately to avoid visual desync during editing
    const model = editor.getModel();
    if (model) {
        monaco.editor.setModelMarkers(model, 'spellcheck', []);
    }

    // Clear jump highlight on edit
    jumpHighlightCollection.clear();

    // Keep the file model in sync with editor content immediately
    // Note: We sync the CLEAN content here. IDs are only reconstructed on save/switch.
    if (currentFilePath && loadedInkFiles.has(currentFilePath)) {
        const file = loadedInkFiles.get(currentFilePath);
        file.content = editor.getValue();

        if (file.listItem) {
            const isModified = file.content !== file.originalContent;
            file.listItem.textContent = file.relativePath + (isModified ? '*' : '');
        }
    }

    // Check for global dinky mode switch
    debouncedDinkyModeCheck();

    debouncedCheck();
    debouncedCheckSpelling();
    debouncedAutoTag();

    // Invalidate navigation structure cache when content changes (knots/stitches may be added/removed)
    navigationStructureDirty = true;
    // Update navigation dropdown structure when content changes
    updateNavigationDropdown();
});

// Dinky Mode Detection
function detectDinkyGlobal(text) {
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        // Check for Knot first (stops the search for global tag)
        if (/^={2,}/.test(trimmed)) {
            return false;
        }
        // Check for #dink
        if (/#\s*dink(?=\s|$)/.test(trimmed)) {
            return true;
        }
    }
    return false;
}

function isDinkyAtPosition(model, position) {
    // 1. Check global dinky mode
    if (detectDinkyGlobal(model.getValue())) {
        return true;
    }

    // 2. Check local dinky mode (following a knot)
    for (let i = position.lineNumber; i >= 1; i--) {
        const line = model.getLineContent(i).trim();

        // If we hit a knot boundary
        if (/^={2,}/.test(line)) {
            // Check if this knot line itself or immediately following lines (before other content) has #dink
            // Simplified: check if the knot line has #dink
            if (/#\s*dink(?=\s|$)/.test(line)) {
                return true;
            }

            // If it's just a knot without #dink, we are in normal mode for this section
            return false;
        }

        // Check if there's a #dink tag on a line by itself or after some content (but before the next knot)
        if (/#\s*dink(?=\s|$)/.test(line)) {
            return true;
        }
    }

    return false;
}

monaco.languages.registerCompletionItemProvider('ink', {
    triggerCharacters: [':'],
    provideCompletionItems: (model, position) => {
        const isDinky = isDinkyAtPosition(model, position);
        console.log('[Autocomplete] Triggered at', position.lineNumber, 'IsDinky:', isDinky);

        if (!isDinky) {
            return { suggestions: [] };
        }

        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        console.log('[Autocomplete] Text before cursor:', `'${textBeforeCursor}'`);

        if (!/^\s*:$/.test(textBeforeCursor)) {
            return { suggestions: [] };
        }

        console.log('[Autocomplete] Providing suggestions. Count:', projectCharacters.length);

        const range = new monaco.Range(
            position.lineNumber,
            lineContent.indexOf(':') + 1,
            position.lineNumber,
            position.column
        );

        const suggestions = projectCharacters.map(char => ({
            label: char.ID,
            kind: monaco.languages.CompletionItemKind.User,
            insertText: `${char.ID}: `,
            range: range,
            detail: char.Name || 'Character',
            filterText: ':' // Ensure it matches the trigger character
        }));

        return { suggestions };
    }
});

monaco.languages.registerCompletionItemProvider('ink-dinky', {
    triggerCharacters: [':'],
    provideCompletionItems: (model, position) => {
        console.log('[Autocomplete] Triggered (ink-dinky mode)');
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        if (!/^\s*:$/.test(textBeforeCursor)) {
            return { suggestions: [] };
        }

        const range = new monaco.Range(
            position.lineNumber,
            lineContent.indexOf(':') + 1,
            position.lineNumber,
            position.column
        );

        const suggestions = projectCharacters.map(char => ({
            label: char.ID,
            kind: monaco.languages.CompletionItemKind.User,
            insertText: `${char.ID}: `,
            range: range,
            detail: char.Name || 'Character',
            filterText: ':' // Ensure it matches the trigger character
        }));

        return { suggestions };
    }
});

// Writing status tag autocomplete for 'ink' language
monaco.languages.registerCompletionItemProvider('ink', {
    triggerCharacters: [':'],
    provideCompletionItems: (model, position) => {
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        // Check if user is typing #ws: followed by optional alphanumeric characters
        const match = textBeforeCursor.match(/#ws:([a-z0-9]*)$/);
        if (!match) {
            return { suggestions: [] };
        }

        console.log('[Autocomplete] Providing writing status suggestions. Count:', projectWritingStatusTags.length);

        const wsStartIndex = textBeforeCursor.lastIndexOf('#ws:');
        const range = new monaco.Range(
            position.lineNumber,
            wsStartIndex + 5, // +1 for 1-based column, +4 for '#ws:' length
            position.lineNumber,
            position.column
        );

        const suggestions = projectWritingStatusTags.map(ws => ({
            label: ws.wstag,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: ws.wstag,
            range: range,
            detail: ws.status || 'Writing Status',
            documentation: `Status: ${ws.status}${ws.record ? ' (record)' : ''}${ws.loc ? ' (loc)' : ''}`
        }));

        return { suggestions };
    }
});

// Writing status tag autocomplete for 'ink-dinky' language
monaco.languages.registerCompletionItemProvider('ink-dinky', {
    triggerCharacters: [':'],
    provideCompletionItems: (model, position) => {
        const lineContent = model.getLineContent(position.lineNumber);
        const textBeforeCursor = lineContent.substring(0, position.column - 1);

        // Check if user is typing #ws: followed by optional alphanumeric characters
        const match = textBeforeCursor.match(/#ws:([a-z0-9]*)$/);
        if (!match) {
            return { suggestions: [] };
        }

        console.log('[Autocomplete] Providing writing status suggestions (ink-dinky). Count:', projectWritingStatusTags.length);

        const wsStartIndex = textBeforeCursor.lastIndexOf('#ws:');
        const range = new monaco.Range(
            position.lineNumber,
            wsStartIndex + 5, // +1 for 1-based column, +4 for '#ws:' length
            position.lineNumber,
            position.column
        );

        const suggestions = projectWritingStatusTags.map(ws => ({
            label: ws.wstag,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: ws.wstag,
            range: range,
            detail: ws.status || 'Writing Status',
            documentation: `Status: ${ws.status}${ws.record ? ' (record)' : ''}${ws.loc ? ' (loc)' : ''}`
        }));

        return { suggestions };
    }
});

window.electronAPI.onThemeUpdated((theme) => {
    if (theme === 'vs') {
        monaco.editor.setTheme('dinky-light');
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    } else {
        monaco.editor.setTheme('dinky-dark');
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    }
});

// Save Logic
async function saveAllFiles() {
    const filesToSave = [];

    // Prepare project files map for the tagger
    const projectFilesContent = {};
    for (const [path, file] of loadedInkFiles) {
        // Use current editor content if this is the active file
        if (path === currentFilePath) {
            projectFilesContent[path] = idManager.reconstructContent(editor.getValue());
        } else {
            projectFilesContent[path] = file.content;
        }
    }

    for (const [filePath, file] of loadedInkFiles) {
        let content = projectFilesContent[filePath];

        // AUTO-TAGGING ON SAVE
        try {
            // We pass the potentially modified projectFilesContent so tagger sees current state
            const edits = await window.electronAPI.autoTagInk(content, filePath, projectFilesContent);

            if (edits && edits.length > 0) {
                // Apply edits to the content string
                // Edits are: { line: 1-based, newId: "...", text: "original line text" }
                // Since valid lines are unique in Ink usually, we can replace line by line.
                // But safer to split content and replace by index.

                const lines = content.split(/\r?\n/);

                edits.forEach(edit => {
                    // edit.line is 1-based index from compiler
                    const lineIdx = edit.line - 1;
                    if (lineIdx >= 0 && lineIdx < lines.length) {
                        const originalLine = lines[lineIdx];

                        // Inject ID
                        const newLine = idManager.injectIdIntoLine(originalLine, edit.newId);
                        lines[lineIdx] = newLine;


                        // If this IS the current file, we also need to register it with IdManager
                        // so the decoration appears immediately without reload.
                        if (filePath === currentFilePath) {
                            idManager.addId(edit.line, edit.newId);
                        }
                    }
                });

                content = lines.join('\n');
            }
        } catch (e) {
            console.error('Auto-tag on save failed for', filePath, e);
        }

        // Update the file object
        if (content !== file.content) {
            file.content = content;
        }

        filesToSave.push({ path: filePath, content: file.content });
    }

    // Invoke IPC to save files
    await window.electronAPI.saveFiles(filesToSave);

    // Update original content and remove asterisks
    for (const [filePath, file] of loadedInkFiles) {
        file.originalContent = file.content;
        if (file.listItem) {
            file.listItem.textContent = file.relativePath;
        }
    }
    return true;
}

// Listen for Save All command from main process
window.electronAPI.onSaveAll(async () => {
    await saveAllFiles();
});

window.electronAPI.onSaveAndExit(async () => {
    await saveAllFiles();
    window.electronAPI.sendSaveExitComplete();
});

window.electronAPI.onCheckUnsaved(() => {
    let hasUnsaved = false;
    for (const [filePath, file] of loadedInkFiles) {
        if (file.content !== file.originalContent) {
            hasUnsaved = true;
            break;
        }
    }
    window.electronAPI.sendUnsavedStatus(hasUnsaved);
});

// Initial check
checkSyntax();

// ===== Navigation Dropdown =====
const navDropdown = document.getElementById('nav-dropdown');
let isUpdatingDropdown = false; // Flag to prevent recursive updates

/**
 * Parse all files in the project to extract file/knot/stitch structure
 * Uses caching to avoid reparsing when structure hasn't changed
 * Returns an array of navigation items with hierarchy
 */
function parseNavigationStructure() {
    // Return cached structure if it's still valid
    if (!navigationStructureDirty && cachedNavigationStructure !== null) {
        return cachedNavigationStructure;
    }

    const structure = [];

    // Process all loaded files
    for (const [filePath, file] of loadedInkFiles) {
        // Add the file as an entry
        structure.push({
            type: 'file',
            name: file.relativePath,
            filePath: filePath,
            line: 0,
            indent: 0
        });

        // Get file content
        let content;
        if (filePath === currentFilePath) {
            // Use current editor content for active file
            const model = editor.getModel();
            content = model ? model.getValue() : file.content;
        } else {
            content = file.content;
        }

        const lines = content.split(/\r?\n/);
        let currentKnot = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // Check for knot: === KnotName or === KnotName ===
            const knotMatch = trimmed.match(/^={2,}\s*([\w_]+)/);
            if (knotMatch) {
                currentKnot = {
                    type: 'knot',
                    name: knotMatch[1],
                    filePath: filePath,
                    line: i + 1,
                    indent: 3
                };
                structure.push(currentKnot);
                continue;
            }

            // Check for stitch: = StitchName
            const stitchMatch = trimmed.match(/^=\s+([\w_]+)/);
            if (stitchMatch && currentKnot) {
                structure.push({
                    type: 'stitch',
                    name: `${currentKnot.name}.${stitchMatch[1]}`,
                    filePath: filePath,
                    line: i + 1,
                    indent: 3,
                    knotName: currentKnot.name,
                    stitchName: stitchMatch[1]
                });
            }
        }
    }

    // Cache the result and mark as clean
    cachedNavigationStructure = structure;
    navigationStructureDirty = false;

    return structure;
}

/**
 * Populate the dropdown with navigation structure
 */
function updateNavigationDropdown() {
    if (loadedInkFiles.size === 0) {
        navDropdown.innerHTML = '<option value="">No file loaded</option>';
        return;
    }

    const structure = parseNavigationStructure();
    
    // Use DocumentFragment to batch DOM insertions (more efficient than appending one at a time)
    const fragment = document.createDocumentFragment();
    
    structure.forEach(item => {
        const option = document.createElement('option');
        option.value = `${item.type}:${item.filePath}:${item.line}`;

        // Create indentation using spaces (Unicode non-breaking spaces work better in options)
        const indent = '\u00A0\u00A0'.repeat(item.indent);
        let displayName = item.name;
        
        // Add visual marker for files to distinguish them from knots/stitches
        if (item.type === 'file') {
            displayName = `📄 ${item.name}`;
        }
        
        option.textContent = `${indent}${displayName}`;

        fragment.appendChild(option);
    });
    
    // Single DOM update with all options at once
    navDropdown.innerHTML = '';
    navDropdown.appendChild(fragment);
}

/**
 * Find the current location (file/knot/stitch) based on cursor position
 * Returns the navigation item at or before the cursor
 */
function findCurrentLocation(lineNumber) {
    const structure = parseNavigationStructure();

    // Filter to only items in the current file
    const currentFileItems = structure.filter(item => item.filePath === currentFilePath);

    if (currentFileItems.length === 0) return null;

    // Find the last item that is at or before the cursor line
    let currentItem = currentFileItems[0]; // Default to file

    for (const item of currentFileItems) {
        if (item.line <= lineNumber) {
            currentItem = item;
        } else {
            break;
        }
    }

    return currentItem;
}

/**
 * Update dropdown selection based on cursor position
 */
function updateDropdownSelection() {
    if (isUpdatingDropdown) return;

    const position = editor.getPosition();
    if (!position) return;

    const currentItem = findCurrentLocation(position.lineNumber);
    if (!currentItem) return;

    const value = `${currentItem.type}:${currentItem.filePath}:${currentItem.line}`;

    // Find and select the matching option
    for (let i = 0; i < navDropdown.options.length; i++) {
        if (navDropdown.options[i].value === value) {
            isUpdatingDropdown = true;
            navDropdown.selectedIndex = i;
            isUpdatingDropdown = false;
            break;
        }
    }
}

/**
 * Handle dropdown change - navigate to selected location
 */
navDropdown.addEventListener('change', () => {
    if (isUpdatingDropdown) return;

    const selected = navDropdown.value;
    if (!selected) return;

    const parts = selected.split(':');
    const type = parts[0];
    const filePath = parts.slice(1, -1).join(':'); // Handle colons in file path
    const line = parseInt(parts[parts.length - 1], 10);

    // Switch to the file if needed
    if (filePath !== currentFilePath) {
        const file = loadedInkFiles.get(filePath);
        if (file && file.listItem) {
            file.listItem.click();
            // Wait a tick for the file to load before navigating
            setTimeout(() => {
                navigateToLine(line);
                // Track navigation when navigating via dropdown
                addToNavigationHistory(filePath, line);
            }, 100);
            return;
        }
    }

    navigateToLine(line);
    // Track navigation when navigating via dropdown
    addToNavigationHistory(filePath, line);
});

/**
 * Navigate to a specific line in the editor
 */
function navigateToLine(line) {
    if (line === 0) {
        // Navigate to top of file
        editor.setPosition({ lineNumber: 1, column: 1 });
        editor.revealLineInCenter(1);
    } else {
        // Navigate to the line after the heading (knot/stitch declaration)
        const targetLine = line + 1;
        editor.setPosition({ lineNumber: targetLine, column: 1 });
        editor.revealLineInCenter(targetLine);
    }

    editor.focus();
}

/**
 * Add a navigation point to history
 */
function addToNavigationHistory(filePath, lineNumber) {
    // Remove any forward history if we're not at the end
    if (navigationHistoryIndex < navigationHistory.length - 1) {
        navigationHistory = navigationHistory.slice(0, navigationHistoryIndex + 1);
    }

    // Add new entry if it's different from the last one
    const lastEntry = navigationHistory[navigationHistory.length - 1];
    if (!lastEntry || lastEntry.filePath !== filePath || lastEntry.line !== lineNumber) {
        navigationHistory.push({ filePath, line: lineNumber });
        navigationHistoryIndex = navigationHistory.length - 1;
    }

    updateNavigationButtons();
}

/**
 * Navigate back in history
 */
function navigateBack() {
    if (navigationHistoryIndex > 0) {
        navigationHistoryIndex--;
        const entry = navigationHistory[navigationHistoryIndex];
        
        isNavigatingHistory = true;
        
        if (entry.filePath !== currentFilePath) {
            const file = loadedInkFiles.get(entry.filePath);
            if (file && file.listItem) {
                file.listItem.click();
                setTimeout(() => {
                    navigateToLine(entry.line);
                    isNavigatingHistory = false;
                    updateNavigationButtons();
                }, 100);
                return;
            }
        }
        
        navigateToLine(entry.line);
        isNavigatingHistory = false;
        updateNavigationButtons();
    }
}

/**
 * Navigate forward in history
 */
function navigateForward() {
    if (navigationHistoryIndex < navigationHistory.length - 1) {
        navigationHistoryIndex++;
        const entry = navigationHistory[navigationHistoryIndex];
        
        isNavigatingHistory = true;
        
        if (entry.filePath !== currentFilePath) {
            const file = loadedInkFiles.get(entry.filePath);
            if (file && file.listItem) {
                file.listItem.click();
                setTimeout(() => {
                    navigateToLine(entry.line);
                    isNavigatingHistory = false;
                    updateNavigationButtons();
                }, 100);
                return;
            }
        }
        
        navigateToLine(entry.line);
        isNavigatingHistory = false;
        updateNavigationButtons();
    }
}

/**
 * Update the enabled/disabled state of back/forward buttons
 */
function updateNavigationButtons() {
    const backBtn = document.getElementById('btn-back');
    const forwardBtn = document.getElementById('btn-forward');
    
    if (navigationHistoryIndex > 0) {
        backBtn.style.opacity = '1';
        backBtn.style.pointerEvents = 'auto';
    } else {
        backBtn.style.opacity = '0.5';
        backBtn.style.pointerEvents = 'none';
    }
    
    if (navigationHistoryIndex < navigationHistory.length - 1) {
        forwardBtn.style.opacity = '1';
        forwardBtn.style.pointerEvents = 'auto';
    } else {
        forwardBtn.style.opacity = '0.5';
        forwardBtn.style.pointerEvents = 'none';
    }
}

/**
 * Listen to cursor position changes
 */
editor.onDidChangeCursorPosition(() => {
    updateDropdownSelection();
    
    // Don't track history if we're navigating via back/forward
    if (isNavigatingHistory) return;
    
    // Track navigation when jumping to a different knot/stitch
    if (currentFilePath) {
        const position = editor.getPosition();
        if (position) {
            const currentLocation = findCurrentLocation(position.lineNumber);
            const currentKnotName = currentLocation ? currentLocation.name : null;
            
            // Only track if the knot/stitch changed (not just line within same knot/stitch)
            if (lastNavigationLocation.filePath !== currentFilePath || 
                lastNavigationLocation.knotName !== currentKnotName) {
                lastNavigationLocation = { filePath: currentFilePath, knotName: currentKnotName };
                addToNavigationHistory(currentFilePath, position.lineNumber);
            }
        }
    }
});

/**
 * Refresh dropdown when file changes
 */
function refreshNavigationDropdown() {
    updateNavigationDropdown();
    updateDropdownSelection();
}

// --- New Project Modal Logic ---
const newProjectModal = new ModalHelper({
    overlayId: 'modal-overlay',
    confirmBtnId: 'btn-confirm-create',
    cancelBtnId: 'btn-cancel-create',
    onShow: () => {
        document.getElementById('new-project-name').value = '';
        document.getElementById('new-project-folder').value = '';
    },
    onValidate: () => {
        const name = document.getElementById('new-project-name').value.trim();
        const folder = document.getElementById('new-project-folder').value.trim();
        // Disallow periods in name
        const isValidName = name && !name.includes('.');
        return isValidName && folder;
    },
    onConfirm: async () => {
        const name = document.getElementById('new-project-name').value.trim();
        const folder = document.getElementById('new-project-folder').value.trim();
        return await window.electronAPI.createNewProject(name, folder);
    }
});

document.getElementById('new-project-name').addEventListener('input', () => newProjectModal.validate());

window.electronAPI.onShowNewProjectModal(() => {
    newProjectModal.open();
});

document.getElementById('btn-select-folder').addEventListener('click', async () => {
    const input = document.getElementById('new-project-folder');
    const path = await window.electronAPI.selectFolder();
    if (path) {
        input.value = path;
        newProjectModal.validate();
    }
});

// --- New Include Modal Logic ---
const newIncludeModal = new ModalHelper({
    overlayId: 'modal-include-overlay',
    confirmBtnId: 'btn-confirm-include',
    cancelBtnId: 'btn-cancel-include',
    onShow: (defaultFolder) => {
        document.getElementById('new-include-name').value = '';
        document.getElementById('new-include-folder').value = defaultFolder || '';
    },
    onValidate: () => {
        const name = document.getElementById('new-include-name').value.trim();
        const folder = document.getElementById('new-include-folder').value.trim();
        return name && folder;
    },
    onConfirm: async () => {
        const name = document.getElementById('new-include-name').value.trim();
        const folder = document.getElementById('new-include-folder').value.trim();
        return await window.electronAPI.createNewInclude(name, folder);
    }
});

document.getElementById('new-include-name').addEventListener('input', () => newIncludeModal.validate());

window.electronAPI.onShowNewIncludeModal((defaultFolder) => {
    newIncludeModal.open(defaultFolder);
});

document.getElementById('btn-select-include-folder').addEventListener('click', async () => {
    const input = document.getElementById('new-include-folder');
    const path = await window.electronAPI.selectFolder(input.value);
    if (path) {
        input.value = path;
        newIncludeModal.validate();
    }
});

document.getElementById('btn-add-include').addEventListener('click', () => {
    window.electronAPI.openNewIncludeUI();
});

document.getElementById('btn-choose-include').addEventListener('click', () => {
    window.electronAPI.chooseExistingInclude();
});

const btnDeleteInclude = document.getElementById('btn-delete-include');

btnDeleteInclude.addEventListener('click', async () => {
    if (currentFilePath && currentFilePath !== rootInkPath) {
        await window.electronAPI.removeInclude(currentFilePath);
    }
});

async function handleStartTest() {
    if (!rootInkPath) return;

    // Reset last test mode to root
    lastTestKnot = null;

    await saveAllFiles();
    const projectFiles = getProjectFilesContent();

    await window.electronAPI.startTest(rootInkPath, projectFiles);
}

document.getElementById('btn-start-test').addEventListener('click', async () => {
    await handleStartTest();
});

document.getElementById('btn-back').addEventListener('click', () => {
    navigateBack();
});

document.getElementById('btn-forward').addEventListener('click', () => {
    navigateForward();
});

window.electronAPI.onTriggerStartTest(async () => {
    await handleStartTest();
});

async function handleTestKnot() {
    if (!rootInkPath) return;

    await saveAllFiles();
    const projectFiles = getProjectFilesContent();

    // Find knot at cursor
    const model = editor.getModel();
    const position = editor.getPosition();

    if (!position) {
        console.warn('handleTestKnot: No cursor position found. Editor might not have focus.');
        return;
    }

    const knotName = findCurrentKnot(model, position);

    if (knotName) {
        console.log('Testing knot:', knotName);
        lastTestKnot = knotName;
        await window.electronAPI.startTest(rootInkPath, projectFiles, knotName);
    } else {
        // No knot found at cursor, start from root
        console.log('No knot found, starting from root');
        lastTestKnot = null;
        await window.electronAPI.startTest(rootInkPath, projectFiles);
    }
}

function findCurrentKnot(model, position) {
    // Scan backwards from current line
    for (let i = position.lineNumber; i >= 1; i--) {
        const line = model.getLineContent(i);
        // Regex for knot: === Name === or === Name
        // We match: ^\s*={2,}\s*([\w_]+)
        const match = line.match(/^\s*={2,}\s*([\w_]+)/);
        if (match) {
            return match[1];
        }
    }
    return null;
}

document.getElementById('btn-test-knot').addEventListener('click', async () => {
    await handleTestKnot();
});

window.electronAPI.onTriggerTestKnot(async () => {
    await handleTestKnot();
});

window.electronAPI.onTriggerRestartTest(async () => {
    if (lastTestKnot) {
        if (!rootInkPath) return;
        await saveAllFiles();
        const projectFiles = getProjectFilesContent();
        await window.electronAPI.startTest(rootInkPath, projectFiles, lastTestKnot);
    } else {
        await handleStartTest();
    }
});

window.electronAPI.onMenuFind(() => {
    editor.trigger('keyboard', 'actions.find');
});

window.electronAPI.onMenuReplace(() => {
    editor.trigger('keyboard', 'editor.action.startFindReplaceAction');
});

window.electronAPI.onSearchRequested(({ query, caseSensitive }) => {
    const matches = [];
    for (const [path, file] of loadedInkFiles) {
        const lines = file.content.split('\n');
        lines.forEach((line, index) => {
            const match = caseSensitive ? line.includes(query) : line.toLowerCase().includes(query.toLowerCase());
            if (match) {
                matches.push({
                    path,
                    relativePath: file.relativePath,
                    line: index + 1,
                    content: line.trim()
                });
            }
        });
    }
    window.electronAPI.sendSearchResults(matches);
});

window.electronAPI.onNavigationRequested(({ path, line, query }) => {
    openFileAndSelectLine(path, line, query);
});

window.electronAPI.onClearSearchHighlights(() => {
    if (editor) {
        editor.setSelection({
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: 1,
            endColumn: 1
        });
    }
});

window.electronAPI.onReplaceRequested(({ query, replacement, caseSensitive }) => {
    let totalReplacements = 0;
    const regexFlags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(escapeRegExp(query), regexFlags);

    for (const [path, file] of loadedInkFiles) {
        if (regex.test(file.content)) {
            const count = (file.content.match(regex) || []).length;
            totalReplacements += count;

            const newContent = file.content.replace(regex, replacement);
            file.content = newContent;

            if (path === currentFilePath) {
                isUpdatingContent = true;
                editor.setValue(newContent);
                isUpdatingContent = false;
            }

            if (file.listItem) {
                const isModified = file.content !== file.originalContent;
                file.listItem.textContent = file.relativePath + (isModified ? '*' : '');
            }
        }
    }
    window.electronAPI.sendReplaceComplete(totalReplacements);
    if (totalReplacements > 0) {
        checkSyntax();
    }
});

// Compiler selection handlers
window.electronAPI.onSelectCompiler(async () => {
    await window.electronAPI.selectCompiler();
});

function openFileAndSelectLine(filePath, line, query) {
    const file = loadedInkFiles.get(filePath);
    if (!file) return;

    if (file.listItem) {
        file.listItem.click();
    }

    const model = editor.getModel();
    if (model) {
        const fullContent = editor.getValue();
        const lines = fullContent.split('\n');
        const lineContent = lines[line - 1];
        const colStart = lineContent.indexOf(query) + 1;
        const colEnd = colStart + query.length;

        editor.revealLineInCenter(line);
        editor.setSelection({
            startLineNumber: line,
            startColumn: colStart,
            endLineNumber: line,
            endColumn: colEnd
        });
        editor.focus();
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateCharacterNamesInText(text) {
    const lines = text.split(/\r?\n/);
    const markers = [];
    const validIds = new Set(projectCharacters.map(c => c.ID));

    // Regex to capture Name in Dinky lines
    const dinkyLineRegex = /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/;

    // Check Global Mode
    const isGlobalDinky = detectDinkyGlobal(text);
    let inDinkyContext = isGlobalDinky;

    lines.forEach((line, index) => {
        const trimmed = line.trim();

        if (!isGlobalDinky) {
            // Check for Knot Start
            if (/^={2,}/.test(trimmed)) {
                // Reset context on new knot
                inDinkyContext = false;

                // Check if this knot is tagged immediately
                if (/#\s*dink(?=\s|$)/.test(trimmed)) {
                    inDinkyContext = true;
                }
            } else {
                // Check for delayed #dink tag in the flow
                if (/#\s*dink(?=\s|$)/.test(trimmed)) {
                    inDinkyContext = true;
                }
            }
        }

        // Skip validation if not in Dink context
        if (!inDinkyContext) return;

        const match = line.match(dinkyLineRegex);
        if (match) {
            const name = match[2];
            const nameStartCol = match[1].length + 1;
            const nameEndCol = nameStartCol + name.length;

            if (!validIds.has(name)) {
                markers.push({
                    message: `Invalid Character Name: ${name}`,
                    severity: monaco.MarkerSeverity.Error,
                    startLineNumber: index + 1,
                    startColumn: nameStartCol,
                    endLineNumber: index + 1,
                    endColumn: nameEndCol,
                    source: 'dinky-validator',
                    code: name // Store name for quick fix
                });
            }
        }
    });

    return markers;
}

function validateCharacterNames(model) {
    const text = model.getValue();
    return validateCharacterNamesInText(text);
}

function validateWritingStatusTagsInText(text) {
    const lines = text.split(/\r?\n/);
    const markers = [];
    const validTags = new Set(projectWritingStatusTags.map(ws => ws.wstag));

    // Regex to capture #ws:tag
    const wsTagRegex = /#ws:(\S+)/g;

    lines.forEach((line, index) => {
        let match;
        // Reset regex for each line
        wsTagRegex.lastIndex = 0;

        while ((match = wsTagRegex.exec(line)) !== null) {
            const tag = match[1];
            const tagStartCol = match.index + 1; // +1 for Monaco 1-based columns
            const tagEndCol = tagStartCol + match[0].length;

            if (!validTags.has(tag)) {
                markers.push({
                    message: `Invalid writing status tag: ${tag}`,
                    severity: monaco.MarkerSeverity.Error,
                    startLineNumber: index + 1,
                    startColumn: tagStartCol,
                    endLineNumber: index + 1,
                    endColumn: tagEndCol,
                    source: 'ws-validator',
                    code: tag // Store tag for quick fix
                });
            }
        }
    });

    return markers;
}

function validateWritingStatusTags(model) {
    const text = model.getValue();
    return validateWritingStatusTagsInText(text);
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}
