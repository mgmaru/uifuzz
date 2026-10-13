// 3. 描画(ブラウザ側): ケースごとにコンポーネントを描画し直し、検査結果を返す
import { createElement, type ComponentType } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { runChecks, type Issue } from "./checks";

const FN_MARKER = "__uifuzz_fn__";

/** JSON で渡ってきた props の「関数の目印」を no-op 関数に戻す */
function revive(value: unknown): unknown {
  if (value === FN_MARKER) return () => {};
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

export function install(mod: Record<string, ComponentType<any>>): void {
  let root: Root | null = null;
  const container = document.getElementById("root")!;

  (window as any).__uifuzz = {
    run(componentName: string, props: unknown): Issue[] {
      root?.unmount();
      root = createRoot(container);
      try {
        flushSync(() => root!.render(createElement(mod[componentName], revive(props) as object)));
      } catch (error) {
        return [{ rule: "render-error", selector: "(component)", message: String(error) }];
      }
      if (!container.firstElementChild) return [];
      return runChecks(container);
    },
  };
}
