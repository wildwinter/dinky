let characters = [];

async function init() {
    // Add platform-specific CSS class
    if (window.electronAPI.platform === 'win32') {
        document.body.classList.add('windows');
    } else if (window.electronAPI.platform === 'darwin') {
        document.body.classList.add('macos');
    } else {
        document.body.classList.add('linux');
    }

    // Load characters
    characters = await window.electronAPI.getCharacters() || [];

    // Character List Management
    const characterList = document.getElementById('character-list');
    const addCharacterBtn = document.getElementById('add-character');

    function renderCharacterList() {
        if (!characterList) return;

        characterList.innerHTML = '';

        characters.forEach((character, index) => {
            const characterItem = createCharacterItem(character, index);
            characterList.appendChild(characterItem);
        });
    }

    function createCharacterItem(character, index) {
        const div = document.createElement('div');
        div.className = 'character-item';
        div.dataset.index = index;

        // Script Name input (ID field - must be uppercase alphanumeric + underscore, non-empty)
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.value = character.ID || '';
        idInput.placeholder = 'SCRIPT_NAME';
        idInput.addEventListener('input', (e) => {
            // Auto-convert to uppercase
            const cursorPos = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(cursorPos, cursorPos);

            const value = e.target.value;
            // Validate: only uppercase letters, numbers, and underscore
            const isDuplicate = characters.some((c, i) => i !== index && c.ID === value);
            if (!/^[A-Z0-9_]*$/.test(value) || isDuplicate) {
                e.target.classList.add('invalid');
                // Optional: Tooltip or visual hint for duplicate?
                if (isDuplicate) e.target.title = 'Character name must be unique';
                else e.target.title = 'Only uppercase letters, numbers, and underscores allowed';
            } else {
                e.target.classList.remove('invalid');
                e.target.title = '';
            }
        });
        idInput.addEventListener('change', async (e) => {
            const value = e.target.value.trim();
            const isDuplicate = characters.some((c, i) => i !== index && c.ID === value);
            // Only save if valid and non-empty and not duplicate
            if (/^[A-Z0-9_]+$/.test(value) && !isDuplicate) {
                await updateCharacterField(index, 'ID', value);
                e.target.classList.remove('invalid');
                e.target.title = '';
            } else {
                // Revert to previous value if invalid or empty
                e.target.value = character.ID || '';
                e.target.classList.remove('invalid');
                e.target.title = '';
                // If it was a duplicate, maybe we should show the invalid state again?
                // But generally reverting is safer for data integrity.
            }
        });

        // Actor input (can be empty)
        const actorInput = document.createElement('input');
        actorInput.type = 'text';
        actorInput.value = character.Actor || '';
        actorInput.placeholder = 'Actor Name';
        actorInput.addEventListener('change', async (e) => {
            await updateCharacterField(index, 'Actor', e.target.value);
        });

        // Move up button
        const moveUpBtn = document.createElement('button');
        moveUpBtn.className = 'move-btn';
        moveUpBtn.innerHTML = '&#8593;';
        moveUpBtn.title = 'Move Up';
        moveUpBtn.disabled = index === 0;
        moveUpBtn.addEventListener('click', () => {
            moveCharacterUp(index);
        });

        // Move down button
        const moveDownBtn = document.createElement('button');
        moveDownBtn.className = 'move-btn';
        moveDownBtn.innerHTML = '&#8595;';
        moveDownBtn.title = 'Move Down';
        moveDownBtn.disabled = index === characters.length - 1;
        moveDownBtn.addEventListener('click', () => {
            moveCharacterDown(index);
        });

        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.title = 'Delete';
        deleteBtn.addEventListener('click', () => {
            deleteCharacter(index);
        });

        div.appendChild(idInput);
        div.appendChild(actorInput);
        div.appendChild(moveUpBtn);
        div.appendChild(moveDownBtn);
        div.appendChild(deleteBtn);

        return div;
    }

    async function updateCharacterField(index, field, value) {
        if (index >= 0 && index < characters.length) {
            characters[index][field] = value;

            const success = await window.electronAPI.saveCharacters(characters);

            if (!success) {
                console.error('Failed to update character');
            }
        }
    }

    async function deleteCharacter(index) {
        // Show confirmation dialog
        const characterName = characters[index]?.ID || 'this character';
        const confirmed = confirm(`Are you sure you want to delete "${characterName}"?`);

        if (!confirmed) return;

        characters.splice(index, 1);

        const success = await window.electronAPI.saveCharacters(characters);

        if (success) {
            renderCharacterList();
        } else {
            console.error('Failed to delete character');
        }
    }

    async function moveCharacterUp(index) {
        if (index <= 0) return;

        // Swap with previous item
        [characters[index - 1], characters[index]] =
            [characters[index], characters[index - 1]];

        const success = await window.electronAPI.saveCharacters(characters);

        if (success) {
            renderCharacterList();
        } else {
            console.error('Failed to move character up');
        }
    }

    async function moveCharacterDown(index) {
        if (index >= characters.length - 1) return;

        // Swap with next item
        [characters[index], characters[index + 1]] =
            [characters[index + 1], characters[index]];

        const success = await window.electronAPI.saveCharacters(characters);

        if (success) {
            renderCharacterList();
        } else {
            console.error('Failed to move character down');
        }
    }

    async function addCharacter() {
        const newCharacter = {
            ID: 'NEW_CHARACTER',
            Actor: ''
        };

        // Ensure NEW_CHARACTER is unique, append number if needed
        let uniqueId = newCharacter.ID;
        let counter = 1;
        while (characters.some(c => c.ID === uniqueId)) {
            uniqueId = `${newCharacter.ID}_${counter}`;
            counter++;
        }
        newCharacter.ID = uniqueId;

        characters.push(newCharacter);

        const success = await window.electronAPI.saveCharacters(characters);

        if (success) {
            renderCharacterList();

            // Auto-focus the new character input
            // The new character is at the end of the list
            setTimeout(() => {
                const inputs = characterList.querySelectorAll('input[type="text"][placeholder="SCRIPT_NAME"]');
                const lastInput = inputs[inputs.length - 1];
                if (lastInput) {
                    lastInput.focus();
                    lastInput.select();
                }
            }, 0);
        } else {
            console.error('Failed to add character');
        }
    }

    if (addCharacterBtn) {
        addCharacterBtn.addEventListener('click', addCharacter);
    }

    // Initial render
    renderCharacterList();

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
