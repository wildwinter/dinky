
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

    updateDecorations() {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
        }

        // Use a small debounce (one frame) to avoid thrashing/spam but keep it responsive
        this.updateDebounceTimer = setTimeout(() => {
            this._performUpdate();
        }, 16);
    }

    _performUpdate() {
        if (!this.editor || !this.editor.getModel()) return;

        if (!this.isEnabled) {
            this.decorations = this.editor.deltaDecorations(this.decorations, []);
            return;
        }

        const model = this.editor.getModel();
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

        this.decorations = this.editor.deltaDecorations(this.decorations, newDecorations);
    }

    _onContentChanged(e) {
        if (!this.isEnabled || this.isFixing) return;

        // "Undo that change. I don't want IDs to be edited"
        // "I don't want material typed next to a tag to become part of that tag"
        // Logic: if user types immediately adjacent to a hidden ID, insert a space separator.

        const model = this.editor.getModel();
        const edits = [];
        const ranges = this.decorations.map(id => model.getDecorationRange(id)).filter(r => r);

        if (edits.length > 0) return; // Should not happen if we clear edits?

        // 1. End Guard: Prevent appending to hidden IDs (logic using decorations)
        e.changes.forEach(change => {
            if (change.text.length > 0) {
                const changeStart = new this.monaco.Position(change.range.startLineNumber, change.range.startColumn);

                for (const range of ranges) {
                    const rangeEnd = range.getEndPosition();

                    // --- END GUARD (Appending) ---
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

        // 2. Start Guard: Enforce space before #id: using Regex scan on modified lines
        // This is more robust than decoration tracking for prepending
        const linesToCheck = new Set(e.changes.map(c => c.range.startLineNumber));
        linesToCheck.forEach(lineNumber => {
            if (lineNumber > model.getLineCount()) return;
            const lineContent = model.getLineContent(lineNumber);

            // Regex: Find #id: that is NOT at start of line and NOT preceded by whitespace
            // Captures: (group 1: non-whitespace char) (group 2: #id:)
            const regex = /([^\s])(#id:)/g;
            let match;
            while ((match = regex.exec(lineContent)) !== null) {
                // Found a collision. Insert space between group 1 and 2.
                // Match index is start of group 1.
                // Insertion point is match.index + group1.length.
                const group1Len = match[1].length;
                const insertCol = match.index + group1Len + 1; // 1-based column

                edits.push({
                    range: new this.monaco.Range(lineNumber, insertCol, lineNumber, insertCol),
                    text: ' ',
                    forceMoveMarkers: true
                });
            }
        });

        if (edits.length > 0) {
            this.isFixing = true;
            this.editor.executeEdits('id-hiding-seal', edits);
            this.isFixing = false;
            // Decoration update will happen naturally via the debounced status (or triggered by renderer) 
            // but we might want to force it or let the debounce handle it.
            // Since we inserted a space, the previous decoration range is still valid for the ID part.
        }

        // Let the renderer call updateDecorations or trigger it here?
        // Renderer calls updatedDecorations on change. 
        // If we trigger another edit, renderer will call it again.
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
