/**
 * Validation engine for Dinky dialogue
 * Handles character name and writing status tag validation
 */

/**
 * Compute a solid contrasting background color for a given RGB text color.
 * Light text colors (e.g. yellow) get a dark background; dark text colors get a light one.
 * Both the hue and saturation of the text color are preserved so the pair looks coherent.
 */
function contrastingBackground(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (d > 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        else if (max === gn) h = ((bn - rn) / d + 2) / 6;
        else h = ((rn - gn) / d + 4) / 6;
    }

    // Perceived luminance — determines whether to use a dark or light background
    const luminance = 0.2126 * rn + 0.7152 * gn + 0.0722 * bn;
    const isLight = luminance > 0.5;

    const bgL = isLight ? 0.25 : 0.85;
    // Keep saturation but cap it so the background isn't overly vivid.
    // Achromatic text (grey) gets an achromatic background.
    const bgS = s < 0.05 ? 0 : Math.min(s, isLight ? 0.7 : 0.4);

    const q = bgL < 0.5 ? bgL * (1 + bgS) : bgL + bgS - bgL * bgS;
    const p = 2 * bgL - q;
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ];
}

/**
 * Validation engine for character names and writing status tags
 */
export class ValidationEngine {
    constructor(monacoRef) {
        this.monaco = monacoRef;
        this.projectCharacters = [];
        this.projectWritingStatusTags = [];
    }

    /**
     * Update project characters list
     */
    setProjectCharacters(characters) {
        this.projectCharacters = characters;
    }

    /**
     * Update project writing status tags list
     */
    setProjectWritingStatusTags(tags) {
        this.projectWritingStatusTags = tags;
    }

    /**
     * Validate character names in text
     * @param {string} text
     * @param {Function} detectDinkyGlobal - Function to detect global Dinky mode
     * @returns {Array} Array of error markers
     */
    validateCharacterNamesInText(text, detectDinkyGlobal) {
        const lines = text.split(/\r?\n/);
        const markers = [];
        const validIds = new Set(this.projectCharacters.map(c => c.ID));

        // Regex to capture Name in Dinky lines
        const dinkyLineRegex = /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/;

        // Check Global Mode
        const isGlobalDinky = detectDinkyGlobal(text);
        let inDinkyContext = isGlobalDinky;

        lines.forEach((line, index) => {
            const trimmed = line.trim();

            if (!isGlobalDinky) {
                // Check for Knot Start
                if (/^={2,}/.test(trimmed)) {
                    // Reset context on new knot
                    inDinkyContext = false;

                    // Check if this knot is tagged immediately
                    if (/#\s*dink(?=\s|$)/.test(trimmed)) {
                        inDinkyContext = true;
                    }
                } else {
                    // Check for delayed #dink tag in the flow
                    if (/#\s*dink(?=\s|$)/.test(trimmed)) {
                        inDinkyContext = true;
                    }
                }
            }

            // Skip validation if not in Dink context
            if (!inDinkyContext) return;

            const match = line.match(dinkyLineRegex);
            if (match) {
                const name = match[2];
                const nameStartCol = match[1].length + 1;
                const nameEndCol = nameStartCol + name.length;

                if (!validIds.has(name)) {
                    markers.push({
                        message: `Invalid Character Name: ${name}`,
                        severity: this.monaco.MarkerSeverity.Error,
                        startLineNumber: index + 1,
                        startColumn: nameStartCol,
                        endLineNumber: index + 1,
                        endColumn: nameEndCol,
                        source: 'dinky-validator',
                        code: name // Store name for quick fix
                    });
                }
            }
        });

        return markers;
    }

    /**
     * Validate character names in model
     */
    validateCharacterNames(model, detectDinkyGlobal) {
        const text = model.getValue();
        return this.validateCharacterNamesInText(text, detectDinkyGlobal);
    }

    /**
     * Validate writing status tags in text
     * @param {string} text
     * @returns {Array} Array of error markers
     */
    validateWritingStatusTagsInText(text) {
        const lines = text.split(/\r?\n/);
        const markers = [];
        const validTags = new Set(this.projectWritingStatusTags.map(ws => ws.wstag));

        // Regex to capture #ws:tag
        const wsTagRegex = /#ws:(\S+)/g;

        lines.forEach((line, index) => {
            let match;
            // Reset regex for each line
            wsTagRegex.lastIndex = 0;

            while ((match = wsTagRegex.exec(line)) !== null) {
                const tag = match[1];
                const tagStartCol = match.index + 1; // +1 for Monaco 1-based columns
                const tagEndCol = tagStartCol + match[0].length;

                if (!validTags.has(tag)) {
                    markers.push({
                        message: `Invalid writing status tag: ${tag}`,
                        severity: this.monaco.MarkerSeverity.Error,
                        startLineNumber: index + 1,
                        startColumn: tagStartCol,
                        endLineNumber: index + 1,
                        endColumn: tagEndCol,
                        source: 'ws-validator',
                        code: tag // Store tag for quick fix
                    });
                }
            }
        });

        return markers;
    }

    /**
     * Validate writing status tags in model
     */
    validateWritingStatusTags(model) {
        const text = model.getValue();
        return this.validateWritingStatusTagsInText(text);
    }

    /**
     * Highlight writing status tags in a model
     * @param {Object} model
     * @param {Object} decorationCollection
     */
    highlightWritingStatusTags(model, decorationCollection) {
        if (!model || this.projectWritingStatusTags.length === 0) {
            decorationCollection.clear();
            return;
        }

        const text = model.getValue();
        const lines = text.split(/\r?\n/);
        const decorations = [];

        // Create a map of wstag -> color for quick lookup
        const tagColorMap = new Map();
        this.projectWritingStatusTags.forEach(ws => {
            if (ws.wstag && ws.color) {
                tagColorMap.set(ws.wstag, ws.color);
            }
        });

        // Regex to capture #ws:tag
        const wsTagRegex = /#ws:(\S+)/g;

        lines.forEach((line, index) => {
            let match;
            // Reset regex for each line
            wsTagRegex.lastIndex = 0;

            while ((match = wsTagRegex.exec(line)) !== null) {
                const tag = match[1];
                const color = tagColorMap.get(tag);

                if (color) {
                    // Convert hex color (RRGGBB) to RGB components
                    const r = parseInt(color.substring(0, 2), 16);
                    const g = parseInt(color.substring(2, 4), 16);
                    const b = parseInt(color.substring(4, 6), 16);

                    // Dynamically create CSS rule for this specific color
                    const styleId = `ws-tag-style-${color}`;
                    const className = `ws-tag-highlight-${color}`;

                    if (!document.getElementById(styleId)) {
                        const [bgR, bgG, bgB] = contrastingBackground(r, g, b);
                        const style = document.createElement('style');
                        style.id = styleId;
                        style.textContent = `
                            .${className} {
                                background-color: rgb(${bgR}, ${bgG}, ${bgB}) !important;
                                color: rgb(${r}, ${g}, ${b}) !important;
                                border-radius: 2px;
                            }
                        `;
                        document.head.appendChild(style);
                    }

                    decorations.push({
                        range: new this.monaco.Range(
                            index + 1,
                            match.index + 1,
                            index + 1,
                            match.index + 1 + match[0].length
                        ),
                        options: {
                            inlineClassName: className
                        }
                    });
                }
            }
        });

        decorationCollection.set(decorations);
    }
}
