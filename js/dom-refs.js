// js/dom-refs.js

export const dom = {
    // 共通ヘッダ
    appTitle: document.getElementById('app-title'),
    appDescription: document.getElementById('app-description'),
    quizHeaderScore: document.getElementById('quiz-header-score'),
    questionStageLabel: document.getElementById('question-stage-label'),
    currentScore: document.getElementById('current-score'),
    quizLifetimeAccuracy: document.getElementById('quiz-lifetime-accuracy'),
    quizLifetimeAttempts: document.getElementById('quiz-lifetime-attempts'),

    // メイン側（左パネル）
    mainMenu: document.getElementById('main-menu'),
    mainQuiz: document.getElementById('main-quiz'),
    questionView: document.getElementById('question-view'),

    // メニュー（メイン）
    quizList: document.getElementById('quiz-list'),
    modeList: document.getElementById('mode-list'),
    startButton: document.getElementById('start-button'),
    modeMessage: document.getElementById('mode-message'),
    menuTabQuizzesButton: document.getElementById('menu-tab-button-quizzes'),
    menuTabModeButton: document.getElementById('menu-tab-button-mode'),
    menuTabOptionsButton: document.getElementById('menu-tab-button-options'),
    menuTabQuizzesPanel: document.getElementById('menu-tab-panel-quizzes'),
    menuTabModePanel: document.getElementById('menu-tab-panel-mode'),
    menuTabOptionsPanel: document.getElementById('menu-tab-panel-options'),
    selectedQuizTitle: document.getElementById('selected-quiz-title'),
    selectedQuizDesc: document.getElementById('selected-quiz-desc'),
    selectedModeTitle: document.getElementById('selected-mode-title'),
    selectedModeDesc: document.getElementById('selected-mode-desc'),
    selectedGameModeTitle: document.getElementById('selected-game-mode-title'),
    selectedGameModeDesc: document.getElementById('selected-game-mode-desc'),
    gameModeStudyButton: document.getElementById('game-mode-study-button'),
    gameModeTestButton: document.getElementById('game-mode-test-button'),
    studyModeConfig: document.getElementById('study-mode-config'),
    testModeConfig: document.getElementById('test-mode-config'),
    studyCompletionOptions: document.getElementById('study-completion-options'),
    testCompletionOptions: document.getElementById('test-completion-options'),
    studyTimeLimitGroup: document.getElementById('study-time-limit-group'),
    testTimeLimitGroup: document.getElementById('test-time-limit-group'),
    studyTimeLimitInput: document.getElementById('study-time-limit'),
    testTimeLimitInput: document.getElementById('test-time-limit'),
    studyDrainNotice: document.getElementById('study-drain-notice'),
    sideUserLabel: document.getElementById('side-user-label'),
    userList: document.getElementById('user-list'),
    userCreateForm: document.getElementById('user-create-form'),
    userCreateInput: document.getElementById('user-create-input'),
    userCreateButton: document.getElementById('user-create-button'),

    // Update notification banner
    updateNotificationBanner: document.getElementById('update-notification-banner'),
    updateNotificationClose: document.getElementById('update-notification-close'),
    updateNotificationReload: document.getElementById('update-notification-reload'),
    updateNotificationLater: document.getElementById('update-notification-later'),

    // Draft specific
    draftSummaryPanel: document.getElementById('draft-summary-panel'),
    draftSummaryContent: document.getElementById('draft-summary-content'),
    draftSummaryUpdated: document.getElementById('draft-summary-updated'),
    // draftPatternPanel is removed in favor of inline header + list
    draftPatternList: document.getElementById('pattern-mode-list'),

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
    cacheClearButton: document.getElementById('cache-clear-button'),
    cacheClearStatus: document.getElementById('cache-clear-status'),

    // メニュー側: 問題数
    questionCountSlider: document.getElementById('question-count-slider'),
    questionCountLabel: document.getElementById('question-count-label'),
    questionCountInput: document.getElementById('question-count'),

    // クイズ画面: 進捗
    currentQNum: document.getElementById('current-q-num'),
    totalQNum: document.getElementById('total-q-num'),

    // クイズ画面: 本文・選択肢
    questionText: document.getElementById('question-text'),
    optionsContainer: document.getElementById('options-container'),

    // クイズ画面: Tips コンテナ
    tipContainer: document.getElementById('tip-container'),

    quizUserLabel: document.getElementById('quiz-user-label'),

    // Quiz screen: timer
    quizTimer: document.getElementById('quiz-timer'),

    // Quiz screen: question and options
    questionText: document.getElementById('question-text'),
    optionsContainer: document.getElementById('options-container'),

    // Quiz screen: Tips container
    tipContainer: document.getElementById('tip-container'),

    // Quiz screen: Next button
    nextButton: document.getElementById('next-button'),
    idkButton: document.getElementById('idk-button'),
    idkFollowupPanel: document.getElementById('idk-followup-panel'),
    idkFollowupOptions: document.getElementById('idk-followup-options'),
    idkFollowupSkip: document.getElementById('idk-followup-skip'),

    // Quiz screen: Interrupt button
    interruptButton: document.getElementById('interrupt-button'),

    // サイドパネル: メニュー用
    sideMenu: document.getElementById('side-menu'),
    entryList: document.getElementById('entry-list'),
    entryUrlInput: document.getElementById('entry-url-input'),
    entryAddButton: document.getElementById('entry-add-button'),

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
    resultKnownAccuracy: document.getElementById('result-known-accuracy'),
    resultIdkRate: document.getElementById('result-idk-rate'),
    resultLifetimeAccuracy: document.getElementById('result-lifetime-accuracy'),
    resultTotalAttempts: document.getElementById('result-total-attempts'),
    retryButton: document.getElementById('retry-button'),
    retryMistakesButton: document.getElementById('retry-mistakes-button'),
    copyResultButton: document.getElementById('copy-result-button'),
    backToMenuButton: document.getElementById('back-to-menu-button'),
    resultPwaHint: document.getElementById('result-pwa-hint'),
    resultPwaInstallButton: document.getElementById('result-pwa-install-button'),
    resultUserLabel: document.getElementById('result-user-label'),

    // Ruby Buffer
    rubyBufferPanel: document.getElementById('ruby-buffer-panel'),
    rubyBufferJson: document.getElementById('ruby-buffer-json')
};
