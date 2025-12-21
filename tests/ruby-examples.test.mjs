import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseContentToSegments } from '../js/ruby-parser.js';

function countSegments(segments, kind) {
    return (segments || []).filter((segment) => segment.kind === kind).length;
}

function getGlossSegments(segments) {
    return (segments || []).filter((segment) => segment.kind === 'Gloss');
}

function glossAltHasRuby(gloss) {
    return (gloss.glosses || []).some((alt) =>
        (alt || []).some((segment) => segment.kind === 'Annotated')
    );
}

test('ruby.md: basic ruby example parses ruby blocks', () => {
    const input = '[私/わたし]は[漢字/かんじ][仮名/かな][交/ま]じりの[文/ぶん]を[書/か]く';
    const segments = parseContentToSegments(input);
    assert.equal(countSegments(segments, 'Gloss'), 0);
    assert.equal(countSegments(segments, 'Annotated'), 6);
});

test('ruby.md: gloss examples parse gloss blocks and ruby outside', () => {
    const input = '{[微分/びぶん][係数/けいすう]/derivative}は{[接線/せっせん]/tangent}の[傾/かたむ]きを[表/あらわ]す';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 2);
    assert.equal(countSegments(segments, 'Annotated'), 2);
});

test('ruby.md: gloss example with mixed base text parses multiple glosses', () => {
    const input = '{カルボン[酸/さん]/carboxylic acid}は{[弱酸/じゃくさん]/weak acid}として{[水溶液/すいようえき]/aqueous solution}で{[電離/でんり]/ionize}しやすい。';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 4);
    glosses.forEach((gloss) => {
        assert.ok(gloss.base && gloss.base.length > 0);
        assert.ok(gloss.glosses && gloss.glosses.length >= 1);
    });
});

test('ruby.md: gloss with ruby in alt parses alternate ruby', () => {
    const input = '{[台湾/たいわん]/[台灣/Táiwān]}に[行/い]く';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 1);
    assert.ok(glossAltHasRuby(glosses[0]));
    assert.equal(countSegments(segments, 'Annotated'), 1);
});

test('ruby.md: gloss with non-ruby alternates parses correctly', () => {
    const input = '[来年/らいねん]、{アテネ/Αθήνα}を[訪/おとず]れる[予定/よてい]だ';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 1);
    assert.equal(countSegments(segments, 'Annotated'), 3);
});

test('ruby.md: gloss with long alt text parses correctly', () => {
    const input = '{トルストイ/Лев Николаевич Толстой}の[小説/しょうせつ]を読む';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 1);
    assert.equal(countSegments(segments, 'Annotated'), 1);
});

test('ruby.md: english sentence with two gloss blocks parses', () => {
    const input = 'Next spring, I want to visit {Firenze/Florence} and {Athens/Αθήνα}.';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 2);
    assert.equal(countSegments(segments, 'Annotated'), 0);
});

test('ruby.md: english sentence with ruby alternates parses', () => {
    const input = 'I would like to visit {Nara/[奈良/なら]} and {Kyoto/[京都/きょうと]}.';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 2);
    glosses.forEach((gloss) => assert.ok(glossAltHasRuby(gloss)));
});

test('ruby.md: chinese sentence with multiple alternates parses', () => {
    const input = '我明年想去{佛罗伦萨/Firenze/Florence}和{雅典/Αθήνα/Athens}旅行。';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 2);
    assert.equal(glosses[0].glosses.length, 2);
    assert.equal(glosses[1].glosses.length, 2);
});

test('ruby.md: chinese sentence with single alternate parses', () => {
    const input = '我最近在读{维特根斯坦/Wittgenstein}的书。';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 1);
    assert.equal(glosses[0].glosses.length, 1);
});

test('ruby.md: chinese ruby example parses multiple ruby blocks', () => {
    const input = '[我/wǒ][在/zài][学/xué][校/xiào][学/xué][习/xí][汉/hàn][语/yǔ]。';
    const segments = parseContentToSegments(input);
    assert.equal(countSegments(segments, 'Gloss'), 0);
    assert.equal(countSegments(segments, 'Annotated'), 8);
});

test('ruby.md: chinese ruby example with more blocks parses', () => {
    const input = '[明/míng][年/nián][我/wǒ][想/xiǎng][去/qù][台/tái][湾/wān][旅/lǚ][行/xíng]。';
    const segments = parseContentToSegments(input);
    assert.equal(countSegments(segments, 'Gloss'), 0);
    assert.equal(countSegments(segments, 'Annotated'), 9);
});

test('ruby.md: greek sentence with gloss parses', () => {
    const input = 'Μελετάμε {Βιτγκενστάιν/Wittgenstein} στη φιλοσοφία';
    const segments = parseContentToSegments(input);
    const glosses = getGlossSegments(segments);
    assert.equal(glosses.length, 1);
});

test('ruby.md: math example keeps math segments intact', () => {
    const input = '[地表/ちひょう][付近/ふきん]に[多/おお]く[含/ふく]まれる[元素/げんそ]に[酸素/さんそ]$\\mathrm{O_2}$・[珪素/けいそ]$\\mathrm{Si}$・[アルミニウム/アルミニウム]$\\mathrm{Al}$・[鉄/てつ]$\\mathrm{Fe}$がある';
    const segments = parseContentToSegments(input);
    assert.equal(countSegments(segments, 'Gloss'), 0);
    assert.equal(countSegments(segments, 'Math'), 4);
    assert.ok(countSegments(segments, 'Annotated') > 0);
});
