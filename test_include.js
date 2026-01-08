const inkjs = require('inkjs/full');
const path = require('path');

const mainContent = `
INCLUDE scene.ink
Coming from main.
-> MyScene
`;

const sceneContentTwoEquals = `
== MyScene
Hello from scene.
-> END
`;

const sceneContentThreeEquals = `
=== MyScene ===
Hello from scene.
-> END
`;

const fileHandler = {
    ResolveInkFilename: (filename) => {
        return filename;
    },
    LoadInkFileContents: (filename) => {
        if (filename === 'scene.ink') {
            // Toggle this to test different contents
            // return sceneContentTwoEquals; 
            return sceneContentTwoEquals;
        }
        return '';
    }
};

const options = new inkjs.CompilerOptions(
    'main.ink',
    [],
    false,
    null,
    fileHandler
);

console.log('--- Testing with == MyScene ---');
try {
    // We strictly test the Two Equals case first
    const compiler = new inkjs.Compiler(mainContent, options);
    compiler.Compile();
    console.log('Success!');
} catch (e) {
    console.error('Failed:', e.message);
}

// Now test Correct Syntax
const fileHandler3 = {
    ResolveInkFilename: (filename) => filename,
    LoadInkFileContents: (filename) => {
        if (filename === 'scene.ink') return sceneContentThreeEquals;
        return '';
    }
};
const options3 = new inkjs.CompilerOptions('main.ink', [], false, null, fileHandler3);

console.log('\n--- Testing with === MyScene === ---');
try {
    const compiler = new inkjs.Compiler(mainContent, options3);
    compiler.Compile();
    console.log('Success!');
} catch (e) {
    console.error('Failed:', e.message);
}
