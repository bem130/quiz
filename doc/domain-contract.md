# Web クイズの規範契約

本書は TypeScript／Web 再構成後の入力・識別子・出題・学習状態の規範を定める。旧実装の挙動と一致しない場合は、本書と各 Issue の完了条件に合わせて修正する。実装全体の追跡は [#38](https://github.com/bem130/quiz/issues/38)、型は [#74](https://github.com/bem130/quiz/issues/74)、外部入力は [#76](https://github.com/bem130/quiz/issues/76) で管理する。

新サイトは新規データで開始する。旧 ID、旧バックアップ、旧共有 URL、旧サイトの保存領域の変換・救済は行わない。ここで定める直列化形式と復元契約は、新サイト自身の今後の保存・復元に適用する。

## 1. 正本と境界

`src/core/model.ts` が検証済み domain 値、`src/core/result.ts` が欠損と失敗、`src/core/identity.ts` が識別子、`src/core/schema.ts` が外部入力と出力の契約を持つ。

外部値は `unknown` として受け取る。JSON の構文、型、参照、一意性を検証してから内部値を作る。入力の可変オブジェクトを内部状態の正本として再利用しない。内部配列とレコードは `readonly` とし、欠損は `Option<T>`、想定内失敗は `Result<T, E>` で表す。

```ts
type Option<T> =
    | Readonly<{ kind: 'some'; value: T }>
    | Readonly<{ kind: 'none' }>;

type Result<T, E> =
    | Readonly<{ ok: true; value: T }>
    | Readonly<{ ok: false; error: E }>;
```

`DomainError` の正本は `kind`、`code`、`path`、`detail` である。`path` は入力上の位置、`detail` は対象フィールドや期待する構造等の文脈を持つ。日本語表示、色、通知方式は表示層が決める。JSON 構文エラーと schema エラーと識別子エラーを区別する。

保存 DTO に DOM、widget、イベント、関数、タイマーを含めない。domain 値と表示用の DOM 参照を同じ問題オブジェクトへ後付けして共有しない。外部 JSON と内部正規化表現も区別する。`quizToJson` または `serializeQuiz` を用いて外部 v3 表現へ戻し、`parseQuiz` または `parseQuizJson` で復元時にも検証する。

## 2. 問題ファイルの検証

問題ファイルは `title`、`description`、`table`、`patterns` を持つ v3 のオブジェクトである。`version` を省略した場合は 3 に正規化し、明示的な 3 以外は拒否する。`title` と `description` は空白だけでない文字列とし、table と patterns は空にしない。

トップレベルと token 等の定義済みレコードで未知のフィールドを拒否する。廃止済みの imports、dataSets、questionRules、modes、choiceCount 等を受理して黙って無視しない。行は任意のフィールド名を持てるが、その値は本書で定める表示可能な値に限る。

### 行と参照

各行の `id` は空白だけでない文字列とし、ファイル内で一意とする。明示的な `conceptId` は任意の非空文字列である。それ以外のフィールドは、文字列、有限数、真偽値、単一 token、`Token[]`、`Token[][]` のいずれかとする。任意の入れ子オブジェクト、null、非有限数、token と matrix を混在させた配列は拒否する。

内部の行は `id`、`conceptId: Option<string>`、`fields` を分ける。`getRowValue` は通常フィールドと `id`・`conceptId` を同じ規則で参照し、欠損は none とする。日本語や `__proto__` 等の名前もデータとして扱い、オブジェクトの prototype を変更させない。

全行について、pattern と tips からの参照を検証する。欠損参照を空文字に置き換えて不完全な問題を作らない。`key` で matrix を参照すること、`listkey` で matrix 以外を参照すること、文字列専用 source で非文字列を参照することは拒否する。行フィールドから別フィールドを経由する直接・間接の参照循環を拒否する。token の入れ子は最大 64 段とし、超過を明示的な失敗にする。

### pattern と hide

pattern の `id` はファイル内で一意とする。省略や重複した ID の自動補正は行わない。label 省略時は id、description 省略時は空文字、tips 省略時は空配列へ正規化する。

一つの pattern の tokens 直下に hide をちょうど一つ置く。複数 hide、hide のない pattern、hide.value・ruby・tips・行フィールドの内部にある hide は拒否する。複数正答は一つの hide と listkey の正答集合として表し、複数の回答欄として扱わない。`multi-answer-v3.json` のサンプルはこの正答集合方式であり、引き続き対象に含む。

hide.value は空でない Token 配列とし、answer.mode は `choice_from_entities` に固定する。選択肢数を入力ファイルで上書きしない。`answer.distractorSource.groupField` は省略可能なフィールド名であり、内部では `Option<string>` とする。参照先のグループ値が存在する場合は文字列・数値・真偽値のいずれかに限る。

### token

| 種別 | 外部入力と内部規則 |
| --- | --- |
| 文字列 | ruby、gloss、数式、改行を含めて保持する。本文の解釈は共通 content 処理を使う。 |
| key | 非空の field を持ち、行の単一値または Token[] を参照する。 |
| listkey | 非空の field で Token[][] を参照する。separatorTokens 省略時は空配列とする。 |
| ruby | base と ruby は文字列・単一 token・Token[] を受け、内部では Token[] へ正規化する。hide を含めない。 |
| katex | value または field をちょうど一つ持つ。内部は literal または field の判別可能 source とする。 |
| smiles | source は katex と同じ規則とする。maxHeightEm、maxHeightPx、zoomPadding は指定時に有限の正数を要求し、内部では Option とする。 |
| svg | value、src、field のちょうど一つと非空 alt を持つ。内部は inline、file、field の判別可能 source とする。XML の許可要素・属性・外部参照・寸法の安全化は Web 境界の別契約で行う。 |
| br / hr | 改行または区切りとして扱う。 |
| hide | 本節で定める一問一欄の制約に従う。 |

styles は省略時に空配列とする。正式な値は bold、italic、sans、serif であり、重複を除く。v3 の拡張用スタイル名は文字列なら無視し、非文字列は拒否する。SVG source の構造が検証済みであっても、安全化済み SVG と見なして DOM へ挿入してはならない。

tips の id は pattern 内で一意とする。when は after_answer、after_correct、after_incorrect のいずれかで、省略時は after_answer とする。tips に hide を置かない。

## 3. entry と source の識別

entry は files 配列を持つ v3 オブジェクトとする。version 省略時は 3、label 省略時は Quiz に正規化する。各 file は非空文字列で、同じ文字列の重複を拒否する。空の files は有効な空一覧として扱い、取得失敗とは区別する。

編集補助の editorBasePath と editorFileMap は任意とする。構造を検証して保持するが、OS 上のパスを Web アプリの任意ファイル読書き権限として扱わない。file URL の解決、HTTP(S) の許可、CORS、認証情報、SVG 等の相対 URL 解決は Web の通信境界で検査する。

remote 題庫の PackageId は、Web 境界で解決・正規化した fragment なしの完全 HTTP(S) URL から作る。ホスト、パス、クエリを含め、同名の相対パスを別出典の同じ題庫と見なさない。draft は別 namespace と安定した草稿 ID から作る。source を相対パスへ戻して保存しない。

識別子は役割別の branded string とする。PackageId、PatternId、RowId、ConceptId、QuestionId を区別し、外部値は対応する parse 関数で検証する。pattern、row、concept は PackageId と局所 ID でスコープする。明示 conceptId が同じでも、異なる PackageId 間で概念を暗黙共有しない。

UserIdとSessionIdも表示名から独立した役割別のbranded stringとする。parseUserId・parseSessionIdは空白だけの入力を拒否し、UUID形式そのものは強制しない。Webでの新規作成にはcrypto.randomUUIDを使う。Revisionはstrict schemaを満たしcanonicalなv3 JSONと一致した文字列のbrandであり、serializeQuizが生成し、外部入力はparseRevisionで検証する。裸のstringをこれらのIDやRevisionとして内部へ渡さない。

キーは次の canonical JSON tuple であり、`::` 等で分割しない。

```text
PackageId  = ["remote", 完全URL] または ["draft", 草稿ID]
PatternId  = ["pattern", PackageId, pattern局所ID]
RowId      = ["row", PackageId, row局所ID]
ConceptId  = ["concept", PackageId, concept局所ID]
QuestionId = ["question", PackageId, pattern局所ID, row局所ID]
```

局所 ID が区切り文字、引用符、日本語を含んでも往復できる。保存 DTO は必要な各 ID を独立したフィールドとして持ち、キーの部分文字列から欠落情報を推測しない。正規の書式でない旧形式キーを互換入力として受理しない。

## 4. 出題と容量

一問の選択肢は正解一つと誤答候補の最大三つとする。異なる候補が足りれば 4 択、二つの誤答なら 3 択、一つなら 2 択へフォールバックする。誤答がゼロの行は出題不能であり、1 択にしない。容量は出題可能な pattern と行の組を数え、単に全行数を加算しない。

誤答候補から正解行、正答集合に含まれる表示、既に選んだ同一表示を除外する。groupField があり正解行に値が存在する場合は、同じグループ値の行も除外する。listkey は集合中のいずれか一つを正答に選び、同じ集合の別要素を誤答にしない。hide の中に複数の展開対象 listkey がある場合は直積を正答集合とする。各行と pattern の hide 展開は最大 1024 通りとし、入力検証で先に計数する。超過時は too-many-variants を返し、任意の候補を切り捨てて受理しない。ruby の注釈は表示用にまとめ、別の回答欄にしない。

表示と候補同一性の文字列化は `src/core/content.ts` と共通の token 解釈を用いる。ruby の読みは本文の代わりに混入させず、gloss と数式は同じ規則で扱う。図の代替テキストだけで異なる図を同一視しない。SVG・SMILES の内容と表示条件を含めた比較規則を使う。

出題範囲はセッション開始時に固定した PackageId と許可 PatternId の集合で決める。新規生成、復習、補修、再挑戦、保存済み候補のいずれも同じ範囲に従う。乱数状態、題庫 revision、設定、統計入力が同じなら問題列と選択肢順を再現できるようにする。`Math.random` の全体差し替えは行わない。

テストは同一セッション内の重複を禁止する。候補を使い切ったら exhausted として終了し、回数上限に達した後の無条件な再抽選で重複を許可しない。学習は学習時刻に達した復習を再び扱えるため、テストと同じ永続的な既出排除を適用しない。

## 5. 学習と終了条件

学習状態は NEW、LEARNING、REVIEW、RELEARNING とする。結果は strong、weak、wrong、idk、timeout とし、部分点は付けない。正答でも遅い回答や強い混同のある回答は weak として扱い、誤答とは区別する。

| 現在状態・結果 | 規範の次状態と間隔 |
| --- | --- |
| NEW で strong / weak | LEARNING の最初の 30 秒段階へ入る。 |
| LEARNING で strong | 30 秒 → 5 分 → 1 時間の段階を進め、完了後 REVIEW へ移る。 |
| LEARNING で weak | 現在の短期段階を維持する。 |
| RELEARNING で strong | 2 分 → 30 分の段階を進め、完了後 REVIEW へ戻る。 |
| RELEARNING で weak | 現在の再学習段階を維持する。 |
| REVIEW で strong / weak | 正答の区分に応じて復習間隔を延ばす。 |
| wrong / timeout | RELEARNING の最初の 2 分段階へ戻り、lapses を増やす。 |
| idk | RELEARNING の最初へ戻るが、lapses は増やさない。任意の近い選択肢は補助情報として扱う。 |

ease は 1.3〜2.8、復習間隔は 20 秒〜6 時間に制限する。10 分未満では fuzz を掛けず、それ以上は seed 付き乱数入力から最大 ±5% のゆらぎを適用する。時刻は呼び出し側から渡し、core 自身が現在時刻を取得しない。変更後の状態と次の乱数状態を返し、保存副作用は実行しない。

題数指定は回答保存済みの数で目標を判定する。時間指定は開始時刻と固定した duration から締切を判定する。復習ゼロまでの学習は、その時点で期限に達した復習候補が空になったら終了し、新規問題で延長しない。テストに復習ゼロの設定は用意しない。

将来の due を持つ問題だけが残った場合は waiting として次の due を示す。題庫を使い尽くした exhausted、現在の復習がなくなった drained、時間切れ time、目標達成 target、中断 interrupted を区別する。待ち中も中断と時間切れを処理し、空のエラー画面で Next だけを無効にしない。

時間切れに未回答問題がある場合は timeout として固定したその問題を処理する。締切後の選択入力を正答として記録しない。保存待ちの回答を時間切れや中断が追い越して別問題・別 session へ書き込んではならない。保存成功を確認してから次の状態と終了を確定する。失敗時は同一操作 ID の DTO を再送でき、再送で二重加算しない。

再挑戦は独立した新セッションとして開始し、元セッションへ回答を追加しない。統計は実際に保存した回答数を分母とし、IDK と未回答・未出題を混同しない。

間違い再挑戦は通常学習の復習待ちと区別する。作成境界でretryを省略した場合はfalseへ正規化し、内部configとreplayには必須booleanとして保持する。明示的な再挑戦は選択した候補数と同じ題数指定を用い、未出題候補を即時に一巡する。元のschedule・統計・versionは入力に保持し、同じ保存CAS規則で学習状態を更新する。再挑戦のために学習記録を削除しない。

各セッションが受理する遷移時刻は単調非減少とする。質問開始・待機・回答・終了を通して過去の時刻を拒否する。最後に受理した論理時刻は実行中の状態に持ち、保存DTOやreplayの初期入力へ混入させない。

## 保存とバックアップ

新サイトのIndexedDB名は `bem130-quiz-web-v1`、現在のschema versionは2。旧サイトとは独立し、新サイト内のversion1からのupgradeでは既存storeを保持してassets storeを追加する。

新形式バックアップは `format: "bem130-quiz-backup"`、`version: 2`。草稿、題庫、ユーザー、attempt、session、schedule、混同・概念統計、設定、取得済みSVG原文を含む。復元前に全レコード・参照・集計・出題可能なreplay候補を検証する。失敗時は既存データを変更せず、成功時は一つのtransactionで置き換える。export・復元UIの上限はともに50MBとし、超過を黙って切り捨てない。

草稿versionはDB全体の保護した単調counterからtransaction内で採番する。削除・同名再作成・移動で過去のversionを再利用せず、古いタブの保存をCASで拒否する。内部counterはバックアップへ含めず、復元時に草稿versionの最大値から再構成する。復元・全削除時はstorage generationも更新し、古い接続の書き込みを拒否する。

sessionは開始時の題庫revision、候補ID列、許可pattern、seed、初期統計・scheduleをreplay入力として保持する。回答はその候補範囲に属する必要があり、同じ回答IDの同一DTO再送は冪等とする。題庫更新後も保存済みreplayの題庫snapshotを保持し、更新で除いた回答に合わせてsessionの集計を同じtransactionで再計算する。

## 6. 検証と現状

schema の単体テストは v3 の両サンプル、全 token 種、正規化と外部 JSON の往復、厳密な JSON 構文、重複 ID、欠損参照、循環、危険なプロパティ名、SVG の構造を確認する。SVG 構造テストの成功は XML 安全化の証拠とはしない。

identity の単体テストは完全出典、draft namespace、役割別キー、区切り文字を含む ID の往復、無効な tuple の拒否を確認する。実装の型検査、純粋 core の検査、回帰テスト、実ブラウザ、実機、PHP/GD は別々に記録する。

本書の規範に対する未実装・未検証があれば、規範を既存の不具合へ合わせて緩めず、対応 Issue と検証結果を追記する。JSON 構文を受理できること、schema を受理できること、出題可能な容量があることは別の段階である。

## 7. validator の選定比較（#76）

2026-11-09 の独立監査で、現行の手実装と Zod、Valibot を比較した。これは実装後に不足していた選定根拠を補い、現時点の継続判断を記録するものである。候補の機能不足を仮定して手実装を正当化しない。両ライブラリとも今回の入力境界を実装できる。

### 比較する固定版とサイズの意味

比較対象は調査時の npm registry metadata から版を固定した。候補を package.json や lockfile に追加していない。

| 候補 | 固定版・配布 metadata | 依存とサイズの解釈 |
| --- | --- | --- |
| 現行手実装 | [schema.ts](../src/core/schema.ts)、[model.ts](../src/core/model.ts)、[identity.ts](../src/core/identity.ts) | validator 用の追加 runtime package はない。ただし手実装自体の配信コードと保守費用は存在する。 |
| Zod | [zod 4.6.7](https://registry.npmjs.org/zod/4.6.7)、dist.unpackedSize = **6,148,944 bytes** | この版の dependencies／optionalDependencies／peerDependencies の宣言はない。配布物には複数形式・型宣言等も含まれ、この数を browser の転送量と扱わない。 |
| Valibot | [valibot 1.5.0](https://registry.npmjs.org/valibot/1.5.0)、dist.unpackedSize = **1,865,457 bytes** | runtime dependencies／optionalDependencies の宣言はない。TypeScript >=5 は optional peer であり、本repoの6.0.3は範囲を満たす。これもbrowser転送量ではない。 |

metadata の再確認コマンドは `npm view zod@4.6.7 version dist.unpackedSize dependencies peerDependencies optionalDependencies --json` と `npm view valibot@1.5.0 version dist.unpackedSize dependencies peerDependencies peerDependenciesMeta optionalDependencies --json` とする。これは依存の追加や候補 schema の統合試験ではない。

本アプリの全 v3 schema を移植した場合の minify／gzip／brotli 後の browser 差分、起動時間、型検査時間は**未測定**である。上記 unpacked bytes だけで大きさや速度の優劣を決めない。[Valibot のモジュール設計](https://valibot.dev/guides/comparison/) は未使用機能の除去を意図しており、[Zod Mini](https://zod.dev/packages/mini) も同じ機能を tree shaking しやすい API で提供する。公式の小さな例の bundle 数値を、この v3 題庫の実測値として転記しない。

### 型・外部入力・失敗の比較

| 観点 | 現行手実装 | Zod 4.6.7 | Valibot 1.5.0 |
| --- | --- | --- | --- |
| 型の正本と推論 | domain 型を明示し、unknown から新しい domain 値を構築する。型と validator の対応は自動推論されないため、両方を保守する必要がある。 | schema から `z.infer`、`z.input`、`z.output` で型を推論できる。変換前後を分けられる。[公式基本API](https://zod.dev/basics) | `InferInput`／`InferOutput` で入出力型を推論できる。再帰型には `GenericSchema` 等の明示注釈が必要になる。[型推論](https://valibot.dev/guides/infer-types/)・[lazy](https://valibot.dev/api/lazy/) |
| readonly と brand | 各 domain の readonly 宣言と、実行時検証する独自 brand constructor／guard を使用する。readonly は実行時の deep freeze ではない。 | `.brand()` で出力を区別し、`.readonly()` で readonly 型と `Object.freeze()` を適用できる。freeze は自動的な全階層 deep freeze ではなく、必要な入れ子にも契約を適用する。[公式API](https://zod.dev/api#branded-types) | `brand` と `readonly` をパイプへ追加できる。1.5.0 の readonly は型変換であり、runtime freeze は行わない。[brand](https://valibot.dev/api/brand/)・[固定版 readonly 実装](https://github.com/open-circle/valibot/blob/v1.5.0/library/src/actions/readonly/readonly.ts) |
| unknown と失敗 | `parseQuiz`／`parseEntry` は unknown を受け、想定内の失敗を `Result` と `DomainError` の kind／code／path／detail へ変換する。JSON 構文は先に JSON.parse で確認する。 | `safeParse` は成功データと ZodError を判別する結果を返す。throw する `parse` を必須にする必要はない。issues の path／code を domain エラーへ変換できる。[公式基本API](https://zod.dev/basics) | `safeParse` は unknown を受け、success／output／issues で結果を分岐できる。domain エラーへ変換可能。[公式 safeParse](https://valibot.dev/api/safeParse/) |
| 未知フィールドと正規化 | 定義済みレコードは keys で拒否し、行の任意フィールドは専用の RowValue へ検証する。省略値と外部 v3／内部 Option の変換もここで扱う。 | 通常の object の未知キー除去に頼らず、`strictObject` 等を選ぶ。transform／default で正規化できる。[公式API](https://zod.dev/api#objects) | `strictObject` が未知キーを拒否する。pipe／transform 等で正規化できる。strictObject は未知キーごとに大量の issue を作らず、一つを返す設計である。[公式 strictObject](https://valibot.dev/api/strictObject/) |

両ライブラリの brand はそれぞれの型表現であり、既存の unique symbol による ID 型へ自動的に一致するわけではない。採用するなら domain 型を schema の出力から導くか、既存 constructor へ明示的に接続する。型断言だけで接続しない。readonly／brand を持つライブラリでも、意味的に未検証の入力を安全にする条件は schema と custom check の内容に依存する。

### v3 固有の意味検証

Zod の [refinement／check](https://zod.dev/api#refinements)、Valibot の [rawCheck](https://valibot.dev/api/rawCheck/) は独自検査を実装できる。したがって、次の規則は両候補でも実装可能であり、手実装だけが扱える機能ではない。

- 行・pattern・tip ID の一意性、一問一 hide、参照した field の存在、key／listkey の参照先の型、文字列 source の型。
- フィールド名で表す key の連鎖について、実際の行を文脈として辿った直接・間接循環の拒否。token の再帰的な形を定義するだけでは、この名前による参照グラフを検証したことにならない。
- 最大64段の入れ子と参照展開、listkey の和と複数 listkey の積を合わせた最大1024通りの計数。単一 Token または Token[] を指す key の両経路を含め、実展開する前に超過を拒否する。
- 完全出典にスコープした ID、canonical v3 JSON である Revision、保存 DTO の相互参照と replay 範囲。SVG の XML 安全化は別の Web 境界であり、token 構造の受理で代替しない。

再帰 schema は token の形の再帰を表す手段であり、入力の JS オブジェクトが循環している場合の許容方針とも別である。ライブラリ側の循環対応の有無に依存せず、このプロジェクトでは JSON として扱う入力・深さ制限・意味的参照循環を明示的に検証する。どの候補を選んでも、上記の文脈を持つ traversal／集合検査／計数と、その回帰テストは必要になる。通常の string／array／object schema だけで自動的に満たされるとは判断しない。

現行の対応箇所は schema.ts の keys／depth／references／answerVariantCount と parseQuiz、identity.ts、保存境界の validation.ts である。[schema テスト](../tests/core/model-schema.test.ts) の重複・欠損・循環・深さ・1024上限、[出題テスト](../tests/core/quiz-engine.test.ts) の正答集合、[型誤用検査](../tests/types/domain-contract.test-d.ts)、[保存テスト](../tests/core/storage.test.ts) を受理条件の証拠として維持する。候補を切り替える場合もこの外部契約と回帰を引き継ぐ。

### 現時点の判断と再評価条件

現時点では手実装を継続し、追加ライブラリを導入しない。理由は、既存 v3 の外部表現と内部の readonly／Option／ID を分けた境界が実装され、参照・直積上限等の custom traversal と回帰テストを既に共有できること、今回ライブラリへ置換してもそれらの意味検証と domain エラーへの接続は残ることである。これは bundle や性能で手実装が優れているという測定結果ではない。

手実装には、型と検証の二重管理、未知フィールドの定義漏れ、正規化と直列化のずれ、境界処理の保守を自分たちが負う欠点がある。実際に単一 Token を経由する listkey の検査漏れを監査で発見しており、自作だから正しいとは扱わない。これに対し、Zod／Valibot の型推論・共通検査・独自 issue API は保守負担を減らす利点がある。

v3 の構造変更や入力形式が増え、型と validator のずれが繰り返される場合は再評価する。その際は、同じ fixture の受理／拒否・path付き診断・正規化往復・意味検証上限・型誤用を比較し、実際の Vite build の圧縮後差分と型検査コストを測る。既存実装の置換費用だけを永久的な不採用理由にせず、検査を弱めるためにも新依存を導入しない。
