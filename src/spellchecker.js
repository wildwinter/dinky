import nspell from 'nspell';

export class DinkySpellChecker {
    constructor() {
        this.spell = null;
        this.personalDictionary = new Set();
        this.initialized = false;
        this.dictionariesLoaded = false;
        this.currentLocale = null;
    }

    async init(locale = 'en_GB') {
        if (this.initialized && this.currentLocale === locale) return;

        await this.switchLocale(locale);
        this.initialized = true;
    }

    async switchLocale(locale) {
        try {
            console.log(`Fetching dictionaries for ${locale}...`);
            const dictName = locale.replace('-', '_');

            const affResponse = await fetch(`dictionaries/${dictName}.aff`);
            const dicResponse = await fetch(`dictionaries/${dictName}.dic`);

            if (!affResponse.ok || !dicResponse.ok) {
                console.error('Failed to load dictionaries for', locale);
                return;
            }

            const aff = await affResponse.text();
            const dic = await dicResponse.text();

            this.spell = nspell(aff, dic);
            this.currentLocale = locale;
            this.dictionariesLoaded = true;
            console.log(`Spellchecker initialized with ${locale}`);

            // Reprocess personal dictionary
            this.personalDictionary.forEach(word => this.spell.add(word));
        } catch (e) {
            console.error('Error switching spellchecker locale', e);
        }
    }

    loadPersonalDictionary(words) {
        if (!Array.isArray(words)) return;
        words.forEach(word => {
            if (!this.personalDictionary.has(word)) {
                this.personalDictionary.add(word);
                if (this.spell) {
                    this.spell.add(word);
                }
            }
        });
    }

    add(word) {
        this.personalDictionary.add(word);
        if (this.spell) {
            this.spell.add(word);
        }
    }

    checkModel(model) {
        if (!this.spell || !this.dictionariesLoaded) return [];

        const markers = [];
        const lineCount = model.getLineCount();

        // Regex for words: Allow letters and apostrophes
        const wordRegex = /[a-zA-Z']+/g;

        for (let i = 1; i <= lineCount; i++) {
            const lineContent = model.getLineContent(i);

            // Skip comments (simple check)
            // TODO: Better context awareness from tokenizer would be ideal
            // but for now, let's just avoid spellchecking totally commented lines
            let trimmed = lineContent.trim();

            // Exclusions:
            // 1. Comments (start with // or /*)
            if (trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
            // 2. INCLUDE lines
            if (trimmed.startsWith('INCLUDE ')) continue;
            // 3. Definitions (VAR, CONST, EXTERNAL)
            if (trimmed.startsWith('VAR ') || trimmed.startsWith('CONST ') || trimmed.startsWith('EXTERNAL ')) continue;
            // 4. Code lines (start with ~)
            if (trimmed.startsWith('~')) continue;
            // 5. Divert lines (start with ->)
            if (trimmed.startsWith('->')) continue;
            // 6. Knot/Stitch lines (start with =)
            if (trimmed.startsWith('=')) continue;

            // Strip inline comments from the line content before checking
            // We only handle // comments for inline stripping to stay safe
            const commentIndex = lineContent.indexOf('//');
            if (commentIndex !== -1) {
                lineContent = lineContent.substring(0, commentIndex);
            }

            wordRegex.lastIndex = 0;
            let match;
            while ((match = wordRegex.exec(lineContent)) !== null) {
                const word = match[0];
                if (word.length < 2) continue; // Skip single letters

                // Basic heuristic to skip some Ink specific things if possible
                // e.g. identifiers in upper case (VAR NAMES often) or mixed case might be code
                // But Ink text is freeform.

                if (!this.spell.correct(word)) {
                    markers.push({
                        message: `Misspelled: ${word}`,
                        severity: 2, // monaco.MarkerSeverity.Info = 2
                        startLineNumber: i,
                        startColumn: match.index + 1,
                        endLineNumber: i,
                        endColumn: match.index + 1 + word.length,
                        source: 'spellcheck',
                        code: word // Use code field to pass the word to the action provider
                    });
                }
            }
        }
        return markers;
    }

    getSuggestions(word) {
        if (!this.spell) return [];
        return this.spell.suggest(word);
    }
}
