import { Story } from 'inkjs';

// Add platform-specific CSS class
if (window.electronAPI.platform === 'win32') {
    document.body.classList.add('windows');
} else if (window.electronAPI.platform === 'darwin') {
    document.body.classList.add('macos');
} else {
    document.body.classList.add('linux');
}

const applyTheme = (theme) => {
    console.log('Theme updated:', theme);
    if (theme === 'vs') {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    } else {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    }
};

// Set initial theme based on system preference
if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme('vs-dark');
} else {
    applyTheme('vs');
}

window.electronAPI.onThemeUpdated((theme) => {
    applyTheme(theme);
});

const contentArea = document.getElementById('content-area');
const btnRestart = document.getElementById('btn-restart');
const btnBack = document.getElementById('btn-back');
let story = null;
let currentStoryJson = null;
let stateStack = [];
let currentTurnElement = null;

function updateButtonStates() {
    if (btnBack) {
        // Disable back button if we are on the first turn (stack size <= 1)
        if (stateStack.length <= 1) {
            btnBack.classList.add('disabled');
        } else {
            btnBack.classList.remove('disabled');
        }
    }
}

// Dink Regex
const dinkyRegex = /^(\s*)([A-Z0-9_]+)(\s*)(\(.*?\)|)(\s*)(:)(\s*)(\(.*?\)|)(\s*)((?:[^/#]|\/(?![/*]))*)/;

let isDinkMode = false;

function continueStory() {
    if (!story) return;

    // Create a new turn element to hold the output of this step
    currentTurnElement = document.createElement('div');
    currentTurnElement.className = 'turn';
    contentArea.appendChild(currentTurnElement);

    while (story.canContinue) {
        const text = story.Continue();
        const p = document.createElement('p');

        if (isDinkMode) {
            const match = text.match(dinkyRegex);
            if (match) {
                // match indices:
                // 1: pre-name whitespace
                // 2: NAME
                // 3: post-name whitespace
                // 4: (qual) or empty
                // 5: pre-colon whitespace
                // 6: :
                // 7: post-colon whitespace
                // 8: (dir) or empty
                // 9: pre-text whitespace
                // 10: text

                // Construct styled HTML
                let html = '';
                // 1. Whitespace
                html += match[1];
                // 2. Name
                html += `<span class="dinky-name">${match[2]}</span>`;
                // 3. Whitespace
                html += match[3];
                // 4. Qualifier
                if (match[4]) {
                    html += `<span class="dinky-qualifier">${match[4]}</span>`;
                }
                // 5. Whitespace
                html += match[5];
                // 6. Colon (keep standard color or dim it? renderer uses delimiter color (white usually))
                html += match[6];
                // 7. Whitespace
                html += match[7];
                // 8. Direction
                if (match[8]) {
                    html += `<span class="dinky-direction">${match[8]}</span>`;
                }
                // 9. Whitespace
                html += match[9];
                // 10. Text
                html += `<span class="dinky-text">${match[10]}</span>`;

                p.innerHTML = html;
            } else {
                p.textContent = text;
            }
        } else {
            p.textContent = text;
        }

        currentTurnElement.appendChild(p);
    }

    // ALWAYS push the state reached after this continuation (choice point or end)
    const state = story.state.toJson();
    stateStack.push({ state, turnElement: currentTurnElement });
    console.log('Turn completed. Pushed to stack. Stack size:', stateStack.length);
    updateButtonStates();

    if (story.currentChoices.length > 0) {
        renderChoices();
    } else {
        const endP = document.createElement('p');
        endP.innerHTML = '<em>End of story</em>';
        endP.style.textAlign = 'center';
        endP.style.marginTop = '40px';
        currentTurnElement.appendChild(endP);

        // Scroll to bottom
        endP.scrollIntoView({ behavior: 'smooth' });
    }
}

function renderChoices() {
    if (!story || !currentTurnElement) return;

    // Clear any existing choices in this specific turn (prevents duplicates on Back)
    const choices = currentTurnElement.querySelectorAll('.choice');
    choices.forEach(c => c.remove());

    story.currentChoices.forEach((choice, index) => {
        const p = document.createElement('p');
        p.style.textAlign = 'center';
        p.className = 'choice';
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = choice.text;
        a.style.color = 'var(--link-color, #007acc)';
        a.style.textDecoration = 'none';
        a.onclick = (e) => {
            e.preventDefault();
            story.ChooseChoiceIndex(index);

            // Remove choices from the current turn before continuing
            const choicesInTurn = currentTurnElement.querySelectorAll('.choice');
            choicesInTurn.forEach(c => c.remove());

            continueStory();
        };
        p.appendChild(a);
        currentTurnElement.appendChild(p);
    });
}

function goBack() {
    if (stateStack.length === 0) {
        console.warn('Cannot go back: stack is empty. No previous state to restore.');
        return;
    }

    // Pop the current step (the one we are looking at)
    const currentStep = stateStack.pop();
    console.log('Popping current turn from stack.');

    // Remove the turn element associated with this step
    if (currentStep.turnElement && currentStep.turnElement.parentNode) {
        currentStep.turnElement.remove();
    }

    if (stateStack.length === 0) {
        console.log('Stack empty after pop. Restarting story.');
        startStory(currentStoryJson);
        return;
    }

    // The new top of the stack is the state we want to REVERT to
    const prevState = stateStack[stateStack.length - 1];
    console.log('Reverting to previous turn. Stack size:', stateStack.length);

    // Restore the engine state
    try {
        story.state.LoadJson(prevState.state);
    } catch (e) {
        console.error('Failed to load state in goBack:', e);
        // Fallback or alert user
    }

    // Set the currentTurnElement to the previous turn so renderChoices knows where to put things
    currentTurnElement = prevState.turnElement;

    // Log for debugging
    console.log('Choices after restore:', story.currentChoices.length);

    // Re-render choices for this state
    renderChoices();

    updateButtonStates();
}

function startStory(storyData) {
    let storyJson, startKnot;

    // Handle both old format (string) and new format (object) for backward compatibility/safety
    if (typeof storyData === 'string') {
        storyJson = storyData;
    } else if (typeof storyData === 'object' && storyData.story) {
        storyJson = storyData.story;
        startKnot = storyData.startKnot;
    } else {
        console.error('startStory called with invalid data', storyData);
        return;
    }

    if (!storyJson) {
        console.error('startStory: storyJson is null/undefined');
        return;
    }
    console.log('Starting story...', startKnot ? `at knot: ${startKnot}` : 'from start');

    currentStoryJson = storyData; // Store the raw data for restart
    contentArea.innerHTML = ''; // Clear previous
    stateStack = []; // Clear stack on start/restart
    currentTurnElement = null;
    updateButtonStates();
    console.log('State stack cleared.');

    // Update Window Title
    if (startKnot) {
        document.title = `Testing Knot: ${startKnot}`;
    } else {
        document.title = 'Testing Root';
    }

    try {
        const jsonToUse = typeof storyJson === 'string' ? JSON.parse(storyJson) : JSON.parse(JSON.stringify(storyJson));
        story = new Story(jsonToUse);

        // Detect Dink Mode
        isDinkMode = false;

        // Check global tags
        if (story.globalTags && story.globalTags.includes('dink')) {
            isDinkMode = true;
            console.log('Dink mode enabled via global tag');
        }

        if (startKnot) {
            try {
                // Check knot tags if we haven't already enabled dink mode
                // Note: TagsForContentAtPath returns an array of strings or null
                if (!isDinkMode) {
                    const params = story.TagsForContentAtPath(startKnot);
                    if (params && params.includes('dink')) {
                        isDinkMode = true;
                        console.log('Dink mode enabled via knot tag');
                    }
                }

                story.ChoosePathString(startKnot);
            } catch (e) {
                console.error(`Failed to jump to knot ${startKnot}:`, e);
                // Continue from start if jump failed? app to decide. 
                // We'll output an error message in UI
                const p = document.createElement('p');
                p.style.color = 'orange';
                p.textContent = `Warning: Could not find knot "${startKnot}". Starting from beginning.`;
                contentArea.appendChild(p);
            }
        }

        continueStory();
    } catch (e) {
        console.error('Failed to run story:', e);
        const p = document.createElement('p');
        p.style.color = 'red';
        p.textContent = 'Runtime Error: ' + e.message;
        contentArea.appendChild(p);
    }
}

window.electronAPI.onStartStory((data) => {
    startStory(data);
});

window.electronAPI.onCompilationError((message) => {
    contentArea.innerHTML = '';
    const p = document.createElement('p');
    p.style.color = 'red';
    p.style.fontWeight = 'bold';
    p.textContent = 'Compilation Error:';
    const pre = document.createElement('pre');
    pre.textContent = message;
    pre.style.whiteSpace = 'pre-wrap';
    contentArea.appendChild(p);
    contentArea.appendChild(pre);
});

if (btnRestart) {
    btnRestart.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Request the main window to save all and restart our test
        window.electronAPI.requestTestRestart();
    };
}

if (btnBack) {
    btnBack.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        goBack();
    };
}
