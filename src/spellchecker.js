import nspell from 'nspell';

export class DinkySpellChecker {
    constructor() {
        this.spell = null;
        this.personalDictionary = new Set();
        this.initialized = false;
        this.dictionariesLoaded = false;
        this.currentLocale = null;
        this.baseAff = null;
        this.baseDic = null;
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

            this.baseAff = await affResponse.text();
            this.baseDic = await dicResponse.text();

            this.spell = nspell(this.baseAff, this.baseDic);
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

    setPersonalDictionary(words) {
        if (!Array.isArray(words)) return;

        this.personalDictionary = new Set(words);

        // nspell doesn't support removing words, so we must re-initialize
        if (this.dictionariesLoaded && this.baseAff && this.baseDic) {
            this.spell = nspell(this.baseAff, this.baseDic);
            this.personalDictionary.forEach(word => this.spell.add(word));
        }
    }

    add(word) {
        this.personalDictionary.add(word);
        if (this.spell) {
            this.spell.add(word);
        }
    }

    checkModel(model, monaco) {
        if (!this.spell || !this.dictionariesLoaded) return [];

        const markers = [];
        const lineCount = model.getLineCount();
        const text = model.getValue();

        // Tokenize using Monaco's tokenizer to respect our syntax highlighting rules
        // This gives us true awareness of 'code', 'comment', etc. as defined in renderer.js
        const languageId = model.getLanguageId();
        const tokenizedLines = monaco.editor.tokenize(text, languageId);

        const wordRegex = /[a-zA-Z']+/g;

        for (let i = 1; i <= lineCount; i++) {
            const lineContent = model.getLineContent(i);
            const lineTokens = tokenizedLines[i - 1]; // tokenize returns array matching lines, 0-indexed

            wordRegex.lastIndex = 0;
            let match;
            while ((match = wordRegex.exec(lineContent)) !== null) {
                const word = match[0];
                if (word.length < 2) continue; // Skip single letters

                const startCol = match.index;

                // Find token covering this word
                // Tokens are objects: { offset: number, type: string, language: string }
                // We find the token with the largest offset that is <= startCol
                let tokenType = '';
                if (lineTokens) {
                    for (let t = 0; t < lineTokens.length; t++) {
                        if (lineTokens[t].offset <= startCol) {
                            tokenType = lineTokens[t].type;
                        } else {
                            break; // Sorted by offset, so past this point tokens are irrelevant
                        }
                    }
                }

                // If it's a special token (code, keyword, comment, annotation), skip it.
                // We change to a blocklist approach to be safer:
                // If it looks like code, skip it. If it's unknown or empty, check it.
                const ignoredTypes = ['code', 'keyword', 'comment', 'annotation', 'type', 'delimiter', 'function', 'dinky.name', 'dinky.qualifier', 'dinky.direction'];
                const isIgnored = ignoredTypes.some(t => tokenType.indexOf(t) !== -1);

                if (isIgnored) continue;

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
