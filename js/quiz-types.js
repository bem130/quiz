// js/quiz-types.js
/**
 * @typedef {object} DataSetTable
 * @property {'table'} type
 * @property {Array<object>} data
 * @property {string} [idField]
 *
 * @typedef {object} QuizDefinitionV3
 * @property {object} meta
 * @property {Object.<string, DataSetTable>} dataSets
 * @property {Array<object>} patterns
 * @property {Array<object>} modes
 *
 * @typedef {object} AnswerPart
 * @property {string} id
 * @property {'choice_from_entities'} mode
 * @property {Array<object>} options
 * @property {number} correctIndex
 * @property {number|null} [userSelectedIndex]
 * @property {object} [meta]
 *
 * @typedef {object} QuestionInstance
 * @property {string} id
 * @property {string} patternId
 * @property {'table_fill_choice'} format
 * @property {Array<object>} tokens
 * @property {Array<AnswerPart>} answers
 * @property {object} meta
 */
