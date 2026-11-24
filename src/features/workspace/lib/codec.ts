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
import { getSpec } from "@/features/catalog/lib/specs";
import { topologicalOrder } from "@/features/circuit/lib/graph";
import { findRecursion, validateLibrary } from "@/features/library/lib/model";
import { portsOf, versionFor } from "@/features/library/lib/widths";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const objectOrNull = (value: unknown) =>
  object(value) ? (value as Record<string, unknown>) : null;

/* ------------------------------------------------------------------ */
/* Generic guards                                                      */
/* ------------------------------------------------------------------ */

const GATE_KINDS = new Set([
  "INPUT",
  "OUTPUT",
  "AND",
  "OR",
  "XOR",
  "NOT",
  "NAND",
  "NOR",
  "SLICE",
  "CONCAT",
  "SUBCIRCUIT",
  "SUBPORT_IN",
  "SUBPORT_OUT",
]);

function validInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/* ------------------------------------------------------------------ */
/* Width expression decoding                                           */
/* ------------------------------------------------------------------ */

export function decodeExpr(value: unknown): WidthExpr {
  const node = objectOrNull(value);
  if (!node) throw new Error("位宽表达式无效");
  switch (node.kind) {
    case "const":
      if (!validInteger(node.value, -64, 64)) throw new Error("位宽常数超出范围");
      return { kind: "const", value: node.value };
    case "param":
      if (typeof node.name !== "string" || !node.name) throw new Error("参数名无效");
      return { kind: "param", name: node.name };
    case "add":
    case "sub":
    case "mul":
      return {
        kind: node.kind,
        left: decodeExpr(node.left),
        right: decodeExpr(node.right),
      };
    default:
      throw new Error("未知的位宽表达式");
  }
}


/* ------------------------------------------------------------------ */
/* Node decoding                                                       */
/* ------------------------------------------------------------------ */

const COORD = { minX: 20, maxX: 880, minY: 32, maxY: 456 };

export interface DecodeContext {
  library: readonly SubcircuitDef[];
}

function decodeNode(value: unknown, ids: Set<string>, context: DecodeContext): GateNode {
  if (!object(value)) throw new Error("元件内容无效");
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 100 ||
    ids.has(value.id) ||
    typeof value.kind !== "string" ||
    !GATE_KINDS.has(value.kind) ||
    typeof value.label !== "string" ||
    value.label.length > 40 ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    (value.value !== 0 && value.value !== 1)
  )
    throw new Error("元件内容无效或编号重复");
  if (
    Number(value.x) < COORD.minX ||
    Number(value.x) > COORD.maxX ||
    Number(value.y) < COORD.minY ||
    Number(value.y) > COORD.maxY
  )
    throw new Error("元件坐标超出工作台范围");

  const kind = value.kind as GateNode["kind"];
  if (kind !== "SUBCIRCUIT" && kind !== "SUBPORT_IN" && kind !== "SUBPORT_OUT")
    getSpec(kind);
  ids.add(value.id);

  const node: GateNode = {
    id: value.id,
    kind,
    label: value.label,
    value: value.value,
    x: Number(value.x),
    y: Number(value.y),
  };

  if (kind === "INPUT" || kind === "OUTPUT") {
    if (value.width !== undefined && !validInteger(value.width, 1, 16))
      throw new Error("输入/输出位宽必须在 1–16 之间");
    node.width = value.width === undefined ? 1 : value.width;
    if (value.bits !== undefined) {
      if (
        !Array.isArray(value.bits) ||
        value.bits.length > 16 ||
        value.bits.some((bit) => bit !== 0 && bit !== 1)
      )
        throw new Error("输入位值无效");
      node.bits = value.bits as (0 | 1)[];
    }
    if ((node.width ?? 1) < (node.bits?.length ?? 0))
      throw new Error("输入位值多于声明位宽");
  }
  if (kind === "SLICE") {
    if (!validInteger(value.sliceWidth, 1, 16) || !validInteger(value.sliceOffset, 0, 15))
      throw new Error("切片参数无效");
    node.sliceWidth = value.sliceWidth;
    node.sliceOffset = value.sliceOffset;
  }
  if (kind === "CONCAT") {
    if (!validInteger(value.ports, 2, 16)) throw new Error("拼接段数必须在 2–16 之间");
    node.ports = value.ports;
  }
  if (kind === "SUBCIRCUIT") {
    if (
      typeof value.defId !== "string" ||
      !value.defId ||
      !validInteger(value.defVersion, 1, 1_000_000)
    )
      throw new Error("子电路实例缺少定义或版本");
    const def = context.library.find((item) => item.id === value.defId);
    if (!def) throw new Error(`实例引用的子电路不存在：${value.defId}`);
    node.defId = value.defId;
    node.defVersion = value.defVersion;
    if (value.paramArgs !== undefined) {
      if (!object(value.paramArgs)) throw new Error("实例参数无效");
      const args: Record<string, WidthExpr> = {};
      for (const [name, expr] of Object.entries(value.paramArgs))
        args[name] = decodeExpr(expr);
      node.paramArgs = args;
    }
  }
  if (kind === "SUBPORT_IN" || kind === "SUBPORT_OUT") {
    if (typeof value.portKey !== "string" || !value.portKey)
      throw new Error("边界端点缺少端口身份");
    node.portKey = value.portKey;
  }
  return node;
}

/* ------------------------------------------------------------------ */
/* Wire decoding                                                       */
/* ------------------------------------------------------------------ */

function endpointOf(value: unknown): Endpoint {
  const node = objectOrNull(value);
  if (!node) throw new Error("连线端点无效");
  if (typeof node.nodeId !== "string" || !Number.isInteger(node.port))
    throw new Error("连线端点无效");
  const endpoint: Endpoint = { nodeId: node.nodeId, port: Number(node.port) };
  if (node.portKey !== undefined) {
    if (typeof node.portKey !== "string" || !node.portKey)
      throw new Error("连线端口身份无效");
    endpoint.portKey = node.portKey;
  }
  return endpoint;
}

function decodeWire(
  value: unknown,
  nodeIds: Set<string>,
  wireIds: Set<string>,
  nodes: GateNode[],
): { id: string; from: Endpoint; to: Endpoint } {
  if (!object(value)) throw new Error("连线内容无效");
  if (
    typeof value.id !== "string" ||
    !value.id ||
    nodeIds.has(value.id) ||
    wireIds.has(value.id)
  )
    throw new Error("连线编号无效或重复");
  const from = endpointOf(value.from);
  const to = endpointOf(value.to);
  const source = nodes.find((node) => node.id === from.nodeId);
  const target = nodes.find((node) => node.id === to.nodeId);
  if (!source || !target || source === target) throw new Error("连线引用了无效元件");
  if (source.kind === "SUBPORT_OUT" || source.kind === "OUTPUT")
    throw new Error("连线源必须是可输出的元件");
  if (target.kind === "SUBPORT_IN" || target.kind === "INPUT")
    throw new Error("边界输入或输入开关不能作为连线终点");
  wireIds.add(value.id);
  return { id: value.id, from, to };
}

function endpointIsValid(
  node: GateNode,
  endpoint: Endpoint,
  direction: "input" | "output",
  context: DecodeContext,
): boolean {
  if (node.kind === "SUBCIRCUIT") {
    const version = versionFor(context.library, node.defId, node.defVersion);
    return portsOf(version, direction).some((port) => port.key === endpoint.portKey);
  }
  switch (node.kind) {
    case "INPUT":
      return direction === "output" && endpoint.port === 0;
    case "OUTPUT":
      return direction === "input" && endpoint.port === 0;
    case "NOT":
      return endpoint.port === 0;
    case "AND":
    case "OR":
    case "XOR":
    case "NAND":
    case "NOR":
      return endpoint.port >= 0 && endpoint.port < 2;
    case "SLICE":
      return endpoint.port === 0;
    case "CONCAT":
      return endpoint.port >= 0 && endpoint.port < (node.ports ?? 2);
    case "SUBPORT_IN":
      return direction === "output" && endpoint.port === 0;
    case "SUBPORT_OUT":
      return direction === "input" && endpoint.port === 0;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Version / definition decoding                                       */
/* ------------------------------------------------------------------ */

function decodeParams(value: unknown): WidthParamSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error("位宽参数过多");
  const names = new Set<string>();
  return value.map((item) => {
    const node = objectOrNull(item);
    if (
      !node ||
      typeof node.name !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(node.name) ||
      names.has(node.name) ||
      !validInteger(node.min, 1, 16) ||
      !validInteger(node.max, 1, 16) ||
      !validInteger(node.default, 1, 16) ||
      node.min > node.max ||
      node.default < node.min ||
      node.default > node.max
    )
      throw new Error("位宽参数无效");
    names.add(node.name);
    return { name: node.name, min: node.min, max: node.max, default: node.default };
  });
}

function decodePorts(value: unknown, params: WidthParamSpec[]): BoundaryPort[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error("端口过多");
  const keys = new Set<string>();
  const names = new Set<string>();
  const paramNames = new Set(params.map((param) => param.name));
  return value.map((item) => {
    const node = objectOrNull(item);
    if (!node) throw new Error("端口内容无效");
    if (
      typeof node.key !== "string" ||
      !node.key ||
      node.key.length > 80 ||
      keys.has(node.key) ||
      typeof node.name !== "string" ||
      !node.name.trim() ||
      node.name.length > 20 ||
      (node.direction !== "input" && node.direction !== "output")
    )
      throw new Error("端口内容无效");
    const label = `${node.direction}:${node.name.trim()}`;
    if (names.has(label)) throw new Error("端口名重复");
    names.add(label);
    keys.add(node.key);
    const width = decodeExpr(node.width);
    for (const name of exprNames(width))
      if (!paramNames.has(name)) throw new Error(`端口位宽引用了未定义的参数 ${name}`);
    return { key: node.key, name: node.name.trim(), direction: node.direction, width };
  });
}

function exprNames(expr: WidthExpr, into = new Set<string>()): Set<string> {
  if (expr.kind === "param") into.add(expr.name);
  else if (expr.kind !== "const") {
    exprNames(expr.left, into);
    exprNames(expr.right, into);
  }
  return into;
}

function decodeVersion(
  value: unknown,
  library: readonly SubcircuitDef[],
): SubcircuitVersion & { sortKey: number } {
  if (!object(value)) throw new Error("子电路版本无效");
  if (!validInteger(value.version, 1, 1_000_000)) throw new Error("版本号无效");
  const params = decodeParams(value.params);
  const ports = decodePorts(value.ports, params);
  if (!Array.isArray(value.nodes) || value.nodes.length > 96)
    throw new Error("子电路元件过多");
  if (!Array.isArray(value.wires) || value.wires.length > 384)
    throw new Error("子电路连线过多");
  const ids = new Set<string>();
  const context = { library };
  const nodes = value.nodes.map((item) => decodeNode(item, ids, context));
  const wireIds = new Set<string>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  const wires = value.wires.map((item) => decodeWire(item, nodeIds, wireIds, nodes));
  for (const wire of wires) {
    const source = nodes.find((node) => node.id === wire.from.nodeId)!;
    const target = nodes.find((node) => node.id === wire.to.nodeId)!;
    if (!endpointIsValid(source, wire.from, "output", context))
      throw new Error(`连线 ${wire.id} 的输出端点无效`);
    if (!endpointIsValid(target, wire.to, "input", context))
      throw new Error(`连线 ${wire.id} 的输入端点无效`);
  }
  for (const node of nodes) {
    if (node.kind !== "SUBPORT_IN" && node.kind !== "SUBPORT_OUT") continue;
    const direction = node.kind === "SUBPORT_IN" ? "input" : "output";
    if (!ports.some((port) => port.key === node.portKey && port.direction === direction))
      throw new Error(`边界端点「${node.label}」缺少端口定义`);
  }
  return {
    version: value.version,
    params,
    ports,
    nodes,
    wires,
    note: typeof value.note === "string" ? value.note.slice(0, 120) : "",
    createdAt: Number.isFinite(value.createdAt) ? Number(value.createdAt) : 0,
    sortKey: value.version,
  };
}

function decodeDefinition(value: unknown, library: readonly SubcircuitDef[]): SubcircuitDef {
  if (!object(value)) throw new Error("子电路定义无效");
  if (
    typeof value.id !== "string" ||
    !value.id ||
    value.id.length > 100 ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 40 ||
    !Array.isArray(value.versions) ||
    !value.versions.length ||
    value.versions.length > 16
  )
    throw new Error("子电路定义无效");
  const versions = value.versions
    .map((item) => decodeVersion(item, library))
    .sort((a, b) => a.sortKey - b.sortKey);
  if (new Set(versions.map((item) => item.version)).size !== versions.length)
    throw new Error("子电路版本号重复");
  return {
    id: value.id,
    name: value.name.trim(),
    versions: versions.map(({ sortKey, ...rest }) => {
      void sortKey;
      return rest;
    }),
  };
}

export function decodeLibrary(value: unknown): SubcircuitDef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new Error("子电路数量过多");
  const definitions: SubcircuitDef[] = [];
  // Two passes so a definition may reference a later sibling by id.
  const raw = value;
  const staged: SubcircuitDef[] = [];
  for (const item of raw) {
    if (!object(item) || typeof item.id !== "string") throw new Error("子电路定义无效");
    const placeholder: SubcircuitDef = {
      id: item.id,
      name: typeof item.name === "string" ? item.name : "子电路",
      versions: [],
    };
    staged.push(decodeDefinition(item, [...definitions, placeholder]));
    definitions.push(staged[staged.length - 1]);
  }
  if (new Set(definitions.map((def) => def.id)).size !== definitions.length)
    throw new Error("子电路编号重复");
  const cycle = findRecursion(definitions);
  if (cycle) throw new Error(`子电路存在递归引用：${cycle.join(" → ")}`);
  const issues = validateLibrary(definitions);
  const fatal = issues.filter((issue) => issue.tone === "error");
  if (fatal.length) throw new Error(fatal[0].message);
  return definitions;
}

/* ------------------------------------------------------------------ */
/* Document decoding                                                   */
/* ------------------------------------------------------------------ */

export function decodeDocument(
  text: string,
  library: readonly SubcircuitDef[] = [],
): CircuitDocument {
  if (text.length > 2_000_000) throw new Error("实验文件超过 2 MB，请缩小后再导入");
  const data: unknown = JSON.parse(text);
  if (
    !object(data) ||
    data.version !== 1 ||
    typeof data.name !== "string" ||
    data.name.length > 80 ||
    !["xor", "and", "or"].includes(String(data.targetId)) ||
    !Array.isArray(data.nodes) ||
    !Array.isArray(data.wires)
  )
    throw new Error("文件格式或版本不受支持");
  if (data.nodes.length > 160 || data.wires.length > 480)
    throw new Error("实验最多支持 160 个元件、480 条连线");
  const context = { library };
  const ids = new Set<string>();
  const nodes = data.nodes.map((value) => decodeNode(value, ids, context));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const wireIds = new Set<string>();
  const wires = data.wires.map((value) => decodeWire(value, nodeIds, wireIds, nodes));
  const occupied = new Set<string>();
  for (const wire of wires) {
    const target = nodes.find((node) => node.id === wire.to.nodeId)!;
    const key =
      target.kind === "SUBCIRCUIT" && wire.to.portKey
        ? `${wire.to.nodeId}:key:${wire.to.portKey}`
        : `${wire.to.nodeId}:${wire.to.port}`;
    if (occupied.has(key)) throw new Error("同一输入端口不能连接两个输出");
    occupied.add(key);
    const source = nodes.find((node) => node.id === wire.from.nodeId)!;
    if (!endpointIsValid(source, wire.from, "output", context))
      throw new Error("连线引用了无效端口");
    if (!endpointIsValid(target, wire.to, "input", context))
      throw new Error("连线引用了无效端口");
  }
  const document: CircuitDocument = {
    version: 1,
    name: data.name,
    targetId: String(data.targetId),
    nodes,
    wires,
  };
  topologicalOrder(document);
  return document;
}

export function encodeDocument(document: CircuitDocument): string {
  return JSON.stringify(document, null, 2);
}

export function encodeLibrary(library: readonly SubcircuitDef[]): string {
  return JSON.stringify({ version: 2, definitions: library }, null, 2);
}

export function decodeWorkspace(
  text: string,
): { document: CircuitDocument; library: SubcircuitDef[] } {
  if (text.length > 4_000_000) throw new Error("工作区文件超过 4 MB");
  const data: unknown = JSON.parse(text);
  if (object(data) && data.version === 2 && objectOrNull(data.document)) {
    const library = decodeLibrary(data.library);
    return {
      document: decodeDocument(JSON.stringify(data.document), library),
      library,
    };
  }
  // Legacy single-bit experiment: no library, everything is width 1.
  const document = decodeDocument(text);
  return { document, library: [] };
}
