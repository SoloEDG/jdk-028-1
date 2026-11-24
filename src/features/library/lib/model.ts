import type {
  BoundaryPort,
  CircuitDocument,
  Endpoint,
  GateNode,
  SubcircuitDef,
  SubcircuitVersion,
  WidthExpr,
  WidthParamSpec,
} from "@/shared/types";
import { createId } from "@/shared/document";
import {
  MAX_WIDTH,
  MIN_WIDTH,
  checkExprBounds,
  exprParams,
  formatExpr,
  parseExpr,
} from "./expr";
import { concatPorts, portsOf, versionFor } from "./widths";

export const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,15}$/;

export interface LibraryIssue {
  tone: "error" | "warning";
  defName: string;
  version?: number;
  message: string;
}

export function latestVersion(def: SubcircuitDef): SubcircuitVersion | undefined {
  return def.versions[def.versions.length - 1];
}

export function cloneDefinition(def: SubcircuitDef): SubcircuitDef {
  return JSON.parse(JSON.stringify(def)) as SubcircuitDef;
}

/** All definitions a definition body refers to (transitively is handled by callers). */
export function directDependencies(def: SubcircuitDef): string[] {
  const ids = new Set<string>();
  const version = latestVersion(def);
  for (const node of version?.nodes ?? []) if (node.defId) ids.add(node.defId);
  return [...ids];
}

/**
 * Detect direct and indirect recursion. Returns the offending cycle as a chain
 * of definition names, or null when the library is acyclic.
 */
export function findRecursion(
  library: readonly SubcircuitDef[],
  startId?: string,
): string[] | null {
  const byId = new Map(library.map((def) => [def.id, def]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];

  const walk = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const from = stack.indexOf(id);
      return [...stack.slice(from), id].map((item) => byId.get(item)?.name ?? item);
    }
    if (done.has(id)) return null;
    visiting.add(id);
    stack.push(id);
    for (const dependency of directDependenciesFor(library, id)) {
      if (!byId.has(dependency)) continue;
      const cycle = walk(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    done.add(id);
    return null;
  };

  const roots = startId ? [startId] : library.map((def) => def.id);
  for (const root of roots) {
    const cycle = walk(root);
    if (cycle) return cycle;
  }
  return null;
}

function directDependenciesFor(
  library: readonly SubcircuitDef[],
  id: string,
): string[] {
  const def = library.find((item) => item.id === id);
  return def ? directDependencies(def) : [];
}

export function referencedDefinitions(
  library: readonly SubcircuitDef[],
  defId: string,
): Set<string> {
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dependency of directDependenciesFor(library, id)) visit(dependency);
  };
  visit(defId);
  return seen;
}

export function validateDefinition(
  def: SubcircuitDef,
  library: readonly SubcircuitDef[],
): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  const push = (message: string, version?: number, tone: "error" | "warning" = "error") =>
    issues.push({ tone, defName: def.name, version, message });

  if (!def.name.trim()) push("子电路必须有名子");
  if (def.name.length > 40) push("子电路名称过长（最多 40 字）");
  if (!def.versions.length) push("子电路至少需要一个版本");

  const versionNumbers = new Set<number>();
  for (const version of def.versions) {
    if (versionNumbers.has(version.version)) push(`版本号 v${version.version} 重复`, version.version);
    versionNumbers.add(version.version);

    const paramNames = new Set<string>();
    for (const param of version.params) {
      if (!PARAM_NAME.test(param.name))
        push(`v${version.version} 参数名「${param.name}」不合法`, version.version);
      if (paramNames.has(param.name))
        push(`v${version.version} 参数 ${param.name} 重复`, version.version);
      paramNames.add(param.name);
      if (
        !Number.isInteger(param.min) ||
        !Number.isInteger(param.max) ||
        !Number.isInteger(param.default)
      )
        push(`v${version.version} 参数 ${param.name} 必须是整数`, version.version);
      if (param.min < MIN_WIDTH || param.max > MAX_WIDTH || param.min > param.max)
        push(
          `v${version.version} 参数 ${param.name} 的取值范围必须落在 ${MIN_WIDTH}–${MAX_WIDTH}`,
          version.version,
        );
      if (param.default < param.min || param.default > param.max)
        push(`v${version.version} 参数 ${param.name} 的默认值不在范围内`, version.version);
    }

    const keys = new Set<string>();
    const names = new Set<string>();
    for (const port of [...version.ports].sort((a, b) => a.direction.localeCompare(b.direction))) {
      if (!port.key) push(`v${version.version} 端口缺少稳定标识`, version.version);
      if (keys.has(port.key))
        push(`v${version.version} 端口标识 ${port.key} 重复`, version.version);
      keys.add(port.key);
      const trimmed = port.name.trim();
      if (!trimmed) push(`v${version.version} 端口名不能为空`, version.version);
      const labelled = `${port.direction}:${trimmed}`;
      if (names.has(labelled))
        push(`v${version.version} 端口名「${trimmed}」在${port.direction === "input" ? "输入" : "输出"}中重复`, version.version);
      names.add(labelled);
      for (const name of exprParams(port.width)) {
        if (!paramNames.has(name))
          push(
            `v${version.version} 端口「${trimmed}」引用了未定义的参数 ${name}`,
            version.version,
          );
      }
      const bounds = checkExprBounds(port.width, version.params, "端口位宽");
      if (bounds) push(`v${version.version} 端口「${trimmed}」：${bounds}`, version.version);
    }

    const inputPorts = portsOf(version, "input");
    const outputPorts = portsOf(version, "output");
    const nodeIds = new Set<string>();
    for (const node of version.nodes) {
      if (nodeIds.has(node.id))
        push(`v${version.version} 元件编号 ${node.id} 重复`, version.version);
      nodeIds.add(node.id);
      if (node.kind === "SUBPORT_IN" || node.kind === "SUBPORT_OUT") {
        const direction = node.kind === "SUBPORT_IN" ? "input" : "output";
        const list = direction === "input" ? inputPorts : outputPorts;
        if (!node.portKey || !list.some((port) => port.key === node.portKey))
          push(
            `v${version.version} 边界端点「${node.label}」没有对应的端口`,
            version.version,
          );
      }
      if (node.kind === "SUBCIRCUIT") {
        const target = versionFor(library, node.defId, node.defVersion);
        if (!target)
          push(
            `v${version.version} 实例「${node.label}」引用的子电路不存在`,
            version.version,
          );
        else if (node.defVersion !== target.version)
          push(
            `v${version.version} 实例「${node.label}」固定版本 v${node.defVersion} 不存在`,
            version.version,
          );
      }
    }
    const wires = new Set<string>();
    for (const wire of version.wires) {
      if (wires.has(wire.id)) push(`v${version.version} 连线编号重复`, version.version);
      wires.add(wire.id);
      const source = version.nodes.find((node) => node.id === wire.from.nodeId);
      const target = version.nodes.find((node) => node.id === wire.to.nodeId);
      if (!source || !target) {
        push(`v${version.version} 连线引用了不存在的元件`, version.version);
        continue;
      }
      if (target.kind === "SUBPORT_IN")
        push(`v${version.version} 边界输入不能被连线终点引用`, version.version);
      if (!endpointExists(source, wire.from, "output"))
        push(`v${version.version} 连线 ${wire.id} 的输出端点无效`, version.version);
      if (!endpointExists(target, wire.to, "input"))
        push(`v${version.version} 连线 ${wire.id} 的输入端点无效`, version.version);
    }
  }

  const ownCycle = findRecursion(
    library.some((item) => item.id === def.id) ? library : [...library, def],
    def.id,
  );
  if (ownCycle)
    issues.push({
      tone: "error",
      defName: def.name,
      message: `子电路存在递归引用：${ownCycle.join(" → ")}，请先断开循环`,
    });

  return issues;
}

export function endpointExists(
  node: GateNode,
  endpoint: Endpoint,
  direction: "input" | "output",
  library?: readonly SubcircuitDef[],
): boolean {
  if (node.kind === "SUBCIRCUIT") {
    if (!library) return true;
    const version = versionFor(library, node.defId, node.defVersion);
    return portsOf(version, direction).some((port) => port.key === endpoint.portKey);
  }
  const counts = portCountsForValidation(node);
  const count = direction === "input" ? counts.inputs : counts.outputs;
  if (endpoint.port < 0 || endpoint.port >= count) return false;
  if (node.kind === "SUBPORT_IN" && direction === "output") return endpoint.port === 0;
  if (node.kind === "SUBPORT_OUT" && direction === "input") return endpoint.port === 0;
  return true;
}

function portCountsForValidation(node: GateNode): { inputs: number; outputs: number } {
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

export function validateLibrary(library: readonly SubcircuitDef[]): LibraryIssue[] {
  const issues: LibraryIssue[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const def of library) {
    if (ids.has(def.id))
      issues.push({ tone: "error", defName: def.name, message: "子电路编号重复" });
    ids.add(def.id);
    if (names.has(def.name))
      issues.push({ tone: "error", defName: def.name, message: "子电路名称重复" });
    names.add(def.name);
    issues.push(...validateDefinition(def, library));
  }
  const cycle = findRecursion(library);
  if (cycle)
    issues.push({
      tone: "error",
      defName: cycle[0],
      message: `子电路存在递归引用：${cycle.join(" → ")}，请先断开循环`,
    });
  return issues;
}

/* ------------------------------------------------------------------ */
/* Port editing (version publishing)                                  */
/* ------------------------------------------------------------------ */

export interface PortEdit {
  key: string;
  name: string;
  width: string;
  direction: "input" | "output";
}

export function portFromEdit(edit: PortEdit): BoundaryPort {
  return {
    key: edit.key,
    name: edit.name.trim(),
    direction: edit.direction,
    width: parseExpr(edit.width),
  };
}

export function paramFromEdit(edit: {
  name: string;
  min: number;
  max: number;
  default: number;
}): WidthParamSpec {
  return { ...edit };
}

/**
 * Publish a new version by cloning the latest body and applying port/param edits.
 * Port keys survive renaming and reordering; removed ports also remove the
 * boundary body node so the definition stays internally consistent.
 */
export function publishVersion(
  def: SubcircuitDef,
  edits: {
    name: string;
    params: WidthParamSpec[];
    ports: BoundaryPort[];
    note: string;
  },
): SubcircuitDef {
  const previous = latestVersion(def);
  const body = previous
    ? (JSON.parse(JSON.stringify({
        nodes: previous.nodes,
        wires: previous.wires,
      })) as { nodes: GateNode[]; wires: { id: string; from: Endpoint; to: Endpoint }[] })
    : { nodes: [], wires: [] };
  const keptKeys = new Set(edits.ports.map((port) => port.key));
  const removedKeys = new Set(
    (previous?.ports ?? [])
      .filter((port) => !keptKeys.has(port.key))
      .map((port) => port.key),
  );
  const removedNodes = new Set(
    body.nodes
      .filter(
        (node) =>
          (node.kind === "SUBPORT_IN" || node.kind === "SUBPORT_OUT") &&
          node.portKey &&
          removedKeys.has(node.portKey),
      )
      .map((node) => node.id),
  );
  body.nodes = body.nodes
    .filter((node) => !removedNodes.has(node.id))
    .map((node) => {
      if (node.kind !== "SUBPORT_IN" && node.kind !== "SUBPORT_OUT") return node;
      const port = edits.ports.find((item) => item.key === node.portKey);
      return port ? { ...node, label: port.name } : node;
    });
  body.wires = body.wires.filter(
    (wire) => !removedNodes.has(wire.from.nodeId) && !removedNodes.has(wire.to.nodeId),
  );
  const next: SubcircuitVersion = {
    version: Math.max(0, ...def.versions.map((item) => item.version)) + 1,
    params: edits.params.map((param) => ({ ...param })),
    ports: edits.ports.map((port) => ({ ...port })),
    nodes: body.nodes,
    wires: body.wires,
    note: edits.note,
    createdAt: Date.now(),
  };
  return { ...def, name: edits.name.trim() || def.name, versions: [...def.versions, next] };
}

export function newDefinition(
  name: string,
  version: Omit<SubcircuitVersion, "version" | "createdAt">,
): SubcircuitDef {
  return {
    id: createId("def"),
    name: name.trim() || "未命名子电路",
    versions: [{ ...version, version: 1, createdAt: Date.now() }],
  };
}

/** Rename/reorder safe lookup used everywhere wiring is interpreted. */
export function resolveSubPort(
  version: SubcircuitVersion | null | undefined,
  direction: "input" | "output",
  endpoint: Endpoint,
) {
  const ports = portsOf(version, direction);
  if (endpoint.portKey) {
    const byKey = ports.find((port) => port.key === endpoint.portKey);
    if (byKey) return byKey;
  }
  return ports[endpoint.port];
}

export function portWidthPreview(
  port: BoundaryPort,
  params: readonly WidthParamSpec[],
): string {
  const bounds = checkExprBounds(port.width, params, "端口位宽");
  return bounds ?? formatExpr(port.width);
}

export function nextPortName(
  ports: readonly BoundaryPort[],
  direction: "input" | "output",
  base: string,
): string {
  const prefix = direction === "input" ? "IN" : "OUT";
  const used = new Set(ports.map((port) => port.name));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}${index}`)) index++;
  void prefix;
  return `${base}${index}`;
}

export function definitionUseCount(
  document: CircuitDocument,
  defId: string,
): number {
  let count = 0;
  const visit = (nodes: GateNode[]) => {
    for (const node of nodes) {
      if (node.kind !== "SUBCIRCUIT") continue;
      if (node.defId === defId) count++;
      const version = versionFor([], node.defId, node.defVersion);
      void version;
    }
  };
  visit(document.nodes);
  return count;
}

export function exprText(expr: WidthExpr): string {
  return formatExpr(expr);
}
