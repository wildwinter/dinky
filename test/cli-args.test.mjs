import { assert } from 'chai';
import { parseGotoTarget } from '../electron/cli-args.js';

describe('parseGotoTarget', () => {
    it('returns null when --goto is absent', () => {
        assert.isNull(parseGotoTarget(['dinky', 'proj.dinkproj']));
    });

    it('returns null for an empty argv', () => {
        assert.isNull(parseGotoTarget([]));
        assert.isNull(parseGotoTarget());
    });

    it('parses the space-separated form', () => {
        assert.equal(parseGotoTarget(['dinky', '--goto', 'myKnot']), 'myKnot');
    });

    it('parses the equals form', () => {
        assert.equal(parseGotoTarget(['dinky', '--goto=myKnot.myStitch']), 'myKnot.myStitch');
    });

    it('parses a line ID target', () => {
        assert.equal(parseGotoTarget(['dinky', '--goto', 'chapter1_A1B2']), 'chapter1_A1B2');
    });

    it('works alongside a project path in any order', () => {
        assert.equal(parseGotoTarget(['dinky', 'proj.dinkproj', '--goto', 'k']), 'k');
        assert.equal(parseGotoTarget(['dinky', '--goto', 'k', 'proj.dinkproj']), 'k');
    });

    it('does not consume a following flag as the value', () => {
        assert.isNull(parseGotoTarget(['dinky', '--goto', '--other']));
    });

    it('returns null when --goto is the last arg with no value', () => {
        assert.isNull(parseGotoTarget(['dinky', '--goto']));
    });

    it('returns null for an empty value', () => {
        assert.isNull(parseGotoTarget(['dinky', '--goto=']));
        assert.isNull(parseGotoTarget(['dinky', '--goto', '   ']));
    });

    it('trims surrounding whitespace', () => {
        assert.equal(parseGotoTarget(['dinky', '--goto=  myKnot  ']), 'myKnot');
    });

    it('uses the first --goto when repeated', () => {
        assert.equal(parseGotoTarget(['dinky', '--goto', 'first', '--goto', 'second']), 'first');
    });
});
