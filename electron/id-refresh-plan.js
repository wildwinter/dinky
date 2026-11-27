// Pure planning for "Refresh Out-of-Date IDs": which audio files to rename
// when line IDs change. Kept free of Electron and file-system access so it can
// be tested directly; electron/id-refresh.js does the I/O.

import path from 'path';

export const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);

// The part of a file name after the line ID, if the file belongs to that ID.
// Matches the audio lookup's rule: the ID itself, or the ID followed by _, -
// or . (e.g. take numbers).
function suffixAfterId(baseName, id) {
    if (baseName === id) return '';
    for (const sep of ['_', '-', '.']) {
        if (baseName.startsWith(id + sep)) return baseName.substring(id.length);
    }
    return null;
}

/**
 * @param {Object<string, string[]>} folders - folder path to the file names in it
 * @param {Array<{oldId: string, newId: string}>} renames
 * @returns {{ moves: Array<{from, to}>, conflicts: Array<{from, to}> }}
 *   conflicts are renames whose target name is already taken; they are not moved.
 */
export function planAudioRenames(folders, renames) {
    const moves = [];
    const conflicts = [];
    for (const [folder, names] of Object.entries(folders)) {
        const taken = new Set(names);
        for (const name of names) {
            const ext = path.extname(name);
            if (!AUDIO_EXTENSIONS.has(ext.toLowerCase())) continue;
            const base = path.basename(name, ext);
            for (const { oldId, newId } of renames) {
                const suffix = suffixAfterId(base, oldId);
                if (suffix === null) continue;
                const target = newId + suffix + ext;
                const move = { from: path.join(folder, name), to: path.join(folder, target) };
                if (taken.has(target)) {
                    conflicts.push(move);
                } else {
                    taken.add(target);
                    moves.push(move);
                }
                break;
            }
        }
    }
    return { moves, conflicts };
}

/** Swaps old IDs for new in a re-record list, keeping order. */
export function renameIdsInList(ids, renames) {
    const map = new Map(renames.map(r => [r.oldId, r.newId]));
    return ids.map(id => map.get(id) ?? id);
}
