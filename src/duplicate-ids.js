// Finds line IDs (#id:...) used on more than one line across a project, and
// decides which line keeps each one.
//
// A duplicated ID is not harmless: the compiler keys lines by ID, so the
// recording script, localisation and runtime strings keep one line's text and
// silently drop the other. Duplicates arrive when a line is copied with its
// ID (Show IDs, another editor, a copied file), so we resolve them lazily
// from the file text alone.
//
// Pure: no editor, Electron or file-system access, so the main process (auto
// tagger) and the renderer (paste handling) share it.

const ID_TAG = /#id:([a-zA-Z0-9_-]+_[a-zA-Z0-9]{4})\b/g;

/** File-name part of an ID prefix, matching the tagger's rule. */
export function filePrefixFor(filePath) {
    const base = filePath.split(/[\\/]/).pop().replace(/\.ink$/i, '');
    return base.replace(/[^a-zA-Z0-9-]/g, '');
}

/**
 * Lists every ID tag in one file's text, ignoring commented-out text (the
 * compiler ignores it too), with the prefix a fresh ID would get on that line.
 * @returns {Array<{file: string, line: number, id: string, prefix: string}>}
 *   line is 1-based.
 */
export function scanIds(filePath, text) {
    const out = [];
    const filePrefix = filePrefixFor(filePath);
    let knot = '';
    let stitch = '';
    let inBlockComment = false;

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        // Strip comments, carrying /* ... */ across lines.
        let line = lines[i];
        let code = '';
        let pos = 0;
        while (pos < line.length) {
            if (inBlockComment) {
                const end = line.indexOf('*/', pos);
                if (end === -1) { pos = line.length; break; }
                inBlockComment = false;
                pos = end + 2;
                continue;
            }
            const block = line.indexOf('/*', pos);
            const lineComment = line.indexOf('//', pos);
            if (lineComment !== -1 && (block === -1 || lineComment < block)) {
                code += line.substring(pos, lineComment);
                pos = line.length;
            } else if (block !== -1) {
                code += line.substring(pos, block);
                inBlockComment = true;
                pos = block + 2;
            } else {
                code += line.substring(pos);
                pos = line.length;
            }
        }

        const trimmed = code.trim();
        const knotMatch = /^={2,}\s*(?:function\s+)?([A-Za-z0-9_]+)/.exec(trimmed);
        if (knotMatch) {
            knot = knotMatch[1];
            stitch = '';
            continue;
        }
        const stitchMatch = /^=\s*([A-Za-z0-9_]+)/.exec(trimmed);
        if (stitchMatch) {
            stitch = stitchMatch[1];
            continue;
        }

        ID_TAG.lastIndex = 0;
        const m = ID_TAG.exec(code);
        if (m) {
            const prefix = filePrefix + '_' + (knot ? knot + '_' : '') + (stitch ? stitch + '_' : '');
            out.push({ file: filePath, line: i + 1, id: m[1], prefix });
        }
    }
    return out;
}

// An ID "belongs" where it sits if it is exactly that line's prefix plus the
// four-character code: i.e. the line hasn't been moved or copied elsewhere.
function belongsHere(occ) {
    return occ.id.length === occ.prefix.length + 4 && occ.id.startsWith(occ.prefix);
}

function byFileThenLine(a, b) {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line;
}

/**
 * Finds every line whose ID is also used on another line, other than the one
 * line allowed to keep it. The keeper is the occurrence whose ID matches where
 * it sits (first by file path then line if several do); if none matches, the
 * first by file path then line. The choice depends only on the files' text, so
 * it comes out the same whichever file is open.
 *
 * @param {Object<string, string>} files - path to text (with #id: tags)
 * @returns {{ losers: Array<{file, line, id, prefix}>, allIds: Set<string> }}
 */
export function findDuplicateIds(files) {
    const byId = new Map();
    const allIds = new Set();
    for (const [filePath, text] of Object.entries(files)) {
        if (typeof text !== 'string') continue;
        for (const occ of scanIds(filePath, text)) {
            allIds.add(occ.id);
            if (!byId.has(occ.id)) byId.set(occ.id, []);
            byId.get(occ.id).push(occ);
        }
    }

    const losers = [];
    for (const occs of byId.values()) {
        if (occs.length < 2) continue;
        occs.sort(byFileThenLine);
        const keeper = occs.find(belongsHere) || occs[0];
        for (const occ of occs) {
            if (occ !== keeper) losers.push(occ);
        }
    }
    losers.sort(byFileThenLine);
    return { losers, allIds };
}

/** Replaces the first #id:oldId on a line with #id:newId. */
export function replaceIdInLine(lineText, oldId, newId) {
    const tag = '#id:' + oldId;
    const at = lineText.indexOf(tag);
    if (at === -1) return null;
    return lineText.substring(0, at) + '#id:' + newId + lineText.substring(at + tag.length);
}

/**
 * Lines in one file whose ID doesn't match where the line now sits, i.e. the
 * line was moved from another knot, stitch or file and kept its old ID.
 * @returns {Array<{file, line, id, prefix}>} prefix is what a fresh ID needs.
 */
export function findStaleIds(filePath, text) {
    return scanIds(filePath, text).filter(occ => !belongsHere(occ));
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * A fresh ID for the prefix that isn't in `taken`, which it is then added to.
 * Returns "" if none could be found (limited attempts, to prevent infinite loops).
 */
export function mintUniqueId(prefix, taken) {
    for (let i = 0; i < 100; i++) {
        let code = '';
        for (let c = 0; c < 4; c++) code += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length));
        const candidate = prefix + code;
        if (!taken.has(candidate)) {
            taken.add(candidate);
            return candidate;
        }
    }
    return '';
}
