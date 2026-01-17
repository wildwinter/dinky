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
    const visited = new Set();
    function traverse(obj, parent, ancestry, choiceNode = null) {
        if (!obj) return;
        if (visited.has(obj)) return;
        visited.add(obj);

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
                // Filter out text nodes that ARE the tag content
                // (e.g. if we have '# id:1234', the 'id:1234' is a text node in AST)
                if (text.trim().startsWith(TAG_LOC)) {
                    // Skip tag text
                } else {
                    validTextObjects.push({
                        node: obj,
                        parent: parent,
                        ancestry: currentAncestry,
                        text: text.trim(),
                        choiceNode: choiceNode
                    });
                }
            }
        }

        // Recurse into content
        if (obj.typeName !== "Choice" && obj.content && Array.isArray(obj.content)) {
            for (const child of obj.content) {
                traverse(child, obj, currentAncestry, choiceNode);
            }
        }

        if (obj.typeName === "Choice") {
            const explicitChildren = new Set();
            if (obj.choiceOnlyContent) explicitChildren.add(obj.choiceOnlyContent);
            if (obj.innerContent) explicitChildren.add(obj.innerContent);

            if (obj.choiceOnlyContent) {
                // Traverse the ContentList itself so it becomes the 'parent' for its children
                // Pass 'obj' (the Choice node) as choiceNode context
                traverse(obj.choiceOnlyContent, obj, currentAncestry, obj);
            }
            if (obj.innerContent) {
                traverse(obj.innerContent, obj, currentAncestry, obj);
            }

            // Traverse remaining generic content (Plain choice text lives here)
            if (obj.content && Array.isArray(obj.content)) {
                for (const child of obj.content) {
                    if (!explicitChildren.has(child)) {
                        traverse(child, obj, currentAncestry, obj);
                    }
                }
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
        const idTag = findLocTagId(item.node, item.parent, item.choiceNode);
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
/**
 * Helpers to look for existing tags next to the text node
 * @param {Object} textNode - The text node to check around
 * @param {Object} parent - The parent container (ContentList)
 * @param {Object} choiceNode - Optional choice node if this text is part of a choice
 */
function findLocTagId(textNode, parent, choiceNode = null) {
    // Strategy 1: Look in immediate siblings (standard lines)
    let tag = findTagInSiblings(textNode, parent);
    if (tag) return tag;

    // Strategy 2: If this is a choice, the tag might be in innerContent while text is in choiceOnlyContent
    if (choiceNode && choiceNode.innerContent) {
        // We just look for ANY tag in innerContent, since choice tags apply to the choice as a whole
        // usually found at the beginning of innerContent or mixed in.
        // We'll scan the whole innerContent list for a tag.
        tag = findTagInSiblings(null, choiceNode.innerContent);
        if (tag) return tag;
    }

    return null;
}

function findTagInSiblings(refNode, container) {
    if (!container || !container.content) return null;
    const siblings = container.content;

    // If refNode is provided, start searching after it.
    // If refNode is null, search the whole container (useful for innerContent scan).
    let startIndex = 0;
    if (refNode) {
        const idx = siblings.indexOf(refNode);
        if (idx === -1) return null;
        startIndex = idx + 1;
    }

    for (let i = startIndex; i < siblings.length; i++) {
        const node = siblings[i];
        const type = node.typeName || node.constructor.name;

        // In InkJS AST, a Tag is represented by a Tag node (marker) followed by a Text node containing the tag value.
        // Or sometimes just Tag node? Let's handle the sequence found in debug: Tag(isStart=true) -> Text -> Tag(isStart=false)

        if (type === "Tag" && node.isStart) {
            // Check next sibling for the text
            const nextNode = siblings[i + 1];
            if (nextNode && (nextNode.typeName === "Text" || nextNode.constructor.name === "Text")) {
                const tagText = (nextNode.text || "").trim();
                if (tagText.startsWith(TAG_LOC)) {
                    return tagText.substring(TAG_LOC.length);
                }
            }
        }

        // Also check if the node ITSELF is a text node that looks like a tag (fallback)
        // or if node.typeName === "Tag" and it has text (fallback)
        if (type === "Tag" && node.text && node.text.trim().startsWith(TAG_LOC)) {
            return node.text.trim().substring(TAG_LOC.length);
        }

        // Stop conditions
        if (type === "Text") {
            const txt = node.text || "";
            // If it's the tag value (preceded by Tag marker), we handled it above.
            // But if we are just iterating, how do we know if this Text is content or tag value?
            // Since we filter out explicit tag text in start logic, this should be safe.

            if (txt === "\n") break;
            if (txt.trim().length > 0) {
                // It's some other text. If we are traversing siblings of the target text, this ends the line scope.
                if (refNode) break;
                // If scanning innerContent (refNode null), we continue scanning until end or newline?
                // Usually tags are at the start of innerContent.
            }
        }
    }
    return null;
}

export {
    generateIdsForUntagged
}
