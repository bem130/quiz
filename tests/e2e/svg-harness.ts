import { sanitizeSvg } from '../../src/web/svg.ts';
import { none, some } from '../../src/core/result.ts';

export type SvgTestResult = Readonly<{ ok: boolean; detail: string }>;
export type SvgBounds = Readonly<{ x: number; y: number; width: number; height: number; ratio: number; viewportWidth: number; viewportHeight: number; scrollWidth: number }>;
export type SvgTestApi = Readonly<{
    mount: (source: string, alt: string, fontSize?: number) => SvgTestResult;
    append: (source: string, alt: string) => SvgTestResult;
    bounds: () => SvgBounds;
    smiles: (value: string, fontSize?: number, limits?: Readonly<{ maxHeightEm: number; maxHeightPx: number; zoomPadding: number }>) => Promise<SvgTestResult>;
}>;
declare global { interface Window { svgTest: SvgTestApi } }

const fixture = document.getElementById('fixture');
if (!(fixture instanceof HTMLElement)) throw new Error('検証領域が存在しない。');
const host = fixture;
function append(source: string, alt: string): SvgTestResult {
    const result = sanitizeSvg(source, alt);
    if (!result.ok) return { ok: false, detail: result.error.detail };
    host.append(result.value);
    return { ok: true, detail: '' };
}
function font(size: number): void { document.documentElement.style.fontSize = `${size}px`; host.style.fontSize = `${size}px`; }
window.svgTest = {
    mount(source, alt, fontSize = 16) { host.replaceChildren(); font(fontSize); return append(source, alt); },
    append,
    bounds() {
        const svg = host.querySelector('svg');
        if (!(svg instanceof SVGSVGElement)) throw new Error('検証対象のSVGが存在しない。');
        const bounds = svg.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, ratio: bounds.width / bounds.height, viewportWidth: innerWidth, viewportHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    },
    async smiles(value, fontSize = 16, limits) {
        host.replaceChildren(); font(fontSize);
        const { renderTokens } = await import('../../src/web/content.ts');
        const content = renderTokens([{ type: 'smiles', styles: [], source: { kind: 'literal', value },
            maxHeightEm: limits ? some(limits.maxHeightEm) : none,
            maxHeightPx: limits ? some(limits.maxHeightPx) : none,
            zoomPadding: limits ? some(limits.zoomPadding) : none }]);
        host.append(content);
        const started = performance.now();
        while (performance.now() - started < 30_000) {
            if (host.querySelector('svg')) return { ok: true, detail: '' };
            const failure = host.querySelector('.graphic-error');
            if (failure) return { ok: false, detail: failure.textContent ?? '' };
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return { ok: false, detail: '化学構造の描画が時間内に完了しない。' };
    }
};
