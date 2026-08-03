export class IdPreservationManager {
    constructor(editor, monaco) {
        this.editor = editor;
        this.monaco = monaco;
        // Map<DecorationId, InkIdString>
        this.decorationToId = new Map();
        // Map<InkIdString, { path, status, color }> - audio info per line ID
        this.audioStatusMap = {};
        // Set<lineNumber> - lines that are dialogue lines
        this.dialogueLines = new Set();
        // Callback for playing audio by file path
        this.playAudioForLine = null;
        // Callback resolving the CURRENT audio path for a line ID (same lookup
        // the toolbar uses). Set by the renderer. Lets the play badge resolve
        // its file live at click time instead of trusting the audioStatusMap
        // snapshot, which only refreshes on file load / compile and can point
        // at a stale file after audio changes on disk.
        this.getAudioPathForId = null;
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
                            this._playAudioForId(inkId);
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
            const idRegex = /^([a-zA-Z0-9_-]+_[a-zA-Z0-9]{4})$/;
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
     * Play the audio for a line ID from the play badge. Resolves the file path
     * live (via getAudioPathForId) so it always plays the same take the toolbar
     * would, even if the audio changed on disk since the glyphs were last
     * refreshed. Falls back to the cached snapshot path only when no live
     * resolver is wired up.
     */
    async _playAudioForId(inkId) {
        if (!this.playAudioForLine) return;
        let audioPath;
        if (this.getAudioPathForId) {
            // Authoritative live lookup - a null result means the file is gone,
            // so we deliberately don't fall back to the (stale) cached path.
            audioPath = await this.getAudioPathForId(inkId);
        } else {
            audioPath = this.audioStatusMap[inkId]?.path || null;
        }
        if (audioPath) this.playAudioForLine(audioPath);
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
        const idRegex = /(\s?)#id:([a-zA-Z0-9_-]+_[a-zA-Z0-9]{4})\b/g;

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
                const idPart = targetMatch[2];

                extractedIds.push({
                    lineIndex: i,
                    id: idPart
                });

                // Remove the first ID from the line
                const pre = line.substring(0, targetMatch.index);
                const post = line.substring(targetMatch.index + fullMatchStr.length);
                line = pre + post;

                // Remove any additional duplicate ID tags silently (keep only the first)
                if (matches.length > 1) {
                    line = line.replace(/\s?#id:[a-zA-Z0-9_-]+_[a-zA-Z0-9]{4}\b/g, '');
                }
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
            // Minimal single-line range (see _singleLineRange) so the badge can't
            // later drift onto an adjacent line when this line is split.
            newDecorations.push({
                range: this._singleLineRange(model, item.lineIndex + 1),
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
        // Iterate only over our tracked decorations instead of ALL model decorations.
        // Normalise each range back to a single line at its start and keep at most
        // one badge per line, so a decoration that drifted to span two lines (or a
        // stray duplicate) is healed rather than re-baked into the collection.
        const newDecorations = [];
        const idList = [];
        const seenLines = new Set();

        for (const [decId, inkId] of this.decorationToId) {
            const currentRange = model.getDecorationRange(decId);
            if (!currentRange) continue;

            const line = currentRange.startLineNumber;
            if (seenLines.has(line)) continue;
            seenLines.add(line);

            const isDialogue = this.dialogueLines.has(line);
            const audioInfo = this.audioStatusMap[inkId];
            const hasAudio = isDialogue && !!audioInfo;

            newDecorations.push({
                range: this._singleLineRange(model, line),
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


    /**
     * Add a single ID tracker.
     * Uses decorationCollection exclusively to avoid orphaned deltaDecorations.
     */
    addId(lineNumber, idStr) {
        const model = this.editor.getModel();
        if (!model) return;

        // Collect current decorations, normalised to a single line at their start
        // and keyed by line so we keep one badge per line. The line being tagged
        // is dropped from the carry-over set first, so the freshly-generated ID
        // wins on that line (the tagger only tags lines it saw as untagged, so any
        // pre-existing decoration there is a drifted stale one).
        const idByLine = new Map();
        for (const [decId, inkId] of this.decorationToId) {
            const range = model.getDecorationRange(decId);
            if (range && !range.isEmpty()) {
                idByLine.set(range.startLineNumber, inkId);
            }
        }
        idByLine.set(lineNumber, idStr);

        const currentDecorations = [];
        const currentIds = [];
        for (const [line, inkId] of idByLine) {
            currentDecorations.push({
                range: this._singleLineRange(model, line),
                options: this._getDecorationOptions(inkId)
            });
            currentIds.push(inkId);
        }

        // Atomically replace the entire collection
        this.decorationToId.clear();
        const decorationIds = this.decorationCollection.set(currentDecorations);
        for (let i = 0; i < decorationIds.length; i++) {
            this.decorationToId.set(decorationIds[i], currentIds[i]);
        }
    }

    /**
     * Heal the live ID decorations once editing has settled. This mirrors the
     * cleanup that reconstructContent() applies on save, but runs on the live
     * decorations so quirks are corrected (and become visible) during editing
     * rather than only on the next save:
     *
     *   - drops IDs that drifted onto structural / ineligible lines (knots,
     *     diverts, inline conditionals, declarations, list continuations) which
     *     can never carry an #id:. This is exactly the set reconstructContent
     *     would strip on save, so nothing localisable is lost;
     *   - collapses a decoration that grew to span two lines back to its start
     *     line, which otherwise shows the ID badge/hover on two lines at once;
     *   - keeps at most one ID badge per line.
     *
     * Returns true if it changed anything.
     */
    sweepIdDecorations() {
        const model = this.editor.getModel();
        if (!model) return false;

        const lines = model.getValue().split(/\r?\n/);
        const declarationContinuations = this._findDeclarationContinuationLines(lines);

        // Gather current positions, ordered top-to-bottom so de-dup is deterministic.
        const entries = [];
        for (const [decId, inkId] of this.decorationToId) {
            const range = model.getDecorationRange(decId);
            if (!range || range.isEmpty()) continue;
            entries.push({
                startLine: range.startLineNumber,
                endLine: range.endLineNumber,
                inkId
            });
        }
        entries.sort((a, b) => a.startLine - b.startLine);

        const keep = []; // { line, inkId }
        const seenLines = new Set();
        let changed = this.decorationToId.size !== entries.length; // some ranges were lost/empty

        for (const e of entries) {
            const lineIndex = e.startLine - 1;
            const lineText = lineIndex >= 0 && lineIndex < lines.length ? lines[lineIndex] : '';
            if (!this._isLineEligibleForId(lineText) || declarationContinuations.has(lineIndex)) {
                changed = true; // ID drifted onto a structural line - drop it
                continue;
            }
            if (seenLines.has(e.startLine)) {
                changed = true; // duplicate badge on this line - drop the extra
                continue;
            }
            seenLines.add(e.startLine);
            if (e.endLine !== e.startLine) changed = true; // was spanning - collapse it
            keep.push({ line: e.startLine, inkId: e.inkId });
        }

        if (!changed) return false;

        const newDecorations = keep.map(k => {
            const isDialogue = this.dialogueLines.has(k.line);
            const hasAudio = isDialogue && !!this.audioStatusMap[k.inkId];
            return {
                range: this._singleLineRange(model, k.line),
                options: this._getDecorationOptions(k.inkId, hasAudio)
            };
        });

        this.decorationToId.clear();
        const decorationIds = this.decorationCollection.set(newDecorations);
        for (let i = 0; i < decorationIds.length; i++) {
            this.decorationToId.set(decorationIds[i], keep[i].inkId);
        }
        return true;
    }

    /**
     * Returns true if the line is eligible to carry an #id: tag.
     * Structural Ink lines (knots, stitches, functions, logic, declarations)
     * must not carry IDs or the compiler will reject them.
     */
    _isLineEligibleForId(lineText) {
        const commentIdx = lineText.indexOf('//');
        const contentPart = commentIdx === -1 ? lineText : lineText.substring(0, commentIdx);
        const trimmed = contentPart.trim();

        if (!trimmed) return false;
        if (trimmed.startsWith('=')) return false;  // knots (== name), stitches (= name), functions
        if (trimmed.startsWith('~')) return false;  // ink logic lines
        // Pure structural flow lines: diverts (-> knot, -> END, ->->), and
        // threads (<- thread). A line that merely *ends* with a divert
        // ("Hello -> knot") starts with its text, so it stays eligible.
        if (trimmed.startsWith('->') || trimmed.startsWith('<-')) return false;
        // Inline logic / conditionals with no leading static text, e.g.
        // "{testVar: -> knot1}", "{ condition:", or a lone closing "}". Such a
        // line has no localisable leading chunk, so it must not carry an ID.
        // (A content line like "Score: {value}" starts with its text and stays
        // eligible.)
        if (trimmed.startsWith('{') || trimmed.startsWith('}')) return false;
        if (/^(VAR|CONST|LIST|EXTERNAL|INCLUDE)\s/i.test(trimmed)) return false;
        return true;
    }

    /**
     * Build a minimal, single-line, non-empty decoration range for a line.
     *
     * We deliberately pin the range near the start of the line (columns 1-2)
     * rather than spanning the whole line text. A whole-line-text range whose
     * end sits at end-of-line gets dragged onto the next line when the line is
     * split (Enter pressed mid-line), leaving one decoration spanning two lines
     * - which renders the ID badge/hover on BOTH lines. A minimal range at the
     * start stays put, while `isWholeLine: true` still paints the glyph across
     * the whole line. The range stays non-empty so it isn't mistaken for a
     * deleted-line decoration (see reconstructContent / addId).
     * @param {monaco.editor.ITextModel} model
     * @param {number} line 1-based line number
     */
    _singleLineRange(model, line) {
        const endCol = Math.min(2, model.getLineMaxColumn(line));
        return new this.monaco.Range(line, 1, line, endCol);
    }

    /**
     * Returns a Set of 0-based line indices that are continuations of a
     * multi-line declaration (VAR / CONST / LIST / EXTERNAL / INCLUDE).
     *
     * Heuristic: a declaration that ends with `,` continues onto the next
     * non-blank line; a continuation that ends with `,` continues further;
     * a blank line or a non-comma terminator ends the block.
     *
     * Used to catch the case where a user accidentally split a LIST across
     * lines (forgot a comma), got an auto-generated ID on what looked like
     * a dialogue line, then fixed the comma - leaving a now-illegal ID
     * baked into a list-item line.
     */
    _findDeclarationContinuationLines(lines) {
        const result = new Set();
        let inDeclaration = false;

        for (let i = 0; i < lines.length; i++) {
            const commentIdx = lines[i].indexOf('//');
            const codePart = commentIdx === -1 ? lines[i] : lines[i].substring(0, commentIdx);
            const trimmed = codePart.trim();

            if (!trimmed) {
                inDeclaration = false;
                continue;
            }

            if (/^(VAR|CONST|LIST|EXTERNAL|INCLUDE)\s/i.test(trimmed)) {
                inDeclaration = trimmed.endsWith(',');
                continue;
            }

            if (inDeclaration) {
                result.add(i);
                inDeclaration = trimmed.endsWith(',');
            }
        }
        return result;
    }

    /**
     * Reconstruct the content by injecting IDs back into the text.
     */
    reconstructContent(currentContent) {
        const model = this.editor.getModel();
        if (!model) return currentContent;

        const lines = currentContent.split(/\r?\n/);
        const declarationContinuations = this._findDeclarationContinuationLines(lines);
        const resultLines = [...lines];
        const decorationsToRemove = [];

        // Iterate only over our tracked decorations instead of ALL model decorations
        for (const [decId, inkId] of this.decorationToId) {
            const range = model.getDecorationRange(decId);

            if (!range) {
                // Decoration no longer exists - mark for cleanup
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
                // If the line is no longer eligible for an ID (e.g. it became
                // a knot header, declaration, logic line, OR a continuation
                // of a multi-line declaration like LIST), drop the decoration
                // so the ID is stripped from the file on save.
                if (!this._isLineEligibleForId(resultLines[lineIndex]) || declarationContinuations.has(lineIndex)) {
                    decorationsToRemove.push(decId);
                    continue;
                }
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
