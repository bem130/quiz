// js/theme.js

const THEME_KEY = 'quiz_theme';
const SCALE_KEY = 'quiz_scale';

const SCALE_MAP = {
    xxs: 0.5,  // extra-extra small
    xs:  0.65,  // extra small
    s:   0.8, // small (existing)
    m:   1.0,  // medium (existing)
    l:   1.2,  // large (existing)
    xl:  1.4,  // extra large
    xxl: 1.7   // extra-extra large
};

// 今のテーマを HTML に適用
function applyTheme(mode) {
    const useDark = mode === 'dark';
    document.documentElement.classList.toggle('dark', useDark);
}

export function initThemeFromStorage() {
    // --- Theme ---
    const savedTheme = localStorage.getItem(THEME_KEY);
    const prefersDark =
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;

    let mode;
    if (savedTheme === 'dark' || savedTheme === 'light') {
        mode = savedTheme;
    } else {
        mode = prefersDark ? 'dark' : 'light';
        localStorage.setItem(THEME_KEY, mode);
    }

    applyTheme(mode);

    // --- Font scale ---
    const savedScale = localStorage.getItem(SCALE_KEY) || 'm';
    const scale = SCALE_MAP[savedScale] || 1.0;
    document.documentElement.style.setProperty('--app-scale', scale);
}

export function toggleTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    const next = isDark ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
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
