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

// 画面切り替え: "menu" / "quiz" / "result"
function showScreen(name) {
    // メイン
    dom.mainMenu.classList.add('hidden');
    dom.mainQuiz.classList.add('hidden');

    // サイド
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

function populateModeSelect() {
    dom.modeSelect.innerHTML = '';
    quizDef.modes.forEach((mode, idx) => {
        const opt = document.createElement('option');
        opt.value = mode.id;
        opt.textContent = mode.label || mode.id;
        if (idx === 0) opt.selected = true;
        dom.modeSelect.appendChild(opt);
    });
}

function startQuiz() {
    const modeId = dom.modeSelect.value;
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
    if (hasAnswered) return;
    hasAnswered = true;

    const correctIndex = currentQuestion.answer.correctIndex;
    if (selectedIndex === correctIndex) {
        currentScore += 1;
    } else {
        // 間違えた問題をサブエリアに追加
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
        populateModeSelect();

        // メニュー側設定ボタン
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

        dom.startButton.addEventListener('click', startQuiz);

        dom.nextButton.addEventListener('click', () => {
            if (!hasAnswered) return;
            currentIndex += 1;
            loadNextQuestion();
        });

        dom.retryButton.addEventListener('click', () => {
            // 同じ設定で再チャレンジ
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

        showScreen('menu');
    } catch (e) {
        console.error(e);
        dom.appDescription.textContent = 'Failed to load quiz definition.';
    }
}

bootstrap();
