export class IdPreservationManager {
    constructor(editor, monaco) {
        this.editor = editor;
        this.monaco = monaco;
        // Map<DecorationId, InkIdString>
        this.decorationToId = new Map();
        // Map<InkIdString, { path, status, color }> — audio info per line ID
        this.audioStatusMap = {};
        // Set<lineNumber> — lines that are dialogue lines
        this.dialogueLines = new Set();
        // Callback for playing audio by line ID
        this.playAudioForLine = null;
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
                    if (this.decorationToId.has(dec.id)) {
                        const inkId = this.decorationToId.get(dec.id);

                        // If this line has audio, play it and move cursor to this line
                        if (this.audioStatusMap[inkId] && this.playAudioForLine) {
                            this.editor.setPosition({ lineNumber, column: 1 });
                            this.playAudioForLine(this.audioStatusMap[inkId].path);
                            return;
                        }
                        return;
                    }
                }
            }
        });

        // Listen for clicks on the ID text inside the Tooltip
        this._tooltipClickHandler = (e) => {
            // Only trigger when clicking the <code> element containing the ID
            const codeEl = e.target.closest('code');
            if (!codeEl) return;
            if (!codeEl.closest('.monaco-hover')) return;

            const text = codeEl.textContent.trim();
            const idRegex = /^([a-zA-Z0-9_]+_[a-zA-Z0-9]{4})$/;
            const match = text.match(idRegex);

            if (match) {
                const inkId = match[0];
                navigator.clipboard.writeText(inkId).then(() => {
                    // Visual Feedback
                    codeEl.style.color = '#4caf50';
                    codeEl.style.transition = 'color 0.2s';
                    setTimeout(() => {
                        codeEl.style.color = '';
                    }, 500);
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
     * Update glyph decorations based on audio status and dialogue line info.
     * @param {Object} audioStatusMap { lineId: { status, color, path } }
     * @param {Set<number>} dialogueLines Set of 1-based line numbers that are dialogue lines
     */
    updateAudioStatus(audioStatusMap, dialogueLines) {
        this.audioStatusMap = audioStatusMap || {};
        this.dialogueLines = dialogueLines || new Set();

        const model = this.editor.getModel();
        if (!model) return;

        // Collect current decoration data (ranges may have shifted due to edits)
        // Iterate only over our tracked decorations instead of ALL model decorations
        const newDecorations = [];
        const idList = [];

        for (const [decId, inkId] of this.decorationToId) {
            const currentRange = model.getDecorationRange(decId);
            if (!currentRange) continue;

            const isDialogue = this.dialogueLines.has(currentRange.startLineNumber);
            const audioInfo = this.audioStatusMap[inkId];
            const hasAudio = isDialogue && !!audioInfo;

            newDecorations.push({
                range: currentRange,
                options: this._getDecorationOptions(inkId, hasAudio)
            });
            idList.push(inkId);
        }

        // Rebuild the entire decoration collection to avoid deltaDecorations/collection conflicts
        this.decorationToId.clear();
        const decorationIds = this.decorationCollection.set(newDecorations);
        for (let i = 0; i < decorationIds.length; i++) {
            this.decorationToId.set(decorationIds[i], idList[i]);
        }
    }

    /**
     * Helper to Generate Decoration Options
     * @param {string} id - The ink ID
     * @param {boolean} hasAudio - Whether this line has playable audio
     */
    _getDecorationOptions(id, hasAudio) {
        return {
            description: 'ink-id-tracker',
            isWholeLine: true,
            stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            glyphMarginClassName: hasAudio ? 'ink-id-chip-play' : 'ink-id-chip',
            glyphMarginHoverMessage: {
                value: `\`${id}\``,
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
     * Get the ink ID associated with a given line number (1-based).
     * Returns the ID string or null if no ID is tracked on that line.
     */
    getIdForLine(lineNumber) {
        const model = this.editor.getModel();
        if (!model) return null;

        const decorations = model.getLineDecorations(lineNumber);
        for (const dec of decorations) {
            if (this.decorationToId.has(dec.id)) {
                return this.decorationToId.get(dec.id);
            }
        }
        return null;
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
        if (!model) return currentContent;

        const lines = currentContent.split(/\r?\n/);
        const resultLines = [...lines];
        const decorationsToRemove = [];

        // Iterate only over our tracked decorations instead of ALL model decorations
        for (const [decId, inkId] of this.decorationToId) {
            const range = model.getDecorationRange(decId);

            if (!range) {
                // Decoration no longer exists — mark for cleanup
                decorationsToRemove.push(decId);
                continue;
            }

            // Fix for ID Deletion Bug:
            // If a line is deleted, the decoration often remains but collapses to an empty range.
            if (range.isEmpty()) {
                decorationsToRemove.push(decId);
                continue;
            }

            const lineIndex = range.startLineNumber - 1; // 0-based
            if (lineIndex >= 0 && lineIndex < resultLines.length) {
                resultLines[lineIndex] = this.injectIdIntoLine(resultLines[lineIndex], inkId);
            }
        }

        // Cleanup removed decorations from editor and map
        if (decorationsToRemove.length > 0) {
            for (const decId of decorationsToRemove) {
                this.decorationToId.delete(decId);
            }
            this.editor.deltaDecorations(decorationsToRemove, []);
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
