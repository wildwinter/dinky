import { assert } from 'chai';
import { createRequire } from 'module';
import { generateIdsForUntagged, resolveDuplicateIds } from '../electron/tagger.js';

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

// A line copied with its ID into another file must get a fresh ID when that
// file is tagged, leaving the original alone, so the compiler never sees one
// ID on two lines (it keeps one text and silently drops the other).
describe('resolveDuplicateIds - clearing IDs copied across the project', () => {
    const s03 = '== Scene03\nUSEC: Ward? Ward? #id:03_Scene03_B0XO\n';
    const s17 = '== Scene17\nUSEC: Glad I got to you. #id:03_Scene03_B0XO\n';
    const files = { '/p/03.ink': s03, '/p/17.ink': s17 };

    it('re-IDs the copy in the file being tagged', () => {
        const { edits } = resolveDuplicateIds('/p/17.ink', s17, files);
        assert.lengthOf(edits, 1);
        assert.equal(edits[0].line, 2);
        assert.equal(edits[0].oldId, '03_Scene03_B0XO');
        assert.match(edits[0].newId, /^17_Scene17_[A-Z0-9]{4}$/);
    });

    it('leaves the original alone when its own file is tagged', () => {
        assert.lengthOf(resolveDuplicateIds('/p/03.ink', s03, files).edits, 0);
    });

    it('uses the content passed in for the file being tagged, not the stale copy', () => {
        const fixed = '== Scene17\nUSEC: Glad I got to you. #id:17_Scene17_NEW1\n';
        assert.lengthOf(resolveDuplicateIds('/p/17.ink', fixed, files).edits, 0);
    });

    it('reserves every project ID for the tagger', () => {
        const { reservedIds, edits } = resolveDuplicateIds('/p/17.ink', s17, files);
        assert.isTrue(reservedIds.has('03_Scene03_B0XO'));
        assert.isTrue(reservedIds.has(edits[0].newId));
    });
});
