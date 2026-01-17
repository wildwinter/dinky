import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { DinkySpellChecker } from './spellchecker';
import { IdHidingManager } from './id-manager';
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

class ModalHelper {
    constructor(config) {
        this.overlay = document.getElementById(config.overlayId);
        this.confirmBtn = document.getElementById(config.confirmBtnId);
        this.cancelBtn = document.getElementById(config.cancelBtnId);
        this.onConfirm = config.onConfirm;
        this.onValidate = config.onValidate || (() => true);
        this.onShow = config.onShow || (() => { });
        this.onCancel = config.onCancel || (() => { });

        this._initListeners();
    }

    _initListeners() {
        this.confirmBtn.addEventListener('click', async () => {
            if (this.confirmBtn.disabled) return;
            this.confirmBtn.disabled = true; // Prevent double submission
            try {
                const success = await this.onConfirm();
                if (success) {
                    this.close();
                } else {
                    this.validate(); // Re-enable based on validation if failed
                }
            } catch (e) {
                console.error("Modal confirm action failed", e);
                this.validate();
            }
        });

        this.cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });

        this.overlay.addEventListener('keydown', (e) => {
            if (this.overlay.style.display === 'none') return;
            if (e.key === 'Enter') {
                if (!this.confirmBtn.disabled) {
                    this.confirmBtn.click();
                }
            } else if (e.key === 'Escape') {
                this.onCancel();
                this.close();
            }
        });
    }

    open(...args) {
        this.onShow(...args);
        this.overlay.style.display = 'flex';
        this.validate();
        const input = this.overlay.querySelector('input');
        if (input) {
            input.focus();
            if (input.value) input.select();
        }
    }

    close() {
        this.overlay.style.display = 'none';
        // Reset button state slightly delayed or immediately ensure clean state
        this.confirmBtn.disabled = false;
    }

    validate() {
        this.confirmBtn.disabled = !this.onValidate();
    }
}


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
            [/#/, 'annotation', '@tagMode'],

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
        tagMode: [
            [/\/\/.*$/, 'comment', '@pop'],
            [/\/\*/, 'comment', '@comment'],
            [/\]/, '@rematch', '@pop'],

            // Content ending at EOL -> POP
            [/[^\]\/]+$/, 'annotation', '@pop'],

            // Content NOT ending at EOL -> STAY
            [/[^\]\/]+/, 'annotation'],
            [/\/(?!\/|\*)/, 'annotation'],

            // Fallback
            [/$/, 'annotation', '@pop']
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

// ID Hiding Manager
const idManager = new IdHidingManager(editor, monaco);
idManager.setupCopyInterceptor();

window.electronAPI.onSettingsUpdated((newSettings) => {
    if (newSettings.hideIds !== undefined) {
        idManager.setEnabled(newSettings.hideIds);
    }
});

// Initial load check
window.electronAPI.loadSettings().then(settings => {
    if (settings.hideIds !== undefined) {
        idManager.setEnabled(settings.hideIds);
    }
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



let loadedInkFiles = new Map();
let currentFilePath = null;
let rootInkPath = null;
let isUpdatingContent = false;
let lastTestKnot = null;

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
    idManager.updateDecorations();
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

async function autoTag() {
    if (!rootInkPath || !currentFilePath) return;

    // Use current content
    const content = editor.getValue();

    // We only pass the current file's content to the tagger for now 
    // (though in theory it might need project context, usually local is enough for parsing a single file)
    // However, parseInk in main might expect projectFiles if we want consistent parsing.
    const projectFiles = getProjectFilesContent();

    try {
        const edits = await window.electronAPI.autoTagInk(content, currentFilePath, projectFiles);
        if (edits && edits.length > 0) {

            const model = editor.getModel();
            if (!model) return;

            const monacoEdits = [];

            edits.forEach(edit => {
                // Double check the line content matches what we expect
                // The Monaco buffer might have changed since the debounce fired if the user typed fast.
                // It's safer to only apply if the line is exactly what we tagged.
                const lineContent = model.getLineContent(edit.line);

                // For choices (e.g. * [Choice]), the line content contains more than just the text node's text.
                // So we check if the line *contains* the text we tagged.
                if (lineContent.includes(edit.text)) {
                    let insertColumn = -1;

                    // PARSE LINE TO DETERMINE INSERTION POINT
                    // Separate content from comments
                    const commentIdx = lineContent.indexOf('//');
                    const contentPart = commentIdx === -1 ? lineContent : lineContent.substring(0, commentIdx);

                    // Check for Choice
                    const trimmedLine = contentPart.trim();
                    const isChoice = trimmedLine.startsWith('*') || trimmedLine.startsWith('+');

                    if (isChoice) {
                        const openIdx = contentPart.indexOf('[');
                        const closeIdx = contentPart.indexOf(']'); // First closing bracket usually closes the choice content

                        // Check for Contained Choice: * [Option]
                        if (openIdx !== -1 && closeIdx !== -1) {
                            if (openIdx > closeIdx) {
                                // Mismatched order ]...[ - Ignore as error
                                return;
                            }

                            // Valid pair. Check if our target text is inside.
                            // Note: contentPart contains the "display text" inside brackets?
                            // edit.text is what the tagger found.
                            // If tagger found "Option", and line is `* [Option]`.
                            const textIdx = contentPart.indexOf(edit.text);

                            if (textIdx > openIdx && textIdx < closeIdx) {
                                // Text is inside brackets. Insert before closing bracket.
                                // Insert exactly at closeIdx position (pushes ] to right)
                                // Monaco columns are 1-based. closeIdx is 0-based index.
                                // So column = closeIdx + 1.
                                insertColumn = closeIdx + 1;
                            } else {
                                // Text is outside brackets (e.g. output text).
                                // Insert at end of contentPart.
                                insertColumn = contentPart.trimEnd().length + 1;
                            }

                        } else if (openIdx !== -1 || closeIdx !== -1) {
                            // Mismatched (only one present). Ignore as error.
                            return;
                        } else {
                            // Plain Choice. Insert at end of contentPart.
                            insertColumn = contentPart.trimEnd().length + 1;
                        }
                    } else {
                        // Regular line. Insert at end of contentPart.
                        insertColumn = contentPart.trimEnd().length + 1;
                    }

                    if (insertColumn !== -1) {
                        const tagToAdd = ` ${edit.fullTag}`;

                        monacoEdits.push({
                            range: new monaco.Range(edit.line, insertColumn, edit.line, insertColumn),
                            text: tagToAdd,
                            forceMoveMarkers: true
                        });
                    }
                }
            });

            if (monacoEdits.length > 0) {
                isUpdatingContent = true; // Prevent triggering change events for our own edits
                model.pushEditOperations(
                    [],
                    monacoEdits,
                    () => null
                );
                isUpdatingContent = false;

                // Explicitly update decorations since we skipped the change event
                idManager.updateDecorations();
            }
        }
    } catch (e) {
        window.electronAPI.log('autoTag failed:', e.toString());
    }
}

const debouncedCheck = debounce(checkSyntax, 1000);
const debouncedCheckSpelling = debounce(checkSpelling, 400);
const debouncedAutoTag = debounce(autoTag, 2000);

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
    debouncedAutoTag();
    idManager.updateDecorations();
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

    // Pre-save Sanitization
    for (const [filePath, file] of loadedInkFiles) {
        let content = file.content;

        // Prefix Sanitize: Space before #id:
        content = content.replace(/([^\s])(#id:)/g, '$1 $2');

        // Suffix Sanitize: Space after _XXXX if followed by invalid char
        // Invalid chars are anything that is NOT space, newline, ], or /
        // We iterate matches manually because regex replace is tricky with the "Last" requirement

        // Find all ID tags
        const tagRegex = /#id:[a-zA-Z0-9_]+/g;
        let match;

        let newContent = content;
        const insertions = [];

        while ((match = tagRegex.exec(content)) !== null) {
            const fullTag = match[0];
            // Rule: Valid ID must end with _XXXX
            if (/_([a-zA-Z0-9]{4})$/.test(fullTag)) {
                continue;
            }

            // Search for last valid suffix
            const suffixRegex = /_([a-zA-Z0-9]{4})/g;
            let suffixMatch;
            let lastSuffixMatch = null;
            while ((suffixMatch = suffixRegex.exec(fullTag)) !== null) {
                lastSuffixMatch = suffixMatch;
            }

            if (lastSuffixMatch) {
                const suffixEndIndex = lastSuffixMatch.index + 5;
                if (suffixEndIndex < fullTag.length) {
                    // Calculate absolute index in content where space should be
                    const absoluteIndex = match.index + suffixEndIndex;
                    insertions.push(absoluteIndex);
                }
            }
        }

        // Apply insertions (reverse order)
        insertions.sort((a, b) => b - a);
        for (const index of insertions) {
            newContent = newContent.slice(0, index) + ' ' + newContent.slice(index);
        }

        if (newContent !== file.content) {
            file.content = newContent;

            // If this is the currently open file, update the editor to match
            // This ensures what you see is what is saved (and valid)
            if (filePath === currentFilePath) {
                const pos = editor.getPosition();
                editor.setValue(newContent);
                if (pos) editor.setPosition(pos);
            }
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
        // Try to rely on last known position? Or just fail?
        // Let's just return for now or alert. 
        // Attempting to focus and get position again might work but is racey.
        return;
    }

    const knotName = findCurrentKnot(model, position);

    if (knotName) {
        console.log('Testing knot:', knotName);
        lastTestKnot = knotName;
        await window.electronAPI.startTest(rootInkPath, projectFiles, knotName);
    } else {
        // Fallback to normal start or alert? 
        // For now, if no knot found, maybe just start from beginning or warn.
        // Let's just start regular test if no knot found? Or maybe alert.
        // User behavior "Test Knot" implies they expect a knot.
        // But finding a knot is heuristic.
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
