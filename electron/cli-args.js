/**
 * Command-line argument helpers.
 *
 * Kept separate from main.js so the parsing is unit-testable without
 * booting Electron (see test/cli-args.test.mjs).
 */

/**
 * Extract the `--goto` target from an argv-style array.
 *
 * Accepts both forms:
 *   --goto some_A1B2
 *   --goto=myKnot.myStitch
 *
 * The target is deliberately untyped here - disambiguating "line ID" from
 * "knot/stitch path" needs the loaded project, so that happens in the
 * renderer. See resolveGotoTarget() in src/renderer.js.
 *
 * @param {string[]} argv
 * @returns {string|null} the target, or null if absent/empty
 */
export function parseGotoTarget(argv = []) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];

        if (arg === '--goto') {
            const value = argv[i + 1];
            // Guard against `--goto --someotherflag` consuming the next flag.
            if (!value || value.startsWith('--')) return null;
            return value.trim() || null;
        }

        if (arg.startsWith('--goto=')) {
            return arg.slice('--goto='.length).trim() || null;
        }
    }
    return null;
}
