/**
 * Error management and display system
 * Handles error banner display, sorting, and navigation
 */

/**
 * Error banner state management
 */
export class ErrorManager {
    constructor(editorRef) {
        this.editor = editorRef;
        this.currentErrors = [];
        this.errorBannerIndex = 0;
        this.previousErrorsCount = 0;
        this.loadedInkFiles = new Map();
    }

    /**
     * Update the error banner display
     */
    updateErrorBanner() {
        const banner = document.getElementById('error-banner');
        const bannerText = document.getElementById('error-banner-text');
        const prevBtn = document.getElementById('error-banner-prev');
        const nextBtn = document.getElementById('error-banner-next');
        
        if (!this.currentErrors || this.currentErrors.length === 0) {
            banner.style.display = 'none';
            this.currentErrors = [];
            this.errorBannerIndex = 0;
            return;
        }
        
        // Reset index if out of bounds
        if (this.errorBannerIndex >= this.currentErrors.length) {
            this.errorBannerIndex = 0;
        }
        
        // Show the banner
        banner.style.display = 'block';
        
        const error = this.currentErrors[this.errorBannerIndex];
        const errorCount = this.currentErrors.length;
        const errorMessage = error.message || 'Unknown error';
        const lineNumber = error.startLineNumber ? ` [${error.startLineNumber}:${error.startColumn || 1}]` : '';
        
        // Build file info if error has a filePath
        let fileInfo = '';
        if (error.filePath) {
            const filename = error.filePath.replace(/^.*[\\\/]/, '');
            fileInfo = ` in ${filename}`;
        }
        
        bannerText.textContent = `Error (${this.errorBannerIndex + 1}/${errorCount}): ${errorMessage}${lineNumber}${fileInfo}`;
        
        // Buttons are always enabled since navigation wraps around
        prevBtn.disabled = false;
        nextBtn.disabled = false;
    }

    /**
     * Find a file in loadedInkFiles, handling path format differences
     */
    findFileByPath(errorPath) {
        if (!errorPath) return null;
        
        // Try exact match first
        if (this.loadedInkFiles.has(errorPath)) {
            return this.loadedInkFiles.get(errorPath);
        }
        
        // Normalize paths for comparison
        const normalizePath = (p) => p.replace(/\\/g, '/').toLowerCase();
        const normalizedErrorPath = normalizePath(errorPath);
        
        // Try to find by normalized path
        for (const [storedPath, file] of this.loadedInkFiles) {
            if (normalizePath(storedPath) === normalizedErrorPath) {
                return file;
            }
        }
        
        // Try to match by filename if full path doesn't work
        const errorFileName = errorPath.replace(/^.*[\\\/]/, '');
        for (const [storedPath, file] of this.loadedInkFiles) {
            const storedFileName = storedPath.replace(/^.*[\\\/]/, '');
            if (storedFileName === errorFileName) {
                return file;
            }
        }
        
        return null;
    }

    /**
     * Sort errors by file path and line number
     * File order matches the order of files in loadedInkFiles (root first, then includes)
     */
    sortErrors(errors) {
        // Create a map of file paths to their order in the sidebar
        const fileOrder = new Map();
        let order = 0;
        for (const [filePath, file] of this.loadedInkFiles) {
            fileOrder.set(filePath, order++);
        }
        
        // Helper to find file order, handling path format differences
        const getFileOrder = (errorPath) => {
            if (!errorPath) return -1;
            
            // Try exact match first
            if (fileOrder.has(errorPath)) {
                return fileOrder.get(errorPath);
            }
            
            // Normalize paths for comparison
            const normalizePath = (p) => p.replace(/\\/g, '/').toLowerCase();
            const normalizedErrorPath = normalizePath(errorPath);
            
            // Try to find by normalized path
            for (const [storedPath, order] of fileOrder) {
                if (normalizePath(storedPath) === normalizedErrorPath) {
                    return order;
                }
            }
            
            // Try to match by filename if full path doesn't work
            const errorFileName = errorPath.replace(/^.*[\\\/]/, '');
            for (const [storedPath, order] of fileOrder) {
                const storedFileName = storedPath.replace(/^.*[\\\/]/, '');
                if (storedFileName === errorFileName) {
                    return order;
                }
            }
            
            return fileOrder.size; // Unknown files go to the end
        };
        
        return errors.slice().sort((a, b) => {
            // First, sort by file order (as shown in the sidebar)
            const orderA = getFileOrder(a.filePath);
            const orderB = getFileOrder(b.filePath);
            
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            
            // If same file, sort by line number
            const lineA = a.startLineNumber || 0;
            const lineB = b.startLineNumber || 0;
            
            return lineA - lineB;
        });
    }

    /**
     * Navigate to the current banner error
     */
    navigateToBannerError(currentFilePath, loadFileCallback) {
        if (!this.currentErrors || this.currentErrors.length === 0) return;
        
        const error = this.currentErrors[this.errorBannerIndex];
        if (!error) return;
        
        // Check if error is in a different file
        if (error.filePath && error.filePath !== currentFilePath) {
            const file = this.findFileByPath(error.filePath);
            if (file && file.listItem) {
                // Click the file in the list to switch to it
                file.listItem.click();
                // Wait for the file to load before navigating
                setTimeout(() => {
                    const line = error.startLineNumber || 1;
                    const column = error.startColumn || 1;
                    const model = this.editor.getModel();
                    if (model) {
                        this.editor.revealLineInCenter(line);
                        this.editor.setPosition({ lineNumber: line, column: column });
                        this.editor.focus();
                    }
                }, 200);
                return;
            }
        }
        
        // Navigate to the error location in current file
        const line = error.startLineNumber || 1;
        const column = error.startColumn || 1;
        
        if (this.editor && this.editor.getModel()) {
            this.editor.revealLineInCenter(line);
            this.editor.setPosition({ lineNumber: line, column: column });
            this.editor.focus();
        }
    }

    /**
     * Navigate to previous error
     */
    previousError() {
        if (this.currentErrors.length === 0) return;
        this.errorBannerIndex = (this.errorBannerIndex - 1 + this.currentErrors.length) % this.currentErrors.length;
        this.updateErrorBanner();
    }

    /**
     * Navigate to next error
     */
    nextError() {
        if (this.currentErrors.length === 0) return;
        this.errorBannerIndex = (this.errorBannerIndex + 1) % this.currentErrors.length;
        this.updateErrorBanner();
    }

    /**
     * Close the error banner
     */
    closeErrorBanner() {
        this.currentErrors = [];
        this.errorBannerIndex = 0;
        this.updateErrorBanner();
    }

    /**
     * Set the loaded ink files map
     */
    setLoadedInkFiles(filesMap) {
        this.loadedInkFiles = filesMap;
    }

    /**
     * Update current errors array
     */
    setErrors(errors) {
        this.currentErrors = errors;
    }

    /**
     * Get current errors
     */
    getErrors() {
        return this.currentErrors;
    }
}
