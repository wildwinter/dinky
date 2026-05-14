const MIN_WIDTH = 150;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 200;

function clampWidth(px) {
    if (!Number.isFinite(px)) return DEFAULT_WIDTH;
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
}

export function initSidebarResizer() {
    const sidebar = document.getElementById('sidebar');
    const resizer = document.getElementById('sidebar-resizer');
    if (!sidebar || !resizer) return;

    window.electronAPI.loadSettings().then((settings) => {
        if (settings && Number.isFinite(settings.sidebarWidth)) {
            sidebar.style.width = clampWidth(settings.sidebarWidth) + 'px';
        }
    });

    let dragStartX = 0;
    let dragStartWidth = 0;
    let isDragging = false;

    const onMove = (e) => {
        if (!isDragging) return;
        const delta = e.clientX - dragStartX;
        sidebar.style.width = clampWidth(dragStartWidth + delta) + 'px';
    };

    const onUp = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.classList.remove('resizing-sidebar');
        resizer.classList.remove('dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const finalWidth = clampWidth(sidebar.getBoundingClientRect().width);
        window.electronAPI.setSetting('sidebarWidth', finalWidth);
    };

    resizer.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartWidth = sidebar.getBoundingClientRect().width;
        document.body.classList.add('resizing-sidebar');
        resizer.classList.add('dragging');
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        e.preventDefault();
    });
}
