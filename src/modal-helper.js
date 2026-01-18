export class ModalHelper {
    constructor(config) {
        this.overlay = document.getElementById(config.overlayId);
        this.confirmBtn = document.getElementById(config.confirmBtnId);
        this.cancelBtn = document.getElementById(config.cancelBtnId);
        this.onConfirm = config.onConfirm;
        this.onValidate = config.onValidate || (() => true);
        this.onShow = config.onShow || (() => { });
        this.onCancel = config.onCancel || (() => { });

        this._initListeners();
    }

    _initListeners() {
        this.confirmBtn.addEventListener('click', async () => {
            if (this.confirmBtn.disabled) return;
            this.confirmBtn.disabled = true; // Prevent double submission
            try {
                const success = await this.onConfirm();
                if (success) {
                    this.close();
                } else {
                    this.validate(); // Re-enable based on validation if failed
                }
            } catch (e) {
                console.error("Modal confirm action failed", e);
                this.validate();
            }
        });

        this.cancelBtn.addEventListener('click', () => {
            this.onCancel();
            this.close();
        });

        this.overlay.addEventListener('keydown', (e) => {
            if (this.overlay.style.display === 'none') return;
            if (e.key === 'Enter') {
                if (!this.confirmBtn.disabled) {
                    this.confirmBtn.click();
                }
            } else if (e.key === 'Escape') {
                this.onCancel();
                this.close();
            }
        });
    }

    open(...args) {
        this.onShow(...args);
        this.overlay.style.display = 'flex';
        this.validate();
        const input = this.overlay.querySelector('input');
        if (input) {
            input.focus();
            if (input.value) input.select();
        }
    }

    close() {
        this.overlay.style.display = 'none';
        // Reset button state slightly delayed or immediately ensure clean state
        this.confirmBtn.disabled = false;
    }

    validate() {
        this.confirmBtn.disabled = !this.onValidate();
    }
}
