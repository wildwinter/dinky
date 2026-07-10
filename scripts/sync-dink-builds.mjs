#!/usr/bin/env node
// Sync local dink builds into resources/compiler if they exist.
// Runs as a prebuild step; never fails the build.
//
// The compiler/viewer binaries are NOT stored in git (see .gitignore) — this
// script is the sole source of them. Packaging separately verifies they landed
// (scripts/check-compiler-binaries.mjs), so a silent skip here doesn't ship a
// broken app.

import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dinkRoot = resolve(root, '..', 'dink', 'csharp');

// The binaries are gitignored, so on a fresh clone this directory may not
// exist. copyFileSync won't create it, so ensure it's there first.
const compilerDir = resolve(root, 'resources', 'compiler');
mkdirSync(compilerDir, { recursive: true });

const copies = [
    {
        src: resolve(dinkRoot, 'dist', 'osx-arm64', 'DinkCompiler'),
        dst: resolve(root, 'resources', 'compiler', 'DinkCompiler'),
    },
    {
        src: resolve(dinkRoot, 'dist', 'win-x64', 'DinkCompiler.exe'),
        dst: resolve(root, 'resources', 'compiler', 'DinkCompiler.exe'),
    },
    {
        src: resolve(dinkRoot, 'dist', 'osx-arm64', 'DinkViewer'),
        dst: resolve(root, 'resources', 'compiler', 'DinkViewer'),
    },
    {
        src: resolve(dinkRoot, 'dist', 'win-x64', 'DinkViewer.exe'),
        dst: resolve(root, 'resources', 'compiler', 'DinkViewer.exe'),
    },
];

let copied = 0;

for (const { src, dst } of copies) {
    if (existsSync(src)) {
        copyFileSync(src, dst);
        console.log(`  sync-dink: copied ${src} -> ${dst}`);
        copied++;
    }
}

if (copied === 0) {
    // Not fatal here — plain `npm run build` (renderer/tests) doesn't need the
    // binaries. Packaging (dist/publish) runs check-compiler-binaries.mjs, which
    // WILL fail if they're absent. Warn so the cause is visible either way.
    console.warn('sync-dink: WARNING — no local dink builds found in ../dink/csharp/dist.');
    console.warn('sync-dink: packaging will fail until you build Dink (cd ../dink && npm run pack:csharp).');
    process.exit(0);
}

// Update dinkVersion in package.json
const dinkPkgPath = resolve(root, '..', 'dink', 'package.json');
if (!existsSync(dinkPkgPath)) {
    console.log('sync-dink: ../dink/package.json not found, skipping version update.');
    process.exit(0);
}

const dinkVersion = JSON.parse(readFileSync(dinkPkgPath, 'utf8')).version;
if (!dinkVersion) {
    console.log('sync-dink: no version field in ../dink/package.json, skipping version update.');
    process.exit(0);
}

const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.dinkVersion = dinkVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
console.log(`sync-dink: set dinkVersion to ${dinkVersion}`);
