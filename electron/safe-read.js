import fs from 'fs/promises'
import { parse as parseJsonc, printParseErrorCode } from 'jsonc-parser'

/**
 * Read a text file, distinguishing "doesn't exist" from real failures.
 *
 * Returns one of:
 *   { kind: 'ok', content }     — file exists and was read successfully
 *   { kind: 'absent' }          — file does not exist (ENOENT)
 *   { kind: 'broken', error }   — file exists but couldn't be read (permission,
 *                                 IO error, locked by another process, etc.)
 *
 * The "broken" case is the dangerous one: don't fall back to a default and
 * then write it to disk — you'll overwrite the user's real file. Surface the
 * error and bail.
 */
export async function safeReadText(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf-8')
        return { kind: 'ok', content }
    } catch (e) {
        if (e.code === 'ENOENT') return { kind: 'absent' }
        return { kind: 'broken', error: e }
    }
}

/**
 * Read and parse a JSON file. Set { allowComments: true } for JSONC support
 * (strips // line comments and /* block comments *​/ before parsing).
 *
 * Returns one of:
 *   { kind: 'ok', data, raw }       — parsed successfully
 *   { kind: 'absent' }              — file does not exist
 *   { kind: 'broken', error, raw }  — file exists but couldn't be read or
 *                                     parsed; `raw` is the file content if a
 *                                     read succeeded (parse failure), or
 *                                     undefined if the read itself failed
 *
 * Same warning as safeReadText: never write back to a 'broken' file using a
 * default value — that's how the ENOENT-content bug happened.
 */
export async function safeReadJSON(filePath, { allowComments = false } = {}) {
    const r = await safeReadText(filePath)
    if (r.kind === 'absent') return r
    if (r.kind === 'broken') return r

    if (!allowComments) {
        try {
            return { kind: 'ok', data: JSON.parse(r.content), raw: r.content }
        } catch (e) {
            return { kind: 'broken', error: e, raw: r.content }
        }
    }

    // JSONC. Use a real parser rather than regex-stripping comments — a naive
    // /\/\/.*$/ strip also eats "//" *inside strings*, so a character note
    // containing a URL ("see http://wiki/bob") or an aside ("TODO // ask Sam")
    // would silently corrupt the file into unparseable JSON.
    const errors = []
    const data = parseJsonc(r.content, errors, { allowTrailingComma: true })

    if (errors.length > 0) {
        // jsonc-parser is lenient and can return a partial value alongside
        // errors. Treat any error as broken: we must never write back over a
        // file we didn't fully understand.
        const { error: code, offset } = errors[0]
        const reason = printParseErrorCode(code)
        return {
            kind: 'broken',
            error: new Error(`${reason} at offset ${offset}`),
            raw: r.content
        }
    }

    return { kind: 'ok', data, raw: r.content }
}
