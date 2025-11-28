// js/quiz-types.js
/**
 * @typedef {object} DataSetTable
 * @property {'table'} type
 * @property {Array<object>} data
 * @property {string} [idField]
 *
 * @typedef {object} FactSentence
 * @property {string} id
 * @property {Array<object>} tokens
 *
 * @typedef {object} GroupDefinition
 * @property {Array<string>} choices
 * @property {'choice'} mode
 * @property {boolean} [drawWithoutReplacement]
 *
 * @typedef {object} DataSetFactSentences
 * @property {'factSentences'} type
 * @property {Array<FactSentence>} sentences
 * @property {Object.<string, GroupDefinition>} [groups]
 *
 * @typedef {object} DataSetGroups
 * @property {'groups'} type
 * @property {Object.<string, GroupDefinition>} groups
 *
 * @typedef {object} QuizDefinitionV2
 * @property {object} meta
 * @property {Object.<string, DataSetTable|DataSetFactSentences|DataSetGroups>} dataSets
 * @property {Array<object>} patterns
 * @property {Array<object>} modes
 *
 * @typedef {object} AnswerPart
 * @property {string} id
 * @property {string} mode
 * @property {Array<object>} options
 * @property {number} correctIndex
 * @property {number|null} [userSelectedIndex]
 * @property {object} [meta]
 *
 * @typedef {object} QuestionInstance
 * @property {string} id
 * @property {string} patternId
 * @property {string} format
 * @property {Array<object>} tokens
 * @property {Array<AnswerPart>} answers
 * @property {object} [matching]
 * @property {object} meta
 */
