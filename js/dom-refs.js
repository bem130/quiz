// js/dom-refs.js

export const dom = {
    // 共通ヘッダ
    appTitle: document.getElementById('app-title'),
    appDescription: document.getElementById('app-description'),
    quizHeaderScore: document.getElementById('quiz-header-score'),

    // メイン側（左パネル）
    mainMenu: document.getElementById('main-menu'),
    mainQuiz: document.getElementById('main-quiz'),

    // メニュー（メイン）
    quizList: document.getElementById('quiz-list'),
    modeList: document.getElementById('mode-list'),
    startButton: document.getElementById('start-button'),

    // サイド: 共通 Settings
    sideSettings: document.getElementById('side-settings'),
    menuThemeToggle: document.getElementById('theme-toggle-menu'),
    menuSizeSmall: document.getElementById('size-small-menu'),
    menuSizeMedium: document.getElementById('size-medium-menu'),
    menuSizeLarge: document.getElementById('size-large-menu'),

    // サイド: メニュー専用
    sideMenu: document.getElementById('side-menu'),
    questionCountInput: document.getElementById('question-count'),

    // クイズ（メイン）
    mainQuizSection: document.getElementById('main-quiz'),
    questionCounter: document.getElementById('question-counter'),
    progressBar: document.getElementById('progress-bar'),
    modeLabel: document.getElementById('mode-label'),
    currentScore: document.getElementById('current-score'),

    questionText: document.getElementById('question-text'),
    optionsContainer: document.getElementById('options-container'),
    nextButton: document.getElementById('next-button'),

    // Tips コンテナ
    tipContainer: document.getElementById('tip-container'),

    // クイズ（サイド専用）
    sideQuiz: document.getElementById('side-quiz'),
    reviewEmpty: document.getElementById('review-empty'),
    reviewList: document.getElementById('review-list'),
    mistakeCount: document.getElementById('mistake-count'),

    // 結果
    resultScreen: document.getElementById('result-screen'),
    resultScore: document.getElementById('result-score'),
    retryButton: document.getElementById('retry-button'),
    backToMenuButton: document.getElementById('back-to-menu-button')
};
