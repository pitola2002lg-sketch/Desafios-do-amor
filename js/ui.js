(() => {
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function showScreen(id) {
    $$('.screen').forEach(screen => {
        const active = screen.id === id;
        screen.classList.toggle('active', active);
        screen.setAttribute('aria-hidden', String(!active));
    });
    const screen = document.getElementById(id);
    if (screen) {
        screen.removeAttribute('inert');
        screen.querySelector('h2, h1, input, button')?.focus({ preventScroll: true });
    }
    $$('.screen:not(.active)').forEach(item => item.setAttribute('inert', ''));
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function toast(message, action = null) {
    const element = $('#toast');
    if (!element) return;
    element.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    element.append(text);
    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = action.label;
        button.addEventListener('click', action.run, { once: true });
        element.append(button);
    }
    element.classList.add('show');
    clearTimeout(window.__loveToastTimer);
    window.__loveToastTimer = setTimeout(() => element.classList.remove('show'), action ? 6000 : 3000);
}

function setBusy(button, busy, label = 'Aguarde…') {
    if (!button) return;
    if (busy) {
        button.dataset.originalLabel = button.textContent;
        button.textContent = label;
        button.disabled = true;
    } else {
        button.textContent = button.dataset.originalLabel || button.textContent;
        button.disabled = false;
    }
}

function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function categoryMeta(category) {
    return ({
        carinho: { icon: '💝', label: 'Carinho' },
        amor: { icon: '❤️', label: 'Amor' },
        sexo: { icon: '🔥', label: 'Intimidade' }
    })[category] || { icon: '✨', label: 'Desafio' };
}

window.LoveUI = { $, $$, showScreen, toast, setBusy, escapeHTML, categoryMeta };
})();
