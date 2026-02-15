/**
 * Tooltip Manager
 * Handles global custom tooltips for elements with data-tooltip attribute
 */

let tooltipElement = null;
let isInitialized = false;
let showTimeout = null;

function createTooltipElement() {
    let tooltip = document.getElementById('dinky-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'dinky-tooltip';
        tooltip.className = 'dinky-tooltip';
        document.body.appendChild(tooltip);
    }
    tooltipElement = tooltip;
}

function showTooltip(target) {
    if (!tooltipElement) return;

    const text = target.getAttribute('data-tooltip');
    if (!text) return;

    tooltipElement.textContent = text;
    tooltipElement.classList.add('visible');

    const rect = target.getBoundingClientRect();

    // Position tooltip below the element by default
    let top = rect.bottom + 8;
    // Flip above if too close to bottom
    if (top + 30 > window.innerHeight) {
        top = rect.top - 30;
    }

    // Center horizontally on the element
    let left = rect.left + (rect.width / 2) - (tooltipElement.offsetWidth / 2);
    // Clamp to viewport
    if (left < 4) left = 4;
    if (left + tooltipElement.offsetWidth > window.innerWidth - 4) {
        left = window.innerWidth - tooltipElement.offsetWidth - 4;
    }

    tooltipElement.style.top = `${top}px`;
    tooltipElement.style.left = `${left}px`;
}

function hideTooltip() {
    clearTimeout(showTimeout);
    showTimeout = null;
    if (tooltipElement) {
        tooltipElement.classList.remove('visible');
    }
}

function setupEventListeners() {
    document.addEventListener('mouseover', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            clearTimeout(showTimeout);
            showTimeout = setTimeout(() => showTooltip(target), 1000);
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target.closest('[data-tooltip]');
        if (target) {
            const related = e.relatedTarget;
            if (!related || !target.contains(related)) {
                hideTooltip();
            }
        }
    });

    document.addEventListener('mousedown', () => hideTooltip());
}

export function initTooltips() {
    if (isInitialized) return;
    createTooltipElement();
    setupEventListeners();
    isInitialized = true;
}
