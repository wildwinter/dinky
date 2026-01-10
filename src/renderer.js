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
let currentFilePath = null; // Added: To store the absolute path of the currently open file
let rootInkPath = null; // Renamed from rootFilePath
let isUpdatingContent = false; // Added: To prevent recursive updates during file switching

document.getElementById('btn-load-project').addEventListener('click', () => {
    window.electronAPI.openProject();
});

document.getElementById('btn-new-project').addEventListener('click', () => {
    window.electronAPI.newProject();
});

window.electronAPI.onRootInkLoaded((files) => {
    loadedInkFiles.clear();
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    // Toggle view
    document.getElementById('empty-state').style.display = 'none';
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

        const li = document.createElement('li');
        file.listItem = li;
        li.textContent = file.relativePath;
        li.style.padding = '4px 8px';
        li.style.cursor = 'pointer';

        li.onclick = () => {
            // Remove active class from all
            Array.from(fileList.children).forEach(c => c.classList.remove('active'));

            isUpdatingContent = true;
            currentFilePath = file.absolutePath;
            editor.setValue(file.content);
            isUpdatingContent = false;

            li.classList.add('active');
            checkSyntax(); // Added: Trigger syntax check on file switch
        };
        fileList.appendChild(li);

        // Load root file (first one)
        if (index === 0) {
            isUpdatingContent = true;
            currentFilePath = file.absolutePath;
            editor.setValue(file.content);
            isUpdatingContent = false;

            li.classList.add('active');
            // checkSyntax call is handled by initial load or manual call below
        }
    });

    // Initial syntax check after loading project
    if (rootInkPath) {
        checkSyntax();
    }
});

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

async function checkSyntax() {
    if (!rootInkPath) return;

    let contentToCompile = '';
    let compilePath = rootInkPath;
    let projectFiles = {};

    // Serialize project files for IPC (absolute path -> content)
    for (const [path, file] of loadedInkFiles) {
        projectFiles[path] = file.content;
    }

    const rootFileObj = loadedInkFiles.get(rootInkPath);
    if (!rootFileObj) {
        return;
    }
    contentToCompile = rootFileObj.content;

    try {
        const errors = await window.electronAPI.compileInk(contentToCompile, compilePath, projectFiles);


        const model = editor.getModel();
        if (model) {
            // Debug: Log first error to see path format
            /* if (errors && errors.length > 0) {
                window.electronAPI.log('First error sample:', JSON.stringify(errors[0]))
            } */

            // Filter errors to display only those relevant to the current file
            const visibleErrors = errors.filter(e => {
                // If no path is associated, assume it's relevant (or global)
                if (!e.filePath) return true;

                const activePath = currentFilePath || compilePath;

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

// Listen for Save All command from main process
window.electronAPI.onSaveAll(async () => {
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
});

// Initial check
checkSyntax();
