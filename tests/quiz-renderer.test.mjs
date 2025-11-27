import test from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
    constructor() {
        this.set = new Set();
    }

    add(...names) {
        names.forEach((name) => this.set.add(name));
    }

    remove(...names) {
        names.forEach((name) => this.set.delete(name));
    }

    contains(name) {
        return this.set.has(name);
    }
}

class FakeElement {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.classList = new FakeClassList();
        this.dataset = {};
        this._className = '';
        this.textContent = '';
        this._innerHTML = '';
    }

    set className(value) {
        this._className = value;
        const names = (value || '').split(/\s+/).filter(Boolean);
        this.classList = new FakeClassList();
        this.classList.add(...names);
    }

    get className() {
        return this._className;
    }

    set innerHTML(value) {
        this._innerHTML = value;
        if (value === '') {
            this.children = [];
        }
    }

    get innerHTML() {
        return this._innerHTML;
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }
}

class FakeDocument {
    constructor() {
        this.elements = new Map();
    }

    createElement(tag) {
        return new FakeElement(tag);
    }

    getElementById(id) {
        if (!this.elements.has(id)) {
            const el = new FakeElement();
            el.id = id;
            this.elements.set(id, el);
        }
        return this.elements.get(id);
    }
}

globalThis.document = new FakeDocument();
globalThis.window = {};

const renderer = await import('../js/quiz-renderer.js');
const { renderTips, resetTips } = renderer;

function collectText(el) {
    const ownText = el.textContent ? [el.textContent] : [];
    const childTexts = el.children.flatMap((child) => collectText(child));
    return [...ownText, ...childTexts].filter(Boolean);
}

test('resetTips clears the tips container without toggling visibility', () => {
    const tipContainer = document.getElementById('tip-container');
    tipContainer.innerHTML = '<div>old</div>';
    tipContainer.classList.add('hidden');

    const initialHiddenState = tipContainer.classList.contains('hidden');

    resetTips();

    assert.equal(tipContainer.innerHTML, '');
    assert.equal(
        tipContainer.classList.contains('hidden'),
        initialHiddenState
    );
});

test('renderTips renders only visible tip blocks with entity data', () => {
    const tipContainer = document.getElementById('tip-container');
    resetTips();
    tipContainer.classList.remove('hidden');
    const tips = [
        { id: 't_always', tokens: [{ type: 'text', value: 'Always show' }] },
        {
            id: 't_correct',
            when: 'correct',
            tokens: [{ type: 'key', field: 'name', styles: ['bold'] }]
        },
        {
            id: 't_incorrect',
            when: 'incorrect',
            tokens: [{ type: 'text', value: 'Wrong answer' }]
        }
    ];
    const entity = { name: 'Visible Name' };

    renderTips(tips, entity, true);

    assert.ok(!tipContainer.classList.contains('hidden'));
    assert.equal(tipContainer.children.length, 3);

    const visibleRows = tipContainer.children.slice(1);
    const visibleTexts = visibleRows.flatMap((row) => collectText(row));

    assert.ok(visibleTexts.includes('Always show'));
    assert.ok(visibleTexts.includes('Visible Name'));
    assert.ok(!visibleTexts.includes('Wrong answer'));
});

test('renderTips skips rendering when nothing should be shown', () => {
    const tipContainer = document.getElementById('tip-container');
    resetTips();
    tipContainer.classList.remove('hidden');
    const tips = [
        { id: 't_correct', when: 'correct', tokens: [{ type: 'text', value: 'OK' }] }
    ];

    renderTips(tips, {}, false);

    assert.equal(tipContainer.children.length, 0);
    assert.ok(!tipContainer.classList.contains('hidden'));
});
