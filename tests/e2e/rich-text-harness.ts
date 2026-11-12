import '../../src/web/app.css';
import { richText, renderTokens } from '../../src/web/content.ts';
import { rubyItems } from '../../src/web/source-tools.ts';

const host = document.querySelector('#samples');
if (!(host instanceof HTMLElement)) throw new Error('Missing rich text host');
document.body.style.cssText = 'margin:12px;font-family:Arial,"Noto Sans",sans-serif;line-height:1.6;color:#14202c;background:white;';
const examples = [
    ['simple', 'plain [漢字/かんじ] {訳語/translation} plain'],
    ['nested', 'plain {[漢字/かんじ]/meaning} plain'],
    ['reverse', 'plain [{漢字/meaning}/かんじ] plain'],
    ['nested-readings', 'plain [[漢/かん]字/かんじ] plain'],
    ['math', 'plain {$x^2$/$y^2$} $a+b$ [変数/へんすう] plain'],
    ['languages', 'plain {言葉/English/Deutsch/العربية} [漢字/かんじ] plain'],
    ['long', 'plain {語/long annotation that needs sufficient horizontal space} plain'],
    ['long-base', '{a long base that wraps across several lines/short note} plain'],
    ['wrapping', '通常の本文 {[漢字/かんじ]/translation} と {用語/terminology} を交互に含む文章。隣の行の本文に上側と下側の注記が重ならず、読みやすさを保つ。'.repeat(4)]
];
for (const [name, text] of examples) {
    if (name === undefined || text === undefined) throw new Error('Invalid rich text fixture');
    const paragraph = document.createElement('p'); paragraph.dataset['sample'] = name; paragraph.className = 'rich-text-container';
    paragraph.append(richText(text)); host.append(paragraph);
}
const token = document.createElement('p'); token.dataset['sample'] = 'token';
token.append(document.createTextNode('plain '), renderTokens([{ type: 'ruby', base: ['漢字'], ruby: ['かんじ'], styles: [] }]), document.createTextNode(' plain'));
host.append(token);
const baseline = document.createElement('section'); baseline.id = 'baseline';
for (const text of ['A', '[漢字/かんじ]', '{漢字/meaning}', '{[漢字/かんじ]/meaning}', '[{漢字/meaning}/かんじ]', '$x^2$', '{$x^2$/$y^2$}']) {
    const row = document.createElement('p');
    const marker = document.createElement('i'); marker.className = 'baseline-marker';
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
    row.append(marker, document.createTextNode('A '), richText(text), document.createTextNode(' A'));
    baseline.append(row);
}
host.append(baseline);
const nested = document.createElement('div'); nested.id = 'collector';
nested.append(richText('[[漢/かん]字/かんじ] {[語/ご]/meaning} {訳/translation}'));
const source = { source: 'fixture', packageId: 'package', questionId: 'question', rowId: 'row', patternId: 'pattern', jsonPath: '$' };
nested.dataset['collected'] = JSON.stringify(rubyItems(nested, source).map(({ base, reading }) => ({ base, reading })));
host.append(nested);
const alt = document.createElement('div'); alt.id = 'svg-alt';
alt.append(renderTokens([{ type: 'svg', source: { kind: 'inline', value: '<script>invalid</script>' }, alt: '[図/ず] {意味/meaning}', styles: [] }]));
host.append(alt);
const escapedAlt = document.createElement('div'); escapedAlt.id = 'svg-escaped-alt';
escapedAlt.append(renderTokens([{ type: 'svg', source: { kind: 'inline', value: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>' }, alt: '\\[図/ず]', styles: [] }]));
host.append(escapedAlt);
for (const kind of ['panel', 'pattern-choice', 'draft-preview']) {
    const context = document.createElement(kind === 'pattern-choice' ? 'label' : 'div');
    context.className = kind; context.dataset['context'] = kind;
    const content = document.createElement(kind === 'panel' ? 'h2' : kind === 'pattern-choice' ? 'span' : 'div');
    content.dataset['available'] = 'true';
    if (kind === 'draft-preview') { content.className = 'draft-pattern'; content.style.padding = '16px'; }
    if (kind === 'pattern-choice') { const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; context.append(checkbox); }
    content.append(richText('{語/long annotation with multiple words that must fit the available content width}'));
    context.append(content); host.append(context);
}

// Answer definitions can be used independently of inline blanks.
import { none, some } from '../../src/core/result.ts';
import type { HideToken, Row } from '../../src/core/model.ts';
const answerRow: Row = { id: 'answer', conceptId: none, fields: {} };
for (const display of ['inline', 'none'] as const) for (const answered of [false, true]) {
    const sample = document.createElement('p');
    sample.dataset['sample'] = `${display}-${answered ? 'answered' : 'pending'}`;
    const hide: HideToken = { type: 'hide', id: 'answer', display, value: ['黄色'], answer: { mode: 'choice_from_entities', groupField: none }, styles: [] };
    sample.append(renderTokens(['呈色は', hide, '。'], answerRow, {
        baseUrl: location.href,
        answer: answered ? some({ tokens: ['黄色'], row: answerRow }) : none,
        isCurrent: () => true
    }));
    host.append(sample);
}
