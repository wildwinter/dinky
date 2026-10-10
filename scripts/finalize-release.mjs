#!/usr/bin/env node
// Turn the draft release electron-builder just uploaded into a full, published
// release, with this version's notes taken from CHANGELOG.md.
//
// electron-builder is deliberately left creating a DRAFT: `npm run publish`
// uploads the macOS build and then the Windows build, so publishing up front
// would leave a public release without its Windows installer for several
// minutes. This runs last, once every asset is in place.

import { readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tag = `v${version}`;

// Extract the "## [version]" section, up to the next "## " heading.
const lines = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split('\n');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const start = lines.findIndex(l => new RegExp(`^##\\s*\\[${escaped}\\]`).test(l));
let notes = '';
if (start !== -1) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    notes = lines.slice(start + 1, end).join('\n').trim();
}

const manual = (file) =>
    `  gh release edit ${tag} --notes-file ${file} --draft=false --latest`;

if (!notes) {
    console.error(`finalize-release: no CHANGELOG.md entry found for ${version}.`);
    console.error(`finalize-release: ${tag} is left as a draft. Add the notes, then run:`);
    console.error('  npm run finalize-release');
    process.exit(1);
}

const notesFile = join(tmpdir(), `dinky-release-notes-${version}.md`);
writeFileSync(notesFile, notes + '\n');

const gh = (args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8' });

try {
    gh(['release', 'edit', tag, '--notes-file', notesFile, '--draft=false', '--latest']);
} catch (err) {
    console.error(`finalize-release: could not publish ${tag} (${err.message}).`);
    console.error('finalize-release: it is left as a draft. Publish it with:');
    console.error(manual(notesFile));
    process.exit(1);
}

const state = JSON.parse(gh(['release', 'view', tag, '--json', 'isDraft']));
if (state.isDraft) {
    console.error(`finalize-release: ${tag} still reports as a draft. Publish it with:`);
    console.error(manual(notesFile));
    process.exit(1);
}

console.log(`finalize-release: published ${tag} with notes from CHANGELOG.md.`);
