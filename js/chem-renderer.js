// js/chem-renderer.js

const INLINE_VIEWER_CLASS = 'chem-inline-viewer';
let rdkitModule = null;
let initPromise = null;

/**
 * Initialize RDKit and Kekule only once.
 * RDKit_minimal.js and Kekule must be loaded globally before this call.
 * @returns {Promise<void>} Resolve when both libraries are ready.
 */
export function ensureChemReady() {
    if (initPromise) {
        return initPromise;
    }

    initPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new Error('Chem renderer is only available in browser.'));
            return;
        }
        if (!window.initRDKitModule) {
            reject(new Error('RDKit_minimal.js is not loaded.'));
            return;
        }
        if (!window.Kekule || !window.Kekule.ChemWidget) {
            reject(new Error('Kekule.js is not loaded.'));
            return;
        }

        window
            .initRDKitModule()
            .then((instance) => {
                rdkitModule = instance;
                resolve();
            })
            .catch((err) => {
                console.error('[chem] Failed to initialize RDKit.', err);
                initPromise = null;
                reject(err);
            });
    });

    return initPromise;
}

/**
 * Render SMILES as an inline 2D chemical structure.
 * Fallbacks to plain text when rendering fails.
 * @param {HTMLElement} container - Target element to host the viewer.
 * @param {string} smiles - SMILES string.
 */
export async function renderSmilesInline(container, smiles) {
    if (!container) {
        return;
    }

    const text = (smiles || '').trim();
    if (!text) {
        container.textContent = '[SMILES]';
        container.classList.add('font-mono');
        return;
    }

    container.classList.add(INLINE_VIEWER_CLASS);

    try {
        await ensureChemReady();
        container.textContent = '';

        const mol = rdkitModule.get_mol(text);
        if (!mol) {
            throw new Error('Invalid SMILES');
        }

        try {
            const molBlock = mol.get_molblock();
            const kekuleMol = window.Kekule.IO.loadFormatData(molBlock, 'mol');
            const viewer = new window.Kekule.ChemWidget.Viewer2D(container);
            viewer.setPredefinedSetting('static');
            viewer.setAutoSize(true);
            viewer.setEnableToolbar(false);
            viewer.setEnableDirectInteraction(false);
            viewer.setInheritedRenderColor(true);
            viewer.setAutofit(true);
            viewer.setChemObj(kekuleMol);
        } finally {
            mol.delete();
        }
    } catch (err) {
        console.error('[chem] Failed to render SMILES:', text, err);
        container.textContent = `[SMILES: ${text}]`;
        container.classList.add('font-mono');
    }
}
