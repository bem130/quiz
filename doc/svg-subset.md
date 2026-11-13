# SVGの受理範囲と描画契約

題庫のSVGとRDKitの化学構造図は `src/web/svg.ts` を通し、許可した静的要素だけを新しいDOMへ構成する。元のDOMや生のHTMLを挿入しない。拒否時は表示層が代替説明と失敗理由を示す。

## 受理する図

SVG名前空間のsvg、g、defs、symbol、use、path、基本図形、text/tspan、title/desc、線形・放射gradient、stop、clipPath、markerを扱う。図形・線・文字・色・変形などの許可属性に限定する。styleは許可したpresentation宣言だけを属性へ展開し、通常のpresentation属性より優先する。xml:spaceはXML名前空間を保つ。

内部参照は同じ図内のIDだけを許す。useは図形、clip-pathはclipPath、markerはmarker、paintはgradientを参照する。IDとclassは描画ごとの接頭辞へ写像する。小さい入れ子参照は許可し、包含を含めて循環する参照は拒否する。

script、foreignObject、image、リンク、アニメーション、style要素、イベント属性、未知属性、外部href、外部url、任意のCSS、DTD、entity宣言、処理命令、名前空間の迂回を拒否する。通常のXML宣言だけは許す。これは一般のSVGファイル全体に対する互換実装ではない。

## パレットトークン

paint値（fill・stroke・stop-color・color）が題庫のパレットまたは内蔵の既定パレットのトークン名と一致する場合、その値は具体色ではなくテーマ連動の色として扱う。sanitizerはトークンを `light-dark(ライト色, ダーク色)` の style プロパティへ変換し、図のルートへ `quiz-svg-palette` classを付ける。テーマの選択は color-scheme で行い、dark と black ではダーク色、light ではライト色を使う。トークンを使う図は `.diagram` の白い canvas 強制の対象外とし、背景は透過とする。トークン解決に使うパレットは、その題庫の Quiz File が持つ `palette` であり、RDKit が生成する構造図など題庫に属さない図はトークンを使わない。

## 資源の上限

`SVG_LIMITS` を契約の正本とする。文字数はUTF-16コード単位で数える。

| 対象 | 上限 |
| --- | ---: |
| 入力文字数 | 2,000,000 |
| 要素数 / DOM深さ | 5,000 / 64 |
| 内部参照数 / 参照深さ | 10,000 / 16 |
| path・pointsの合計文字数 / 数値数 | 200,000 / 20,000 |
| テキストの合計文字数 | 100,000 |
| 参照展開後の保守的な描画量 | 100,000 |

包含と全参照を合成したグラフを反復処理で検査する。同じ参照先を複数回使う場合も各回を計上する。まずuseを展開した頂点数の上界を求め、marker・paint・clipの参照先の仕事量をその数で保守的に乗算する。pathの数値数とコマンド数で暗黙の反復線分・閉路も上から見積もる。このため、循環しない増幅図もDOMへ公開する前に拒否する。単純な描画でも上界が予算を超える場合は拒否し、実行時間を厳密に予測できるとは主張しない。

## 寸法

正の幅・高さを持つviewBoxが必要である。viewBoxがない場合だけ、正のpx寸法から生成する。元の座標系を保ち、preserveAspectRatioはxMidYMid meetへ統一する。表示幅を親領域、元寸法、24emと70vhに対応する比率寸法の最小値へ制限し、縦横比を保持する。画像外の描画は切り取る。説明はaria-labelとして付与する。

## 検証

`tests/e2e/svg.html` の隔離画面で実際のsanitizerとRDKit描画経路を使用する。`svg.spec.ts` は静的図・参照・悪意入力・資源上限・外部要求なし・320/1280px幅・文字拡大・SMILESを検証する。結果は実行したブラウザごとに記録し、未実施の実機確認と区別する。

2026-11-09にChromium・Firefox・WebKitで各10件、合計30件が成功した。文字サイズ16/32pxと実際のRDKit SMILES出力も含む。物理端末およびVoiceOverによる確認は未実施である。

参照仕様: [SVG use](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/use)、[marker-mid](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/marker-mid)、[xml:space](https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/xml:space)、[viewBox](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/viewBox)。
