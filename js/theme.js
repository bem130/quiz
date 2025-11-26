// js/theme.js

const THEME_KEY = 'quiz_theme';

export function initThemeFromStorage() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light') {
        document.documentElement.classList.remove('dark');
        document.body.classList.remove('bg-slate-950');
        document.body.classList.add('bg-slate-50');
    } else {
        // default dark
        document.documentElement.classList.add('dark');
        document.body.classList.add('bg-slate-950');
    }
}

export function toggleTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light') {
        localStorage.setItem(THEME_KEY, 'dark');
    } else {
        localStorage.setItem(THEME_KEY, 'light');
    }
    initThemeFromStorage();
}
