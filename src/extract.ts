// 1. 型解析: TypeScript のコンパイラ API で、エクスポートされたコンポーネントの props 型を読む
import ts from "typescript";

export type PropKind =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "literal-union"; values: (string | number)[] }
  | { kind: "array"; element: PropKind }
  | { kind: "object"; fields: PropSpec[] }
  | { kind: "function" }
  | { kind: "unknown"; text: string };

export interface PropSpec {
  name: string;
  optional: boolean;
  type: PropKind;
}

export interface ComponentSpec {
  name: string;
  props: PropSpec[];
}

export function extractComponents(file: string): ComponentSpec[] {
  const program = ts.createProgram([file], {
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) throw new Error(`ファイルを読めません: ${file}`);
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) return [];

  const components: ComponentSpec[] = [];
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    // React コンポーネントは PascalCase という慣習で判定する
    if (!/^[A-Z]/.test(exported.name)) continue;
    const symbol =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
    const decl = symbol.valueDeclaration;
    if (!decl) continue;

    const signature = checker.getTypeOfSymbolAtLocation(symbol, decl).getCallSignatures()[0];
    if (!signature) continue;

    const propsParam = signature.getParameters()[0];
    const props = propsParam
      ? readFields(checker, checker.getTypeOfSymbolAtLocation(propsParam, decl), decl, 0)
      : [];
    components.push({ name: exported.name, props });
  }
  return components;
}

function readFields(checker: ts.TypeChecker, type: ts.Type, at: ts.Node, depth: number): PropSpec[] {
  return checker.getPropertiesOfType(type).map((prop) => ({
    name: prop.name,
    optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
    type: classify(checker, checker.getTypeOfSymbolAtLocation(prop, at), at, depth),
  }));
}

function classify(checker: ts.TypeChecker, type: ts.Type, at: ts.Node, depth: number): PropKind {
  if (type.isUnion()) {
    // optional による `| undefined` は optional フラグで扱うので取り除く
    const parts = type.types.filter(
      (t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    );
    if (parts.length === 1) return classify(checker, parts[0], at, depth);
    if (parts.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return { kind: "boolean" };
    if (parts.every((t) => t.isStringLiteral() || t.isNumberLiteral())) {
      return {
        kind: "literal-union",
        values: parts.map((t) => (t as ts.LiteralType).value as string | number),
      };
    }
    return { kind: "unknown", text: checker.typeToString(type) };
  }
  if (type.isStringLiteral() || type.isNumberLiteral()) {
    return { kind: "literal-union", values: [type.value] };
  }
  if (type.flags & ts.TypeFlags.StringLike) return { kind: "string" };
  if (type.flags & ts.TypeFlags.NumberLike) return { kind: "number" };
  if (type.flags & ts.TypeFlags.BooleanLike) return { kind: "boolean" };
  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    return { kind: "array", element: classify(checker, element, at, depth + 1) };
  }
  if (type.getCallSignatures().length > 0) return { kind: "function" };
  if (type.flags & ts.TypeFlags.Object && depth < 3) {
    return { kind: "object", fields: readFields(checker, type, at, depth + 1) };
  }
  return { kind: "unknown", text: checker.typeToString(type) };
}
