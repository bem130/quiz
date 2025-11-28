// js/filters.js

/**
 * Evaluate a filter object against a target row.
 * Supports logical operators (and/or/not) and basic comparisons.
 * @param {object} row
 * @param {object} filter
 * @returns {boolean}
 */
export function evaluateFilter(row, filter) {
    if (!filter || !row) {
        return true;
    }

    if (filter.and && Array.isArray(filter.and)) {
        return filter.and.every((child) => evaluateFilter(row, child));
    }

    if (filter.or && Array.isArray(filter.or)) {
        return filter.or.some((child) => evaluateFilter(row, child));
    }

    if (filter.not) {
        return !evaluateFilter(row, filter.not);
    }

    if (typeof filter.exists === 'string') {
        return Object.prototype.hasOwnProperty.call(row, filter.exists);
    }

    if (filter.eq && typeof filter.eq.field === 'string') {
        return row[filter.eq.field] === filter.eq.value;
    }

    if (filter.neq && typeof filter.neq.field === 'string') {
        return row[filter.neq.field] !== filter.neq.value;
    }

    if (filter.in && typeof filter.in.field === 'string') {
        const values = Array.isArray(filter.in.values) ? filter.in.values : [];
        return values.includes(row[filter.in.field]);
    }

    return true;
}
