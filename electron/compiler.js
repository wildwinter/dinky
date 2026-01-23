import path from 'path'
import fsSync from 'fs'
import inkjs from 'inkjs/full'

function createFileHandler(filePath, projectFiles) {
    return {
        ResolveInkFilename: (filename) => {
            const baseDir = filePath ? path.dirname(filePath) : process.cwd()
            return path.resolve(baseDir, filename)
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
