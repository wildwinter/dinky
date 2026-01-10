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
let story = null;
let currentStoryJson = null;

function continueStory() {
    if (!story) return;

    while (story.canContinue) {
        const text = story.Continue();
        const p = document.createElement('p');
        p.textContent = text;
        contentArea.appendChild(p);
    }

    if (story.currentChoices.length > 0) {
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
                const choices = contentArea.querySelectorAll('.choice');
                choices.forEach(c => c.remove());
                continueStory();
            };
            p.appendChild(a);
            contentArea.appendChild(p);
        });
    } else {
        const endP = document.createElement('p');
        endP.innerHTML = '<em>End of story</em>';
        endP.style.textAlign = 'center';
        endP.style.marginTop = '40px';
        contentArea.appendChild(endP);

        // Scroll to bottom
        endP.scrollIntoView({ behavior: 'smooth' });
    }
}

function startStory(storyJson) {
    if (!storyJson) {
        console.error('startStory called with null/undefined storyJson');
        return;
    }
    console.log('Starting story...');
    currentStoryJson = storyJson;
    contentArea.innerHTML = ''; // Clear previous

    try {
        // Create a new Story instance. Clone JSON to ensure no shared state if inkjs mutates it.
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
    console.log('onStartStory received');
    startStory(storyJson);
});

if (btnRestart) {
    console.log('Attaching click handler to btnRestart');
    btnRestart.onclick = (e) => {
        console.log('Restart button clicked');
        e.preventDefault();
        e.stopPropagation();
        if (currentStoryJson) {
            console.log('Restarting with stored story JSON');
            startStory(currentStoryJson);
        } else {
            console.warn('Cannot restart: currentStoryJson is null');
        }
    };
} else {
    console.error('btn-restart element not found!');
}
