import assert from 'node:assert';
import { selectAnswer, resetSelections } from '../js/answer-state.js';

function createQuestion(parts) {
    return {
        answers: parts.map((part) => ({
            correctIndex: part.correctIndex,
            userSelectedIndex: part.userSelectedIndex ?? null,
            options: part.options
        }))
    };
}

// 単一回答の典型ケース
{
    const question = createQuestion([
        { correctIndex: 2, options: [0, 1, 2, 3] }
    ]);

    const result = selectAnswer(question, 0, 2);
    assert.strictEqual(result.allSelected, true, 'All parts should be selected');
    assert.strictEqual(result.fullyCorrect, true, 'Single correct selection should be fully correct');
    assert.strictEqual(question.answers[0].userSelectedIndex, 2, 'Selection should be stored');
}

// 複数回答で、最後の選択まで採点を待つ
{
    const question = createQuestion([
        { correctIndex: 1, options: [0, 1, 2] },
        { correctIndex: 0, options: [0, 1, 2] }
    ]);

    const first = selectAnswer(question, 0, 1);
    assert.strictEqual(first.allSelected, false, 'Should not be all selected after first pick');
    assert.strictEqual(first.fullyCorrect, false, 'Should not mark fully correct before all picks');

    const second = selectAnswer(question, 1, 0);
    assert.strictEqual(second.allSelected, true, 'All parts should be selected after second pick');
    assert.strictEqual(second.fullyCorrect, true, 'Both selections match correct answers');
}

// fill_in_blank も choice と同様に扱う（位置によらず同じ評価）
{
    const question = createQuestion([
        { correctIndex: 3, options: ['a', 'b', 'c', 'd'], mode: 'fill_in_blank' },
        { correctIndex: 2, options: ['x', 'y', 'z'], mode: 'choice' }
    ]);

    resetSelections(question);
    const first = selectAnswer(question, 0, 3);
    assert.strictEqual(first.allSelected, false, 'First part alone should not complete selection');

    const second = selectAnswer(question, 1, 1);
    assert.strictEqual(second.fullyCorrect, false, 'Second choice is incorrect so overall is false');

    const third = selectAnswer(question, 1, 2);
    assert.strictEqual(third.fullyCorrect, true, 'Correcting the second part should make overall correct');
}
