#!/usr/bin/env node
// Promote the "[Unreleased]" section of CHANGELOG.md to a dated, versioned
// heading, and open a fresh empty "[Unreleased]" above it.
//
// Run automatically by the `version` npm lifecycle hook (see package.json),
// which fires AFTER package.json is bumped but BEFORE npm makes the version
// commit — so the changelog edit is staged into that same commit.
//
// Never blocks a release: any problem here logs a warning and exits 0.

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const changelogPath = resolve(root, 'CHANGELOG.md');

const version = process.env.npm_package_version;
if (!version) {
    console.warn('update-changelog: npm_package_version not set; skipping.');
    process.exit(0);
}

let text;
try {
    text = readFileSync(changelogPath, 'utf8');
} catch (e) {
    console.warn(`update-changelog: could not read CHANGELOG.md (${e.message}); skipping.`);
    process.exit(0);
}

// Idempotency: if a heading for this version already exists, do nothing.
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (new RegExp(`^##\\s*\\[${escaped}\\]`, 'm').test(text)) {
    console.log(`update-changelog: [${version}] heading already present; leaving as-is.`);
    process.exit(0);
}

// Use [ \t]* (not \s*) around the heading so the match doesn't swallow the
// blank line that follows — otherwise the promoted version heading ends up
// butted directly against the first "### " sub-heading.
const unreleasedRe = /^##[ \t]*\[Unreleased\][ \t]*$/m;
const match = text.match(unreleasedRe);
if (!match) {
    console.warn('update-changelog: no "## [Unreleased]" heading found; skipping.');
    process.exit(0);
}

// Warn (but don't block) if the Unreleased section has no entries — a release
// with an empty changelog section is almost always a forgotten-to-write-notes
// mistake, worth flagging.
const afterUnreleased = text.slice(match.index + match[0].length);
const nextHeadingIdx = afterUnreleased.search(/^##\s+/m);
const unreleasedBody = (nextHeadingIdx === -1 ? afterUnreleased : afterUnreleased.slice(0, nextHeadingIdx));
if (!/[^\s]/.test(unreleasedBody)) {
    console.warn(`update-changelog: WARNING — [Unreleased] section is empty; [${version}] will have no notes.`);
}

// Local-time YYYY-MM-DD.
const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Keep the em-dash + spacing style already used in this changelog.
const replacement = `## [Unreleased]\n\n## [${version}] — ${date}`;
const updated = text.replace(unreleasedRe, replacement);

writeFileSync(changelogPath, updated);
console.log(`update-changelog: promoted [Unreleased] -> [${version}] — ${date}`);

// Stage it so it lands in the version commit npm is about to create.
try {
    execSync(`git add "${changelogPath}"`, { cwd: root, stdio: 'inherit' });
} catch (e) {
    console.warn(`update-changelog: git add failed (${e.message}); change written but unstaged.`);
}
