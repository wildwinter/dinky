
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
