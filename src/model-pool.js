/**
 * Monaco model pool management
 * Implements LRU (Least Recently Used) caching for editor models
 */

/**
 * Model pool for efficient reuse of Monaco editor models
 */
export class ModelPool {
    constructor(maxPooledModels = 5) {
        this.modelPool = new Map(); // filePath -> MonacoModel
        this.MAX_POOLED_MODELS = maxPooledModels;
        this.pooledModelOrder = []; // Track LRU order
    }

    /**
     * Get or create a model for the given file path
     * @param {string} filePath
     * @param {string} content
     * @param {string} langId - Language ID (e.g., 'ink', 'ink-dinky')
     * @param {typeof import('monaco-editor')} monaco
     * @returns {typeof import('monaco-editor').editor.ITextModel}
     */
    getOrCreateModel(filePath, content, langId, monaco) {
        // Check if model exists in pool
        if (this.modelPool.has(filePath)) {
            const model = this.modelPool.get(filePath);
            // Update LRU order
            this.pooledModelOrder = this.pooledModelOrder.filter(p => p !== filePath);
            this.pooledModelOrder.push(filePath);
            return model;
        }

        // Create new model
        const newModel = monaco.editor.createModel(content, langId);
        
        // Add to pool and track order
        this.modelPool.set(filePath, newModel);
        this.pooledModelOrder.push(filePath);
        
        // Evict oldest model if pool exceeds max size
        if (this.modelPool.size > this.MAX_POOLED_MODELS) {
            const oldestPath = this.pooledModelOrder.shift();
            const oldModel = this.modelPool.get(oldestPath);
            if (oldModel) {
                oldModel.dispose();
            }
            this.modelPool.delete(oldestPath);
        }
        
        return newModel;
    }

    /**
     * Clear all pooled models
     */
    clearPool() {
        // Dispose all pooled models
        for (const [filePath, model] of this.modelPool) {
            if (model) {
                model.dispose();
            }
        }
        this.modelPool.clear();
        this.pooledModelOrder = [];
    }

    /**
     * Get the number of models currently in the pool
     * @returns {number}
     */
    getPoolSize() {
        return this.modelPool.size;
    }

    /**
     * Check if a model is in the pool
     * @param {string} filePath
     * @returns {boolean}
     */
    hasModel(filePath) {
        return this.modelPool.has(filePath);
    }

    /**
     * Get a model from the pool without updating LRU order
     * @param {string} filePath
     * @returns {typeof import('monaco-editor').editor.ITextModel | null}
     */
    getModel(filePath) {
        return this.modelPool.get(filePath) || null;
    }

    /**
     * Remove a model from the pool
     * @param {string} filePath
     */
    removeModel(filePath) {
        const model = this.modelPool.get(filePath);
        if (model) {
            model.dispose();
        }
        this.modelPool.delete(filePath);
        this.pooledModelOrder = this.pooledModelOrder.filter(p => p !== filePath);
    }
}
