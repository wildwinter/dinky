import { assert } from 'chai';
import { ValidationEngine } from '../src/validation-engine.js';

// Minimal Monaco mock - only the surface the engine touches
const mockMonaco = {
    MarkerSeverity: { Error: 8 },
    Range: class Range {
        constructor(sl, sc, el, ec) {
            this.startLineNumber = sl; this.startColumn = sc;
            this.endLineNumber = el; this.endColumn = ec;
        }
    }
};

function makeEngine({ characters = [], wsTags = [] } = {}) {
    const engine = new ValidationEngine(mockMonaco);
    engine.setProjectCharacters(characters);
    engine.setProjectWritingStatusTags(wsTags);
    return engine;
}

// detectDinkyGlobal stub - treats everything as global dinky unless told otherwise
const alwaysDinky = () => true;
const neverDinky  = () => false;

// ---------------------------------------------------------------------------
// validateWritingStatusTagsInText
// ---------------------------------------------------------------------------

describe('ValidationEngine.validateWritingStatusTagsInText', () => {
    it('returns no markers when text has no ws tags', () => {
        const engine = makeEngine({ wsTags: [{ wstag: 'DRAFT' }] });
        const markers = engine.validateWritingStatusTagsInText('Hello world\nNo tags here');
        assert.deepEqual(markers, []);
    });

    it('returns no markers for a valid tag', () => {
        const engine = makeEngine({ wsTags: [{ wstag: 'DRAFT' }] });
        const markers = engine.validateWritingStatusTagsInText('CHAR: Hello #ws:DRAFT');
        assert.deepEqual(markers, []);
    });

    it('returns a marker for an unknown tag', () => {
        const engine = makeEngine({ wsTags: [{ wstag: 'DRAFT' }] });
        const markers = engine.validateWritingStatusTagsInText('CHAR: Hello #ws:FINAL');
        assert.equal(markers.length, 1);
        assert.equal(markers[0].code, 'FINAL');
        assert.equal(markers[0].source, 'ws-validator');
        assert.equal(markers[0].startLineNumber, 1);
    });

    it('handles multiple tags on the same line', () => {
        const engine = makeEngine({ wsTags: [{ wstag: 'DRAFT' }] });
        // DRAFT is valid, FINAL is not
        const markers = engine.validateWritingStatusTagsInText('CHAR: Hello #ws:DRAFT #ws:FINAL');
        assert.equal(markers.length, 1);
        assert.equal(markers[0].code, 'FINAL');
    });

    it('handles tags across multiple lines independently', () => {
        const engine = makeEngine({ wsTags: [{ wstag: 'DRAFT' }] });
        const text = 'line one #ws:DRAFT\nline two #ws:BAD\nline three #ws:DRAFT';
        const markers = engine.validateWritingStatusTagsInText(text);
        assert.equal(markers.length, 1);
        assert.equal(markers[0].startLineNumber, 2);
        assert.equal(markers[0].code, 'BAD');
    });

    it('returns no markers when tag list is empty', () => {
        const engine = makeEngine({ wsTags: [] });
        const markers = engine.validateWritingStatusTagsInText('CHAR: Hello #ws:ANYTHING');
        assert.equal(markers.length, 1); // no valid tags → all unknown
    });

    it('reports correct column positions', () => {
        const engine = makeEngine({ wsTags: [] });
        const line = 'Some text #ws:FOO more text';
        const markers = engine.validateWritingStatusTagsInText(line);
        assert.equal(markers.length, 1);
        // '#ws:FOO' starts at index 10 (0-based) → column 11 (1-based)
        assert.equal(markers[0].startColumn, 11);
        assert.equal(markers[0].endColumn, 11 + '#ws:FOO'.length);
    });
});

// ---------------------------------------------------------------------------
// validateCharacterNamesInText
// ---------------------------------------------------------------------------

describe('ValidationEngine.validateCharacterNamesInText', () => {
    it('returns no markers for a valid character name', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const markers = engine.validateCharacterNamesInText('ALICE: Hello there', alwaysDinky);
        assert.deepEqual(markers, []);
    });

    it('returns a marker for an unknown character', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const markers = engine.validateCharacterNamesInText('BOB: Hello there', alwaysDinky);
        assert.equal(markers.length, 1);
        assert.equal(markers[0].code, 'BOB');
        assert.equal(markers[0].source, 'dinky-validator');
    });

    it('validates gather-style lines (- NAME: text)', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const markers = engine.validateCharacterNamesInText('- BOB: Hello', alwaysDinky);
        assert.equal(markers.length, 1);
        assert.equal(markers[0].code, 'BOB');
    });

    it('validates bracketed choice lines (* [NAME: text)', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const markers = engine.validateCharacterNamesInText('* [BOB: Hello]', alwaysDinky);
        assert.equal(markers.length, 1);
        assert.equal(markers[0].code, 'BOB');
    });

    it('skips validation outside of dinky context', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const markers = engine.validateCharacterNamesInText('BOB: Hello', neverDinky);
        assert.deepEqual(markers, []);
    });

    it('enters dinky context after #dink tag on a knot', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const text = '=== myKnot === #dink\nBOB: Hello';
        const markers = engine.validateCharacterNamesInText(text, neverDinky);
        assert.equal(markers.length, 1);
        assert.equal(markers[0].code, 'BOB');
    });

    it('resets dinky context on a new knot without #dink', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const text = '=== dinkKnot === #dink\nBOB: Hello\n=== normalKnot ===\nBOB: Hello again';
        const markers = engine.validateCharacterNamesInText(text, neverDinky);
        // Only the first BOB is in dinky context
        assert.equal(markers.length, 1);
        assert.equal(markers[0].startLineNumber, 2);
    });

    it('reports correct line numbers for multi-line input', () => {
        const engine = makeEngine({ characters: [{ ID: 'ALICE' }] });
        const text = 'ALICE: Hi\nBOB: Hello\nALICE: Bye';
        const markers = engine.validateCharacterNamesInText(text, alwaysDinky);
        assert.equal(markers.length, 1);
        assert.equal(markers[0].startLineNumber, 2);
    });
});
