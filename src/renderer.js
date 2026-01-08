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
    value: '// Type some Ink code here\n=== start ===\nHello world!\n* [Choice 1]\n    -> end\n\n=== end ===\n-> END',
    language: 'ink',
    theme: 'vs-dark',
    automaticLayout: true,
});

let currentProjectFiles = new Map();
let currentFilePath = null; // Added: To store the absolute path of the currently open file
let rootFilePath = null; // Added: To track the project root for compilation
let isUpdatingContent = false; // Added: To prevent recursive updates during file switching

window.electronAPI.onProjectLoaded((files) => {
    currentProjectFiles.clear();
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    if (files.length > 0) {
        rootFilePath = files[0].absolutePath;
    }

    files.forEach((file, index) => {
        currentProjectFiles.set(file.absolutePath, file);

        const li = document.createElement('li');
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
    if (rootFilePath) {
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
    window.electronAPI.log('checkSyntax running. Root:', rootFilePath)
    if (!rootFilePath) return;

    try {
        // Serialize project files for IPC (absolute path -> content)
        const projectFiles = {};
        for (const [path, file] of currentProjectFiles) {
            projectFiles[path] = file.content;
        }

        const rootFileObj = currentProjectFiles.get(rootFilePath);
        if (!rootFileObj) {
            window.electronAPI.log('Error: Root file missing from projectFiles!', rootFilePath)
            return;
        }

        // Always compile the ROOT file, but pass the full project context
        const rootContent = rootFileObj.content;
        window.electronAPI.log('Compiling root content length:', rootContent.length)

        const errors = await window.electronAPI.compileInk(rootContent, rootFilePath, projectFiles);
        window.electronAPI.log('Compile complete. Errors:', errors ? errors.length : 0);

        const model = editor.getModel();
        if (model) {
            // Debug: Log first error to see path format
            if (errors && errors.length > 0) {
                window.electronAPI.log('First error sample:', JSON.stringify(errors[0]))
            }

            // Filter errors to display only those relevant to the current file
            const visibleErrors = errors.filter(e => {
                // If no path is associated, assume it's relevant (or global)
                if (!e.filePath) return true;

                // Exact match
                if (e.filePath === currentFilePath) return true;

                // Loose match: check if filename matches
                // currentFilePath is absolute, e.filePath might be relative
                // Simple heuristic: does one end with the other?
                // Or just match basenames
                const currentFileName = currentFilePath.replace(/^.*[\\\/]/, '');
                const errorFileName = e.filePath.replace(/^.*[\\\/]/, '');

                return currentFileName === errorFileName;
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
    if (currentFilePath && currentProjectFiles.has(currentFilePath)) {
        currentProjectFiles.get(currentFilePath).content = editor.getValue();
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

// Initial check
checkSyntax();
