export class IdHidingManager {
    constructor(editor, monaco) {
        this.editor = editor;
        this.monaco = monaco;
        this.isEnabled = false;
        // Tracks decorations no longer needed for functional behavior, 
        // but kept empty to avoid potential reference errors if external code checks it (unlikely).
        this.decorations = [];

        this._initListeners();
    }

    _initListeners() {
        // Only listener needed now is copy interception
        this.setupCopyInterceptor();
    }

    setEnabled(enabled) {
        this.isEnabled = enabled;
        // Setting changed, but we no longer decorate/hide.
    }

    updateDecorations(force = false, targetModel = null) {
        // Logic removed: No longer hiding or decorating IDs.
        // We clean up any existing decorations just in case they persist.
        if (targetModel) {
            // If targetModel is passed, we can't easily clear without tracking, 
            // but since we don't track anymore, we assume no-op or clear all if we had them.
            // Simplest is to do nothing, as the feature is effectively "off".
        } else {
            // Clear any existing decorations on the current model
            this.decorations = this.editor.deltaDecorations(this.decorations, []);
        }
    }

    setupCopyInterceptor() {
        const container = this.editor.getContainerDomNode();
        container.addEventListener('copy', (e) => {
            const selection = this.editor.getSelection();
            if (!selection || selection.isEmpty()) return;

            const model = this.editor.getModel();
            if (!model) return;

            let text = model.getValueInRange(selection);
            // Replace #id:... with empty string
            // Using the same regex assumption as before for stripping
            const cleanedText = text.replace(/#id:[a-zA-Z0-9_]+/g, '');

            if (cleanedText !== text) {
                e.preventDefault();
                e.clipboardData.setData('text/plain', cleanedText);
            }
        });
    }
}
