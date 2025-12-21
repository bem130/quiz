import { dom } from './dom-refs.js';
import { renderSmilesInline } from './chem-renderer.js';
import { parseContentToSegments } from './ruby-parser.js';
import { attachSourceInfo } from './text-source-registry.js';
import {
    optionToText,
    resolveQuestionContext,
    resolveSubTokenValue,
    summarizeQuestion,
    tokensToPlainText
} from './text-utils.js';

let renderedQuestion = null;

const CHOICE_STATE_CLASSES = [
    'choice-default',
    'choice-selected',
    'choice-correct',
    'choice-incorrect',
    'choice-disabled'
];

const CHOICE_FEEDBACK_CLASSES = [];

const CHOICE_BASE_BORDER_CLASSES = [];

const CHOICE_STATE_MAP = {
    correct: [
        'choice-correct'
    ],
    incorrect: [
        'choice-incorrect'
    ],
    selected: [
        'choice-selected'
    ],
    disabled: ['choice-disabled']
};

// Cooldown for option button clicks (milliseconds)
const OPTION_CLICK_COOLDOWN_MS = 100;

function resetChoiceButtonState(btn) {
    if (!btn) return;
    btn.classList.remove(
        ...CHOICE_STATE_CLASSES,
        ...CHOICE_FEEDBACK_CLASSES,
        ...CHOICE_BASE_BORDER_CLASSES
    );
    btn.classList.add('choice-default', ...CHOICE_BASE_BORDER_CLASSES);

    if (btn.disabled) {
        addChoiceStateClasses(btn, 'disabled');
    }
}

function addChoiceStateClasses(btn, state) {
    if (!btn) return;
    const extraClasses = CHOICE_STATE_MAP[state];
    if (extraClasses && extraClasses.length) {
        btn.classList.add(...extraClasses);
    }
}

function setChoiceState(btn, state) {
    resetChoiceButtonState(btn);
    addChoiceStateClasses(btn, state);
}

function applyStyles(element, styles = []) {
    if (!styles || !styles.length) return;
    if (styles.includes('bold')) element.classList.add('font-semibold');
    if (styles.includes('italic')) element.classList.add('italic');
    if (styles.includes('serif')) element.classList.add('font-serif');
    if (styles.includes('sans')) element.classList.add('font-sans');
    if (styles.includes('muted')) element.classList.add('app-text-muted');
}

function createStyledSpan(text, styles = []) {
    const span = document.createElement('span');
    if (styles.includes('katex') && window.katex) {
        try {
            // Check for common malformed patterns that cause msub errors
            // e.g. "A_" with nothing after it, or "_{}" empty subscript
            if (text.includes('_{}') || /_\s*$/.test(text)) {
                // Attempt to clean up or just fallback
                console.warn('[katex] Potential invalid subscript in:', text);
            }

            const isBlock = styles.includes('katex-block');
            const finalTex = (!isBlock && !text.includes('\\displaystyle'))
                ? '\\displaystyle ' + text
                : text;

            window.katex.render(finalTex, span, {
                throwOnError: false,
                strict: false,
                errorColor: '#cc0000',
                displayMode: isBlock
            });
            return span;
        } catch (e) {
            console.error('[katex] render error:', e);
            span.textContent = text;
        }
    }
    span.textContent = text;
    applyStyles(span, styles);
    return span;
}

function appendInlineSegmentsInto(parent, segments) {
    (segments || []).forEach((seg) => {
        if (!seg || !seg.kind) return;
        if (seg.kind === 'Plain') {
            // Preserve newline characters by inserting <br> elements.
            const txt = seg.text || '';
            if (txt.indexOf('\n') === -1) {
                parent.appendChild(document.createTextNode(txt));
            } else {
                const parts = txt.split('\n');
                parts.forEach((p, idx) => {
                    parent.appendChild(document.createTextNode(p));
                    if (idx !== parts.length - 1) {
                        parent.appendChild(document.createElement('br'));
                    }
                });
            }
            return;
        }
        if (seg.kind === 'Math') {
            const styles = ['katex'];
            if (seg.display) styles.push('katex-block');
            parent.appendChild(createStyledSpan(seg.tex || '', styles));
        }
    });
}

function appendGlossSegmentsInto(parent, segments) {
    (segments || []).forEach((seg) => {
        if (!seg || !seg.kind) return;
        if (seg.kind === 'Annotated') {
            const rubyEl = document.createElement('ruby');
            const rb = document.createElement('rb');
            appendInlineSegmentsInto(rb, seg.base);
            const rt = document.createElement('rt');
            rt.textContent = seg.reading;
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
            parent.appendChild(rubyEl);
            return;
        }
        if (seg.kind === 'Plain') {
            const txt = seg.text || '';
            if (txt.indexOf('\n') === -1) {
                parent.appendChild(document.createTextNode(txt));
            } else {
                const parts = txt.split('\n');
                parts.forEach((p, idx) => {
                    parent.appendChild(document.createTextNode(p));
                    if (idx !== parts.length - 1) {
                        parent.appendChild(document.createElement('br'));
                    }
                });
            }
            return;
        }
        if (seg.kind === 'Math') {
            const styles = ['katex'];
            if (seg.display) styles.push('katex-block');
            parent.appendChild(createStyledSpan(seg.tex || '', styles));
        }
    });
}

export function appendContentString(parent, value, styles = []) {
    const raw = value != null ? String(value) : '';
    const segments = parseContentToSegments(raw);

    const wrapper = document.createElement('span');
    wrapper.classList.add('content-token');
    applyStyles(wrapper, styles);

    segments.forEach((seg) => {
        if (seg.kind === 'Plain') {
            const txt = seg.text || '';
            if (txt.indexOf('\n') === -1) {
                wrapper.appendChild(document.createTextNode(txt));
            } else {
                const parts = txt.split('\n');
                parts.forEach((p, idx) => {
                    wrapper.appendChild(document.createTextNode(p));
                    if (idx !== parts.length - 1) {
                        wrapper.appendChild(document.createElement('br'));
                    }
                });
            }
            return;
        }
        if (seg.kind === 'Annotated') {
            const rubyEl = document.createElement('ruby');
            const rb = document.createElement('rb');
            appendInlineSegmentsInto(rb, seg.base);
            const rt = document.createElement('rt');
            rt.textContent = seg.reading;
            rubyEl.appendChild(rb);
            rubyEl.appendChild(rt);
            wrapper.appendChild(rubyEl);
            return;
        }
        if (seg.kind === 'Math') {
            const mathSpan = createStyledSpan(seg.tex, ['katex']);
            wrapper.appendChild(mathSpan);
            return;
        }
        if (seg.kind === 'Gloss') {
            const glossSpan = document.createElement('span');
            glossSpan.className = 'gloss';

            const rubyEl = document.createElement('ruby');
            (seg.base || []).forEach((child) => {
                if (child.kind === 'Annotated') {
                    const rb = document.createElement('rb');
                    appendInlineSegmentsInto(rb, child.base);
                    const rt = document.createElement('rt');
                    rt.textContent = child.reading;
                    rubyEl.appendChild(rb);
                    rubyEl.appendChild(rt);
                } else if (child.kind === 'Math') {
                    const rb = document.createElement('rb');
                    appendInlineSegmentsInto(rb, [child]);
                    const rt = document.createElement('rt');
                    rubyEl.appendChild(rb);
                    rubyEl.appendChild(rt);
                } else if (child.kind === 'Plain') {
                    const rb = document.createElement('rb');
                    rb.textContent = child.text;
                    const rt = document.createElement('rt');
                    rubyEl.appendChild(rb);
                    rubyEl.appendChild(rt);
                }
            });
            glossSpan.appendChild(rubyEl);

            if (seg.glosses && seg.glosses.length) {
                const altsWrapper = document.createElement('span');
                altsWrapper.className = 'gloss-alts';
                seg.glosses.forEach((gloss) => {
                    const altSpan = document.createElement('span');
                    altSpan.className = 'gloss-alt';
                    appendGlossSegmentsInto(altSpan, gloss);
                    altsWrapper.appendChild(altSpan);
                });
                glossSpan.appendChild(altsWrapper);
            }
            wrapper.appendChild(glossSpan);
        }
    });

    parent.appendChild(wrapper);
}

/**
 * Clear the parent element and append a rendered ruby/content string.
 */
export function replaceContentString(parent, value, styles = []) {
    if (!parent) return;
    parent.innerHTML = '';
    appendContentString(parent, value, styles);
}

function renderRubyToken(token, row) {
    const rubyEl = document.createElement('ruby');
    if (token._loc) {
        attachSourceInfo(rubyEl, token._loc);
    }
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
    if (token.value != null) {
        const values = Array.isArray(token.value) ? token.value : [token.value];
        appendTokens(span, values, row, null);
        return;
    }
    span.appendChild(createStyledSpan('____', token.styles || []));
}

function appendTokens(parent, tokens, row, placeholders = null, promises = []) {
    let answerIndexCounter = 0;
    (tokens || []).forEach((token) => {
        if (token == null) return;
        if (typeof token === 'string') {
            appendContentString(parent, token);
            return;
        }
        if (!token.type) return;
        if (token.type === 'katex') {
            const text =
                token.value != null
                    ? token.value
                    : token.field && row
                        ? row[token.field] ?? ''
                        : '';

            // Basic validation to prevent empty msub errors if text is empty or malformed
            if (!text) {
                parent.appendChild(createStyledSpan('', ['katex', ...(token.styles || [])]));
                return;
            }

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
                const wrapper = document.createElement('span');
                appendTokens(wrapper, value, row, placeholders, promises);
                applyStyles(wrapper, token.styles || []);
                parent.appendChild(wrapper);
                return;
            }

            // 2) 単一トークンオブジェクトなら 1 要素配列として再帰
            if (value && typeof value === 'object' && value.type) {
                const wrapper = document.createElement('span');
                appendTokens(wrapper, [value], row, placeholders, promises);
                applyStyles(wrapper, token.styles || []);
                parent.appendChild(wrapper);
                return;
            }

            // 3) 文字列は string token と同じパースで描画
            if (typeof value === 'string') {
                appendContentString(parent, value, token.styles || []);
                return;
            }

            // 4) それ以外はテキストとして扱う
            parent.appendChild(createStyledSpan(value != null ? String(value) : '', token.styles || []));
            return;
        }
        if (token.type === 'listkey') {
            const list = Array.isArray(row && token.field ? row[token.field] : null)
                ? row[token.field]
                : [];
            const separators = Array.isArray(token.separatorTokens)
                ? token.separatorTokens
                : token.separatorTokens
                    ? [token.separatorTokens]
                    : [];

            list.forEach((entryTokens, idx) => {
                if (idx > 0 && separators.length) {
                    appendTokens(parent, separators, row, placeholders, promises);
                }
                appendTokens(parent, entryTokens, row, placeholders, promises);
            });
            return;
        }
        if (token.type === 'ruby') {
            parent.appendChild(renderRubyToken(token, row));
            return;
        }
        if (token.type === 'hide') {
            if (placeholders && token.answer) {
                const span = document.createElement('span');
                span.dataset.answerIndex = String(answerIndexCounter);
                span.className = 'inline-block min-w-[2.5rem] border-b app-border-strong mx-1 pb-0.5';
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
            return;
        }
        if (token.type === 'hr') {
            const line = document.createElement('hr');
            line.className = 'my-2 border-t app-border-subtle';
            parent.appendChild(line);
            return;
        }
    });
}

function createOptionButton(labelNodes, isDisabled, onClick, { fullHeight = true } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';

    // 高さも幅もセルいっぱいに広げる
    btn.className = [
        'choice-button choice-default',
        'w-full',
        fullHeight ? 'h-full' : '',   // ★ ここで制御
        // items-start → items-stretch にして中身をフル幅に
        'flex flex-col items-stretch justify-between',
        'px-3 py-2 rounded-xl border app-text-strong app-focus-ring',
        'text-base leading-relaxed',
        'transition-colors'
    ].join(' ');

    if (isDisabled) {
        btn.disabled = true;
        addChoiceStateClasses(btn, 'disabled');
    } else {
        // Wrap the provided onClick with a small cooldown to prevent accidental double-clicks
        btn._lastClick = 0;
        btn.addEventListener('click', (ev) => {
            const now = Date.now();
            if (now - (btn._lastClick || 0) < OPTION_CLICK_COOLDOWN_MS) {
                ev.stopImmediatePropagation();
                ev.preventDefault();
                return;
            }
            btn._lastClick = now;
            try {
                onClick(ev);
            } catch (e) {
                console.error('option click handler error', e);
            }
        });
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
        'option-preview mt-1 text-left text-[0.7rem] app-text-muted leading-relaxed';

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
            'text-sm font-semibold app-text-main mb-2';
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

function updateAnswerNavigation(question, targetIndex) {
    if (!question || !question._answerGroups) return;
    const maxIndex = question._answerGroups.length - 1;
    const nextIndex = Math.min(Math.max(targetIndex, 0), maxIndex);
    question.currentAnswerIndex = nextIndex;

    // Determine the first unanswered index to decide which groups are locked
    const firstUnanswered = question.answers.findIndex(a => a && a.userSelectedIndex == null);

    question._answerGroups.forEach((group, idx) => {
        if (idx === nextIndex) {
            group.classList.remove('hidden');

            // Lock if this group is before the first unanswered group (or if all are answered)
            let isLocked = false;
            if (firstUnanswered === -1) {
                isLocked = true;
            } else {
                isLocked = idx < firstUnanswered;
            }

            const buttons = group.querySelectorAll('button.choice-button');
            buttons.forEach(btn => {
                btn.disabled = isLocked;
                // Optional: Adjust styling for locked (read-only) state
                if (isLocked) {
                    // Ensure it remains readable
                    btn.classList.add('opacity-100');
                    btn.classList.remove('app-focus-ring');
                } else {
                    btn.classList.remove('opacity-100');
                    btn.classList.add('app-focus-ring');
                }
            });

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
    prev.className = 'interactive-button button-ghost px-3 py-1 rounded-lg border app-border-subtle text-xs app-text-main disabled:opacity-50';
    prev.textContent = '<';

    const status = document.createElement('div');
    status.className = 'text-xs app-text-muted';

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'interactive-button button-ghost px-3 py-1 rounded-lg border app-border-subtle text-xs app-text-main disabled:opacity-50';
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

    const promises = [];
    appendTokens(dom.questionText, question.tokens, contextRow, true, promises);
    const answerGroups = question.answers.map((_, idx) =>
        renderAnswerGroup(question, dataSets, idx, onSelect)
    );
    question._answerGroups = answerGroups;

    const useNavigation = answerGroups.length > 1;
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

// 1問ごとに「最悪ケースの高さ」を min-height として予約する
function reserveQuestionTextHeight(question, dataSets) {
    // 「穴埋めトークン (hide) を含むか」で判定する
    const hasInlineBlank =
        Array.isArray(question.tokens) &&
        question.tokens.some(
            (t) => t && t.type === 'hide'
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
            'inline-flex flex-col items-start mx-1 align-baseline leading-tight max-w-full';

        // 上段: 正答（下線つき）
        const correctLine = document.createElement('span');
        correctLine.className =
            'block px-2 border-b app-border-strong min-w-[2.5rem] whitespace-normal pb-0.5';

        if (isReviewContext) {
            // Mistakes では正答を少し強調（青緑）
            correctLine.classList.add(
                'app-text-success'
            );
        }

        correctLine.appendChild(buildLabelNode(correctOpt));
        placeholder.appendChild(correctLine);

        // 間違えている場合のみ下段に「× ユーザの解答」を表示
        if (!isCorrect && selectedOpt) {
            const wrongLine = document.createElement('span');
            wrongLine.className =
                'mt-0.5 text-[0.7rem] app-text-danger ' +
                // レイアウト系
                'flex items-start gap-1 ' +
                // 長いテキスト用: 折り返し + 高さ制限 + 縦スクロール
                'max-h-16 overflow-y-auto break-words whitespace-normal';

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

export function renderProgress(currentIndex, total, score) {
    dom.currentQNum.textContent = `${currentIndex + 1}`;
    const totalLabel =
        typeof total === 'number' ? `${total}` : (total ? String(total) : '--');
    dom.totalQNum.textContent = totalLabel;
    dom.currentScore.textContent = `${score}`;
}

export function showOptionFeedback(question) {
    question.answers.forEach((answer, answerIndex) => {
        if (!answer || !Array.isArray(answer.options)) return;

        answer.options.forEach((opt, optIndex) => {
            const btn = dom.optionsContainer.querySelector(
                `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
            );
            if (!btn) return;

            const isSelected = answer.userSelectedIndex === optIndex;
            const isCorrectChoice = optIndex === answer.correctIndex;
            const hasAnswered = answer.userSelectedIndex != null;

            if (isSelected && isCorrectChoice) {
                setChoiceState(btn, 'correct');
            } else if (isSelected) {
                setChoiceState(btn, 'incorrect');
            } else if (isCorrectChoice && hasAnswered) {
                setChoiceState(btn, 'correct');
            } else {
                resetChoiceButtonState(btn);
            }
        });
    });
}

export function showOptionFeedbackForAnswer(question, answerIndex) {
    if (!question || !Array.isArray(question.answers)) return;

    const answer = question.answers[answerIndex];
    if (!answer || !Array.isArray(answer.options)) return;

    answer.options.forEach((opt, optIndex) => {
        const btn = dom.optionsContainer.querySelector(
            `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
        );
        if (!btn) return;

        const isSelected = answer.userSelectedIndex === optIndex;
        const isCorrectChoice = optIndex === answer.correctIndex;
        const hasAnswered = answer.userSelectedIndex != null;

        if (isSelected && isCorrectChoice) {
            setChoiceState(btn, 'correct');
        } else if (isSelected) {
            setChoiceState(btn, 'incorrect');
        } else if (isCorrectChoice && hasAnswered) {
            setChoiceState(btn, 'correct');
        } else {
            resetChoiceButtonState(btn);
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

export function revealCorrectAnswerInPreviews(question, dataSets, answerIndex) {
    return;
}

export function appendPatternPreviewToOptions(question, dataSets) {
    if (!question || !Array.isArray(question.answers)) return;

    question.answers.forEach((answer, answerIndex) => {
        (answer.options || []).forEach((opt, optIndex) => {
            const btn = dom.optionsContainer.querySelector(
                `button[data-answer-index="${answerIndex}"][data-option-index="${optIndex}"]`
            );
            if (!btn) return;

            const preview = btn.querySelector('.option-preview');
            if (!preview) return;
            if (preview.dataset.filled === '1') return;

            // ------- ここから: 行データを特定 -------
            let rowContext = null;
            const sourceDataSetId =
                opt.dataSetId || (question.meta && question.meta.dataSetId);
            const ds = sourceDataSetId ? dataSets[sourceDataSetId] : null;

            if (opt.entityId && ds) {
                if (ds.type === 'table' && Array.isArray(ds.data)) {
                    rowContext =
                        ds.data.find((r) => r.id === opt.entityId) || null;
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
                // 一度空にしてから、この span の「中に」値を描画
                placeholder.textContent = '';
                if (opt.labelTokens && opt.labelTokens.length) {
                    appendTokens(placeholder, opt.labelTokens, rowContext);
                } else {
                    const targetToken = (question.tokens || []).find((t) => t && t.type === 'hide');
                    if (targetToken) {
                        renderHideValueIntoSpan(placeholder, targetToken, rowContext);
                    }
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
        'rounded-lg border px-3 py-2 text-xs app-card'
    ].join(' ');

    // ヘッダー行: Q番号（左）と Incorrectバッジ（右）
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between text-xs app-text-muted';

    const qLabel = document.createElement('span');
    qLabel.className = 'font-semibold app-text-strong';
    qLabel.textContent = `Q${questionNumber}`;

    const badge = document.createElement('span');
    badge.className = 'text-[0.7rem] app-pill app-pill-danger app-pill-compact';
    badge.textContent = 'Incorrect';

    header.appendChild(qLabel);
    header.appendChild(badge);

    // 問題文（穴埋め付き）
    const qText = document.createElement('div');
    qText.className = 'app-text-main quiz-text-block mt-1';

    const row = resolveQuestionContext(question, dataSets);

    // まずはプレースホルダ付きで本文を描画（question-view と同じロジック）
    appendTokens(qText, question.tokens || [], row, true);

    // 各パーツごとに正答 / 誤答を埋め込む
    (question.answers || []).forEach((_, idx) => {
        updateInlineBlank(question, dataSets, idx, qText);
    });

    li.appendChild(header);
    li.appendChild(qText);

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
        block.className = 'p-2 rounded-lg app-surface-muted border app-border-subtle text-sm mb-2';
        appendTokens(block, tip.tokens, row);
        dom.tipContainer.appendChild(block);
    });
}

export function resetTips() {
    dom.tipContainer.innerHTML = '';
}

export { optionToText, summarizeQuestion, tokensToPlainText };

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
    // item.className = historyItem.correct
    //     ? 'p-2 rounded-lg border app-card app-card-status-success'
    //     : 'p-2 rounded-lg border app-card app-card-status-danger';
    item.className = 'rounded-lg border px-3 py-2 text-xs app-card';

    const header = document.createElement('div');
    header.className =
        'flex items-center justify-between text-xs app-text-muted';

    const orderSpan = document.createElement('span');
    orderSpan.className = 'font-semibold app-text-strong';
    orderSpan.textContent = `Q${historyItem.index}`;
    header.appendChild(orderSpan);

    // 正解 / 不正解バッジ
    const badge = document.createElement('span');
    const resultType = historyItem.resultType || (historyItem.correct ? 'correct' : 'incorrect');
    if (resultType === 'idk') {
        badge.className = 'app-pill app-pill-compact border app-border-subtle app-text-muted';
        badge.textContent = 'IDK';
    } else if (resultType === 'weak') {
        badge.className = 'app-pill app-pill-warning app-pill-compact';
        badge.textContent = 'Weak';
    } else if (historyItem.correct) {
        badge.className = 'app-pill app-pill-success app-pill-compact';
        badge.textContent = 'Correct';
    } else {
        badge.className = 'app-pill app-pill-danger app-pill-compact';
        badge.textContent = 'Incorrect';
    }
    header.appendChild(badge);

    // 問題文（穴埋め付き）
    const text = document.createElement('div');
    text.className = 'app-text-main quiz-text-block mt-1';

    const rowContext = resolveQuestionContext(question, dataSets);

    // プレースホルダ付きで本文を描画
    appendTokens(text, question.tokens || [], rowContext, true);

    // 各パーツごとに正答 / 誤答を埋め込む
    (question.answers || []).forEach((_, idx) => {
        updateInlineBlank(question, dataSets, idx, text);
    });

    item.appendChild(header);
    item.appendChild(text);
    dom.resultList.appendChild(item);
}
