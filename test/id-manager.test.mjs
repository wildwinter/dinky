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
