// Decides what saving one .ink file should do, given what Dinky wants to write,
// the text Dinky last read from or wrote to the file (its base), and what is
// on disk now. Pure, so the rules can be tested without Electron.
//
// Dinky only writes files it has changed. A file changed on disk since Dinky
// read it (a version-control update, another editor) must never be quietly
// overwritten with Dinky's older copy.

// Line endings and a leading byte-order mark don't count as changes: the
// editor writes "\n" whatever the file had.
export function sameText(a, b) {
    const norm = (s) => s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    return norm(a) === norm(b);
}

/**
 * @param {string} content - what Dinky would write
 * @param {string|undefined} base - text Dinky last read or wrote; undefined if unknown
 * @param {string|null} disk - text on disk now; null if the file doesn't exist
 * @returns {'write' | 'skip' | 'reload' | 'conflict'}
 *   write    - Dinky changed it and the disk copy hasn't moved: write it
 *   skip     - Dinky didn't change it and neither did anyone else: leave it
 *   reload   - Dinky didn't change it but the disk copy did: leave the file,
 *              and take the disk copy into Dinky
 *   conflict - both changed it (or it was deleted on disk): ask before writing
 */
export function planSave(content, base, disk) {
    if (base === undefined) return 'write'; // no baseline: behave as before
    const changedHere = !sameText(content, base);
    // A file deleted on disk (by version control, say) counts as changed there.
    const changedOnDisk = disk === null || !sameText(disk, base);
    if (!changedHere) {
        if (disk === null) return 'skip'; // don't bring back a file someone removed
        return changedOnDisk ? 'reload' : 'skip';
    }
    return changedOnDisk ? 'conflict' : 'write';
}
