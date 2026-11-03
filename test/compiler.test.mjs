import { assert } from 'chai';
import { createRequire } from 'module';
import { build } from 'esbuild';

// electron/compiler.js imports inkjs/full's default export, which only exists
// once Vite has bundled it. Bundle it the same way here so the real module is
// under test rather than a copy of its compiler options.
const require = createRequire(import.meta.url);
const inkjs = require('inkjs/full');

let compileStory;
before(async () => {
    const out = await build({
        entryPoints: ['electron/compiler.js'],
        bundle: true,
        platform: 'node',
        format: 'esm',
        write: false,
        // inkjs/full's CommonJS build: the .mjs one has no default export
        alias: { 'inkjs/full': require.resolve('inkjs/full') },
    });
    const url = 'data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64');
    ({ compileStory } = await import(url));
});

describe('compileStory', () => {
    // DinkCompiler compiles as inklecate -c, so the test window must too, or a
    // story that asks for an unread knot's visit count behaves differently here.
    it('counts visits to knots the script never reads', async () => {
        const json = await compileStory('-> unread\n=== unread\nA line.\n-> END\n', null);
        const story = new inkjs.Story(json);
        story.ContinueMaximally();
        assert.equal(story.state.VisitCountAtPathString('unread'), 1);
    });
});
