import path from 'path'
import fsSync from 'fs'
import inkjs from 'inkjs/full'

async function compileInk(content, filePath, projectFiles = {}) {
    // Strip BOM from main content
    if (content && typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    // console.log('Compiler: Compiling', filePath)
    const collectedErrors = []
    let parseError = null

    try {
        const fileHandler = {
            ResolveInkFilename: (filename) => {
                const baseDir = filePath ? path.dirname(filePath) : process.cwd()
                const resolved = path.resolve(baseDir, filename)
                return resolved
            },
            LoadInkFileContents: (filename) => {
                // Check memory cache first (supports unsaved changes)
                if (projectFiles && projectFiles[filename]) {
                    let val = projectFiles[filename]
                    if (val && typeof val === 'string' && val.charCodeAt(0) === 0xFEFF) {
                        val = val.slice(1)
                    }
                    return val
                }

                try {
                    return fsSync.readFileSync(filename, 'utf-8')
                } catch (e) {
                    console.error('Failed to load included file:', filename, e)
                    return ''
                }
            }
        }

        const errorHandler = (message, errorType) => {
            collectedErrors.push(message)
        }

        // Use CompilerOptions class if available to ensure correct structure
        let options
        if (inkjs.CompilerOptions) {
            options = new inkjs.CompilerOptions(
                filePath, // sourceFilename passed for better context
                [],   // pluginNames
                false, // countAllVisits
                errorHandler,
                fileHandler
            )
        } else {
            options = {
                sourceFilename: filePath,
                fileHandler,
                errorHandler
            }
        }

        const compiler = new inkjs.Compiler(content, options)
        compiler.Compile()
    } catch (error) {
        if (collectedErrors.length === 0) {
            console.error('Compilation failed (unexpected):', error)
        }
        parseError = error
    }

    const errors = []

    // Process explicitly collected errors
    if (collectedErrors.length > 0) {
        collectedErrors.forEach(errStr => {
            // Determine severity (simple heuristic or default to Error)
            const severity = errStr.includes('WARNING') ? 4 : 8 // 4=Warning, 8=Error

            // Parse error string: "ERROR: 'path' line X: message" or "Line X: message"
            const parts = errStr.match(/^(?:ERROR: )?(?:'([^']+)' )?line (\d+): (.+)/i)

            if (parts) {
                const errFilePath = parts[1] || null // Capture file path if present
                const line = parseInt(parts[2])
                const msg = parts[3]

                errors.push({
                    startLineNumber: line,
                    endLineNumber: line,
                    startColumn: 1,
                    endColumn: 1000,
                    message: msg,
                    severity: severity,
                    filePath: errFilePath
                })
            } else {
                errors.push({
                    startLineNumber: 1,
                    endLineNumber: 1,
                    startColumn: 1,
                    endColumn: 1000,
                    message: errStr,
                    severity: severity,
                    filePath: null
                })
            }
        })
    }

    // If we found explicit compiler errors, return them
    if (errors.length > 0) {
        return errors
    }

    // Fallback if no errors collected but crashed
    if (parseError) {
        // Heuristic: Check for common crash causes
        let errorLine = 1
        let errorMsg = 'Compiler Error: ' + parseError.message

        if (parseError.message.includes('not a function') || parseError.message.includes('undefined')) {
            const lines = content.split(/\r?\n/)
            for (let i = 0; i < lines.length; i++) {
                // Known crash: bare '~'
                if (lines[i].trim() === '~') {
                    errorLine = i + 1
                    errorMsg = "Syntax Error: Incomplete logic line. '~' must be followed by code."
                    break
                }
            }
        }

        return [{
            startLineNumber: errorLine,
            endLineNumber: errorLine,
            startColumn: 1,
            endColumn: 1000,
            message: errorMsg,
            severity: 8
        }]
    }

    return []
}

async function compileStory(content, filePath, projectFiles = {}) {
    if (content && typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }

    const collectedErrors = []

    // File Handler (Same as compileInk)
    const fileHandler = {
        ResolveInkFilename: (filename) => {
            const baseDir = filePath ? path.dirname(filePath) : process.cwd()
            const resolved = path.resolve(baseDir, filename)
            return resolved
        },
        LoadInkFileContents: (filename) => {
            if (projectFiles && projectFiles[filename]) {
                let val = projectFiles[filename]
                if (val && typeof val === 'string' && val.charCodeAt(0) === 0xFEFF) {
                    val = val.slice(1)
                }
                return val
            }
            try {
                return fsSync.readFileSync(filename, 'utf-8')
            } catch (e) {
                console.error('Failed to load included file:', filename, e)
                return ''
            }
        }
    }

    // Capture errors to throw if needed
    const errorHandler = (message, errorType) => {
        collectedErrors.push(message)
    }

    let options
    if (inkjs.CompilerOptions) {
        options = new inkjs.CompilerOptions(
            filePath,
            [],
            false,
            errorHandler,
            fileHandler
        )
    } else {
        options = {
            sourceFilename: filePath,
            fileHandler,
            errorHandler
        }
    }

    const compiler = new inkjs.Compiler(content, options)
    const story = compiler.Compile()

    if (collectedErrors.length > 0) {
        // Filter for actual errors (severity 8 usually, or just assuming all are blocking for now if compiler fails? 
        // inkjs often continues after errors. But we probably shouldn't run if there are errors.)
        // But usually warnings are fine.
        // Let's check if story was produced.
        // If compiler.Compile returns a story, it might be valid.
    }

    // Checks if the compilation succeeded
    if (!story) {
        throw new Error("Compilation failed: " + collectedErrors.join('\n'))
    }

    return story.ToJson()
}

export {
    compileInk,
    compileStory
}
