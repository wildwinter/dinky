#!/usr/bin/env node
// Sync local dink builds into resources/compiler if they exist.
// Runs as a prebuild step; never fails the build.

import { existsSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dinkRoot = resolve(root, '..', 'dink', 'csharp');

const copies = [
    {
        src: resolve(dinkRoot, 'DinkCompiler', 'bin', 'Release', 'net8.0', 'osx-arm64', 'DinkCompiler'),
        dst: resolve(root, 'resources', 'compiler', 'DinkCompiler'),
    },
    {
        src: resolve(dinkRoot, 'DinkCompiler', 'bin', 'Release', 'net8.0', 'win-x64', 'DinkCompiler.exe'),
        dst: resolve(root, 'resources', 'compiler', 'DinkCompiler.exe'),
    },
    {
        src: resolve(dinkRoot, 'DinkViewer', 'bin', 'Release', 'net8.0', 'osx-arm64', 'DinkViewer'),
        dst: resolve(root, 'resources', 'compiler', 'DinkViewer'),
    },
    {
        src: resolve(dinkRoot, 'DinkViewer', 'bin', 'Release', 'net8.0', 'win-x64', 'DinkViewer.exe'),
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
    console.log('sync-dink: no local dink builds found, skipping.');
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
