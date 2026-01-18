export class IdPreservationManager {
    constructor(editor, monaco) {
        this.editor = editor;
        this.monaco = monaco;
        // Map<DecorationId, InkIdString>
        this.decorationToId = new Map();
        // We use a specific decoration key to track our IDs
        this.decorationCollection = editor.createDecorationsCollection();
    }

    /**
     * Parse the raw file content, separating ID tags from the text.
     * Returns the "clean" content for the editor and the extracted IDs.
     */
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

            // We only support ONE ID per line for now (Ink logic mostly enforces this).
            // But we should find the *last* valid one if multiple exist? 
            // Or just the first one? Tagger generates one.
            // Let's find the first one.

            // Re-set regex state if we were to use exec with global, but match() is easier if we don't need iteration state
            // match() with global returns array of strings.
            // We need capture groups. exec() is better.

            // Reset regex
            idRegex.lastIndex = 0;
            const matches = [];
            while ((match = idRegex.exec(line)) !== null) {
                matches.push(match);
            }

            if (matches.length > 0) {
                // If multiple, which one?
                // Visuals show scattered IDs. 
                // We should match ALL if they exist, but we only track ONE per line in our system?
                // Our system `extractedIds.push({ lineIndex })` assumes 1:1 mapping for line tracking.
                // If a line has multiple IDs, that's weird for Ink. 
                // Let's assume the LAST one is the "primary" ID for the line if multiple exist (unlikely but safe).
                // Or just pick the first?
                // Given the example: `Hello choice 1. #id:...` -> just one.

                const targetMatch = matches[0]; // Take the first one found.

                const fullMatchStr = targetMatch[0];
                const leadingSpace = targetMatch[1];
                const idPart = targetMatch[2]; // The "Test_Choices_ZUUN" part

                extractedIds.push({
                    lineIndex: i, // 0-based
                    id: idPart
                });

                // Remove it from the line
                // We construct the "Clean" line by removing the matched text.
                // Note: We strip the leading space captured in group 1 IF it exists.
                // But we must be careful not to strip space that is structural?
                // Usually ` #id:...` -> remove all of it.
                // `[Choice #id:...]` -> `[Choice]` (space removed).

                // Use substring replacement to avoid regex global madness on replace
                // (Replacing only the specific match instance)
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
            // We use Stickiness.AlwaysGrowsWhenTypingAtEdges = 0 (AlwaysGrowsWhenTypingAtEdges) is default?
            // We want the decoration to stay with the line.
            // NeverGrowsWhenTypingAtEdges might be better if we want to treat it as a line anchor.

            // Actually, for line tracking, we just need a range covering the line.
            // If user types at end, it grows. If user types at start, it grows.
            // If user deletes line, decoration goes away? 
            // We need to handle line deletion/merging potentially, but Monaco handles move.

            const lineContent = model.getLineContent(item.lineIndex + 1);
            const maxCol = lineContent.length + 1;

            newDecorations.push({
                range: new this.monaco.Range(item.lineIndex + 1, 1, item.lineIndex + 1, maxCol),
                options: {
                    description: 'ink-id-tracker',
                    isWholeLine: true,
                    // We don't need visual style, just tracking
                    stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
                },
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

        // check if already tracked?
        // We can't easily check line -> decoration without searching.
        // But auto-tagger shouldn't trigger if ID exists (handled upstream).

        const newDec = {
            range: new this.monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
                description: 'ink-id-tracker',
                isWholeLine: true,
                stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
            }
        };

        // Append to existing
        // decorationCollection.set overwrites if we pass same array, but we want to add.
        // .append() is not a method. .set() returns new IDs.
        // We must manage the collection properly. 
        // decorationCollection.set(newDecs) replaces? No, "Set the decorations... replacing the previous ones" -> YES it replaces IF we used deltaDecorations style.
        // createDecorationsCollection() returns an object with .set(), .clear(), .getRanges().
        // .set(newDecorations) "deduces the new decorations... and replaces". 
        // Ah. We need to add ONE.
        // We can use editor.deltaDecorations but decorationCollection wrapper is convenient for bulk.
        // Mixed usage is bad.

        // Actually, createDecorationsCollection IS a wrapper around deltaDecorations that remembers the IDs.
        // If we want to ADD, we should probably get existing, add to list, set again? No, that's expensive.
        // We can just use raw deltaDecorations for append? 
        // But then we need to manually track the IDs in a list to clear them later.

        // Let's stick to `deltaDecorations` directly for granular control since we need to map IDs.
        // Refactor to use raw deltaDecorations and store the string[] of IDs.
    }

    // RE-IMPLEMENTING with raw deltaDecorations to support incremental updates

    /**
     * Add a single ID tracker.
     */
    addId(lineNumber, idStr) {
        const newDec = {
            range: new this.monaco.Range(lineNumber, 1, lineNumber, 1),
            options: {
                description: 'ink-id-tracker',
                isWholeLine: true,
                // Stickiness: we want it to stay with the line.
                stickiness: this.monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
            }
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

                // wait, if I put it at closeIdx, it's `* [Option #id:...]`
                // Yes.
                insertIndex = closeIdx;
            }
        }

        // Reassemble
        const pre = contentPart.substring(0, insertIndex);
        const post = contentPart.substring(insertIndex);

        return pre + fullTag + post + commentPart;
    }
}
