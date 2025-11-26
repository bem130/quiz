// js/theme.js

const THEME_KEY = 'quiz_theme';
const SCALE_KEY = 'quiz_scale';

const SCALE_MAP = {
    s: 0.85,
    m: 1.0,
    l: 1.2
};

export function initThemeFromStorage() {
    // --- Theme ---
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;

    const useDark = savedTheme
        ? savedTheme === 'dark'
        : prefersDark;

    if (useDark) {
        document.documentElement.classList.add('dark');
        document.body.classList.add('bg-slate-950', 'text-slate-100');
        document.body.classList.remove('bg-slate-50', 'text-slate-900');
    } else {
        document.documentElement.classList.remove('dark');
        document.body.classList.add('bg-slate-50', 'text-slate-900');
        document.body.classList.remove('bg-slate-950', 'text-slate-100');
    }

    // --- Font scale ---
    const savedScale = localStorage.getItem(SCALE_KEY) || 'm';
    const scale = SCALE_MAP[savedScale] || 1.0;
    document.documentElement.style.setProperty('--app-scale', scale);
}

export function toggleTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const next = savedTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, next);
    initThemeFromStorage();
}

export function setSize(size) {
    const scale = SCALE_MAP[size] || 1.0;
    localStorage.setItem(SCALE_KEY, size);
    document.documentElement.style.setProperty('--app-scale', scale);
}

// モバイルブラウザでアドレスバー分を引いた高さを使う
export function initAppHeightObserver() {
    const setAppHeight = () => {
        document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    };
    window.addEventListener('resize', setAppHeight);
    setAppHeight();
}
