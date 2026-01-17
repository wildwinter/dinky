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

    // Listen for theme updates from main process
    window.electronAPI.onSettingsUpdated((newSettings) => {
        if (newSettings.theme && newSettings.theme !== themeSelect.value) {
            themeSelect.value = newSettings.theme;
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
