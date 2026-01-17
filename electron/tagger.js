const TAG_LOC = "id:";

/**
 * Generates a random 4-character alphanumeric ID (A-Z, 0-9).
 */
function generateRandomCode(length = 4) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Constructs the prefix based on the object's ancestry (Knots and Stitches).
 */
function getLocPrefix(ancestry) {
    let prefix = "";
    for (const node of ancestry) {
        // In the parsed AST, named containers are typically "Knot" or "Stitch"
        if (node.typeName === "Knot" || node.typeName === "Stitch") {
            if (node.name) {
                prefix += node.name + "_";
            }
        }
    }
    return prefix;
}

/**
 * Main function to find untagged strings and generate IDs for them.
 * @param {Object} parsedStory - The root object returned by compiler.Parse()
 */
function generateIdsForUntagged(parsedStory) {
    const validTextObjects = [];
    const existingIds = new Set();
    const linesToReplace = [];

    // Recursively find all candidate Text nodes and track their ancestry
    function traverse(obj, parent, ancestry) {
        if (!obj) return;

        // Update ancestry if we are entering a named container
        const currentAncestry = [...ancestry];
        if (obj.typeName === "Knot" || obj.typeName === "Stitch") {
            currentAncestry.push(obj);
        }

        // Check if this is a Text node
        if (obj.typeName === "Text") {
            // Validating content
            const text = obj.text;

            // Ignore empty/whitespace
            const isValidText = text && text.trim().length > 0;

            // Ignore if inside logic (VariableAssignment, StringExpression)
            // Note: In AST, 'parent' tells us if we are in an assignment
            const isLogic = parent && (parent.typeName === "VariableAssignment" || parent.typeName === "StringExpression");

            if (isValidText && !isLogic) {
                validTextObjects.push({
                    node: obj,
                    parent: parent,
                    ancestry: currentAncestry,
                    text: text.trim()
                });
            }
        }

        // Recurse into content
        if (obj.content && Array.isArray(obj.content)) {
            for (const child of obj.content) {
                traverse(child, obj, currentAncestry);
            }
        }

        // Note: Some AST nodes like Choices might store content in other properties 
        // (e.g., choice.choiceOnlyContent), but standard text usually lives in .content
    }

    // Start scanning from root
    traverse(parsedStory, null, []);

    // Detect Existing IDs
    // We must identify all currently used IDs to prevent collisions.
    validTextObjects.forEach(item => {
        const idTag = findLocTagId(item.node, item.parent);
        if (idTag) {
            existingIds.add(idTag);
            item.hasId = true; // Mark as processed
        }
    });

    // Generate New IDs
    validTextObjects.forEach(item => {
        if (item.hasId) return;

        const prefix = getLocPrefix(item.ancestry);
        let newId = "";

        // Try generating a unique ID (limit attempts to prevent infinite loops)
        for (let i = 0; i < 100; i++) {
            const candidate = prefix + generateRandomCode();
            if (!existingIds.has(candidate)) {
                newId = candidate;
                existingIds.add(newId); // Reserve this ID
                break;
            }
        }

        if (!newId) {
            console.error(`Failed to generate unique ID for line: ${item.text}`);
            return;
        }

        // Add to the output list
        if (item.node.debugMetadata) {
            linesToReplace.push({
                file: item.node.debugMetadata.fileName,
                line: item.node.debugMetadata.startLineNumber,
                text: item.text,
                newId: newId,
                fullTag: `#${TAG_LOC}${newId}`
            });
        }
    });

    return linesToReplace;
}

/**
 * Helpers to look for existing tags next to the text node
 */
function findLocTagId(textNode, parent) {
    if (!parent || !parent.content) return null;

    const siblings = parent.content;
    const idx = siblings.indexOf(textNode);
    if (idx === -1) return null;

    // Look ahead for tags
    for (let i = idx + 1; i < siblings.length; i++) {
        const sibling = siblings[i];

        if (sibling.typeName === "Tag") {
            const tagText = sibling.text.trim();
            if (tagText.startsWith(TAG_LOC)) {
                return tagText.substring(TAG_LOC.length);
            }
        }
        // Stop if we hit a newline or another text node (end of this line's "scope")
        else if (sibling.typeName === "Text") {
            // If it's just a newline, stop.
            if (sibling.text === "\n") break;
            // If it's actual text, our scope is definitely over.
            if (sibling.text.trim().length > 0) break;
        }
    }
    return null;
}

export {
    generateIdsForUntagged
}
