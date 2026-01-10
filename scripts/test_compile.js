const inkjs = require('inkjs/full');
console.log('Loaded inkjs/full');

try {
    const source = '~';
    const compiler = new inkjs.Compiler(source);
    console.log('Compiler created');
    const story = compiler.Compile();
    console.log('Compilation successful');
    console.log('Errors:', compiler.errors);
} catch (e) {
    console.error('Compilation failed:', e);
}
