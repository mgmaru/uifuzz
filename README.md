# uifuzz (プロトタイプ)

ストーリーもベースライン画像も書かずに、**型から「壊れる入力」を探して、UIが壊れたかどうかを自動判定する** CLI です。

```
$ npm run demo:broken
uifuzz: examples/UserCard.tsx
  UserCard を 58 通り描画
  ✗ 8 種類の壊れを検出
    [render-error] (component)
      TypeError: Cannot read properties of undefined (reading 'trim')
      入力: bio=undefined
    [escape-component] div.card > div.header > span.name
      コンポーネントの枠の外に描画されています
      入力: name=long-ja-nospace, name=long-token, name=long-sentence, all-worst
    ...
```

## セットアップ

```
npm install
npx playwright install chromium
npm run demo:broken   # わざと壊れやすく書いたカード → 8 種類検出、終了コード 1
npm run demo:fixed    # 指摘を直したカード → 壊れなし、終了コード 0
npm run uifuzz -- path/to/Component.tsx [--component Name] [--out dir]
```

## 処理の流れ

| 段階 | ファイル | 内容 |
|---|---|---|
| 1. 型解析 | `src/extract.ts` | TypeScript コンパイラ API で、PascalCase のエクスポート関数の props 型を読む |
| 2. 入力生成 | `src/generate.ts` | 型ごとの境界値で、決定的にケースを作る(LLM 不使用) |
| 3. 描画 | `src/cli.ts`, `src/browser/runtime.ts` | esbuild でバンドルし、Playwright の Chromium で 360px / 1280px の 2 画面幅に描画 |
| 4. 検査 | `src/browser/checks.ts` | 画像比較ではなく不変条件で判定 |
| 5. 報告 | `src/report.ts` | 同じ壊れ方をまとめ、AI 向け `report.json` と人間向け `report.html` を出力 |

### 境界値(2. 入力生成)

- **string**: 空文字、スペースなしの長い日本語、長い URL、長い英文、絵文字、RTL(アラビア語)
- **number**: 0、負数、巨大な数、割り切れない小数
- **配列**: 空、100 件、1 件だけ極端な要素
- **union**: 各リテラル
- **optional**: undefined
- **関数**: no-op

MVP では「1 因子ずつ変える」方式と、全部を最悪にした `all-worst` ケースで生成しています。

### 不変条件(4. 検査)

| ルール | 意味 |
|---|---|
| `render-error` | 描画時に例外 |
| `text-overflow` | テキストが箱の外へはみ出す |
| `text-clipped` | 省略記号なしで切れる(`ellipsis` / `line-clamp` は意図的とみなす) |
| `escape-component` | 子要素がコンポーネントの枠外に出る |
| `overlap` | 兄弟要素が重なる |
| `page-hscroll` | 横スクロールが発生 |
| `tap-target` | 押せる要素が 24px 未満(WCAG 2.5.8) |

### report.json(AI に渡す用)

壊れ方ごとに、次の項目を出力します。

- 発生した入力の一覧(`triggeredBy`)
- 最小の再現 props(`reproduce`)
- 修正のヒント(`fixHint`)

Claude Code などに「report.json を読んで直して」と渡せば、修正 → 再実行のループが回ります。

## 未対応(次の段階)

- **Context 依存のコンポーネント**: Provider や Router に包まないと描画できないものへの対応。ラッパー設定、Storybook の decorator の流用
- **ペアワイズ法**: 2 つの prop の組み合わせで起きる壊れを拾う
- **描画条件の追加**: ダークモード、axe-core によるアクセシビリティ検査
- **型より狭い制約の上書き**: 例として「`string` だが実際は URL だけ」のような prop
- **配布形態**: MCP サーバー化、GitHub Action 化

## ライセンス

[MIT](./LICENSE)
