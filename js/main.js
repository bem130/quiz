// js/main.js
import { initThemeFromStorage, toggleTheme, setSize, initAppHeightObserver } from './theme.js';
import { dom } from './dom-refs.js';
import { loadQuizDefinition } from './quiz-model.js';
import { loadQuizEntries } from './entry-model.js';
import { renderQuizMenu } from './menu-renderer.js';
import { QuizEngine, NoQuestionsAvailableError } from './quiz-engine.js';
import {
    renderQuestion,
    renderProgress,
    showOptionFeedback,
    resetReviewList,
    addReviewItem,
    renderTips,
    resetTips,
    updateInlineBlank,
    showOptionFeedbackForAnswer,
    revealNextAnswerGroup,
    appendPatternPreviewToOptions,
    summarizeQuestion,
    summarizeAnswers,
    resetResultList,
    addResultItem
} from './quiz-renderer.js';
import { selectAnswer, resetSelections } from './answer-state.js';

let quizDef = null;
let quizEntries = [];
let engine = null;

let totalQuestions = 10;
let currentIndex = 0;
let currentScore = 0;
let currentQuestion = null;
let hasAnswered = false;
let questionHistory = [];

// 現在選択中の modeId
let currentModeId = null;

// 現在の画面状態 ("menu" | "quiz" | "result")
let currentScreen = 'menu';

function resolveRowForQuestion(question) {
    if (!question || !question.meta || !question.meta.dataSetId) return null;
    const ds = quizDef && quizDef.dataSets ? quizDef.dataSets[question.meta.dataSetId] : null;
    if (!ds) return null;
    if (ds.type === 'table' && Array.isArray(ds.data)) {
        return ds.data.find((row) => row.id === question.meta.entityId) || null;
    }
    if (ds.type === 'factSentences' && Array.isArray(ds.sentences)) {
        return ds.sentences.find((s) => s.id === question.meta.sentenceId) || null;
    }
    return null;
}

/**
 * メイン／サイド／結果表示を含めた画面の表示状態を切り替える。
 * @param {'menu' | 'quiz' | 'result'} name - 表示する画面の名前。
 */
function showScreen(name) {
    currentScreen = name;

    // メイン
    dom.mainMenu.classList.add('hidden');
    dom.mainQuiz.classList.add('hidden');
    if (dom.questionView) {
        dom.questionView.classList.remove('hidden');
    }

    // サイド（下半分だけ切り替える）
    dom.sideMenu.classList.add('hidden');
    dom.sideQuiz.classList.add('hidden');

    // ヘッダスコア
    dom.quizHeaderScore.classList.add('hidden');

    // 結果パネル
    dom.resultScreen.classList.add('hidden');

    if (dom.resultListPanel) {
        dom.resultListPanel.classList.add('hidden');
    }
    if (dom.mistakesPanel) {
        dom.mistakesPanel.classList.add('hidden');
    }

    dom.nextButton.classList.remove('hidden');

    if (name === 'menu') {
        dom.mainMenu.classList.remove('hidden');
        dom.sideMenu.classList.remove('hidden');
    } else if (name === 'quiz') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
        if (dom.questionView) {
            dom.questionView.classList.remove('hidden');
        }
        if (dom.mistakesPanel) {
            dom.mistakesPanel.classList.remove('hidden');
        }
    } else if (name === 'result') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
        dom.resultScreen.classList.remove('hidden');
        if (dom.questionView) {
            dom.questionView.classList.add('hidden');
        }
        if (dom.resultListPanel) {
            dom.resultListPanel.classList.remove('hidden');
        }
        dom.nextButton.classList.add('hidden');
    }
}

/**
 * ボタンやキーボード操作から呼ばれる次の問題への遷移処理。
 */
function goToNextQuestion() {
    if (!hasAnswered) return;
    currentIndex += 1;
    loadNextQuestion();
}

/**
 * 利用可能なモードの一覧を描画し、選択状態に応じてスタイルを更新する。
 */
function populateModeButtons() {
    dom.modeList.innerHTML = '';
    if (!quizDef.modes || quizDef.modes.length === 0) {
        return;
    }

    if (!currentModeId) {
        currentModeId = quizDef.modes[0].id;
    }

    quizDef.modes.forEach((mode) => {
        const isActive = mode.id === currentModeId;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
            'w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors ' +
            (isActive
                ? 'border-emerald-400 dark:border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-100'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800');

        const title = document.createElement('div');
        title.className = 'font-semibold';
        title.textContent = mode.label || mode.id;
        btn.appendChild(title);

        if (mode.description) {
            const desc = document.createElement('div');
            desc.className = 'text-[0.8rem] text-slate-500 dark:text-slate-400';
            desc.textContent = mode.description;
            btn.appendChild(desc);
        }

        btn.addEventListener('click', () => {
            currentModeId = mode.id;
            populateModeButtons();
        });

        dom.modeList.appendChild(btn);
    });
}

// --- フルスクリーン関連の補助処理 ---

/**
 * ドキュメントがフルスクリーン表示中かどうかを判定する。
 */
function isFullscreen() {
    return !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
    );
}

/**
 * アプリ全体をフルスクリーン表示に切り替える。
 */
function requestAppFullscreen() {
    const el = document.documentElement; // 画面全体をフルスクリーンにする
    if (el.requestFullscreen) {
        el.requestFullscreen();
    } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
        el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
        el.msRequestFullscreen();
    }
}

/**
 * フルスクリーン表示を終了させる。
 */
function exitAppFullscreen() {
    if (document.exitFullscreen) {
        document.exitFullscreen();
    } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }
}

/**
 * 現在のフルスクリーン状態に合わせてメニューのボタンラベルを更新する。
 */
function updateFullscreenButton() {
    if (!dom.menuFullscreenToggle) return;
    const active = isFullscreen();
    dom.menuFullscreenToggle.textContent = active ? 'Exit Full' : 'Full';
}

/**
 * フルスクリーン状態をトグルし、操作結果に応じてラベルを更新する。
 */
function toggleFullscreen() {
    try {
        if (isFullscreen()) {
            exitAppFullscreen();
        } else {
            requestAppFullscreen();
        }
    } catch (e) {
        console.error('[fullscreen] toggle failed:', e);
    } finally {
        // 状態が変わったあとにラベルを更新（Esc などにも対応するため、イベントも後で登録）
        setTimeout(updateFullscreenButton, 100);
    }
}


/**
 * 選択中のモードと出題数を基にクイズを初期化し、最初の問題を表示する。
 */
function startQuiz() {
    const fallbackModeId =
        quizDef.modes && quizDef.modes.length > 0 ? quizDef.modes[0].id : null;
    const modeId = currentModeId || fallbackModeId;

    if (!modeId) {
        console.error('No mode available.');
        return;
    }

    const n = parseInt(dom.questionCountInput.value, 10);
    totalQuestions = Number.isFinite(n) && n > 0 ? n : 10;

    currentIndex = 0;
    currentScore = 0;
    hasAnswered = false;
    dom.nextButton.disabled = true;
    questionHistory = [];

    engine.setMode(modeId);
    renderProgress(currentIndex, totalQuestions, currentScore);
    resetReviewList();
    resetTips();
    resetResultList();
    if (dom.resultListPanel) {
        dom.resultListPanel.classList.add('hidden');
    }

    showScreen('quiz');
    loadNextQuestion();
}

/**
 * 現在の進行状況に応じて次の問題を生成し、画面を更新する。
 */
function loadNextQuestion() {
    if (currentIndex >= totalQuestions) {
        showResult();
        return;
    }

    hasAnswered = false;
    dom.nextButton.disabled = true;

    // 前の問題の Tips をクリア
    resetTips();

    try {
        currentQuestion = engine.generateQuestion();
    } catch (e) {
        if (e instanceof NoQuestionsAvailableError) {
            console.warn('[quiz] No questions available for current mode/filters');
            dom.questionText.textContent = 'No questions available. Please change the mode or filters.';
            dom.optionsContainer.innerHTML = '';
            dom.nextButton.disabled = true;
            return;
        }
        console.error('[quiz] Failed to generate question:', e);
        dom.questionText.textContent = 'Failed to generate question.';
        dom.optionsContainer.innerHTML = '';
        dom.nextButton.disabled = true;
        return;
    }
    resetSelections(currentQuestion);

    renderQuestion(currentQuestion, quizDef.dataSets, handleSelectOption);
    renderProgress(currentIndex, totalQuestions, currentScore);
}

/**
 * 選択肢のクリックに応じて回答状態を更新し、採点とフィードバックを行う。
 * @param {number} answerIndex - 回答対象のパーツのインデックス。
 * @param {number} optionIndex - 選択された選択肢のインデックス。
 */
function handleSelectOption(answerIndex, optionIndex) {
    if (!currentQuestion || !Array.isArray(currentQuestion.answers)) return;

    // すでに採点済み（hasAnswered === true）の場合の挙動をここで制御
    if (hasAnswered) {
        const answers = currentQuestion.answers;
        const target = answers[answerIndex];
        if (!target) return;

        const lastSelectionIsCorrect = optionIndex === target.correctIndex;

        // 採点済みの状態では、正解ボタンを押したときだけ次の問題へ進める
        if (lastSelectionIsCorrect) {
            console.log('[quiz] correct option clicked after answered; goToNextQuestion');
            goToNextQuestion();
        }
        return;
    }

    // ここからは採点前（hasAnswered === false）の通常処理
    const selectionState = selectAnswer(currentQuestion, answerIndex, optionIndex);

    // まずはこのパーツだけ本文の穴埋めとボタンを更新し、次のパーツを出す
    updateInlineBlank(currentQuestion, quizDef.dataSets, answerIndex);
    showOptionFeedbackForAnswer(currentQuestion, answerIndex);
    revealNextAnswerGroup(answerIndex);

    // 未選択のパーツがある場合はスコア算出を保留する
    if (!selectionState.allSelected) {
        return;
    }

    // ここに来た時点で、全パーツに回答が入った
    hasAnswered = true;

    if (selectionState.fullyCorrect) {
        currentScore += 1;
    } else {
        addReviewItem(currentQuestion, quizDef.dataSets, currentIndex + 1);
    }

    const historyItem = {
        index: currentIndex + 1,
        question: currentQuestion, // question オブジェクトへの参照
        userAnswerSummary: summarizeAnswers(currentQuestion, quizDef.dataSets),
        correct: selectionState.fullyCorrect
    };
    questionHistory.push(historyItem);

    // 全パーツのボタンに最終的なフィードバックを適用（枠・背景の緑/赤など）
    showOptionFeedback(currentQuestion);

    // 各ボタン内にパターン全文のプレビューを追記
    appendPatternPreviewToOptions(currentQuestion, quizDef.dataSets);

    // スコアなどの表示を更新
    renderProgress(currentIndex, totalQuestions, currentScore);

    const row = resolveRowForQuestion(currentQuestion);
    if (currentQuestion.patternTips && currentQuestion.patternTips.length && row) {
        renderTips(currentQuestion.patternTips, row, selectionState.fullyCorrect);
    } else {
        resetTips();
    }

    dom.nextButton.disabled = false;
}

/**
 * クイズ結果を表示し、スコアの概要と画面状態を更新する。
 */
function showResult() {
    dom.resultScore.textContent = `Score: ${currentScore} / ${totalQuestions}`;
    dom.resultTotal.textContent = `${totalQuestions}`;
    dom.resultCorrect.textContent = `${currentScore}`;
    const accuracy = totalQuestions > 0 ? Math.round((currentScore / totalQuestions) * 100) : 0;
    dom.resultAccuracy.textContent = `${accuracy}%`;

    // 結果画面では Tips を消す
    resetTips();

    resetResultList();
    questionHistory.forEach((item) =>
        addResultItem(item, quizDef.dataSets)
    );

    showScreen('result');
}

/**
 * 数字キーやスペースキーによる回答・遷移を有効化するキーボード操作を登録する。
 */
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // 入力フィールドにフォーカスがあるときは邪魔しない
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea') {
            return;
        }

        if (currentScreen !== 'quiz') {
            return;
        }
        if (!currentQuestion) return;

        // 数字キー 1〜4 → 未回答パーツ（なければ先頭パーツ）に適用
        if (e.key >= '1' && e.key <= '4') {
            const answers = currentQuestion.answers || [];
            if (!answers.length) return;

            const targetIdx = answers.findIndex((ans) => ans.userSelectedIndex == null);
            const ansIndex = targetIdx >= 0 ? targetIdx : 0;
            const answer = answers[ansIndex];
            const index = Number(e.key) - 1;
            const optionsLen = (answer && answer.options && answer.options.length) || 0;
            if (index >= 0 && index < optionsLen) {
                e.preventDefault();
                handleSelectOption(ansIndex, index);
            }
            return;
        }

        // Space / Enter → 解答済みなら次の問題へ（Next と同じ）
        if (
            e.key === ' ' ||
            e.code === 'Space' ||
            e.key === 'Spacebar' ||
            e.key === 'Enter'
        ) {
            if (!hasAnswered) return;
            e.preventDefault();
            goToNextQuestion();
        }
    });
}

/**
 * アプリ起動時の初期化処理。データ読込、UI 初期化、イベント登録をまとめる。
 */
async function bootstrap() {
    initThemeFromStorage();
    initAppHeightObserver();

    console.log('[bootstrap] starting app. location =', window.location.href);

    try {
        // 1. まずメニュー用のエントリ一覧を読み込む
        const entries = await loadQuizEntries();
        console.log(
            '[bootstrap] loadQuizEntries count =',
            Array.isArray(entries) ? entries.length : 'not array'
        );
        quizEntries = entries;

        // 2. entries と URL (?quiz=...) に基づいてクイズ定義を読み込む
        const def = await loadQuizDefinition(quizEntries);
        console.log('[bootstrap] loadQuizDefinition result =', def);
        quizDef = def.definition;

        // 3. UI 更新
        document.title = quizDef.meta.title || '4-choice Quiz';
        dom.appTitle.textContent = quizDef.meta.title || '4-choice Quiz';
        dom.appDescription.textContent =
            quizDef.meta.description || '';

        renderQuizMenu(quizEntries);

        engine = new QuizEngine(quizDef);
        populateModeButtons();

        // 共通 Settings エリアのボタン
        if (dom.menuThemeToggle) {
            dom.menuThemeToggle.addEventListener('click', () => {
                toggleTheme();
            });
        }

        if (dom.menuFullscreenToggle) {
            dom.menuFullscreenToggle.addEventListener('click', () => {
                toggleFullscreen();
            });

            // フルスクリーン状態が Esc キーなどで変わったときもラベル更新
            document.addEventListener('fullscreenchange', updateFullscreenButton);
            document.addEventListener('webkitfullscreenchange', updateFullscreenButton);
            document.addEventListener('mozfullscreenchange', updateFullscreenButton);
            document.addEventListener('MSFullscreenChange', updateFullscreenButton);

            // 初期ラベル
            updateFullscreenButton();
        }

        // テキストサイズ変更（7 段階）
        if (dom.menuSizeXXSmall) {
            dom.menuSizeXXSmall.addEventListener('click', () => setSize('xxs'));
        }
        if (dom.menuSizeXSmall) {
            dom.menuSizeXSmall.addEventListener('click', () => setSize('xs'));
        }
        if (dom.menuSizeSmall) {
            dom.menuSizeSmall.addEventListener('click', () => setSize('s'));
        }
        if (dom.menuSizeMedium) {
            dom.menuSizeMedium.addEventListener('click', () => setSize('m'));
        }
        if (dom.menuSizeLarge) {
            dom.menuSizeLarge.addEventListener('click', () => setSize('l'));
        }
        if (dom.menuSizeXLarge) {
            dom.menuSizeXLarge.addEventListener('click', () => setSize('xl'));
        }
        if (dom.menuSizeXXLarge) {
            dom.menuSizeXXLarge.addEventListener('click', () => setSize('xxl'));
        }

        // クイズ開始と進行のボタン
        dom.startButton.addEventListener('click', startQuiz);

        dom.nextButton.addEventListener('click', () => {
            goToNextQuestion();
        });

        // 結果画面のリトライ／メニュー戻りボタン
        if (dom.retryButton) {
            dom.retryButton.addEventListener('click', () => {
                console.log('[result] Retry button clicked');
                // 選択中のモードと出題数でクイズを再開
                startQuiz();
            });
        }

        if (dom.backToMenuButton) {
            dom.backToMenuButton.addEventListener('click', () => {
                console.log('[result] Back-to-menu button clicked');
                // Mistakes と Tips をクリアしてメニューに戻る
                resetReviewList();
                resetTips();
                showScreen('menu');
            });
        }

        setupKeyboardShortcuts();
        showScreen('menu');
    } catch (e) {
        console.error('[bootstrap] failed to initialize app:', e);
        dom.appDescription.textContent =
            'Failed to load quiz definition.';
    }
}

bootstrap();
