// js/quiz-renderer.js
import { dom } from './dom-refs.js';

/**
 * Tips を表示する条件を判定するヘルパー
 */
function isTipVisible(tip, isCorrect) {
    const when = tip && tip.when ? tip.when : 'always';

    if (when === 'always') return true;
    if (when === 'correct') return Boolean(isCorrect);
    if (when === 'incorrect') return !isCorrect;

    return false;
}

/**
 * スタイル付き span を生成するヘルパー
 * - KaTeX（数式）対応
 * - 太字 / 斜体 / フォント系など
 */
function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');

    // KaTeX (katex) スタイルが指定されている場合
    if (styles.includes('katex') && window.katex) {
        try {
            window.katex.render(text, span, {
                throwOnError: false,
                strict: false
            });
            return span;
        } catch (e) {
            // 失敗した場合はふつうのテキストにフォールバック
        }
    }

    span.textContent = text;

    if (styles.includes('bold')) span.classList.add('font-semibold');
    if (styles.includes('italic')) span.classList.add('italic');
    if (styles.includes('serif')) span.classList.add('font-serif');
    if (styles.includes('sans')) span.classList.add('font-sans');
    if (styles.includes('muted')) {
        span.classList.add('text-slate-500', 'dark:text-slate-400');
    }

    return span;
}

/**
 * ruby 用の base/ruby サブ仕様からテキストを取り出すヘルパー
 */
function resolveSubTokenValue(spec, entity) {
    if (!spec) return '';
    const source = spec.source || 'text';

    if (source === 'key') {
        const field = spec.field;
        return field && entity ? (entity[field] ?? '') : '';
    }
    if (source === 'text') {
        return spec.value ?? '';
    }

    return '';
}

/**
 * ruby / hideruby 用の描画
 * token.base, token.ruby からテキストを取り出し、<ruby> を組み立てる
 */
function renderRubyToken(token, entity) {
    const rubyEl = document.createElement('ruby');

    const baseText = token.base
        ? resolveSubTokenValue(token.base, entity)
        : '';
    const rubyText = token.ruby
        ? resolveSubTokenValue(token.ruby, entity)
        : '';

    const rbSpan = document.createElement('span');
    const baseStyles = (token.base && token.base.styles) || token.styles || [];
    rbSpan.appendChild(createStyledSpan(baseText, baseStyles));

    const rt = document.createElement('rt');
    rt.textContent = rubyText;

    rubyEl.appendChild(rbSpan);
    rubyEl.appendChild(rt);

    return rubyEl;
}

/**
 * 誤答表示用に、ruby 全体と rt を少し小さくする
 */
function shrinkRubyForWrong(rubyEl) {
    if (!rubyEl) return rubyEl;

    rubyEl.style.fontSize = '0.9em';

    const rt = rubyEl.querySelector('rt');
    if (rt) {
        rt.style.fontSize = '0.7em';
    }

    return rubyEl;
}

/**
 * 本文や Tips, 選択肢ラベルに使う Token 配列を HTMLElement に追加する。
 *
 * token.type:
 *  - 'text' : 素のテキスト
 *  - 'key'  : entity[field] を参照
 *  - 'ruby' / 'hideruby' : renderRubyToken
 *  - 'hide' : 「隠す用」だが Tips 等では普通の key として扱う
 *  - 'br'   : 改行
 */
function appendTokens(parent, tokens, entity) {
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;

        if (token.type === 'text') {
            parent.appendChild(
                createStyledSpan(token.value ?? '', token.styles || [])
            );
            return;
        }

        if (token.type === 'key') {
            const field = token.field;
            const value = field && entity ? (entity[field] ?? '') : '';
            parent.appendChild(
                createStyledSpan(value, token.styles || [])
            );
            return;
        }

        if (token.type === 'ruby' || token.type === 'hideruby') {
            parent.appendChild(renderRubyToken(token, entity));
            return;
        }

        if (token.type === 'hide') {
            // Tips や選択肢などでは普通に表示してしまう
            const field = token.field;
            const value = field && entity ? (entity[field] ?? '') : '';
            parent.appendChild(
                createStyledSpan(value || '____', token.styles || [])
            );
            return;
        }

        if (token.type === 'br') {
            parent.appendChild(document.createElement('br'));
            return;
        }
    });
}

/**
 * 本文の穴埋め用プレースホルダ（下線だけ）を生成
 */
function createBlankPlaceholder(answerIndex) {
    const wrapper = document.createElement('span');
    wrapper.dataset.answerIndex = String(answerIndex);
    wrapper.className =
        'relative inline-block mx-1 align-baseline';

    const underline = document.createElement('span');
    underline.className =
        'block px-2 border-b border-slate-500 min-w-[2.5rem]';
    underline.textContent = ' ';

    wrapper.appendChild(underline);
    return wrapper;
}

/**
 * 質問文 (patternTokens) を描画する。
 *
 * - skipAnswerTokens === true のとき:
 *   - hide / hideruby で answer が付いているトークンは下線プレースホルダに置換（穴埋め）
 *   - その他のトークンは通常通り
 * - skipAnswerTokens === false のとき:
 *   - hide / hideruby も含めて「正しい本文」をそのまま描画
 */
export function renderQuestionText(
    patternTokens,
    entity,
    skipAnswerTokens = true,
    targetElement = dom.questionText
) {
    targetElement.innerHTML = '';

    let answerCounter = 0;

    (patternTokens || []).forEach((token) => {
        if (!token || !token.type) return;

        const isAnswerToken = Boolean(token.answer);

        // クイズ本編: answer 付きの hide/hideruby は下線プレースホルダ
        if (skipAnswerTokens && isAnswerToken) {
            if (token.type === 'hide' || token.type === 'hideruby') {
                const placeholder = createBlankPlaceholder(answerCounter);
                answerCounter += 1;
                targetElement.appendChild(placeholder);
                return;
            }
        }

        // Mistakes など: skipAnswerTokens = false のときは「正解そのもの」を描画
        switch (token.type) {
            case 'text':
                targetElement.appendChild(
                    createStyledSpan(token.value ?? '', token.styles || [])
                );
                break;
            case 'key': {
                const field = token.field;
                const text =
                    field && entity
                        ? (entity[field] ?? '')
                        : '';
                targetElement.appendChild(
                    createStyledSpan(text, token.styles || [])
                );
                break;
            }
            case 'ruby':
            case 'hideruby':
                targetElement.appendChild(
                    renderRubyToken(token, entity)
                );
                break;
            case 'hide': {
                const field = token.field;
                const text =
                    field && entity
                        ? (entity[field] ?? '')
                        : '';
                targetElement.appendChild(
                    createStyledSpan(
                        skipAnswerTokens ? '____' : text,
                        token.styles || []
                    )
                );
                break;
            }
            case 'br':
                targetElement.appendChild(document.createElement('br'));
                break;
            default:
                break;
        }
    });
}

/**
 * 1つの穴埋め（answers[answerIndex]）に対して
 * 「正答（上・下線つき） → 誤答（下・小さめ赤文字）」を表示する。
 *
 * rootElement:
 *   - 本編の問題文 → dom.questionText
 *   - ミス一覧（Mistakes）用 → addReviewItem 内で渡される qText
 *
 * Mistakes では正答を青緑色で強調する。
 */
export function updateInlineBlank(
    question,
    entitySet,
    answerIndex,
    rootElement = dom.questionText
) {
    const entities = entitySet.entities || {};
    const answers = question.answers || [];
    const answer = answers[answerIndex];
    if (!answer) return;

    const placeholder = rootElement.querySelector(
        `[data-answer-index="${answerIndex}"]`
    );
    if (!placeholder) return;

    const correctOpt = answer.options?.[answer.correctIndex];
    if (!correctOpt) return;

    const correctEntity = entities[correctOpt.entityId];
    if (!correctEntity) return;

    const userIndex = answer.userSelectedIndex;
    const isCorrect = userIndex === answer.correctIndex;

    const userOpt =
        userIndex != null ? answer.options[userIndex] : null;
    const userEntity =
        userOpt && entities[userOpt.entityId] ? entities[userOpt.entityId] : null;

    // Mistakes（復習画面）かどうか
    const isReviewContext = rootElement !== dom.questionText;

    // プレースホルダを縦積み構造にリセット
    placeholder.innerHTML = '';
    placeholder.className =
        'inline-flex flex-col items-start mx-1 align-baseline leading-tight';

    // ------------------------------
    // 上段：正答（下線つき）
    // ------------------------------
    const correctLine = document.createElement('span');
    correctLine.className =
        'block px-2 border-b border-slate-500 min-w-[2.5rem] whitespace-nowrap';

    if (isReviewContext) {
        // Mistakes では強調表示（青緑色）
        correctLine.classList.add('text-emerald-300', 'dark:text-emerald-200');
    }

    if (answer.token.type === 'hideruby') {
        const rubyEl = renderRubyToken(answer.token, correctEntity);
        correctLine.appendChild(rubyEl);
    } else {
        const field = answer.token.field;
        const text = field
            ? (correctEntity?.[field] ?? '')
            : (correctEntity?.nameEnCap ?? '');
        correctLine.appendChild(
            createStyledSpan(text, answer.token.styles || [])
        );
    }

    placeholder.appendChild(correctLine);

    // ------------------------------
    // 下段：誤答（小さめ赤文字）※誤答のときだけ
    // ------------------------------
    if (!isCorrect && userEntity) {
        const wrongLine = document.createElement('span');
        wrongLine.className =
            'mt-0.5 text-[0.7rem] text-rose-400 dark:text-rose-300 ' +
            'flex items-center gap-1 whitespace-nowrap';

        const mark = document.createElement('span');
        mark.textContent = '×';
        wrongLine.appendChild(mark);

        if (answer.token.type === 'hideruby') {
            const rubyWrong = renderRubyToken(answer.token, userEntity);
            shrinkRubyForWrong(rubyWrong); // ルビを小さくする
            wrongLine.appendChild(rubyWrong);
        } else {
            const field = answer.token.field;
            const text = field
                ? (userEntity?.[field] ?? '')
                : (userEntity?.nameEnCap ?? '');
            const span = createStyledSpan(text, answer.token.styles || []);
            span.style.fontSize = '0.85em';
            wrongLine.appendChild(span);
        }

        placeholder.appendChild(wrongLine);
    }
}

/* ============================================================
 *  複数パーツ問題用ナビゲーション（< > ボタン）
 * ============================================================ */

// 複数パーツ問題用のナビゲーション状態
let currentAnswerGroupIndex = 0;    // 現在表示しているパート
let maxVisibleAnswerGroupIndex = 0; // 解放済みの最大パート
let totalAnswerGroups = 1;          // 全パート数

let navPrevButton = null;
let navNextButton = null;
let navStatusLabel = null;

/**
 * ナビゲーション状態のリセット
 */
function resetAnswerGroupNavigation() {
    currentAnswerGroupIndex = 0;
    maxVisibleAnswerGroupIndex = 0;
    totalAnswerGroups = 1;

    navPrevButton = null;
    navNextButton = null;
    navStatusLabel = null;
}

/**
 * パート表示とナビボタンの状態を更新
 * - currentAnswerGroupIndex のグループだけ表示
 * - maxVisibleAnswerGroupIndex より先のパートは常に非表示
 */
function updateAnswerGroupNavigation() {
    if (!dom.optionsContainer) return;

    const groups = Array.from(
        dom.optionsContainer.querySelectorAll('div[data-answer-index]')
    );

    groups.forEach((group) => {
        const idx = Number(group.dataset.answerIndex || '0');

        if (idx > maxVisibleAnswerGroupIndex) {
            group.classList.add('hidden');
            return;
        }

        if (idx === currentAnswerGroupIndex) {
            group.classList.remove('hidden');
        } else {
            group.classList.add('hidden');
        }
    });

    if (navStatusLabel) {
        navStatusLabel.textContent = `Part ${currentAnswerGroupIndex + 1} / ${totalAnswerGroups}`;
    }

    if (navPrevButton) {
        navPrevButton.disabled = currentAnswerGroupIndex <= 0;
    }
    if (navNextButton) {
        navNextButton.disabled =
            currentAnswerGroupIndex >= maxVisibleAnswerGroupIndex;
    }
}

/**
 * 選択肢を描画する
 * - question.answers 単位でグループ化
 * - answers.length > 1 のときは Part ナビ（< >）を表示
 */
export function renderOptions(question, entitySet, onSelectOption) {
    if (!dom.optionsContainer) return;

    dom.optionsContainer.innerHTML = '';

    const answers = question.answers || [];
    if (!answers.length) return;

    const entities = entitySet.entities || {};

    // 複数パーツ用ナビゲーションの初期化
    resetAnswerGroupNavigation();
    totalAnswerGroups = answers.length;

    const hasMultipleParts = answers.length > 1;

    // --- 複数パーツの場合はナビゲーションバーを追加 ---
    if (hasMultipleParts) {
        const nav = document.createElement('div');
        nav.className =
            'mb-2 flex items-center justify-between text-[0.7rem] ' +
            'text-slate-500 dark:text-slate-400';

        const left = document.createElement('div');
        left.textContent = 'Part navigation';

        const right = document.createElement('div');
        right.className = 'flex items-center gap-2';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className =
            'px-1.5 py-0.5 rounded border border-slate-400/60 ' +
            'text-[0.7rem] leading-none hover:bg-slate-100 ' +
            'dark:hover:bg-slate-800 transition-colors';
        prevBtn.textContent = '<';

        const status = document.createElement('span');
        status.className = 'mx-1';

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className =
            'px-1.5 py-0.5 rounded border border-slate-400/60 ' +
            'text-[0.7rem] leading-none hover:bg-slate-100 ' +
            'dark:hover:bg-slate-800 transition-colors';
        nextBtn.textContent = '>';

        prevBtn.addEventListener('click', () => {
            if (currentAnswerGroupIndex > 0) {
                currentAnswerGroupIndex -= 1;
                updateAnswerGroupNavigation();
            }
        });

        nextBtn.addEventListener('click', () => {
            // まだ解放されていないパートには進めない
            if (currentAnswerGroupIndex < maxVisibleAnswerGroupIndex) {
                currentAnswerGroupIndex += 1;
                updateAnswerGroupNavigation();
            }
        });

        right.appendChild(prevBtn);
        right.appendChild(status);
        right.appendChild(nextBtn);

        nav.appendChild(left);
        nav.appendChild(right);

        dom.optionsContainer.appendChild(nav);

        // 参照を保持
        navPrevButton = prevBtn;
        navNextButton = nextBtn;
        navStatusLabel = status;
    }

    // --- 各パートの選択肢を描画 ---
    answers.forEach((answer, ansIdx) => {
        const group = document.createElement('div');
        group.dataset.answerIndex = String(ansIdx);
        group.className = 'space-y-1';

        if (hasMultipleParts) {
            const partLabel = document.createElement('div');
            partLabel.className =
                'text-[0.75rem] text-slate-500 dark:text-slate-400 mb-1';
            partLabel.textContent = `Part ${ansIdx + 1}`;
            group.appendChild(partLabel);
        }

        const optionsRow = document.createElement('div');
        optionsRow.className = 'space-y-2';

        (answer.options || []).forEach((opt, idx) => {
            const entity = entities[opt.entityId] || null;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = [
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg border',
                'border-slate-700/40 bg-slate-900/60 text-slate-100',
                'hover:border-emerald-400/80 hover:bg-slate-900',
                'transition-colors text-left text-xs'
            ].join(' ');

            btn.dataset.answerIndex = String(ansIdx);
            btn.dataset.optionIndex = String(idx);

            // 左側の番号バッジ
            const num = document.createElement('div');
            num.className =
                'w-6 h-6 flex items-center justify-center rounded-full ' +
                'bg-slate-800 text-[0.75rem]';
            num.textContent = String(idx + 1);

            // ラベル（ルビ対応など）
            const label = document.createElement('div');
            label.className = 'flex-1 flex flex-col';

            if (opt.labelTokens && opt.labelTokens.length) {
                appendTokens(label, opt.labelTokens, entity);
            } else if (opt.label) {
                const span = document.createElement('span');
                span.textContent = opt.label;
                label.appendChild(span);
            } else {
                const span = document.createElement('span');
                span.textContent = entities[opt.entityId]?.nameEnCap ?? '';
                label.appendChild(span);
            }

            btn.appendChild(num);
            btn.appendChild(label);

            // クリック時の処理（親側から渡されたコールバック）
            btn.addEventListener('click', () => {
                if (typeof onSelectOption === 'function') {
                    onSelectOption(ansIdx, idx);
                }
            });

            optionsRow.appendChild(btn);
        });

        group.appendChild(optionsRow);
        dom.optionsContainer.appendChild(group);
    });

    // 複数パーツの場合はナビに従って表示を更新
    if (hasMultipleParts) {
        currentAnswerGroupIndex = 0;
        maxVisibleAnswerGroupIndex = 0;
        updateAnswerGroupNavigation();
    }
}

/**
 * 1つのパート（answers[answerIndex]）に対して選択肢の正誤フィードバックを表示する。
 * - 正答 → 緑
 * - 選択した誤答 → 赤
 * - ホバー演出を無効化して正誤表示を固定する
 */
export function showOptionFeedbackForAnswer(question, answerIndex) {
    const answer = (question.answers || [])[answerIndex];
    if (!answer) return;

    const buttons = Array.from(
        dom.optionsContainer.querySelectorAll(
            `button[data-answer-index="${answerIndex}"]`
        )
    );

    const correctIndex = answer.correctIndex;
    const selectedIndex = answer.userSelectedIndex;

    buttons.forEach((btn) => {
        const optIdx = Number(btn.dataset.optionIndex);

        btn.classList.remove('hover:bg-slate-100', 'dark:hover:bg-slate-800');

        if (optIdx === correctIndex) {
            btn.classList.add(
                'border-emerald-400',
                'dark:border-emerald-400',
                'bg-emerald-50',
                'dark:bg-emerald-900/40'
            );
        }

        if (
            selectedIndex != null &&
            optIdx === selectedIndex &&
            selectedIndex !== correctIndex
        ) {
            btn.classList.add(
                'border-red-400',
                'dark:border-red-400',
                'bg-red-50',
                'dark:bg-red-900/40'
            );
        }
    });
}

/**
 * 全パートの選択肢に対して最終的な正誤フィードバックを適用する。
 * - 正答 → 緑
 * - 選択した誤答 → 赤
 * - ホバー演出を無効化して結果を固定する
 */
export function showOptionFeedback(question) {
    const buttons = Array.from(
        dom.optionsContainer.querySelectorAll('button[data-answer-index]')
    );

    buttons.forEach((btn) => {
        const ansIdx = Number(btn.dataset.answerIndex);
        const optIdx = Number(btn.dataset.optionIndex);

        const answer = (question.answers || [])[ansIdx];
        if (!answer) return;

        const correctIndex = answer.correctIndex;
        const selectedIndex = answer.userSelectedIndex;

        btn.classList.remove('hover:bg-slate-100', 'dark:hover:bg-slate-800');

        if (optIdx === correctIndex) {
            btn.classList.add(
                'border-emerald-400',
                'dark:border-emerald-400',
                'bg-emerald-50',
                'dark:bg-emerald-900/40'
            );
        }

        if (
            selectedIndex != null &&
            optIdx === selectedIndex &&
            selectedIndex !== correctIndex
        ) {
            btn.classList.add(
                'border-red-400',
                'dark:border-red-400',
                'bg-red-50',
                'dark:bg-red-900/40'
            );
        }
    });
}

/**
 * 次のパーツ (answerIndex + 1) を「解放」し、そのパートへ表示を移動する。
 * - totalAnswerGroups <= 1 のときは何もしない。
 */
export function revealNextAnswerGroup(answerIndex) {
    if (totalAnswerGroups <= 1) return;

    const nextIndex = answerIndex + 1;
    if (nextIndex >= totalAnswerGroups) {
        return;
    }

    if (nextIndex > maxVisibleAnswerGroupIndex) {
        maxVisibleAnswerGroupIndex = nextIndex;
    }

    currentAnswerGroupIndex = nextIndex;
    updateAnswerGroupNavigation();
}

/**
 * 進捗表示（Q番号 / 合計 / スコア）
 */
export function renderProgress(currentIndex, total, score) {
    if (dom.currentQNum) {
        dom.currentQNum.textContent = String(currentIndex + 1);
    }
    if (dom.totalQNum) {
        dom.totalQNum.textContent = String(total);
    }
    if (dom.currentScore) {
        dom.currentScore.textContent = String(score);
    }
}

/**
 * Mistakes リストをリセットする
 */
export function resetReviewList() {
    if (dom.reviewList) {
        dom.reviewList.innerHTML = '';
        dom.reviewList.classList.add('hidden');
    }
    if (dom.reviewEmpty) {
        dom.reviewEmpty.classList.remove('hidden');
    }
    if (dom.mistakeCount) {
        dom.mistakeCount.classList.add('hidden');
    }
}

/**
 * Mistakes（誤答一覧）に 1 問追加する。
 *
 * ・問題文を「穴埋めつき」で描画
 * ・その直後に updateInlineBlank を使い、
 *   正答（青緑）＋誤答（赤）を埋め込む
 * ・“Your wrong answers” などの追加見出しは付けない
 */
export function addReviewItem(question, entitySet, questionNumber) {
    const entities = entitySet.entities || {};
    const entity = entities[question.entityId];
    if (!entity) return;

    dom.reviewEmpty.classList.add('hidden');
    dom.reviewList.classList.remove('hidden');

    const li = document.createElement('li');
    li.className = [
        'rounded-lg border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900',
        'px-3 py-2',
        'text-xs'
    ].join(' ');

    // --- 上段：Q番号・Incorrect バッジ・問題文 ---
    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-3 justify-between';

    const headerBox = document.createElement('div');
    headerBox.className = 'flex flex-col gap-1 min-w-[3.5rem]';

    const headerLine = document.createElement('div');
    headerLine.className = 'flex items-center gap-2';

    const qLabel = document.createElement('span');
    qLabel.className = 'font-semibold text-slate-800 dark:text-slate-100';
    qLabel.textContent = `Q${questionNumber}`;

    const badge = document.createElement('span');
    badge.className =
        'text-[0.7rem] px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 ' +
        'dark:text-red-300 border border-red-300/60 dark:border-red-500/50';
    badge.textContent = 'Incorrect';

    headerLine.appendChild(qLabel);
    headerLine.appendChild(badge);
    headerBox.appendChild(headerLine);

    // 穴埋め用のコンテナ
    const qText = document.createElement('div');
    qText.className = 'flex-1 text-slate-700 dark:text-slate-200';

    // まず穴埋めプレースホルダを描画
    renderQuestionText(question.patternTokens, entity, true, qText);

    // 各穴に「正答（青緑）＋誤答（赤）」を適用
    (question.answers || []).forEach((_, idx) => {
        updateInlineBlank(question, entitySet, idx, qText);
    });

    topRow.appendChild(headerBox);
    topRow.appendChild(qText);
    li.appendChild(topRow);

    dom.reviewList.appendChild(li);

    // ミス数を更新
    const count = dom.reviewList.children.length;
    dom.mistakeCount.textContent = String(count);
    dom.mistakeCount.classList.remove('hidden');
}

/**
 * Tips を初期化（高さは維持して中身だけ消す）
 */
export function resetTips() {
    if (!dom.tipContainer) return;
    dom.tipContainer.innerHTML = '';
}

/**
 * Tips を描画する。
 * - tip.when == always / correct / incorrect で出し分け
 * - resetTips() で毎回クリアしてから描画
 */
export function renderTips(tips, entity, isCorrect) {
    if (!dom.tipContainer) return;

    resetTips();

    if (!Array.isArray(tips) || tips.length === 0) {
        return;
    }

    const visibleTips = tips.filter((tip) =>
        isTipVisible(tip, isCorrect)
    );
    if (!visibleTips.length) {
        return;
    }

    const header = document.createElement('div');
    header.className = 'font-semibold text-slate-800 dark:text-slate-100';
    header.textContent = 'Tips';
    dom.tipContainer.appendChild(header);

    visibleTips.forEach((tip) => {
        const row = document.createElement('div');
        row.className = 'flex items-start gap-2';

        const bullet = document.createElement('span');
        bullet.className = 'mt-0.5 select-none';
        bullet.textContent = '•';

        const body = document.createElement('div');
        body.className = 'space-x-1 space-y-1 leading-relaxed';
        appendTokens(body, tip.tokens || [], entity);

        row.appendChild(bullet);
        row.appendChild(body);
        dom.tipContainer.appendChild(row);
    });

    // 高さは常に確保しているので hidden/表示切替は不要
}

/**
 * 全パーツ回答後に、各選択肢ボタンの中に
 * 「その選択肢のエンティティで pattern を全部レンダリングしたプレビュー」
 * を追記する。
 *
 * - KaTeX / ルビ表示は renderQuestionText と同じ経路を通るので自動対応。
 * - 正答ボタン: 緑ハイライト + 「正答」
 * - 選んだ誤答ボタン: 赤ハイライト + 「あなたの解答」
 * - その他の選択肢: 中立色 + 「この選択肢」
 */
export function appendPatternPreviewToOptions(question, entitySet) {
    if (!dom.optionsContainer) return;
    if (!question || !Array.isArray(question.answers)) return;
    if (!entitySet || !entitySet.entities) return;

    const tokens = question.patternTokens || [];
    if (!tokens.length) return;

    const entities = entitySet.entities || {};

    (question.answers || []).forEach((answer, answerIndex) => {
        if (!answer || !Array.isArray(answer.options)) return;

        const correctIndex = answer.correctIndex;
        const selectedIndex = answer.userSelectedIndex;

        const buttons = Array.from(
            dom.optionsContainer.querySelectorAll(
                `button[data-answer-index="${answerIndex}"]`
            )
        );

        buttons.forEach((btn) => {
            const optIdx = Number(btn.dataset.optionIndex);
            const opt = answer.options[optIdx];
            if (!opt) return;

            const entity = entities[opt.entityId];
            if (!entity) return;

            // 2回目以降呼ばれたときに重複追記しないためのフラグ
            if (btn.dataset.patternPreviewAttached === '1') return;
            btn.dataset.patternPreviewAttached = '1';

            const isCorrect = optIdx === correctIndex;
            const isSelected =
                selectedIndex != null && optIdx === selectedIndex;

            // 追記コンテナ（ボタンの中にぶら下げる）
            const container = document.createElement('div');
            container.className = 'mt-1 text-[0.7rem] leading-snug';

            const pill = document.createElement('div');
            pill.className =
                'rounded-md px-2 py-1 inline-flex flex-col sm:flex-row ' +
                'flex-wrap items-start gap-x-2 gap-y-1 border';

            if (isCorrect) {
                // 正答 → 緑
                pill.className +=
                    ' bg-emerald-900/40 border-emerald-500 text-emerald-50';
            } else if (isSelected) {
                // 選んだ誤答 → 赤
                pill.className +=
                    ' bg-red-900/40 border-red-500 text-red-50';
            } else {
                // その他の選択肢 → 中立色
                pill.className +=
                    ' bg-slate-800/60 border-slate-600 text-slate-100';
            }

            const label = document.createElement('div');
            label.className = 'font-semibold mr-1 text-[0.7rem]';

            if (isCorrect) {
                label.textContent = '正答';
            } else if (isSelected) {
                label.textContent = 'あなたの解答';
            } else {
                label.textContent = 'この選択肢';
            }
            pill.appendChild(label);

            // pattern 全体を、この entity でレンダリングする領域
            const patternWrapper = document.createElement('div');
            patternWrapper.className =
                'text-[0.7rem] leading-snug';

            // ★ここで問題文と同じロジックで pattern を全部描画
            // skipAnswerTokens = false にすることで、
            // hide / hideruby も「正しい本文」として全部出す
            renderQuestionText(tokens, entity, false, patternWrapper);

            pill.appendChild(patternWrapper);
            container.appendChild(pill);
            btn.appendChild(container);
        });
    });
}