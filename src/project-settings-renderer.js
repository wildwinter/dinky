async function init() {
    // Add platform-specific CSS class
    if (window.electronAPI.platform === 'win32') {
        document.body.classList.add('windows');
    } else if (window.electronAPI.platform === 'darwin') {
        document.body.classList.add('macos');
    } else {
        document.body.classList.add('linux');
    }

    // Tab switching
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.getAttribute('data-tab');

            // Remove active class from all tabs and contents
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const content = document.querySelector(`[data-tab-content="${tabName}"]`);
            if (content) {
                content.classList.add('active');
            }
        });
    });

    // Load project config
    const projectConfig = await window.electronAPI.getProjectConfig();

    if (!projectConfig) {
        console.error('No project config available');
        return;
    }

    // Set up checkboxes
    const checkboxes = [
        'outputLocalization',
        'outputRecordingScript',
        'outputDinkStructure',
        'outputStats'
    ];

    // Initialize checkbox values from project config
    checkboxes.forEach(key => {
        const checkbox = document.getElementById(key);
        if (checkbox) {
            checkbox.checked = !!projectConfig[key];

            // Add change listener
            checkbox.addEventListener('change', async (e) => {
                const newValue = e.target.checked;
                const success = await window.electronAPI.setProjectConfig(key, newValue);

                if (!success) {
                    console.error(`Failed to update ${key}`);
                    // Revert the checkbox state
                    e.target.checked = !newValue;
                }
            });
        }
    });

    // Listen for project config updates from main process
    window.electronAPI.onProjectConfigUpdated((updatedConfig) => {
        checkboxes.forEach(key => {
            if (key in updatedConfig) {
                const checkbox = document.getElementById(key);
                if (checkbox) {
                    checkbox.checked = !!updatedConfig[key];
                }
            }
        });
    });

    // Apply initial theme based on system/settings
    const applyThemeClass = (theme) => {
        if (theme && theme.includes('dark')) {
            document.body.classList.add('dark');
            document.body.classList.remove('light');
        } else {
            document.body.classList.add('light');
            document.body.classList.remove('dark');
        }
    };

    // Load settings to get theme preference
    const settings = await window.electronAPI.loadSettings();

    // Apply initial theme - check if we should use dark or light
    if (settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        applyThemeClass('vs-dark');
    } else {
        applyThemeClass('vs');
    }

    // Listen for theme updates
    window.electronAPI.onThemeUpdated((theme) => {
        applyThemeClass(theme);
    });
}

init();
