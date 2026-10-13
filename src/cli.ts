// uifuzz: ストーリーもベースライン画像も書かずに、型から「壊れる入力」を探して壊れを判定する CLI
//
//   npx tsx src/cli.ts <component.tsx> [--component Name] [--out uifuzz-report]
//
import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { extractComponents } from "./extract";
import { generateCases } from "./generate";
import type { Issue } from "./browser/checks";
import { writeReports, type Finding } from "./report";

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 800 },
  { name: "desktop", width: 1280, height: 800 },
];

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("使い方: uifuzz <component.tsx> [--component Name] [--out dir]");
    process.exit(2);
  }
  const only = flag(args, "--component");
  const outDir = path.resolve(flag(args, "--out") ?? "uifuzz-report");
  const absFile = path.resolve(file);

  // 1. 型解析
  const components = extractComponents(absFile).filter((c) => !only || c.name === only);
  if (components.length === 0) throw new Error("コンポーネントが見つかりません");

  // 3. 描画の準備: コンポーネント + 検査ランタイムをブラウザ用に 1 本へバンドル
  const bundle = await esbuild.build({
    stdin: {
      contents: `import * as mod from ${JSON.stringify(absFile)};
                 import { install } from ${JSON.stringify(path.join(__dirname, "browser/runtime.ts"))};
                 install(mod);`,
      resolveDir: path.dirname(absFile),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    nodePaths: [path.join(__dirname, "../node_modules")],
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "silent",
  });
  const script = bundle.outputFiles[0].text;

  const browser = await chromium.launch();
  const findings: Finding[] = [];
  let caseCount = 0;

  for (const component of components) {
    const cases = generateCases(component.props); // 2. 入力生成
    caseCount += cases.length * VIEWPORTS.length;

    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage({ viewport });
      await page.setContent(
        `<!doctype html><html><head><meta charset="utf-8">
         <style>body{margin:16px;font-family:"Noto Sans CJK JP",sans-serif}</style></head>
         <body><div id="root"></div></body></html>`,
      );
      await page.addScriptTag({ content: script });

      for (const testCase of cases) {
        // 4. 検査(ブラウザ内で不変条件をチェック)
        const issues: Issue[] = await page.evaluate(
          ([name, props]) => (window as any).__uifuzz.run(name, props),
          [component.name, testCase.props] as const,
        );
        if (issues.length === 0) continue;
        // 壊れた要素を赤枠で囲んでから、はみ出し部分も写るようページ全体を撮る
        const selectors = issues.flatMap((i) => i.selector.split(" × ")).filter((s) => !s.startsWith("("));
        await page.evaluate((sels) => {
          for (const s of sels) {
            document.querySelectorAll<HTMLElement>(s).forEach((el) => {
              el.style.outline = "2px solid #e11d48";
              el.style.outlineOffset = "-1px";
            });
          }
        }, selectors);
        const box = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: Math.ceil(document.getElementById("root")!.getBoundingClientRect().bottom) + 16,
        }));
        const shot = await page
          .screenshot({ fullPage: true, clip: { x: 0, y: 0, ...box } })
          .catch(() => undefined);
        for (const issue of issues) {
          findings.push({ component: component.name, viewport: viewport.name, testCase, issue, screenshot: shot });
        }
      }
      await page.close();
    }
  }
  await browser.close();

  // 5. 報告(AI 向け JSON と人間向け HTML)
  mkdirSync(outDir, { recursive: true });
  const summary = writeReports(outDir, path.relative(process.cwd(), absFile), components, caseCount, findings);
  console.log(summary.text);
  process.exit(summary.groups > 0 ? 1 : 0); // CI で落とせるように
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
