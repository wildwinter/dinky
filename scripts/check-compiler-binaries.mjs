#!/usr/bin/env node
// Verify the Dink compiler/viewer binaries are present before packaging.
//
// These are synced from ../dink by scripts/sync-dink-builds.mjs (the prebuild
// step) and are intentionally NOT tracked in git. If the sync didn't run, or
// ../dink hasn't been built for the target platform, they'll be missing — fail
// loudly here rather than letting electron-builder ship an app with no compiler.
//
// Usage: node scripts/check-compiler-binaries.mjs [mac] [win]
//   with no platform args, checks both.

import { existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const compilerDir = resolve(root, 'resources', 'compiler');

// Must match build.mac.extraResources / build.win.extraResources in package.json.
const TARGETS = {
    mac: ['DinkCompiler', 'DinkViewer'],
    win: ['DinkCompiler.exe', 'DinkViewer.exe'],
};

const requested = process.argv.slice(2).filter((a) => a === 'mac' || a === 'win');
const platforms = requested.length ? requested : ['mac', 'win'];
const required = [...new Set(platforms.flatMap((p) => TARGETS[p]))];

const missing = [];
const empty = [];
for (const name of required) {
    const p = resolve(compilerDir, name);
    if (!existsSync(p)) missing.push(name);
    else if (statSync(p).size === 0) empty.push(name);
}

if (missing.length === 0 && empty.length === 0) {
    console.log(`check-compiler-binaries: OK for [${platforms.join(', ')}] — ${required.join(', ')}`);
    process.exit(0);
}

console.error('');
console.error('ERROR: Dink compiler binaries are missing from resources/compiler/');
if (missing.length) console.error('  missing: ' + missing.join(', '));
if (empty.length) console.error('  empty:   ' + empty.join(', '));
console.error('');
console.error('These are synced from ../dink and are not stored in git. To fix:');
console.error('  1. Build Dink for the target platform(s):  cd ../dink && npm run pack:csharp');
console.error('  2. Re-run the sync (or just re-run this build) — prebuild copies them across.');
console.error('');
process.exit(1);
