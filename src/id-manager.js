
export class IdHidingManager {
    constructor(editor, monaco) {
        this.editor = editor;
        this.monaco = monaco;
        this.isEnabled = false;
        this.decorations = [];
        this.updateDebounceTimer = null;
        this.isFixing = false;

        this._initListeners();
    }

    _initListeners() {
        this.editor.onDidChangeModelContent((e) => this._onContentChanged(e));
    }

    setEnabled(enabled) {
        if (this.isEnabled === enabled) return;
        this.isEnabled = enabled;
        this.updateDecorations();
    }

    updateDecorations(force = false, targetModel = null) {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        if (force) {
            this._performUpdate(targetModel);
            return;
        }

        // Use a small debounce (one frame) to avoid thrashing/spam but keep it responsive
        this.updateDebounceTimer = setTimeout(() => {
            this._performUpdate();
        }, 16);
    }

    _performUpdate(targetModel = null) {
        if (!this.editor) return;

        const model = targetModel || this.editor.getModel();
        if (!model) return;

        // If explicitly targeting a new model (e.g. during load), clear our tracking of old decorations
        // because we are about to apply fresh ones to a new model.
        if (targetModel) {
            this.decorations = [];
        }

        if (!this.isEnabled) {
            // Can't remove decorations from a detached model easily if we don't track them per-model,
            // but for the use case of "loading new file", we just want to ensure we don't ADD them if disabled.
            // If attached, use editor API.
            if (!targetModel) {
                this.decorations = this.editor.deltaDecorations(this.decorations, []);
            }
            return;
        }

        const text = model.getValue();
        const newDecorations = [];

        // Regex for ID tags: #id: followed by alphanumerics/underscore
        const regex = /#id:[a-zA-Z0-9_]+/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            const startPos = model.getPositionAt(match.index);
            const endPos = model.getPositionAt(match.index + match[0].length);

            const range = new this.monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);

            newDecorations.push({
                range: range,
                options: {
                    inlineClassName: 'dinky-id-hidden',
                    afterContentClassName: 'dinky-id-chip',
                    stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                }
            });
        }

        // Apply decorations
        if (targetModel) {
            // Apply to detached model using its internal API if available, or just standard deltaDecorations 
            // (it works on model instance in newer Monaco versions, but safe fallback is needed?)
            // Actually, ITextModel has deltaDecorations in standard Monaco interface.
            this.decorations = targetModel.deltaDecorations([], newDecorations);
        } else {
            // Apply to attached model via editor (clears old ones tracked in this.decorations)
            this.decorations = this.editor.deltaDecorations(this.decorations, newDecorations);
        }
    }

    _onContentChanged(e) {
        if (this.isFixing) return;

        const model = this.editor.getModel();
        const edits = [];

        // Decoration-based guards (only if Hiding is Enabled)
        if (this.isEnabled) {
            const ranges = this.decorations.map(id => model.getDecorationRange(id)).filter(r => r);

            e.changes.forEach(change => {
                if (change.text.length > 0) {
                    const changeStart = new this.monaco.Position(change.range.startLineNumber, change.range.startColumn);

                    for (const range of ranges) {
                        const rangeEnd = range.getEndPosition();

                        // End Guard (Appending)
                        // Checks if typing immediately after a hidden ID (end of range)
                        const isAtEnd = rangeEnd.equals(changeStart);
                        const hasGrownEnd = (rangeEnd.lineNumber === changeStart.lineNumber) &&
                            ((rangeEnd.column - changeStart.column) === change.text.length);

                        if (isAtEnd || hasGrownEnd) {
                            edits.push({
                                range: new this.monaco.Range(changeStart.lineNumber, changeStart.column, changeStart.lineNumber, changeStart.column),
                                text: ' ',
                                forceMoveMarkers: true
                            });
                            break;
                        }
                    }
                }
            });
        }

        // Space Enforcer: Enforce space before #id: using Regex scan on modified lines
        // This runs ALWAYS, ensuring valid ID syntax in memory regardless of hiding state.
        const linesToCheck = new Set(e.changes.map(c => c.range.startLineNumber));
        linesToCheck.forEach(lineNumber => {
            if (lineNumber > model.getLineCount()) return;
            const lineContent = model.getLineContent(lineNumber);

            // Prefix Guard
            // Find #id: that is NOT at start of line and NOT preceded by whitespace
            const prefixRegex = /([^\s])(#id:)/g;
            let match;
            while ((match = prefixRegex.exec(lineContent)) !== null) {
                const group1Len = match[1].length;
                const insertCol = match.index + group1Len + 1; // 1-based column

                edits.push({
                    range: new this.monaco.Range(lineNumber, insertCol, lineNumber, insertCol),
                    text: ' ',
                    forceMoveMarkers: true
                });
            }

            // Suffix Guard
            // Find #id:... tags that have been extended with invalid chars
            // Matches any #id: tag (sequence of alphanumerics/underscore)
            // Then checks if inside that sequence, there is a valid _XXXX suffix followed by more chars
            const tagRegex = /#id:[a-zA-Z0-9_]+/g;
            while ((match = tagRegex.exec(lineContent)) !== null) {
                const fullTag = match[0];

                // Rule: Valid ID must end with _XXXX (underscore + 4 alphanumerics)
                // If it ends with that, it's valid.
                if (/_([a-zA-Z0-9]{4})$/.test(fullTag)) {
                    continue;
                }

                // If not, checking if it *contains* a valid suffix that was overrun.
                // We look for the LAST occurrence of _XXXX.
                const suffixRegex = /_([a-zA-Z0-9]{4})/g;
                let suffixMatch;
                let lastSuffixMatch = null;

                while ((suffixMatch = suffixRegex.exec(fullTag)) !== null) {
                    lastSuffixMatch = suffixMatch;
                }

                if (lastSuffixMatch) {
                    // We found a potential suffix that creates a valid ID prefix.
                    // Everything after it is overflow.
                    // lastSuffixMatch.index is start of _XXXX relative to fullTag.
                    // Length is 5 (_ + 4 chars).

                    const suffixEndIndex = lastSuffixMatch.index + 5;

                    // Sanity check: ensure we are actually splitting the tag
                    if (suffixEndIndex < fullTag.length) {
                        const insertCol = match.index + suffixEndIndex + 1; // 1-based column

                        edits.push({
                            range: new this.monaco.Range(lineNumber, insertCol, lineNumber, insertCol),
                            text: ' ',
                            forceMoveMarkers: true
                        });
                    }
                }
            }
        });

        if (edits.length > 0) {
            this.isFixing = true;
            this.editor.executeEdits('id-hiding-seal', edits);
            this.isFixing = false;
        }
    }

    setupCopyInterceptor() {
        const container = this.editor.getContainerDomNode();
        container.addEventListener('copy', (e) => {
            if (!this.isEnabled) return;
            const selection = this.editor.getSelection();
            if (selection.isEmpty()) return;
            let text = this.editor.getModel().getValueInRange(selection);
            const cleanedText = text.replace(/#id:[a-zA-Z0-9_]+/g, '');
            if (cleanedText !== text) {
                e.preventDefault();
                e.clipboardData.setData('text/plain', cleanedText);
            }
        });
    }
}
