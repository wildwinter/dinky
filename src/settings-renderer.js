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

    // Compiler path setup
    const compilerPathDisplay = document.getElementById('compiler-path-display');
    const selectCompilerBtn = document.getElementById('btn-select-compiler');

    async function updateCompilerPathDisplay() {
        const compilerPath = await window.electronAPI.getCompilerPath();
        if (compilerPath) {
            compilerPathDisplay.textContent = compilerPath;
            compilerPathDisplay.classList.remove('empty');
        } else {
            compilerPathDisplay.textContent = 'No compiler selected';
            compilerPathDisplay.classList.add('empty');
        }
    }

    await updateCompilerPathDisplay();

    if (selectCompilerBtn) {
        selectCompilerBtn.addEventListener('click', async () => {
            const newPath = await window.electronAPI.selectCompiler();
            if (newPath) {
                await updateCompilerPathDisplay();
            }
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

    // Apply initial theme based on system/settings
    // Check if dark mode by looking at computed background color
    const applyThemeClass = (theme) => {
        if (theme && theme.includes('dark')) {
            document.body.classList.add('dark');
            document.body.classList.remove('light');
        } else {
            document.body.classList.add('light');
            document.body.classList.remove('dark');
        }
    };

    // Apply initial theme - check if we should use dark or light
    // The nativeTheme will be set based on the theme setting
    if (settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        applyThemeClass('vs-dark');
    } else {
        applyThemeClass('vs');
    }

    // Also listen for theme updates to update the window style itself
    window.electronAPI.onThemeUpdated((theme) => {
        applyThemeClass(theme);
    });
}

init();
