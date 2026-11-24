import type { WidthExpr, WidthParamSpec } from "@/shared/types";

export const MIN_WIDTH = 1;
export const MAX_WIDTH = 16;

export class ExprError extends Error {}

/** Linear form: constant + Σ coefficient·variable. */
export interface LinearTerm {
  constant: number;
  coeffs: Map<string, number>;
}

export function constant(value: number): LinearTerm {
  return { constant: value, coeffs: new Map() };
}
export function variable(id: string, coefficient = 1): LinearTerm {
  const coeffs = new Map<string, number>();
  if (coefficient !== 0) coeffs.set(id, coefficient);
  return { constant: 0, coeffs };
}
export function addTerms(...terms: LinearTerm[]): LinearTerm {
  const result = constant(0);
  for (const term of terms) {
    result.constant += term.constant;
    for (const [id, coefficient] of term.coeffs)
      result.coeffs.set(id, (result.coeffs.get(id) ?? 0) + coefficient);
  }
  for (const [id, coefficient] of result.coeffs)
    if (coefficient === 0) result.coeffs.delete(id);
  return result;
}
export function scaleTerm(term: LinearTerm, factor: number): LinearTerm {
  const result = constant(term.constant * factor);
  for (const [id, coefficient] of term.coeffs)
    result.coeffs.set(id, coefficient * factor);
  return result;
}
export function isConstantTerm(term: LinearTerm): boolean {
  return term.coeffs.size === 0;
}
export function termValue(
  term: LinearTerm,
  values: ReadonlyMap<string, number>,
): number {
  let total = term.constant;
  for (const [id, coefficient] of term.coeffs) {
    const value = values.get(id);
    if (value === undefined)
      throw new ExprError(`变量 ${id} 没有取值，无法计算位宽`);
    total += coefficient * value;
  }
  return total;
}
export function termText(
  term: LinearTerm,
  names: ReadonlyMap<string, string>,
): string {
  const parts: string[] = [];
  for (const [id, coefficient] of [...term.coeffs].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const name = names.get(id) ?? id;
    if (coefficient === 1) parts.push(name);
    else if (coefficient === -1) parts.push(`-${name}`);
    else parts.push(`${coefficient}·${name}`);
  }
  return [...parts, String(term.constant)].join(" + ").replace(/\+ -/g, "− ");
}

export function exprParams(expr: WidthExpr, into = new Set<string>()): Set<string> {
  switch (expr.kind) {
    case "const":
      return into;
    case "param":
      into.add(expr.name);
      return into;
    default:
      exprParams(expr.left, into);
      exprParams(expr.right, into);
      return into;
  }
}

export function evalExpr(
  expr: WidthExpr,
  env: Readonly<Record<string, number>>,
): number {
  switch (expr.kind) {
    case "const":
      return expr.value;
    case "param": {
      const value = env[expr.name];
      if (value === undefined) throw new ExprError(`位宽参数 ${expr.name} 没有取值`);
      return value;
    }
    case "add":
      return evalExpr(expr.left, env) + evalExpr(expr.right, env);
    case "sub":
      return evalExpr(expr.left, env) - evalExpr(expr.right, env);
    case "mul":
      return evalExpr(expr.left, env) * evalExpr(expr.right, env);
  }
}

/** Convert one width expression into a linear term in the given scope. */
export function toLinear(
  expr: WidthExpr,
  env: ReadonlyMap<string, LinearTerm>,
): LinearTerm {
  switch (expr.kind) {
    case "const":
      return constant(expr.value);
    case "param": {
      const term = env.get(expr.name);
      if (!term) throw new ExprError(`位宽表达式引用了未定义的参数 ${expr.name}`);
      return { constant: term.constant, coeffs: new Map(term.coeffs) };
    }
    case "add":
      return addTerms(toLinear(expr.left, env), toLinear(expr.right, env));
    case "sub":
      return addTerms(toLinear(expr.left, env), scaleTerm(toLinear(expr.right, env), -1));
    case "mul": {
      const left = toLinear(expr.left, env),
        right = toLinear(expr.right, env);
      if (isConstantTerm(left)) return scaleTerm(right, left.constant);
      if (isConstantTerm(right)) return scaleTerm(left, right.constant);
      throw new ExprError("位宽表达式不支持参数与参数相乘；请写成常数倍数，例如 2*N");
    }
  }
}

export function exprFromNumber(value: number): WidthExpr {
  return { kind: "const", value };
}

export function formatExpr(expr: WidthExpr): string {
  switch (expr.kind) {
    case "const":
      return String(expr.value);
    case "param":
      return expr.name;
    case "add":
      return `${formatOperand(expr.left)} + ${formatOperand(expr.right)}`;
    case "sub":
      return `${formatOperand(expr.left)} − ${formatOperand(expr.right)}`;
    case "mul":
      return `${formatOperand(expr.left)}·${formatOperand(expr.right)}`;
  }
}
function formatOperand(expr: WidthExpr): string {
  return expr.kind === "add" || expr.kind === "sub"
    ? `(${formatExpr(expr)})`
    : formatExpr(expr);
}

/** Independent min/max of an expression over its parameter ranges. */
export function exprRange(
  expr: WidthExpr,
  params: readonly WidthParamSpec[],
): { min: number; max: number } {
  switch (expr.kind) {
    case "const":
      return { min: expr.value, max: expr.value };
    case "param": {
      const spec = params.find((item) => item.name === expr.name);
      return spec ? { min: spec.min, max: spec.max } : { min: 0, max: 0 };
    }
    case "add": {
      const left = exprRange(expr.left, params),
        right = exprRange(expr.right, params);
      return { min: left.min + right.min, max: left.max + right.max };
    }
    case "sub": {
      const left = exprRange(expr.left, params),
        right = exprRange(expr.right, params);
      return { min: left.min - right.max, max: left.max - right.min };
    }
    case "mul": {
      const left = exprRange(expr.left, params),
        right = exprRange(expr.right, params);
      const values = [
        left.min * right.min,
        left.min * right.max,
        left.max * right.min,
        left.max * right.max,
      ];
      return { min: Math.min(...values), max: Math.max(...values) };
    }
  }
}

const TOKEN = /\s*(?:(\d+)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*()]))/y;

/** Parse a compact width expression such as `N`, `2*N`, `N + 2`, `(N-1)*2`. */
export function parseExpr(text: string): WidthExpr {
  const source = text.trim();
  if (!source) throw new ExprError("位宽表达式不能为空");
  if (source.length > 120) throw new ExprError("位宽表达式过长");
  const tokens: { type: "number" | "name" | "op"; value: string }[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) {
      if (/^\s*$/.test(source.slice(at))) break;
      throw new ExprError(`位宽表达式在“${source.slice(at, at + 8)}”处无法解析`);
    }
    if (match[1] !== undefined) tokens.push({ type: "number", value: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: "name", value: match[2] });
    else tokens.push({ type: "op", value: match[3] });
    if (TOKEN.lastIndex === at) break;
  }
  if (!tokens.length) throw new ExprError("位宽表达式不能为空");
  let index = 0;
  const peek = () => tokens[index];
  function take(): (typeof tokens)[number] {
    const token = tokens[index++];
    if (!token) throw new ExprError("位宽表达式不完整");
    return token;
  }
  function atom(): WidthExpr {
    const token = take();
    if (token.type === "number") {
      const value = Number(token.value);
      if (!Number.isInteger(value)) throw new ExprError("位宽表达式只能使用整数");
      return { kind: "const", value };
    }
    if (token.type === "name") return { kind: "param", name: token.value };
    if (token.value === "(") {
      const value = additive();
      const close = take();
      if (close.type !== "op" || close.value !== ")")
        throw new ExprError("位宽表达式缺少右括号");
      return value;
    }
    if (token.value === "-") {
      const inner = atom();
      return { kind: "mul", left: { kind: "const", value: -1 }, right: inner };
    }
    throw new ExprError(`位宽表达式中“${token.value}”位置无效`);
  }
  function multiplicative(): WidthExpr {
    let left = atom();
    while (peek()?.type === "op" && peek().value === "*") {
      take();
      const right = atom();
      left = { kind: "mul", left, right };
    }
    return left;
  }
  function additive(): WidthExpr {
    let left = multiplicative();
    while (peek()?.type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = take().value;
      const right = multiplicative();
      left = { kind: op === "+" ? "add" : "sub", left, right };
    }
    return left;
  }
  const result = additive();
  if (index !== tokens.length) throw new ExprError("位宽表达式结尾有多余内容");
  return result;
}

export function checkExprBounds(
  expr: WidthExpr,
  params: readonly WidthParamSpec[],
  label = "位宽表达式",
): string | null {
  const range = exprRange(expr, params);
  if (
    !Number.isInteger(range.min) ||
    !Number.isInteger(range.max)
  )
    return `${label}必须产生整数位宽`;
  if (range.min < MIN_WIDTH || range.max > MAX_WIDTH)
    return `${label}“${formatExpr(expr)}”的取值超出 ${MIN_WIDTH}–${MAX_WIDTH} 位`;
  return null;
}
