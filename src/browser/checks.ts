// 4. 検査: ベースライン画像と比べるのではなく、「どんな入力でも守られるべき不変条件」で壊れを判定する
//    このファイルはブラウザ内で実行される(esbuild でバンドルされる)

export type Rule =
  | "render-error" // 描画時に例外が出た
  | "text-overflow" // テキストが自分の箱からはみ出している
  | "text-clipped" // テキストが省略記号なしで切れて見えない
  | "escape-component" // 子要素がコンポーネントの枠の外に出ている
  | "page-hscroll" // ページに横スクロールが発生した
  | "overlap" // 兄弟要素どうしが重なっている
  | "tap-target"; // 押せる要素が 24px 未満(WCAG 2.5.8)

export interface Issue {
  rule: Rule;
  selector: string;
  message: string;
}

const TOLERANCE = 1; // サブピクセルの誤差は許容する
const MIN_TAP = 24;

export function runChecks(container: HTMLElement): Issue[] {
  const issues: Issue[] = [];
  const component = container.firstElementChild as HTMLElement | null;
  if (!component) return issues;

  const elements = [component, ...Array.from(component.querySelectorAll<HTMLElement>("*"))];
  const componentRect = component.getBoundingClientRect();

  for (const el of elements) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const rect = el.getBoundingClientRect();
    const selector = describe(el, component);

    // --- テキストのはみ出し / 切れ ---
    if (hasOwnText(el) && style.display !== "inline") {
      const overX = el.scrollWidth > el.clientWidth + TOLERANCE;
      const overY = el.scrollHeight > el.clientHeight + TOLERANCE;
      if (overX || overY) {
        const axis = overX ? "横" : "縦";
        const visible = (overX ? style.overflowX : style.overflowY) === "visible";
        const intentional =
          (overX && style.textOverflow === "ellipsis") ||
          (overY && style.getPropertyValue("-webkit-line-clamp") !== "none");
        if (visible) {
          issues.push({ rule: "text-overflow", selector, message: `テキストが${axis}方向に要素の外へはみ出しています` });
        } else if (!intentional) {
          issues.push({ rule: "text-clipped", selector, message: `テキストが${axis}方向で省略記号なしに切れています` });
        }
      }
    }

    // --- コンポーネントの枠からの脱出(途中で overflow:hidden に切られていないものだけ) ---
    if (el !== component && rect.width > 0 && !clippedByAncestor(el, component)) {
      if (
        rect.right > componentRect.right + TOLERANCE ||
        rect.left < componentRect.left - TOLERANCE ||
        rect.bottom > componentRect.bottom + TOLERANCE
      ) {
        issues.push({ rule: "escape-component", selector, message: "コンポーネントの枠の外に描画されています" });
      }
    }

    // --- 押せる要素のサイズ ---
    if (el.matches("button, a[href], [role=button], input, select")) {
      if (rect.width < MIN_TAP || rect.height < MIN_TAP) {
        issues.push({
          rule: "tap-target",
          selector,
          message: `押せる領域が ${Math.round(rect.width)}×${Math.round(rect.height)}px で、24×24px 未満です`,
        });
      }
    }
  }

  // --- 兄弟要素の重なり(通常フロー内の要素どうしのみ) ---
  for (const parent of elements) {
    const children = Array.from(parent.children).filter(inFlow) as HTMLElement[];
    for (let i = 0; i < children.length; i++) {
      for (let j = i + 1; j < children.length; j++) {
        if (intersects(children[i].getBoundingClientRect(), children[j].getBoundingClientRect())) {
          issues.push({
            rule: "overlap",
            selector: `${describe(children[i], component)} × ${describe(children[j], component)}`,
            message: "兄弟要素どうしが重なっています",
          });
        }
      }
    }
  }

  // --- ページ全体の横スクロール ---
  if (document.documentElement.scrollWidth > window.innerWidth + TOLERANCE) {
    issues.push({
      rule: "page-hscroll",
      selector: "(page)",
      message: `ページ幅 ${document.documentElement.scrollWidth}px が画面幅 ${window.innerWidth}px を超えています`,
    });
  }

  return dedupe(issues);
}

function hasOwnText(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "");
}

function clippedByAncestor(el: HTMLElement, stop: HTMLElement): boolean {
  for (let p = el.parentElement; p && p !== stop; p = p.parentElement) {
    if (getComputedStyle(p).overflow !== "visible") return true;
  }
  return getComputedStyle(stop).overflow !== "visible";
}

function inFlow(el: Element): boolean {
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return s.position !== "absolute" && s.position !== "fixed" && s.display !== "none" && r.width > 0 && r.height > 0;
}

function intersects(a: DOMRect, b: DOMRect): boolean {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 2 && h > 2;
}

/** AI と人間の両方が読める短いセレクタ: 例 "div.card > div.header > span.name" */
function describe(el: Element, root: Element): string {
  const parts: string[] = [];
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const cls = typeof cur.className === "string" ? cur.className.trim().split(/\s+/)[0] : "";
    let part = cur.tagName.toLowerCase() + (cls ? `.${cls}` : "");
    const parent = cur.parentElement;
    if (parent && cur !== root) {
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName && c.className === cur!.className);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    if (cur === root) break;
  }
  return parts.join(" > ");
}

function dedupe(issues: Issue[]): Issue[] {
  // 同じルール・同じ「種類の」要素(:nth-of-type を除いた形)は 1 件にまとめる
  const seen = new Map<string, Issue>();
  for (const issue of issues) {
    const key = issue.rule + "|" + issue.selector.replace(/:nth-of-type\(\d+\)/g, "");
    if (!seen.has(key)) seen.set(key, { ...issue, selector: issue.selector.replace(/:nth-of-type\(\d+\)/g, "") });
  }
  return [...seen.values()];
}
