import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { DinkySpellChecker } from './spellchecker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

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


// Define custom themes
monaco.editor.defineTheme('dinky-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
        { token: 'code', foreground: 'C586C0' }, // Magenta
    ],
    colors: {}
});

monaco.editor.defineTheme('dinky-light', {
    base: 'vs',
    inherit: true,
    rules: [
        { token: 'code', foreground: '800080' }, // Purple
    ],
    colors: {}
});

monaco.languages.register({ id: 'ink' });

monaco.languages.setMonarchTokensProvider('ink', {
    tokenizer: {
        root: [
            // Comments (Top priority)
            [/\/\/.*$/, 'comment'],
            [/\/\*/, 'comment', '@comment'],

            // Code Lines - Solitary (No content implies no need to enter mode, or empty logic)
            [/^\s*~$/, 'code'],
            [/^\s*(?:INCLUDE|VAR|CONST|LIST)$/, 'code'],

            // Code Lines - Start (Enter codeMode for rest of line)
            [/^\s*(?:INCLUDE|VAR|CONST|LIST)\b/, 'code', '@codeMode'],
            [/^\s*~/, 'code', '@codeMode'],

            // Code Blocks: multi-line logic start/end or inline logic
            [/^\s*\{[^}]*$/, 'code'],         // Line starting with { and not closing
            [/^[^\{]*\}\s*$/, 'code'],        // Line ending with } and not opening
            [/\{[^\{\}]*\}/, 'code'],         // Inline logic { ... }

            // Diverts: -> matches arrow and target
            [/->\s*[\w_\.]+/, 'keyword'],

            // Knots (=== Name ===)
            [/^={2,}\s*[\w\s]+={2,}/, 'type.identifier'], // Full Knot header
            [/^={2,}\s*\w+/, 'type.identifier'],          // Knot opening

            // Stitches (= Name)
            [/^=\s*\w+/, 'type.identifier'],

            // Choices
            [/^[\*\+]+/, 'keyword'], // Choice bullets

            // Gather points
            [/^\-/, 'keyword'],

            // Tags
            [/#\s*.*$/, 'annotation'],

            // Logic
            // Note: { and } are now largely handled by 'code' rules above if they form blocks across lines
            // or inline blocks. Remaining braces might be parts of complex nesting not caught above.
            [/[{}]/, 'delimiter.bracket'],
            [/\w+(?=\()/, 'function'], // Function calls
        ],
        codeMode: [
            [/\/\/.*$/, 'comment', '@pop'],
            [/\/\*/, 'comment', '@comment'],

            // Content ending at EOL -> POP
            [/[^/*]+$/, 'code', '@pop'],
            [/\/(?!\/|\*)$/, 'code', '@pop'], // Lonely slash at EOL
            [/\*(?!\/)$/, 'code', '@pop'],    // Lonely star at EOL

            // Content NOT ending at EOL -> STAY
            [/[^/*]+/, 'code'],
            [/\//, 'code'],
            [/\*/, 'code'],

            // Fallback EOL catch (e.g. trailing whitespace matched differently or empty)
            [/$/, 'code', '@pop']
        ],
        comment: [
            [/[^\/*]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[\/*]/, 'comment']
        ]
    }
});

const editor = monaco.editor.create(document.getElementById('editor-container'), {
    value: '',
    language: 'ink',
    theme: 'dinky-dark',
    automaticLayout: true,
    readOnly: true,
});

const spellChecker = new DinkySpellChecker();
window.electronAPI.loadSettings().then(settings => {
    const locale = settings.spellCheckerLocale || 'en-GB';
    spellChecker.init(locale);
});

window.electronAPI.onUpdateSpellLocale(async (locale) => {
    await spellChecker.switchLocale(locale);
    checkSpelling();
});

monaco.languages.registerCodeActionProvider('ink', {
    provideCodeActions: (model, range, context, token) => {
        const markers = context.markers.filter(m => m.source === 'spellcheck');
        if (markers.length === 0) return { actions: [], dispose: () => { } };

        const actions = [];
        for (const marker of markers) {
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
        return { actions: actions, dispose: () => { } };
    }
});

monaco.editor.registerCommand('add-to-dictionary', async (accessor, word) => {
    spellChecker.add(word);
    await window.electronAPI.addToProjectDictionary(word);
    checkSpelling();
});

function checkSpelling() {
    const model = editor.getModel();
    if (!model) return;

    // We can rely on internal state of spellChecker to know if it's ready
    const markers = spellChecker.checkModel(model, monaco);
    monaco.editor.setModelMarkers(model, 'spellcheck', markers);
}

// removed duplicate definition

let loadedInkFiles = new Map();
let currentFilePath = null;
let rootInkPath = null;
let isUpdatingContent = false;

document.getElementById('btn-load-project').addEventListener('click', () => {
    window.electronAPI.openProject();
});

document.getElementById('btn-new-project').addEventListener('click', () => {
    window.electronAPI.newProject();
});

document.getElementById('btn-set-ink-root').addEventListener('click', () => {
    window.electronAPI.openInkRoot();
});

document.getElementById('btn-create-ink-root').addEventListener('click', () => {
    window.electronAPI.createInkRoot();
});

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
    spellChecker.loadPersonalDictionary(projectDict);

    loadedInkFiles.clear();
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    const rootFileStepInfo = document.getElementById('ink-root-file-item');

    // Toggle view
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('no-root-state').style.display = 'none';
    const editorContainer = document.getElementById('editor-container');
    editorContainer.style.display = 'block';
    editor.layout();

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
    }
});


// -- Rename Include Logic --
const renameModalOverlay = document.getElementById('modal-rename-include-overlay');
const renameInput = document.getElementById('rename-include-name');
const btnConfirmRename = document.getElementById('btn-confirm-rename');
const btnCancelRename = document.getElementById('btn-cancel-rename');
let currentRenamePath = null;

document.getElementById('btn-rename-include').addEventListener('click', () => {
    if (!currentFilePath) return;

    currentRenamePath = currentFilePath;
    // Extract base name without extension
    const parts = currentRenamePath.split(/[/\\]/);
    const fileName = parts[parts.length - 1];
    const baseName = fileName.replace(/\.ink$/i, '');

    renameInput.value = baseName;
    renameModalOverlay.style.display = 'flex';
    renameInput.focus();
    renameInput.select();
});

btnCancelRename.addEventListener('click', () => {
    renameModalOverlay.style.display = 'none';
    currentRenamePath = null;
});

btnConfirmRename.addEventListener('click', () => {
    const newName = renameInput.value.trim();
    if (!newName) return;

    if (currentRenamePath) {
        window.electronAPI.renameInclude(currentRenamePath, newName);
    }
    renameModalOverlay.style.display = 'none';
    currentRenamePath = null;
});

// Allow Enter to submit rename
renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        btnConfirmRename.click();
    } else if (e.key === 'Escape') {
        btnCancelRename.click();
    }
});


// -- Rename Root Logic --
const renameRootModalOverlay = document.getElementById('modal-rename-root-overlay');
const renameRootInput = document.getElementById('rename-root-name');
const btnConfirmRenameRoot = document.getElementById('btn-confirm-rename-root');
const btnCancelRenameRoot = document.getElementById('btn-cancel-rename-root');

document.getElementById('btn-rename-root').addEventListener('click', () => {
    if (!rootInkPath) return;

    // Extract base name without extension
    const parts = rootInkPath.split(/[/\\]/);
    const fileName = parts[parts.length - 1];
    const baseName = fileName.replace(/\.ink$/i, '');

    renameRootInput.value = baseName;
    renameRootModalOverlay.style.display = 'flex';
    renameRootInput.focus();
    renameRootInput.select();
});

btnCancelRenameRoot.addEventListener('click', () => {
    renameRootModalOverlay.style.display = 'none';
});

btnConfirmRenameRoot.addEventListener('click', () => {
    const newName = renameRootInput.value.trim();
    if (!newName) return;

    window.electronAPI.renameInkRoot(newName);
    renameRootModalOverlay.style.display = 'none';
});

// Allow Enter to submit root rename
renameRootInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        btnConfirmRenameRoot.click();
    } else if (e.key === 'Escape') {
        btnCancelRenameRoot.click();
    }
});


// -- New Ink Root Logic --
const modalNewInkRootOverlay = document.getElementById('modal-new-ink-root-overlay');
const inputNewInkRootName = document.getElementById('new-ink-root-name');
const inputNewInkRootFolder = document.getElementById('new-ink-root-folder');
const btnSelectNewInkRootFolder = document.getElementById('btn-select-ink-root-folder');
const btnCancelNewInkRoot = document.getElementById('btn-cancel-new-ink-root');
const btnCreateNewInkRoot = document.getElementById('btn-confirm-new-ink-root');

function openNewInkRootModal(defaultFolder) {
    inputNewInkRootName.value = '';
    inputNewInkRootFolder.value = defaultFolder || '';
    validateNewInkRootForm();
    modalNewInkRootOverlay.style.display = 'flex';
    inputNewInkRootName.focus();
}

function closeNewInkRootModal() {
    modalNewInkRootOverlay.style.display = 'none';
}

function validateNewInkRootForm() {
    const name = inputNewInkRootName.value.trim();
    const folder = inputNewInkRootFolder.value.trim();
    btnCreateNewInkRoot.disabled = !(name && folder);
}

window.electronAPI.onShowNewInkRootModal((defaultFolder) => {
    openNewInkRootModal(defaultFolder);
});

btnSelectNewInkRootFolder.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFolder(inputNewInkRootFolder.value);
    if (path) {
        inputNewInkRootFolder.value = path;
        validateNewInkRootForm();
    }
});

btnCancelNewInkRoot.addEventListener('click', () => {
    closeNewInkRootModal();
});

btnCreateNewInkRoot.addEventListener('click', async () => {
    const name = inputNewInkRootName.value.trim();
    const folder = inputNewInkRootFolder.value.trim();
    if (name && folder) {
        btnCreateNewInkRoot.disabled = true;
        const success = await window.electronAPI.createNewInkRoot(name, folder);
        if (success) {
            closeNewInkRootModal();
        } else {
            btnCreateNewInkRoot.disabled = false;
        }
    }
});

inputNewInkRootName.addEventListener('input', validateNewInkRootForm);

// Keyboard shortcuts for New Ink Root Modal
modalNewInkRootOverlay.addEventListener('keydown', (e) => {
    if (modalNewInkRootOverlay.style.display === 'none') return;

    if (e.key === 'Enter') {
        if (!btnCreateNewInkRoot.disabled) {
            btnCreateNewInkRoot.click();
        }
    } else if (e.key === 'Escape') {
        closeNewInkRootModal();
    }
});

document.getElementById('btn-add-ink-root').addEventListener('click', () => {
    window.electronAPI.openNewInkRootUI();
});

document.getElementById('btn-switch-ink-root').addEventListener('click', () => {
    window.electronAPI.openInkRoot();
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
    currentFilePath = file.absolutePath;
    editor.setValue(file.content);
    isUpdatingContent = false;

    checkSyntax();
    checkSpelling();
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
    // It should be enabled if we have a root (which we should if isRoot is true, primarily)
    // But this function is called when selecting ANY file.
    // The Rename Root button should arguably ALWAYS be enabled if a root exists?
    // Or only when the root is selected? User request was "Rename icon to the INK ROOT icons", implying it lives in the header.
    // So it should probably just be enabled if `rootInkPath` exists, regardless of selection.

    // However, we want to update its state based on whether a root is loaded at all.
    // Let's check rootInkPath global.
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
        const errors = await window.electronAPI.compileInk(contentToCompile, rootInkPath, projectFiles);


        const model = editor.getModel();
        if (model) {


            // Filter errors to display only those relevant to the current file
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

            monaco.editor.setModelMarkers(model, 'ink', visibleErrors || []);
        }
    } catch (e) {
        window.electronAPI.log('checkSyntax failed:', e.toString())
    }
}

const debouncedCheck = debounce(checkSyntax, 1000);
const debouncedCheckSpelling = debounce(checkSpelling, 400);

editor.onDidChangeModelContent(() => {
    if (isUpdatingContent) return;

    // Clear spellcheck markers immediately to avoid visual desync during editing
    const model = editor.getModel();
    if (model) {
        monaco.editor.setModelMarkers(model, 'spellcheck', []);
    }

    // Keep the file model in sync with editor content immediately
    if (currentFilePath && loadedInkFiles.has(currentFilePath)) {
        const file = loadedInkFiles.get(currentFilePath);
        file.content = editor.getValue();

        if (file.listItem) {
            const isModified = file.content !== file.originalContent;
            file.listItem.textContent = file.relativePath + (isModified ? '*' : '');
        }
    }
    debouncedCheck();
    debouncedCheckSpelling();
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
    for (const [filePath, file] of loadedInkFiles) {
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

// --- New Project Modal Logic ---
const modalOverlay = document.getElementById('modal-overlay');
const inputName = document.getElementById('new-project-name');
const inputFolder = document.getElementById('new-project-folder');
const btnSelectFolder = document.getElementById('btn-select-folder');
const btnCancel = document.getElementById('btn-cancel-create');
const btnCreate = document.getElementById('btn-confirm-create');

function openModal() {
    inputName.value = '';
    inputFolder.value = '';
    validateForm();
    modalOverlay.style.display = 'flex';
    inputName.focus();
}

function closeModal() {
    modalOverlay.style.display = 'none';
}

function validateForm() {
    const name = inputName.value.trim();
    const folder = inputFolder.value.trim();
    // Disallow periods in name
    const isValidName = name && !name.includes('.');
    btnCreate.disabled = !(isValidName && folder);
}

// Event Listeners
window.electronAPI.onShowNewProjectModal(() => {
    openModal();
});

btnSelectFolder.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFolder();
    if (path) {
        inputFolder.value = path;
        validateForm();
    }
});

btnCancel.addEventListener('click', () => {
    closeModal();
});

btnCreate.addEventListener('click', async () => {
    const name = inputName.value.trim();
    const folder = inputFolder.value.trim();
    if (name && folder) {
        // Disable button to prevent double submit
        btnCreate.disabled = true;
        const success = await window.electronAPI.createNewProject(name, folder);
        if (success) {
            closeModal();
        } else {
            // Re-enable if failed (though main process shows error box usually)
            btnCreate.disabled = false;
        }
    }
});

inputName.addEventListener('input', validateForm);

// Keyboard shortcuts for New Project Modal
modalOverlay.addEventListener('keydown', (e) => {
    if (modalOverlay.style.display === 'none') return;

    if (e.key === 'Enter') {
        if (!btnCreate.disabled) {
            btnCreate.click();
        }
    } else if (e.key === 'Escape') {
        closeModal();
    }
});

// --- New Include Modal Logic ---
const modalIncludeOverlay = document.getElementById('modal-include-overlay');
const inputIncludeName = document.getElementById('new-include-name');
const inputIncludeFolder = document.getElementById('new-include-folder');
const btnSelectIncludeFolder = document.getElementById('btn-select-include-folder');
const btnCancelInclude = document.getElementById('btn-cancel-include');
const btnCreateInclude = document.getElementById('btn-confirm-include');

function openIncludeModal(defaultFolder) {
    inputIncludeName.value = '';
    inputIncludeFolder.value = defaultFolder || '';
    validateIncludeForm();
    modalIncludeOverlay.style.display = 'flex';
    inputIncludeName.focus();
}

function closeIncludeModal() {
    modalIncludeOverlay.style.display = 'none';
}

function validateIncludeForm() {
    const name = inputIncludeName.value.trim();
    const folder = inputIncludeFolder.value.trim();
    btnCreateInclude.disabled = !(name && folder);
}

window.electronAPI.onShowNewIncludeModal((defaultFolder) => {
    openIncludeModal(defaultFolder);
});

btnSelectIncludeFolder.addEventListener('click', async () => {
    const path = await window.electronAPI.selectFolder(inputIncludeFolder.value);
    if (path) {
        inputIncludeFolder.value = path;
        validateIncludeForm();
    }
});

btnCancelInclude.addEventListener('click', () => {
    closeIncludeModal();
});

btnCreateInclude.addEventListener('click', async () => {
    const name = inputIncludeName.value.trim();
    const folder = inputIncludeFolder.value.trim();
    if (name && folder) {
        btnCreateInclude.disabled = true;
        const success = await window.electronAPI.createNewInclude(name, folder);
        if (success) {
            closeIncludeModal();
        } else {
            btnCreateInclude.disabled = false;
        }
    }
});

inputIncludeName.addEventListener('input', validateIncludeForm);

// Keyboard shortcuts for New Include Modal
modalIncludeOverlay.addEventListener('keydown', (e) => {
    if (modalIncludeOverlay.style.display === 'none') return;

    if (e.key === 'Enter') {
        if (!btnCreateInclude.disabled) {
            btnCreateInclude.click();
        }
    } else if (e.key === 'Escape') {
        closeIncludeModal();
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

    await saveAllFiles();
    const projectFiles = getProjectFilesContent();

    await window.electronAPI.startTest(rootInkPath, projectFiles);
}

document.getElementById('btn-start-test').addEventListener('click', async () => {
    await handleStartTest();
});

window.electronAPI.onTriggerStartTest(async () => {
    await handleStartTest();
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
