import { assert } from 'chai';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { setProvider, clearProvider, FilesystemProvider, GitProvider, SvnProvider } from '@wildwinter/simple-vc-lib';

import { vcWriteText, vcWriteBinary, vcDelete, vcRename } from '../electron/vc.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir() {
    return mkdtempSync(join(tmpdir(), 'dinky-vc-test-'));
}

function initSvnRepo() {
    const repoDir = makeTempDir();
    const wcDir = makeTempDir();
    spawnSync('svnadmin', ['create', repoDir], { encoding: 'utf8' });
    spawnSync('svn', ['checkout', `file://${repoDir}`, wcDir], { encoding: 'utf8' });
    writeFileSync(join(wcDir, 'initial.txt'), 'initial');
    spawnSync('svn', ['add', 'initial.txt'], { cwd: wcDir, encoding: 'utf8' });
    spawnSync('svn', ['commit', '-m', 'initial', '--username', 'test', '--no-auth-cache'], { cwd: wcDir, encoding: 'utf8' });
    return wcDir;
}

function initGitRepo(dir) {
    const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    run(['init']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test User']);
    writeFileSync(join(dir, 'README.md'), 'test');
    run(['add', 'README.md']);
    run(['commit', '-m', 'init']);
}

// ---------------------------------------------------------------------------
// FilesystemProvider — core vc.js wrapper behaviour
// ---------------------------------------------------------------------------

describe('vcWriteText (FilesystemProvider)', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = makeTempDir();
        setProvider(new FilesystemProvider());
    });

    afterEach(() => {
        clearProvider();
    });

    it('creates a new text file', () => {
        const filePath = join(tempDir, 'newfile.ink');
        vcWriteText(filePath, '// Hello');
        assert.isTrue(existsSync(filePath));
        assert.equal(readFileSync(filePath, 'utf-8'), '// Hello');
    });

    it('overwrites an existing text file', () => {
        const filePath = join(tempDir, 'existing.ink');
        writeFileSync(filePath, 'old content');
        vcWriteText(filePath, 'new content');
        assert.equal(readFileSync(filePath, 'utf-8'), 'new content');
    });

    it('creates a JSON project file', () => {
        const filePath = join(tempDir, 'project.dinkproj');
        const data = { source: 'main.ink', destFolder: 'output' };
        vcWriteText(filePath, JSON.stringify(data, null, 2));
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
        assert.equal(parsed.source, 'main.ink');
    });
});

describe('vcWriteBinary (FilesystemProvider)', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = makeTempDir();
        setProvider(new FilesystemProvider());
    });

    afterEach(() => {
        clearProvider();
    });

    it('creates a new binary file from a Buffer', () => {
        const filePath = join(tempDir, 'audio.bin');
        const data = Buffer.from([0x52, 0x49, 0x46, 0x46]); // "RIFF"
        vcWriteBinary(filePath, data);
        assert.isTrue(existsSync(filePath));
        assert.deepEqual(readFileSync(filePath), data);
    });

    it('creates a binary file from a Uint8Array', () => {
        const filePath = join(tempDir, 'data.bin');
        const data = new Uint8Array([1, 2, 3, 4]);
        vcWriteBinary(filePath, data);
        assert.isTrue(existsSync(filePath));
        assert.deepEqual([...readFileSync(filePath)], [1, 2, 3, 4]);
    });

    it('overwrites an existing binary file', () => {
        const filePath = join(tempDir, 'overwrite.bin');
        writeFileSync(filePath, Buffer.from([0x00, 0x00]));
        const newData = Buffer.from([0xFF, 0xFE]);
        vcWriteBinary(filePath, newData);
        assert.deepEqual(readFileSync(filePath), newData);
    });
});

describe('vcDelete (FilesystemProvider)', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = makeTempDir();
        setProvider(new FilesystemProvider());
    });

    afterEach(() => {
        clearProvider();
    });

    it('deletes an existing file', () => {
        const filePath = join(tempDir, 'todelete.ink');
        writeFileSync(filePath, 'bye');
        vcDelete(filePath);
        assert.isFalse(existsSync(filePath));
    });

    it('does not throw when deleting a non-existent file', () => {
        assert.doesNotThrow(() => vcDelete(join(tempDir, 'ghost.ink')));
    });
});

describe('vcRename (FilesystemProvider)', () => {
    let tempDir;

    beforeEach(() => {
        tempDir = makeTempDir();
        setProvider(new FilesystemProvider());
    });

    afterEach(() => {
        clearProvider();
    });

    it('moves a file to the new path', () => {
        const oldPath = join(tempDir, 'original.ink');
        const newPath = join(tempDir, 'renamed.ink');
        writeFileSync(oldPath, '// content');
        vcRename(oldPath, newPath);
        assert.isFalse(existsSync(oldPath));
        assert.isTrue(existsSync(newPath));
        assert.equal(readFileSync(newPath, 'utf-8'), '// content');
    });

    it('does not throw when renaming a non-existent file', () => {
        assert.doesNotThrow(() =>
            vcRename(join(tempDir, 'ghost.ink'), join(tempDir, 'other.ink'))
        );
    });
});

// ---------------------------------------------------------------------------
// GitProvider — VC-aware behaviour for the operations Dinky uses
// ---------------------------------------------------------------------------

describe('vcWriteText (GitProvider)', function () {
    let repoDir;

    before(function () {
        const check = spawnSync('git', ['--version'], { encoding: 'utf8' });
        if (check.error || check.status !== 0) this.skip();
        repoDir = makeTempDir();
        initGitRepo(repoDir);
        setProvider(new GitProvider());
    });

    after(() => clearProvider());

    it('creates a new ink file and stages it', () => {
        const filePath = join(repoDir, 'main.ink');
        vcWriteText(filePath, '// Add Ink content here');
        assert.isTrue(existsSync(filePath));
        const status = spawnSync('git', ['status', '--short', filePath], { cwd: repoDir, encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A /);
    });

    it('overwrites a tracked ink file', () => {
        const filePath = join(repoDir, 'tracked.ink');
        writeFileSync(filePath, 'old');
        spawnSync('git', ['add', filePath], { cwd: repoDir });
        spawnSync('git', ['commit', '-m', 'add tracked'], { cwd: repoDir });
        vcWriteText(filePath, 'new content');
        assert.equal(readFileSync(filePath, 'utf-8'), 'new content');
    });

    it('creates a dinkproj file and stages it', () => {
        const filePath = join(repoDir, 'project.dinkproj');
        vcWriteText(filePath, JSON.stringify({ source: 'main.ink' }, null, 2));
        const status = spawnSync('git', ['status', '--short', filePath], { cwd: repoDir, encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A /);
    });

    it('creates a characters.json file and stages it', () => {
        const filePath = join(repoDir, 'characters.json');
        vcWriteText(filePath, JSON.stringify([{ ID: 'HERO', Actor: '' }], null, 4));
        const status = spawnSync('git', ['status', '--short', filePath], { cwd: repoDir, encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A /);
    });

    it('creates a project-dictionary.txt file and stages it', () => {
        const filePath = join(repoDir, 'project-dictionary.txt');
        vcWriteText(filePath, 'exampleword\n');
        const status = spawnSync('git', ['status', '--short', filePath], { cwd: repoDir, encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A /);
    });
});

describe('vcDelete (GitProvider)', function () {
    let repoDir;

    before(function () {
        const check = spawnSync('git', ['--version'], { encoding: 'utf8' });
        if (check.error || check.status !== 0) this.skip();
        repoDir = makeTempDir();
        initGitRepo(repoDir);
        setProvider(new GitProvider());
    });

    after(() => clearProvider());

    it('removes a committed ink file from disk and git index', () => {
        const filePath = join(repoDir, 'todelete.ink');
        writeFileSync(filePath, '// bye');
        spawnSync('git', ['add', filePath], { cwd: repoDir });
        spawnSync('git', ['commit', '-m', 'add todelete'], { cwd: repoDir });
        vcDelete(filePath);
        assert.isFalse(existsSync(filePath));
        const status = spawnSync('git', ['status', '--short', filePath], { cwd: repoDir, encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^D /);
    });

    it('removes an untracked file from disk', () => {
        const filePath = join(repoDir, 'untracked.ink');
        writeFileSync(filePath, '// untracked');
        vcDelete(filePath);
        assert.isFalse(existsSync(filePath));
    });
});

describe('vcRename (GitProvider)', function () {
    let repoDir;

    before(function () {
        const check = spawnSync('git', ['--version'], { encoding: 'utf8' });
        if (check.error || check.status !== 0) this.skip();
        repoDir = makeTempDir();
        initGitRepo(repoDir);
        setProvider(new GitProvider());
    });

    after(() => clearProvider());

    it('renames a committed ink file via git mv, preserving history', () => {
        const oldPath = join(repoDir, 'chapter1.ink');
        const newPath = join(repoDir, 'chapter-one.ink');
        writeFileSync(oldPath, '// chapter 1');
        spawnSync('git', ['add', oldPath], { cwd: repoDir });
        spawnSync('git', ['commit', '-m', 'add chapter1'], { cwd: repoDir });

        vcRename(oldPath, newPath);

        assert.isFalse(existsSync(oldPath));
        assert.isTrue(existsSync(newPath));

        // New path should be tracked in git index (git mv, not add+delete)
        const ls = spawnSync('git', ['ls-files', '--error-unmatch', newPath], { cwd: repoDir, encoding: 'utf8' });
        assert.equal(ls.status, 0, 'renamed file should be in git index');
    });

    it('renames an untracked ink file on disk', () => {
        const oldPath = join(repoDir, 'draft.ink');
        const newPath = join(repoDir, 'draft-renamed.ink');
        writeFileSync(oldPath, '// draft');

        vcRename(oldPath, newPath);

        assert.isFalse(existsSync(oldPath));
        assert.isTrue(existsSync(newPath));
    });

    it('renames a committed include file and updates are possible', () => {
        const oldPath = join(repoDir, 'include-old.ink');
        const newPath = join(repoDir, 'include-new.ink');
        writeFileSync(oldPath, '// include content');
        spawnSync('git', ['add', oldPath], { cwd: repoDir });
        spawnSync('git', ['commit', '-m', 'add include'], { cwd: repoDir });

        vcRename(oldPath, newPath);

        assert.isTrue(existsSync(newPath));
        assert.equal(readFileSync(newPath, 'utf-8'), '// include content');
    });
});

describe('vcWriteBinary (GitProvider)', function () {
    let repoDir;

    before(function () {
        const check = spawnSync('git', ['--version'], { encoding: 'utf8' });
        if (check.error || check.status !== 0) this.skip();
        repoDir = makeTempDir();
        initGitRepo(repoDir);
        setProvider(new GitProvider());
    });

    after(() => clearProvider());

    it('creates a binary audio file and stages it', () => {
        const filePath = join(repoDir, 'line_001.wav');
        const data = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]); // minimal RIFF header
        vcWriteBinary(filePath, data);
        assert.isTrue(existsSync(filePath));
        const status = spawnSync('git', ['status', '--short', filePath], { cwd: repoDir, encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A /);
    });

    it('overwrites an existing tracked audio file', () => {
        const filePath = join(repoDir, 'scratch.wav');
        const original = Buffer.from([0x00, 0x01]);
        writeFileSync(filePath, original);
        spawnSync('git', ['add', filePath], { cwd: repoDir });
        spawnSync('git', ['commit', '-m', 'add scratch'], { cwd: repoDir });

        const updated = Buffer.from([0x00, 0x02]);
        vcWriteBinary(filePath, updated);
        assert.deepEqual(readFileSync(filePath), updated);
    });
});

// ---------------------------------------------------------------------------
// SvnProvider tests (uses a temporary SVN repository via file:// URL)
// ---------------------------------------------------------------------------

describe('vcWriteText (SvnProvider)', function () {
    this.timeout(10000);
    let wcDir;

    before(function () {
        const check = spawnSync('svn', ['--version', '--quiet'], { encoding: 'utf8' });
        const adminCheck = spawnSync('svnadmin', ['--version', '--quiet'], { encoding: 'utf8' });
        if (check.status !== 0 || adminCheck.status !== 0) this.skip();
        wcDir = initSvnRepo();
        setProvider(new SvnProvider());
    });

    after(() => clearProvider());

    it('creates a new ink file and stages it for add', () => {
        const filePath = join(wcDir, 'new.ink');
        vcWriteText(filePath, '// Add Ink content here');
        assert.isTrue(existsSync(filePath));
        const status = spawnSync('svn', ['status', filePath], { encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A/);
    });

    it('creates a dinkproj file and stages it for add', () => {
        const filePath = join(wcDir, 'project.dinkproj');
        vcWriteText(filePath, JSON.stringify({ source: 'main.ink' }, null, 2));
        const status = spawnSync('svn', ['status', filePath], { encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A/);
    });

    it('creates a characters.json file and stages it for add', () => {
        const filePath = join(wcDir, 'characters.json');
        vcWriteText(filePath, JSON.stringify([{ ID: 'HERO', Actor: '' }], null, 4));
        const status = spawnSync('svn', ['status', filePath], { encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A/);
    });

    it('creates a project-dictionary.txt file and stages it for add', () => {
        const filePath = join(wcDir, 'project-dictionary.txt');
        vcWriteText(filePath, 'exampleword\n');
        const status = spawnSync('svn', ['status', filePath], { encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A/);
    });

    it('overwrites a committed ink file', () => {
        const filePath = join(wcDir, 'committed.ink');
        writeFileSync(filePath, 'old');
        spawnSync('svn', ['add', filePath], { encoding: 'utf8' });
        spawnSync('svn', ['commit', '-m', 'add committed', '--username', 'test', '--no-auth-cache'], { cwd: wcDir, encoding: 'utf8' });
        vcWriteText(filePath, '// updated content');
        assert.equal(readFileSync(filePath, 'utf-8'), '// updated content');
    });
});

describe('vcWriteBinary (SvnProvider)', function () {
    this.timeout(10000);
    let wcDir;

    before(function () {
        const check = spawnSync('svn', ['--version', '--quiet'], { encoding: 'utf8' });
        const adminCheck = spawnSync('svnadmin', ['--version', '--quiet'], { encoding: 'utf8' });
        if (check.status !== 0 || adminCheck.status !== 0) this.skip();
        wcDir = initSvnRepo();
        setProvider(new SvnProvider());
    });

    after(() => clearProvider());

    it('creates a new binary audio file and stages it for add', () => {
        const filePath = join(wcDir, 'line_001.wav');
        const data = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
        vcWriteBinary(filePath, data);
        assert.isTrue(existsSync(filePath));
        const status = spawnSync('svn', ['status', filePath], { encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A/);
    });

    it('overwrites a committed audio file', () => {
        const filePath = join(wcDir, 'scratch.wav');
        const original = Buffer.from([0x00, 0x01]);
        writeFileSync(filePath, original);
        spawnSync('svn', ['add', filePath], { encoding: 'utf8' });
        spawnSync('svn', ['commit', '-m', 'add scratch', '--username', 'test', '--no-auth-cache'], { cwd: wcDir, encoding: 'utf8' });
        const updated = Buffer.from([0x00, 0x02]);
        vcWriteBinary(filePath, updated);
        assert.deepEqual(readFileSync(filePath), updated);
    });
});

describe('vcDelete (SvnProvider)', function () {
    this.timeout(10000);
    let wcDir;

    before(function () {
        const check = spawnSync('svn', ['--version', '--quiet'], { encoding: 'utf8' });
        const adminCheck = spawnSync('svnadmin', ['--version', '--quiet'], { encoding: 'utf8' });
        if (check.status !== 0 || adminCheck.status !== 0) this.skip();
        wcDir = initSvnRepo();
        setProvider(new SvnProvider());
    });

    after(() => clearProvider());

    it('removes a committed ink file from disk and marks it deleted', () => {
        const filePath = join(wcDir, 'todelete.ink');
        writeFileSync(filePath, '// bye');
        spawnSync('svn', ['add', filePath], { encoding: 'utf8' });
        spawnSync('svn', ['commit', '-m', 'add todelete', '--username', 'test', '--no-auth-cache'], { cwd: wcDir, encoding: 'utf8' });
        vcDelete(filePath);
        assert.isFalse(existsSync(filePath));
        const status = spawnSync('svn', ['status', filePath], { encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^D/);
    });

    it('removes an untracked file from disk', () => {
        const filePath = join(wcDir, 'untracked.ink');
        writeFileSync(filePath, '// untracked');
        vcDelete(filePath);
        assert.isFalse(existsSync(filePath));
    });
});

describe('vcRename (SvnProvider)', function () {
    this.timeout(10000);
    let wcDir;

    before(function () {
        const check = spawnSync('svn', ['--version', '--quiet'], { encoding: 'utf8' });
        const adminCheck = spawnSync('svnadmin', ['--version', '--quiet'], { encoding: 'utf8' });
        if (check.status !== 0 || adminCheck.status !== 0) this.skip();
        wcDir = initSvnRepo();
        setProvider(new SvnProvider());
    });

    after(() => clearProvider());

    it('renames a committed ink file via svn move', () => {
        const oldPath = join(wcDir, 'chapter1.ink');
        const newPath = join(wcDir, 'chapter-one.ink');
        writeFileSync(oldPath, '// chapter 1');
        spawnSync('svn', ['add', oldPath], { encoding: 'utf8' });
        spawnSync('svn', ['commit', '-m', 'add chapter1', '--username', 'test', '--no-auth-cache'], { cwd: wcDir, encoding: 'utf8' });
        vcRename(oldPath, newPath);
        assert.isFalse(existsSync(oldPath));
        assert.isTrue(existsSync(newPath));
        const status = spawnSync('svn', ['status', newPath], { encoding: 'utf8' });
        assert.match(status.stdout.trim(), /^A/);
    });

    it('renames a committed include file via svn move', () => {
        const oldPath = join(wcDir, 'include-old.ink');
        const newPath = join(wcDir, 'include-new.ink');
        writeFileSync(oldPath, '// include content');
        spawnSync('svn', ['add', oldPath], { encoding: 'utf8' });
        spawnSync('svn', ['commit', '-m', 'add include', '--username', 'test', '--no-auth-cache'], { cwd: wcDir, encoding: 'utf8' });
        vcRename(oldPath, newPath);
        assert.isFalse(existsSync(oldPath));
        assert.isTrue(existsSync(newPath));
        assert.equal(readFileSync(newPath, 'utf-8'), '// include content');
    });
});
