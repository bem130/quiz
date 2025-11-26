// js/main.js
import { initThemeFromStorage, toggleTheme, setSize, initAppHeightObserver } from './theme.js';
import { dom } from './dom-refs.js';
import { loadQuizDefinition } from './quiz-model.js';
import { loadQuizEntries } from './entry-model.js';
import { renderQuizMenu } from './menu-renderer.js';
import { QuizEngine } from './quiz-engine.js';
import {
    renderQuestionText,
    renderOptions,
    renderProgress,
    showOptionFeedback,
    resetReviewList,
    addReviewItem
} from './quiz-renderer.js';

let quizDef = null;
let quizEntries = [];
let engine = null;

let totalQuestions = 10;
let currentIndex = 0;
let currentScore = 0;
let currentQuestion = null;
let hasAnswered = false;

// 現在選択中の modeId
let currentModeId = null;

// 現在の画面状態 ("menu" | "quiz" | "result")
let currentScreen = 'menu';

// 画面切り替え: "menu" / "quiz" / "result"
function showScreen(name) {
    currentScreen = name;

    // メイン
    dom.mainMenu.classList.add('hidden');
    dom.mainQuiz.classList.add('hidden');

    // サイド（下半分だけ切り替える）
    dom.sideMenu.classList.add('hidden');
    dom.sideQuiz.classList.add('hidden');

    // ヘッダスコア
    dom.quizHeaderScore.classList.add('hidden');

    // 結果パネル
    dom.resultScreen.classList.add('hidden');

    if (name === 'menu') {
        dom.mainMenu.classList.remove('hidden');
        dom.sideMenu.classList.remove('hidden');
    } else if (name === 'quiz') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
    } else if (name === 'result') {
        dom.mainQuiz.classList.remove('hidden');
        dom.sideQuiz.classList.remove('hidden');
        dom.quizHeaderScore.classList.remove('hidden');
        dom.resultScreen.classList.remove('hidden');
    }
}

// Next ボタンと Space / Enter / 正答再クリックから共通で使う「次の問題へ」処理
function goToNextQuestion() {
    if (!hasAnswered) return;
    currentIndex += 1;
    loadNextQuestion();
}

// Mode ボタン生成
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
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-100'
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

    engine.setMode(modeId);
    renderProgress(currentIndex, totalQuestions, currentScore);
    resetReviewList();

    showScreen('quiz');
    loadNextQuestion();
}

function loadNextQuestion() {
    if (currentIndex >= totalQuestions) {
        showResult();
        return;
    }

    hasAnswered = false;
    dom.nextButton.disabled = true;

    currentQuestion = engine.generateQuestion();
    const entity = quizDef.entitySet.entities[currentQuestion.entityId];

    renderQuestionText(currentQuestion.patternTokens, entity, true);
    renderOptions(currentQuestion, quizDef.entitySet, handleSelectOption);
    renderProgress(currentIndex, totalQuestions, currentScore);
}

function handleSelectOption(selectedIndex) {
    if (!currentQuestion) return;

    const correctIndex = currentQuestion.answer.correctIndex;

    // 既に答えたあとに「正答のボタン」を再度押したら、そのまま次の問題へ
    if (hasAnswered) {
        if (selectedIndex === correctIndex) {
            goToNextQuestion();
        }
        return;
    }

    // まだ答えていないときの通常処理
    hasAnswered = true;

    if (selectedIndex === correctIndex) {
        currentScore += 1;
    } else {
        addReviewItem(currentQuestion, quizDef.entitySet, currentIndex + 1);
    }

    showOptionFeedback(currentQuestion, selectedIndex);
    renderProgress(currentIndex, totalQuestions, currentScore);

    dom.nextButton.disabled = false;
}

function showResult() {
    dom.resultScore.textContent = `${currentScore} / ${totalQuestions}`;
    showScreen('result');
}

// キーボード操作のセットアップ
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

        // 数字キー 1〜4 → 選択肢 0〜3
        if (e.key >= '1' && e.key <= '4') {
            const index = Number(e.key) - 1;
            const optionsLen = currentQuestion.answer.options.length;
            if (index >= 0 && index < optionsLen) {
                e.preventDefault();
                handleSelectOption(index);
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

async function bootstrap() {
    initThemeFromStorage();
    initAppHeightObserver();

    try {
        const [def, entries] = await Promise.all([
            loadQuizDefinition(),
            loadQuizEntries()
        ]);
        quizDef = def;
        quizEntries = entries;

        document.title = quizDef.meta.title || '4-choice Quiz';
        dom.appTitle.textContent = quizDef.meta.title || '4-choice Quiz';
        dom.appDescription.textContent = quizDef.meta.description || '';

        renderQuizMenu(quizEntries);

        engine = new QuizEngine(quizDef);
        populateModeButtons();

        // 共通 Settings エリアのボタン
        if (dom.menuThemeToggle) {
            dom.menuThemeToggle.addEventListener('click', () => {
                toggleTheme();
            });
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

        // クイズ開始 / 進行系
        dom.startButton.addEventListener('click', startQuiz);

        dom.nextButton.addEventListener('click', () => {
            goToNextQuestion();
        });

        dom.retryButton.addEventListener('click', () => {
            currentIndex = 0;
            currentScore = 0;
            hasAnswered = false;
            dom.nextButton.disabled = true;
            showScreen('quiz');
            loadNextQuestion();
        });

        dom.backToMenuButton.addEventListener('click', () => {
            showScreen('menu');
        });

        setupKeyboardShortcuts();
        showScreen('menu');
    } catch (e) {
        console.error(e);
        dom.appDescription.textContent = 'Failed to load quiz definition.';
    }
}

bootstrap();
