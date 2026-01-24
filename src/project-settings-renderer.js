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

    // Get project path for relative path calculations
    const projectPath = projectConfig._projectPath;
    const projectDir = projectPath ? projectPath.substring(0, projectPath.lastIndexOf('/')) : '';

    // Helper function to convert relative path to absolute
    const resolveRelativePath = (relativePath) => {
        if (!relativePath || !projectDir) return '';
        return `${projectDir}/${relativePath}`;
    };

    // Helper function to convert absolute path to relative
    const makeRelativePath = (absolutePath) => {
        if (!absolutePath || !projectDir) return absolutePath;

        // Split paths into parts
        const projectParts = projectDir.split('/');
        const absoluteParts = absolutePath.split('/');

        // Find common prefix
        let i = 0;
        while (i < projectParts.length && i < absoluteParts.length && projectParts[i] === absoluteParts[i]) {
            i++;
        }

        // Build relative path
        const upLevels = projectParts.length - i;
        const relativeParts = [];

        for (let j = 0; j < upLevels; j++) {
            relativeParts.push('..');
        }

        relativeParts.push(...absoluteParts.slice(i));

        return relativeParts.join('/');
    };

    // Set up Output Folder display and button
    const outputFolderDisplay = document.getElementById('output-folder-display');
    const selectOutputFolderBtn = document.getElementById('btn-select-output-folder');

    const updateOutputFolderDisplay = () => {
        const destFolder = projectConfig.destFolder || '';
        if (destFolder) {
            // Prepend ./ if it doesn't already start with ../ to make it clear it's relative
            const displayPath = destFolder.startsWith('../') ? destFolder : `./${destFolder}`;
            outputFolderDisplay.textContent = displayPath;
            outputFolderDisplay.classList.remove('empty');
        } else {
            outputFolderDisplay.textContent = 'No folder selected';
            outputFolderDisplay.classList.add('empty');
        }
    };

    updateOutputFolderDisplay();

    if (selectOutputFolderBtn) {
        selectOutputFolderBtn.addEventListener('click', async () => {
            const currentDestFolder = projectConfig.destFolder || '';
            const defaultPath = currentDestFolder ? resolveRelativePath(currentDestFolder) : projectDir;

            const selectedPath = await window.electronAPI.selectFolder(defaultPath);

            if (selectedPath) {
                const relativePath = makeRelativePath(selectedPath);
                projectConfig.destFolder = relativePath;

                const success = await window.electronAPI.setProjectConfig('destFolder', relativePath);

                if (success) {
                    updateOutputFolderDisplay();
                } else {
                    console.error('Failed to update destFolder');
                }
            }
        });
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

        // Update output folder display if changed
        if ('destFolder' in updatedConfig) {
            projectConfig.destFolder = updatedConfig.destFolder;
            updateOutputFolderDisplay();
        }
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
