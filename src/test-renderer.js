import { Story } from 'inkjs';

window.electronAPI.onThemeUpdated((theme) => {
    console.log('Theme updated:', theme);
    if (theme === 'vs') {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    } else {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    }
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

function continueStory() {
    if (!story) return;

    // Create a new turn element to hold the output of this step
    currentTurnElement = document.createElement('div');
    currentTurnElement.className = 'turn';
    contentArea.appendChild(currentTurnElement);

    while (story.canContinue) {
        const text = story.Continue();
        const p = document.createElement('p');
        p.textContent = text;
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

function startStory(storyJson) {
    if (!storyJson) {
        console.error('startStory called with null/undefined storyJson');
        return;
    }
    console.log('Starting story...');
    currentStoryJson = storyJson;
    contentArea.innerHTML = ''; // Clear previous
    stateStack = []; // Clear stack on start/restart
    currentTurnElement = null;
    updateButtonStates();
    console.log('State stack cleared.');

    try {
        const jsonToUse = typeof storyJson === 'string' ? JSON.parse(storyJson) : JSON.parse(JSON.stringify(storyJson));
        story = new Story(jsonToUse);
        continueStory();
    } catch (e) {
        console.error('Failed to run story:', e);
        const p = document.createElement('p');
        p.style.color = 'red';
        p.textContent = 'Runtime Error: ' + e.message;
        contentArea.appendChild(p);
    }
}

window.electronAPI.onStartStory((storyJson) => {
    startStory(storyJson);
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
