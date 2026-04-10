#!/usr/bin/env node
// Ensure @wildwinter/simple-vc-lib is updated to the latest published version.
// Runs as part of the prebuild step.

import { execSync } from 'child_process';

const pkg = '@wildwinter/simple-vc-lib';

console.log(`update-simple-vc-lib: checking for latest version of ${pkg}...`);
try {
    execSync(`npm install ${pkg}@latest`, { stdio: 'inherit' });
    console.log(`update-simple-vc-lib: ${pkg} is up to date.`);
} catch (err) {
    console.warn(`update-simple-vc-lib: failed to update ${pkg} (${err.message}). Continuing with existing version.`);
}
