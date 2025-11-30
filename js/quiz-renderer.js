// js/quiz-renderer.js
import { dom } from './dom-refs.js';
import { renderSmilesInline } from './chem-renderer.js';

let renderedQuestion = null;

function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');
    if (styles.includes('katex') && window.katex) {
        try {
            window.katex.render(text, span, {
                throwOnError: false,
                strict: false
            });
            return span;
        } catch (e) {
            span.textContent = text;
        }
    }
    span.textContent = text;
    if (styles.includes('bold')) span.classList.add('font-semibold');
    if (styles.includes('italic')) span.classList.add('italic');
    if (styles.includes('serif')) span.classList.add('font-serif');
    if (styles.includes('sans')) span.classList.add('font-sans');
    if (styles.includes('muted')) span.classList.add('text-slate-500', 'dark:text-slate-400');
    return span;
}

function resolveSubTokenValue(spec, row) {
    if (!spec) return '';
    const source = spec.source || 'text';
    if (source === 'key') {
        const field = spec.field;
        return field && row ? row[field] ?? '' : '';
    }
    if (source === 'text') {
        return spec.value ?? '';
    }
    return '';
}

function renderRubyToken(token, row) {
    const rubyEl = document.createElement('ruby');
    const baseText = token.base ? resolveSubTokenValue(token.base, row) : '';
    const rubyText = token.ruby ? resolveSubTokenValue(token.ruby, row) : '';
    const rbSpan = document.createElement('span');
    const baseStyles = (token.base && token.base.styles) || token.styles || [];
    rbSpan.appendChild(createStyledSpan(baseText, baseStyles));
    const rt = document.createElement('rt');
    rt.textContent = rubyText;
    rubyEl.appendChild(rbSpan);
    rubyEl.appendChild(rt);
    return rubyEl;
}

function renderHideValueIntoSpan(span, token, row) {
    if (Array.isArray(token.value)) {
        appendTokens(span, token.value, row, null);
        return;
    }
    if (token.value && typeof token.value === 'object') {
        appendTokens(span, [token.value], row, null);
        return;
    }
    const field = token.field;
    const value = field && row ? row[field] ?? '' : '';
    span.appendChild(createStyledSpan(value || '____', token.styles || []));
}

function appendTokens(parent, tokens, row, placeholders = null, promises = []) {
    let answerIndexCounter = 0;
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;
        if (token.type === 'text') {
            parent.appendChild(createStyledSpan(token.value ?? '', token.styles || []));
            return;
        }
        if (token.type === 'katex') {
            const text =
                token.value != null
                    ? token.value
                    : token.field && row
                        ? row[token.field] ?? ''
                        : '';
            parent.appendChild(createStyledSpan(String(text), ['katex', ...(token.styles || [])]));
            return;
        }
        if (token.type === 'smiles') {
            const smiles =
                token.value != null
                    ? token.value
                    : token.field && row
                        ? row[token.field] ?? ''
                        : '';
            const span = document.createElement('span');
            if (smiles != null) {
                span.dataset.smiles = String(smiles);
            }
            parent.appendChild(span);
            const renderOptions = {
                maxHeightEm: token.maxHeightEm,
                maxHeightPx: token.maxHeightPx,
                zoomPadding: token.zoomPadding
            };
            // Collect the promise
            promises.push(renderSmilesInline(span, String(smiles || ''), renderOptions));
            return;
        }
        if (token.type === 'key') {
            const field = token.field;
            const value = field && row ? row[field] ?? '' : '';

            // 1) 配列なら tokens とみなして再帰
            if (Array.isArray(value)) {
                appendTokens(parent, value, row, placeholders, promises);
                return;
            }

            // 2) 単一トークンオブジェクトなら 1 要素配列として再帰
            if (value && typeof value === 'object' && value.type) {
                appendTokens(parent, [value], row, placeholders, promises);
                return;
            }

            // 3) それ以外（文字列など）は従来通りテキストとして扱う
            parent.appendChild(
                createStyledSpan(
                    value != null ? String(value) : '',
                    token.styles || []
                )
            );
            return;
        }
        if (token.type === 'ruby' || token.type === 'hideruby') {
            parent.appendChild(renderRubyToken(token, row));
            return;
        }
        if (token.type === 'hide') {
            if (placeholders && token.answer) {
                const span = document.createElement('span');
                span.dataset.answerIndex = String(answerIndexCounter);
                span.className = 'inline-block min-w-[2.5rem] border-b border-slate-500 mx-1 pb-0.5';
                span.textContent = ' ';
                parent.appendChild(span);
            } else {
                const span = document.createElement('span');
                renderHideValueIntoSpan(span, token, row);
                parent.appendChild(span);
            }
            answerIndexCounter += 1;
            return;
        }
        if (token.type === 'br') {
            parent.appendChild(document.createElement('br'));
        }
    });
}

function createOptionButton(labelNodes, isDisabled, onClick, { fullHeight = true } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';

    // 高さも幅もセルいっぱいに広げる
    btn.className = [
        'w-full',
        fullHeight ? 'h-full' : '',   // ★ ここで制御
        // items-start → items-stretch にして中身をフル幅に
        'flex flex-col items-stretch justify-between',
        'px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100',
        'hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        'text-base leading-relaxed',
        'transition-colors'
    ].join(' ');

    if (isDisabled) {
        btn.disabled = true;
    } else {
        btn.addEventListener('click', onClick);
    }

    // ─────────────────────────────────
    // 上部: option-main（選択肢テキスト用）
    // ─────────────────────────────────
    const main = document.createElement('div');
    // option-main 自体は「上側の余白全部」を担当しつつセンター寄せ
    main.className = 'option-main flex-1 flex items-center justify-center';

    const labelWrapper = document.createElement('div');
    // ← w-full をやめ、inline-flex + max-w-full で
    //    中身の長さだけの箱にして、テキストだけ左揃え
    labelWrapper.className =
        'inline-flex max-w-full text-left flex-col justify-center';

    labelNodes.forEach((node) => labelWrapper.appendChild(node));
    main.appendChild(labelWrapper);
    btn.appendChild(main);

    // ─────────────────────────────────
    // 下部: option-preview（問題文用の予約領域）
    // ─────────────────────────────────
    const previewSlot = document.createElement('div');
    previewSlot.className =
        'option-preview mt-1 text-left text-[0.7rem] text-slate-500 dark:text-slate-400 leading-relaxed';

    // ここで高さ予約
    previewSlot.style.minHeight = '72px'; // 必要に応じて調整
    btn.appendChild(previewSlot);
    btn._previewSlot = previewSlot;

    return btn;
}


function renderOptionLabel(option, dataSets, question) {
    const sourceDataSetId = option.dataSetId || (question.meta && question.meta.dataSetId);
    const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;
    const row = option.entityId && ds
        ? ds.type === 'table' && Array.isArray(ds.data)
            ? ds.data.find((r) => r.id === option.entityId)
            : ds.type === 'factSentences' && Array.isArray(ds.sentences)
                ? ds.sentences.find((s) => s.id === option.entityId)
                : null
        : null;
    if (option.labelTokens) {
        const span = document.createElement('span');
        appendTokens(span, option.labelTokens, row);
        return [span];
    }
    if (option.label) {
        return [createStyledSpan(option.label)];
    }
    if (row) {
        const span = document.createElement('span');
        appendTokens(span, [{ type: 'key', field: 'nameEnCap' }], row);
        return [span];
    }
    return [createStyledSpan(String(option.label || option.displayKey || ''))];
}

function renderAnswerGroup(question, dataSets, answerIndex, onSelect) {
    const answer = question.answers[answerIndex];

    // 4択・穴埋め用のグループ（元のレイアウト）
    const group = document.createElement('div');
    // ★ 完全に元と同じ: hidden + h-full w-full
    group.className = 'hidden h-full w-full';
    group.dataset.answerIndex = String(answerIndex);

    // 左側に表示するタイトル（例:「側鎖 (R基) が〜であるアミノ酸として正しいものを1つ選べ」）
    if (answer.meta && answer.meta.leftText) {
        const title = document.createElement('div');
        // ★ ここも元のまま
        title.className =
            'text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2';
        title.textContent = answer.meta.leftText;
        group.appendChild(title);
    }

    // 2×2 グリッドで4択ボタンを並べる（元のレイアウト）
    const optionsWrapper = document.createElement('div');
    // ★ 完全に元と同じクラス
    optionsWrapper.className =
        'grid grid-cols-2 gap-4 auto-rows-fr h-full w-full';

    answer.options.forEach((opt, idx) => {
        const labelNodes = renderOptionLabel(opt, dataSets, question);

        // createOptionButton の第4引数は省略（デフォルト fullHeight=true）
        const btn = createOptionButton(
            labelNodes,
            answer.meta && answer.meta.disabled,
            () => {
                onSelect(answerIndex, idx);
            }
        );

        // data-* 属性も元と同じ
        btn.dataset.answerIndex = String(answerIndex);
        btn.dataset.optionIndex = String(idx);
        optionsWrapper.appendChild(btn);
    });

    group.appendChild(optionsWrapper);
    return group;
}

function renderTableMatchingQuestion(question, dataSets, onSelect) {
    const group = document.createElement('div');
    group.className =
        'flex flex-col sm:flex-row gap-4 sm:gap-6';

    const answers = question.answers || [];
    if (!answers.length || !answers[0].options || !answers[0].options.length) {
        console.warn('[quiz][table_matching] answers が空です');
        return group;
    }

    const optionCount = answers[0].options.length;

    // 右側の候補は全ての穴で同じ並びになっている前提
    const globalOptions = answers[0].options;

    const leftCol = document.createElement('div');
    leftCol.className = 'flex-1 flex flex-col gap-3';

    const rightCol = document.createElement('div');
    rightCol.className = 'flex-1 flex flex-col gap-3';

    group.appendChild(leftCol);
    group.appendChild(rightCol);

    // マッチング用の状態
    const matchingState = {
        leftButtons: [],
        rightButtons: [],
        firstSelection: null, // { side: 'left' | 'right', index: number }
        pairsByLeft: new Array(answers.length).fill(null),
        pairsByRight: new Array(optionCount).fill(null),
        updateStyles: null
    };

    // すでに userSelectedIndex が入っている場合はそこからペアを復元
    answers.forEach((answer, leftIndex) => {
        const selected =
            typeof answer.userSelectedIndex === 'number'
                ? answer.userSelectedIndex
                : null;
        if (
            selected == null ||
            selected < 0 ||
            selected >= optionCount
        ) {
            return;
        }

        // 同じ右側にすでに別の左が割り当てられていた場合は、後勝ちにしておく
        const oldLeft = matchingState.pairsByRight[selected];
        if (oldLeft != null) {
            matchingState.pairsByLeft[oldLeft] = null;
        }
        matchingState.pairsByLeft[leftIndex] = selected;
        matchingState.pairsByRight[selected] = leftIndex;
    });

    question._matchingState = matchingState;

    function updateStyles() {
        const first = matchingState.firstSelection;

        // いったん全ての強調クラスを外す
        matchingState.leftButtons.forEach((btn) => {
            if (!btn) return;
            btn.classList.remove(
                'ring-2',
                'ring-emerald-500',
                'border-emerald-300',
                'bg-slate-100',
                'dark:bg-slate-800'
            );
        });

        matchingState.rightButtons.forEach((btn) => {
            if (!btn) return;
            btn.classList.remove(
                'ring-2',
                'ring-emerald-500',
                'border-emerald-300',
                'bg-slate-100',
                'dark:bg-slate-800'
            );
        });

        // まず「確定しているペア」を両側ハイライト
        matchingState.pairsByLeft.forEach((rightIndex, leftIndex) => {
            if (rightIndex == null) return;

            const leftBtn = matchingState.leftButtons[leftIndex];
            const rightBtn = matchingState.rightButtons[rightIndex];
            if (!leftBtn || !rightBtn) return;

            leftBtn.classList.add(
                'border-emerald-300',
                'bg-slate-100',
                'dark:bg-slate-800'
            );
            rightBtn.classList.add(
                'border-emerald-300',
                'bg-slate-100',
                'dark:bg-slate-800'
            );
        });

        // その上で「今 1 個目として選択中」のボタンにリングを付ける
        if (first) {
            const list =
                first.side === 'left'
                    ? matchingState.leftButtons
                    : matchingState.rightButtons;
            const btn = list[first.index];
            if (btn) {
                btn.classList.add('ring-2', 'ring-emerald-500');
            }
        }
    }
    matchingState.updateStyles = updateStyles;

    function handleClick(side, index) {
        if (question.meta && question.meta.disabled) return;

        const first = matchingState.firstSelection;

        // 同じボタンをもう一度押した → 選択解除
        if (first && first.side === side && first.index === index) {
            matchingState.firstSelection = null;
            updateStyles();
            return;
        }

        // まだ 1 個目が選ばれていない → 1 個目として記録
        if (!first) {
            matchingState.firstSelection = { side, index };
            updateStyles();
            return;
        }

        // 1 個目と同じ側を押した → 1 個目を差し替え
        if (first.side === side) {
            matchingState.firstSelection = { side, index };
            updateStyles();
            return;
        }

        // ここに来ると「左右 1 個ずつ」が揃ったのでペア確定
        const leftIndex = first.side === 'left' ? first.index : index;
        const rightIndex = first.side === 'right' ? first.index : index;

        // 既存ペアがあれば解除してから新しいペアを張る
        const oldRight = matchingState.pairsByLeft[leftIndex];
        if (oldRight != null) {
            matchingState.pairsByRight[oldRight] = null;
        }
        const oldLeft = matchingState.pairsByRight[rightIndex];
        if (oldLeft != null) {
            matchingState.pairsByLeft[oldLeft] = null;
        }

        matchingState.pairsByLeft[leftIndex] = rightIndex;
        matchingState.pairsByRight[rightIndex] = leftIndex;

        matchingState.firstSelection = null;
        updateStyles();

        // 内部状態（userSelectedIndex）と採点ロジックを更新
        answers[leftIndex].userSelectedIndex = rightIndex;
        onSelect(leftIndex, rightIndex);
    }

    // 左列（アミノ酸名）
    answers.forEach((answer, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = [
            'w-full',
            'px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700',
            'bg-white dark:bg-slate-900',
            'text-sm text-left text-slate-800 dark:text-slate-100',
            'hover:border-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800',
            'transition-colors'
        ].join(' ');

        btn.textContent =
            answer.meta && answer.meta.leftText
                ? answer.meta.leftText
                : '';

        btn.addEventListener('click', () => handleClick('left', i));

        matchingState.leftButtons[i] = btn;
        leftCol.appendChild(btn);
    });

    // 右列（分類）
    globalOptions.forEach((opt, j) => {
        const labelNodes = renderOptionLabel(opt, dataSets, question);
        const btn = createOptionButton(
            labelNodes,
            question.meta && question.meta.disabled,
            () => handleClick('right', j),
            { fullHeight: false }
        );

        // マッチング専用 UI では data-* は使わない（従来ロジックと混線しないように）
        delete btn.dataset.answerIndex;
        delete btn.dataset.optionIndex;

        matchingState.rightButtons[j] = btn;
        rightCol.appendChild(btn);
    });

    // 初期状態（既存の userSelectedIndex も含めて）を反映
    updateStyles();
    return group;
}

function updateAnswerNavigation(question, targetIndex) {
    if (!question || !question._answerGroups) return;
    const maxIndex = question._answerGroups.length - 1;
    const nextIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    question.currentAnswerIndex = nextIndex;

    question._answerGroups.forEach((group, idx) => {
        if (idx === nextIndex) {
            group.classList.remove('hidden');
        } else {
            group.classList.add('hidden');
        }
    });

    if (question._answerNav) {
        const { prevBtn, nextBtn, statusEl } = question._answerNav;
        if (statusEl) {
            statusEl.textContent = `${nextIndex + 1} / ${question._answerGroups.length}`;
        }
        if (prevBtn) {
            prevBtn.disabled = nextIndex === 0;
        }
        if (nextBtn) {
            nextBtn.disabled = nextIndex === maxIndex;
        }
    }
}

function createAnswerNavigation(question) {
    const nav = document.createElement('div');
    nav.className = 'flex items-center justify-between gap-3';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50';
    prev.textContent = '<';

    const status = document.createElement('div');
    status.className = 'text-xs text-slate-500 dark:text-slate-400';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50';
    next.textContent = '>';

    nav.appendChild(prev);
    nav.appendChild(status);
    nav.appendChild(next);

    prev.addEventListener('click', () => {
        updateAnswerNavigation(question, question.currentAnswerIndex - 1);
    });
    next.addEventListener('click', () => {
        updateAnswerNavigation(question, question.currentAnswerIndex + 1);
    });

    question._answerNav = { prevBtn: prev, nextBtn: next, statusEl: status };
    return nav;
}

export function renderQuestion(question, dataSets, onSelect) {
    renderedQuestion = question;
    dom.questionText.innerHTML = '';
    dom.optionsContainer.innerHTML = '';

    const contextRow = resolveQuestionContext(question, dataSets);

    // table_matching 専用のヘッダー
    if (question.format === 'table_matching') {
        const header = document.createElement('div');
        header.className = 'text-sm text-slate-500 dark:text-slate-400 mb-2';
        header.textContent =
            'Match the items on the left with the correct options on the right.';
        dom.questionText.appendChild(header);
    }

    const promises = [];
    appendTokens(dom.questionText, question.tokens, contextRow, true, promises);

    // ───────────────────────────────────────
    // ① マッチング形式は専用 UI で 4+4 ボタンを描画
    // ───────────────────────────────────────
    if (question.format === 'table_matching') {
        const group = renderTableMatchingQuestion(question, dataSets, onSelect);
        question._answerGroups = [group];
        question.useNavigation = false;

        group.classList.remove('hidden');
        dom.optionsContainer.appendChild(group);

        // 高さ予約は従来どおり (Wait for SMILES)
        Promise.all(promises).then(() => {
            reserveQuestionTextHeight(question, dataSets);
        });
        return;
    }

    // ───────────────────────────────────────
    // ② それ以外（4択・穴埋め）は従来どおり
    // ───────────────────────────────────────
    const answerGroups = question.answers.map((_, idx) =>
        renderAnswerGroup(question, dataSets, idx, onSelect)
    );
    question._answerGroups = answerGroups;

    const useNavigation =
        question.format === 'sentence_fill_choice' && answerGroups.length > 1;
    question.useNavigation = useNavigation;

    if (useNavigation) {
        const nav = createAnswerNavigation(question);
        dom.questionText.appendChild(nav);
    } else {
        answerGroups.forEach((g) => g.classList.remove('hidden'));
    }

    answerGroups.forEach((g) => dom.optionsContainer.appendChild(g));

    if (useNavigation) {
        updateAnswerNavigation(question, question.currentAnswerIndex || 0);
    }

    Promise.all(promises).then(() => {
        reserveQuestionTextHeight(question, dataSets);
    });
}

function resolveQuestionContext(question, dataSets) {
    if (!question.meta || !question.meta.dataSetId) return null;
    const ds = dataSets[question.meta.dataSetId];
    if (!ds) return null;
    if (ds.type === 'table' && Array.isArray(ds.data)) {
        return ds.data.find((row) => row.id === question.meta.entityId) || null;
    }
    if (ds.type === 'factSentences' && Array.isArray(ds.sentences)) {
        return ds.sentences.find((s) => s.id === question.meta.sentenceId) || null;
    }
    return null;
}

// 1問ごとに「最悪ケースの高さ」を min-height として予約する
function reserveQuestionTextHeight(question, dataSets) {
    // 「穴埋めトークン (hide / hideruby) を含むか」で判定する
    const hasInlineBlank =
        Array.isArray(question.tokens) &&
        question.tokens.some(
            (t) => t && (t.type === 'hide' || t.type === 'hideruby')
        );

    // 穴埋めが無い問題は今まで通り可変でOK
    if (!hasInlineBlank) {
        dom.questionText.style.minHeight = '';
        return;
    }

    // 以前の min-height をリセット
    dom.questionText.style.minHeight = '';

    // 以下 rAF 〜 クローン作成 …（今のコードをそのまま続ける）
    requestAnimationFrame(() => {
        const baseWidth = dom.questionText.offsetWidth;
        if (!baseWidth) return;

        const clone = dom.questionText.cloneNode(true);
        clone.style.position = 'absolute';
        clone.style.visibility = 'hidden';
        clone.style.pointerEvents = 'none';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.width = baseWidth + 'px';

        dom.questionText.parentElement.appendChild(clone);

        const backupSelected = (question.answers || []).map(
            (ans) => ans && ans.userSelectedIndex
        );

        (question.answers || []).forEach((answer, answerIndex) => {
            if (!answer) return;

            const opts = answer.options || [];

            let wrongIndex = null;
            if (typeof answer.correctIndex === 'number' && opts.length > 0) {
                const idx = opts.findIndex((_, i) => i !== answer.correctIndex);
                wrongIndex = idx >= 0 ? idx : answer.correctIndex;
            }

            answer.userSelectedIndex = wrongIndex;

            // クローン内 rootElement=clone に対して穴埋め更新
            updateInlineBlank(question, dataSets, answerIndex, clone);
        });

        const worstHeight = clone.offsetHeight;

        (question.answers || []).forEach((answer, i) => {
            if (!answer) return;
            answer.userSelectedIndex = backupSelected[i];
        });

        clone.remove();

        if (worstHeight > 0) {
            dom.questionText.style.minHeight = `${worstHeight}px`;
        }
    });
}

export function updateInlineBlank(
    question,
    dataSets,
    answerIndex,
    rootElement = dom.questionText
) {
    const answers = question.answers || [];
    const answer = answers[answerIndex];
    if (!answer) return;

    const placeholders = rootElement.querySelectorAll(
        `[data-answer-index="${answerIndex}"]`
    );
    if (!placeholders.length) return;

    const options = answer.options || [];
    const selectedIndex = answer.userSelectedIndex;
    const selectedOpt =
        selectedIndex != null ? options[selectedIndex] : null;
    const correctOpt =
        typeof answer.correctIndex === 'number'
            ? options[answer.correctIndex]
            : null;

    const isCorrect =
        selectedIndex != null &&
        typeof answer.correctIndex === 'number' &&
        selectedIndex === answer.correctIndex;

    const isReviewContext = rootElement !== dom.questionText;

    function resolveRowForOption(opt) {
        if (!opt) return null;
        const sourceDataSetId =
            opt.dataSetId || (question.meta && question.meta.dataSetId);
        const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;
        if (!ds) return null;

        if (ds.type === 'table' && Array.isArray(ds.data)) {
            return opt.entityId
                ? ds.data.find((r) => r.id === opt.entityId) || null
                : null;
        }
        if (
            ds.type === 'factSentences' &&
            Array.isArray(ds.sentences)
        ) {
            return opt.entityId
                ? ds.sentences.find((s) => s.id === opt.entityId) || null
                : null;
        }
        return null;
    }

    function buildLabelNode(opt) {
        const span = document.createElement('span');
        if (!opt) return span;

        const row = resolveRowForOption(opt);

        if (opt.labelTokens && opt.labelTokens.length) {
            appendTokens(span, opt.labelTokens, row, null);
        } else if (opt.label) {
            span.appendChild(createStyledSpan(String(opt.label), []));
        } else if (opt.displayKey) {
            span.appendChild(createStyledSpan(String(opt.displayKey), []));
        } else if (row) {
            const text =
                row.nameEnCap || row.nameEn || row.text || '';
            span.appendChild(createStyledSpan(String(text), []));
        }

        return span;
    }

    placeholders.forEach((placeholder) => {
        // プレースホルダを「縦積み構造」にリセット
        placeholder.innerHTML = '';
        placeholder.className =
            'inline-flex flex-col items-start mx-1 align-baseline leading-tight';

        // 上段: 正答（下線つき）
        const correctLine = document.createElement('span');
        correctLine.className =
            'block px-2 border-b border-slate-500 min-w-[2.5rem] whitespace-nowrap pb-0.5';

        if (isReviewContext) {
            // Mistakes では正答を少し強調（青緑）
            correctLine.classList.add(
                'text-emerald-300',
                'dark:text-emerald-200'
            );
        }

        correctLine.appendChild(buildLabelNode(correctOpt));
        placeholder.appendChild(correctLine);

        // 間違えている場合のみ下段に「× ユーザの解答」を表示
        if (!isCorrect && selectedOpt) {
            const wrongLine = document.createElement('span');
            wrongLine.className =
                'mt-0.5 text-[0.7rem] text-rose-400 dark:text-rose-300 ' +
                'flex items-center gap-1 whitespace-nowrap';

            const mark = document.createElement('span');
            mark.textContent = '×';
            wrongLine.appendChild(mark);

            const wrongLabel = buildLabelNode(selectedOpt);
            wrongLabel.style.fontSize = '0.85em';
            wrongLine.appendChild(wrongLabel);

            placeholder.appendChild(wrongLine);
        }
    });
}

function buildSentencePreview(question, dataSets, answerIndex, optionIndex) {
    if (question.format !== 'sentence_fill_choice') return null;

    const container = document.createElement('span');

    // 現在の選択状態をバックアップ
    const backup = (question.answers || []).map((ans) =>
        ans ? ans.userSelectedIndex : null
    );

    // 「この穴だけ optionIndex を選んだ」状態を仮に作る
    (question.answers || []).forEach((ans, i) => {
        if (!ans) return;
        if (i === answerIndex) {
            ans.userSelectedIndex = optionIndex;
        }
        // 他の穴は backup のまま → 未回答は null → ___ のまま
    });

    // プレビュー用の文章ノードを生成
    const contextRow = resolveQuestionContext(question, dataSets);
    appendTokens(container, question.tokens, contextRow, true);

    // 全ての穴を更新（未回答は ___）
    (question.answers || []).forEach((_, i) => {
        updateInlineBlank(question, dataSets, i, container);
    });

    // 状態を元に戻す
    (question.answers || []).forEach((ans, i) => {
        if (ans) ans.userSelectedIndex = backup[i];
    });

    return container;
}

export function renderProgress(currentIndex, total, score) {
    dom.currentQNum.textContent = `${currentIndex + 1}`;
    dom.totalQNum.textContent = `${total}`;
    dom.currentScore.textContent = `${score}`;
}

export function showOptionFeedback(question) {
    // ───────────────────────────────────────
    // table_matching（1:1 マッチング）用のフィードバック
    // ───────────────────────────────────────
    if (
        question &&
        question.format === 'table_matching' &&
        question._matchingState &&
        Array.isArray(question._matchingState.leftButtons)
    ) {
        const state = question._matchingState;

        // 左側ボタンの正誤表示
        (question.answers || []).forEach((answer, answerIndex) => {
            const btn = state.leftButtons[answerIndex];
            if (!btn) return;

            btn.classList.remove('border-slate-300', 'dark:border-slate-700');

            const selected = answer.userSelectedIndex;
            const correct = answer.correctIndex;

            if (selected == null || selected < 0) {
                // 未回答はそのまま
                return;
            }

            if (selected === correct) {
                btn.classList.add(
                    'border-emerald-400',
                    'bg-emerald-50',
                    'dark:bg-emerald-900/30'
                );
            } else {
                btn.classList.add(
                    'border-rose-400',
                    'bg-rose-50',
                    'dark:bg-rose-900/30'
                );
            }
        });

        // 右側ボタンも、実際に選ばれたペアに応じて色分け
        if (
            Array.isArray(state.rightButtons) &&
            Array.isArray(state.pairsByRight)
        ) {
            state.rightButtons.forEach((btn, rightIndex) => {
                if (!btn) return;

                const leftIndex = state.pairsByRight[rightIndex];
                if (leftIndex == null) return;

                const answer =
                    question.answers && question.answers[leftIndex];
                if (!answer) return;

                const isCorrect = answer.correctIndex === rightIndex;

                btn.classList.remove(
                    'border-slate-300',
                    'dark:border-slate-700'
                );

                if (isCorrect) {
                    btn.classList.add(
                        'border-emerald-400',
                        'bg-emerald-50',
                        'dark:bg-emerald-900/30'
                    );
                } else {
                    btn.classList.add(
                        'border-rose-400',
                        'bg-rose-50',
                        'dark:bg-rose-900/30'
                    );
                }
            });
        }

        return;
    }

    // ───────────────────────────────────────
    // 従来フォーマット（4択など）
    // ───────────────────────────────────────

    // Pre-calculate satisfied unordered groups
    const satisfiedGroups = new Set();
    const unorderedIndices = new Set();

    if (question.format === 'sentence_fill_choice' && question.meta && Array.isArray(question.meta.unorderedAnswerGroups)) {
        question.meta.unorderedAnswerGroups.forEach(group => {
            if (!Array.isArray(group)) return;
            group.forEach(idx => unorderedIndices.add(idx));

            // Check if this group is satisfied
            // (Logic duplicated from answer-state.js roughly, or we assume if fullyCorrect is true then all are true? 
            // No, partial correctness isn't supported but we want to show which groups are right/wrong if the user got some wrong)

            const expectedLabels = [];
            const selectedLabels = [];

            let groupComplete = true;
            for (const idx of group) {
                const ans = question.answers[idx];
                if (!ans || ans.userSelectedIndex == null) {
                    groupComplete = false;
                    break;
                }
                const correctOpt = ans.options[ans.correctIndex];
                const selectedOpt = ans.options[ans.userSelectedIndex];
                if (correctOpt) expectedLabels.push(correctOpt.label);
                if (selectedOpt) selectedLabels.push(selectedOpt.label);
            }

            if (groupComplete) {
                expectedLabels.sort();
                selectedLabels.sort();
                let match = true;
                if (expectedLabels.length !== selectedLabels.length) match = false;
                else {
                    for (let i = 0; i < expectedLabels.length; i++) {
                        if (expectedLabels[i] !== selectedLabels[i]) {
                            match = false;
                            break;
                        }
                    }
                }
                if (match) {
                    satisfiedGroups.add(group);
                }
            }
        });
    }

    question.answers.forEach((answer, answerIndex) => {
        // Determine if this answer is part of a satisfied unordered group
        let isInSatisfiedGroup = false;
        let isUnordered = unorderedIndices.has(answerIndex);

        if (isUnordered) {
            // Find which group it belongs to and check if satisfied
            if (question.meta && question.meta.unorderedAnswerGroups) {
                for (const group of question.meta.unorderedAnswerGroups) {
                    if (group.includes(answerIndex) && satisfiedGroups.has(group)) {
                        isInSatisfiedGroup = true;
                        break;
                    }
                }
            }
        }

        answer.options.forEach((opt, optIndex) => {
            const btn = dom.optionsContainer.querySelector(
                `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
            );
            if (!btn) return;

            btn.classList.remove(
                'border-slate-300',
                'dark:border-slate-700',
                'border-sky-400',
                'bg-sky-50',
                'dark:bg-sky-900/30'
            );

            if (isUnordered) {
                if (isInSatisfiedGroup) {
                    // Group is correct -> Selected answers are Green
                    if (answer.userSelectedIndex === optIndex) {
                        btn.classList.add(
                            'border-emerald-400',
                            'bg-emerald-50',
                            'dark:bg-emerald-900/30'
                        );
                    }
                } else {
                    // Group is incorrect
                    if (answer.userSelectedIndex === optIndex) {
                        // User selection is Wrong (Red)
                        btn.classList.add(
                            'border-rose-400',
                            'bg-rose-50',
                            'dark:bg-rose-900/30'
                        );
                    } else if (optIndex === answer.correctIndex) {
                        // Show default correct answer as Green (Hint)
                        // Note: In unordered case, "correctIndex" might not be the *only* correct choice for this slot,
                        // but it's the canonical one. Showing it is a safe fallback hint.
                        btn.classList.add(
                            'border-emerald-400',
                            'bg-emerald-50',
                            'dark:bg-emerald-900/30'
                        );
                    }
                }
            } else {
                // Standard Ordered Logic
                if (optIndex === answer.correctIndex) {
                    btn.classList.add(
                        'border-emerald-400',
                        'bg-emerald-50',
                        'dark:bg-emerald-900/30'
                    );
                } else if (answer.userSelectedIndex === optIndex) {
                    btn.classList.add(
                        'border-rose-400',
                        'bg-rose-50',
                        'dark:bg-rose-900/30'
                    );
                }
            }
        });
    });
}

export function showOptionFeedbackForAnswer(question, answerIndex) {
    if (!question || !Array.isArray(question.answers)) return;

    // sentence_fill_choice 以外は従来どおり「問題全体」を採点
    if (question.format !== 'sentence_fill_choice') {
        showOptionFeedback(question);
        return;
    }

    const answer = question.answers[answerIndex];
    if (!answer || !Array.isArray(answer.options)) return;

    // Check if this answer is part of an unordered group
    let isUnordered = false;
    if (question.meta && Array.isArray(question.meta.unorderedAnswerGroups)) {
        for (const group of question.meta.unorderedAnswerGroups) {
            if (group.includes(answerIndex)) {
                isUnordered = true;
                break;
            }
        }
    }

    answer.options.forEach((opt, optIndex) => {
        const btn = dom.optionsContainer.querySelector(
            `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
        );
        if (!btn) return;

        // Reset styles
        btn.classList.remove(
            'border-emerald-400',
            'bg-emerald-50',
            'dark:bg-emerald-900/30',
            'border-rose-400',
            'bg-rose-50',
            'dark:bg-rose-900/30',
            'border-sky-400',
            'bg-sky-50',
            'dark:bg-sky-900/30'
        );
        btn.classList.add('border-slate-300', 'dark:border-slate-700');

        // Apply feedback
        if (answer.userSelectedIndex === optIndex) {
            btn.classList.remove('border-slate-300', 'dark:border-slate-700');

            if (isUnordered) {
                // For unordered groups, show neutral "selected" state until full submission
                btn.classList.add(
                    'border-sky-400',
                    'bg-sky-50',
                    'dark:bg-sky-900/30'
                );
            } else {
                // For ordered/standard answers, show immediate Red/Green
                if (optIndex === answer.correctIndex) {
                    btn.classList.add(
                        'border-emerald-400',
                        'bg-emerald-50',
                        'dark:bg-emerald-900/30'
                    );
                } else {
                    btn.classList.add(
                        'border-rose-400',
                        'bg-rose-50',
                        'dark:bg-rose-900/30'
                    );
                }
            }
        } else if (!isUnordered && optIndex === answer.correctIndex && answer.userSelectedIndex != null) {
            // Optional: Show correct answer if user picked wrong one (immediate correction)
            // The previous code didn't explicitly do this for unselected correct answers in local feedback,
            // but usually we might want to? The previous code ONLY colored the selected one (Red/Green) 
            // and the correct one (Green) if we want to show the right answer immediately.
            // The previous implementation:
            // if (optIndex === answer.correctIndex) { add Green }
            // else if (answer.userSelectedIndex === optIndex) { add Red }
            // This implies that if I picked Wrong, the Right one ALSO turns Green immediately.
            // So I should preserve that behavior for ordered questions.

            btn.classList.remove('border-slate-300', 'dark:border-slate-700');
            btn.classList.add(
                'border-emerald-400',
                'bg-emerald-50',
                'dark:bg-emerald-900/30'
            );
        }
    });
}

export function revealNextAnswerGroup() {
    if (!renderedQuestion || !renderedQuestion.answers || !renderedQuestion.useNavigation) return;
    const current = renderedQuestion.currentAnswerIndex || 0;
    const nextUnanswered = renderedQuestion.answers.findIndex((ans, idx) => idx > current && ans && ans.userSelectedIndex == null);
    if (nextUnanswered >= 0) {
        updateAnswerNavigation(renderedQuestion, nextUnanswered);
        return;
    }
    const firstUnanswered = renderedQuestion.answers.findIndex((ans) => ans && ans.userSelectedIndex == null);
    if (firstUnanswered >= 0) {
        updateAnswerNavigation(renderedQuestion, firstUnanswered);
    }
}

export function appendPatternPreviewToOptions(question, dataSets) {
    if (!question || !Array.isArray(question.answers)) return;

    if (question.format === 'table_matching') {
        return;
    }

    question.answers.forEach((answer, answerIndex) => {
        (answer.options || []).forEach((opt, optIndex) => {
            const btn = dom.optionsContainer.querySelector(
                `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
            );
            if (!btn) return;

            const preview = btn.querySelector('.option-preview');
            if (!preview) return;
            if (preview.dataset.filled === '1') return;

            // sentence_fill_choice は従来通り
            if (question.format === 'sentence_fill_choice') {
                const node = buildSentencePreview(
                    question,
                    dataSets,
                    answerIndex,
                    optIndex
                );
                if (node) {
                    preview.innerHTML = '';
                    preview.appendChild(node);
                    preview.dataset.filled = '1';
                }
                return;
            }

            // ------- ここから: 行データを特定 -------
            let rowContext = null;
            const sourceDataSetId =
                opt.dataSetId || (question.meta && question.meta.dataSetId);
            const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;

            if (opt.entityId && ds) {
                if (ds.type === 'table' && Array.isArray(ds.data)) {
                    rowContext =
                        ds.data.find((r) => r.id === opt.entityId) || null;
                } else if (
                    ds.type === 'factSentences' &&
                    Array.isArray(ds.sentences)
                ) {
                    rowContext =
                        ds.sentences.find((s) => s.id === opt.entityId) || null;
                }
            }

            if (!rowContext) {
                rowContext = resolveQuestionContext(question, dataSets);
            }
            if (!rowContext || !Array.isArray(question.tokens)) {
                return;
            }

            // ------- 1) まずプレースホルダ付きで問題文を描画 -------
            preview.innerHTML = '';
            appendTokens(preview, question.tokens, rowContext, true);

            // ------- 2) この answerIndex に対応する span の中身を埋める -------
            // data-answer-index="0" などを持つ span を拾う
            const placeholder = preview.querySelector(
                `[data-answer-index="${answerIndex}"]`
            );
            if (placeholder) {
                // 対応する hide トークンを探す
                let targetToken = null;
                let counter = 0;
                (question.tokens || []).forEach((t) => {
                    if (t && t.type === 'hide' && t.answer) {
                        if (counter === answerIndex) {
                            targetToken = t;
                        }
                        counter += 1;
                    }
                });

                if (targetToken) {
                    // 一度空にしてから、この span の「中に」値を描画
                    placeholder.textContent = '';
                    renderHideValueIntoSpan(placeholder, targetToken, rowContext);
                    // class はそのままなので、下線付きの枠の中に値が入る
                }
            }

            preview.dataset.filled = '1';
        });
    });
}

export function resetReviewList() {
    if (dom.reviewList) {
        dom.reviewList.innerHTML = '';
        dom.reviewList.classList.add('hidden');
    }
    if (dom.reviewEmpty) {
        dom.reviewEmpty.classList.remove('hidden');
    }
    if (dom.mistakeCount) {
        dom.mistakeCount.textContent = '0';
        dom.mistakeCount.classList.add('hidden');
    }
}

export function addReviewItem(question, dataSets, questionNumber) {
    if (!dom.reviewList) return;

    // 空状態メッセージを隠し、リストを表示
    if (dom.reviewEmpty) {
        dom.reviewEmpty.classList.add('hidden');
    }
    dom.reviewList.classList.remove('hidden');

    // カウントバッジを表示
    if (dom.mistakeCount) {
        const current = Number(dom.mistakeCount.textContent || '0') + 1;
        dom.mistakeCount.textContent = String(current);
        dom.mistakeCount.classList.remove('hidden');
    }

    const li = document.createElement('li');
    li.className = [
        'rounded-lg border border-slate-300 dark:border-slate-700',
        'bg-white dark:bg-slate-900',
        'px-3 py-2',
        'text-xs'
    ].join(' ');

    const topRow = document.createElement('div');
    topRow.className = 'flex items-start gap-3 justify-between';

    // 左側: Q番号 + Incorrectバッジ
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

    // 右側: 問題文（穴埋め付き）
    const qText = document.createElement('div');
    qText.className = 'flex-1 text-slate-700 dark:text-slate-200 quiz-text-block';

    const row = resolveQuestionContext(question, dataSets);

    // まずはプレースホルダ付きで本文を描画（question-view と同じロジック）
    appendTokens(qText, question.tokens || [], row, true);

    // 各パーツごとに正答 / 誤答を埋め込む
    (question.answers || []).forEach((_, idx) => {
        updateInlineBlank(question, dataSets, idx, qText);
    });

    topRow.appendChild(headerBox);
    topRow.appendChild(qText);
    li.appendChild(topRow);

    dom.reviewList.appendChild(li);
}

export function renderTips(tips, row, isCorrect) {
    dom.tipContainer.innerHTML = '';
    (tips || []).forEach((tip) => {
        const when = tip.when || 'after_answer';
        const visible =
            when === 'after_answer' ||
            when === 'always' ||
            (when === 'correct' && isCorrect) ||
            (when === 'after_correct' && isCorrect) ||
            (when === 'incorrect' && !isCorrect) ||
            (when === 'after_incorrect' && !isCorrect);
        if (!visible) return;
        const block = document.createElement('div');
        block.className = 'p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm mb-2';
        appendTokens(block, tip.tokens, row);
        dom.tipContainer.appendChild(block);
    });
}

export function resetTips() {
    dom.tipContainer.innerHTML = '';
}

function tokensToPlainText(tokens, row) {
    let text = '';
    (tokens || []).forEach((token) => {
        if (!token || !token.type) return;
        if (token.type === 'text') {
            text += token.value ?? '';
            return;
        }
        if (token.type === 'katex') {
            const value = token.value != null ? token.value : token.field && row ? row[token.field] ?? '' : '';
            text += String(value ?? '');
            return;
        }
        if (token.type === 'smiles') {
            const value = token.value != null ? token.value : token.field && row ? row[token.field] ?? '' : '';
            text += String(value ?? '');
            return;
        }
        if (token.type === 'key') {
            const value = token.field && row ? row[token.field] ?? '' : '';

            if (Array.isArray(value)) {
                // 配列なら tokens とみなして再帰的にテキスト連結
                text += tokensToPlainText(value, row);
                return;
            }
            if (value && typeof value === 'object' && value.type) {
                // 単一トークンオブジェクト
                text += tokensToPlainText([value], row);
                return;
            }

            text += String(value ?? '');
            return;
        }
        if (token.type === 'ruby' || token.type === 'hideruby') {
            text += resolveSubTokenValue(token.base, row);
            return;
        }
        if (token.type === 'hide') {
            if (token.value) {
                if (Array.isArray(token.value)) {
                    text += tokensToPlainText(token.value, row);
                } else if (token.value && typeof token.value === 'object') {
                    text += tokensToPlainText([token.value], row);
                }
            } else if (token.field && row) {
                text += row[token.field] ?? '';
            }
            return;
        }
    });
    return text.trim();
}

function optionToText(option, dataSets, question) {
    if (!option) return '';
    if (option.label) return String(option.label);
    const sourceDataSetId = option.dataSetId || (question.meta && question.meta.dataSetId);
    const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;
    const row = option.entityId && ds
        ? ds.type === 'table' && Array.isArray(ds.data)
            ? ds.data.find((r) => r.id === option.entityId)
            : ds.type === 'factSentences' && Array.isArray(ds.sentences)
                ? ds.sentences.find((s) => s.id === option.entityId)
                : null
        : null;
    if (option.labelTokens) {
        return tokensToPlainText(option.labelTokens, row);
    }
    if (option.displayKey) {
        return String(option.displayKey);
    }
    if (row && row.nameEnCap) {
        return String(row.nameEnCap);
    }
    return '';
}

export function summarizeQuestion(question, dataSets) {
    const contextRow = resolveQuestionContext(question, dataSets);
    return tokensToPlainText(question.tokens || [], contextRow);
}

export function summarizeAnswers(question, dataSets) {
    if (!question || !Array.isArray(question.answers)) return '';
    const parts = question.answers.map((answer, idx) => {
        const selected = answer && answer.options ? answer.options[answer.userSelectedIndex] : null;
        const label = optionToText(selected, dataSets, question);
        return `(${idx + 1}) ${label || '-'}`;
    });
    return parts.join(' / ');
}

export function resetResultList() {
    if (dom.resultList) {
        dom.resultList.innerHTML = '';
    }
}

export function addResultItem(historyItem, dataSets) {
    if (!dom.resultList || !historyItem || !historyItem.question) return;

    const question = historyItem.question;
    const item = document.createElement('li');
    item.className = historyItem.correct
        ? 'p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
        : 'p-2 rounded-lg border border-rose-200 dark:border-rose-700 bg-rose-50/70 dark:bg-rose-900/40';

    const header = document.createElement('div');
    header.className =
        'flex items-center justify-between text-xs text-slate-500 dark:text-slate-400';

    const orderSpan = document.createElement('span');
    orderSpan.textContent = `Q${historyItem.index}`;
    header.appendChild(orderSpan);

    // 正解 / 不正解バッジ
    const badge = document.createElement('span');
    badge.className = historyItem.correct
        ? 'px-2 py-0.5 rounded-full text-[0.7rem] bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border border-emerald-300/70 dark:border-emerald-500/60'
        : 'px-2 py-0.5 rounded-full text-[0.7rem] bg-rose-500/10 text-rose-600 dark:text-rose-300 border border-rose-300/70 dark:border-rose-500/60';
    badge.textContent = historyItem.correct ? 'Correct' : 'Incorrect';
    header.appendChild(badge);

    // 問題文：tokens をそのまま描画（ルビ・KaTeX 対応）
    const text = document.createElement('div');
    text.className = 'text-sm text-slate-800 dark:text-slate-100 mt-1 leading-relaxed quiz-text-block';

    const rowContext = resolveQuestionContext(question, dataSets);
    appendTokens(text, question.tokens || [], rowContext, false);
    // ↑ hide トークンは値を出す

    // ユーザ回答サマリ（文字列のまま）
    const answer = document.createElement('div');
    answer.className = 'text-xs text-slate-500 dark:text-slate-400 mt-1';
    answer.textContent = historyItem.userAnswerSummary;

    item.appendChild(header);
    item.appendChild(text);
    item.appendChild(answer);
    dom.resultList.appendChild(item);
}
