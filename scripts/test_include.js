const inkjs = require('inkjs/full');
const path = require('path');

// Simulate absolute paths
const rootDir = __dirname;
const mainPath = path.join(rootDir, 'main.ink');
const scenePath = path.join(rootDir, 'scene.ink');

const mainContent = `
INCLUDE scene.ink
Coming from main.
-> MyScene
`;

const sceneContent = `
=== MyScene ===
Hello from scene.
-> END
`;

console.log('Main Path:', mainPath);
console.log('Scene Path:', scenePath);

const fileHandler = {
    ResolveInkFilename: (filename) => {
        const resolved = path.resolve(path.dirname(mainPath), filename);
        console.log('FileHandler: Resolving', filename, '->', resolved);
        return resolved;
    },
    LoadInkFileContents: (filename) => {
        console.log('FileHandler: Loading', filename);
        if (filename === scenePath) {
            return sceneContent;
        }
        return '';
    }
};

const errorHandler = (msg, type) => {
    console.error('ErrorHandler:', msg);
};

// Test with CompilerOptions
console.log('--- Testing with CompilerOptions and Absolute Paths ---');
const options = new inkjs.CompilerOptions(
    mainPath,
    [],
    false,
    errorHandler,
    fileHandler
);

try {
    const compiler = new inkjs.Compiler(mainContent, options);
    console.log('Compiler created. Compiling...');
    const story = compiler.Compile();
    console.log('Success! Story created.');
} catch (e) {
    console.error('Failed:', e.message);
}
