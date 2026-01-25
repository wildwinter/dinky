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

    // Set up Spelling Language dropdown
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
        const currentLocale = projectConfig.dinky?.spellCheckerLocale || 'en-GB';
        languageSelect.value = currentLocale;

        languageSelect.addEventListener('change', async (e) => {
            const newLocale = e.target.value;
            if (!projectConfig.dinky) projectConfig.dinky = {};
            projectConfig.dinky.spellCheckerLocale = newLocale;

            const success = await window.electronAPI.setProjectConfig('dinky.spellCheckerLocale', newLocale);

            if (success) {
                // Broadcast to all windows including main which handles the actual spellchecker switch
                window.electronAPI.setSetting('spellCheckerLocale', newLocale);
            } else {
                console.error('Failed to update dinky.spellCheckerLocale');
            }
        });
    }

    // Set up Edit Dictionary button
    const editDictBtn = document.getElementById('btn-edit-dictionary');
    if (editDictBtn) {
        editDictBtn.addEventListener('click', () => {
            window.electronAPI.editProjectDictionary();
        });
    }

    // Set up Default Locale Code text field
    const defaultLocaleCodeInput = document.getElementById('defaultLocaleCode');
    if (defaultLocaleCodeInput) {
        // Load initial value
        const currentValue = projectConfig.defaultLocaleCode || '';
        defaultLocaleCodeInput.value = currentValue;

        // Validation function
        const validateLocaleCode = (value) => {
            // Only letters (a-z, A-Z) and hyphen (-), max 7 characters
            const regex = /^[a-zA-Z-]{0,7}$/;
            return regex.test(value);
        };

        // Handle input validation
        defaultLocaleCodeInput.addEventListener('input', (e) => {
            const value = e.target.value;
            if (!validateLocaleCode(value)) {
                e.target.classList.add('invalid');
            } else {
                e.target.classList.remove('invalid');
            }
        });

        // Handle blur (when user leaves the field)
        defaultLocaleCodeInput.addEventListener('blur', async (e) => {
            const value = e.target.value.trim();

            if (!validateLocaleCode(value)) {
                // Revert to previous value if invalid
                e.target.value = projectConfig.defaultLocaleCode || '';
                e.target.classList.remove('invalid');
                return;
            }

            // Save valid value
            if (value !== projectConfig.defaultLocaleCode) {
                const success = await window.electronAPI.setProjectConfig('defaultLocaleCode', value);

                if (success) {
                    projectConfig.defaultLocaleCode = value;
                } else {
                    console.error('Failed to update defaultLocaleCode');
                    // Revert to previous value
                    e.target.value = projectConfig.defaultLocaleCode || '';
                }
            }
        });
    }

    // Helper function to convert array to comma-separated string
    const arrayToCSV = (arr) => {
        if (!arr || !Array.isArray(arr)) return '';
        return arr.join(', ');
    };

    // Helper function to convert comma-separated string to array
    const csvToArray = (str) => {
        if (!str || typeof str !== 'string') return [];
        return str.split(',').map(s => s.trim()).filter(s => s);
    };

    // Set up filter textfields (commentFiltersLoc, commentFiltersRecord, tagFiltersRecord)
    const filterFields = [
        {
            id: 'commentFiltersLoc',
            configPath: ['commentFilters', 'loc'],
            isCommentFilter: true
        },
        {
            id: 'commentFiltersRecord',
            configPath: ['commentFilters', 'record'],
            isCommentFilter: true
        },
        {
            id: 'tagFiltersRecord',
            configPath: ['tagFilters', 'record'],
            isCommentFilter: false
        }
    ];

    filterFields.forEach(field => {
        const input = document.getElementById(field.id);
        if (input) {
            // Get initial value from config
            const configValue = field.configPath.reduce((obj, key) => obj?.[key], projectConfig);
            const displayValue = arrayToCSV(configValue);
            input.value = displayValue;

            // Validation function for comment filters (uppercase letters and ?)
            const validateFilter = (value) => {
                if (value === '') return true;
                const parts = csvToArray(value);
                if (field.isCommentFilter) {
                    // For comment filters: uppercase letters only, or single ?
                    return parts.every(part => /^[A-Z]+$/.test(part) || part === '?');
                } else {
                    // For tag filters: lowercase letters and numbers only
                    return parts.every(part => /^[a-z0-9]+$/.test(part));
                }
            };

            // Handle input validation
            input.addEventListener('input', (e) => {
                const value = e.target.value;
                if (!validateFilter(value)) {
                    e.target.classList.add('invalid');
                } else {
                    e.target.classList.remove('invalid');
                }
            });

            // Handle blur (when user leaves the field)
            input.addEventListener('blur', async (e) => {
                const value = e.target.value.trim();

                if (!validateFilter(value)) {
                    // Revert to previous value if invalid
                    e.target.value = displayValue;
                    e.target.classList.remove('invalid');
                    return;
                }

                // Convert CSV string to array
                const arrayValue = csvToArray(value);

                // Check if value actually changed
                const currentValue = field.configPath.reduce((obj, key) => obj?.[key], projectConfig);
                const changed = JSON.stringify(arrayValue) !== JSON.stringify(currentValue || []);

                if (changed) {
                    // Update config object
                    let obj = projectConfig;
                    for (let i = 0; i < field.configPath.length - 1; i++) {
                        const key = field.configPath[i];
                        if (!obj[key]) {
                            obj[key] = {};
                        }
                        obj = obj[key];
                    }
                    obj[field.configPath[field.configPath.length - 1]] = arrayValue;

                    // Save to project config
                    const success = await window.electronAPI.setProjectConfig(field.configPath[0], projectConfig[field.configPath[0]]);

                    if (success) {
                        // Update display value
                        e.target.value = arrayToCSV(arrayValue);
                    } else {
                        console.error(`Failed to update ${field.id}`);
                        // Revert to previous value
                        e.target.value = displayValue;
                    }
                }
            });
        }
    });

    // Set up Google TTS
    const googleTTSKeyFileDisplay = document.getElementById('google-tts-key-file-display');
    const selectGoogleTTSKeyFileBtn = document.getElementById('btn-select-google-tts-key-file');
    const googleTTSOutputFolderDisplay = document.getElementById('google-tts-output-folder-display');
    const selectGoogleTTSOutputFolderBtn = document.getElementById('btn-select-google-tts-output-folder');

    const updateGoogleTTSKeyFileDisplay = () => {
        const authentication = projectConfig.googleTTS?.authentication || '';
        if (authentication) {
            // Prepend ./ if it doesn't already start with ../ to make it clear it's relative
            const displayPath = authentication.startsWith('../') ? authentication : `./${authentication}`;
            googleTTSKeyFileDisplay.textContent = displayPath;
            googleTTSKeyFileDisplay.classList.remove('empty');
        } else {
            googleTTSKeyFileDisplay.textContent = 'No file selected';
            googleTTSKeyFileDisplay.classList.add('empty');
        }
    };

    const updateGoogleTTSOutputFolderDisplay = () => {
        const outputFolder = projectConfig.googleTTS?.outputFolder || '';
        if (outputFolder) {
            // Prepend ./ if it doesn't already start with ../ to make it clear it's relative
            const displayPath = outputFolder.startsWith('../') ? outputFolder : `./${outputFolder}`;
            googleTTSOutputFolderDisplay.textContent = displayPath;
            googleTTSOutputFolderDisplay.classList.remove('empty');
        } else {
            googleTTSOutputFolderDisplay.textContent = 'No folder selected';
            googleTTSOutputFolderDisplay.classList.add('empty');
        }
    };

    updateGoogleTTSKeyFileDisplay();
    updateGoogleTTSOutputFolderDisplay();

    if (selectGoogleTTSKeyFileBtn) {
        selectGoogleTTSKeyFileBtn.addEventListener('click', async () => {
            const currentKeyFile = projectConfig.googleTTS?.authentication || '';
            const defaultPath = currentKeyFile ? resolveRelativePath(currentKeyFile) : projectDir;

            const selectedPath = await window.electronAPI.selectFile(defaultPath, [
                { name: 'JSON Files', extensions: ['json'] }
            ]);

            if (selectedPath) {
                const relativePath = makeRelativePath(selectedPath);
                if (!projectConfig.googleTTS) {
                    projectConfig.googleTTS = {};
                }
                projectConfig.googleTTS.authentication = relativePath;

                const success = await window.electronAPI.setProjectConfig('googleTTS', projectConfig.googleTTS);

                if (success) {
                    updateGoogleTTSKeyFileDisplay();
                } else {
                    console.error('Failed to update Google TTS key file');
                }
            }
        });
    }

    if (selectGoogleTTSOutputFolderBtn) {
        selectGoogleTTSOutputFolderBtn.addEventListener('click', async () => {
            const currentOutputFolder = projectConfig.googleTTS?.outputFolder || '';
            const defaultPath = currentOutputFolder ? resolveRelativePath(currentOutputFolder) : projectDir;

            const selectedPath = await window.electronAPI.selectFolder(defaultPath);

            if (selectedPath) {
                const relativePath = makeRelativePath(selectedPath);
                if (!projectConfig.googleTTS) {
                    projectConfig.googleTTS = {};
                }
                projectConfig.googleTTS.outputFolder = relativePath;

                const success = await window.electronAPI.setProjectConfig('googleTTS', projectConfig.googleTTS);

                if (success) {
                    updateGoogleTTSOutputFolderDisplay();
                } else {
                    console.error('Failed to update Google TTS output folder');
                }
            }
        });
    }

    // Set up checkboxes
    const checkboxes = [
        'locActions',
        'nostrip',
        'outputLocalization',
        'outputRecordingScript',
        'outputDinkStructure',
        'outputStats',
        'ignoreWritingStatus'
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

    // Set up Google TTS Generate checkbox
    const googleTTSGenerateCheckbox = document.getElementById('googleTTSGenerate');
    if (googleTTSGenerateCheckbox) {
        googleTTSGenerateCheckbox.checked = !!projectConfig.googleTTS?.generate;

        googleTTSGenerateCheckbox.addEventListener('change', async (e) => {
            const newValue = e.target.checked;
            if (!projectConfig.googleTTS) {
                projectConfig.googleTTS = {};
            }
            projectConfig.googleTTS.generate = newValue;

            const success = await window.electronAPI.setProjectConfig('googleTTS', projectConfig.googleTTS);

            if (!success) {
                console.error('Failed to update googleTTS.generate');
                e.target.checked = !newValue;
            }
        });
    }

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

        // Update default locale code if changed
        if ('defaultLocaleCode' in updatedConfig) {
            projectConfig.defaultLocaleCode = updatedConfig.defaultLocaleCode;
            const defaultLocaleCodeInput = document.getElementById('defaultLocaleCode');
            if (defaultLocaleCodeInput) {
                defaultLocaleCodeInput.value = updatedConfig.defaultLocaleCode || '';
            }
        }

        // Update spell checker locale if changed (nested under dinky)
        if ('dinky.spellCheckerLocale' in updatedConfig) {
            if (!projectConfig.dinky) projectConfig.dinky = {};
            projectConfig.dinky.spellCheckerLocale = updatedConfig['dinky.spellCheckerLocale'];
            const languageSelect = document.getElementById('language-select');
            if (languageSelect) {
                languageSelect.value = updatedConfig['dinky.spellCheckerLocale'] || 'en-GB';
            }
        }

        // Update writing status list if changed
        if ('writingStatus' in updatedConfig) {
            projectConfig.writingStatus = updatedConfig.writingStatus;
            renderWritingStatusList();
        }

        // Update audio status list if changed
        if ('audioStatus' in updatedConfig) {
            projectConfig.audioStatus = updatedConfig.audioStatus;
            renderAudioStatusList();
        }

        // Update filter fields if changed
        if ('commentFilters' in updatedConfig || 'tagFilters' in updatedConfig) {
            if ('commentFilters' in updatedConfig) {
                projectConfig.commentFilters = updatedConfig.commentFilters;
                const locInput = document.getElementById('commentFiltersLoc');
                if (locInput) {
                    locInput.value = arrayToCSV(updatedConfig.commentFilters.loc || []);
                }
                const recordInput = document.getElementById('commentFiltersRecord');
                if (recordInput) {
                    recordInput.value = arrayToCSV(updatedConfig.commentFilters.record || []);
                }
            }
            if ('tagFilters' in updatedConfig) {
                projectConfig.tagFilters = updatedConfig.tagFilters;
                const recordTagsInput = document.getElementById('tagFiltersRecord');
                if (recordTagsInput) {
                    recordTagsInput.value = arrayToCSV(updatedConfig.tagFilters.record || []);
                }
            }
        }

        // Update Google TTS if changed
        if ('googleTTS' in updatedConfig) {
            projectConfig.googleTTS = updatedConfig.googleTTS;

            const generateCheckbox = document.getElementById('googleTTSGenerate');
            if (generateCheckbox) {
                generateCheckbox.checked = !!updatedConfig.googleTTS?.generate;
            }

            updateGoogleTTSKeyFileDisplay();
            updateGoogleTTSOutputFolderDisplay();
        }

        // Update estimates list if changed
        if ('estimates' in updatedConfig) {
            projectConfig.estimates = updatedConfig.estimates;
            renderEstimatesList();
        }
    });

    // Writing Status Management
    const writingStatusList = document.getElementById('writing-status-list');
    const addWritingStatusBtn = document.getElementById('add-writing-status');

    function renderWritingStatusList() {
        if (!writingStatusList) return;

        writingStatusList.innerHTML = '';
        const statuses = projectConfig.writingStatus || [];

        statuses.forEach((status, index) => {
            const statusItem = createStatusItem(status, index);
            writingStatusList.appendChild(statusItem);
        });
    }

    function createStatusItem(status, index) {
        const div = document.createElement('div');
        div.className = 'status-item';
        div.dataset.index = index;

        // Status name input
        const statusInput = document.createElement('input');
        statusInput.type = 'text';
        statusInput.value = status.status || '';
        statusInput.placeholder = 'Status Name';

        const validateStatusName = (value) => {
            const isDuplicate = projectConfig.writingStatus.some((s, i) => i !== index && s.status === value);
            if (isDuplicate) {
                statusInput.classList.add('invalid');
                statusInput.title = 'Status name must be unique';
            } else {
                statusInput.classList.remove('invalid');
                statusInput.title = '';
            }
            return !isDuplicate;
        };

        statusInput.addEventListener('input', (e) => {
            validateStatusName(e.target.value);
        });

        statusInput.addEventListener('change', (e) => {
            const value = e.target.value;
            if (validateStatusName(value)) {
                updateStatusField(index, 'status', value);
            } else {
                // Revert or keep invalid? Reverting is safer.
                e.target.value = status.status || '';
                statusInput.classList.remove('invalid');
                statusInput.title = '';
            }
        });

        // Tag input (must be lowercase alphanumeric)
        const tagInput = document.createElement('input');
        tagInput.type = 'text';
        tagInput.value = status.wstag || '';
        tagInput.placeholder = 'tag';
        tagInput.addEventListener('input', (e) => {
            const value = e.target.value;
            // Validate: only lowercase letters and numbers
            if (!/^[a-z0-9]*$/.test(value)) {
                e.target.classList.add('invalid');
            } else {
                e.target.classList.remove('invalid');
            }
        });
        tagInput.addEventListener('change', (e) => {
            const value = e.target.value;
            // Only save if valid
            if (/^[a-z0-9]*$/.test(value)) {
                updateStatusField(index, 'wstag', value);
                e.target.classList.remove('invalid');
            } else {
                // Revert to previous value
                e.target.value = status.wstag || '';
                e.target.classList.remove('invalid');
            }
        });

        // Record checkbox
        const recordCheckbox = document.createElement('input');
        recordCheckbox.type = 'checkbox';
        recordCheckbox.checked = !!status.record;
        recordCheckbox.addEventListener('change', (e) => {
            updateStatusField(index, 'record', e.target.checked);
        });

        // Loc checkbox
        const locCheckbox = document.createElement('input');
        locCheckbox.type = 'checkbox';
        locCheckbox.checked = !!status.loc;
        locCheckbox.addEventListener('change', (e) => {
            updateStatusField(index, 'loc', e.target.checked);
        });

        // Estimate checkbox
        const estimateCheckbox = document.createElement('input');
        estimateCheckbox.type = 'checkbox';
        estimateCheckbox.checked = !!status.estimate;
        estimateCheckbox.addEventListener('change', (e) => {
            updateStatusField(index, 'estimate', e.target.checked);
        });

        // Color picker
        const colorWrapper = document.createElement('div');
        colorWrapper.className = 'color-picker-wrapper';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        // Convert hex color (RRGGBB) to #RRGGBB format for color input
        const hexColor = status.color || 'FFFFFF';
        colorInput.value = '#' + hexColor;
        colorInput.addEventListener('change', (e) => {
            // Remove # and store just the hex value
            const colorValue = e.target.value.substring(1).toUpperCase();
            updateStatusField(index, 'color', colorValue);
        });
        colorWrapper.appendChild(colorInput);

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete';
        deleteBtn.addEventListener('click', () => {
            deleteStatus(index);
        });

        // Move up button
        const moveUpBtn = document.createElement('button');
        moveUpBtn.className = 'move-btn';
        moveUpBtn.innerHTML = '↑';
        moveUpBtn.title = 'Move Up';
        moveUpBtn.disabled = index === 0;
        moveUpBtn.addEventListener('click', () => {
            moveStatusUp(index);
        });

        // Move down button
        const moveDownBtn = document.createElement('button');
        moveDownBtn.className = 'move-btn';
        moveDownBtn.innerHTML = '↓';
        moveDownBtn.title = 'Move Down';
        moveDownBtn.disabled = index === (projectConfig.writingStatus?.length || 0) - 1;
        moveDownBtn.addEventListener('click', () => {
            moveStatusDown(index);
        });

        div.appendChild(statusInput);
        div.appendChild(tagInput);
        div.appendChild(recordCheckbox);
        div.appendChild(locCheckbox);
        div.appendChild(estimateCheckbox);
        div.appendChild(colorWrapper);
        div.appendChild(moveUpBtn);
        div.appendChild(moveDownBtn);
        div.appendChild(deleteBtn);

        return div;
    }

    async function updateStatusField(index, field, value) {
        if (!projectConfig.writingStatus) {
            projectConfig.writingStatus = [];
        }

        if (index >= 0 && index < projectConfig.writingStatus.length) {
            projectConfig.writingStatus[index][field] = value;

            const success = await window.electronAPI.setProjectConfig('writingStatus', projectConfig.writingStatus);

            if (!success) {
                console.error('Failed to update writing status');
            }
        }
    }

    async function deleteStatus(index) {
        // Show confirmation dialog
        const statusName = projectConfig.writingStatus[index]?.status || 'this status';
        const confirmed = confirm(`Are you sure you want to delete "${statusName}"?`);

        if (!confirmed) return;

        if (!projectConfig.writingStatus) return;

        projectConfig.writingStatus.splice(index, 1);

        const success = await window.electronAPI.setProjectConfig('writingStatus', projectConfig.writingStatus);

        if (success) {
            renderWritingStatusList();
        } else {
            console.error('Failed to delete status');
        }
    }

    async function moveStatusUp(index) {
        if (!projectConfig.writingStatus || index <= 0) return;

        // Swap with previous item
        [projectConfig.writingStatus[index - 1], projectConfig.writingStatus[index]] =
            [projectConfig.writingStatus[index], projectConfig.writingStatus[index - 1]];

        const success = await window.electronAPI.setProjectConfig('writingStatus', projectConfig.writingStatus);

        if (success) {
            renderWritingStatusList();
        } else {
            console.error('Failed to move status up');
        }
    }

    async function moveStatusDown(index) {
        if (!projectConfig.writingStatus || index >= projectConfig.writingStatus.length - 1) return;

        // Swap with next item
        [projectConfig.writingStatus[index], projectConfig.writingStatus[index + 1]] =
            [projectConfig.writingStatus[index + 1], projectConfig.writingStatus[index]];

        const success = await window.electronAPI.setProjectConfig('writingStatus', projectConfig.writingStatus);

        if (success) {
            renderWritingStatusList();
        } else {
            console.error('Failed to move status down');
        }
    }

    async function addStatus() {
        if (!projectConfig.writingStatus) {
            projectConfig.writingStatus = [];
        }

        const newStatus = {
            status: 'New Status',
            wstag: 'newstatus',
            record: false,
            loc: false,
            color: 'CCCCCC'
        };

        // Ensure unique status name
        let uniqueName = newStatus.status;
        let counter = 1;
        while (projectConfig.writingStatus.some(s => s.status === uniqueName)) {
            uniqueName = `${newStatus.status} ${counter}`;
            counter++;
        }
        newStatus.status = uniqueName;

        projectConfig.writingStatus.push(newStatus);

        const success = await window.electronAPI.setProjectConfig('writingStatus', projectConfig.writingStatus);

        if (success) {
            renderWritingStatusList();

            // Auto-focus the new status input
            setTimeout(() => {
                const inputs = writingStatusList.querySelectorAll('input[type="text"][placeholder="Status Name"]');
                const lastInput = inputs[inputs.length - 1];
                if (lastInput) {
                    lastInput.focus();
                    lastInput.select();
                }
            }, 0);
        } else {
            console.error('Failed to add status');
        }
    }

    if (addWritingStatusBtn) {
        addWritingStatusBtn.addEventListener('click', addStatus);
    }

    // Initial render
    renderWritingStatusList();

    // Audio Status Management
    const audioStatusList = document.getElementById('audio-status-list');
    const addAudioStatusBtn = document.getElementById('add-audio-status');

    function renderAudioStatusList() {
        if (!audioStatusList) return;

        audioStatusList.innerHTML = '';
        const statuses = projectConfig.audioStatus || [];

        statuses.forEach((status, index) => {
            const statusItem = createAudioStatusItem(status, index);
            audioStatusList.appendChild(statusItem);
        });
    }

    function createAudioStatusItem(status, index) {
        const div = document.createElement('div');
        div.className = 'audio-status-item';
        div.dataset.index = index;

        // Status name input
        const statusInput = document.createElement('input');
        statusInput.type = 'text';
        statusInput.value = status.status || '';
        statusInput.placeholder = 'Status Name';

        const validateAudioStatusName = (value) => {
            const isDuplicate = projectConfig.audioStatus.some((s, i) => i !== index && s.status === value);
            if (isDuplicate) {
                statusInput.classList.add('invalid');
                statusInput.title = 'Status name must be unique';
            } else {
                statusInput.classList.remove('invalid');
                statusInput.title = '';
            }
            return !isDuplicate;
        };

        statusInput.addEventListener('input', (e) => {
            validateAudioStatusName(e.target.value);
        });

        statusInput.addEventListener('change', (e) => {
            const value = e.target.value;
            if (validateAudioStatusName(value)) {
                updateAudioStatusField(index, 'status', value);
            } else {
                e.target.value = status.status || '';
                statusInput.classList.remove('invalid');
                statusInput.title = '';
            }
        });

        // Folder display and browse button
        const folderWrapper = document.createElement('div');
        folderWrapper.className = 'folder-display-item';

        const folderDisplay = document.createElement('div');
        folderDisplay.className = 'folder-display';
        const folderPath = status.folder || '';
        if (folderPath) {
            // Prepend ./ if it doesn't already start with ../ to make it clear it's relative
            const displayPath = folderPath.startsWith('../') ? folderPath : `./${folderPath}`;
            folderDisplay.textContent = displayPath;
            folderDisplay.classList.remove('empty');
        } else {
            folderDisplay.textContent = 'No folder selected';
            folderDisplay.classList.add('empty');
        }
        folderDisplay.dataset.index = index;

        const folderBrowseBtn = document.createElement('button');
        folderBrowseBtn.className = 'folder-browse-btn';
        folderBrowseBtn.textContent = 'Browse...';
        folderBrowseBtn.dataset.index = index;
        folderBrowseBtn.addEventListener('click', async () => {
            const defaultPath = folderPath ? resolveRelativePath(folderPath) : projectDir;
            const selectedPath = await window.electronAPI.selectFolder(defaultPath);

            if (selectedPath) {
                const relativePath = makeRelativePath(selectedPath);
                updateAudioStatusField(index, 'folder', relativePath);
                // Prepend ./ if it doesn't already start with ../ to make it clear it's relative
                const displayPath = relativePath.startsWith('../') ? relativePath : `./${relativePath}`;
                folderDisplay.textContent = displayPath;
                folderDisplay.classList.remove('empty');
            }
        });

        folderWrapper.appendChild(folderDisplay);
        folderWrapper.appendChild(folderBrowseBtn);

        // Color picker
        const colorWrapper = document.createElement('div');
        colorWrapper.className = 'color-picker-wrapper';
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        const hexColor = status.color || 'FFFFFF';
        colorInput.value = '#' + hexColor;
        colorInput.addEventListener('change', (e) => {
            const colorValue = e.target.value.substring(1).toUpperCase();
            updateAudioStatusField(index, 'color', colorValue);
        });
        colorWrapper.appendChild(colorInput);

        // Recorded checkbox
        const recordedCheckbox = document.createElement('input');
        recordedCheckbox.type = 'checkbox';
        recordedCheckbox.checked = !!status.recorded;
        recordedCheckbox.addEventListener('change', (e) => {
            updateAudioStatusField(index, 'recorded', e.target.checked);
        });

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete';
        deleteBtn.addEventListener('click', () => {
            deleteAudioStatus(index);
        });

        // Move up button
        const moveUpBtn = document.createElement('button');
        moveUpBtn.className = 'move-btn';
        moveUpBtn.innerHTML = '↑';
        moveUpBtn.title = 'Move Up';
        moveUpBtn.disabled = index === 0;
        moveUpBtn.addEventListener('click', () => {
            moveAudioStatusUp(index);
        });

        // Move down button
        const moveDownBtn = document.createElement('button');
        moveDownBtn.className = 'move-btn';
        moveDownBtn.innerHTML = '↓';
        moveDownBtn.title = 'Move Down';
        moveDownBtn.disabled = index === (projectConfig.audioStatus?.length || 0) - 1;
        moveDownBtn.addEventListener('click', () => {
            moveAudioStatusDown(index);
        });

        div.appendChild(statusInput);
        div.appendChild(folderWrapper);
        div.appendChild(colorWrapper);
        div.appendChild(recordedCheckbox);
        div.appendChild(moveUpBtn);
        div.appendChild(moveDownBtn);
        div.appendChild(deleteBtn);

        return div;
    }

    async function updateAudioStatusField(index, field, value) {
        if (!projectConfig.audioStatus) {
            projectConfig.audioStatus = [];
        }

        if (index >= 0 && index < projectConfig.audioStatus.length) {
            projectConfig.audioStatus[index][field] = value;

            const success = await window.electronAPI.setProjectConfig('audioStatus', projectConfig.audioStatus);

            if (!success) {
                console.error('Failed to update audio status');
            }
        }
    }

    async function deleteAudioStatus(index) {
        const statusName = projectConfig.audioStatus[index]?.status || 'this status';
        const confirmed = confirm(`Are you sure you want to delete "${statusName}"?`);

        if (!confirmed) return;

        if (!projectConfig.audioStatus) return;

        projectConfig.audioStatus.splice(index, 1);

        const success = await window.electronAPI.setProjectConfig('audioStatus', projectConfig.audioStatus);

        if (success) {
            renderAudioStatusList();
        } else {
            console.error('Failed to delete audio status');
        }
    }

    async function moveAudioStatusUp(index) {
        if (!projectConfig.audioStatus || index <= 0) return;

        // Swap with previous item
        [projectConfig.audioStatus[index - 1], projectConfig.audioStatus[index]] =
            [projectConfig.audioStatus[index], projectConfig.audioStatus[index - 1]];

        const success = await window.electronAPI.setProjectConfig('audioStatus', projectConfig.audioStatus);

        if (success) {
            renderAudioStatusList();
        } else {
            console.error('Failed to move audio status up');
        }
    }

    async function moveAudioStatusDown(index) {
        if (!projectConfig.audioStatus || index >= projectConfig.audioStatus.length - 1) return;

        // Swap with next item
        [projectConfig.audioStatus[index], projectConfig.audioStatus[index + 1]] =
            [projectConfig.audioStatus[index + 1], projectConfig.audioStatus[index]];

        const success = await window.electronAPI.setProjectConfig('audioStatus', projectConfig.audioStatus);

        if (success) {
            renderAudioStatusList();
        } else {
            console.error('Failed to move audio status down');
        }
    }

    async function addAudioStatus() {
        if (!projectConfig.audioStatus) {
            projectConfig.audioStatus = [];
        }

        const newStatus = {
            status: 'New Status',
            folder: '',
            color: 'CCCCCC',
            recorded: false
        };

        // Ensure unique status name
        let uniqueName = newStatus.status;
        let counter = 1;
        while (projectConfig.audioStatus.some(s => s.status === uniqueName)) {
            uniqueName = `${newStatus.status} ${counter}`;
            counter++;
        }
        newStatus.status = uniqueName;

        projectConfig.audioStatus.push(newStatus);

        const success = await window.electronAPI.setProjectConfig('audioStatus', projectConfig.audioStatus);

        if (success) {
            renderAudioStatusList();

            // Auto-focus the new status input
            setTimeout(() => {
                const inputs = audioStatusList.querySelectorAll('input[type="text"][placeholder="Status Name"]');
                const lastInput = inputs[inputs.length - 1];
                if (lastInput) {
                    lastInput.focus();
                    lastInput.select();
                }
            }, 0);
        } else {
            console.error('Failed to add audio status');
        }
    }

    if (addAudioStatusBtn) {
        addAudioStatusBtn.addEventListener('click', addAudioStatus);
    }

    // Initial render
    renderAudioStatusList();

    // Estimates Management
    const estimatesList = document.getElementById('estimates-list');
    const addEstimateBtn = document.getElementById('add-estimate');

    function renderEstimatesList() {
        if (!estimatesList) return;

        estimatesList.innerHTML = '';
        const estimates = projectConfig.estimates || [];

        estimates.forEach((estimate, index) => {
            const estimateItem = createEstimateItem(estimate, index);
            estimatesList.appendChild(estimateItem);
        });
    }

    function createEstimateItem(estimate, index) {
        const div = document.createElement('div');
        div.className = 'estimate-item';
        div.dataset.index = index;

        // Tag input (lowercase, underscore, colon only)
        const tagInput = document.createElement('input');
        tagInput.type = 'text';
        tagInput.value = estimate.tag || '';
        tagInput.placeholder = 'e.g. type:conversation';

        const validateEstimateTag = (value) => {
            // Validate: only lowercase, underscore, and colon
            if (!/^[a-z_:]*$/.test(value)) {
                tagInput.classList.add('invalid');
                tagInput.title = 'Only lowercase letters, underscores, and colons allowed';
                return false;
            }

            // Validate unique
            const isDuplicate = projectConfig.estimates.some((e, i) => i !== index && e.tag === value);
            if (isDuplicate) {
                tagInput.classList.add('invalid');
                tagInput.title = 'Estimate tag must be unique';
                return false;
            }

            tagInput.classList.remove('invalid');
            tagInput.title = '';
            return true;
        };

        tagInput.addEventListener('input', (e) => {
            validateEstimateTag(e.target.value);
        });

        tagInput.addEventListener('change', (e) => {
            const value = e.target.value;
            if (validateEstimateTag(value)) {
                updateEstimateField(index, 'tag', value);
                e.target.classList.remove('invalid');
            } else {
                // Revert to previous value
                e.target.value = estimate.tag || '';
                e.target.classList.remove('invalid');
                tagInput.title = '';
            }
        });

        // Lines input (integer only)
        const linesInput = document.createElement('input');
        linesInput.type = 'number';
        linesInput.value = estimate.lines || '';
        linesInput.placeholder = '0';
        linesInput.min = '0';
        linesInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value, 10);
            if (!isNaN(value) && value >= 0) {
                updateEstimateField(index, 'lines', value);
            } else {
                // Revert to previous value
                e.target.value = estimate.lines || '';
            }
        });

        // Move up button
        const moveUpBtn = document.createElement('button');
        moveUpBtn.className = 'move-btn';
        moveUpBtn.innerHTML = '↑';
        moveUpBtn.title = 'Move Up';
        moveUpBtn.disabled = index === 0;
        moveUpBtn.addEventListener('click', () => {
            moveEstimateUp(index);
        });

        // Move down button
        const moveDownBtn = document.createElement('button');
        moveDownBtn.className = 'move-btn';
        moveDownBtn.innerHTML = '↓';
        moveDownBtn.title = 'Move Down';
        moveDownBtn.disabled = index === (projectConfig.estimates?.length || 0) - 1;
        moveDownBtn.addEventListener('click', () => {
            moveEstimateDown(index);
        });

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.title = 'Delete';
        deleteBtn.addEventListener('click', () => {
            deleteEstimate(index);
        });

        div.appendChild(tagInput);
        div.appendChild(linesInput);
        div.appendChild(moveUpBtn);
        div.appendChild(moveDownBtn);
        div.appendChild(deleteBtn);

        return div;
    }

    async function updateEstimateField(index, field, value) {
        if (!projectConfig.estimates) {
            projectConfig.estimates = [];
        }

        if (index >= 0 && index < projectConfig.estimates.length) {
            projectConfig.estimates[index][field] = value;

            const success = await window.electronAPI.setProjectConfig('estimates', projectConfig.estimates);

            if (!success) {
                console.error('Failed to update estimate');
            }
        }
    }

    async function deleteEstimate(index) {
        const tagName = projectConfig.estimates[index]?.tag || 'this estimate';
        const confirmed = confirm(`Are you sure you want to delete "${tagName}"?`);

        if (!confirmed) return;

        if (!projectConfig.estimates) return;

        projectConfig.estimates.splice(index, 1);

        const success = await window.electronAPI.setProjectConfig('estimates', projectConfig.estimates);

        if (success) {
            renderEstimatesList();
        } else {
            console.error('Failed to delete estimate');
        }
    }

    async function moveEstimateUp(index) {
        if (!projectConfig.estimates || index <= 0) return;

        // Swap with previous item
        [projectConfig.estimates[index - 1], projectConfig.estimates[index]] =
            [projectConfig.estimates[index], projectConfig.estimates[index - 1]];

        const success = await window.electronAPI.setProjectConfig('estimates', projectConfig.estimates);

        if (success) {
            renderEstimatesList();
        } else {
            console.error('Failed to move estimate up');
        }
    }

    async function moveEstimateDown(index) {
        if (!projectConfig.estimates || index >= projectConfig.estimates.length - 1) return;

        // Swap with next item
        [projectConfig.estimates[index], projectConfig.estimates[index + 1]] =
            [projectConfig.estimates[index + 1], projectConfig.estimates[index]];

        const success = await window.electronAPI.setProjectConfig('estimates', projectConfig.estimates);

        if (success) {
            renderEstimatesList();
        } else {
            console.error('Failed to move estimate down');
        }
    }

    async function addEstimate() {
        if (!projectConfig.estimates) {
            projectConfig.estimates = [];
        }

        const newEstimate = {
            tag: 'type:new',
            lines: 10
        };

        // Ensure unique tag
        let uniqueTag = newEstimate.tag;
        let counter = 1;
        while (projectConfig.estimates.some(e => e.tag === uniqueTag)) {
            uniqueTag = `${newEstimate.tag}_${counter}`;
            counter++;
        }
        newEstimate.tag = uniqueTag;

        projectConfig.estimates.push(newEstimate);

        const success = await window.electronAPI.setProjectConfig('estimates', projectConfig.estimates);

        if (success) {
            renderEstimatesList();

            // Auto-focus the new estimate tag input
            setTimeout(() => {
                const inputs = estimatesList.querySelectorAll('input[type="text"][placeholder="e.g. type:conversation"]');
                const lastInput = inputs[inputs.length - 1];
                if (lastInput) {
                    lastInput.focus();
                    lastInput.select();
                }
            }, 0);
        } else {
            console.error('Failed to add estimate');
        }
    }

    if (addEstimateBtn) {
        addEstimateBtn.addEventListener('click', addEstimate);
    }

    // Initial render
    renderEstimatesList();

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
