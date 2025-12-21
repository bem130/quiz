// js/theme.js

import { dom } from './dom-refs.js';

const THEME_KEY = 'quiz_theme';
const SCALE_KEY = 'quiz_scale';
const FONT_KEY = 'quiz_font';

const SCALE_MAP = {
    xxs: 0.5,  // extra-extra small
    xs: 0.65,  // extra small
    s: 0.8, // small (existing)
    m: 1.0,  // medium (existing)
    l: 1.2,  // large (existing)
    xl: 1.4,  // extra large
    xxl: 1.7   // extra-extra large
};

// 今のテーマを HTML に適用
function applyTheme(mode) {
    const html = document.documentElement;

    if (mode !== 'light' && mode !== 'dark' && mode !== 'black') {
        mode = 'light';
    }

    html.dataset.theme = mode;
}

function normalizeTheme(savedTheme, prefersDark) {
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'black') {
        return savedTheme;
    }

    const fallback = prefersDark ? 'dark' : 'light';
    localStorage.setItem(THEME_KEY, fallback);
    return fallback;
}

function updateThemeToggleLabel(mode) {
    if (!dom.menuThemeToggle) {
        return;
    }

    let label = 'Dark';
    if (mode === 'light') {
        label = 'Light';
    } else if (mode === 'black') {
        label = 'Black';
    }

    dom.menuThemeToggle.textContent = label;
    dom.menuThemeToggle.setAttribute('aria-label', `Theme: ${label}`);
}

function getCurrentTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark =
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;

    return normalizeTheme(savedTheme, prefersDark);
}

// フォント管理
function applyFont(font) {
    const body = document.body;

    if (font === 'serif') {
        body.classList.remove('font-sans');
        body.classList.add('font-serif');
    } else {
        body.classList.remove('font-serif');
        body.classList.add('font-sans');
    }
}

function updateFontToggleLabel(font) {
    if (!dom.menuFontToggle) {
        return;
    }

    const label = font === 'serif' ? 'Serif' : 'Sans';
    dom.menuFontToggle.textContent = label;
    dom.menuFontToggle.setAttribute('aria-label', `Font: ${label}`);
}

function getCurrentFont() {
    const savedFont = localStorage.getItem(FONT_KEY);
    return savedFont === 'serif' ? 'serif' : 'sans';
}

export function toggleFont() {
    const current = getCurrentFont();
    const next = current === 'sans' ? 'serif' : 'sans';

    localStorage.setItem(FONT_KEY, next);
    applyFont(next);
    updateFontToggleLabel(next);
}

export function initThemeFromStorage() {
    // --- Theme ---
    const mode = getCurrentTheme();
    applyTheme(mode);
    updateThemeToggleLabel(mode);

    // --- Font ---
    const font = getCurrentFont();
    applyFont(font);
    updateFontToggleLabel(font);

    // --- Font scale ---
    const savedScale = localStorage.getItem(SCALE_KEY) || 'm';
    const scale = SCALE_MAP[savedScale] || 1.0;
    document.documentElement.style.setProperty('--app-scale', scale);
}

export function toggleTheme() {
    const current = getCurrentTheme();

    let next;
    if (current === 'light') {
        next = 'dark';
    } else if (current === 'dark') {
        next = 'black';
    } else {
        next = 'light';
    }

    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    updateThemeToggleLabel(next);
}

export function setSize(size) {
    const scale = SCALE_MAP[size] || 1.0;
    localStorage.setItem(SCALE_KEY, size);
    document.documentElement.style.setProperty('--app-scale', scale);
}

// モバイルブラウザでアドレスバー分を引いた高さを使う
export function initAppHeightObserver() {
    const setAppHeight = () => {
        document.documentElement.style.setProperty(
            '--app-height',
            `${window.innerHeight}px`
        );
    };
    window.addEventListener('resize', setAppHeight);
    setAppHeight();
}
