async function init() {
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
        // Also send specific update if needed, but setSetting broadcasts settings-updated
        // Let's check if we need to explicitly call update-spell-locale
        // Actually, renderer.js listens for settings-updated if we add it there.
        // Wait, renderer.js has window.electronAPI.onUpdateSpellLocale.
        // Let's see if we should trigger that.
        // The menu.js does:
        // await saveSettings({ spellCheckerLocale: 'en_GB' });
        // safeSend(win, 'update-spell-locale', 'en_GB');
    });

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
    // Actually our setupThemeListener in main process handles this via nativeTheme event -> checks theme source -> updates window colors
    // But we might want to ensure the body class is set if we were using CSS classes for theme (like in main window)
    // The main window uses onThemeUpdated. Let's add that here too.
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
