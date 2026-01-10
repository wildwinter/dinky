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
let story = null;

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

window.electronAPI.onStartStory((storyJson) => {
    console.log('Starting story...');
    contentArea.innerHTML = ''; // Clear previous

    try {
        story = new Story(storyJson);
        continueStory();
    } catch (e) {
        console.error('Failed to run story:', e);
        const p = document.createElement('p');
        p.style.color = 'red';
        p.textContent = 'Runtime Error: ' + e.message;
        contentArea.appendChild(p);
    }
});
