/**
 * Tokenizer rules and language definitions for Ink syntax highlighting
 * Defines Monaco language syntax rules for both standard Ink and Dinky dialogue
 */

/**
 * Common tokenizer states used by both Ink variants
 */
export const commonInkStates = {
    codeMode: [
        // Continuation line (ends with , or =) with trailing comment — stay in codeMode
        [/([^/*]*[,=]\s*)(\/\/.*)$/, ['code', 'comment']],
        // Comment-only line — stay in codeMode (we're mid-continuation)
        [/^\s*\/\/.*$/, 'comment'],
        [/\/\/.*$/, 'comment', '@pop'],
        [/\/\*/, 'comment', '@comment'],
        // Stay in codeMode if line ends with comma or = (multi-line LIST, etc.)
        [/[^/*]*[,=]\s*$/, 'code'],
        // Blank/whitespace lines between continuation entries — stay in codeMode
        [/^\s*$/, 'code'],
        [/[^/*]+$/, 'code', '@pop'],
        [/\/(?!\/|\*)$/, 'code', '@pop'],
        [/\*(?!\/)$/, 'code', '@pop'],
        [/[^/*]+/, 'code'],
        [/\//, 'code'],
        [/\*/, 'code'],
        [/$/, 'code', '@pop']
    ],
    tagMode: [
        [/\/\/.*$/, 'comment', '@pop'],
        [/\/\*/, 'comment', '@comment'],
        [/\]/, '@rematch', '@pop'],
        [/[^\]\/]+$/, 'annotation', '@pop'],
        [/\/(?!\/|\*)$/, 'annotation', '@pop'],
        [/[^\]\/]+/, 'annotation'],
        [/\/(?!\/|\*)/, 'annotation'],
        [/$/, 'annotation', '@pop']
    ],
    comment: [
        [/[^\/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[\/*]/, 'comment']
    ],
    braceBlock: [
        // Exit on closing brace
        [/^[^\{]*\}\s*$/, 'code', '@pop'],
        // Condition/expression lines: - expression: (identifiers + operators, no prose)
        [/^\s*-\s*[\w.]+(?:\s*[><=!&|]+\s*[\w.]+)*\s*:/, 'code'],
        // Parenthesized conditions: - (expression) with optional colon
        [/^\s*-\s*\([^)]*\)\s*:?\s*$/, 'code'],
        // else branches
        [/^\s*-\s*else\s*:/, 'code'],
    ]
};

/**
 * Standard Ink language rules (shared between both variants)
 */
export const standardInkRules = [
    // Comments (Top priority)
    [/\/\/.*$/, 'comment'],
    [/\/\*/, 'comment', '@comment'],

    // Code Lines - Solitary
    [/^\s*~$/, 'code'],
    [/^\s*(?:INCLUDE|VAR|CONST|LIST)$/, 'code'],

    // Code Lines - Start
    [/^\s*(?:INCLUDE|VAR|CONST|LIST)\b/, 'code', '@codeMode'],
    [/^\s*~/, 'code', '@codeMode'],

    // Code Blocks
    [/^\s*\{[^}]*$/, 'code', '@braceBlock'],
    [/^[^\{]*\}\s*$/, 'code'],
    [/\{[^\{\}]*\}/, 'code'],

    // Diverts
    [/->\s*[\w_\.]+/, 'keyword'],

    // Stitches (= Name) - Knots handled by state machine or root override
    [/^=\s*\w+/, 'type.identifier'],

    // Choices with optional label
    [/^([\*\+]+\s*)(\(\w+\))/, ['keyword', 'code']],
    [/^[\*\+]+/, 'keyword'],

    // Gather points with optional label
    [/^(\s*-\s*)(\(\w+\))/, ['keyword', 'code']],
    [/^\-/, 'keyword'],

    // Tags
    [/#(?=$)/, 'annotation'],
    [/#/, 'annotation', '@tagMode'],

    // Logic
    [/[{}]/, 'delimiter.bracket'],
    [/\w+(?=\()/, 'function'],
];

/**
 * Regex patterns for Dinky dialogue line detection
 * Used to highlight character names, qualifiers, directions, and dialogue text
 */
export const dinkyDialogueRule = [
    // NAME (qual): (dir) Text
    /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/,
    ['white', 'dinky.name', 'white', 'dinky.qualifier', 'white', 'delimiter', 'white', 'dinky.direction', 'white', 'dinky.text']
];

export const dinkyDialogueGatherRule = [
    // - NAME (qual): (dir) Text
    /^(\s*)(-)(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/,
    ['white', 'keyword', 'white', 'dinky.name', 'white', 'dinky.qualifier', 'white', 'delimiter', 'white', 'dinky.direction', 'white', 'dinky.text']
];

export const dinkyDialogueBracketedRule = [
    // * [NAME (qual): (dir) Text
    /^(\s*)([\*\+-]+)(\s*)(\[)(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^\]/#]|\/(?![/*]))*)/,
    ['white', 'keyword', 'white', 'delimiter.bracket', 'white', 'dinky.name', 'white', 'dinky.qualifier', 'white', 'delimiter', 'white', 'dinky.direction', 'white', 'dinky.text']
];

/**
 * Define Monaco themes for Dinky editor
 * @param {typeof import('monaco-editor')} monaco
 */
export function defineThemes(monaco) {
    monaco.editor.defineTheme('dinky-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'code', foreground: 'C586C0' }, // Magenta
            { token: 'dinky.name', foreground: 'D7BA7D' }, // Gold
            { token: 'dinky.qualifier', foreground: '6A9955', fontStyle: 'italic' }, // Green Italic
            { token: 'dinky.direction', foreground: '569CD6', fontStyle: 'italic' }, // Blue Italic
            { token: 'dinky.text', foreground: '9CDCFE' }, // Light Blue
        ],
        colors: {}
    });

    monaco.editor.defineTheme('dinky-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'code', foreground: '800080' }, // Purple
            { token: 'dinky.name', foreground: '795E26' }, // Dark Gold
            { token: 'dinky.qualifier', foreground: '008000', fontStyle: 'italic' }, // Green Italic
            { token: 'dinky.direction', foreground: '0000FF', fontStyle: 'italic' }, // Blue Italic
            { token: 'dinky.text', foreground: '001080' }, // Dark Blue
        ],
        colors: {}
    });
}

/**
 * Register Ink language providers with Monaco
 * @param {typeof import('monaco-editor')} monaco
 */
export function registerInkLanguage(monaco) {
    monaco.languages.register({ id: 'ink' });
    monaco.languages.register({ id: 'ink-dinky' });

    // Ink Dinky (Global Mode)
    monaco.languages.setMonarchTokensProvider('ink-dinky', {
        tokenizer: {
            root: [
                dinkyDialogueBracketedRule,
                dinkyDialogueGatherRule,
                dinkyDialogueRule,
                // Knot Header - simple highlight, no state reset in global mode
                [/^\s*={2,}.*$/, 'type.identifier'],
                ...standardInkRules
            ],
            ...commonInkStates,
            // Extend braceBlock with standard + dinky rules for content lines
            braceBlock: [
                ...commonInkStates.braceBlock,
                dinkyDialogueBracketedRule,
                dinkyDialogueGatherRule,
                dinkyDialogueRule,
                ...standardInkRules
            ]
        }
    });

    // Standard Ink (Stateful)
    monaco.languages.setMonarchTokensProvider('ink', {
        defaultToken: '',
        tokenizer: {
            root: [
                { include: 'normalMode' }
            ],
            knotStart: [
                // Check for #dink (handles optional leading whitespace)
                [/\s*#\s*dink(?=\s|$)/, { token: 'annotation', next: '@dinkyMode' }],
                // Comments with optional leading whitespace — stay in knotStart
                [/\s*\/\/.*$/, 'comment'],
                [/\s*\/\*/, 'comment', '@comment'],
                // Transition to normal on anything else (including whitespace-only lines)
                [/./, { token: '@rematch', next: '@normalMode' }]
            ],
            dinkyMode: [
                // Knot -> Reset to knotStart
                [/^\s*={2,}.*$/, { token: 'type.identifier', next: '@knotStart' }],
                dinkyDialogueBracketedRule,
                dinkyDialogueGatherRule,
                dinkyDialogueRule,
                ...standardInkRules
            ],
            normalMode: [
                // Knot -> Reset to knotStart
                [/^\s*={2,}.*$/, { token: 'type.identifier', next: '@knotStart' }],
                ...standardInkRules
            ],
            ...commonInkStates,
            // Extend braceBlock with dinky + standard rules for content lines
            braceBlock: [
                ...commonInkStates.braceBlock,
                dinkyDialogueBracketedRule,
                dinkyDialogueGatherRule,
                dinkyDialogueRule,
                ...standardInkRules
            ]
        }
    });
}
