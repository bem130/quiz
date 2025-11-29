// js/answer-state.js

/**
 * 回答の一部に対する選択肢の記録と判定をまとめて行う。
 *
 * 各回答パーツの選択完了状態と、設問全体が正解しているかどうかを返す。
 * @param {object} question - 現在の設問オブジェクト。
 * @param {number} answerIndex - 回答対象のパーツのインデックス。
 * @param {number} optionIndex - 選択された選択肢のインデックス。
 * @returns {{allSelected: boolean, fullyCorrect: boolean, lastSelectionIsCorrect: boolean}} 選択と採点の結果。
 */
export function selectAnswer(question, answerIndex, optionIndex) {
    if (!question || !Array.isArray(question.answers)) {
        return {
            allSelected: false,
            fullyCorrect: false,
            lastSelectionIsCorrect: false
        };
    }

    const answers = question.answers;
    const target = answers[answerIndex];
    if (!target) {
        return {
            allSelected: false,
            fullyCorrect: false,
            lastSelectionIsCorrect: false
        };
    }

    target.userSelectedIndex = optionIndex;

    const allSelected = answers.every(
        (ans) => ans && ans.userSelectedIndex != null
    );

    let fullyCorrect = false;

    if (allSelected) {
        // Check for unordered answer groups
        const groups = question.meta && question.meta.unorderedAnswerGroups;
        if (Array.isArray(groups) && groups.length > 0) {
            fullyCorrect = true;
            const groupedIndices = new Set();

            // 1. Validate each unordered group
            for (const group of groups) {
                if (!Array.isArray(group)) continue;
                
                const expectedLabels = [];
                const selectedLabels = [];

                for (const idx of group) {
                    const ans = answers[idx];
                    if (!ans) continue;
                    groupedIndices.add(idx);

                    const correctOpt = ans.options[ans.correctIndex];
                    const selectedOpt = ans.options[ans.userSelectedIndex];

                    if (correctOpt) expectedLabels.push(correctOpt.label);
                    if (selectedOpt) selectedLabels.push(selectedOpt.label);
                }

                // Compare as multisets (sort and compare)
                expectedLabels.sort();
                selectedLabels.sort();

                if (expectedLabels.length !== selectedLabels.length) {
                    fullyCorrect = false;
                    break;
                }
                for (let i = 0; i < expectedLabels.length; i++) {
                    if (expectedLabels[i] !== selectedLabels[i]) {
                        fullyCorrect = false;
                        break;
                    }
                }
                if (!fullyCorrect) break;
            }

            // 2. Validate remaining answers normally
            if (fullyCorrect) {
                fullyCorrect = answers.every((ans, idx) => {
                    if (!ans) return true;
                    if (groupedIndices.has(idx)) return true; // Already checked
                    return ans.userSelectedIndex === ans.correctIndex;
                });
            }
        } else {
            // Standard validation
            fullyCorrect = answers.every(
                (ans) => ans && ans.userSelectedIndex === ans.correctIndex
            );
        }
    }

    const lastSelectionIsCorrect = target.userSelectedIndex === target.correctIndex;

    return { allSelected, fullyCorrect, lastSelectionIsCorrect };
}

/**
 * 設問内のすべての回答パーツについて選択状態をリセットする。
 * @param {object} question - 対象の設問オブジェクト。
 */
export function resetSelections(question) {
    if (!question || !Array.isArray(question.answers)) return;

    question.answers.forEach((ans) => {
        if (ans) {
            ans.userSelectedIndex = null;
        }
    });
}
