import { expect, test } from '@playwright/test';
import type { SvgTestApi } from './svg-harness.ts';

declare global { interface Window { svgTest: SvgTestApi } }
const svg = (content: string, attributes = 'viewBox="0 0 200 100"'): string => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${content}</svg>`;
const dimensions: ReadonlyArray<readonly [number, number]> = [[900, 300], [100, 900]];

test('SMILESの明示的な高さと余白を反映し縦横比を維持する', async ({ page }) => {
    await page.goto('tests/e2e/svg.html');
    await page.waitForFunction(() => typeof window.svgTest === 'object');
    const result = await page.evaluate(() => window.svgTest.smiles('NCC(=O)O', 32, { maxHeightEm: 2, maxHeightPx: 40, zoomPadding: 0.5 }));
    expect(result.ok).toBe(true);
    const bounds = await page.evaluate(() => window.svgTest.bounds());
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.height).toBeLessThanOrEqual(20.5);
    expect(bounds.ratio).toBeCloseTo(480 / 280, 1);
});

test.beforeEach(async ({ page }) => {
    await page.goto('tests/e2e/svg.html');
    await page.waitForFunction(() => typeof window.svgTest === 'object');
});

test('静的図形・文字・gradient・clip・useを新DOMで描画しIDとclassを分離する', async ({ page }) => {
    const source = svg('<defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><clipPath id="clip"><rect width="180" height="90"/></clipPath><g id="shape"><rect width="180" height="90" fill="url(#paint)"/></g></defs><use href="#shape" clip-path="url(#clip)"/><text x="10" y="30" class="label" xml:space="preserve">A  B<tspan> 日本語</tspan></text>');
    expect(await page.evaluate((source) => window.svgTest.mount(source, '正の描画例'), source)).toEqual({ ok: true, detail: '' });
    const firstIds = await page.locator('#fixture svg [id]').evaluateAll((elements) => elements.map((element) => element.id));
    expect(firstIds.every((id) => id.startsWith('quiz-svg-'))).toBe(true);
    expect(await page.locator('#fixture text').getAttribute('xml:space')).toBe('preserve');
    expect(await page.locator('#fixture text').getAttribute('class')).toMatch(/^quiz-svg-\d+-label$/);
    expect(await page.locator('#fixture use').getAttribute('href')).toMatch(/^#quiz-svg-\d+-shape$/);
    expect(await page.locator('#fixture svg').getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(await page.evaluate((source) => window.svgTest.append(source, '独立した2枚目'), source)).toEqual({ ok: true, detail: '' });
    const ids = await page.locator('#fixture svg [id]').evaluateAll((elements) => elements.map((element) => element.id));
    expect(new Set(ids).size).toBe(ids.length);
    await expect(page.getByRole('img', { name: '正の描画例' })).toBeVisible();
});

test('安全なpresentation styleを属性へ展開しstyle側を優先する', async ({ page }) => {
    const source = svg('<rect style="fill:blue;stroke-width:2" fill="red" width="100" height="50"/>');
    expect((await page.evaluate((source) => window.svgTest.mount(source, '安全なstyle'), source)).ok).toBe(true);
    await expect(page.locator('#fixture rect')).toHaveAttribute('fill', 'blue');
    expect(await page.locator('#fixture rect').getAttribute('style')).toBeNull();
});

test('危険なXML・要素・属性・外部URL・CSS・namespaceを拒否し外部要求を出さない', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:5173/')) requests.push(request.url()); });
    const unsafe = [
        svg('<script>alert(1)</script>'), svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'),
        svg('<rect onload="alert(1)"/>'), svg('<image href="https://example.invalid/image.svg"/>'),
        svg('<use href="https://example.invalid/shape.svg#x"/>'), svg('<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="//example.invalid/x"/>'),
        svg('<rect fill="url(https://example.invalid/paint)"/>'), svg('<rect style="fill:url(https://example.invalid/paint)"/>'),
        svg('<rect style="fill:u\\72l(https://example.invalid/paint)"/>'), svg('<rect style="background-image:url(https://example.invalid/x)"/>'),
        svg('<style>@import "https://example.invalid/style.css";</style>'), svg('<a href="javascript:alert(1)"><text>x</text></a>'),
        svg('<rect xmlns:evil="http://example.invalid/evil" evil:onload="alert(1)"/>'),
        svg('<g xmlns="http://www.w3.org/1999/xhtml"><rect/></g>'), svg('<rect xmlns:x="http://www.w3.org/2000/svg" x:fill="red"/>'),
        '<!DOCTYPE svg [<!ENTITY x "text">]>' + svg('<text>&x;</text>'), '<?xml-stylesheet href="https://example.invalid/x"?>' + svg(''),
        svg('<animate attributeName="x"/>'), svg('<set attributeName="onload" to="alert(1)"/>'),
        svg('<rect id="duplicate"/><rect id="duplicate"/>'), svg('<use href="#missing"/>'),
        svg('<g id="self"><use href="#self"/></g>'), svg('<clipPath id="c"><rect clip-path="url(#c)"/></clipPath>'),
        svg('<rect data-unknown="x"/>'), svg('<rect style="fill: red !important"/>')
    ];
    for (const source of unsafe) {
        const result = await page.evaluate((source) => window.svgTest.mount(source, '拒否する図'), source);
        expect(result.ok, source).toBe(false);
        await expect(page.locator('#fixture svg')).toHaveCount(0);
    }
    expect(requests).toEqual([]);
});

test('反復use・marker頂点・長い非循環参照・path/text量の増幅を描画前に拒否する', async ({ page }) => {
    const manyShapes = '<rect width="1" height="1"/>'.repeat(400);
    const uses = '<use href="#heavy"/>'.repeat(400);
    const repeated = svg(`<defs><g id="heavy">${manyShapes}</g></defs>${uses}`);
    const points = Array.from({ length: 1000 }, (_, index) => `${index % 200},${index % 100}`).join(' ');
    const marker = svg(`<defs><marker id="m">${manyShapes}</marker></defs><polyline points="${points}" marker-mid="url(#m)"/>`);
    const chain = svg(`<defs>${Array.from({ length: 40 }, (_, index) => `<clipPath id="c${index}"><rect width="1" height="1"${index < 39 ? ` clip-path="url(#c${index + 1})"` : ''}/></clipPath>`).join('')}</defs><rect clip-path="url(#c0)"/>`);
    const path = svg(`<path d="M0 0 ${'L1 1 '.repeat(11_000)}"/>`);
    const text = svg(`<text>${'文字'.repeat(50_001)}</text>`);
    for (const source of [repeated, marker, chain, path, text]) {
        const result = await page.evaluate((source) => window.svgTest.mount(source, '過剰な図'), source);
        expect(result.ok).toBe(false);
        await expect(page.locator('#fixture svg')).toHaveCount(0);
    }
});

test('単位付き寸法・viewBoxを検証し、小さな安全な入れ子参照を許可する', async ({ page }) => {
    const nested = svg('<defs><g id="a"><circle r="2"/></g><g id="b"><use href="#a"/></g></defs><use href="#b"/>', 'width="120px" height="60px"');
    expect((await page.evaluate((source) => window.svgTest.mount(source, '小さな入れ子'), nested)).ok).toBe(true);
    await expect(page.locator('#fixture svg')).toHaveAttribute('viewBox', '0 0 120 60');
    for (const attributes of ['viewBox="0 0 0 10"', 'viewBox="0 0 -1 10"', 'width="100%" height="100%"', 'viewBox="0 0 1e999 10"']) {
        expect((await page.evaluate((source) => window.svgTest.mount(source, '不正な寸法'), svg('', attributes))).ok).toBe(false);
    }
});

for (const viewport of [{ width: 320, height: 640 }, { width: 1280, height: 800 }]) {
    for (const fontSize of [16, 32]) {
        test(`幅${viewport.width}・文字${fontSize}pxで縦横の図を比率保持して領域内へ収める`, async ({ page }) => {
            await page.setViewportSize(viewport);
            for (const [width, height] of dimensions) {
                const source = svg(`<rect width="${width}" height="${height}" fill="blue"/><text x="2" y="12">A</text>`, `viewBox="0 0 ${width} ${height}"`);
                expect((await page.evaluate(({ source, fontSize }) => window.svgTest.mount(source, '可変サイズの図', fontSize), { source, fontSize })).ok).toBe(true);
                const bounds = await page.evaluate(() => window.svgTest.bounds());
                expect(bounds.width).toBeGreaterThan(0);
                expect(bounds.height).toBeGreaterThan(0);
                expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 0.5);
                expect(bounds.height).toBeLessThanOrEqual(viewport.height * 0.7 + 0.5);
                expect(bounds.scrollWidth).toBeLessThanOrEqual(viewport.width);
                expect(bounds.ratio).toBeCloseTo(width / height, 2);
            }
        });
    }
}

test('実際のRDKit SMILES出力を同じSVG描画経路で領域内へ収める', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 320, height: 640 });
    const result = await page.evaluate(() => window.svgTest.smiles('CC(=O)OC1=CC=CC=C1C(=O)O', 32));
    expect(result, result.detail).toEqual({ ok: true, detail: '' });
    await expect(page.getByRole('img', { name: /^化学構造:/ })).toBeVisible();
    const bounds = await page.evaluate(() => window.svgTest.bounds());
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320.5);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(320);
    expect(bounds.ratio).toBeCloseTo(480 / 280, 2);
});
