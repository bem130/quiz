// js/dataset-utils.js
import { evaluateFilter } from './filters.js';

/**
 * Resolve dataset by id.
 * @param {object} dataSets
 * @param {string} id
 * @returns {object|null}
 */
export function getDataSet(dataSets, id) {
    if (!dataSets || !id) return null;
    return dataSets[id] || null;
}

/**
 * Return rows from table dataset with optional filter.
 * @param {object} table
 * @param {object|null} filter
 * @returns {Array<object>}
 */
export function getFilteredRows(table, filter) {
    if (!table || !Array.isArray(table.data)) {
        return [];
    }
    return table.data.filter((row) => evaluateFilter(row, filter));
}

export function getRowById(table, rowId) {
    if (!table || !Array.isArray(table.data)) {
        return null;
    }
    return table.data.find((row) => row && row.id === rowId) || null;
}

/**
 * Pick random element from array.
 * @param {Array<T>} arr
 * @template T
 */
export function randomChoice(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Shuffle array copy.
 * @param {Array<T>} arr
 * @template T
 * @returns {Array<T>}
 */
export function shuffled(arr) {
    const copy = Array.isArray(arr) ? arr.slice() : [];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/**
 * Pick n distinct items at random.
 * @param {Array<T>} arr
 * @param {number} count
 * @template T
 * @returns {Array<T>}
 */
export function pickN(arr, count) {
    if (!Array.isArray(arr) || count <= 0) {
        return [];
    }
    const pool = shuffled(arr || []);
    return pool.slice(0, Math.min(count, pool.length));
}

export function findGroupDefinition(dataSets, groupRef, fallbackDataSetId) {
    if (!groupRef || !dataSets) {
        return null;
    }

    const ref =
        typeof groupRef === 'string'
            ? { dataSetId: fallbackDataSetId, groupId: groupRef }
            : groupRef;

    const dsId = ref && ref.dataSetId ? ref.dataSetId : fallbackDataSetId;
    if (dsId && dataSets[dsId]) {
        const ds = dataSets[dsId];
        if (ds.type === 'factSentences' && ds.groups && ds.groups[ref.groupId]) {
            return ds.groups[ref.groupId];
        }
        if (ds.type === 'groups' && ds.groups && ds.groups[ref.groupId]) {
            return ds.groups[ref.groupId];
        }
    }

    const anyGroups = Object.values(dataSets).find((d) => d && d.type === 'groups');
    if (anyGroups && anyGroups.groups && ref.groupId && anyGroups.groups[ref.groupId]) {
        return anyGroups.groups[ref.groupId];
    }

    return null;
}
