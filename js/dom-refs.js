// js/dom-refs.js

export const dom = {
    // 共通ヘッダ
    appTitle: document.getElementById('app-title'),
    appDescription: document.getElementById('app-description'),
    quizHeaderScore: document.getElementById('quiz-header-score'),
    currentScore: document.getElementById('current-score'),

    // メイン側（左パネル）
    mainMenu: document.getElementById('main-menu'),
    mainQuiz: document.getElementById('main-quiz'),
    questionView: document.getElementById('question-view'),

    // メニュー（メイン）
    quizList: document.getElementById('quiz-list'),
    modeList: document.getElementById('mode-list'),
    startButton: document.getElementById('start-button'),

    // メニュー側: テキストサイズ & テーマ
    menuSizeXXSmall: document.getElementById('size-xxs-menu'),
    menuSizeXSmall: document.getElementById('size-xs-menu'),
    menuSizeSmall: document.getElementById('size-small-menu'),
    menuSizeMedium: document.getElementById('size-medium-menu'),
    menuSizeLarge: document.getElementById('size-large-menu'),
    menuSizeXLarge: document.getElementById('size-xl-menu'),
    menuSizeXXLarge: document.getElementById('size-xxl-menu'),
    menuThemeToggle: document.getElementById('theme-toggle-menu'),
    menuFullscreenToggle: document.getElementById('fullscreen-toggle-menu'),

    // メニュー側: 問題数
    questionCountInput: document.getElementById('question-count'),

    // クイズ画面: 進捗
    currentQNum: document.getElementById('current-q-num'),
    totalQNum: document.getElementById('total-q-num'),

    // クイズ画面: 本文・選択肢
    questionText: document.getElementById('question-text'),
    optionsContainer: document.getElementById('options-container'),

    // クイズ画面: Tips コンテナ
    tipContainer: document.getElementById('tip-container'),

    // クイズ画面: Next ボタン
    nextButton: document.getElementById('next-button'),

    // サイドパネル: メニュー用
    sideMenu: document.getElementById('side-menu'),

    // サイドパネル: クイズ用（Mistakes）
    sideQuiz: document.getElementById('side-quiz'),
    reviewEmpty: document.getElementById('review-empty'),
    reviewList: document.getElementById('review-list'),
    mistakeCount: document.getElementById('mistake-count'),
    resultListPanel: document.getElementById('result-list-panel'),
    resultList: document.getElementById('result-list'),
    mistakesPanel: document.getElementById('mistakes-panel'),

    // 結果画面
    resultScreen: document.getElementById('result-screen'),
    resultScore: document.getElementById('result-score'),
    resultTotal: document.getElementById('result-total'),
    resultCorrect: document.getElementById('result-correct'),
    resultAccuracy: document.getElementById('result-accuracy'),
    retryButton: document.getElementById('retry-button'),
    backToMenuButton: document.getElementById('back-to-menu-button')
};
