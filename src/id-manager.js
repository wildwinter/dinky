
export class IdHidingManager {
    constructor(editor, monaco) {
        this.editor = editor;
        this.monaco = monaco;
        this.isEnabled = false;
        this.decorations = [];
        this.lastKnownIds = []; // Track known ID ranges for immutability check
        this.updateDebounceTimer = null;
        this.isFixing = false;

        this._initListeners();
        // Initial scan to populate lastKnownIds
        // Models might not be loaded yet if constructor is called early, but render logic calls updateDecorations soon.
        // We'll trust updateDecorations/onContentChanged loop, but also run a scan if possible.
        if (this.editor.getModel()) {
            this._scanIds();
        }
    }

    _initListeners() {
        this.editor.onDidChangeModelContent((e) => this._onContentChanged(e));
        // Need to rescan when model changes entirely
        this.editor.onDidChangeModel(() => {
            // Reset cache for new model
            if (this.editor.getModel()) {
                this._scanIds();
            } else {
                this.lastKnownIds = [];
            }
        });
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

        // ---------------------------------------------------------
        // IMMUTABILITY GUARD
        // Check if any change overlaps strictly inside a known ID range.
        // We use lastKnownIds (captured before this change).
        // ---------------------------------------------------------
        // ---------------------------------------------------------
        // IMMUTABILITY GUARD
        // Check if any change overlaps strictly inside a known ID range.
        // We use lastKnownIds (captured before this change).
        // ---------------------------------------------------------
        if (this.isEnabled && this.lastKnownIds && this.lastKnownIds.length > 0) {
            let illegalEdit = false;

            for (const change of e.changes) {
                // Change range is in valid coordinates relative to the OLD model state (which matches lastKnownIds).
                const changeRange = change.range;

                for (const idRange of this.lastKnownIds) {
                    // Check strict intersection:
                    // Illegal inside edit if:
                    // 1. Change starts AFTER ID start
                    // 2. Change ends BEFORE ID end
                    // (This effectively blocks typing inside, deleting inside, but allows full delete or edge extensions)

                    // Actually, "Strictly Inside" means:
                    // modification range is contained within ID, but does not equal ID.
                    // Wait, partial deletion of ID (e.g. deleting first char) is also bad?
                    // User said "changing the ID". Deleting the ID entirely is usually OK.
                    // Modifying it (breaking syntax) is bad.

                    // Range intersection logic:
                    // Intersection must be valid and non-empty? 
                    // Any overlap that is NOT a full deletion/replacement of the ID tag is suspect.

                    // If range equals ID range -> Full replacement/deletion. ALLOW.
                    if (idRange.equalsRange(changeRange)) continue;

                    // If range contains ID range -> Deletion of surrounding block. ALLOW.
                    if (this.monaco.Range.containsRange(changeRange, idRange)) continue;

                    // If ID contains range -> Modification INSIDE ID. BLOCK.
                    // This covers typing inside, deleting part inside.
                    if (this.monaco.Range.containsRange(idRange, changeRange)) {
                        // Edge case: Extending at the very end?
                        // If appending at end: change start/end == ID end.
                        // containsRange includes edges.
                        // We must check strict interior.

                        const isAtStart = (changeRange.startLineNumber === idRange.startLineNumber && changeRange.startColumn === idRange.startColumn);
                        const isAtEnd = (changeRange.endLineNumber === idRange.endLineNumber && changeRange.endColumn === idRange.endColumn);

                        // If it touches edges, it might be allowed (Prefix/Suffix guards handle formatting).
                        // e.g. Prepending space -> touches start. Appending space -> touches end.
                        // If NOT touching edges, it is strictly internal. BLOCK.
                        if (!isAtStart && !isAtEnd) {
                            illegalEdit = true;
                            break;
                        }

                        // If it touches edges, but has content...
                        // e.g. typing 'x' at end. Range is empty (at end). intersect?
                        // Wait, Range.containsRange(range, emptyRange) is true if position inside.

                        // Let's refine:
                        // If change is an INSERT (text.length > 0, range empty):
                        //   If pos > start and pos < end -> Internal Insert. BLOCK.
                        //   If pos == start or pos == end -> Edge Insert. ALLOW.

                        // If change is DELETE/REPLACE:
                        //   If intersection exists and is not full coverage -> BLOCK.
                        //   Actually complexity: simpler to say "Don't touch the ID text".

                        // Let's stick thereto:
                        // Blocks edits where Start > ID.Start AND End < ID.End.
                        // (Strictly Inner Range).

                        const strictInner =
                            (changeRange.startLineNumber > idRange.startLineNumber || (changeRange.startLineNumber === idRange.startLineNumber && changeRange.startColumn > idRange.startColumn)) &&
                            (changeRange.endLineNumber < idRange.endLineNumber || (changeRange.endLineNumber === idRange.endLineNumber && changeRange.endColumn < idRange.endColumn));

                        if (strictInner) {
                            illegalEdit = true;
                            break;
                        }
                    }
                }
                if (illegalEdit) break;
            }

            if (illegalEdit) {
                this.isFixing = true;
                this.editor.trigger('id-guard', 'undo', {});
                this.isFixing = false;

                // IMPORTANT: Since we undid the change, the model is back to old state.
                // lastKnownIds remains valid (or should be resynced just in case).
                return;
            }
        }

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
        // Only run specialized guards if Hiding is ENABLED.
        // If disabled, user can edit freely (except copy/paste stripping).
        if (this.isEnabled) {
            const linesToCheck = new Set(e.changes.map(c => c.range.startLineNumber));
            linesToCheck.forEach(lineNumber => {
                if (lineNumber > model.getLineCount()) return;
                const lineContent = model.getLineContent(lineNumber);

                // Prefix Guard
                const prefixRegex = /([^\s])(#id:)/g;
                let match;
                while ((match = prefixRegex.exec(lineContent)) !== null) {
                    const group1Len = match[1].length;
                    const insertCol = match.index + group1Len + 1; // 1-based column

                    edits.push({
                        range: new this.monaco.Range(lineNumber, insertCol, lineNumber, insertCol),
                        text: ' ',
                        forceMoveMarkers: false
                    });
                }

                // Suffix Guard
                const tagRegex = /#id:[a-zA-Z0-9_]+/g;
                while ((match = tagRegex.exec(lineContent)) !== null) {
                    const fullTag = match[0];

                    if (/_([a-zA-Z0-9]{4})$/.test(fullTag)) {
                        const charAfter = lineContent[match.index + fullTag.length];
                        if (charAfter && !/[\s\/\]]/.test(charAfter)) {
                            const insertCol = match.index + fullTag.length + 1;
                            edits.push({
                                range: new this.monaco.Range(lineNumber, insertCol, lineNumber, insertCol),
                                text: ' ',
                                forceMoveMarkers: true
                            });
                        }
                        continue;
                    }

                    // Suffix overflow check
                    const suffixRegex = /_([a-zA-Z0-9]{4})/g;
                    let suffixMatch;
                    let lastSuffixMatch = null;

                    while ((suffixMatch = suffixRegex.exec(fullTag)) !== null) {
                        lastSuffixMatch = suffixMatch;
                    }

                    if (lastSuffixMatch) {
                        const suffixEndIndex = lastSuffixMatch.index + 5;
                        if (suffixEndIndex < fullTag.length) {
                            const insertCol = match.index + suffixEndIndex + 1;
                            edits.push({
                                range: new this.monaco.Range(lineNumber, insertCol, lineNumber, insertCol),
                                text: ' ',
                                forceMoveMarkers: true
                            });
                        }
                    }
                }
            });
        }

        if (edits.length > 0) {
            this.isFixing = true;
            // Capture current selections before applying edits
            const currentSelections = this.editor.getSelections();

            this.editor.executeEdits('id-hiding-seal', edits, (inverseEditOperations) => {
                // Granular Cursor Logic:
                // We need to return the NEW selections.
                // For each original selection, we determine if it needs to shift.

                return currentSelections.map(selection => {
                    let newLine = selection.positionLineNumber;
                    let newCol = selection.positionColumn;

                    // Check all edits to see if they affect this cursor
                    edits.forEach(edit => {
                        // Only care about edits on the same line
                        if (edit.range.startLineNumber === newLine) {
                            // If edit is strictly BEFORE the cursor, we shift right.
                            // Case: Suffix Guard. Cursor is at C. Edit at C-1.
                            // We inserted 1 char (' '). So cursor should move to C+1.
                            if (edit.range.startColumn < selection.positionColumn) {
                                newCol += 1;
                            }
                            // If edit is AT the cursor, we typically DO NOT shift (Prefix Guard).
                            // Case: Prefix Guard. Cursor at C. Edit at C.
                            // We insert space at C. Valid text starts at C+1.
                            // We want cursor to stay at C (before the space).
                            // So we do nothing.
                        }
                    });

                    // Return new Selection (collapsed to cursor)
                    return new this.monaco.Selection(newLine, newCol, newLine, newCol);
                });
            });
            this.isFixing = false;
        }
    }

    _scanIds() {
        if (!this.editor) return;
        const model = this.editor.getModel();
        if (!model) return;

        const text = model.getValue();
        const regex = /#id:[a-zA-Z0-9_]+/g;
        let match;
        this.lastKnownIds = [];

        while ((match = regex.exec(text)) !== null) {
            const startPos = model.getPositionAt(match.index);
            const endPos = model.getPositionAt(match.index + match[0].length);
            // Store as simple range object (not Monaco class instance to avoid overhead? Monaco Range is fine)
            // Storing Monaco Range is good for convenience.
            this.lastKnownIds.push(new this.monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column));
        }
    }

    setupCopyInterceptor() {
        const container = this.editor.getContainerDomNode();
        container.addEventListener('copy', (e) => {
            // ALWAYS INTERCEPT COPY, even if hiding is disabled involved?
            // User request: "The ONLY special treatment now when UNHIDDEN should be that if any text is pasted from one place to another, any IDs should be removed."
            // So we allow stripping always.
            // if (!this.isEnabled) return;

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
