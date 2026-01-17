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
            for (let i = 0; i < obj.content.length; i++) {
                const child = obj.content[i];

                // Check if this is a Tag Start. If so, the next node is likely the Tag Text.
                // We want to skip that text node so it's not treated as "content to be tagged".
                const type = child.typeName || child.constructor.name;
                const isTagStart = (type === "Tag" && child.isStart);

                if (isTagStart) {
                    const nextChild = obj.content[i + 1];
                    // Check next child type
                    const nextType = nextChild ? (nextChild.typeName || nextChild.constructor.name) : "";

                    if (nextChild && nextType === "Text") {
                        // Skip the text node
                        // We still traverse the Tag node itself? (It doesn't have content usually)
                        traverse(child, obj, currentAncestry, choiceNode);

                        // Skip next
                        i++;
                        // Do we traverse the text node? NO.
                        continue;
                    }
                }

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
    let siblings = container.content;

    // If refNode is provided, start searching after it.
    if (refNode) {
        const idx = siblings.indexOf(refNode);
        if (idx === -1) return null;
        const startIndex = idx + 1;
        siblings = siblings.slice(startIndex);
    }

    // Helper generator to Flatten the AST node stream
    // This allows us to transparently handle nested ContentLists
    function* iterateNodes(nodeList) {
        if (!nodeList) return;
        for (const node of nodeList) {
            const type = node.typeName || node.constructor.name;
            if (type === "ContentList" && node.content) {
                yield* iterateNodes(node.content);
            } else {
                yield node;
            }
        }
    }

    let pendingTagStart = false;

    // Iterate through the visible siblings (and their children if they are containers)
    for (const node of iterateNodes(siblings)) {
        const type = node.typeName || node.constructor.name;

        if (type === "Tag") {
            pendingTagStart = node.isStart;
            // Also check for self-contained text (fallback for some tag formats)
            if (node.text && node.text.trim().startsWith(TAG_LOC)) {
                return node.text.trim().substring(TAG_LOC.length);
            }
        } else if (type === "Text") {
            const txt = (node.text || "").trim();

            if (pendingTagStart) {
                // This text node is the content of the preceding Tag start.
                if (txt.startsWith(TAG_LOC)) {
                    // FOUND IT!
                    return txt.substring(TAG_LOC.length);
                }
                // It was a tag, but not our ID tag. 
                // We consumed the pending tag start state.
                pendingTagStart = false;
            } else {
                // This is normal text content.
                // If it's non-empty, it means we have hit subsequent content on the same line.
                // Does this invalidate the search? 

                // If we are searching for an ID for 'refNode', usually the ID must be immediate.
                // BUT the user reported issues where intervening text broke the link.
                // To fix the "double tagging" bug where 'Option x #id:123' generates a new ID:
                // We should NOT break on text if we are just looking for *an* ID on this line segment.

                // However, we must be careful not to consume an ID that belongs to a NEXT line segment 
                // if Ink considers them separate.
                // But generally, one line = one ID.
                // So we will CONTINUE searching even if we see text.

                // Only break on explicit line breaks or ends
                if (node.text === "\n") break;
            }
        }
    }
    return null;
}

export {
    generateIdsForUntagged
}
