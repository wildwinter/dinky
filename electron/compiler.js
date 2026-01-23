import path from 'path'
import fsSync from 'fs'
import inkjs from 'inkjs/full'

function createFileHandler(filePath, projectFiles) {
    // InkJS passes the same file handler to all included files. Per Ink spec,
    // ALL includes are relative to the ROOT file. Calculate the actual root.
    let projectRoot = filePath ? path.dirname(filePath) : process.cwd()

    // Find the common parent directory from all projectFiles
    if (projectFiles && Object.keys(projectFiles).length > 0) {
        const filePaths = Object.keys(projectFiles)
        const commonDir = filePaths.reduce((common, curr) => {
            if (!common) return path.dirname(curr)
            const commonParts = common.split(path.sep)
            const currParts = path.dirname(curr).split(path.sep)
            let i = 0
            while (i < commonParts.length && i < currParts.length && commonParts[i] === currParts[i]) {
                i++
            }
            return commonParts.slice(0, i).join(path.sep) || path.sep
        }, null)
        if (commonDir) projectRoot = commonDir
    }

    console.log('[createFileHandler] Using projectRoot:', projectRoot, 'for filePath:', filePath)

    return {
        ResolveInkFilename: (filename, ...args) => {
            console.log('[ResolveInkFilename] Called with filename:', filename, 'projectRoot:', projectRoot)

            // In Ink, ALL includes are relative to the root file, not the current file
            // Always resolve relative to projectRoot
            const resolvedPath = path.resolve(projectRoot, filename)

            // Helper to check if a path exists (in memory or on disk)
            const pathExists = (p) => {
                if (projectFiles && projectFiles[p]) return true
                try {
                    fsSync.accessSync(p)
                    return true
                } catch {
                    return false
                }
            }

            // Check if the root-relative path exists
            if (pathExists(resolvedPath)) {
                return resolvedPath
            }

            // If the filename contains path separators, it might be incorrectly pre-resolved
            // Try just the basename relative to root as a fallback
            if (filename.includes('/') || filename.includes('\\')) {
                const basename = path.basename(filename)
                const basenamePath = path.resolve(projectRoot, basename)
                if (pathExists(basenamePath)) {
                    return basenamePath
                }
            }

            // Return the originally resolved path as fallback (will fail in LoadInkFileContents)
            return resolvedPath
        },
        LoadInkFileContents: (filename) => {
            console.log('[LoadInkFileContents] Requested:', filename)
            console.log('[LoadInkFileContents] Available projectFiles keys:', projectFiles ? Object.keys(projectFiles) : 'none')

            // Try the filename as-is first
            if (projectFiles && projectFiles[filename]) {
                let val = projectFiles[filename]
                if (val && typeof val === 'string' && val.charCodeAt(0) === 0xFEFF) {
                    val = val.slice(1)
                }
                console.log('[LoadInkFileContents] Found in projectFiles (exact match)')
                return val
            }

            // If not found, this might be a path relative to projectRoot that wasn't resolved correctly
            // Try resolving it from projectRoot
            const basename = path.basename(filename)
            const rootRelativePath = path.resolve(projectRoot, basename)
            console.log('[LoadInkFileContents] Trying projectRoot-relative:', rootRelativePath)

            if (projectFiles && projectFiles[rootRelativePath]) {
                let val = projectFiles[rootRelativePath]
                if (val && typeof val === 'string' && val.charCodeAt(0) === 0xFEFF) {
                    val = val.slice(1)
                }
                console.log('[LoadInkFileContents] Found via projectRoot resolution')
                return val
            }

            // Last resort: search by basename, but warn if ambiguous
            if (projectFiles) {
                const matches = Object.entries(projectFiles).filter(([filePath]) =>
                    path.basename(filePath) === basename
                )

                if (matches.length === 1) {
                    const [matchedPath, content] = matches[0]
                    let val = content
                    if (val && typeof val === 'string' && val.charCodeAt(0) === 0xFEFF) {
                        val = val.slice(1)
                    }
                    console.log('[LoadInkFileContents] Found by basename (unique match):', matchedPath)
                    return val
                } else if (matches.length > 1) {
                    console.error('[LoadInkFileContents] AMBIGUOUS: Multiple files named', basename)
                    console.error('[LoadInkFileContents] Matches:', matches.map(([p]) => p))
                    console.error('[LoadInkFileContents] Using first match (this may be incorrect!)')
                    const [matchedPath, content] = matches[0]
                    let val = content
                    if (val && typeof val === 'string' && val.charCodeAt(0) === 0xFEFF) {
                        val = val.slice(1)
                    }
                    return val
                }
            }

            // Try original path on filesystem
            try {
                const content = fsSync.readFileSync(filename, 'utf-8')
                console.log('[LoadInkFileContents] Found on filesystem (original path)')
                return content
            } catch (e) {
                console.error('Failed to load included file:', filename, e)
                return ''
            }
        }
    }
}

function removeBOM(content) {
    if (content && typeof content === 'string' && content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    return content;
}



function createCompilerOptions(filePath, errorHandler, fileHandler) {
    if (inkjs.CompilerOptions) {
        return new inkjs.CompilerOptions(
            filePath, // sourceFilename
            [],       // pluginNames
            false,    // countAllVisits
            errorHandler,
            fileHandler
        )
    } else {
        return {
            sourceFilename: filePath,
            fileHandler,
            errorHandler
        }
    }
}

function prepareCompiler(content, filePath, projectFiles, errorHandler) {
    const fileHandler = createFileHandler(filePath, projectFiles);
    const options = createCompilerOptions(filePath, errorHandler, fileHandler);
    return new inkjs.Compiler(content, options);
}

async function compileInk(content, filePath, projectFiles = {}) {
    content = removeBOM(content);

    const collectedErrors = []
    let parseError = null

    try {
        const errorHandler = (message, errorType) => {
            collectedErrors.push(message)
        }

        const compiler = prepareCompiler(content, filePath, projectFiles, errorHandler);
        compiler.Compile()
    } catch (error) {
        if (collectedErrors.length === 0) {
            console.error('Compilation failed (unexpected):', error)
        }
        parseError = error
    }

    // Map errors to Monaco format
    const errors = collectedErrors.map(errStr => {
        const severity = errStr.includes('WARNING') ? 4 : 8 // 4=Warning, 8=Error
        const parts = errStr.match(/^(?:(?:ERROR|WARNING): )?(?:'([^']+)' )?line (\d+): (.+)/i)

        if (parts) {
            const [, errFilePath, lineStr, msg] = parts
            const line = parseInt(lineStr)
            return {
                startLineNumber: line,
                endLineNumber: line,
                startColumn: 1,
                endColumn: 1000,
                message: msg,
                severity,
                filePath: errFilePath || null
            }
        }

        return {
            startLineNumber: 1,
            endLineNumber: 1,
            startColumn: 1,
            endColumn: 1000,
            message: errStr,
            severity,
            filePath: null
        }
    })

    // Custom Safety Check: Duplicate IDs on a single line
    const lines = content.split(/\r?\n/)
    lines.forEach((line, index) => {
        const idMatches = line.match(/#id:/g);
        if (idMatches && idMatches.length > 1) {
            errors.push({
                startLineNumber: index + 1,
                endLineNumber: index + 1,
                startColumn: 1,
                endColumn: 1000,
                message: "Multiple ID tags found on this line. Only one ID per line is allowed.",
                severity: 8,
                filePath: filePath
            });
        }
    });

    if (errors.length > 0) return errors

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
    content = removeBOM(content);

    const collectedErrors = []

    const errorHandler = (message) => {
        collectedErrors.push(message)
    }

    const compiler = prepareCompiler(content, filePath, projectFiles, errorHandler);
    const story = compiler.Compile()

    if (collectedErrors.length > 0) {
        // Log errors but continue if possible
        console.error('Story compilation warnings/errors:', collectedErrors);
    }

    // Checks if the compilation succeeded
    if (!story) {
        throw new Error("Compilation failed: " + collectedErrors.join('\n'))
    }

    return story.ToJson()
}

function parseInk(content, filePath, projectFiles = {}) {
    content = removeBOM(content);

    // Silent error handler for parsing - we don't want to spam console for every keystroke
    const errorHandler = (msg, type) => { };

    const compiler = prepareCompiler(content, filePath, projectFiles, errorHandler);

    try {
        // Compile populates _parsedStory
        compiler.Compile();
    } catch (e) {
        // Ignore compilation errors, we just want the AST
    }

    return compiler._parsedStory;
}

export {
    compileInk,
    compileStory,
    parseInk
}
