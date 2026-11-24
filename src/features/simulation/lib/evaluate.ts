import type {
  Bus,
  CircuitDocument,
  Endpoint,
  GateNode,
  Signal,
  SimulationIssue,
  SimulationResult,
  SubcircuitDef,
} from "@/shared/types";
import type { WidthModel } from "@/features/library/lib/widths";
import { MAX_WIDTH, busText, portCounts } from "@/features/library/lib/widths";

export { busText };

type Bit = Signal;

function bus(value: Bit, width: number): Bus {
  return Array.from({ length: Math.max(0, width) }, () => value);
}

export function normalizeBus(value: Bus | undefined, width: number | null): Bus {
  const source = value ?? [];
  const target = width ?? source.length;
  if (target <= source.length) return source.slice(0, target);
  return [...source, ...bus("X", target - source.length)];
}

function invert(bit: Bit): Bit {
  return bit === "X" ? "X" : bit === 1 ? 0 : 1;
}

/** Element-wise gate evaluation: every bit of the bus is computed independently. */
function gateBit(kind: GateNode["kind"], bits: Bit[]): Bit {
  switch (kind) {
    case "NOT":
      return invert(bits[0] ?? "X");
    case "AND":
      return bits.includes(0) ? 0 : bits.includes("X") ? "X" : 1;
    case "NAND":
      return invert(bits.includes(0) ? 0 : bits.includes("X") ? "X" : 1);
    case "OR":
      return bits.includes(1) ? 1 : bits.includes("X") ? "X" : 0;
    case "NOR":
      return invert(bits.includes(1) ? 1 : bits.includes("X") ? "X" : 0);
    case "XOR":
      if (bits.some((bit) => bit === "X")) return "X";
      return bits.every((bit) => bit === bits[0]) ? 0 : 1;
    default:
      return "X";
  }
}

function gateBus(kind: GateNode["kind"], pins: Bus[], width: number): Bus {
  return Array.from({ length: width }, (_, index) => {
    const bits = pins.map((pin) => pin[index] ?? "X");
    return gateBit(kind, bits);
  });
}

function topoSort(
  nodes: GateNode[],
  wires: { from: Endpoint; to: Endpoint }[],
): { order: string[]; feedback: boolean } {
  const degrees = new Map(nodes.map((node) => [node.id, 0]));
  const next = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const wire of wires) {
    if (!degrees.has(wire.from.nodeId) || !degrees.has(wire.to.nodeId)) continue;
    degrees.set(wire.to.nodeId, degrees.get(wire.to.nodeId)! + 1);
    next.get(wire.from.nodeId)!.push(wire.to.nodeId);
  }
  const queue = [...degrees].filter(([, count]) => count === 0).map(([id]) => id);
  for (let index = 0; index < queue.length; index++)
    for (const id of next.get(queue[index])!) {
      degrees.set(id, degrees.get(id)! - 1);
      if (degrees.get(id) === 0) queue.push(id);
    }
  return { order: queue, feedback: queue.length !== nodes.length };
}

export interface EvaluateOptions {
  /** Override switch values at the experiment level only. */
  overrides?: Record<string, 0 | 1 | Bus>;
}

interface ScopeInputs {
  /** Boundary input buses keyed by stable port key. */
  boundary: Record<string, Bus>;
}

/** Evaluate the experiment plus every reachable instance body. */
export function evaluate(
  document: CircuitDocument,
  library: readonly SubcircuitDef[],
  model: WidthModel,
  options: EvaluateOptions = {},
): SimulationResult {
  return evaluateScope(
    model,
    library,
    "",
    document.nodes,
    document.wires,
    { boundary: {} },
    options.overrides ?? {},
  );
}

function inputCountOf(node: GateNode): number {
  if (node.kind === "INPUT" || node.kind === "SUBPORT_IN" || node.kind === "SUBCIRCUIT") return 0;
  return portCounts(node).inputs;
}

function evaluateScope(
  model: WidthModel,
  library: readonly SubcircuitDef[],
  path: string,
  nodes: GateNode[],
  wires: { id: string; from: Endpoint; to: Endpoint }[],
  inputs: ScopeInputs,
  overrides: Record<string, 0 | 1 | Bus>,
): SimulationResult {
  const values: Record<string, Bus> = Object.create(null);
  const pins: Record<string, Bus[]> = Object.create(null);
  const wireValues: Record<string, Bus> = Object.create(null);
  const scopes: Record<string, SimulationResult> = Object.create(null);
  const errors: SimulationIssue[] = [];
  const unresolved: string[] = [];

  const { order, feedback } = topoSort(nodes, wires);
  if (feedback)
    errors.push({
      tone: "error",
      message: `${path ? `实例 ${path}` : "实验台"}存在反馈环，组合逻辑无法求值`,
    });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Map<number, { id: string; from: Endpoint }>>();
  for (const node of nodes) incoming.set(node.id, new Map());
  for (const wire of wires) incoming.get(wire.to.nodeId)?.set(wire.to.port, { id: wire.id, from: wire.from });

  const childPathOf = (nodeId: string) => (path ? `${path}/${nodeId}` : nodeId);
  const outputBus = (endpoint: Endpoint): Bus => {
    const sourceNode = nodeById.get(endpoint.nodeId);
    if (sourceNode?.kind === "SUBCIRCUIT") {
      const childPath = childPathOf(endpoint.nodeId);
      const child = scopes[childPath];
      const childScope = model.scope(childPath);
      const outputPorts = childScope?.version?.ports.filter(
        (item) => item.direction === "output",
      ) ?? [];
      const port =
        (endpoint.portKey
          ? outputPorts.find((item) => item.key === endpoint.portKey)
          : undefined) ?? outputPorts[endpoint.port];
      const boundary = childScope?.nodes.find(
        (item) => item.kind === "SUBPORT_OUT" && item.portKey === port?.key,
      );
      return child?.values[boundary?.id ?? ""] ?? [];
    }
    return values[endpoint.nodeId] ?? [];
  };

  for (const id of order) {
    const node = nodeById.get(id)!;
    const sourceWidth = (direction: "input" | "output", index: number) =>
      model.portWidth(path, id, direction, undefined, index);

    if (node.kind === "SUBPORT_IN") {
      const port = model.scope(path)?.version?.ports.find((item) => item.key === node.portKey);
      if (!port) {
        unresolved.push(id);
        values[id] = bus("X", 1);
      } else {
        const width = sourceWidth("output", 0) ?? 1;
        values[id] = normalizeBus(inputs.boundary[port.key], width);
      }
      pins[id] = [];
      continue;
    }

    if (node.kind === "SUBCIRCUIT") {
      const childPath = childPathOf(id);
      const childScope = model.scope(childPath);
      if (!childScope?.version) {
        unresolved.push(id);
        values[id] = [];
        errors.push({
          tone: "error",
          message: `实例「${node.label}」的定义缺失，无法求值`,
        });
        continue;
      }
      const boundary: Record<string, Bus> = {};
      const childPins: Bus[] = [];
      const inputPorts = childScope.version.ports.filter((port) => port.direction === "input");
      for (const [index, port] of inputPorts.entries()) {
        const width = sourceWidth("input", index) ?? 0;
        const wire = wires.find((item) => item.to.nodeId === id && item.to.portKey === port.key);
        const value = wire ? normalizeBus(outputBus(wire.from), width) : bus("X", width);
        boundary[port.key] = value;
        childPins.push(value);
      }
      pins[id] = childPins;
      scopes[childPath] = evaluateScope(
        model,
        library,
        childPath,
        childScope.nodes,
        childScope.wires,
        { boundary },
        {},
      );
      const outputPorts = childScope.version.ports.filter((port) => port.direction === "output");
      // Display value of the instance uses its first output; every output is
      // read from the child scope through `outputBus` for downstream wires.
      values[id] = outputBus({ nodeId: id, port: 0, portKey: outputPorts[0]?.key });
      continue;
    }

    const count = inputCountOf(node);
    const nodePins: Bus[] = [];
    for (let port = 0; port < count; port++) {
      const wire = incoming.get(id)?.get(port);
      const width = sourceWidth("input", port);
      nodePins.push(
        wire ? normalizeBus(outputBus(wire.from), width) : bus("X", width ?? 0),
      );
    }
    pins[id] = nodePins;

    let value: Bus = [];
    switch (node.kind) {
      case "INPUT": {
        const width = sourceWidth("output", 0) ?? 1;
        const override = Object.hasOwn(overrides, id) ? overrides[id] : undefined;
        if (Array.isArray(override)) value = normalizeBus(override, width);
        else if (override !== undefined) value = bus(override as 0 | 1, width);
        else value = readSwitch(node, width);
        break;
      }
      case "OUTPUT": {
        const width = sourceWidth("input", 0) ?? 1;
        value = normalizeBus(nodePins[0], width);
        break;
      }
      case "SLICE": {
        const source = nodePins[0] ?? [];
        const offset = Math.max(0, Math.round(node.sliceOffset ?? 0));
        const width = Math.min(MAX_WIDTH, Math.max(1, Math.round(node.sliceWidth ?? 1)));
        value = Array.from({ length: width }, (_, index) => source[offset + index] ?? "X");
        break;
      }
      case "CONCAT":
        value = nodePins.flat();
        break;
      case "SUBPORT_OUT": {
        const width = sourceWidth("input", 0) ?? 1;
        value = normalizeBus(nodePins[0], width);
        break;
      }
      default:
        value = gateBus(node.kind, nodePins, sourceWidth("output", 0) ?? 1);
        break;
    }
    const width = sourceWidth("output", 0);
    values[id] = width === null ? value : normalizeBus(value, width);
    if (width === null) unresolved.push(id);
  }

  for (const wire of wires) wireValues[wire.id] = outputBus(wire.from);

  const widths: Record<string, { inputs: (number | null)[]; outputs: (number | null)[] }> = {};
  for (const node of nodes) {
    const ports = model.nodePorts(path, node.id);
    widths[node.id] = {
      inputs: ports.filter((port) => port.direction === "input").map((port) => port.width),
      outputs: ports.filter((port) => port.direction === "output").map((port) => port.width),
    };
  }

  void library;
  return {
    values,
    pins,
    wires: wireValues,
    order,
    widths,
    scopes,
    unresolved,
    errors,
  };
}

function readSwitch(node: GateNode, width: number): Bus {
  const bits = node.bits ?? [];
  if (width <= 1) return [bits[0] ?? node.value ?? 0];
  return Array.from({ length: width }, (_, index) => bits[index] ?? 0);
}

/** Flatten all instance scopes for observation panels. */
export function allScopes(result: SimulationResult): { path: string; result: SimulationResult }[] {
  const list: { path: string; result: SimulationResult }[] = [];
  const walk = (scope: SimulationResult) => {
    for (const [path, child] of Object.entries(scope.scopes)) {
      list.push({ path, result: child });
      walk(child);
    }
  };
  walk(result);
  return list;
}

export function scopesAtPath(
  result: SimulationResult,
  path: string,
): SimulationResult | null {
  if (!path) return result;
  for (const entry of allScopes(result)) if (entry.path === path) return entry.result;
  return null;
}

export function busToBinary(busValue: Bus | undefined, width?: number): string {
  const length = width ?? busValue?.length ?? 0;
  return Array.from({ length }, (_, index) => busValue?.[length - 1 - index] ?? "X").join("");
}

export function busToDecimal(busValue: Bus | undefined): string {
  if (!busValue?.length) return "—";
  let value = 0;
  for (let index = busValue.length - 1; index >= 0; index--) {
    const bit = busValue[index];
    if (bit === "X") return "—";
    value = value * 2 + bit;
  }
  return String(value);
}

export function busToHex(busValue: Bus | undefined): string {
  const decimal = busToDecimal(busValue);
  return decimal === "—" ? "—" : `0x${Number(decimal).toString(16).toUpperCase()}`;
}

export function busHasUnknown(busValue: Bus | undefined): boolean {
  return !!busValue?.some((bit) => bit === "X");
}
