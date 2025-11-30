/**
 * Create a deep copy of a question for retry without DOM elements.
 * DOM nodes cannot be cloned safely, so they are replaced with null values.
 * @param {*} question
 * @returns {*}
 */
export function cloneQuestionForRetry(question) {
    if (question === undefined || question === null) {
        return question;
    }

    const replacer = (key, value) => {
        if (typeof Element !== 'undefined' && value instanceof Element) {
            return null;
        }
        return value;
    };

    return JSON.parse(JSON.stringify(question, replacer));
}
