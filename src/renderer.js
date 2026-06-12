// Core imports
import { DinkySpellChecker } from './spellchecker';
import { IdPreservationManager } from './id-manager';
import { ModalHelper } from './modal-helper';

// Module imports - Refactored editor functionality
import { configureMonacoWorkers, getInitialTheme, applyThemeToDOM, createEditor, setupThemeListener, monaco } from './editor-setup';
import { defineThemes, registerInkLanguage } from './tokenizer-rules';
import { initScratchRecorder, loadScratchAudioConfig, getScratchAudioEnabled, checkScratchAudioMarkers, markScratchLineOk, triggerRecordScratch, getIsRecording, isDinkDialogueLine, generateHashFromText, extractDialogueText } from './scratchRecorder';
import { NavigationSystem } from './navigation-system';
import { initTooltips } from './tooltipManager';
import { ModelPool } from './model-pool';
import { ValidationEngine } from './validation-engine';
import { escapeRegExp, levenshtein, debounce } from './utils/string-utilities';
import { classifyCommentAtLine, findLineCommentStart } from './comment-classifier';
import { initSidebarResizer } from './sidebar-resizer';

// Add platform-specific CSS class
if (window.electronAPI.platform === 'win32') {
    document.body.classList.add('windows');
} else if (window.electronAPI.platform === 'darwin') {
    document.body.classList.add('macos');
} else {
    document.body.classList.add('linux');
}

// Initialize tooltip system
initTooltips();

// Initialize draggable sidebar resizer (loads persisted width)
initSidebarResizer();

// Initialize Monaco worker environment
configureMonacoWorkers();

// Define and register themes
defineThemes(monaco);

// Register Ink language with Monaco
registerInkLanguage(monaco);

// Initialize refactored managers
const initialTheme = getInitialTheme();
applyThemeToDOM(initialTheme);
const editor = createEditor('editor-container', initialTheme);
setupThemeListener((newTheme) => {
    // Additional theme setup if needed
});

// Declare global state variables early (before manager initialization)
let loadedInkFiles = new Map();
let projectCharacters = [];
let projectWritingStatusTags = [];
let currentFilePath = null;
let rootInkPath = null;
let isUpdatingContent = false;
let lastTestKnot = null;

// Spell check optimization - track changed lines
let lastSpellCheckedFilePath = null;
let spellCheckMarkersByLine = new Map(); // filePath -> markers array

// Error banner state
let currentErrors = []; // Array of all current errors (compilation errors + spell check)
let errorBannerIndex = 0; // Current error being displayed in the banner
let previousErrorsCount = 0; // Track previous error count to detect changes
let hasInkCompileErrors = false; // True when the Ink compiler reports errors — blocks auto-tagging
let inkErrorFiles = new Set();   // Paths of files that currently have Ink compile errors


// Initialize core instances
const spellChecker = new DinkySpellChecker();
const idManager = new IdPreservationManager(editor, monaco);

const jumpHighlightCollection = editor.createDecorationsCollection();
const wsTagDecorationCollection = editor.createDecorationsCollection();

// Initialize ModelPool for efficient model reuse
const modelPool = new ModelPool(5);

// Initialize NavigationSystem for dropdown and history (with reference to loadedInkFiles)
const navigationSystem = new NavigationSystem(editor, loadedInkFiles);

// Initialize ValidationEngine for character and tag validation
const validationEngine = new ValidationEngine(monaco);

// Check Scratch preference
let checkScratchEnabled = false;
const checkScratchCheckbox = document.getElementById('chk-check-scratch');

// Load spell checker settings and check-scratch preference
window.electronAPI.loadSettings().then(async settings => {
    const locale = settings.spellCheckerLocale || 'en-GB';
    await spellChecker.init(locale);
    // Check spelling for any auto-loaded project
    if (rootInkPath) {
        checkSpelling();
    }

    // Restore check-scratch preference
    checkScratchEnabled = !!settings.checkScratch;
    if (checkScratchCheckbox) checkScratchCheckbox.checked = checkScratchEnabled;
});

window.electronAPI.onSettingsUpdated(async (newSettings) => {
    if (newSettings.spellCheckerLocale) {
        await spellChecker.switchLocale(newSettings.spellCheckerLocale);
        // Clear spell check cache when locale changes
        spellCheckMarkersByLine.clear();
        lastSpellCheckedFilePath = null;
        checkSpelling();
    }
    if (newSettings.checkScratch !== undefined) {
        checkScratchEnabled = !!newSettings.checkScratch;
        if (checkScratchCheckbox) checkScratchCheckbox.checked = checkScratchEnabled;
    }
});

// Wire up check-scratch checkbox
if (checkScratchCheckbox) {
    checkScratchCheckbox.addEventListener('change', () => {
        checkScratchEnabled = checkScratchCheckbox.checked;
        window.electronAPI.setSetting('checkScratch', checkScratchEnabled);
        checkSyntax();
    });
}

// Rerun spellcheck on window focus to catch external dictionary edits
window.addEventListener('focus', async () => {
    if (rootInkPath) {
        console.log('Window focused, rerunning spellcheck...');
        const projectDict = await window.electronAPI.loadProjectDictionary();
        spellChecker.setPersonalDictionary(projectDict);
        // Clear spell check cache when dictionary updates
        spellCheckMarkersByLine.clear();
        lastSpellCheckedFilePath = null;
        checkSpelling();
    }
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
    if (inkErrorFiles.has(currentFilePath)) return; // Skip while this file has Ink compile errors

    const modelFilePath = model.uri.path;
    const cachedMarkers = spellCheckMarkersByLine.get(modelFilePath);

    // Incremental check: if we have cached markers and only specific lines changed,
    // recheck just those lines and merge with the cached results
    if (lastSpellCheckedFilePath === modelFilePath && cachedMarkers && spellCheckDirtyLines.size > 0 && spellCheckDirtyLines.size < 50) {
        const dirtyLines = spellCheckDirtyLines;
        spellCheckDirtyLines = new Set();

        // Remove old markers on dirty lines
        const keptMarkers = cachedMarkers.filter(m => !dirtyLines.has(m.startLineNumber));

        // Recheck only the dirty lines
        const newMarkers = spellChecker.checkLines(model, monaco, dirtyLines);

        const allMarkers = [...keptMarkers, ...newMarkers];
        spellCheckMarkersByLine.set(modelFilePath, allMarkers);
        lastSpellCheckedFilePath = modelFilePath;
        monaco.editor.setModelMarkers(model, 'spellcheck', allMarkers);
        return;
    }

    // Full spell check (file switch, dictionary change, or too many dirty lines)
    spellCheckDirtyLines = new Set();
    const markers = spellChecker.checkModel(model, monaco);

    spellCheckMarkersByLine.set(modelFilePath, markers);
    lastSpellCheckedFilePath = modelFilePath;

    monaco.editor.setModelMarkers(model, 'spellcheck', markers);
}


// Error banner management functions
function updateErrorBanner() {
    const banner = document.getElementById('error-banner');
    const bannerText = document.getElementById('error-banner-text');
    const prevBtn = document.getElementById('error-banner-prev');
    const nextBtn = document.getElementById('error-banner-next');
    const markOkBtn = document.getElementById('error-banner-mark-ok');
    const recordBtn = document.getElementById('error-banner-record');

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

    const isScratchAudioError = error.message === 'Out of date scratch audio' || error.message === 'Missing scratch audio';

    // Show "Mark OK" button only for out-of-date scratch audio errors
    if (markOkBtn) {
        markOkBtn.style.display = (error.message === 'Out of date scratch audio') ? 'block' : 'none';
    }

    // Show "Record" button for any scratch audio error
    if (recordBtn) {
        recordBtn.style.display = isScratchAudioError ? 'block' : 'none';
    }

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

    // No basename fallback: when two .ink files share a name in different
    // folders, matching by basename routes error markers to whichever match
    // is iterated first — i.e. silently wrong. Better to return null and let
    // the caller treat it as "unknown file" than to mislead.
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
document.getElementById('error-banner-mark-ok').addEventListener('click', async () => {
    if (!currentErrors || currentErrors.length === 0) return;
    const error = currentErrors[errorBannerIndex];
    if (!error || error.message !== 'Out of date scratch audio') return;
    const success = await markScratchLineOk(error.filePath, error.startLineNumber);
    if (success) {
        // Re-run syntax check to refresh markers and error banner
        checkSyntax();
        // Also refresh the audio status chip for the current cursor line
        updateTestAudioButton();
    }
});

document.getElementById('error-banner-record').addEventListener('click', () => {
    if (!currentErrors || currentErrors.length === 0) return;
    const error = currentErrors[errorBannerIndex];
    if (!error) return;
    const isScratchAudioError = error.message === 'Out of date scratch audio' || error.message === 'Missing scratch audio';
    if (!isScratchAudioError) return;

    const line = error.startLineNumber || 1;

    // Navigate to the error's file/line first, then trigger recording
    if (error.filePath && error.filePath !== currentFilePath) {
        const file = findFileByPath(error.filePath);
        if (file && file.listItem) {
            file.listItem.click();
            setTimeout(() => {
                const model = editor.getModel();
                if (model) {
                    editor.revealLineInCenter(line);
                    editor.setPosition({ lineNumber: line, column: 1 });
                    editor.focus();
                }
                triggerRecordScratch();
            }, 200);
            return;
        }
    }

    // Same file — just move cursor and record
    if (editor && editor.getModel()) {
        editor.revealLineInCenter(line);
        editor.setPosition({ lineNumber: line, column: 1 });
        editor.focus();
    }
    triggerRecordScratch();
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

// Tracks the highest structural-change revision the renderer has seen.
// Used to drop stale 'ink-files-refreshed' events that were captured before
// a more recent structural change (rename, add, remove, project switch).
let lastSeenInkRootRev = 0;

window.electronAPI.onRootInkLoaded(async (files, rev) => {
    if (typeof rev === 'number' && rev > lastSeenInkRootRev) {
        lastSeenInkRootRev = rev;
    }
    // Load project dictionary
    const projectDict = await window.electronAPI.loadProjectDictionary();
    spellChecker.setPersonalDictionary(projectDict);

    loadedInkFiles.clear();
    // Clear model pool when loading new project
    modelPool.clearPool();
    // Clear spell check cache when loading new project
    spellCheckMarkersByLine.clear();
    lastSpellCheckedFilePath = null;
    // Invalidate navigation structure cache when files change
    navigationSystem.invalidateCache();

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
            rootFileStepInfo.setAttribute('data-tooltip', file.absolutePath);

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
            li.setAttribute('data-tooltip', file.absolutePath);

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

// Sidebar-only reconcile: fired by main on window focus and after save.
// Adds new INCLUDEs, removes stale ones, but DOES NOT touch the editor model
// (so unsaved edits survive). The full 'root-ink-loaded' event still handles
// project loads / root switches as before.
window.electronAPI.onInkFilesRefreshed((files, rev) => {
    if (!Array.isArray(files) || files.length === 0) return;

    // Bail if the project hasn't done its initial full load yet — the add
    // loop below intentionally skips index 0 (the root file), so processing
    // a refresh against an empty map would populate includes but never the
    // root. Let the imminent 'root-ink-loaded' do the first build.
    if (loadedInkFiles.size === 0) return;

    // Drop refreshes that have been overtaken by a more recent structural
    // change. Fixes the race where a slow focus refresh emits stale paths
    // after a rename has already happened and re-built the sidebar.
    if (typeof rev === 'number' && rev < lastSeenInkRootRev) {
        console.warn(`Ignoring stale ink-files-refreshed (rev ${rev} < ${lastSeenInkRootRev})`);
        return;
    }

    const newPathSet = new Set(files.map(f => f.absolutePath));
    const fileList = document.getElementById('file-list');

    // Remove sidebar entries (and cached state) for files no longer reachable.
    // Skip files with unsaved edits so the user doesn't silently lose work —
    // they can save (which writes to the original path) or close the file first.
    const removedPaths = [];
    for (const path of Array.from(loadedInkFiles.keys())) {
        if (newPathSet.has(path)) continue;
        if (path === rootInkPath) continue; // root shouldn't vanish; ignore if it does
        const file = loadedInkFiles.get(path);
        const hasUnsavedEdits = file && file.content !== file.originalContent;
        if (hasUnsavedEdits) {
            console.warn('Keeping unsaved file in sidebar despite missing INCLUDE / disk file:', path);
            continue;
        }
        if (file?.listItem && file.listItem.parentNode) {
            file.listItem.parentNode.removeChild(file.listItem);
        }
        loadedInkFiles.delete(path);
        modelPool.removeModel?.(path);
        spellCheckMarkersByLine.delete(path);
        removedPaths.push(path);
    }

    // If the user was viewing one of the removed files, switch back to the root.
    if (removedPaths.includes(currentFilePath)) {
        const rootFile = loadedInkFiles.get(rootInkPath);
        const rootListItem = document.getElementById('ink-root-file-item');
        if (rootFile) loadFileToEditor(rootFile, rootListItem, true);
    }

    // Add new INCLUDEs that weren't loaded before.
    files.forEach((file, index) => {
        if (index === 0) return; // root file — handled by 'root-ink-loaded'
        if (loadedInkFiles.has(file.absolutePath)) return;

        file.originalContent = file.content;
        loadedInkFiles.set(file.absolutePath, file);

        const li = document.createElement('li');
        file.listItem = li;
        li.textContent = file.relativePath;
        li.setAttribute('data-tooltip', file.absolutePath);
        li.onclick = () => loadFileToEditor(file, li);
        fileList.appendChild(li);
    });
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

window.electronAPI.onCompileComplete(({ code, destFolder, destFile, exportType }) => {
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

    // Determine the operation name
    let operationName = 'COMPILE';
    if (exportType === 'html') operationName = 'HTML EXPORT';
    else if (exportType === 'pdf') operationName = 'PDF EXPORT';
    else if (exportType === 'word') operationName = 'WORD EXPORT';

    if (code === 0) {
        statusSpan.textContent = `✓ ${operationName} SUCCESSFUL`;
        statusSpan.style.color = '#4CAF50';
        statusSpan.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
        statusSpan.style.border = '1px solid #4CAF50';
    } else {
        statusSpan.textContent = `✗ ${operationName} FAILED (Exit Code: ${code})`;
        statusSpan.style.color = '#f44336';
        statusSpan.style.backgroundColor = 'rgba(244, 67, 54, 0.1)';
        statusSpan.style.border = '1px solid #f44336';
    }

    // Append the status message
    outputEl.appendChild(statusSpan);
    outputEl.appendChild(document.createTextNode('\n'));

    // Add output location if successful
    if (code === 0 && destFolder) {
        outputEl.appendChild(document.createTextNode(`Files are available in ${destFolder}`));
    } else if (code === 0 && destFile) {
        outputEl.appendChild(document.createTextNode(`File saved to ${destFile}`));
    }

    // Enable close button
    btnCloseCompile.disabled = false;

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
});

// Export modal handlers
async function openExportModal(exportType, exportFunction, fileFilters) {
    // First, select the export file with appropriate filters
    const destFile = await window.electronAPI.saveFile(undefined, fileFilters);

    if (!destFile) {
        // User cancelled file selection
        return;
    }

    // Open the compile modal to show progress
    compileModalOverlay.style.display = 'flex';
    compileOutput.textContent = '';
    btnCloseCompile.disabled = true;

    // Reset scroll to top
    compileOutputContainer.scrollTop = 0;

    // Save all files before exporting
    compileOutput.textContent = 'Saving files...\n';
    try {
        await saveAllFiles();
        compileOutput.textContent += 'Files saved.\n\n';
    } catch (error) {
        compileOutput.textContent = `Error saving files: ${error.message}\n`;
        btnCloseCompile.disabled = false;
        return;
    }

    // Start export
    const result = await exportFunction(destFile);

    // If export failed to start, show error and enable close button
    if (result && !result.success) {
        compileOutput.textContent += `Error: ${result.error}\n`;
        btnCloseCompile.disabled = false;
        compileOutputContainer.scrollTop = compileOutputContainer.scrollHeight;
    }
}

window.electronAPI.onShowExportHTMLModal(() => {
    openExportModal('html', window.electronAPI.exportHTML, [
        { name: 'HTML Files', extensions: ['html'] }
    ]);
});

window.electronAPI.onShowExportPDFModal(() => {
    openExportModal('pdf', window.electronAPI.exportPDF, [
        { name: 'PDF Files', extensions: ['pdf'] }
    ]);
});

window.electronAPI.onShowExportWordModal(() => {
    openExportModal('word', window.electronAPI.exportWord, [
        { name: 'Word Documents', extensions: ['docx', 'doc'] }
    ]);
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
    navigationSystem.setCurrentFilePath(currentFilePath);

    // ATOMIC MODEL SWAP STRATEGY with pooling
    const oldModel = editor.getModel();

    // Extract IDs and clean content
    const { cleanContent, extractedIds } = idManager.extractIds(file.content);

    // Get or create model from pool (reuses existing models when available)
    const isDinky = detectDinkyGlobal(cleanContent);
    const langId = isDinky ? 'ink-dinky' : 'ink';
    const newModel = modelPool.getOrCreateModel(file.absolutePath, cleanContent, langId, monaco);

    // Swap the model
    editor.setModel(newModel);

    // Apply decorations to track the IDs
    idManager.setupDecorations(extractedIds);

    // Refresh audio glyph colors (async, non-blocking)
    refreshAudioGlyphs();

    // Return old model to pool instead of immediately disposing
    // This preserves its state for quick reuse when switching back
    if (oldModel && oldModel.uri.path !== newModel.uri.path) {
        // Old model is different, keep it in pool for later reuse
        // Don't dispose it immediately - the pool will manage lifecycle
    }

    // Reset spell check cache when switching files
    lastSpellCheckedFilePath = null;

    // Update writing status tag highlighting immediately for visual feedback
    highlightWritingStatusTags(newModel);

    isUpdatingContent = false;

    // Defer non-critical operations to keep UI responsive immediately after model swap
    // Use requestIdleCallback for background checks that don't block interaction
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            checkSyntax();
            checkSpelling();
            autoTag();
            refreshNavigationDropdown();
            updateTestAudioButton();
        });
    } else {
        // Fallback for browsers without requestIdleCallback
        setTimeout(() => {
            checkSyntax();
            checkSpelling();
            autoTag();
            refreshNavigationDropdown();
            updateTestAudioButton();
        }, 0);
    }

    // Track navigation when switching files (but not if we're in the middle of back/forward navigation)
    if (!navigationSystem.getIsNavigatingHistory()) {
        addToNavigationHistory(file.absolutePath, 1);
    }

    // Update last navigation location to the file start
    navigationSystem.lastNavigationLocation = { filePath: file.absolutePath, knotName: null };
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
        validationEngine.setProjectCharacters(projectCharacters);

        // Load writing status tags from project config
        try {
            const projectConfig = await window.electronAPI.getProjectConfig();
            projectWritingStatusTags = (projectConfig && projectConfig.writingStatus) || [];
        } catch (e) {
            console.error('Failed to load writing status tags', e);
            projectWritingStatusTags = [];
        }
        validationEngine.setProjectWritingStatusTags(projectWritingStatusTags);

        // Load scratch audio settings
        await loadScratchAudioConfig();

        // Toggle scratch audio toolbar section visibility
        const scratchAudioSection = document.getElementById('scratch-audio-section');
        if (scratchAudioSection) {
            scratchAudioSection.style.display = getScratchAudioEnabled() ? 'flex' : 'none';
        }

        const errors = await window.electronAPI.compileInk(contentToCompile, rootInkPath, projectFiles);

        const inkErrorsWerePresent = hasInkCompileErrors;
        hasInkCompileErrors = !!(errors && errors.length > 0);
        inkErrorFiles = new Set((errors || []).map(e => e.filePath).filter(Boolean));

        const model = editor.getModel();
        if (model) {
            // Update writing status tag highlighting after loading tags
            highlightWritingStatusTags(model);

            // Filter errors to display only those relevant to the current file (for Monaco markers)
            const activePath = currentFilePath || rootInkPath;
            const visibleErrors = errors.filter(e => {
                if (!e.filePath) return true;
                if (e.filePath === activePath) return true;
                if (activePath) {
                    const currentFileName = activePath.replace(/^.*[\\\/]/, '');
                    const errorFileName = e.filePath.replace(/^.*[\\\/]/, '');
                    return currentFileName === errorFileName;
                }
                return false;
            });

            // Run character + writing status validation for all files in a single pass
            let allCharErrors = [];
            let allWsErrors = [];
            let currentFileCharErrors = [];
            let currentFileWsErrors = [];
            const currentModelText = model.getValue();

            for (const [filePath, fileObj] of loadedInkFiles) {
                // Skip validation for files that have Ink compile errors — they produce false positives
                if (inkErrorFiles.has(filePath)) continue;

                const isCurrentFile = (filePath === activePath);
                const text = isCurrentFile ? currentModelText : fileObj.content;

                const charErrors = validateCharacterNamesInText(text);
                const wsErrors = validateWritingStatusTagsInText(text);

                const charErrorsWithPath = charErrors.map(err => ({ ...err, filePath }));
                const wsErrorsWithPath = wsErrors.map(err => ({ ...err, filePath }));

                allCharErrors = allCharErrors.concat(charErrorsWithPath);
                allWsErrors = allWsErrors.concat(wsErrorsWithPath);

                // Collect current file markers for Monaco display (avoids extra getValue calls)
                if (isCurrentFile) {
                    currentFileCharErrors = charErrors;
                    currentFileWsErrors = wsErrors;
                }
            }

            // Run scratch audio checks for all files (only when "Check Scratch?" is ticked)
            const allScratchErrors = checkScratchEnabled ? await checkScratchAudioMarkers() : [];
            const currentFileScratchErrors = allScratchErrors.filter(e => e.filePath === activePath);

            // Update error banner with ALL errors from all files
            const newErrors = sortErrors([...(errors || []), ...allCharErrors, ...allWsErrors, ...allScratchErrors]);

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

            // If Ink compile errors just cleared, run fresh passes now
            if (inkErrorsWerePresent && !hasInkCompileErrors) {
                autoTag();
                checkSpelling();
            }

            // Update Monaco markers with visible errors + character errors + writing status errors + scratch audio errors for current file
            monaco.editor.setModelMarkers(model, 'ink', [...(visibleErrors || []), ...currentFileCharErrors, ...currentFileWsErrors, ...currentFileScratchErrors]);
        }

        // Refresh audio glyph colors
        refreshAudioGlyphs();
    } catch (e) {
        window.electronAPI.log('checkSyntax failed:', e.toString())
    }
}


let isAutoTagging = false;

async function autoTag() {
    if (!rootInkPath || !currentFilePath) return;
    if (isAutoTagging) return;
    if (hasInkCompileErrors) return; // Don't tag while Ink has compile errors

    isAutoTagging = true;
    try {
        // Use current content
        const content = editor.getValue();
        const projectFiles = getProjectFilesContent();
        // Pass reconstructed content (with existing IDs) to tagger
        // This ensures we generating IDs for lines that truly don't have them
        const reconstructedContent = idManager.reconstructContent(content);

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
    } finally {
        isAutoTagging = false;
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
            // File just became a Dink file — re-run checks that depend on Dink syntax awareness
            if (targetLang === 'ink-dinky') {
                autoTag();
                checkSpelling();
            }
        }
    }
}, 500);

// Track dirty line ranges for incremental spellchecking
let spellCheckDirtyLines = new Set();

editor.onDidChangeModelContent((e) => {
    if (isUpdatingContent) return;

    const model = editor.getModel();
    const modelPath = model?.uri.path;

    // Track which lines changed for incremental spellchecking. If any change
    // alters the line count (insertion/deletion of newlines), the cached
    // markers' line numbers below the change point become stale — drop the
    // cache so the next check does a full pass.
    let lineCountChanged = false;
    for (const change of e.changes) {
        const startLine = change.range.startLineNumber;
        const oldLineSpan = change.range.endLineNumber - change.range.startLineNumber;
        const newLineCount = (change.text.match(/\n/g) || []).length;
        if (newLineCount !== oldLineSpan) lineCountChanged = true;
        const endLine = startLine + newLineCount;
        for (let i = startLine; i <= endLine; i++) {
            spellCheckDirtyLines.add(i);
        }
    }
    if (lineCountChanged && modelPath) {
        spellCheckMarkersByLine.delete(modelPath);
        if (lastSpellCheckedFilePath === modelPath) lastSpellCheckedFilePath = null;
    }

    // Clear spellcheck markers immediately to avoid visual desync during editing
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

    // Update writing status tag highlighting
    highlightWritingStatusTags(model);

    // Invalidate navigation structure cache when content changes (knots/stitches may be added/removed)
    navigationSystem.invalidateCache();
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

// Character name autocomplete
['ink', 'ink-dinky'].forEach(lang => {
    monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [':'],
        provideCompletionItems: (model, position) => {
            // For plain 'ink' mode, only provide suggestions in Dinky sections
            if (lang === 'ink' && !isDinkyAtPosition(model, position)) {
                return { suggestions: [] };
            }

            const lineContent = model.getLineContent(position.lineNumber);
            const textBeforeCursor = lineContent.substring(0, position.column - 1);

            if (!/^(?:\s*|\s*-\s*|\s*[\*\+-]+\s*\[\s*):$/.test(textBeforeCursor)) {
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
                filterText: ':'
            }));

            return { suggestions };
        }
    });
});

// Writing status tag autocomplete
['ink', 'ink-dinky'].forEach(lang => {
    monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: [':'],
        provideCompletionItems: (model, position) => {
            const lineContent = model.getLineContent(position.lineNumber);
            const textBeforeCursor = lineContent.substring(0, position.column - 1);

            const match = textBeforeCursor.match(/#ws:([a-z0-9]*)$/);
            if (!match) {
                return { suggestions: [] };
            }

            const wsStartIndex = textBeforeCursor.lastIndexOf('#ws:');
            const range = new monaco.Range(
                position.lineNumber,
                wsStartIndex + 5,
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
});

const COMMENT_TYPE_DESCRIPTIONS = {
    'Scene Comment':  'Applies to the whole scene (knot).',
    'Block Comment':  'Applies to this whole block (stitch).',
    'Group Comment':  'Applies to all entries in this shuffle/once/stopping group.',
    'Beat Comment':   'Applies to this dialogue line or action beat.',
    'Snippet Comment':'Applies to this snippet (multi-line exchange).',
    'Option Comment': 'Appears as context before the response to this choice.',
};


// Dink comment type hover tooltips
['ink', 'ink-dinky'].forEach(lang => {
    monaco.languages.registerHoverProvider(lang, {
        provideHover(model, position) {
            const text = model.getLineContent(position.lineNumber);
            const commentStart = findLineCommentStart(text);
            if (commentStart < 0) return null;

            const lines = model.getValue().split(/\r?\n/);
            const lineIndex = position.lineNumber - 1;
            const columnIndex = position.column - 1;
            const isDinkyGlobal = lang === 'ink-dinky';

            const type = classifyCommentAtLine(lines, lineIndex, columnIndex, isDinkyGlobal);
            if (!type) return null;

            return {
                range: new monaco.Range(
                    position.lineNumber, commentStart + 1,
                    position.lineNumber, text.length + 1
                ),
                contents: [
                    { value: `**${type}** — ${COMMENT_TYPE_DESCRIPTIONS[type] || ''}` }
                ]
            };
        }
    });
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
// Re-entrancy guard: if a save is already in flight, return that promise rather
// than starting a second concurrent pass. Two interleaved saveAllFiles runs can
// corrupt originalContent tracking and double-apply tagger edits.
let _saveInFlight = null;
async function saveAllFiles() {
    if (_saveInFlight) return _saveInFlight;
    _saveInFlight = _doSaveAllFiles().finally(() => { _saveInFlight = null; });
    return _saveInFlight;
}

async function _doSaveAllFiles() {
    const filesToSave = [];

    // Snapshot the current file's CLEAN editor value at save start. We use
    // this for the post-save asterisk-clearing check: `file.content` for the
    // current file is also "clean" (kept that way by the keystroke handler),
    // and we need `file.originalContent` to share that representation so the
    // dirty marker clears correctly. The reconstructed-with-IDs version goes
    // to disk; the clean version is the in-memory baseline.
    const currentCleanSnapshot = currentFilePath ? editor.getValue() : null;

    // Prepare project files map for the tagger
    const projectFilesContent = {};
    for (const [path, file] of loadedInkFiles) {
        // Use current editor content if this is the active file
        if (path === currentFilePath) {
            projectFilesContent[path] = idManager.reconstructContent(currentCleanSnapshot);
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

        // For non-current files, sync `file.content` to the tagger-merged
        // output so that the next time the user opens this file, the in-memory
        // copy matches what's on disk (including any tagger IDs we just added).
        // For the CURRENT file, do NOT touch file.content — the keystroke
        // handler kept it in sync with the editor during the autoTag await,
        // and clobbering it here would lose mid-save edits.
        if (filePath !== currentFilePath && content !== file.content) {
            file.content = content;
        }

        filesToSave.push({ path: filePath, content });
    }

    // Invoke IPC to save files. Result tells us which files actually made it
    // to disk, so we don't mark refused/errored files as clean.
    const result = await window.electronAPI.saveFiles(filesToSave);
    const savedPaths = new Set(result?.savedPaths || []);
    const savedContentByPath = new Map(filesToSave.map(f => [f.path, f.content]));

    // Update originalContent only for files that actually saved.
    //
    // The representation has to match `file.content` or the dirty marker
    // stays stuck on after every save. Two important nuances:
    //
    //   - current file: file.content is supposed to be the CLEAN editor
    //     value, but the keystroke handler only sets it after the user
    //     types. Before any keystroke (e.g. just-opened file, save-before-
    //     compile with no edits), file.content is still the ID-rich initial
    //     load value — so we explicitly sync it to editor.getValue() here.
    //     We use editor.getValue() (latest), not currentCleanSnapshot, so
    //     that mid-save typing is reflected and the asterisk correctly
    //     stays on in that case.
    //   - other files: file.content is the ID-rich version we just wrote;
    //     use savedContentByPath.
    for (const [filePath, file] of loadedInkFiles) {
        if (!savedPaths.has(filePath)) continue; // failed/refused — leave dirty
        if (filePath === currentFilePath) {
            file.content = editor.getValue();
            file.originalContent = currentCleanSnapshot;
        } else {
            file.originalContent = savedContentByPath.get(filePath);
        }
        if (file.listItem) {
            const isModified = file.content !== file.originalContent;
            file.listItem.textContent = file.relativePath + (isModified ? '*' : '');
        }
    }

    // Re-traverse INCLUDEs from disk so the sidebar reflects any INCLUDE lines
    // the user added/removed by editing the root file directly. Fire-and-forget;
    // the result arrives via 'ink-files-refreshed'.
    window.electronAPI.refreshInkRoot().catch(() => {});

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

// Updater-specific listeners: kept separate from the regular check-unsaved
// flow so the updater can probe + save without colliding with the
// pendingAction state machine in main.
window.electronAPI.onUpdaterIsDirty(() => {
    let isDirty = false;
    for (const [filePath, file] of loadedInkFiles) {
        if (file.content !== file.originalContent) {
            isDirty = true;
            break;
        }
    }
    window.electronAPI.sendUpdaterIsDirtyReply(isDirty);
});

window.electronAPI.onUpdaterSaveBeforeInstall(async () => {
    let ok = false;
    try {
        ok = await saveAllFiles();
    } catch (e) {
        console.error('Save before update install failed:', e);
    }
    window.electronAPI.sendUpdaterSaveDone({ ok: !!ok });
});

window.electronAPI.onCharactersUpdated(() => {
    // Re-check syntax and spelling when characters are updated
    // This handles updates from the Character Editor modal
    debouncedCheck();
    debouncedCheckSpelling();
});

// Initial check
checkSyntax();

// ===== Navigation Dropdown =====
// All navigation logic is delegated to NavigationSystem.
// These thin wrappers maintain the call-site interface used throughout renderer.js.

function updateNavigationDropdown() {
    navigationSystem.updateNavigationDropdown();
}

function updateDropdownSelection() {
    navigationSystem.updateDropdownSelection();
}

function addToNavigationHistory(filePath, lineNumber) {
    navigationSystem.addToNavigationHistory(filePath, lineNumber);
}

function navigateBack() {
    navigationSystem.navigateBack();
}

function navigateForward() {
    navigationSystem.navigateForward();
}

/**
 * Test Audio button
 */
const testAudioBtn = document.getElementById('btn-test-audio');
const recordScratchBtn = document.getElementById('btn-record-scratch');
const audioStatusLabel = document.getElementById('audio-status-label');
let currentAudioFilePath = null;
let currentAudioElement = null;

// Wire up glyph click-to-play audio
idManager.playAudioForLine = async (audioFilePath) => {
    if (!audioFilePath) return;
    if (currentAudioElement) {
        currentAudioElement.pause();
        currentAudioElement = null;
    }
    const dataUrl = await window.electronAPI.readAudioFile(audioFilePath);
    if (!dataUrl) return;
    currentAudioElement = new Audio(dataUrl);
    if (testAudioBtn) testAudioBtn.classList.add('playing');
    currentAudioElement.play().catch(err => console.error('Failed to play audio:', err));
    currentAudioElement.addEventListener('ended', () => {
        currentAudioElement = null;
        if (testAudioBtn) testAudioBtn.classList.remove('playing');
    });
    currentAudioElement.addEventListener('pause', () => {
        if (testAudioBtn) testAudioBtn.classList.remove('playing');
    });
};

function setTestAudioEnabled(enabled) {
    if (!testAudioBtn) return;
    if (enabled) {
        testAudioBtn.style.opacity = '1';
        testAudioBtn.style.pointerEvents = 'auto';
    } else {
        testAudioBtn.style.opacity = '0.5';
        testAudioBtn.style.pointerEvents = 'none';
    }
    if (audioStatusLabel) {
        audioStatusLabel.style.pointerEvents = enabled ? 'auto' : 'none';
    }
}

function setRecordScratchEnabled(enabled) {
    if (!recordScratchBtn) return;
    if (enabled) {
        recordScratchBtn.style.opacity = '1';
        recordScratchBtn.style.pointerEvents = 'auto';
    } else {
        recordScratchBtn.style.opacity = '0.5';
        recordScratchBtn.style.pointerEvents = 'none';
    }
}

function updateRecordScratchButton() {
    if (!recordScratchBtn) return;
    const position = editor.getPosition();
    if (!position) {
        setRecordScratchEnabled(false);
        return;
    }
    if (getIsRecording()) {
        setRecordScratchEnabled(false);
        return;
    }
    const model = editor.getModel();
    if (!model) {
        setRecordScratchEnabled(false);
        return;
    }
    const lineContent = model.getLineContent(position.lineNumber);
    setRecordScratchEnabled(isDinkDialogueLine(lineContent));
}

if (recordScratchBtn) {
    recordScratchBtn.addEventListener('click', () => triggerRecordScratch());
}

function updateAudioStatusLabel(statusText, colorHex) {
    if (!audioStatusLabel) return;
    if (!statusText) {
        audioStatusLabel.textContent = '';
        audioStatusLabel.style.color = '';
        audioStatusLabel.style.backgroundColor = '';
        return;
    }
    const r = parseInt(colorHex.substring(0, 2), 16);
    const g = parseInt(colorHex.substring(2, 4), 16);
    const b = parseInt(colorHex.substring(4, 6), 16);
    audioStatusLabel.textContent = statusText;
    audioStatusLabel.style.color = `rgb(${r}, ${g}, ${b})`;
    audioStatusLabel.style.backgroundColor = `rgba(${r}, ${g}, ${b}, 0.15)`;
}

function updateStatusBar(hasAudio, isOutOfDate) {
    // Re-query in case the element was recreated after recording cleanup
    const hint = document.getElementById('status-bar-audio-hint');
    if (hint) {
        if (!hasAudio) {
            hint.textContent = '';
            hint.style.color = '';
            hint.style.backgroundColor = '';
        } else if (isOutOfDate) {
            hint.textContent = 'Shift+Space to play audio — Audio is out of date';
            hint.style.color = '#ff9800';
            hint.style.backgroundColor = 'rgba(255, 152, 0, 0.15)';
        } else {
            hint.textContent = 'Shift+Space to play audio';
            hint.style.color = '';
            hint.style.backgroundColor = '';
        }
    }
}

async function updateTestAudioButton() {
    const position = editor.getPosition();
    if (!position) {
        currentAudioFilePath = null;
        setTestAudioEnabled(false);
        updateAudioStatusLabel(null);
        updateStatusBar(false);
        return;
    }

    const lineId = idManager.getIdForLine(position.lineNumber);
    if (!lineId) {
        currentAudioFilePath = null;
        setTestAudioEnabled(false);
        updateAudioStatusLabel(null);
        updateStatusBar(false);
        return;
    }

    const result = await window.electronAPI.findAudioFile(lineId);
    if (result) {
        currentAudioFilePath = result.path;
        setTestAudioEnabled(true);

        // Check if audio hash matches current dialogue text
        let statusText = result.status || '';
        let isOutOfDate = false;
        const model = editor.getModel();
        if (model) {
            const lineContent = model.getLineContent(position.lineNumber);
            const dialogueText = extractDialogueText(lineContent);
            if (dialogueText) {
                const currentHash = generateHashFromText(dialogueText);
                const fileHash = await window.electronAPI.readAudioHash(result.path);
                if (fileHash !== null && fileHash !== currentHash) {
                    isOutOfDate = true;
                    statusText = statusText ? `!! ${statusText} !!` : '!!';
                }
            }
        }

        updateAudioStatusLabel(statusText, result.color);
        updateStatusBar(true, isOutOfDate);
    } else {
        currentAudioFilePath = null;
        setTestAudioEnabled(false);
        updateAudioStatusLabel(null);
        updateStatusBar(false);
    }
}

async function playTestAudio() {
    if (!currentAudioFilePath) return;

    // Stop any currently playing audio
    if (currentAudioElement) {
        currentAudioElement.pause();
        currentAudioElement = null;
    }

    const dataUrl = await window.electronAPI.readAudioFile(currentAudioFilePath);
    if (!dataUrl) return;

    currentAudioElement = new Audio(dataUrl);
    if (testAudioBtn) testAudioBtn.classList.add('playing');
    currentAudioElement.play().catch(err => {
        console.error('Failed to play audio:', err);
    });
    currentAudioElement.addEventListener('ended', () => {
        currentAudioElement = null;
        if (testAudioBtn) testAudioBtn.classList.remove('playing');
    });
    currentAudioElement.addEventListener('pause', () => {
        if (testAudioBtn) testAudioBtn.classList.remove('playing');
    });
}

if (testAudioBtn) {
    testAudioBtn.addEventListener('click', playTestAudio);
}

/**
 * Refresh glyph margin icons with audio status colors for the current file.
 * Fetches bulk audio status for all line IDs and determines dialogue lines.
 */
async function refreshAudioGlyphs() {
    const model = editor.getModel();
    if (!model) return;

    // Collect all line IDs from tracked decorations (not ALL model decorations)
    const lineIds = [];
    const linesWithIds = new Set();

    for (const [decId, inkId] of idManager.decorationToId) {
        const range = model.getDecorationRange(decId);
        if (range) {
            lineIds.push(inkId);
            linesWithIds.add(range.startLineNumber);
        }
    }

    if (lineIds.length === 0) {
        idManager.updateAudioStatus({}, new Set());
        return;
    }

    // Fetch audio status for all IDs in one call
    const audioStatusMap = await window.electronAPI.getBulkAudioStatus(lineIds);

    // Only check dialogue status for lines that have IDs (not every line in the file)
    const dialogueLines = new Set();
    for (const lineNumber of linesWithIds) {
        const lineContent = model.getLineContent(lineNumber);
        if (isDinkDialogueLine(lineContent)) {
            dialogueLines.add(lineNumber);
        }
    }

    idManager.updateAudioStatus(audioStatusMap, dialogueLines);
}


// Shift+Space shortcut to play test audio (overrides triggerSuggest, but Ctrl+Space still works for autocomplete)
editor.addAction({
    id: 'dinky.playTestAudio',
    label: 'Play Test Audio',
    keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Space],
    run: () => { playTestAudio(); }
});

// Initialise the scratch recorder module
initScratchRecorder({
    editor,
    monaco,
    idManager,
    projectCharacters: () => projectCharacters,
    updateTestAudioButton,
    playTestAudio,
    getLoadedInkFiles: () => loadedInkFiles,
    getCurrentFilePath: () => currentFilePath,
    onRecordingComplete: () => checkSyntax(),
});

/**
 * Listen to cursor position changes
 */
const debouncedUpdateTestAudio = debounce(updateTestAudioButton, 150);
const debouncedUpdateRecordScratch = debounce(updateRecordScratchButton, 150);

editor.onDidChangeCursorPosition(() => {
    updateDropdownSelection();
    debouncedUpdateTestAudio();
    debouncedUpdateRecordScratch();

    // Navigation history tracking is handled by NavigationSystem
    navigationSystem.onCursorPositionChange();
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
        await saveAllFiles();
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

document.getElementById('btn-choose-include').addEventListener('click', async () => {
    await saveAllFiles();
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
    return navigationSystem.findCurrentKnot(model, position);
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
    if (!query) {
        // An empty query matches every position; replacing would insert the
        // replacement string between every character. Bail out loudly rather
        // than silently corrupting every file.
        window.electronAPI.sendReplaceComplete(0);
        return;
    }
    let totalReplacements = 0;
    const regexFlags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(escapeRegExp(query), regexFlags);

    for (const [path, file] of loadedInkFiles) {
        // For the current file, file.content may be ID-stripped (the keystroke
        // handler overwrites it with editor.getValue() on every edit). Use the
        // reconstructed content so the regex sees the same text as disk does,
        // and so IDs survive the replace.
        const sourceContent = (path === currentFilePath)
            ? idManager.reconstructContent(editor.getValue())
            : file.content;

        if (!regex.test(sourceContent)) continue;

        const count = (sourceContent.match(regex) || []).length;
        totalReplacements += count;

        const newContent = sourceContent.replace(regex, replacement);
        file.content = newContent;

        if (path === currentFilePath) {
            // setValue() invalidates the decorations we use to remember which
            // line each ID belongs to. Re-extract from the new text and re-set
            // up decorations so the next reconstructContent call (e.g. on
            // save) injects IDs at the correct lines.
            isUpdatingContent = true;
            const { cleanContent, extractedIds } = idManager.extractIds(newContent);
            editor.setValue(cleanContent);
            idManager.setupDecorations(extractedIds);
            isUpdatingContent = false;
        }

        if (file.listItem) {
            const isModified = file.content !== file.originalContent;
            file.listItem.textContent = file.relativePath + (isModified ? '*' : '');
        }
    }
    window.electronAPI.sendReplaceComplete(totalReplacements);
    if (totalReplacements > 0) {
        checkSyntax();
    }
});

// Global keyboard shortcut handler for Project Settings (Cmd/Ctrl+Shift+,)
// This captures the shortcut before Monaco can intercept it
window.addEventListener('keydown', (e) => {
    const isMac = window.electronAPI.platform === 'darwin';
    const modifierKey = isMac ? e.metaKey : e.ctrlKey;
    if (modifierKey && e.shiftKey && e.key === ',') {
        e.preventDefault();
        e.stopPropagation();
        window.electronAPI.openProjectSettings();
    }
}, true); // Use capture phase to intercept before Monaco

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

// Validation functions delegate to ValidationEngine (single source of truth)
function validateCharacterNamesInText(text) {
    return validationEngine.validateCharacterNamesInText(text, detectDinkyGlobal);
}

function validateWritingStatusTagsInText(text) {
    return validationEngine.validateWritingStatusTagsInText(text);
}

function highlightWritingStatusTags(model) {
    validationEngine.highlightWritingStatusTags(model, wsTagDecorationCollection);
}
