// js/answer-state.js

/**
 * Record the selected option for a given answer part.
 * Returns whether all parts have been selected and whether the entire question is fully correct.
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

export function resetSelections(question) {
    if (!question || !Array.isArray(question.answers)) return;

    question.answers.forEach((ans) => {
        if (ans) {
            ans.userSelectedIndex = null;
        }
    });
}
