import { assert } from 'chai';
import { IdPreservationManager } from '../src/id-manager.js';

// _isLineEligibleForId and _findDeclarationContinuationLines are pure text
// helpers (they never touch `this`), so we can exercise them via the prototype
// without constructing a manager - the constructor needs a live Monaco editor
// and a DOM, neither of which exists under mocha/node.
const eligible = (line) =>
    IdPreservationManager.prototype._isLineEligibleForId.call(null, line);
const continuations = (lines) =>
    IdPreservationManager.prototype._findDeclarationContinuationLines.call(null, lines);
const extractIds = (content) =>
    IdPreservationManager.prototype.extractIds.call(null, content);

// This gate is what decides whether an #id: may live on a line. Both the
// save-time reconstructContent() cleanup and the live stabilisation sweep use
// it, so a line wrongly judged eligible is how a bogus ID gets baked onto pure
// Ink structure (the reported "-> knot" / "{testVar: -> knot1}" bugs).
describe('IdPreservationManager._isLineEligibleForId', () => {
    it('accepts ordinary content lines', () => {
        assert.isTrue(eligible('Hello there.'));
        assert.isTrue(eligible('FRED: Good morning.'));
        assert.isTrue(eligible('    Indented dialogue.'));
    });

    it('accepts content that merely ends with a divert', () => {
        // The text "Hello there" is localisable; the trailing divert doesn't
        // make the whole line structural.
        assert.isTrue(eligible('Hello there -> knot'));
    });

    it('accepts content with an inline variable that has leading text', () => {
        assert.isTrue(eligible('Score: {value}'));
    });

    it('accepts choices and gathers with text', () => {
        assert.isTrue(eligible('* [Take the road]'));
        assert.isTrue(eligible('+ Keep going'));
        assert.isTrue(eligible('- They regrouped.'));
    });

    it('rejects pure diverts, tunnels and threads', () => {
        assert.isFalse(eligible('-> knot1'));
        assert.isFalse(eligible('-> END'));
        assert.isFalse(eligible('->-> '));
        assert.isFalse(eligible('<- background_thread'));
    });

    it('rejects inline logic / conditional lines with no leading text', () => {
        assert.isFalse(eligible('{testVar: -> knot1}'));   // the reported case
        assert.isFalse(eligible('{ condition:'));
        assert.isFalse(eligible('}'));
        assert.isFalse(eligible('{value} coins'));         // leading chunk is dynamic
    });

    it('rejects knots, stitches, logic and declarations', () => {
        assert.isFalse(eligible('== chapter_one =='));
        assert.isFalse(eligible('= a_stitch'));
        assert.isFalse(eligible('~ temp x = 5'));
        assert.isFalse(eligible('VAR health = 100'));
        assert.isFalse(eligible('CONST MAX = 3'));
        assert.isFalse(eligible('LIST colours = red, green'));
        assert.isFalse(eligible('INCLUDE other.ink'));
    });

    it('rejects blank and comment-only lines', () => {
        assert.isFalse(eligible(''));
        assert.isFalse(eligible('   '));
        assert.isFalse(eligible('// just a comment'));
    });

    it('ignores trailing comments when judging the code part', () => {
        assert.isTrue(eligible('Real dialogue. // with a note'));
        assert.isFalse(eligible('-> knot // off to the knot'));
    });
});

// The play badge must play the CURRENT file on disk, not a path cached from the
// last glyph refresh - otherwise dropping a new wav over an old TTS take plays
// the stale take (while the toolbar, which re-resolves live, plays the new one).
describe('IdPreservationManager._playAudioForId', () => {
    // _playAudioForId only touches instance fields we can set on a bare object,
    // so skip the constructor (which needs a live editor + DOM).
    function makeManager() {
        const mgr = Object.create(IdPreservationManager.prototype);
        mgr.audioStatusMap = { line_ab12: { path: '/audio/tts/line_ab12.wav' } };
        mgr.played = null;
        mgr.playAudioForLine = (p) => { mgr.played = p; };
        return mgr;
    }

    it('plays the live-resolved path, not the cached snapshot path', async () => {
        const mgr = makeManager();
        mgr.getAudioPathForId = async () => '/audio/scratch/line_ab12.wav';
        await mgr._playAudioForId('line_ab12');
        assert.equal(mgr.played, '/audio/scratch/line_ab12.wav');
    });

    it('does not play a stale path when the live lookup finds nothing', async () => {
        const mgr = makeManager();
        mgr.getAudioPathForId = async () => null; // file removed on disk
        await mgr._playAudioForId('line_ab12');
        assert.isNull(mgr.played);
    });

    it('falls back to the cached path when no live resolver is wired up', async () => {
        const mgr = makeManager();
        mgr.getAudioPathForId = null;
        await mgr._playAudioForId('line_ab12');
        assert.equal(mgr.played, '/audio/tts/line_ab12.wav');
    });
});

// Inline conditionals that carry real dialogue, e.g.
// "{specialism==Geopolitics:Some text.}", ARE localisable: Ink-Localiser treats
// them as one text chunk and tags them inside the brace. Dinky must agree, and
// must inject inside the brace too. A tag placed after the brace is not part of
// the conditional's content, so the localiser cannot find it and mints a fresh
// ID on every compile, which is how one file ended up with 34 IDs per line.
describe('inline conditionals that carry text', () => {
    const inject = (line, id) =>
        IdPreservationManager.prototype.injectIdIntoLine.call(null, line, id);

    it('treats a conditional carrying dialogue as ID-eligible', () => {
        assert.isTrue(eligible('{specialism==Geopolitics:Could we be looking at a fuel source?}'));
        assert.isTrue(eligible('\t\t{specialism==Space:An artificial object.}'));
    });

    it('still rejects conditionals with no localisable text', () => {
        assert.isFalse(eligible('{specialism==Ritual: }'));      // empty
        assert.isFalse(eligible('{testVar: -> knot1}'));          // divert only
        assert.isFalse(eligible('{ condition:'));                 // block opener
        assert.isFalse(eligible('}'));
        assert.isFalse(eligible('{cond: yes|no}'));               // if/else, two chunks
        assert.isFalse(eligible('{cond:Score {n} points}'));      // nested braces
    });

    it('injects the tag INSIDE the closing brace', () => {
        assert.equal(
            inject('{specialism==Space:An artificial object.}', 'ev_1234'),
            '{specialism==Space:An artificial object. #id:ev_1234}');
    });

    it('preserves leading indentation when injecting', () => {
        assert.equal(
            inject('\t\t{specialism==Space:Text.}', 'ev_1234'),
            '\t\t{specialism==Space:Text. #id:ev_1234}');
    });

    it('round-trips: an injected tag extracts back to the original line', () => {
        const original = '\t\t{specialism==Geopolitics:Some dialogue here.}';
        const tagged = inject(original, 'ev_1234');
        const { cleanContent, extractedIds } = extractIds(tagged);
        assert.equal(extractedIds.length, 1);
        assert.equal(extractedIds[0].id, 'ev_1234');
        assert.equal(cleanContent, original);
    });

    it('leaves ordinary lines and choices injecting where they always did', () => {
        assert.equal(inject('FRED: Hello.', 'ev_1234'), 'FRED: Hello. #id:ev_1234');
        assert.equal(inject('* [Take the road]', 'ev_1234'), '* [Take the road #id:ev_1234]');
    });
});

// Catches the "split LIST across lines, get an ID on a list-item line" case:
// continuation lines of a comma-terminated declaration are not ID-eligible.
describe('IdPreservationManager._findDeclarationContinuationLines', () => {
    it('flags comma-continued declaration lines', () => {
        const lines = [
            'LIST colours = red,',   // 0 - opens a continued declaration
            'green,',                // 1 - continuation
            'blue',                  // 2 - continuation (terminates: no comma)
            'Some dialogue.'         // 3 - back to normal content
        ];
        const cont = continuations(lines);
        assert.isTrue(cont.has(1));
        assert.isTrue(cont.has(2));
        assert.isFalse(cont.has(0)); // the declaration line itself
        assert.isFalse(cont.has(3));
    });

    it('does not flag anything for a single-line declaration', () => {
        const cont = continuations(['LIST colours = red, green, blue', 'Dialogue.']);
        assert.equal(cont.size, 0);
    });
});

// IDs left on lines with nothing localisable: a bare "-" left when Enter splits
// "- FIXER: Hi" after the dash, and "- FixStage1:" case labels in a switch.
// The tagger never tags these (no text), so the editor must not keep IDs there.
describe('IDs stranded on markers and case labels', () => {
    const proto = IdPreservationManager.prototype;
    // A stand-in `this` for the methods that call sibling helpers.
    const self = {
        _isLineEligibleForId: proto._isLineEligibleForId,
        _findDeclarationContinuationLines: proto._findDeclarationContinuationLines,
        _findConditionalCaseLines: proto._findConditionalCaseLines,
    };
    const caseLines = (lines) => proto._findConditionalCaseLines.call(null, lines);
    const plan = (lines, entries) => proto._planIdSweep.call(self, lines, entries);
    const at = (line, inkId) => ({ startLine: line, endLine: line, inkId });

    it('rejects bare choice and gather markers', () => {
        assert.isFalse(eligible('-'));
        assert.isFalse(eligible('    - '));
        assert.isFalse(eligible('*'));
        assert.isFalse(eligible('+ +'));
        assert.isFalse(eligible('- (opts)'));
        assert.isFalse(eligible('- -> END'));
        assert.isFalse(eligible('* -> knot'));
    });

    it('still accepts markers carrying text', () => {
        assert.isTrue(eligible('- FIXER: Hello.'));
        assert.isTrue(eligible('- (greet) Hello.'));
        assert.isTrue(eligible('* * Nested choice'));
    });

    // The block Ian reported, as the editor holds it (IDs stripped out).
    const block = [
        '{fixer_puzzle_state:',                 // 0
        '     - FixComplete:',                  // 1
        '        -> END',                       // 2
        '     - FixStage3:',                    // 3
        '        {once:',                       // 4
        '            -',                        // 5
        "                FIXER: We'll have it sorted in a jiffy.", // 6
        '                -> END',               // 7
        '        }',                            // 8
        '    - FixStage1:',                     // 9
        '        {once:',                       // 10
        '            - Hello:',                 // 11 sequence branch: text
        '                -> END',               // 12
        '        }',                            // 13
        '    - else:',                          // 14
        '        Fallback.',                    // 15
        '}',                                    // 16
        '- Afterwards:',                        // 17 outside any block: text
    ];

    it('finds switch case labels but not sequence branches or plain gathers', () => {
        assert.deepEqual([...caseLines(block)].sort((a, b) => a - b), [1, 3, 9, 14]);
    });

    it('drops IDs on case labels and bare markers when the text below has its own', () => {
        const { keep, changed } = plan(block, [
            at(4, 'stage3_label'),   // "- FixStage3:"
            at(6, 'dash_H8CK'),      // bare "-"
            at(7, 'text_5OPI'),      // FIXER line, already tagged
            at(10, 'stage1_label'),  // "- FixStage1:"
            at(12, 'hello_ABCD'),    // "- Hello:" in {once:}, real text
        ]);
        assert.isTrue(changed);
        assert.deepEqual(keep, [
            { line: 7, inkId: 'text_5OPI' },
            { line: 12, inkId: 'hello_ABCD' },
        ]);
    });

    it('moves an ID off a bare "-" onto the untagged text Enter pushed below', () => {
        const { keep } = plan(block, [at(6, 'orig_H8CK')]);
        assert.deepEqual(keep, [{ line: 7, inkId: 'orig_H8CK' }]);
    });

    it('does not move an ID off a case label', () => {
        const lines = ['{x:', '- 1:', 'One.', '}'];
        const { keep } = plan(lines, [at(2, 'label_AAAA')]);
        assert.deepEqual(keep, []);
    });

    it('leaves a clean layout unchanged', () => {
        const { keep, changed } = plan(block, [at(7, 'text_5OPI'), at(16, 'fb_ZZZZ')]);
        assert.isFalse(changed);
        assert.lengthOf(keep, 2);
    });
});
