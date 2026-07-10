import { assert } from 'chai';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { safeReadJSON, safeReadText } from '../electron/safe-read.js';

let dir;
before(async () => { dir = await mkdtemp(join(tmpdir(), 'dinky-safe-read-')); });
after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

async function withFile(name, contents) {
    const p = join(dir, name);
    await writeFile(p, contents, 'utf-8');
    return p;
}

describe('safeReadText', () => {
    it('reports absent for a missing file', async () => {
        const r = await safeReadText(join(dir, 'nope.txt'));
        assert.equal(r.kind, 'absent');
    });

    it('reads an existing file', async () => {
        const p = await withFile('plain.txt', 'hello');
        const r = await safeReadText(p);
        assert.equal(r.kind, 'ok');
        assert.equal(r.content, 'hello');
    });
});

describe('safeReadJSON (strict)', () => {
    it('parses valid JSON', async () => {
        const p = await withFile('a.json', '{"x":1}');
        const r = await safeReadJSON(p);
        assert.equal(r.kind, 'ok');
        assert.deepEqual(r.data, { x: 1 });
    });

    it('reports broken for malformed JSON', async () => {
        const p = await withFile('bad.json', '{"x":1');
        const r = await safeReadJSON(p);
        assert.equal(r.kind, 'broken');
        assert.isOk(r.error);
        assert.equal(r.raw, '{"x":1}'.slice(0, 6));
    });

    it('rejects comments when they are not allowed', async () => {
        const p = await withFile('c.json', '// hi\n{"x":1}');
        const r = await safeReadJSON(p);
        assert.equal(r.kind, 'broken');
    });

    it('reports absent for a missing file', async () => {
        const r = await safeReadJSON(join(dir, 'nope.json'));
        assert.equal(r.kind, 'absent');
    });
});

describe('safeReadJSON (allowComments)', () => {
    const opts = { allowComments: true };

    it('strips line comments', async () => {
        const p = await withFile('d.jsonc', '// leading\n{"x":1} // trailing');
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'ok');
        assert.deepEqual(r.data, { x: 1 });
    });

    it('strips block comments', async () => {
        const p = await withFile('e.jsonc', '/* a\n b */\n{"x":1}');
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'ok');
        assert.deepEqual(r.data, { x: 1 });
    });

    it('allows trailing commas', async () => {
        const p = await withFile('f.jsonc', '{"x":1,}');
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'ok');
        assert.deepEqual(r.data, { x: 1 });
    });

    // Regression: a naive regex comment-strip also removes "//" inside string
    // values, corrupting notes that contain URLs or "//" asides.
    it('preserves "//" inside string values (URL)', async () => {
        const p = await withFile('g.jsonc', '[{"ID":"BOB","Notes":"see http://wiki/bob"}]');
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'ok');
        assert.equal(r.data[0].Notes, 'see http://wiki/bob');
    });

    it('preserves "//" inside string values (aside)', async () => {
        const p = await withFile('h.jsonc', '[{"ID":"BOB","Notes":"TODO // ask Sam"}]');
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'ok');
        assert.equal(r.data[0].Notes, 'TODO // ask Sam');
    });

    it('preserves "/*" inside string values', async () => {
        const p = await withFile('i.jsonc', '[{"ID":"BOB","Notes":"a /* b"}]');
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'ok');
        assert.equal(r.data[0].Notes, 'a /* b');
    });

    it('still reports broken for genuinely malformed JSONC', async () => {
        const p = await withFile('j.jsonc', '[{"ID":"BOB",}');
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'broken');
        assert.isOk(r.error);
        assert.isString(r.raw);
    });

    it('exposes raw content on broken so callers can recover', async () => {
        const src = '[{"ID":';
        const p = await withFile('k.jsonc', src);
        const r = await safeReadJSON(p, opts);
        assert.equal(r.kind, 'broken');
        assert.equal(r.raw, src);
    });
});
