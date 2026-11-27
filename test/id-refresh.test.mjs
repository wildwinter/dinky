import { assert } from 'chai';
import path from 'path';
import { planAudioRenames, renameIdsInList } from '../electron/id-refresh-plan.js';
import { findStaleIds, mintUniqueId } from '../src/duplicate-ids.js';

// Edit > Refresh Out-of-Date IDs: lines moved from elsewhere keep their old
// IDs; refreshing gives them IDs that match where they are, and carries their
// audio and re-record flags across.
describe('Refresh Out-of-Date IDs', () => {
    it('finds only the lines whose ID no longer matches where they sit', () => {
        const text = '== Scene03\n' +
            'USEC: Ward? #id:03_Scene03_B0XO\n' +
            'WARD: What? No. #id:01_MissionBrief_0IVN\n' +
            '= Later\n' +
            'USEC: Here. #id:03_Scene03_Later_AAAA\n' +
            'USEC: Moved in. #id:03_Scene03_CCCC\n';
        const stale = findStaleIds('/p/03.ink', text);
        assert.deepEqual(stale.map(s => [s.line, s.id, s.prefix]), [
            [3, '01_MissionBrief_0IVN', '03_Scene03_'],
            [6, '03_Scene03_CCCC', '03_Scene03_Later_'],
        ]);
    });

    it('mints IDs that avoid those already taken', () => {
        const taken = new Set();
        const a = mintUniqueId('f_K_', taken);
        assert.match(a, /^f_K_[A-Z0-9]{4}$/);
        assert.isTrue(taken.has(a));
    });

    it('plans audio renames in every folder, keeping take suffixes and extensions', () => {
        const folders = {
            '/a/Recorded': ['01_MissionBrief_0IVN.wav', 'other_K_AAAA.wav', 'notes.txt'],
            '/a/TTS': ['01_MissionBrief_0IVN_take2.ogg', '01_MissionBrief_0IVNX.wav'],
        };
        const { moves, conflicts } = planAudioRenames(folders,
            [{ oldId: '01_MissionBrief_0IVN', newId: '03_Scene03_T1ZD' }]);
        assert.deepEqual(moves, [
            { from: path.join('/a/Recorded', '01_MissionBrief_0IVN.wav'), to: path.join('/a/Recorded', '03_Scene03_T1ZD.wav') },
            { from: path.join('/a/TTS', '01_MissionBrief_0IVN_take2.ogg'), to: path.join('/a/TTS', '03_Scene03_T1ZD_take2.ogg') },
        ]);
        assert.deepEqual(conflicts, []);
    });

    it('leaves a file alone rather than overwrite one with the new name', () => {
        const { moves, conflicts } = planAudioRenames(
            { '/a/R': ['old_K_AAAA.wav', 'new_K_BBBB.wav'] },
            [{ oldId: 'old_K_AAAA', newId: 'new_K_BBBB' }]);
        assert.deepEqual(moves, []);
        assert.lengthOf(conflicts, 1);
    });

    it('moves re-record flags to the new IDs', () => {
        assert.deepEqual(renameIdsInList(['a_K_AAAA', 'b_K_BBBB'], [{ oldId: 'b_K_BBBB', newId: 'c_K_CCCC' }]),
            ['a_K_AAAA', 'c_K_CCCC']);
    });
});
