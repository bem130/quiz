# OGP画像のPHP配信

アプリ本体は `https://bem130.github.io/quiz/`、画像生成は `https://bem130.com/quiz/ogp-card.php` で配信する。PHP bundleはPagesの `dist/` とは独立して準備する。PHP 8.2以上、GDのPNG・FreeType対応、mbstringが必要である。Imagickや実行時の外部ネットワーク接続は不要である。

## 配信物の準備

Node 24で、空の `tmp/` 配下ディレクトリを指定する。

```powershell
node scripts/prepare-ogp.ts tmp/ogp-dist
```

このコマンドは公式 notofonts/noto-cjk の固定commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c` から静的な Noto Sans JP Regular OTF と同commitのOFLを明示的にダウンロードし、SHA-256を照合する。取得失敗や不一致では失敗する。リクエスト処理中にはダウンロードしない。既存ファイルがある出力先は拒否するため、更新時は別の空ディレクトリを指定する。出力先の既存祖先もrealpathで確認し、tmp外へ向くjunction越しにディレクトリを作らない。

| 配信物 | 用途・SHA-256 |
| --- | --- |
| `ogp-card.php` | PNG生成処理 |
| `metadata.json` | ローカルで確定した題庫の題名・説明 |
| `fonts/NotoSansJP-Regular.otf` | 元ファイル `Sans/SubsetOTF/JP/NotoSansJP-Regular.otf` を未変更で配布。`dff723ba59d57d136764a04b9b2d03205544f7cd785a711442d6d2d085ac5073` |
| `fonts/OFL.txt` | 同commitの `Sans/LICENSE` を未変更で配布。`6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2` |

静的Regularを選ぶ理由は、GDの描画APIへ可変フォントのweightを渡せず、最初の検証画像では既定weightが非常に細く、縮小するOGPで読みにくかったためである。[公式の形式一覧](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/README.md) から日本語の静的な地域別フォントを選び、Regularの太さを固定する。日本語subsetであるため、任意の絵文字や全言語のglyphが存在するとは保証しない。

ライセンスは [同commitのSIL OFL 1.1](https://github.com/notofonts/noto-cjk/blob/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE) である。未変更フォントのname tableには `© 2014-2021 Adobe (http://www.adobe.com/).`、OFLの説明と参照先が埋め込まれている。元の名前とcopyrightを維持したフォントとOFLを同梱する。

初期調査のGoogle Fonts版も検証記録として保持する。commitは `66a36c8c94b1a5d992ee4e7f392fccfe4945767c`、可変 `NotoSansJP[wght].ttf` のSHA-256は `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f`、OFLは `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9` だった。旧bundleのファイルを新fontで上書きせず、新しい空ディレクトリへ準備する。

生成したディレクトリの内容を、上記の相対配置のままbem130.comの `/quiz/` へアップロードする。既存PHPだけを先に置き換えず、フォント・索引を含む同じbundleを配信する。ホスティングの公開ディレクトリ名とアップロード方法は環境に合わせて確認する。サーバーのPHP設定で警告の画面出力を無効にする。フォントの再配布には同梱OFLを維持する。

## 入力とメタデータの契約

`GET` または `HEAD` を受け付け、成功時に1280×720のPNGと `Cache-Control: public, max-age=86400` を返す。エラーはtext/plainと `no-store` を返す。

| パラメーター | 契約 |
| --- | --- |
| `title` | UTF-8の文字列、最大240 Unicodeコードポイント。未指定・空白のみは `4-choice Quiz` |
| `description` | UTF-8の文字列、最大1200コードポイント。未指定・空白のみは `Multiple-choice quiz app.` |
| `quiz` | 空値または `[A-Za-z0-9_-]{1,80}` の索引キー。非空の場合はローカルmetadataの題名・説明を採用する |

配列型、壊れたUTF-8、NUL等の制御文字、上限超過は400。CRLFとCRはLF、タブは空白へ正規化し、全角空白・NBSP・BOM等の前後の空白も除く。空白だけなら既定文へ戻す。入力長は正規化・trimの前に検査する。未知のquizキーは404、非対応メソッドは405、フォント・拡張・metadata等の配備不備は500とする。エラー応答へローカルパスや内部例外を表示しない。

題名は最大3行、説明は最大4行へ実フォント幅で折り返す。空行も保持し、実際に行数を超えて省略する場合だけ `…` を付ける。描画領域は画像内へ収める。

`metadata.json` は準備時の `public/entry.json` が参照するrepo内 `data/*.json` をv3 schemaで検証して生成する。キーは拡張子を除いたbasename（`math-v3`、`multi-answer-v3`、`svg-v3`）で、重複を拒否する。題名・説明は共通coreの `plainText` で投影し、rubyの読みを省き、glossを括弧付きの本文へ戻す。数式は同じ共通契約に従う文字列であり、PHPでKaTeXを実行しない。投影後の文字数・制御文字・孤立surrogateを検査する。entryと題庫ファイルの壊れたUTF-8も、置換文字へ黙って変換せず準備時に拒否する。

題庫本文やSVG・利用者の草稿はPHPサーバーへ送らない。外部entryや個人の題庫をOGPへ反映する場合は明示的なプレーンテキストの `title` / `description` だけを使う。`quiz` をファイルパスやURLへ変換せず、リクエストで任意URLやファイルを取得しない。

## ローカル検証

先にbundleを準備する。Windowsの検証用PHPが別の場所にある場合は環境変数で指定する。

```powershell
$env:OGP_BUNDLE = Join-Path $PWD 'tmp/ogp-dist'
$env:PHP_BIN = Join-Path $PWD 'tmp/ogp-check/php-8.5.12/php.exe'
$env:PHP_EXTENSION_DIR = Join-Path $PWD 'tmp/ogp-check/php-8.5.12/ext'
node --test tests/ogp/*.test.mjs
```

検証は生のPHP built-in serverをlocalhostの空ポートへ起動し、GDによる日本語・長文・空値・改行・ローカル題庫の画像、PNG寸法、HEAD、array型・不正UTF-8・制御文字・長文超過・パストラバーサル・URL・未知キー・POSTの拒否を確認する。PHP警告・非推奨警告も失敗にする。フォント幅・省略・空行はPHP関数でも検証する。準備処理は出力境界、配信ファイルの集合、依存のSHA不一致を確認する。PNGは `tmp/ogp-evidence/` へ保存する。

2026-11-09時点のローカル検証環境はPHP 8.5.12 NTS / GD / FreeType / mbstringである。公開サーバーへのアップロードと公開URLの200/image/png確認は別途必要であり、ローカル検証だけでは配信済みにならない。

独立レビュー後の最終Regular版は `tmp/ogp-dist-regular-final/` に準備し、上記環境変数のbundleだけを切り替えた検証で5テストが成功した。Unicode空白だけの入力も既定画像と同じPNGになることを確認した。`tmp/ogp-evidence/` の日本語・長文・題庫metadata画像を目視し、太さ、3行＋4行の配置、枠内の折返し、省略、ruby/gloss構文が露出しないことを確認した。旧可変フォントの比較画像は `tmp/ogp-evidence-variable-review/`、取得した固定font/licenseは `tmp/ogp-font-review/` に残した。これらtmpの証拠とPHP bundleはPages公開物に含めない。

GDの座標・UTF-8仕様は [imagettfbbox](https://www.php.net/manual/en/function.imagettfbbox.php) と [imagettftext](https://www.php.net/manual/en/function.imagettftext.php) に従う。PHP 8.5で非推奨となり8.0以降効果がない [imagedestroy](https://www.php.net/manual/en/function.imagedestroy.php) は使わない。fontの出典は [固定commitの公式notofonts/noto-cjk](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/SubsetOTF/JP) である。
