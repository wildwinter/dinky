import { assert } from 'chai';
import { createRequire } from 'module';
import { generateIdsForUntagged } from '../electron/tagger.js';

// inkjs/full is a CJS module; load it via require (its ESM default export
// isn't exposed in raw node). This mirrors how electron/compiler.js parses.
const require = createRequire(import.meta.url);
const inkjs = require('inkjs/full');

// The auto-tagger must not add IDs to lines the localiser can't handle: lines
// split into multiple text chunks by inline logic, e.g. "Test {value} Again".
describe('generateIdsForUntagged - skipping lines split by inline logic', () => {
    function parse(ink) {
        const fileHandler = {
            ResolveInkFilename: (name) => name,
            LoadInkFileContents: () => '',
        };
        const options = inkjs.CompilerOptions
            ? new inkjs.CompilerOptions('test.ink', [], false, () => {}, fileHandler)
            : { sourceFilename: 'test.ink', fileHandler, errorHandler: () => {} };
        const compiler = new inkjs.Compiler(ink, options);
        try { compiler.Compile(); } catch { /* we only need the parsed AST */ }
        return compiler._parsedStory;
    }

    function tag(ink) {
        const story = parse(ink);
        assert.isOk(story, 'ink should parse into an AST');
        return generateIdsForUntagged(story, 'test');
    }
    const targets = (edits, needle) => edits.some(e => (e.text || '').includes(needle));

    it('tags an ordinary line', () => {
        const edits = tag('A normal line.\n-> END\n');
        assert.isTrue(targets(edits, 'A normal line'));
    });

    it('does NOT tag a line split by an inline {variable}', () => {
        const edits = tag('VAR value = 5\nTest {value} Again\n-> END\n');
        assert.isFalse(targets(edits, 'Test'));
        assert.isFalse(targets(edits, 'Again'));
    });

    it('tags the clean lines but skips the split one in a mixed file', () => {
        const edits = tag('VAR value = 5\nA normal line.\nBefore {value} after\n-> END\n');
        assert.isTrue(targets(edits, 'A normal line'));
        assert.isFalse(targets(edits, 'Before'));
        assert.isFalse(targets(edits, 'after'));
    });

    it('still tags a line that merely ends with an inline variable (single leading chunk)', () => {
        const edits = tag('VAR value = 5\nScore: {value}\n-> END\n');
        assert.isTrue(targets(edits, 'Score'));
    });
});
