/** 乱数状態は呼び出し側が所有し、時刻やグローバル乱数を参照しない。 */
export type RandomState = number;
export type RandomDraw = Readonly<{ state: RandomState; value: number }>;

/** UTF-16のseed文字列から安定した32bit状態を生成する。暗号用途には使用しない。 */
export function seedRandom(seed: string): RandomState {
    let state = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        state = Math.imul(state ^ seed.charCodeAt(index), 16777619) >>> 0;
    }
    return state;
}

/** 次状態と[0,1)の値を返す。更新前の状態は変更しない。 */
export function drawRandom(state: RandomState): RandomDraw {
    const next = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return { state: next, value: next / 4294967296 };
}

/** Inside-out Fisher–Yatesで不変入力を並べ替える。時間O(n)、空間O(n)。 */
export function shuffle<T>(items: ReadonlyArray<T>, initial: RandomState): Readonly<{
    items: ReadonlyArray<T>;
    state: RandomState;
}> {
    let state = initial;
    // 要素を包み、Tそのものがundefinedでも「未存在の添字」と取り違えない。
    const output: { readonly value: T }[] = [];
    for (const item of items) {
        const drawn = drawRandom(state);
        state = drawn.state;
        const index = Math.floor(drawn.value * (output.length + 1));
        const previous = output.at(index);
        if (previous === undefined) output.push({ value: item });
        else {
            output.push(previous);
            output[index] = { value: item };
        }
    }
    return { items: output.map((entry) => entry.value), state };
}
