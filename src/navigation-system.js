/**
 * Navigation system for editor
 * Handles navigation dropdown, history, and knot/stitch discovery
 */

/**
 * Navigation system management
 */
export class NavigationSystem {
    constructor(editorRef) {
        this.editor = editorRef;
        this.navDropdown = document.getElementById('nav-dropdown');
        this.loadedInkFiles = new Map();
        this.currentFilePath = null;
        
        // Navigation history for back/forward functionality
        this.navigationHistory = [];
        this.navigationHistoryIndex = -1;
        this.lastNavigationLocation = { filePath: null, knotName: null };
        this.isNavigatingHistory = false;
        
        // Navigation structure caching for performance
        this.cachedNavigationStructure = null;
        this.navigationStructureDirty = true;
        
        // UI state
        this.isUpdatingDropdown = false;
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        this.navDropdown.addEventListener('change', () => this.onDropdownChange());
        this.editor.onDidChangeCursorPosition(() => this.onCursorPositionChange());
    }

    /**
     * Parse all files in the project to extract file/knot/stitch structure
     * Uses caching to avoid reparsing when structure hasn't changed
     */
    parseNavigationStructure() {
        // Return cached structure if it's still valid
        if (!this.navigationStructureDirty && this.cachedNavigationStructure !== null) {
            return this.cachedNavigationStructure;
        }

        const structure = [];

        // Process all loaded files
        for (const [filePath, file] of this.loadedInkFiles) {
            // Add the file as an entry
            structure.push({
                type: 'file',
                name: file.relativePath,
                filePath: filePath,
                line: 0,
                indent: 0
            });

            // Get file content
            let content;
            if (filePath === this.currentFilePath) {
                // Use current editor content for active file
                const model = this.editor.getModel();
                content = model ? model.getValue() : file.content;
            } else {
                content = file.content;
            }

            const lines = content.split(/\r?\n/);
            let currentKnot = null;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();

                // Check for knot: === KnotName or === KnotName ===
                const knotMatch = trimmed.match(/^={2,}\s*([\w_]+)/);
                if (knotMatch) {
                    currentKnot = {
                        type: 'knot',
                        name: knotMatch[1],
                        filePath: filePath,
                        line: i + 1,
                        indent: 3
                    };
                    structure.push(currentKnot);
                    continue;
                }

                // Check for stitch: = StitchName
                const stitchMatch = trimmed.match(/^=\s+([\w_]+)/);
                if (stitchMatch && currentKnot) {
                    structure.push({
                        type: 'stitch',
                        name: `${currentKnot.name}.${stitchMatch[1]}`,
                        filePath: filePath,
                        line: i + 1,
                        indent: 3,
                        knotName: currentKnot.name,
                        stitchName: stitchMatch[1]
                    });
                }
            }
        }

        // Cache the result and mark as clean
        this.cachedNavigationStructure = structure;
        this.navigationStructureDirty = false;

        return structure;
    }

    /**
     * Populate the dropdown with navigation structure
     */
    updateNavigationDropdown() {
        if (this.loadedInkFiles.size === 0) {
            this.navDropdown.innerHTML = '<option value="">No file loaded</option>';
            return;
        }

        const structure = this.parseNavigationStructure();
        
        // Use DocumentFragment to batch DOM insertions
        const fragment = document.createDocumentFragment();
        
        structure.forEach(item => {
            const option = document.createElement('option');
            option.value = `${item.type}:${item.filePath}:${item.line}`;

            // Create indentation using Unicode non-breaking spaces
            const indent = '\u00A0\u00A0'.repeat(item.indent);
            let displayName = item.name;
            
            if (item.type === 'file') {
                displayName = `📄 ${item.name}`;
            }
            
            option.textContent = `${indent}${displayName}`;
            fragment.appendChild(option);
        });
        
        // Single DOM update with all options at once
        this.navDropdown.innerHTML = '';
        this.navDropdown.appendChild(fragment);
    }

    /**
     * Find the current location based on cursor position
     */
    findCurrentLocation(lineNumber) {
        const structure = this.parseNavigationStructure();

        // Filter to only items in the current file
        const currentFileItems = structure.filter(item => item.filePath === this.currentFilePath);

        if (currentFileItems.length === 0) return null;

        // Find the last item that is at or before the cursor line
        let currentItem = currentFileItems[0]; // Default to file

        for (const item of currentFileItems) {
            if (item.line <= lineNumber) {
                currentItem = item;
            } else {
                break;
            }
        }

        return currentItem;
    }

    /**
     * Update dropdown selection based on cursor position
     */
    updateDropdownSelection() {
        if (this.isUpdatingDropdown) return;

        const position = this.editor.getPosition();
        if (!position) return;

        const currentItem = this.findCurrentLocation(position.lineNumber);
        if (!currentItem) return;

        const value = `${currentItem.type}:${currentItem.filePath}:${currentItem.line}`;

        // Find and select the matching option
        for (let i = 0; i < this.navDropdown.options.length; i++) {
            if (this.navDropdown.options[i].value === value) {
                this.isUpdatingDropdown = true;
                this.navDropdown.selectedIndex = i;
                this.isUpdatingDropdown = false;
                break;
            }
        }
    }

    /**
     * Navigate to a specific line in the editor
     */
    navigateToLine(line) {
        if (line === 0) {
            // Navigate to top of file
            this.editor.setPosition({ lineNumber: 1, column: 1 });
            this.editor.revealLineInCenter(1);
        } else {
            // Navigate to the line after the heading (knot/stitch declaration)
            const targetLine = line + 1;
            this.editor.setPosition({ lineNumber: targetLine, column: 1 });
            this.editor.revealLineInCenter(targetLine);
        }

        this.editor.focus();
    }

    /**
     * Add a navigation point to history
     */
    addToNavigationHistory(filePath, lineNumber) {
        // Remove any forward history if we're not at the end
        if (this.navigationHistoryIndex < this.navigationHistory.length - 1) {
            this.navigationHistory = this.navigationHistory.slice(0, this.navigationHistoryIndex + 1);
        }

        // Add new entry if it's different from the last one
        const lastEntry = this.navigationHistory[this.navigationHistory.length - 1];
        if (!lastEntry || lastEntry.filePath !== filePath || lastEntry.line !== lineNumber) {
            this.navigationHistory.push({ filePath, line: lineNumber });
            this.navigationHistoryIndex = this.navigationHistory.length - 1;
        }

        this.updateNavigationButtons();
    }

    /**
     * Navigate back in history
     */
    navigateBack(loadFileCallback) {
        if (this.navigationHistoryIndex > 0) {
            this.navigationHistoryIndex--;
            const entry = this.navigationHistory[this.navigationHistoryIndex];
            
            this.isNavigatingHistory = true;
            
            if (entry.filePath !== this.currentFilePath) {
                const file = this.loadedInkFiles.get(entry.filePath);
                if (file && file.listItem) {
                    file.listItem.click();
                    setTimeout(() => {
                        this.navigateToLine(entry.line);
                        this.isNavigatingHistory = false;
                        this.updateNavigationButtons();
                    }, 100);
                    return;
                }
            }
            
            this.navigateToLine(entry.line);
            this.isNavigatingHistory = false;
            this.updateNavigationButtons();
        }
    }

    /**
     * Navigate forward in history
     */
    navigateForward() {
        if (this.navigationHistoryIndex < this.navigationHistory.length - 1) {
            this.navigationHistoryIndex++;
            const entry = this.navigationHistory[this.navigationHistoryIndex];
            
            this.isNavigatingHistory = true;
            
            if (entry.filePath !== this.currentFilePath) {
                const file = this.loadedInkFiles.get(entry.filePath);
                if (file && file.listItem) {
                    file.listItem.click();
                    setTimeout(() => {
                        this.navigateToLine(entry.line);
                        this.isNavigatingHistory = false;
                        this.updateNavigationButtons();
                    }, 100);
                    return;
                }
            }
            
            this.navigateToLine(entry.line);
            this.isNavigatingHistory = false;
            this.updateNavigationButtons();
        }
    }

    /**
     * Update the enabled/disabled state of back/forward buttons
     */
    updateNavigationButtons() {
        const backBtn = document.getElementById('btn-back');
        const forwardBtn = document.getElementById('btn-forward');
        
        if (this.navigationHistoryIndex > 0) {
            backBtn.style.opacity = '1';
            backBtn.style.pointerEvents = 'auto';
        } else {
            backBtn.style.opacity = '0.5';
            backBtn.style.pointerEvents = 'none';
        }
        
        if (this.navigationHistoryIndex < this.navigationHistory.length - 1) {
            forwardBtn.style.opacity = '1';
            forwardBtn.style.pointerEvents = 'auto';
        } else {
            forwardBtn.style.opacity = '0.5';
            forwardBtn.style.pointerEvents = 'none';
        }
    }

    /**
     * Find a knot at the given cursor position
     */
    findCurrentKnot(model, position) {
        // Scan backwards from current line
        for (let i = position.lineNumber; i >= 1; i--) {
            const line = model.getLineContent(i);
            const match = line.match(/^\s*={2,}\s*([\w_]+)/);
            if (match) {
                return match[1];
            }
        }
        return null;
    }

    /**
     * Invalidate cached navigation structure
     */
    invalidateCache() {
        this.navigationStructureDirty = true;
        this.cachedNavigationStructure = null;
    }

    /**
     * Set the loaded ink files
     */
    setLoadedInkFiles(filesMap) {
        this.loadedInkFiles = filesMap;
        this.invalidateCache();
    }

    /**
     * Set current file path
     */
    setCurrentFilePath(filePath) {
        this.currentFilePath = filePath;
    }

    /**
     * Refresh navigation dropdown and selection
     */
    refreshNavigationDropdown() {
        this.updateNavigationDropdown();
        this.updateDropdownSelection();
    }

    /**
     * Event handler for dropdown change
     */
    onDropdownChange() {
        if (this.isUpdatingDropdown) return;

        const selected = this.navDropdown.value;
        if (!selected) return;

        const parts = selected.split(':');
        const type = parts[0];
        const filePath = parts.slice(1, -1).join(':'); // Handle colons in file path
        const line = parseInt(parts[parts.length - 1], 10);

        // Switch to the file if needed
        if (filePath !== this.currentFilePath) {
            const file = this.loadedInkFiles.get(filePath);
            if (file && file.listItem) {
                file.listItem.click();
                // Wait a tick for the file to load before navigating
                setTimeout(() => {
                    this.navigateToLine(line);
                    this.addToNavigationHistory(filePath, line);
                }, 100);
                return;
            }
        }

        this.navigateToLine(line);
        this.addToNavigationHistory(filePath, line);
    }

    /**
     * Event handler for cursor position change
     */
    onCursorPositionChange() {
        this.updateDropdownSelection();
        
        // Don't track history if we're navigating via back/forward
        if (this.isNavigatingHistory) return;
        
        // Track navigation when jumping to a different knot/stitch
        if (this.currentFilePath) {
            const position = this.editor.getPosition();
            if (position) {
                const currentLocation = this.findCurrentLocation(position.lineNumber);
                const currentKnotName = currentLocation ? currentLocation.name : null;
                
                // Only track if the knot/stitch changed
                if (this.lastNavigationLocation.filePath !== this.currentFilePath || 
                    this.lastNavigationLocation.knotName !== currentKnotName) {
                    this.lastNavigationLocation = { filePath: this.currentFilePath, knotName: currentKnotName };
                    this.addToNavigationHistory(this.currentFilePath, position.lineNumber);
                }
            }
        }
    }

    /**
     * Get flag for whether we're navigating history
     */
    getIsNavigatingHistory() {
        return this.isNavigatingHistory;
    }

    /**
     * Set flag for whether we're navigating history
     */
    setIsNavigatingHistory(value) {
        this.isNavigatingHistory = value;
    }
}
