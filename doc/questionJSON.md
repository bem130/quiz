# 4択クイズ問題ファイルの仕様

## 0. 目的と前提

この仕様は、 **4択クイズ用 JSON 問題ファイル** のフォーマットです。

* 1つの JSON ファイル = 1つのクイズセット
* 出題対象データ（エンティティ）と、問題文テンプレート（パターン）、出題モードをまとめて定義
* 選択肢は基本的に **4択** を想定（正解1 + 誤答3）。

---

## 1. トップレベル構造

```jsonc
{
    "id": "alpha-amino-acid-quiz-v1",
    "title": "Alpha Amino Acid Quiz",
    "description": "Quiz to learn the correspondence between amino acid names and side chains",
    "version": 1,

    "color": 130,

    "entitySet": { ... },
    "questionRules": { ... }
}
```

### 1.1 各フィールド

* `id: string`
  この問題ファイル自体の一意なID。

* `title: string`
  クイズタイトル。

* `description: string`
  クイズの説明。

* `version: number`
  ファイルのバージョン。

* `color: number`
  UI テーマ用の **色相 (hue)**。

  * 0〜359 の整数。
  * 0=red, 120=green, 240=blue … のように使用。
  * ダーク/ライト切替はアプリ側で行うので、ここでは指定しない。

* `entitySet: EntitySet`
  クイズの出題対象となるデータ集合。

* `questionRules: QuestionRules`
  パターン（問題テンプレート）とモード（出題比率）の定義。

---

## 2. EntitySet（出題対象データ）

### 2.1 構造

```jsonc
"entitySet": {
    "id": "alpha-amino-acids",
    "entities": {
        "gly": {
            "nameEnCap": "Glycine",
            "nameEn": "glycine",
            "nameJa": "グリシン",
            "sideChainFormula": "-H",
            "sideChainFormulaTex": "\\ce{-H}"
        },
        "ala": {
            "nameEnCap": "Alanine",
            "nameEn": "alanine",
            "nameJa": "アラニン",
            "sideChainFormula": "-CH3",
            "sideChainFormulaTex": "\\ce{-CH_3}"
        }
        // ...
    }
}
```

### 2.2 仕様

* `id: string`
  この entitySet の ID（任意の文字列）。

* `entities: { [entityId: string]: EntityFields }`

  * **キー（オブジェクトのプロパティ名）が entityId**
    例: `"gly"`, `"ala"` など
  * その中身が、フィールド集合（任意のキー・値）
  * 別途 `targetEntityIds` は **不要**。
    出題対象は `entities` のキーを使って決定する。

#### EntityFields の例（アミノ酸の場合）

```json
"gly": {
    "nameEnCap": "Glycine",
    "nameEn": "glycine",
    "nameJa": "グリシン",
    "sideChainFormula": "-H",
    "sideChainFormulaTex": "-H"
}
```

* ここにどんなフィールドを持たせるかは **完全に自由**。
* 日本語名と英語名の組み合わせも **後述の tokens（パターン）側で組み立てる** ので、
  entity 側は「部品」として持っていれば良い。

---

## 3. QuestionRules（出題ルール）

```jsonc
"questionRules": {
    "patterns": [ /* Pattern */ ],
    "modes":    [ /* Mode */ ]
}
```

* `patterns: Pattern[]`
  問題文のテンプレートセット。

* `modes: Mode[]`
  **どの pattern を何割の確率で出すか** を決める出題モード。
  （ユーザーがメニューから選ぶ "mode"）

---

## 4. Pattern（問題テンプレート）

### 4.1 構造

```jsonc
{
    "id": "p_rgroup_to_name_ruby_choice",
    "label": "R group → name (ruby choice)",
    "tokens": [ /* Token */ ]
}
```

* `id: string`
  パターンID（一意）。

* `label: string`
  UI用ラベル。

* `tokens: Token[]`
  このパターンの問題文を構成する **Token** の配列。
  Token は後述の `type` によって、文字列・フィールド参照・穴埋め・ルビなどになる。

### 4.2 Pattern への Tips 追加仕様

Pattern には、既存の `tokens` に加えて **回答後に表示する Tips（解説）** を記述できる `tips` プロパティを追加します。

#### 4.2.1 Pattern における `tips` の位置づけ

```jsonc
{
    "id": "p_rgroup_to_name_ruby_choice",
    "label": "R group → name (ruby choice)",
    "tokens": [ /* Token[]（従来通り） */ ],

    "tips": [ /* TipBlock[]（★新規） */ ]
}
```

* `tokens`: 従来どおり、問題本文を構成する Token 配列。
* `tips`: 回答後（正誤判定後）に表示される Tips を定義する配列。

#### 4.2.2 TipBlock の構造

```jsonc
{
    "id": "t_example",
    "when": "always",        // "always" | "correct" | "incorrect"（省略可）
    "tokens": [ /* Token[]（表示専用） */ ]
}
```

* `id: string`
  Pattern 内で一意であればよい。UI には表示しない（ロギング・デバッグ用）。

* `when: "always" | "correct" | "incorrect"`（省略可）

  Tips の表示条件を指定する：

  | 値             | 意味                      |
  | ------------- | ----------------------- |
  | `"always"`    | 正解・不正解にかかわらず常に表示（デフォルト） |
  | `"correct"`   | 正解時のみ表示                 |
  | `"incorrect"` | 不正解時のみ表示                |

  省略時は `"always"` とみなす。

* `tokens: Token[]`
  Tips の表示内容を構成する Token 配列。

  * 既存の Token 仕様（`text`, `key`, `ruby`, `hideruby`, `hide` など）をそのまま使用可能
  * Tips は **表示専用** であるため、Token に `answer` を書いても採点には使われない
  * 実務上は `text` / `key` / `ruby` / `hideruby` などの「表示専用」Token を使うことを推奨

#### 4.2.3 Tips の表示ルール（アプリ側想定）

1. ユーザーが回答を行い、正誤判定（`isCorrect: boolean`）を行う。
2. 現在の Pattern の `tips` 配列を走査し、各 TipBlock について次の条件で表示可否を判定する。

```ts
shouldShowTip = (
    tip.when === 'always' ||
    (tip.when === 'correct' && isCorrect) ||
    (tip.when === 'incorrect' && !isCorrect)
);
```

3. `shouldShowTip` が `true` の TipBlock について、その `tokens` を問題本文と同じロジックでレンダリングする（`key` などは同じ entity を参照）。
4. Tips の表示位置は、例えば以下のように UI 側で決める：

   * 正誤ハイライトの直下
   * 間違いノート（復習画面）で再表示

#### 4.2.4 Tips の利用例

```jsonc
"tips": [
  {
    "id": "t_incorrect_polar",
    "when": "incorrect",
    "tokens": [
      {
        "type": "text",
        "value": "This amino acid has a polar uncharged side chain.",
        "styles": []
      }
    ]
  },
  {
    "id": "t_name_ruby",
    "when": "always",
    "tokens": [
      {
        "type": "ruby",
        "base": { "source": "key", "field": "nameEnCap", "styles": ["bold"] },
        "ruby": { "source": "key", "field": "nameJa" }
      }
    ]
  }
]
```

---

## 5. Mode（出題モード & pattern比率）

ユーザーが UI で選択する「モード」を定義する。

```jsonc
"modes": [
    {
        "id": "default",
        "label": "Default mix",
        "description": "30% pattern1, 70% pattern2",
        "patternWeights": [
            { "patternId": "p_name_to_r_fill",      "weight": 3 },
            { "patternId": "p_rgroup_to_name_ruby", "weight": 7 }
        ]
    },
    {
        "id": "fill_heavy",
        "label": "Fill-heavy",
        "description": "80% fill, 20% choice",
        "patternWeights": [
            { "patternId": "p_name_to_r_fill",      "weight": 8 },
            { "patternId": "p_rgroup_to_name_ruby", "weight": 2 }
        ]
    }
]
```

* `id: string`
  モードID（ユーザーがメニューで選ぶ値）。

* `label: string`
  モード名。

* `description: string`
  説明（任意）。

* `patternWeights: { patternId: string; weight: number; }[]`

  * どの pattern をどのくらいの割合で出題するか。
  * `weight` の合計を正規化して、出題確率に使う。
    例：3 と 7 → 3/(3+7)=30%、7/(3+7)=70%。

---

## 6. Token（問題文の最小単位）

**Token** は問題文の中の最小要素です。

### 6.1 共通プロパティ

```jsonc
{
    "type": "text" | "key" | "hide" | "ruby" | "hideruby",
    "styles": ["bold", "italic", "serif", "sans", "katex"]
}
```

* `type`
  Token の種類（詳細は後述）。

* `styles?: string[]`（任意）

  * `"bold"`   : 太字
  * `"italic"` : 斜体
  * `"serif"`  : セリフ体フォント
  * `"sans"`   : サンセリフ体フォント
  * `"katex"`  : 数式レンダリングを **KaTeX** で行う

レンダリング順の推奨：

1. `value` / `entity[field]` から文字列取得
2. `"katex"` があれば TeX 文字列として KaTeX で描画
3. その結果に対して `"bold"` / `"italic"` / `"serif"` / `"sans"` を適用

---

### 6.2 type: "text"

```jsonc
{
    "type": "text",
    "value": "アミノ酸",
    "styles": ["bold"]
}
```

* `value: string`
  固定テキストを表示。

---

### 6.3 type: "key"

```jsonc
{
    "type": "key",
    "field": "nameEnCap",
    "styles": ["bold"]
}
```

* `field: string`
  `entitySet.entities[entityId][field]` を表示。
  例: `"nameEnCap"`, `"nameJa"`, `"sideChainFormula"` など。

---

### 6.4 type: "hide"（穴埋め）

```jsonc
{
    "type": "hide",
    "id": "answer_sidechain",
    "field": "sideChainFormula",
    "styles": ["katex"],
    "answer": {
        "mode": "fill_in_blank"
    }
}
```

* `field: string`
  正解の値となるフィールド名。

* `id?: string`
  この hide トークンの識別子（複数ある場合に便利）。

* `answer?: HideAnswer`
  この hide を **解答としてどう扱うか** の指定。

#### 6.4.1 HideAnswer

```jsonc
"answer": {
    "mode": "fill_in_blank"
}
```

* `mode: "fill_in_blank"`
  このトークンはユーザー入力（穴埋め）として採点される。
  正解は `entity[field]` の文字列。

※ 将来、複数 hide をまとめて扱うときは
`mode: "fill_in_blanks"` + グループIDなどを追加して拡張可能。

---

### 6.5 type: "ruby"（表示専用ルビ）

**Ruby notation**（英語 ruby, 小さな注釈文字）は、英語名（base）と日本語名（ruby）を上下に並べて表示するために使う。

```jsonc
{
    "type": "ruby",
    "base": {
        "source": "key",
        "field": "nameEnCap",
        "styles": ["sans", "bold"]
    },
    "ruby": {
        "source": "key",
        "field": "nameJa",
        "styles": ["sans"]
    }
}
```

* `base`

  * 下側のメインテキスト（例: 英語名）。
  * `source: "key"` or `"text"`

    * `"key"` → `entity[field]` を使う
    * `"text"` → `value` を使う

* `ruby`

  * 上側の小さいテキスト（例: 日本語名）。
  * `source` / `field` / `value` の扱いは `base` と同じ。

* `ruby` トークンは **表示専用**（採点に直接は使わない）。

---

### 6.6 type: "hideruby"（選択肢用ルビ + 回答）

`hideruby` は、

> base と ruby を両方ボタンに表示し、
> **base+ruby の組**を解答とする

ためのトークン。

```jsonc
{
    "type": "hideruby",
    "id": "answer_name",
    "base": {
        "source": "key",
        "field": "nameEnCap",
        "styles": ["sans", "bold"]
    },
    "ruby": {
        "source": "key",
        "field": "nameJa",
        "styles": ["sans"]
    },
    "answer": {
        "mode": "choice_ruby_pair",
        "choice": {
            "distractorSource": {
                "from": "entitySet",
                "filter": "same_entity_type",
                "count": 3,
                "avoidSameId": true,
                "avoidSameText": true
            }
        }
    }
}
```

* `id: string`
  この hideruby トークンを識別するためのID。

* `base` / `ruby`

  * `ruby` トークンと同じ形式。
  * base（英語名など）と ruby（日本語名など）は **1対1のペア**。

* `answer: HideRubyAnswer`
  このトークンを解答としてどう扱うか。

#### 6.6.1 HideRubyAnswer（4択用）

```jsonc
"answer": {
    "mode": "choice_ruby_pair",
    "choice": {
        "distractorSource": {
            "from": "entitySet",
            "filter": "same_entity_type",
            "count": 3,
            "avoidSameId": true,
            "avoidSameText": true
        }
    }
}
```

* `mode: "choice_ruby_pair"`

  * **4択クイズ** の選択肢を「base + ruby のペア」として表示・採点するモード。
  * すべての選択肢ボタンに
    `<ruby><rb>base</rb><rt>ruby</rt></ruby>` のイメージで表示。

* 正解ペア：

  * この `hideruby` トークンが指している entity から
    `base.field` と `ruby.field` の値を取得したペア。

* 選択肢生成 (`choice.distractorSource`)：

  * `from: "entitySet"`
    ダミー候補は `entitySet.entities` から取る。

  * `filter: "same_entity_type"`
    同じ種類のエンティティに絞るためのフィルタ（実装側ルール）。

  * `count: 3`
    誤答（ダミー）をいくつ作るか。
    → 正解1 + 誤答3 = 4択。

  * `avoidSameId: true`
    正解と同じ `entityId` をダミーに含めない。

  * `avoidSameText: true`
    **表示テキストが正解と同じになるダミー** を除外する。
    別フィールドでも、`baseText + "|" + rubyText` などで正規化した結果が同じなら除外する。

---

## 7. パターン例（hide と hideruby の混在）

```jsonc
{
    "id": "p_combo_fill_and_ruby_choice",
    "label": "R group fill + name choice",
    "tokens": [
        { "type": "text", "value": "アミノ酸 " },
        { "type": "key",  "field": "nameEnCap", "styles": ["bold"] },
        { "type": "text", "value": " の側鎖 R は " },
        {
            "type": "hide",
            "id": "answer_sidechain",
            "field": "sideChainFormulaTex",
            "styles": ["katex"],
            "answer": {
                "mode": "fill_in_blank"
            }
        },
        { "type": "text", "value": " である。このとき、正しい名称を選びなさい：" },
        {
            "type": "hideruby",
            "id": "answer_name",
            "base": {
                "source": "key",
                "field": "nameEnCap",
                "styles": ["sans", "bold"]
            },
            "ruby": {
                "source": "key",
                "field": "nameJa",
                "styles": ["sans"]
            },
            "answer": {
                "mode": "choice_ruby_pair",
                "choice": {
                    "distractorSource": {
                        "from": "entitySet",
                        "filter": "same_entity_type",
                        "count": 3,
                        "avoidSameId": true,
                        "avoidSameText": true
                    }
                }
            }
        }
    ]
}
```

* 1つの問題で：

  * `hide` → R基を穴埋め（入力式）
  * `hideruby` → 英語＋日本語ルビを4択で選択
* 採点ロジック側は、tokens を走査し、`answer` を持っている token ごとに `mode` に応じて判定を行う。

---

## 8. まとめ

この **4択クイズ問題ファイルの仕様** では：

* トップレベルでクイズセットを定義し、
* `entitySet.entities` を **オブジェクトマップ（id → fields）** で持ち、
* `questionRules.patterns` で Token ベースの問題テンプレートを記述、
* `questionRules.modes` で「patternの出題比率」を mode ごとに設定します。

Token は、

* `"text"`, `"key"` で表示文字列を作り、
* `"hide"` で穴埋め問題を作り、
* `"ruby"` で英語名＋日本語名などのルビ表示を行い、
* `"hideruby"` と `answer.mode: "choice_ruby_pair"` で
  **base+ruby ペアを使った4択問題** を構成します。

さらに本仕様では、Pattern に `tips: TipBlock[]` を追加することで：

* 「間違えたときだけ詳しい解説」
* 「正解でも必ず一言メモ」

といった形で、正誤に応じた柔軟な Tips 表示が可能になります。

`avoidSameId` と `avoidSameText` によって、同一IDや同一表示テキストの誤答を避けることもできます。

この枠組みの中で、アミノ酸以外の分野（化合物、英単語、歴史人物など）も、entity の fields と patterns を差し替えるだけで同じエンジンを使って 4択クイズ化できます。
