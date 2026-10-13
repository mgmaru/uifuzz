// 5. 報告: 同じ壊れ方を 1 つにまとめ、「どの入力で壊れるか」と「最小の再現 props」を出す
//    report.json は AI エージェントにそのまま渡して修正させる用、report.html は人間のレビュー用
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Issue, Rule } from "./browser/checks";
import type { ComponentSpec } from "./extract";
import type { TestCase } from "./generate";

export interface Finding {
  component: string;
  viewport: string;
  testCase: TestCase;
  issue: Issue;
  screenshot?: Buffer;
}

const FIX_HINTS: Record<Rule, string> = {
  "render-error": "optional な props や空配列・0 を想定した分岐(既定値やガード)を入れる",
  "text-overflow": "flex 子要素なら min-width:0 を付け、overflow-wrap:anywhere か text-overflow:ellipsis で収める",
  "text-clipped": "切るのが意図なら text-overflow:ellipsis / -webkit-line-clamp で省略を明示する。意図でなければ高さ固定をやめる",
  "escape-component": "flex-wrap:wrap、max-width:100%、件数の上限(+N 表示)などで枠内に収める",
  "page-hscroll": "固定幅をやめて max-width:100% にする。長い単語に overflow-wrap:anywhere を付ける",
  overlap: "兄弟要素に min-width:0 / flex-shrink を設定し、はみ出した子が隣に食い込まないようにする",
  "tap-target": "押せる要素を min-width/min-height 24px 以上(推奨 44px)にする",
};

export function writeReports(
  outDir: string,
  file: string,
  components: ComponentSpec[],
  caseCount: number,
  findings: Finding[],
) {
  // (コンポーネント, ルール, セレクタ) ごとにまとめる
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.component}|${f.issue.rule}|${f.issue.selector}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const problems = [...groups.values()].map((list) => {
    // 最小の再現: ベースライン → 1 因子変更 → all-worst の順で最初に壊れたもの
    const repro =
      list.find((f) => f.testCase.id === "baseline") ??
      list.find((f) => f.testCase.id !== "all-worst") ??
      list[0];
    const all = [...new Set(list.map((f) => f.testCase.id))];
    // ふつうの入力でも壊れるなら、入力の一覧はノイズなので baseline だけにする
    const triggers = all.includes("baseline") ? ["baseline"] : all;
    const viewports = [...new Set(list.map((f) => f.viewport))];
    return { list, repro, triggers, viewports };
  });

  const json = {
    tool: "uifuzz",
    file,
    components: components.map((c) => c.name),
    checkedRenders: caseCount,
    problemCount: problems.length,
    problems: problems.map(({ repro, triggers, viewports }) => ({
      component: repro.component,
      rule: repro.issue.rule,
      selector: repro.issue.selector,
      message: repro.issue.message,
      viewports,
      alwaysBroken: triggers.includes("baseline"),
      triggeredBy: triggers,
      reproduce: { case: repro.testCase.id, viewport: repro.viewport, props: repro.testCase.props },
      fixHint: FIX_HINTS[repro.issue.rule],
    })),
  };
  writeFileSync(path.join(outDir, "report.json"), JSON.stringify(json, null, 2));
  writeFileSync(path.join(outDir, "report.html"), renderHtml(json, problems));

  const lines = [
    `uifuzz: ${file}`,
    `  ${components.map((c) => c.name).join(", ")} を ${caseCount} 通り描画`,
    problems.length === 0 ? "  ✓ 壊れは見つかりませんでした" : `  ✗ ${problems.length} 種類の壊れを検出`,
    ...json.problems.map(
      (p) =>
        `    [${p.rule}] ${p.selector}\n      ${p.message}\n      ${
          p.alwaysBroken ? "ふつうの入力でも発生" : `入力: ${p.triggeredBy.slice(0, 4).join(", ")}${p.triggeredBy.length > 4 ? ` ほか${p.triggeredBy.length - 4}件` : ""}`
        }`,
    ),
    `  レポート: ${path.relative(process.cwd(), outDir)}/report.html, report.json`,
  ];
  return { text: lines.join("\n"), groups: problems.length };
}

function renderHtml(json: { file: string; checkedRenders: number; problemCount: number }, problems: { repro: Finding; triggers: string[]; viewports: string[] }[]) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const cards = problems
    .map(({ repro, triggers, viewports }) => {
      const img = repro.screenshot
        ? `<img src="data:image/png;base64,${repro.screenshot.toString("base64")}" alt="">`
        : "";
      const always = triggers.includes("baseline");
      return `<section class="card">
  <header><span class="rule">${repro.issue.rule}</span><code>${esc(repro.issue.selector)}</code></header>
  <p>${esc(repro.issue.message)}</p>
  <p class="meta">${always ? "<b>ふつうの入力でも発生</b>" : `発生した入力: ${triggers.map((t) => `<code>${esc(t)}</code>`).join(" ")}`}<br>画面: ${viewports.join(", ")} / 再現: <code>${esc(repro.testCase.id)}</code> @ ${repro.viewport}</p>
  <p class="hint">修正のヒント: ${esc(FIX_HINTS[repro.issue.rule])}</p>
  <div class="shot">${img}</div>
</section>`;
    })
    .join("\n");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>uifuzz report</title>
<style>
:root{--bg:#f7f7f5;--fg:#1d1d1b;--muted:#6b6b66;--card:#fff;--line:#e3e2dc;--bad:#c2410c;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--muted:#9b9a94;--card:#21211f;--line:#34332f;--bad:#fb923c;--ok:#4ade80}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,"Noto Sans CJK JP",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}.sum{color:var(--muted);margin:0 0 24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px}
.card header{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.rule{background:var(--bad);color:var(--card);border-radius:4px;padding:1px 8px;font-size:12px;font-weight:600}
code{font-size:13px;overflow-wrap:anywhere}.meta,.hint{color:var(--muted);font-size:13px}
.shot{overflow:auto;border:1px dashed var(--line);border-radius:6px;background:#fff}.shot img{display:block;max-width:none}
.ok{color:var(--ok);font-weight:600}
</style></head><body><main>
<h1>uifuzz report</h1>
<p class="sum">${esc(json.file)} — ${json.checkedRenders} 通り描画 / ${json.problemCount === 0 ? '<span class="ok">壊れなし</span>' : `${json.problemCount} 種類の壊れ`}</p>
${cards}
</main></body></html>`;
}
