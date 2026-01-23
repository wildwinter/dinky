async function init() {
    // Add platform-specific CSS class
    if (window.electronAPI.platform === 'win32') {
        document.body.classList.add('windows');
    } else if (window.electronAPI.platform === 'darwin') {
        document.body.classList.add('macos');
    } else {
        document.body.classList.add('linux');
    }

    // Load initial settings
    const settings = await window.electronAPI.loadSettings();

    // Theme setup
    const themeSelect = document.getElementById('theme-select');
    if (settings.theme) {
        themeSelect.value = settings.theme;
    }

    themeSelect.addEventListener('change', (e) => {
        const newTheme = e.target.value;
        window.electronAPI.setTheme(newTheme);
    });



    // Language setup
    const languageSelect = document.getElementById('language-select');
    const currentLocale = settings.spellCheckerLocale || 'en_GB';
    languageSelect.value = currentLocale;

    languageSelect.addEventListener('change', (e) => {
        const newLocale = e.target.value;
        // Broadcast to all windows including main which handles the actual spellchecker switch
        window.electronAPI.setSetting('spellCheckerLocale', newLocale);
    });

    const editDictBtn = document.getElementById('btn-edit-dictionary');
    if (editDictBtn) {
        editDictBtn.addEventListener('click', () => {
            window.electronAPI.editProjectDictionary();
        });
    }

    // Listen for setting updates from main process
    window.electronAPI.onSettingsUpdated((newSettings) => {
        if (newSettings.theme && newSettings.theme !== themeSelect.value) {
            themeSelect.value = newSettings.theme;
        }
        if (newSettings.spellCheckerLocale && newSettings.spellCheckerLocale !== languageSelect.value) {
            languageSelect.value = newSettings.spellCheckerLocale;
        }
    });

    // Also listen for theme updates to update the window style itself
    window.electronAPI.onThemeUpdated((theme) => {
        // theme is likely 'vs' or 'vs-dark' based on main window logic?
        // Wait, setupThemeListener sends 'theme-updated' with 'vs' or 'vs-dark'.
        if (theme.includes('dark')) {
            document.body.classList.add('dark');
            document.body.classList.remove('light');
        } else {
            document.body.classList.add('light');
            document.body.classList.remove('dark');
        }
    });
}

init();
