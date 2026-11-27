import { assert } from 'chai';
import { planSave, sameText } from '../electron/save-plan.js';

// Dinky writes only files it has changed, and never quietly overwrites a file
// changed on disk since it read it (a version-control update, another editor).
describe('planSave - what saving one file does', () => {
    const base = 'Line one.\nLine two.\n';
    const edited = 'Line one.\nLine two, edited in Dinky.\n';
    const pulled = 'Line one.\nLine two, changed by a pull.\n';

    it('leaves a file alone when neither side changed it', () => {
        assert.equal(planSave(base, base, base), 'skip');
    });

    it('writes a file changed only in Dinky', () => {
        assert.equal(planSave(edited, base, base), 'write');
    });

    it('takes in a file changed only on disk, rather than writing the old copy back', () => {
        assert.equal(planSave(base, base, pulled), 'reload');
    });

    it('asks when both sides changed it', () => {
        assert.equal(planSave(edited, base, pulled), 'conflict');
    });

    it('asks when a file Dinky changed was deleted on disk', () => {
        assert.equal(planSave(edited, base, null), 'conflict');
    });

    it('does not bring back a deleted file Dinky had not changed', () => {
        assert.equal(planSave(base, base, null), 'skip');
    });

    it('ignores line endings and a byte-order mark', () => {
        const crlf = '﻿Line one.\r\nLine two.\r\n';
        assert.isTrue(sameText(crlf, base));
        assert.equal(planSave(base, crlf, crlf), 'skip');
        assert.equal(planSave(edited, crlf, crlf), 'write');
    });

    it('writes as before when there is no baseline', () => {
        assert.equal(planSave(edited, undefined, pulled), 'write');
    });
});
