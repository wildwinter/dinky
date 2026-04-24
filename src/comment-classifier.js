/**
 * Dink comment type classifier for Monaco hover tooltips.
 * Classifies // comment lines as Scene, Block, Group, Beat, Snippet, or Option comments.
 */

const RE_SNIPPET_COMMENT = /^\s*-\s*\/\//;
const RE_STANDALONE_COMMENT = /^\s*\/\//;
const RE_KNOT = /^\s*={2,}/;
const RE_STITCH = /^\s*=(?!=)\s*\w/;
const RE_GROUP_OPEN = /^\s*\{(?:shuffle|once|stopping)\s*:/i;
const RE_DINK_TAG = /#\s*dink(?=\s|$)/;
const RE_CHOICE_WITH_BRACKET = /^\s*[\*\+]+[^[]*\[[^\]]*\]/;

function lineRole(text) {
    const t = text.trim();
    if (t === '') return 'blank';
    if (RE_SNIPPET_COMMENT.test(t)) return 'snippet-comment';
    if (RE_STANDALONE_COMMENT.test(t)) return 'comment';
    if (RE_KNOT.test(t)) return 'knot';
    if (RE_STITCH.test(t)) return 'stitch';
    if (RE_GROUP_OPEN.test(t)) return 'group-open';
    return 'content';
}

/**
 * Returns the 0-based column index of // on a line (skipping /* block comments), or -1.
 */
export function findLineCommentStart(text) {
    let inBlock = false;
    for (let i = 0; i < text.length - 1; i++) {
        if (inBlock) {
            if (text[i] === '*' && text[i + 1] === '/') { inBlock = false; i++; }
        } else if (text[i] === '/' && text[i + 1] === '*') {
            inBlock = true; i++;
        } else if (text[i] === '/' && text[i + 1] === '/') {
            return i;
        }
    }
    return -1;
}

// Returns true if the knot at knotLine (0-indexed) is followed by #dink before any real content.
function knotIsDink(lines, knotLine) {
    if (RE_DINK_TAG.test(lines[knotLine])) return true;
    for (let i = knotLine + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === '') continue;
        if (RE_KNOT.test(t)) return false;
        if (RE_STANDALONE_COMMENT.test(t) || RE_SNIPPET_COMMENT.test(t)) continue;
        if (RE_DINK_TAG.test(lines[i])) return true;
        return false;
    }
    return false;
}

// Returns the 0-indexed line of the nearest enclosing knot, or -1.
function enclosingKnot(lines, lineIndex) {
    for (let i = lineIndex - 1; i >= 0; i--) {
        if (RE_KNOT.test(lines[i].trim())) return i;
    }
    return -1;
}

// Scans forward from lineIndex to determine the type of a standalone comment.
// Returns { type, targetLine } where targetLine is 0-indexed (-1 at EOF).
function forwardScan(lines, lineIndex) {
    let blankCount = 0;
    let hadExcessBlanks = false;

    for (let j = lineIndex + 1; j < lines.length; j++) {
        const role = lineRole(lines[j]);
        switch (role) {
            case 'blank':
                blankCount++;
                if (blankCount > 1) hadExcessBlanks = true;
                break;
            case 'comment':
            case 'snippet-comment':
                blankCount = 0;
                break;
            case 'knot':
                return { type: hadExcessBlanks ? 'Beat Comment' : 'Scene Comment', targetLine: j };
            case 'stitch':
                return { type: hadExcessBlanks ? 'Beat Comment' : 'Block Comment', targetLine: j };
            case 'group-open':
                return { type: hadExcessBlanks ? 'Beat Comment' : 'Group Comment', targetLine: j };
            default:
                return { type: 'Beat Comment', targetLine: j };
        }
    }
    return { type: 'Beat Comment', targetLine: -1 };
}

// Classifies the inline // comment on a line that has non-comment content before //.
function classifyInlineComment(text) {
    const t = text.trim();
    if (RE_KNOT.test(t)) return 'Scene Comment';
    if (RE_STITCH.test(t)) return 'Block Comment';
    if (RE_GROUP_OPEN.test(t)) return 'Group Comment';
    if (RE_CHOICE_WITH_BRACKET.test(t)) return 'Option Comment';
    return 'Beat Comment';
}

/**
 * Classify the Dink comment type at a given line.
 *
 * @param {string[]} lines       - File lines, 0-indexed
 * @param {number}   lineIndex   - 0-based line to classify
 * @param {number}   columnIndex - 0-based column of the hover position
 * @param {boolean}  isDinkyGlobal - True when the file is in ink-dinky mode (classify all)
 * @returns {string|null} Comment type label, or null if not a classified comment here.
 */
export function classifyCommentAtLine(lines, lineIndex, columnIndex, isDinkyGlobal) {
    if (lineIndex < 0 || lineIndex >= lines.length) return null;

    const text = lines[lineIndex];
    const commentStart = findLineCommentStart(text);
    if (commentStart < 0 || columnIndex < commentStart) return null;

    const role = lineRole(text);
    let type;

    if (role === 'snippet-comment') {
        type = 'Snippet Comment';
        if (!isDinkyGlobal) {
            const knotLine = enclosingKnot(lines, lineIndex);
            if (knotLine < 0 || !knotIsDink(lines, knotLine)) return null;
        }
    } else if (role === 'comment') {
        const result = forwardScan(lines, lineIndex);
        type = result.type;

        if (!isDinkyGlobal) {
            if (type === 'Scene Comment') {
                if (result.targetLine < 0 || !knotIsDink(lines, result.targetLine)) return null;
            } else {
                const knotLine = enclosingKnot(lines, lineIndex);
                if (knotLine < 0 || !knotIsDink(lines, knotLine)) return null;
            }
        }
    } else {
        // Inline comment on a structured line (knot, stitch, group, dialogue, etc.)
        type = classifyInlineComment(text);

        if (!isDinkyGlobal) {
            if (type === 'Scene Comment') {
                if (!knotIsDink(lines, lineIndex)) return null;
            } else {
                const knotLine = enclosingKnot(lines, lineIndex);
                if (knotLine < 0 || !knotIsDink(lines, knotLine)) return null;
            }
        }
    }

    return type;
}
