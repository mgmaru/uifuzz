// 2. 入力生成: 型ごとの「ふつうの値」と「壊れやすい値」から、決定的にテストケースを作る
//    LLM は使わないので、同じ型からは毎回同じケースが出る(CI で再現できる)
import type { PropKind, PropSpec } from "./extract";

/** 関数 props はブラウザ側で no-op 関数に置き換える目印 */
export const FN_MARKER = "__uifuzz_fn__";

interface Edge {
  label: string;
  value: unknown;
}

export interface TestCase {
  id: string; // 例: "name=long-ja-nospace"
  props: Record<string, unknown>;
}

const LONG_JA = "東京都千代田区丸の内一丁目一番一号丸の内センタービルディング二十三階";
const STRING_EDGES: Edge[] = [
  { label: "empty", value: "" },
  { label: "long-ja-nospace", value: LONG_JA.repeat(2) },
  { label: "long-token", value: "https://example.com/" + "very-long-path-segment-".repeat(5) },
  {
    label: "long-sentence",
    value: "The quick brown fox jumps over the lazy dog. ".repeat(6).trim(),
  },
  { label: "emoji", value: "👨‍👩‍👧‍👦🎉🔥".repeat(5) },
  { label: "rtl", value: "مرحبا بالعالم، هذا نص طويل من اليمين إلى اليسار" },
];
const NUMBER_EDGES: Edge[] = [
  { label: "zero", value: 0 },
  { label: "negative", value: -1 },
  { label: "huge", value: 9_876_543_210 },
  { label: "fraction", value: 1 / 3 },
];

export function typical(type: PropKind): unknown {
  switch (type.kind) {
    case "string":
      return "サンプル";
    case "number":
      return 42;
    case "boolean":
      return false;
    case "literal-union":
      return type.values[0];
    case "array":
      return [0, 1, 2].map(() => typical(type.element));
    case "object":
      return typicalObject(type.fields);
    case "function":
      return FN_MARKER;
    case "unknown":
      return undefined;
  }
}

function typicalObject(fields: PropSpec[]): Record<string, unknown> {
  return Object.fromEntries(fields.map((f) => [f.name, typical(f.type)]));
}

function edges(spec: PropSpec): Edge[] {
  const result: Edge[] = [];
  const t = spec.type;
  switch (t.kind) {
    case "string":
      result.push(...STRING_EDGES);
      break;
    case "number":
      result.push(...NUMBER_EDGES);
      break;
    case "boolean":
      result.push({ label: "true", value: true });
      break;
    case "literal-union":
      for (const v of t.values.slice(1)) result.push({ label: String(v), value: v });
      break;
    case "array": {
      result.push({ label: "empty", value: [] });
      result.push({
        label: "many(100)",
        value: Array.from({ length: 100 }, () => typical(t.element)),
      });
      // 要素側の境界値は「1 件だけ極端」という形で入れる
      for (const e of edges({ name: "item", optional: false, type: t.element })) {
        result.push({ label: `one-item:${e.label}`, value: [e.value] });
      }
      break;
    }
    case "object":
      for (const field of t.fields) {
        for (const e of edges(field)) {
          result.push({
            label: `${field.name}=${e.label}`,
            value: { ...typicalObject(t.fields), [field.name]: e.value },
          });
        }
      }
      break;
  }
  if (spec.optional) result.push({ label: "undefined", value: undefined });
  return result;
}

/**
 * MVP は「1 因子ずつ変える」方式:
 *   ベースライン(全部ふつうの値) + 各 prop の境界値を 1 つずつ差し替えたケース + 全部最悪のケース
 * 組み合わせ由来のバグを拾うペアワイズ法は次の段階で入れる。
 */
export function generateCases(props: PropSpec[]): TestCase[] {
  const baseline = typicalObject(props);
  const cases: TestCase[] = [{ id: "baseline", props: baseline }];

  for (const prop of props) {
    for (const edge of edges(prop)) {
      cases.push({ id: `${prop.name}=${edge.label}`, props: { ...baseline, [prop.name]: edge.value } });
    }
  }

  // 全部いっぺんに厳しくしたケース(長い文字列・大量の配列・巨大な数)
  const worst = Object.fromEntries(
    props.map((p) => {
      const pick = (label: string) => edges(p).find((e) => e.label === label)?.value;
      const value =
        pick("long-ja-nospace") ?? pick("many(100)") ?? pick("huge") ?? baseline[p.name];
      return [p.name, value];
    }),
  );
  cases.push({ id: "all-worst", props: worst });
  return cases;
}
