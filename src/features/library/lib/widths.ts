import type {
  BoundaryPort,
  CircuitDocument,
  Endpoint,
  GateNode,
  Signal,
  SimulationIssue,
  SubcircuitDef,
  SubcircuitVersion,
  WidthExpr,
  WidthParamSpec,
} from "@/shared/types";
import {
  ExprError,
  MAX_WIDTH,
  MIN_WIDTH,
  addTerms,
  constant,
  formatExpr,
  isConstantTerm,
  termValue,
  toLinear,
  variable,
  type LinearTerm,
} from "./expr";

export const MAX_DEPTH = 16;
const MAX_SOLUTIONS = 512;
const MAX_OPTIONS = 24;
const MAX_ROUNDS = 96;

/* ------------------------------------------------------------------ */
/* Scopes                                                              */
/* ------------------------------------------------------------------ */

export interface ScopeInfo {
  path: string;
  node: GateNode | null;
  def: SubcircuitDef | null;
  version: SubcircuitVersion | null;
  nodes: GateNode[];
  wires: { id: string; from: Endpoint; to: Endpoint }[];
  children: Map<string, ScopeInfo>;
  params: WidthParamSpec[];
  paramTerms: Map<string, LinearTerm>;
  label: string;
  trail: string;
}

export interface WidthVar {
  id: string;
  label: string;
  kind: "param" | "net";
  scopePath: string;
  param?: string;
  nodeId?: string;
  lo: number;
  hi: number;
  fallback: number;
}

export interface ParamState {
  name: string;
  value: number | null;
  source: "literal" | "inferred" | "free";
  min: number;
  max: number;
  frees: number[];
}

export interface PortSummary {
  key: string;
  name: string;
  direction: "input" | "output";
  index: number;
  width: number | null;
  expr: string;
}

export interface InstanceSummary {
  path: string;
  nodeId: string;
  label: string;
  defId: string;
  defName: string;
  version: number;
  versions: number[];
  params: ParamState[];
  ports: PortSummary[];
  ambiguous: boolean;
  unresolved: boolean;
}

export interface ParamOption {
  params: Record<string, Record<string, number>>;
  distance: number;
}

export interface WidthConflict {
  message: string;
  scopePath: string;
  origin: string;
  chain: string[];
}

export interface WidthModel {
  ok: boolean;
  issues: SimulationIssue[];
  scopes: Map<string, ScopeInfo>;
  root: ScopeInfo;
  variables: Map<string, WidthVar>;
  values: Map<string, number>;
  options: ParamOption[];
  instances: InstanceSummary[];
  conflict: WidthConflict | null;
  termWidth(term: LinearTerm | null): number | null;
  portWidth(
    scopePath: string,
    nodeId: string,
    direction: "input" | "output",
    key: string | undefined,
    index: number,
  ): number | null;
  inputWidth(scopePath: string, nodeId: string, endpoint: Endpoint): number | null;
  outputWidth(scopePath: string, nodeId: string, endpoint: Endpoint): number | null;
  nodePorts(scopePath: string, nodeId: string): PortSummary[];
  instanceSummary(path: string): InstanceSummary | undefined;
  scope(path: string): ScopeInfo | undefined;
}

/* ------------------------------------------------------------------ */
/* Port helpers                                                        */
/* ------------------------------------------------------------------ */

export function portsOf(
  version: SubcircuitVersion | null | undefined,
  direction: "input" | "output",
): BoundaryPort[] {
  return version?.ports.filter((port) => port.direction === direction) ?? [];
}

export function findPort(
  version: SubcircuitVersion | null | undefined,
  direction: "input" | "output",
  key: string | undefined,
  fallback: number,
): BoundaryPort | undefined {
  const ports = portsOf(version, direction);
  if (key) {
    const byKey = ports.find((port) => port.key === key);
    if (byKey) return byKey;
  }
  return ports[fallback];
}

export function portIndexByKey(
  version: SubcircuitVersion | null | undefined,
  direction: "input" | "output",
  key: string | undefined,
  fallback = -1,
): number {
  const ports = portsOf(version, direction);
  if (key) return ports.findIndex((port) => port.key === key);
  return fallback >= 0 && fallback < ports.length ? fallback : -1;
}

export function versionFor(
  library: readonly SubcircuitDef[],
  defId: string | undefined,
  version: number | undefined,
): SubcircuitVersion | null {
  if (!defId) return null;
  const def = library.find((item) => item.id === defId);
  if (!def || !def.versions.length) return null;
  return (
    def.versions.find((item) => item.version === version) ??
    def.versions[def.versions.length - 1] ??
    null
  );
}

export function defFor(
  library: readonly SubcircuitDef[],
  defId: string | undefined,
): SubcircuitDef | undefined {
  return defId ? library.find((item) => item.id === defId) : undefined;
}

export function concatPorts(node: GateNode): number {
  return Math.max(2, Math.min(16, Math.round(node.ports ?? 2)));
}

export function clampWidth(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value) || 1));
}

export function baseGateNode(kind: GateNode["kind"]): boolean {
  return (
    kind === "AND" ||
    kind === "OR" ||
    kind === "XOR" ||
    kind === "NOT" ||
    kind === "NAND" ||
    kind === "NOR"
  );
}

/** Number of fixed ports for ordinary nodes. */
export function portCounts(node: GateNode): { inputs: number; outputs: number } {
  switch (node.kind) {
    case "INPUT":
      return { inputs: 0, outputs: 1 };
    case "OUTPUT":
      return { inputs: 1, outputs: 0 };
    case "NOT":
      return { inputs: 1, outputs: 1 };
    case "AND":
    case "OR":
    case "XOR":
    case "NAND":
    case "NOR":
      return { inputs: 2, outputs: 1 };
    case "SLICE":
      return { inputs: 1, outputs: 1 };
    case "CONCAT":
      return { inputs: concatPorts(node), outputs: 1 };
    case "SUBPORT_IN":
      return { inputs: 0, outputs: 1 };
    case "SUBPORT_OUT":
      return { inputs: 1, outputs: 0 };
    case "SUBCIRCUIT":
      return { inputs: 0, outputs: 0 };
  }
}

/* ------------------------------------------------------------------ */
/* Constraint builder                                                  */
/* ------------------------------------------------------------------ */

interface Equation {
  terms: Map<string, number>;
  constant: number;
  op: "eq" | "ge";
  origin: string;
  scopePath: string;
  scopeLabel: string;
}

interface Builder {
  library: readonly SubcircuitDef[];
  variables: Map<string, WidthVar>;
  equations: Equation[];
  scopes: Map<string, ScopeInfo>;
  issues: SimulationIssue[];
  outputCache: Map<string, LinearTerm>;
  inputCache: Map<string, LinearTerm>;
  names: Map<string, string>;
}

function scopeLabel(node: GateNode | null, def: SubcircuitDef | null, version: SubcircuitVersion | null): string {
  if (!node) return "实验台";
  return `${node.label}（${def?.name ?? "子电路"} v${version?.version ?? "?"}）`;
}

function childPath(parent: string, nodeId: string): string {
  return parent ? `${parent}/${nodeId}` : nodeId;
}

function makeScope(
  path: string,
  node: GateNode | null,
  def: SubcircuitDef | null,
  version: SubcircuitVersion | null,
  nodes: GateNode[],
  wires: { id: string; from: Endpoint; to: Endpoint }[],
  trail: string,
): ScopeInfo {
  return {
    path,
    node,
    def,
    version,
    nodes,
    wires,
    children: new Map(),
    params: version?.params ?? [],
    paramTerms: new Map(),
    label: scopeLabel(node, def, version),
    trail,
  };
}

function instanceParamTerms(
  builder: Builder,
  parent: ScopeInfo,
  node: GateNode,
  version: SubcircuitVersion,
): Map<string, LinearTerm> {
  const terms = new Map<string, LinearTerm>();
  const path = childPath(parent.path, node.id);
  for (const spec of version.params) {
    const arg = node.paramArgs?.[spec.name];
    if (arg) {
      try {
        terms.set(spec.name, toLinear(arg, parent.paramTerms));
      } catch (error) {
        builder.issues.push({
          tone: "error",
          message: `${parent.trail}：实例「${node.label}」的参数 ${spec.name} 无法解析：${
            error instanceof Error ? error.message : "表达式无效"
          }`,
        });
        terms.set(spec.name, constant(spec.default));
      }
      continue;
    }
    const id = `${path}::${spec.name}`;
    if (!builder.variables.has(id)) {
      builder.variables.set(id, {
        id,
        label: `${parent.trail} / ${node.label}.${spec.name}`,
        kind: "param",
        scopePath: path,
        param: spec.name,
        lo: spec.min,
        hi: spec.max,
        fallback: spec.default,
      });
    }
    terms.set(spec.name, variable(id));
  }
  return terms;
}

function netVar(builder: Builder, scope: ScopeInfo, node: GateNode): LinearTerm {
  const id = `net|${scope.path}|${node.id}`;
  if (!builder.variables.has(id)) {
    builder.variables.set(id, {
      id,
      label: `${scope.trail} / ${node.label} 总线`,
      kind: "net",
      scopePath: scope.path,
      nodeId: node.id,
      lo: MIN_WIDTH,
      hi: MAX_WIDTH,
      fallback: 1,
    });
  }
  return variable(id);
}

function termIn(builder: Builder, scope: ScopeInfo, expr: WidthExpr, what: string): LinearTerm {
  try {
    return toLinear(expr, scope.paramTerms);
  } catch (error) {
    builder.issues.push({
      tone: "error",
      message: `${scope.trail}：${what} 的位宽无法解析（${formatExpr(expr)}）：${
        error instanceof Error ? error.message : "表达式无效"
      }`,
    });
    return constant(1);
  }
}

function boundaryPortTerm(
  builder: Builder,
  scope: ScopeInfo,
  node: GateNode,
): LinearTerm {
  const port = scope.version?.ports.find((item) => item.key === node.portKey);
  if (!port) {
    builder.issues.push({
      tone: "error",
      message: `${scope.trail}：边界端点「${node.label}」没有对应的端口身份，请重新定义端口`,
    });
    return constant(1);
  }
  return termIn(builder, scope, port.width, `边界端口「${port.name}」`);
}

function sourceWire(
  scope: ScopeInfo,
  node: GateNode,
  port: number,
): { wire: ScopeInfo["wires"][number]; endpoint: Endpoint } | null {
  for (const wire of scope.wires) {
    if (wire.to.nodeId !== node.id || wire.to.port !== port) continue;
    return { wire, endpoint: wire.from };
  }
  return null;
}

function concatTerm(builder: Builder, scope: ScopeInfo, node: GateNode): LinearTerm {
  let total = constant(0);
  let connected = 0;
  for (let port = 0; port < concatPorts(node); port++) {
    const found = sourceWire(scope, node, port);
    if (!found) continue;
    const term = outputTerm(builder, scope, found.endpoint.nodeId, found.endpoint);
    if (term) {
      total = addTerms(total, term);
      connected++;
    }
  }
  if (!connected)
    builder.issues.push({
      tone: "warning",
      message: `${scope.trail}：拼接器「${node.label}」还没有连接输入段`,
    });
  return total;
}

/** Width of an output port (the bus this endpoint emits). */
function outputTerm(
  builder: Builder,
  scope: ScopeInfo,
  nodeId: string,
  endpoint?: Endpoint,
): LinearTerm | null {
  const node = scope.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const key = endpoint?.portKey;
  const index = endpoint?.port ?? 0;
  const cacheKey = `${scope.path}|out|${nodeId}|${key ?? `#${index}`}`;
  const cached = builder.outputCache.get(cacheKey);
  if (cached) return cached;
  let term: LinearTerm | null = null;
  if (node.kind === "SUBCIRCUIT") {
    const child = scope.children.get(node.id);
    const port = findPort(child?.version, "output", key, index);
    if (!port || !child) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：实例「${node.label}」的输出端口已不存在（连线需处理）`,
      });
      term = null;
    } else {
      term = termIn(builder, child, port.width, `实例「${node.label}」输出「${port.name}」`);
    }
  } else if (node.kind === "SLICE") {
    term = constant(clampWidth(node.sliceWidth ?? 1));
  } else if (node.kind === "CONCAT") {
    term = concatTerm(builder, scope, node);
  } else if (node.kind === "SUBPORT_IN" || node.kind === "SUBPORT_OUT") {
    term = boundaryPortTerm(builder, scope, node);
  } else if (node.kind === "INPUT" || node.kind === "OUTPUT") {
    term = constant(clampWidth(node.width ?? 1));
  } else {
    term = netVar(builder, scope, node);
  }
  if (term) builder.outputCache.set(cacheKey, term);
  return term;
}

/** Width that an input port requires. */
function inputTerm(
  builder: Builder,
  scope: ScopeInfo,
  nodeId: string,
  endpoint?: Endpoint,
): LinearTerm | null {
  const node = scope.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  const key = endpoint?.portKey;
  const index = endpoint?.port ?? 0;
  const cacheKey = `${scope.path}|in|${nodeId}|${key ?? `#${index}`}`;
  const cached = builder.inputCache.get(cacheKey);
  if (cached) return cached;
  let term: LinearTerm | null = null;
  if (node.kind === "SLICE" || node.kind === "CONCAT") {
    const found = sourceWire(scope, node, index);
    term = found
      ? outputTerm(builder, scope, found.endpoint.nodeId, found.endpoint)
      : null;
  } else if (node.kind === "SUBCIRCUIT") {
    const child = scope.children.get(node.id);
    const port = findPort(child?.version, "input", key, index);
    if (!port || !child) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：实例「${node.label}」的输入端口已不存在（连线需处理）`,
      });
      term = null;
    } else {
      term = termIn(builder, child, port.width, `实例「${node.label}」输入「${port.name}」`);
    }
  } else if (node.kind === "SUBPORT_IN" || node.kind === "SUBPORT_OUT") {
    term = boundaryPortTerm(builder, scope, node);
  } else if (node.kind === "INPUT" || node.kind === "OUTPUT") {
    term = constant(clampWidth(node.width ?? 1));
  } else {
    term = netVar(builder, scope, node);
  }
  if (term) builder.inputCache.set(cacheKey, term);
  return term;
}

function endpointText(
  scope: ScopeInfo,
  node: GateNode,
  direction: "input" | "output",
  endpoint?: Endpoint,
): string {
  const index = endpoint?.port ?? 0;
  if (node.kind === "SUBCIRCUIT") {
    const child = scope.children.get(node.id);
    const port = findPort(child?.version, direction, endpoint?.portKey, index);
    return `${node.label}.${port?.name ?? `?${index + 1}`}`;
  }
  if (node.kind === "SLICE") return direction === "input" ? `${node.label}.IN` : `${node.label}.OUT`;
  if (node.kind === "CONCAT") return direction === "input" ? `${node.label}.IN${index + 1}` : `${node.label}.OUT`;
  if (node.kind === "SUBPORT_IN" || node.kind === "SUBPORT_OUT" || node.kind === "INPUT" || node.kind === "OUTPUT")
    return node.label;
  return direction === "input" ? `${node.label}.IN${index + 1}` : `${node.label}.OUT`;
}

function pushEquation(
  builder: Builder,
  scope: ScopeInfo,
  left: LinearTerm,
  right: LinearTerm,
  op: "eq" | "ge",
  origin: string,
): void {
  const terms = new Map<string, number>();
  const merge = (source: Map<string, number>, factor: number) => {
    for (const [id, coefficient] of source)
      terms.set(id, (terms.get(id) ?? 0) + coefficient * factor);
  };
  merge(left.coeffs, 1);
  merge(right.coeffs, -1);
  for (const [id, coefficient] of terms) if (coefficient === 0) terms.delete(id);
  builder.equations.push({
    terms,
    constant: left.constant - right.constant,
    op,
    origin,
    scopePath: scope.path,
    scopeLabel: scope.trail,
  });
}

/* ------------------------------------------------------------------ */
/* Scope construction                                                  */
/* ------------------------------------------------------------------ */

function buildScope(builder: Builder, scope: ScopeInfo, stack: string[]): void {
  for (const node of scope.nodes) {
    if (node.kind !== "SUBCIRCUIT") continue;
    const def = defFor(builder.library, node.defId);
    const version = versionFor(builder.library, node.defId, node.defVersion);
    if (!def || !version) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：实例「${node.label}」引用的子电路定义不存在（${node.defId ?? "未知"} v${node.defVersion ?? "?"}）`,
      });
      continue;
    }
    if (!def.versions.some((item) => item.version === node.defVersion)) {
      builder.issues.push({
        tone: "warning",
        message: `${scope.trail}：实例「${node.label}」固定的 v${node.defVersion} 已不存在，暂按 v${version.version} 计算`,
      });
    }
    if (stack.includes(def.id)) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：子电路递归引用已阻止（${[...stack, def.id].join(" → ")}）`,
      });
      continue;
    }
    if (stack.length >= MAX_DEPTH) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：子电路嵌套超过 ${MAX_DEPTH} 层，已停止展开`,
      });
      continue;
    }
    const path = childPath(scope.path, node.id);
    const trail = `${scope.trail} → ${node.label}`;
    const child = makeScope(path, node, def, version, version.nodes, version.wires, trail);
    child.paramTerms = instanceParamTerms(builder, scope, node, version);
    scope.children.set(node.id, child);
    builder.scopes.set(path, child);
    builder.names.set(path, trail);
    stack.push(def.id);
    buildScope(builder, child, stack);
    stack.pop();
  }

  for (const wire of scope.wires) {
    const source = scope.nodes.find((node) => node.id === wire.from.nodeId);
    const target = scope.nodes.find((node) => node.id === wire.to.nodeId);
    if (!source || !target) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：连线 ${wire.id} 引用了不存在的元件`,
      });
      continue;
    }
    const fromLabel = endpointText(scope, source, "output", wire.from);
    const fromTerm = outputTerm(builder, scope, source.id, wire.from);
    if (!fromTerm) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：${fromLabel} 的位宽无法解析`,
      });
      continue;
    }
    if (target.kind === "SUBPORT_IN") {
      builder.issues.push({
        tone: "warning",
        message: `${scope.trail}：边界输入「${target.label}」不能作为连线终点，此连线已忽略`,
      });
      continue;
    }
    void 0;
    if (target.kind === "CONCAT") {
      // Concatenation takes any width per segment; the output is their sum.
      continue;
    }
    if (target.kind === "SLICE") {
      const need = Math.max(0, Math.round(target.sliceOffset ?? 0)) + clampWidth(target.sliceWidth ?? 1);
      pushEquation(
        builder,
        scope,
        fromTerm,
        constant(need),
        "ge",
        `${fromLabel} → ${endpointText(scope, target, "input", wire.to)}（需要 ${need} 位）`,
      );
      continue;
    }
    const toTerm = inputTerm(builder, scope, target.id, wire.to);
    if (!toTerm) {
      builder.issues.push({
        tone: "error",
        message: `${scope.trail}：${endpointText(scope, target, "input", wire.to)} 的位宽无法解析`,
      });
      continue;
    }
    pushEquation(
      builder,
      scope,
      fromTerm,
      toTerm,
      "eq",
      `${fromLabel} → ${endpointText(scope, target, "input", wire.to)}`,
    );
  }

  for (const wire of scope.wires) {
    for (const [endpoint, direction, label] of [
      [wire.from, "output", "输出"],
      [wire.to, "input", "输入"],
    ] as const) {
      const node = scope.nodes.find((item) => item.id === endpoint.nodeId);
      if (!node || node.kind !== "SUBCIRCUIT") continue;
      const child = scope.children.get(node.id);
      if (!child?.version) continue;
      if (endpoint.portKey && portIndexByKey(child.version, direction, endpoint.portKey) < 0)
        builder.issues.push({
          tone: "error",
          message: `${scope.trail}：连线 ${wire.id} 引用的${label}端口已不在「${node.label}」v${child.version.version} 中，请改接或删除该线路`,
        });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Solver                                                              */
/* ------------------------------------------------------------------ */

interface Bounds {
  lo: number;
  hi: number;
}

interface Solved {
  values: Map<string, number>;
  feasible: Map<string, Set<number>>;
  options: ParamOption[];
  conflict: WidthConflict | null;
}

function equationValue(equation: Equation, assignment: Map<string, number>): number | null {
  let total = equation.constant;
  for (const [id, coefficient] of equation.terms) {
    const value = assignment.get(id);
    if (value === undefined) return null;
    total += coefficient * value;
  }
  return total;
}

function partialFeasible(equations: Equation[], assignment: Map<string, number>): boolean {
  for (const equation of equations) {
    const value = equationValue(equation, assignment);
    if (value === null) continue;
    if (equation.op === "eq" && value !== 0) return false;
    if (equation.op === "ge" && value < 0) return false;
  }
  return true;
}

function componentsOf(
  variables: WidthVar[],
  equations: Equation[],
): { vars: WidthVar[]; equations: Equation[] }[] {
  const ids = new Set(variables.map((item) => item.id));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  for (const id of ids) parent.set(id, id);
  for (const equation of equations) {
    const members = [...equation.terms.keys()].filter((id) => ids.has(id));
    for (let index = 1; index < members.length; index++) {
      const a = find(members[0]),
        b = find(members[index]);
      if (a !== b) parent.set(a, b);
    }
  }
  const groups = new Map<string, WidthVar[]>();
  for (const variable of variables) {
    const root = find(variable.id);
    const group = groups.get(root) ?? [];
    group.push(variable);
    groups.set(root, group);
  }
  return [...groups.values()].map((group) => {
    const members = new Set(group.map((item) => item.id));
    return {
      vars: group.sort((a, b) => a.id.localeCompare(b.id)),
      equations: equations.filter((equation) =>
        [...equation.terms.keys()].some((id) => members.has(id)) && equation.terms.size > 0,
      ),
    };
  });
}

function v0min(variables: Map<string, WidthVar>, id: string): number {
  return variables.get(id)?.lo ?? MIN_WIDTH;
}

function solve(
  variables: Map<string, WidthVar>,
  equations: Equation[],
  scopeTrail: (path: string) => string,
): Solved {
  const bounds = new Map<string, Bounds>();
  for (const v of variables.values()) bounds.set(v.id, { lo: v.lo, hi: v.hi });

  const conflictFor = (equation: Equation, message?: string): WidthConflict => {
    const related = new Set<string>(equation.terms.keys());
    const chain: string[] = [];
    const seen = new Set<Equation>();
    const queue: Equation[] = [equation];
    while (queue.length && chain.length < 8) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      chain.push(`${scopeTrail(current.scopePath)}：${current.origin}`);
      for (const id of current.terms.keys()) {
        related.add(id);
        for (const other of equations)
          if (!seen.has(other) && other.terms.has(id)) queue.push(other);
      }
    }
    return {
      message: message ?? `${scopeTrail(equation.scopePath)}：${equation.origin}`,
      scopePath: equation.scopePath,
      origin: equation.origin,
      chain,
    };
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const equation of equations) {
      const entries = [...equation.terms.entries()].filter(([id]) => variables.has(id));
      if (!entries.length) {
        if (equation.op === "eq" && equation.constant !== 0)
          return {
            values: new Map(),
            feasible: new Map(),
            options: [],
            conflict: conflictFor(
              equation,
              `${scopeTrail(equation.scopePath)}：${equation.origin} 要求两端同宽，但固定位宽相差 ${Math.abs(equation.constant)} 位`,
            ),
          };
        if (equation.op === "ge" && equation.constant < 0)
          return {
            values: new Map(),
            feasible: new Map(),
            options: [],
            conflict: conflictFor(
              equation,
              `${scopeTrail(equation.scopePath)}：${equation.origin} 的切片超出固定总线宽`,
            ),
          };
        continue;
      }
      for (const [id, coefficient] of entries) {
        let min = equation.constant,
          max = equation.constant;
        for (const [otherId, otherCoefficient] of entries) {
          if (otherId === id) continue;
          const range = bounds.get(otherId)!;
          const a = otherCoefficient * range.lo,
            b = otherCoefficient * range.hi;
          min += Math.min(a, b);
          max += Math.max(a, b);
        }
        let lo: number, hi: number;
        if (equation.op === "eq") {
          lo = Math.ceil(Math.min(-min / coefficient, -max / coefficient) - 1e-9);
          hi = Math.floor(Math.max(-min / coefficient, -max / coefficient) + 1e-9);
        } else {
          // coefficient·x + rest >= 0. Bound x by the worst case of the rest.
          const otherMin = min - coefficient * 0;
          const otherMax = max;
          void otherMin;
          if (coefficient > 0) {
            // x >= (-rest)/coefficient, use rest max to get a valid but weak bound;
            // bounds are tightened by enumeration, so only clamp to the domain here.
            lo = -Infinity;
            hi = Infinity;
            void otherMax;
          } else {
            lo = -Infinity;
            hi = Infinity;
          }
        }
        const current = bounds.get(id) ?? { lo: v0min(variables, id), hi: MAX_WIDTH };
        const next = {
          lo: Math.max(current.lo, Number.isFinite(lo) ? lo : current.lo),
          hi: Math.min(current.hi, Number.isFinite(hi) ? hi : current.hi),
        };
        if (next.lo > next.hi)
          return {
            values: new Map(),
            feasible: new Map(),
            options: [],
            conflict: conflictFor(
              equation,
              `${scopeTrail(equation.scopePath)}：${equation.origin} 与其他约束冲突（参数 ${variables.get(id)?.label ?? id} 没有可行取值）`,
            ),
          };
        if (next.lo !== current.lo || next.hi !== current.hi) {
          bounds.set(id, next);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Slice inequality tightening for single-variable cases.
  for (const equation of equations) {
    if (equation.op !== "ge") continue;
    const entries = [...equation.terms.entries()].filter(([id]) => variables.has(id));
    if (entries.length === 1 && entries[0][1] === 1) {
      const current = bounds.get(entries[0][0]) ?? { lo: MIN_WIDTH, hi: MAX_WIDTH };
      const lo = Math.max(current.lo, -equation.constant);
      if (lo <= current.hi) bounds.set(entries[0][0], { lo, hi: current.hi });
    }
  }

  const values = new Map<string, number>();
  for (const v of variables.values()) {
    const range = bounds.get(v.id) ?? { lo: v.lo, hi: v.hi };
    values.set(v.id, Math.min(Math.max(v.fallback, range.lo), range.hi));
  }

  const components = componentsOf([...variables.values()], equations);
  const feasible = new Map<string, Set<number>>();
  for (const v of variables.values()) feasible.set(v.id, new Set());

  const componentSolutions: { vars: WidthVar[]; solutions: Map<string, number>[]; chosen: Map<string, number> }[] = [];

  for (const component of components) {
    if (!component.equations.length) continue;
    const varList = component.vars;
    const solutions: Map<string, number>[] = [];
    const assignment = new Map<string, number>();
    let aborted = false;
    const recurse = (index: number): void => {
      if (solutions.length >= MAX_SOLUTIONS) {
        aborted = true;
        return;
      }
      if (index === varList.length) {
        if (!partialFeasible(component.equations, assignment)) return;
        solutions.push(new Map(assignment));
        return;
      }
      const v = varList[index];
      const range = bounds.get(v.id) ?? { lo: v.lo, hi: v.hi };
      for (let value = range.lo; value <= range.hi; value++) {
        assignment.set(v.id, value);
        if (partialFeasible(component.equations, assignment)) recurse(index + 1);
        if (solutions.length >= MAX_SOLUTIONS) {
          aborted = true;
          break;
        }
      }
      assignment.delete(v.id);
    };
    recurse(0);

    if (!solutions.length) {
      const equation =
        component.equations.find((item) => item.op === "eq") ?? component.equations[0];
      return {
        values,
        feasible,
        options: [],
        conflict: conflictFor(
          equation,
          `${scopeTrail(equation.scopePath)}：${equation.origin} 与其他约束没有整数解；请检查实例参数、端口位宽与外接线宽`,
        ),
      };
    }
    for (const solution of solutions)
      for (const [id, value] of solution) feasible.get(id)?.add(value);

    let chosen = solutions[0],
      best = Infinity;
    for (const solution of solutions) {
      let distance = 0;
      for (const v of varList)
        distance += Math.abs((solution.get(v.id) ?? v.fallback) - v.fallback);
      if (distance < best) {
        chosen = solution;
        best = distance;
      }
    }
    for (const [id, value] of chosen) values.set(id, value);
    componentSolutions.push({ vars: varList, solutions, chosen });
    if (aborted)
      // enumeration stopped early; ambiguity is signalled by multiple feasible values
      void 0;
  }

  const options: ParamOption[] = [];
  const paramVars = [...variables.values()].filter((v) => v.kind === "param");
  if (paramVars.length) {
    const paramComponents = componentSolutions.filter((component) =>
      component.vars.some((v) => v.kind === "param"),
    );
    let combos: Map<string, number>[] = [new Map()];
    for (const component of paramComponents) {
      const distinct = new Map<string, Map<string, number>>();
      for (const solution of component.solutions) {
        const signature = component.vars.map((v) => solution.get(v.id) ?? 0).join(",");
        if (!distinct.has(signature)) distinct.set(signature, solution);
      }
      const next: Map<string, number>[] = [];
      for (const base of combos) {
        for (const solution of distinct.values()) {
          if (next.length >= MAX_OPTIONS * 8) break;
          next.push(new Map([...base, ...solution]));
        }
        if (next.length >= MAX_OPTIONS * 8) break;
      }
      combos = next;
    }
    const seen = new Set<string>();
    for (const combo of combos) {
      const params: Record<string, Record<string, number>> = {};
      let distance = 0;
      for (const v of paramVars) {
        const value = combo.get(v.id);
        if (value === undefined) continue;
        params[v.scopePath] ??= {};
        params[v.scopePath][v.param!] = value;
        distance += Math.abs(value - v.fallback);
      }
      if (!Object.keys(params).length) continue;
      const signature = JSON.stringify(params);
      if (seen.has(signature)) continue;
      seen.add(signature);
      options.push({ params, distance });
    }
    options.sort((a, b) => a.distance - b.distance);
    options.splice(MAX_OPTIONS);
  }

  return { values, feasible, options, conflict: null };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function buildWidthModel(
  document: CircuitDocument,
  library: readonly SubcircuitDef[],
): WidthModel {
  const root = makeScope("", null, null, null, document.nodes, document.wires, "实验台");
  const builder: Builder = {
    library,
    variables: new Map(),
    equations: [],
    scopes: new Map([["", root]]),
    issues: [],
    outputCache: new Map(),
    inputCache: new Map(),
    names: new Map(),
  };
  buildScope(builder, root, []);
  const trailFor = (path: string): string => {
    if (!path) return "实验台";
    const labels: string[] = [];
    let cursor = "";
    for (const segment of path.split("/")) {
      cursor = childPath(cursor, segment);
      labels.push(builder.names.get(cursor) ?? segment);
    }
    return labels.join(" → ");
  };
  const outcome = solve(builder.variables, builder.equations, trailFor);

  const termWidth = (term: LinearTerm | null): number | null => {
    if (!term) return null;
    try {
      const value = termValue(term, outcome.values);
      if (!Number.isInteger(value) || value < MIN_WIDTH || value > MAX_WIDTH) return null;
      return value;
    } catch {
      return null;
    }
  };

  const issues = [...builder.issues];
  if (outcome.conflict) {
    issues.push({
      tone: "error",
      message: `位宽约束冲突：${outcome.conflict.message}。${
        outcome.conflict.chain.length
          ? `跨嵌套约束链：${outcome.conflict.chain.join("；")}`
          : ""
      }`,
    });
  }

  const scopeOf = (path: string): ScopeInfo => builder.scopes.get(path) ?? root;
  const nodeOf = (path: string, nodeId: string): GateNode | null =>
    scopeOf(path).nodes.find((node) => node.id === nodeId) ?? null;

  const portWidth: WidthModel["portWidth"] = (path, nodeId, direction, key, index) => {
    const scope = scopeOf(path);
    const node = nodeOf(path, nodeId);
    if (!node) return null;
    const endpoint: Endpoint = { nodeId, port: index, portKey: key };
    const term =
      direction === "output"
        ? outputTerm(builder, scope, nodeId, endpoint)
        : inputTerm(builder, scope, nodeId, endpoint);
    return termWidth(term);
  };

  const nodePorts: WidthModel["nodePorts"] = (path, nodeId) => {
    const scope = scopeOf(path);
    const node = nodeOf(path, nodeId);
    if (!node) return [];
    if (node.kind === "SUBCIRCUIT") {
      const child = scope.children.get(nodeId);
      if (!child?.version) return [];
      return (
        ["input", "output"] as const
      ).flatMap((direction) =>
        portsOf(child.version, direction).map((port, index) => ({
          key: port.key,
          name: port.name,
          direction,
          index,
          width: portWidth(path, nodeId, direction, port.key, index),
          expr: formatExpr(port.width),
        })),
      );
    }
    const counts = portCounts(node);
    const version = scope.version;
    const boundaryPorts = version?.ports ?? [];
    const inputs: PortSummary[] = Array.from({ length: counts.inputs }, (_, index) => {
      let name = `IN${index + 1}`;
      let key = `in${index}`;
      if (node.kind === "SLICE") name = "总线";
      else if (node.kind === "CONCAT") name = `段 ${index + 1}`;
      else if (node.kind === "SUBPORT_OUT") {
        const port = boundaryPorts.find((item) => item.key === node.portKey);
        if (port) name = port.name;
      }
      return {
        key,
        name,
        direction: "input",
        index,
        width: portWidth(path, nodeId, "input", key, index),
        expr: `${portWidth(path, nodeId, "input", key, index) ?? "?"}`,
      };
    });
    const outputs: PortSummary[] = Array.from({ length: counts.outputs }, (_, index) => {
      let name = "OUT";
      let key = `out${index}`;
      if (node.kind === "SLICE") name = "切片";
      else if (node.kind === "CONCAT") name = "拼接";
      else if (node.kind === "SUBPORT_IN") {
        const port = boundaryPorts.find((item) => item.key === node.portKey);
        if (port) name = port.name;
      } else if (node.kind === "INPUT" || node.kind === "OUTPUT") name = node.label;
      return {
        key,
        name,
        direction: "output",
        index,
        width: portWidth(path, nodeId, "output", key, index),
        expr: `${portWidth(path, nodeId, "output", key, index) ?? "?"}`,
      };
    });
    return [...inputs, ...outputs];
  };

  const instances: InstanceSummary[] = [];
  for (const scope of builder.scopes.values()) {
    if (!scope.node || !scope.version || !scope.def) continue;
    const params: ParamState[] = scope.params.map((spec) => {
        const term = scope.paramTerms.get(spec.name) ?? constant(spec.default);
      const literal = isConstantTerm(term) ? term.constant : null;
      const direct =
        term.coeffs.size === 1 && term.constant === 0
          ? builder.variables.get([...term.coeffs.keys()][0])
          : undefined;
      const feasibleValues = direct ? outcome.feasible.get(direct.id) : undefined;
      const resolved = literal ?? termWidth(term);
      return {
        name: spec.name,
        value: resolved,
        source:
          literal !== null ? "literal" : resolved !== null ? "inferred" : "free",
        min: spec.min,
        max: spec.max,
        frees: feasibleValues ? [...feasibleValues].sort((a, b) => a - b).slice(0, 16) : [],
      };
    });
    const ports: PortSummary[] = (["input", "output"] as const).flatMap((direction) =>
      portsOf(scope.version, direction).map((port, index) => {
        let width: number | null = null;
        try {
          width = termWidth(toLinear(port.width, scope.paramTerms));
        } catch {
          width = null;
        }
        return {
          key: port.key,
          name: port.name,
          direction,
          index,
          width,
          expr: formatExpr(port.width),
        };
      }),
    );
    instances.push({
      path: scope.path,
      nodeId: scope.node.id,
      label: scope.label,
      defId: scope.def.id,
      defName: scope.def.name,
      version: scope.version.version,
      versions: scope.def.versions.map((item) => item.version),
      params,
      ports,
      ambiguous: params.some((param) => (param.frees.length || 0) > 1),
      unresolved: params.some((param) => param.value === null) || ports.some((port) => port.width === null),
    });
  }

  for (const summary of instances) {
    if (summary.unresolved)
      issues.push({
        tone: "warning",
        message: `实例「${summary.label}」有位宽参数或端口无法确定；请接线或显式填写参数。`,
      });
    else if (summary.ambiguous) {
      const detail = summary.params
        .filter((param) => param.frees.length > 1)
        .map((param) => `${param.name} ∈ {${param.frees.join("、")}}，当前 ${param.value}`)
        .join("；");
      issues.push({
        tone: "warning",
        message: `实例「${summary.label}」参数多解（${detail}）。可在实例面板中选用其他组合，或直接填宽。`,
      });
    }
  }
  if (outcome.options.length > 1)
    issues.push({
      tone: "warning",
      message: `接线允许 ${outcome.options.length} 组参数组合；已按最接近默认值的一组运行，可在实例面板切换。`,
    });

  const deduped: SimulationIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.tone}|${issue.message}`;
    if (!issue.message || seen.has(key)) continue;
    seen.add(key);
    deduped.push(issue);
  }

  const model: WidthModel = {
    ok: !deduped.some((issue) => issue.tone === "error"),
    issues: deduped,
    scopes: builder.scopes,
    root,
    variables: builder.variables,
    values: outcome.values,
    options: outcome.options,
    instances,
    conflict: outcome.conflict,
    termWidth,
    portWidth,
    inputWidth(path, nodeId, endpoint) {
      const scope = scopeOf(path);
      if (!nodeOf(path, nodeId)) return null;
      return termWidth(inputTerm(builder, scope, nodeId, endpoint));
    },
    outputWidth(path, nodeId, endpoint) {
      const scope = scopeOf(path);
      if (!nodeOf(path, nodeId)) return null;
      return termWidth(outputTerm(builder, scope, nodeId, endpoint));
    },
    nodePorts,
    instanceSummary(path) {
      return instances.find((item) => item.path === path);
    },
    scope(path) {
      return builder.scopes.get(path);
    },
  };
  return model;
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

export function busOf(value: Signal, width: number): Signal[] {
  return Array.from({ length: Math.max(0, width) }, () => value);
}

export function busText(bus: Signal[] | undefined): string {
  if (!bus?.length) return "X";
  if (bus.length === 1) return String(bus[0]);
  return `0b${[...bus].reverse().map((bit) => (bit === "X" ? "x" : String(bit))).join("")}`;
}

export function busNumber(bus: Signal[] | undefined): number | null {
  if (!bus?.length) return null;
  let value = 0;
  for (let index = bus.length - 1; index >= 0; index--) {
    const bit = bus[index];
    if (bit === "X") return null;
    value = value * 2 + bit;
  }
  return value;
}

export function busHex(bus: Signal[] | undefined): string {
  const value = busNumber(bus);
  return value === null ? "0x?" : `0x${value.toString(16).toUpperCase()}`;
}

export function joinPath(parent: string, nodeId: string): string {
  return parent ? `${parent}/${nodeId}` : nodeId;
}

export function instanceLabel(scope: ScopeInfo): string {
  return scope.label;
}

export function isKnownWidth(width: number | null): width is number {
  return width !== null && Number.isInteger(width) && width >= MIN_WIDTH && width <= MAX_WIDTH;
}

export function defaultParamArgs(version: SubcircuitVersion | null): Record<string, WidthExpr> {
  const args: Record<string, WidthExpr> = {};
  for (const param of version?.params ?? [])
    args[param.name] = { kind: "const", value: param.default };
  return args;
}

export function widthExprText(expr: WidthExpr): string {
  return formatExpr(expr);
}

export { ExprError, MAX_WIDTH, MIN_WIDTH };
