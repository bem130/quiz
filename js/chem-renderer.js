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
 * @param {object} [options] - Render control options.
 * @param {number} [options.maxHeightEm=7] - Max inline height in em.
 * @param {number} [options.maxHeightPx] - Explicit max height in px if provided.
 * @param {number} [options.zoomPadding=0.9] - Additional shrink factor to keep margin.
 */
export async function renderSmilesInline(container, smiles, options = {}) {
    if (!container) return;

    const text = (smiles || '').trim();
    if (!text) {
        container.textContent = '[SMILES]';
        container.classList.add('font-mono');
        return;
    }

    // Treat container as "wrapper" element for layout.
    const wrapper = container;
    wrapper.classList.add(INLINE_VIEWER_CLASS);

    // Clear existing contents.
    wrapper.textContent = '';

    // Create inner element for actual chemical viewer.
    const inner = document.createElement('span');
    inner.className = `${INLINE_VIEWER_CLASS}-inner`;
    wrapper.appendChild(inner);

    try {
        await ensureChemReady();

        let mol = rdkitModule.get_mol(text);
        if (!mol) {
            // Try replacing [*] with * (common wildcard issue)
            const sanitized = text.replace(/\[\*\]/g, '*');
            if (sanitized !== text) {
                mol = rdkitModule.get_mol(sanitized);
            }
        }
        if (!mol) {
            // Fallback to query molecule if standard parsing fails
            mol = rdkitModule.get_qmol(text);
        }

        if (!mol) {
            throw new Error('Invalid SMILES');
        }

        try {
            const molBlock = mol.get_molblock();
            const kekuleMol = window.Kekule.IO.loadFormatData(molBlock, 'mol');

            // ★ Viewer2D is created on the inner element
            const viewer = new window.Kekule.ChemWidget.Viewer2D(inner);
            viewer.setPredefinedSetting('static');
            viewer.setAutoSize(true);
            viewer.setEnableToolbar(false);
            viewer.setEnableDirectInteraction(false);
            viewer.setInheritedRenderColor(true);
            viewer.setAutofit(true);
            viewer.setChemObj(kekuleMol);

            // ★ Scale only the inner element, while wrapper controls line layout.
            await scheduleScaleAdjust(wrapper, inner, options);
        } finally {
            mol.delete();
        }
    } catch (err) {
        console.error('[chem] Failed to render SMILES:', text, err);
        wrapper.textContent = `[SMILES: ${text}]`;
        wrapper.classList.add('font-mono');
    }
}

function scheduleScaleAdjust(wrapper, target, options = {}) {
    const {
        maxHeightEm = 7,       // About 7 lines of text by default
        maxHeightPx,
        zoomPadding = 0.9,     // Keep a small margin inside the limit
    } = options;

    return new Promise((resolve) => {
        const maxTries = 5;
        let tries = 0;

        const adjust = () => {
            tries += 1;

            // 1) Get line height around this inline element.
            const lineHeight = getComputedLineHeight(wrapper);
            const limitPx = maxHeightPx ?? (maxHeightEm * lineHeight);

            // 2) Measure actual height of the chemical drawing.
            const rect = target.getBoundingClientRect();
            const actualHeight = rect.height || target.offsetHeight;
            const actualWidth = rect.width || target.offsetWidth;

            // If height is not ready yet, try again on the next frame.
            if (!actualHeight || !Number.isFinite(actualHeight)) {
                if (tries < maxTries) {
                    requestAnimationFrame(adjust);
                } else {
                    // Give up waiting, resolve anyway
                    resolve();
                }
                return;
            }

            // Ensure wrapper behaves like a normal inline-block box.
            wrapper.style.display = 'inline-block';
            wrapper.style.verticalAlign = 'bottom'; // Align bottom to line bottom

            // 3) Case: it already fits within the limit -> no scaling.
            if (actualHeight <= limitPx) {
                wrapper.style.height = `${Math.ceil(actualHeight)}px`;
                wrapper.style.width = `${Math.ceil(actualWidth)}px`;
                target.style.transform = '';
                target.style.transformOrigin = '';
                resolve();
                return;
            }

            // 4) Case: too tall -> scale down only the target.
            const scale = (limitPx / actualHeight) * zoomPadding;
            const visibleHeight = actualHeight * scale;
            const visibleWidth = actualWidth * scale;

            wrapper.style.height = `${Math.ceil(visibleHeight)}px`;
            wrapper.style.width = `${Math.ceil(visibleWidth)}px`;

            // Use top-left origin so the element stays at the top of the wrapper
            // and fills the calculated visible dimensions.
            target.style.transformOrigin = 'top left';
            target.style.transform = `scale(${scale})`;
            resolve();
        };

        requestAnimationFrame(adjust);
    });
}

// その要素に実際に適用されているフォントサイズ(px)を取得
function getComputedLineHeight(element) {
    const style = window.getComputedStyle(element);
    const fontSize = parseFloat(style.fontSize) || 16;

    if (!style.lineHeight || style.lineHeight === 'normal') {
        // normal の場合はだいたい 1.4 倍くらい
        return fontSize * 1.4;
    }
    const lh = parseFloat(style.lineHeight);
    return Number.isFinite(lh) && lh > 0 ? lh : fontSize * 1.4;
}
