import { assert } from 'chai';
import { scanIds, findDuplicateIds, replaceIdInLine } from '../src/duplicate-ids.js';

// From a user report: lines copied into other scenes kept Scene03's IDs, so the
// compiler kept one text per ID and silently dropped the other from the
// recording script, localisation and runtime strings.
describe('duplicate line IDs across a project', () => {
    const s03 =
        '== Scene03\n' +
        'USEC: Ward? Ward? #id:03_Scene03_B0XO\n' +
        'WARD: What? No, definitely not. #id:01_MissionBrief_0IVN\n' +
        'USEC: Oh, good. #id:03_Scene03_1GER\n';
    const s17 =
        '== Scene17\n' +
        'USEC: God, I am glad I got to you. #id:03_Scene03_B0XO\n';
    const s01 =
        '=== MissionBrief\n' +
        'USEC: Miss Ward. #id:01_MissionBrief_0IVN\n';

    it('keeps the ID on the line it belongs to, whatever the file order', () => {
        const { losers } = findDuplicateIds({ '/p/17.ink': s17, '/p/03.ink': s03 });
        assert.deepEqual(losers.map(l => [l.file, l.line, l.id]),
            [['/p/17.ink', 2, '03_Scene03_B0XO']]);
        assert.equal(losers[0].prefix, '17_Scene17_');
    });

    it('moves the ID off a line copied out of another scene', () => {
        const { losers } = findDuplicateIds({ '/p/03.ink': s03, '/p/01.ink': s01 });
        assert.deepEqual(losers.map(l => [l.file, l.line]), [['/p/03.ink', 3]]);
    });

    it('falls back to the first by file then line when no copy belongs where it sits', () => {
        const a = '== A\nOne. #id:x_Other_AAAA\n';
        const b = '== B\nTwo. #id:x_Other_AAAA\n';
        const first = findDuplicateIds({ '/p/b.ink': b, '/p/a.ink': a }).losers;
        assert.deepEqual(first.map(l => l.file), ['/p/b.ink']);
    });

    it('finds a duplicate within one file', () => {
        const t = '== K\nOne. #id:f_K_AAAA\nTwo. #id:f_K_AAAA\n';
        assert.deepEqual(findDuplicateIds({ '/p/f.ink': t }).losers.map(l => l.line), [3]);
    });

    it('ignores IDs in comments, as the compiler does', () => {
        const t = '== K\n// Old: One. #id:f_K_AAAA\n/* Two. #id:f_K_AAAA\n*/\nOne. #id:f_K_AAAA\n';
        assert.deepEqual(findDuplicateIds({ '/p/f.ink': t }).losers, []);
    });

    it('tracks stitches and functions in the prefix', () => {
        const t = '=== function greet(x)\nHi. #id:a_greet_AAAA\n== K\n= St\nYo. #id:a_K_St_BBBB\n';
        assert.deepEqual(scanIds('/p/a.ink', t).map(o => o.prefix), ['a_greet_', 'a_K_St_']);
    });

    it('lists every ID in the project, so fresh IDs avoid them all', () => {
        const { allIds } = findDuplicateIds({ '/p/03.ink': s03, '/p/17.ink': s17 });
        assert.isTrue(allIds.has('03_Scene03_1GER'));
        assert.equal(allIds.size, 3);
    });

    it('replaces only the given ID on a line', () => {
        assert.equal(replaceIdInLine('A: Hi. #id:a_K_AAAA #tag', 'a_K_AAAA', 'a_K_ZZZZ'),
            'A: Hi. #id:a_K_ZZZZ #tag');
        assert.isNull(replaceIdInLine('A: Hi.', 'a_K_AAAA', 'a_K_ZZZZ'));
    });
});
