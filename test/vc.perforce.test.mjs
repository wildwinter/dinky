/**
 * Perforce integration tests for Dinky's vc.js wrappers.
 *
 * These tests require a configured Perforce workspace on the local machine.
 * They are NOT included in the default `npm test` run. Run with:
 *
 *   npm run test:perforce
 *
 * Or with an explicit workspace path:
 *
 *   P4_TEST_DIR=/path/to/your/p4/workspace npm run test:perforce
 *
 * Requirements:
 *   - `p4` on PATH
 *   - P4PORT / P4USER / P4CLIENT configured (env vars, p4 config, or p4 tickets)
 *   - P4_TEST_DIR (or the auto-detected workspace root) must be a mapped depot path
 */

import { assert } from 'chai';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { setProvider, clearProvider, PerforceProvider } from '@wildwinter/simple-vc-lib';

import { vcWriteText, vcWriteBinary, vcDelete, vcRename } from '../electron/vc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p4(args) {
    const result = spawnSync('p4', args, { encoding: 'utf8', windowsHide: true });
    return { status: result.status ?? -1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function p4Available() {
    return p4(['info']).status === 0;
}

function workspaceRoot() {
    const out = p4(['info']).stdout;
    const match = out.match(/Client root:\s+(.+)/i);
    return match ? match[1].trim().replace(/\r/g, '') : null;
}

/**
 * Write, `p4 add`, and submit a file so it is fully tracked and read-only on disk.
 */
function submitFile(filePath, content = 'test content') {
    writeFileSync(filePath, content);
    const addResult = p4(['add', filePath]);
    assert.equal(addResult.status, 0,
        `p4 add failed for '${filePath}' - is the path mapped in your workspace?\n` +
        `stdout: ${addResult.stdout}\nstderr: ${addResult.stderr}`);

    const openedResult = p4(['opened', filePath]);
    assert.equal(openedResult.status, 0,
        `p4 add returned exit 0 but '${filePath}' is not open in any changelist.\n` +
        `Likely cause: a .p4ignore file is filtering this path.\n` +
        `Fix: add an exception for the test directory, e.g.: !_dinky_vc_test/`);

    const submitResult = p4(['submit', '-d', `add ${filePath} (dinky vc test)`]);
    assert.equal(submitResult.status, 0,
        `p4 submit failed for '${filePath}'\n${submitResult.stderr || submitResult.stdout}`);
}

// ---------------------------------------------------------------------------
// PerforceProvider tests
// ---------------------------------------------------------------------------

describe('vcWriteText (PerforceProvider)', function () {
    this.timeout(30000);
    let testDir;

    before(function () {
        if (!p4Available()) {
            console.log('    Skipping: p4 not available or workspace not configured.');
            this.skip();
        }
        const root = process.env.P4_TEST_DIR ?? workspaceRoot();
        if (!root) {
            console.log('    Skipping: set P4_TEST_DIR to a mapped workspace path.');
            this.skip();
        }
        testDir = join(root, '_dinky_vc_test', 'write-text');
        mkdirSync(testDir, { recursive: true });
        setProvider(new PerforceProvider());
    });

    after(function () {
        clearProvider();
        if (!testDir) return;
        p4(['revert', join(testDir, '...')]);
        const del = p4(['delete', join(testDir, '...')]);
        if (del.status === 0) p4(['submit', '-d', 'cleanup: dinky vc test write-text']);
        if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    });

    it('creates a new ink file and opens it for add', () => {
        const filePath = join(testDir, 'main.ink');
        vcWriteText(filePath, '// Add Ink content here');
        assert.isTrue(existsSync(filePath));
        const fstat = p4(['fstat', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'add');
    });

    it('creates a dinkproj file and opens it for add', () => {
        const filePath = join(testDir, 'project.dinkproj');
        vcWriteText(filePath, JSON.stringify({ source: 'main.ink' }, null, 2));
        const fstat = p4(['fstat', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'add');
    });

    it('creates a characters.json file and opens it for add', () => {
        const filePath = join(testDir, 'characters.json');
        vcWriteText(filePath, JSON.stringify([{ ID: 'HERO', Actor: '' }], null, 4));
        const fstat = p4(['fstat', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'add');
    });

    it('creates a project-dictionary.txt file and opens it for add', () => {
        const filePath = join(testDir, 'project-dictionary.txt');
        vcWriteText(filePath, 'exampleword\n');
        const fstat = p4(['fstat', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'add');
    });

    it('checks out and overwrites a committed ink file', () => {
        const filePath = join(testDir, 'committed.ink');
        submitFile(filePath, '// original');
        vcWriteText(filePath, '// updated');
        assert.equal(readFileSync(filePath, 'utf-8'), '// updated');
        const fstat = p4(['fstat', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'edit');
    });
});

describe('vcWriteBinary (PerforceProvider)', function () {
    this.timeout(30000);
    let testDir;

    before(function () {
        if (!p4Available()) { this.skip(); }
        const root = process.env.P4_TEST_DIR ?? workspaceRoot();
        if (!root) { this.skip(); }
        testDir = join(root, '_dinky_vc_test', 'write-binary');
        mkdirSync(testDir, { recursive: true });
        setProvider(new PerforceProvider());
    });

    after(function () {
        clearProvider();
        if (!testDir) return;
        p4(['revert', join(testDir, '...')]);
        const del = p4(['delete', join(testDir, '...')]);
        if (del.status === 0) p4(['submit', '-d', 'cleanup: dinky vc test write-binary']);
        if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    });

    it('creates a new audio file and opens it for add', () => {
        const filePath = join(testDir, 'line_001.wav');
        const data = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
        vcWriteBinary(filePath, data);
        assert.isTrue(existsSync(filePath));
        const fstat = p4(['fstat', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'add');
    });

    it('checks out and overwrites a committed audio file', () => {
        const filePath = join(testDir, 'scratch.wav');
        submitFile(filePath, 'original audio data');
        const updated = Buffer.from([0x52, 0x49, 0x46, 0x46, 0xFF, 0xFF, 0x00, 0x00]);
        vcWriteBinary(filePath, updated);
        assert.deepEqual(readFileSync(filePath), updated);
        const fstat = p4(['fstat', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'edit');
    });
});

describe('vcDelete (PerforceProvider)', function () {
    this.timeout(30000);
    let testDir;

    before(function () {
        if (!p4Available()) { this.skip(); }
        const root = process.env.P4_TEST_DIR ?? workspaceRoot();
        if (!root) { this.skip(); }
        testDir = join(root, '_dinky_vc_test', 'delete');
        mkdirSync(testDir, { recursive: true });
        setProvider(new PerforceProvider());
    });

    after(function () {
        clearProvider();
        if (!testDir) return;
        p4(['revert', join(testDir, '...')]);
        const del = p4(['delete', join(testDir, '...')]);
        if (del.status === 0) p4(['submit', '-d', 'cleanup: dinky vc test delete']);
        if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    });

    it('removes a committed ink file from disk and opens it for delete', () => {
        const filePath = join(testDir, 'todelete.ink');
        submitFile(filePath, '// bye');
        vcDelete(filePath);
        assert.isFalse(existsSync(filePath));
        const fstat = p4(['fstat', '-Od', filePath]);
        assert.include(fstat.stdout + fstat.stderr, 'delete');
    });

    it('removes an untracked file from disk', () => {
        const filePath = join(testDir, 'untracked.ink');
        writeFileSync(filePath, '// local only');
        vcDelete(filePath);
        assert.isFalse(existsSync(filePath));
    });
});

describe('vcRename (PerforceProvider)', function () {
    this.timeout(30000);
    let testDir;

    before(function () {
        if (!p4Available()) { this.skip(); }
        const root = process.env.P4_TEST_DIR ?? workspaceRoot();
        if (!root) { this.skip(); }
        testDir = join(root, '_dinky_vc_test', 'rename');
        mkdirSync(testDir, { recursive: true });
        setProvider(new PerforceProvider());
    });

    after(function () {
        clearProvider();
        if (!testDir) return;
        p4(['revert', join(testDir, '...')]);
        const del = p4(['delete', join(testDir, '...')]);
        if (del.status === 0) p4(['submit', '-d', 'cleanup: dinky vc test rename']);
        if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    });

    it('renames a committed ink root file via p4 move', () => {
        const oldPath = join(testDir, 'chapter1.ink');
        const newPath = join(testDir, 'chapter-one.ink');
        submitFile(oldPath, '// chapter 1');
        vcRename(oldPath, newPath);
        assert.isFalse(existsSync(oldPath));
        assert.isTrue(existsSync(newPath));
        const fstat = p4(['fstat', newPath]);
        assert.include(fstat.stdout + fstat.stderr, 'add');
    });

    it('renames a committed include file via p4 move', () => {
        const oldPath = join(testDir, 'include-old.ink');
        const newPath = join(testDir, 'include-new.ink');
        submitFile(oldPath, '// include content');
        vcRename(oldPath, newPath);
        assert.isFalse(existsSync(oldPath));
        assert.isTrue(existsSync(newPath));
        assert.equal(readFileSync(newPath, 'utf-8'), '// include content');
    });
});
