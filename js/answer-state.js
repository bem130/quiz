// js/answer-state.js

/**
 * 回答の一部に対する選択肢の記録と判定をまとめて行う。
 *
 * 各回答パーツの選択完了状態と、設問全体が正解しているかどうかを返す。
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
    const fullyCorrect =
        allSelected && answers.every(
            (ans) => ans && ans.userSelectedIndex === ans.correctIndex
        );
    const lastSelectionIsCorrect = target.userSelectedIndex === target.correctIndex;

    return { allSelected, fullyCorrect, lastSelectionIsCorrect };
}

/**
 * 設問内のすべての回答パーツについて選択状態をリセットする。
 */
export function resetSelections(question) {
    if (!question || !Array.isArray(question.answers)) return;

    question.answers.forEach((ans) => {
        if (ans) {
            ans.userSelectedIndex = null;
        }
    });
}
