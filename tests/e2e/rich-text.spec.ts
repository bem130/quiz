import { expect, test } from '@playwright/test';

for (const width of [320, 1280]) for (const fontSize of [16, 32]) {
    test(`ruby/anno baseline・注記配置・収集を保つ ${width}px ${fontSize}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto('tests/e2e/rich-text.html');
        await page.locator('#collector').waitFor();
        await page.evaluate(size => { document.body.style.fontSize = `${size}px`; }, fontSize);
        await page.evaluate(async () => { await document.fonts.ready; });
        const baselines = await page.locator('#baseline p').evaluateAll(rows => rows.map(row => {
            const reference = row.querySelector('.baseline-marker');
            if (!(reference instanceof HTMLElement)) throw new Error('No baseline marker');
            const bases = Array.from(row.querySelectorAll('rb,.gloss-base')).filter(base => !base.querySelector('rb,.gloss-base'));
            if (!bases.length) {
                const math = row.querySelector('.math'); if (math) bases.push(math);
            }
            const coordinates = bases.map(base => {
                const marker = document.createElement('i');
                marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
                base.append(marker); const y = marker.getBoundingClientRect().top; marker.remove(); return y;
            });
            return { reference: reference.getBoundingClientRect().top, coordinates };
        }));
        for (const row of baselines) for (const y of row.coordinates) expect(Math.abs(y - row.reference)).toBeLessThanOrEqual(1);
        const collected = await page.locator('#collector').getAttribute('data-collected');
        expect(JSON.parse(collected ?? 'null')).toEqual([{ base: '漢字', reading: 'かんじ' }, { base: '漢', reading: 'かん' }, { base: '語', reading: 'ご' }]);
        await expect(page.locator('#svg-alt')).toContainText('図 意味 (meaning)（図を表示できない');
        await expect(page.locator('#svg-alt')).not.toContainText('[図/ず]');
        await expect(page.locator('#svg-escaped-alt svg')).toHaveAttribute('aria-label', '[図/ず]');
        const mathGap = await page.locator('[data-sample=math] .gloss').evaluate(gloss => {
            const base = gloss.querySelector('.gloss-base'); const notes = gloss.querySelector('.gloss-notes');
            if (!base || !notes) throw new Error('No math annotation');
            return notes.getBoundingClientRect().top - base.getBoundingClientRect().bottom;
        });
        expect(mathGap).toBeLessThan(fontSize * .65);
        const lineOverlap = await page.locator('[data-sample=wrapping]').evaluate(paragraph => {
            const baseRects: Readonly<{ text: string; rect: DOMRect; parent: Element | null }>[] = []; const noteRects: Readonly<{ text: string; rect: DOMRect; parent: Element | null }>[] = [];
            const canvas = document.createElement('canvas').getContext('2d');
            if (!canvas) throw new Error('No font measurement context');
            const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!node.textContent?.trim()) continue;
                const range = document.createRange(); range.selectNodeContents(node);
                const destination = node.parentElement?.closest('rt,.gloss-alts') ? noteRects : baseRects;
                const style = getComputedStyle(node.parentElement ?? paragraph);
                canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const ink = canvas.measureText(node.textContent ?? '');
                destination.push(...Array.from(range.getClientRects(), rect => ({ text: node.textContent ?? '', parent: node.parentElement,
                    rect: new DOMRect(rect.x, rect.y + ink.fontBoundingBoxAscent - ink.actualBoundingBoxAscent, rect.width, ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent) })));
            }
            let overlap = 0;
            let pair = '';
            for (const noteItem of noteRects) for (const baseItem of baseRects) {
                // Native ruby's fallback-font range includes leading around its own base.
                // Measure collisions with other text, rather than treating that leading as ink.
                const ownRuby = noteItem.parent?.closest('ruby');
                if (ownRuby && baseItem.parent && ownRuby.contains(baseItem.parent)) continue;
                const note = noteItem.rect; const base = baseItem.rect;
                const height = Math.min(note.bottom, base.bottom) - Math.max(note.top, base.top);
                if (Math.min(note.right, base.right) - Math.max(note.left, base.left) > 1 && height > overlap) { overlap = height; pair = JSON.stringify({ note: noteItem, base: baseItem }); }
            }
            return { overlap, pair };
        });
        expect(lineOverlap.overlap, lineOverlap.pair).toBeLessThanOrEqual(1);
        for (const parentWidth of [160, 260]) {
          for (const sample of ['long', 'long-base']) {
            const box = page.locator(`[data-sample=${sample}]`);
            await box.evaluate((element, available) => { element.style.width = `${available}px`; element.style.maxWidth = '100%'; }, parentWidth);
            const metrics = await box.evaluate(element => {
                const base = element.querySelector('.gloss-base'); const notes = element.querySelector('.gloss-notes');
                if (!base || !notes) throw new Error('Missing long annotation');
                const bounds = element.getBoundingClientRect(); const note = notes.getBoundingClientRect();
                return { left: note.left - bounds.left, right: bounds.right - note.right, width: note.width, overlap: base.getBoundingClientRect().bottom - note.top, scroll: element.scrollWidth - element.clientWidth };
            });
            expect(metrics.left).toBeGreaterThanOrEqual(-1); expect(metrics.right).toBeGreaterThanOrEqual(-1);
            expect(metrics.width).toBeGreaterThan(sample === 'long' ? 50 : 20); expect(metrics.scroll).toBeLessThanOrEqual(1);
            // Text rectangles include descender leading; visible bases and notes do not intersect.
            expect(metrics.overlap).toBeLessThanOrEqual(fontSize * .2);
            if (sample === 'long-base') {
                const difference = await box.evaluate(element => {
                    const base = element.querySelector('.gloss-base'); if (!base) throw new Error('Missing base');
                    const marker = (): HTMLElement => { const point = document.createElement('i'); point.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;'; return point; };
                    const outer = marker(); const inner = marker(); element.prepend(outer); base.prepend(inner);
                    const difference = inner.getBoundingClientRect().top - outer.getBoundingClientRect().top;
                    inner.remove(); outer.remove(); return difference;
                });
                expect(Math.abs(difference)).toBeLessThanOrEqual(1);
            }
          }
        }
        for (const availableWidth of [160, 260, 320]) {
            for (const context of await page.locator('[data-context]').all()) {
                await context.evaluate((element, available) => { element.style.width = `${available}px`; element.style.maxWidth = '100%'; }, availableWidth);
                const metrics = await context.evaluate(element => {
                    const available = element.querySelector('[data-available]'); const notes = element.querySelector('.gloss-notes');
                    if (!(available instanceof HTMLElement) || !notes) throw new Error('Missing app context');
                    const bounds = available.getBoundingClientRect(); const note = notes.getBoundingClientRect(); const style = getComputedStyle(available);
                    return { left: note.left - bounds.left - parseFloat(style.paddingLeft), right: bounds.right - parseFloat(style.paddingRight) - note.right, width: note.width };
                });
                expect(metrics.left).toBeGreaterThanOrEqual(-1); expect(metrics.right).toBeGreaterThanOrEqual(-1); expect(metrics.width).toBeGreaterThan(20);
            }
        }
        const screenshot = info.outputPath('rich-text-layout.png');
        await page.screenshot({ path: screenshot, fullPage: true });
        await info.attach('rich-text-layout', { path: screenshot, contentType: 'image/png' });
        await info.attach('baseline-measurements', { body: JSON.stringify({ baselines, mathGap, lineOverlap }), contentType: 'application/json' });
    });
}
