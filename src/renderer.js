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
            // Comments
            [/\/\/.*$/, 'comment'],
            [/\/\*/, 'comment', '@comment'],

            // Knots and Stitches
            [/^(={2,})\s*\w+/, 'keyword'], // Knot === Name
            [/^=\s*\w+/, 'type'],         // Stitch = Name

            // Diverts
            [/->\s*\w+/, 'operators'],

            // Choices
            [/^[\*\+]\s?/, 'string'],

            // Gather points
            [/^\-\s?/, 'delimiter'],

            // Tags
            [/#\s*.*$/, 'annotation'],

            // Logic and Variables
            [/{/, 'delimiter.bracket'],
            [/}/, 'delimiter.bracket'],
            [/\w+(?=\()/, 'function'], // Function calls
        ],
        comment: [
            [/[^\/*]+/, 'comment'],
            [/\*\//, 'comment', '@pop'],
            [/[\/*]/, 'comment']
        ]
    }
});

const editor = monaco.editor.create(document.getElementById('app'), {
    value: '// Type some Ink code here\n=== start ===\nHello world!\n* [Choice 1]\n    -> end\n\n=== end ===\n-> END',
    language: 'ink',
    theme: 'vs-dark',
    automaticLayout: true,
});

window.electronAPI.onFileOpened((content) => {
    editor.setValue(content);
});
