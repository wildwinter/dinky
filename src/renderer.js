import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
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

monaco.languages.register({ id: 'ink' });

monaco.languages.setMonarchTokensProvider('ink', {
    tokenizer: {
        root: [
            // Comments (Top priority)
            [/\/\/.*$/, 'comment'],
            [/\/\*/, 'comment', '@comment'],

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
            [/[{}]/, 'delimiter.bracket'],
            [/\w+(?=\()/, 'function'], // Function calls
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
    theme: 'vs-dark',
    automaticLayout: true,
    readOnly: true,
});

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

window.electronAPI.onRootInkLoaded((files) => {
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

    isUpdatingContent = true;
    currentFilePath = file.absolutePath;
    editor.setValue(file.content);
    isUpdatingContent = false;

    checkSyntax();
}

function updateDeleteButtonState(isRoot) {
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
            /* if (errors && errors.length > 0) {
                window.electronAPI.log('First error sample:', JSON.stringify(errors[0]))
            } */

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

editor.onDidChangeModelContent(() => {
    if (isUpdatingContent) return;

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
});

window.electronAPI.onThemeUpdated((theme) => {
    monaco.editor.setTheme(theme);
    if (theme === 'vs') {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    } else {
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
