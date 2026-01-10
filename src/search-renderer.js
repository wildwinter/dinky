const findInFilesInput = document.getElementById('find-in-files-input');
const replaceInFilesInput = document.getElementById('replace-in-files-input');
const btnFindInFiles = document.getElementById('btn-find-in-files');
const btnReplaceInFiles = document.getElementById('btn-replace-in-files');
const searchResultsList = document.getElementById('search-results-list');
const caseSensitiveCheckbox = document.getElementById('case-sensitive-checkbox');

async function performSearch() {
    const query = findInFilesInput.value;
    if (!query) return;

    searchResultsList.innerHTML = '<li style="cursor: default; border: none; opacity: 0.5;">Searching...</li>';

    const results = await window.electronAPI.performSearch({
        query,
        caseSensitive: caseSensitiveCheckbox.checked
    });
    displayResults(results, query);
}

function displayResults(results, query) {
    searchResultsList.innerHTML = '';

    if (results.length === 0) {
        searchResultsList.innerHTML = '<li style="cursor: default; border: none; opacity: 0.5;">No results found</li>';
        return;
    }

    results.forEach(result => {
        const li = document.createElement('li');
        li.innerHTML = `
            <div class="result-file">${result.relativePath}:${result.line}</div>
            <div class="result-line">${result.content}</div>
        `;
        li.onclick = () => {
            window.electronAPI.navigateToResult({
                path: result.path,
                line: result.line,
                query: query
            });
        };
        searchResultsList.appendChild(li);
    });
}

btnFindInFiles.addEventListener('click', performSearch);

findInFilesInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') performSearch();
});

btnReplaceInFiles.addEventListener('click', async () => {
    const query = findInFilesInput.value;
    const replacement = replaceInFilesInput.value;
    if (!query) return;

    const count = await window.electronAPI.performReplaceAll({
        query,
        replacement,
        caseSensitive: caseSensitiveCheckbox.checked
    });
    if (count > 0) {
        performSearch();
    }
});

window.electronAPI.onFocusSearchInput(() => {
    findInFilesInput.focus();
    findInFilesInput.select();
});

window.electronAPI.onThemeUpdated((theme) => {
    if (theme === 'vs') {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
    } else {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
    }
});
