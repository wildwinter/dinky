export class IdPreservationManager {
    constructor(editor, monaco) {
        this.editor = editor;
        this.monaco = monaco;
        // Map<DecorationId, InkIdString>
        this.decorationToId = new Map();
        // We use a specific decoration key to track our IDs
        this.decorationCollection = editor.createDecorationsCollection();

        // Listen for clicks on the glyph margin
        this.editor.onMouseDown((e) => {
            if (e.target.type === this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                const lineNumber = e.target.position.lineNumber;
                const model = this.editor.getModel();
                if (!model) return;

                // Check for our decorations on this line
                const decorations = model.getLineDecorations(lineNumber);
                for (const dec of decorations) {
                    // We can check if this decoration ID matches one of ours
                    if (this.decorationToId.has(dec.id)) {
                        const inkId = this.decorationToId.get(dec.id);

                        // Copy to clipboard
                        navigator.clipboard.writeText(inkId).then(() => {
                            // Visual Feedback
                            const oldOptions = dec.options;
                            const copyIconUrl = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%234caf50%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%2220%206%209%2017%204%2012%22%2F%3E%3C%2Fsvg%3E';

                            const copiedMessage = {
                                value: `![copied](${copyIconUrl}) **COPIED** \`${inkId}\``,
                                isTrusted: true,
                                supportHtml: true
                            };

                            const newDec = {
                                range: dec.range,
                                options: {
                                    ...oldOptions,
                                    glyphMarginHoverMessage: copiedMessage
                                }
                            };

                            const newIds = this.editor.deltaDecorations([dec.id], [newDec]);
                            const newId = newIds[0];
                            this.decorationToId.delete(dec.id);
                            this.decorationToId.set(newId, inkId);

                            setTimeout(() => {
                                if (this.decorationToId.has(newId)) {
                                    const resetDec = {
                                        range: dec.range,
                                        options: this._getDecorationOptions(inkId)
                                    };
                                    // Refresh range
                                    const currentRange = model.getDecorationRange(newId);
                                    if (currentRange) {
                                        resetDec.range = currentRange;
                                        const resetIds = this.editor.deltaDecorations([newId], [resetDec]);
                                        this.decorationToId.delete(newId);
                                        this.decorationToId.set(resetIds[0], inkId);
                                    }
                                }
                            }, 1500);
                        });
                        return;
                    }
                }
            }
        });

        // Listen for clicks inside the Tooltip (Document Click)
        this._tooltipClickHandler = (e) => {
            const hover = e.target.closest('.monaco-hover');
            if (!hover) return;

            const text = hover.innerText.trim();
            const idRegex = /([a-zA-Z0-9_]+_[a-zA-Z0-9]{4})/;
            const match = text.match(idRegex);

            if (match) {
                const inkId = match[0];
                navigator.clipboard.writeText(inkId).then(() => {
                    console.log('Copied Tooltip ID:', inkId);

                    // Visual Feedback in DOM
                    const contentValues = hover.querySelectorAll('span, p, div');
                    contentValues.forEach(el => {
                        el.style.color = '#4caf50';
                        el.style.transition = 'color 0.2s';
                    });

                    const img = hover.querySelector('img');
                    if (img) {
                        img.src = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%234caf50%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Cpolyline%20points%3D%2220%206%209%2017%204%2012%22%2F%3E%3C%2Fsvg%3E';
                    }
                });
            }
        };

        document.addEventListener('click', this._tooltipClickHandler);
    }

    dispose() {
        if (this._tooltipClickHandler) {
            document.removeEventListener('click', this._tooltipClickHandler);
        }
    }

    /**
     * Parse the raw file content, separating ID tags from the text.
     * Returns the "clean" content for the editor and the extracted IDs.
     */
    extractIds(content) {
        const lines = content.split(/\r?\n/);
        const extractedIds = []; // { lineIndex, id }
        const cleanLines = [];

        // Global Regex to find #id:XXXX_XXXX
        // Format: #id: + (alphanum+underscores) + _ + 4 alphanum
        // We look for this pattern anywhere in the line.
        // We capture:
        // 1. Optional whitespace before the tag (to strip it cleanly)
        // 2. The tag itself
        const idRegex = /(\s?)#id:([a-zA-Z0-9_]+_[a-zA-Z0-9]{4})\b/g;

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let match;

            // Reset regex
            idRegex.lastIndex = 0;
            const matches = [];
            while ((match = idRegex.exec(line)) !== null) {
                matches.push(match);
            }

            if (matches.length > 0) {
                const targetMatch = matches[0];

                const fullMatchStr = targetMatch[0];
                const leadingSpace = targetMatch[1];
                const idPart = targetMatch[2];

                extractedIds.push({
                    lineIndex: i,
                    id: idPart
                });

                // Remove it from the line
                // We construct the "Clean" line by removing the matched text.
                // Note: We strip the leading space captured in group 1 IF it exists.
                // Use substring replacement to avoid regex global madness on replace
                // (Replacing only the match instance)

                const pre = line.substring(0, targetMatch.index);
                const post = line.substring(targetMatch.index + fullMatchStr.length);

                line = pre + post;
            }

            cleanLines.push(line);
        }

        return {
            cleanContent: cleanLines.join('\n'),
            extractedIds: extractedIds
        };
    }

    /**
     * Apply sticky decorations to the model to track the lines associated with IDs.
     * @param {monaco.editor.ITextModel} model 
     * @param {Array} extractedIds Array of { lineIndex, id }
     */
    setupDecorations(extractedIds) {
        const model = this.editor.getModel();
        if (!model) return;

        const newDecorations = [];
        this.decorationToId.clear();

        for (const item of extractedIds) {
            // Create a decoration for the entire line


            const lineContent = model.getLineContent(item.lineIndex + 1);
            const maxCol = lineContent.length + 1;

            newDecorations.push({
                range: new this.monaco.Range(item.lineIndex + 1, 1, item.lineIndex + 1, maxCol),
                options: this._getDecorationOptions(item.id),
                // Custom payload not supported directly in options, need to map via ID
                metadata: { inkId: item.id }
            });
        }

        // Apply decorations
        const decorationIds = this.decorationCollection.set(newDecorations);

        // Map decoration IDs back to Ink IDs
        for (let i = 0; i < decorationIds.length; i++) {
            this.decorationToId.set(decorationIds[i], extractedIds[i].id);
        }
    }

    /**
     * Helper to Generate Decoration Options
     */
    _getDecorationOptions(id) {
        // Lucide Copy Icon SVG (grey)
        const copyIconUrl = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%23999%22%20stroke-width%3D%222%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%3E%3Crect%20x%3D%229%22%20y%3D%229%22%20width%3D%2213%22%20height%3D%2213%22%20rx%3D%222%22%20ry%3D%222%22%2F%3E%3Cpath%20d%3D%22M5%2015H4a2%202%200%200%201-2-2V4a2%202%200%200%201%202-2h9a2%202%200%200%201%202%202v1%22%2F%3E%3C%2Fsvg%3E';

        return {
            description: 'ink-id-tracker',
            isWholeLine: true,
            stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            glyphMarginClassName: 'ink-id-chip',
            glyphMarginHoverMessage: {
                value: `\`${id}\` ![copy](${copyIconUrl})`,
                isTrusted: true,
                supportHtml: true
            }
        };
    }

    /**
     * Clear all tracked IDs.
     */
    clear() {
        this.decorationCollection.clear();
        this.decorationToId.clear();
    }

    /**
     * Add a tracker for a new ID (e.g. from Auto-Tagging)
     */
    registerNewId(lineNumber, idStr) {
        // lineNumber is 1-based
        const model = this.editor.getModel();
        if (!model) return;

        // Note: Intentionally using deltaDecorations for granular control since we need to map IDs.
    }


    // RE-IMPLEMENTING with raw deltaDecorations to support incremental updates

    /**
     * Add a single ID tracker.
     */
    addId(lineNumber, idStr) {
        const newDec = {
            range: new this.monaco.Range(lineNumber, 1, lineNumber, 1),
            options: this._getDecorationOptions(idStr)
        };

        const resultIds = this.editor.deltaDecorations([], [newDec]);
        const decId = resultIds[0];

        // Store
        this.decorationToId.set(decId, idStr);
    }

    /**
     * Reconstruct the content by injecting IDs back into the text.
     */
    reconstructContent(currentContent) {
        const model = this.editor.getModel();
        if (!model) return currentContent; // Should match currentContent

        const lines = currentContent.split(/\r?\n/);
        const resultLines = [...lines];

        // Get all current decorations
        const ranges = model.getAllDecorations();

        // Identify OUR decorations
        for (const dec of ranges) {
            if (this.decorationToId.has(dec.id)) {
                const inkId = this.decorationToId.get(dec.id);
                // Get current line number of this decoration
                const range = dec.range;
                const lineIndex = range.startLineNumber - 1; // 0-based

                if (lineIndex >= 0 && lineIndex < resultLines.length) {
                    // Logic to insert ID
                    resultLines[lineIndex] = this.injectIdIntoLine(resultLines[lineIndex], inkId);
                }
            }
        }

        return resultLines.join('\n');
    }

    /**
     * Logic to insert the ID tag into the correct position in the line.
     */
    injectIdIntoLine(lineText, id) {
        const fullTag = ` #id:${id}`;

        // If line is empty or just whitespace
        if (!lineText.trim()) return lineText; // Don't tag empty lines? Tagger usually ignores them.

        // Separate content from comments
        const commentIdx = lineText.indexOf('//');
        let contentPart = commentIdx === -1 ? lineText : lineText.substring(0, commentIdx);
        const commentPart = commentIdx === -1 ? '' : lineText.substring(commentIdx);

        // Check for Choice
        const trimmedLine = contentPart.trim();
        const isChoice = trimmedLine.startsWith('*') || trimmedLine.startsWith('+');

        let insertIndex = contentPart.trimEnd().length; // Default: end of content

        if (isChoice) {
            const openIdx = contentPart.indexOf('[');
            const closeIdx = contentPart.indexOf(']');

            // Check for Contained Choice: * [Option]
            if (openIdx !== -1 && closeIdx !== -1 && openIdx < closeIdx) {
                // Insert inside brackets, at the end of text inside
                // If text is `* [Option]`, we want `* [Option #id:...]`

                insertIndex = closeIdx;
            }
        }

        // Reassemble
        const pre = contentPart.substring(0, insertIndex);
        const post = contentPart.substring(insertIndex);

        return pre + fullTag + post + commentPart;
    }
}
