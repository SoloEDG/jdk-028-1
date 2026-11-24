import { computed, ref, type Ref } from "vue";
import type {
  BoundaryPort,
  CircuitDocument,
  GateNode,
  SubcircuitDef,
  SubcircuitVersion,
  WidthExpr,
  WidthParamSpec,
} from "@/shared/types";
import { createId } from "@/shared/document";
import type { Endpoint } from "@/shared/types";
import { parseExpr } from "../lib/expr";
import {
  findRecursion,
  newDefinition,
  publishVersion,
  validateDefinition,
  validateLibrary,
  type LibraryIssue,
} from "../lib/model";
import { versionFor } from "../lib/widths";
import { decodeLibrary } from "@/features/workspace/lib/codec";
import { applyUpgrade, previewUpgrade, type UpgradePreview } from "../lib/upgrade";

export interface CaptureResult {
  ok: boolean;
  message: string;
  def?: SubcircuitDef;
  library?: SubcircuitDef[];
}

/** Which crossing wire becomes which boundary port; produced by the dialog preview. */
export interface CapturePortDraft {
  wireId: string;
  direction: "input" | "output";
  name: string;
  width: string;
}

export interface BoundaryEdit {
  key: string;
  name: string;
  direction: "input" | "output";
  width: string;
}

export interface ParamEdit {
  name: string;
  min: number;
  max: number;
  default: number;
}

export function useLibrary(
  document: Ref<CircuitDocument>,
  notify: (notice: { tone: "info" | "error" | "success"; message: string }) => void,
  library: Ref<SubcircuitDef[]> = ref<SubcircuitDef[]>([]),
) {
  const definitions = library;
  const selectedDefId = ref<string | null>(null);
  const upgrading = ref<UpgradePreview | null>(null);

  const issues = computed<LibraryIssue[]>(() => validateLibrary(definitions.value));
  const selectedDef = computed(
    () => definitions.value.find((def) => def.id === selectedDefId.value) ?? null,
  );

  function setLibrary(next: SubcircuitDef[]) {
    definitions.value = next;
    if (selectedDefId.value && !next.some((def) => def.id === selectedDefId.value))
      selectedDefId.value = null;
  }

  function definitionById(id: string | undefined): SubcircuitDef | undefined {
    return id ? definitions.value.find((def) => def.id === id) : undefined;
  }

  /**
   * Capture the selected top-level nodes into a new subcircuit definition.
   * Wires that cross the selection boundary become boundary ports; wires fully
   * inside stay internal. Selection must not contain a subcircuit that would
   * create recursion.
   */
  function captureSelection(
    selection: string[],
    name: string,
    params: ParamEdit[],
    notes: string,
    drafts?: CapturePortDraft[],
  ): CaptureResult {
    const ids = new Set(selection);
    const chosen = document.value.nodes.filter((node) => ids.has(node.id));
    if (chosen.length < 1)
      return { ok: false, message: "请先框选至少一个元件作为子电路内容" };
    if (chosen.length > 96)
      return { ok: false, message: "子电路内容最多 96 个元件" };
    if (chosen.some((node) => node.kind === "SUBPORT_IN" || node.kind === "SUBPORT_OUT"))
      return { ok: false, message: "边界端点只能在子电路内部使用，不能再次圈选" };

    const paramSpecs: WidthParamSpec[] = params.map((param) => ({
      name: param.name.trim(),
      min: Math.max(1, Math.min(16, Math.round(param.min))),
      max: Math.max(1, Math.min(16, Math.round(param.max))),
      default: Math.max(1, Math.min(16, Math.round(param.default))),
    }));
    const internalWires = document.value.wires.filter(
      (wire) => ids.has(wire.from.nodeId) && ids.has(wire.to.nodeId),
    );
    const incoming = document.value.wires.filter(
      (wire) => !ids.has(wire.from.nodeId) && ids.has(wire.to.nodeId),
    );
    const outgoing = document.value.wires.filter(
      (wire) => ids.has(wire.from.nodeId) && !ids.has(wire.to.nodeId),
    );

    const ports: BoundaryPort[] = [];
    const portNodes: GateNode[] = [];
    const rewrites: { wireId: string; endpoint: "from" | "to"; portKey: string }[] = [];

    const layout = bodyLayout(chosen, internalWires);
    let portError: string | null = null;
    const applyDraft = (
      wireId: string,
      direction: "input" | "output",
      fallbackName: string,
      fallbackWidth: string,
    ): { name: string; width: WidthExpr } => {
      const draft = drafts?.find(
        (item) => item.wireId === wireId && item.direction === direction,
      );
      let width: WidthExpr;
      try {
        width = parseExpr(draft?.width ?? fallbackWidth);
      } catch (error) {
        portError = `端口位宽无效：${error instanceof Error ? error.message : fallbackWidth}`;
        width = parseExpr(fallbackWidth);
      }
      return { name: draft?.name.trim() || fallbackName, width };
    };
    for (const [index, wire] of incoming.entries()) {
      const target = chosen.find((node) => node.id === wire.to.nodeId)!;
      const key = createId("port");
      const draft = applyDraft(
        wire.id,
        "input",
        boundaryName(ports, "input", target.label),
        widthTextFor(target, wire.to.port),
      );
      ports.push({ key, name: draft.name, direction: "input", width: draft.width });
      rewrites.push({ wireId: wire.id, endpoint: "to", portKey: key });
      portNodes.push(
        boundaryNode("SUBPORT_IN", draft.name, key, 40, 80 + index * 90),
      );
    }
    for (const [index, wire] of outgoing.entries()) {
      const source = chosen.find((node) => node.id === wire.from.nodeId)!;
      const key = createId("port");
      const draft = applyDraft(
        wire.id,
        "output",
        boundaryName(ports, "output", source.label),
        widthTextFor(source, wire.from.port),
      );
      ports.push({ key, name: draft.name, direction: "output", width: draft.width });
      rewrites.push({ wireId: wire.id, endpoint: "from", portKey: key });
      portNodes.push(
        boundaryNode("SUBPORT_OUT", draft.name, key, 800, 80 + index * 90),
      );
    }
    if (portError) return { ok: false, message: portError };

    const duplicatePorts = duplicates(ports.map((port) => `${port.direction}:${port.name}`));
    if (duplicatePorts.length)
      return { ok: false, message: `端口名重复：${duplicatePorts.join("、")}` };

    // Instances inside the capture may have parameter values that came from
    // their own wiring; keep literal choices but drop unresolved defaults so the
    // new definition can re-infer them from its own boundary widths.
    const paramNames = new Set(paramSpecs.map((param) => param.name));
    const bodyNodes = [
      ...chosen.map((node, index) => {
        const clone = reparentBodyNode(node);
        clone.x = layout[index].x;
        clone.y = layout[index].y;
        if (clone.kind === "SUBCIRCUIT" && clone.paramArgs) {
          const kept: Record<string, WidthExpr> = {};
          for (const [param, expr] of Object.entries(clone.paramArgs)) {
            if (expr.kind === "param" && paramNames.has(expr.name)) {
              // unchanged; references a newly declared parameter
            }
            kept[param] = expr;
          }
          clone.paramArgs = kept;
        }
        return clone;
      }),
      ...portNodes,
    ];
    const bodyWires: { id: string; from: Endpoint; to: Endpoint }[] = internalWires.map(
      (wire) => ({ id: wire.id, from: { ...wire.from }, to: { ...wire.to } }),
    );
    // Crossing wires become boundary port nodes plus internal stubs.
    for (const [index, wire] of incoming.entries()) {
      const boundary = portNodes.filter((node) => node.kind === "SUBPORT_IN")[index];
      bodyWires.push({
        id: createId("wire"),
        from: { nodeId: boundary.id, port: 0 },
        to: { ...wire.to },
      });
    }
    for (const [index, wire] of outgoing.entries()) {
      const boundary = portNodes.filter((node) => node.kind === "SUBPORT_OUT")[index];
      bodyWires.push({
        id: createId("wire"),
        from: { ...wire.from },
        to: { nodeId: boundary.id, port: 0 },
      });
    }

    const candidate: SubcircuitDef = newDefinition(name, {
      params: paramSpecs,
      ports,
      nodes: bodyNodes,
      wires: bodyWires,
      note: notes,
    });
    const libraryCheck = validateDefinition(candidate, [...definitions.value, candidate]);
    if (libraryCheck.some((issue) => issue.tone === "error"))
      return {
        ok: false,
        message: `子电路定义无效：${libraryCheck.filter((issue) => issue.tone === "error").map((issue) => issue.message).join("；")}`,
      };

    // Recursion check: the new definition references existing defs; those must
    // not (transitively) reference it. A brand-new id cannot be referenced yet,
    // so use a dry-run cycle check on the extended library.
    const cycle = findRecursion([...definitions.value, candidate]);
    if (cycle)
      return { ok: false, message: `检测到递归引用：${cycle.join(" → ")}` };

    // Apply to the working document: swap selected nodes for one instance.
    const instanceId = createId("node");
    const instance: GateNode = {
      id: instanceId,
      kind: "SUBCIRCUIT",
      label: candidate.name,
      value: 0,
      x: Math.round(average(chosen.map((node) => node.x))),
      y: Math.round(average(chosen.map((node) => node.y))),
      defId: candidate.id,
      defVersion: 1,
    };
    const nextNodes = document.value.nodes.filter((node) => !ids.has(node.id));
    nextNodes.push(instance);
    const nextWires = document.value.wires
      .filter((wire) => !(ids.has(wire.from.nodeId) && ids.has(wire.to.nodeId)))
      .map((wire) => {
        const rewrite = rewrites.find((item) => item.wireId === wire.id);
        if (!rewrite) return wire;
        if (rewrite.endpoint === "to")
          return {
            ...wire,
            to: {
              nodeId: instanceId,
              port: inputIndex(ports, rewrite.portKey),
              portKey: rewrite.portKey,
            },
          };
        return {
          ...wire,
          from: {
            nodeId: instanceId,
            port: outputIndex(ports, rewrite.portKey),
            portKey: rewrite.portKey,
          },
        };
      });
    document.value.nodes = nextNodes;
    document.value.wires = nextWires;
    setLibrary([...definitions.value, candidate]);
    selectedDefId.value = candidate.id;
    notify({
      tone: "success",
      message: `已创建子电路「${candidate.name}」并替换为实例，可在元件库中继续放置`,
    });
    return { ok: true, message: "已创建子电路", def: candidate, library: definitions.value };
  }

  /** Publish a new version of a definition from edited ports/params. */
  function publish(
    defId: string,
    edits: {
      name: string;
      ports: BoundaryEdit[];
      params: ParamEdit[];
      note: string;
    },
  ): { ok: boolean; message: string; version?: number } {
    const def = definitionById(defId);
    if (!def) return { ok: false, message: "子电路不存在" };
    let ports: BoundaryPort[];
    try {
      ports = edits.ports.map((edit) => ({
        key: edit.key,
        name: edit.name.trim(),
        direction: edit.direction,
        width: parseExpr(edit.width),
      }));
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "端口位宽无效" };
    }
    const names = duplicates(ports.map((port) => `${port.direction}:${port.name}`));
    if (names.length) return { ok: false, message: `端口名重复：${names.join("、")}` };
    if (ports.some((port) => !port.name)) return { ok: false, message: "端口名不能为空" };
    const paramNames = edits.params.map((param) => param.name.trim());
    if (duplicates(paramNames).length)
      return { ok: false, message: "参数名重复" };
    for (const param of edits.params)
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(param.name.trim()))
        return { ok: false, message: `参数名「${param.name}」不合法` };
    const version = publishVersion(def, {
      name: edits.name,
      ports,
      params: edits.params.map((param) => ({
        name: param.name.trim(),
        min: Math.round(param.min),
        max: Math.round(param.max),
        default: Math.round(param.default),
      })),
      note: edits.note,
    });
    const library = definitions.value.map((item) => (item.id === def.id ? version : item));
    const check = validateDefinition(version, library);
    if (check.some((issue) => issue.tone === "error"))
      return {
        ok: false,
        message: `新版本无效：${check.filter((issue) => issue.tone === "error").map((issue) => issue.message).join("；")}`,
      };
    const cycle = findRecursion(library);
    if (cycle) return { ok: false, message: `新版本会造成递归：${cycle.join(" → ")}` };
    // A new version could also make its own body reference itself indirectly
    // through definitions it already nests; findRecursion covers that case as
    // long as the body actually nests a known definition.
    const selfCycle = findRecursion(library, def.id);
    if (selfCycle)
      return { ok: false, message: `新版本会直接或间接引用自身：${selfCycle.join(" → ")}` };
    setLibrary(library);
    const latest = version.versions[version.versions.length - 1];
    notify({
      tone: "success",
      message: `「${version.name}」已发布 v${latest.version}；已有实例继续使用原版本`,
    });
    return { ok: true, message: `已发布 v${latest.version}`, version: latest.version };
  }

  function preview(instanceId: string, targetVersion?: number): UpgradePreview {
    return previewUpgrade(document.value, definitions.value, instanceId, targetVersion);
  }

  function openUpgrade(instanceId: string, targetVersion?: number) {
    upgrading.value = preview(instanceId, targetVersion);
  }

  function closeUpgrade() {
    upgrading.value = null;
  }

  function confirmUpgrade(): boolean {
    if (!upgrading.value) return false;
    const result = applyUpgrade(document.value, definitions.value, upgrading.value);
    notify({ tone: result.ok ? "success" : "error", message: result.message });
    if (result.ok) upgrading.value = null;
    return result.ok;
  }

  function refreshUpgrade() {
    if (upgrading.value)
      upgrading.value = preview(upgrading.value.instanceId, upgrading.value.toVersion);
  }

  function dropDefinition(defId: string): boolean {
    const used = document.value.nodes.some(
      (node) => node.kind === "SUBCIRCUIT" && node.defId === defId,
    );
    if (used) {
      notify({
        tone: "error",
        message: "该子电路仍被实例使用，请先删除或改接这些实例",
      });
      return false;
    }
    const referenced = definitions.value.some((def) =>
      def.versions.some((version) =>
        version.nodes.some((node) => node.kind === "SUBCIRCUIT" && node.defId === defId),
      ),
    );
    if (referenced) {
      notify({
        tone: "error",
        message: "该子电路被其他子电路引用，不能删除",
      });
      return false;
    }
    setLibrary(definitions.value.filter((def) => def.id !== defId));
    return true;
  }

  function renameDefinition(defId: string, name: string) {
    setLibrary(
      definitions.value.map((def) =>
        def.id === defId ? { ...def, name: name.trim().slice(0, 40) || def.name } : def,
      ),
    );
  }

  function latestOf(defId: string): SubcircuitVersion | undefined {
    const def = definitionById(defId);
    return def?.versions[def.versions.length - 1];
  }

  function createInstance(
    defId: string,
    position: { x: number; y: number },
  ): GateNode | null {
    const def = definitionById(defId);
    const version = latestOf(defId);
    if (!def || !version) return null;
    // Parameters are intentionally left unset so they are inferred from the
    // wires attached to the instance. Pinning defaults would defeat inference.
    return {
      id: createId("node"),
      kind: "SUBCIRCUIT",
      label: def.name,
      value: 0,
      x: position.x,
      y: position.y,
      defId: def.id,
      defVersion: version.version,
    };
  }

  function versionLabel(node: GateNode): string {
    const version = versionFor(definitions.value, node.defId, node.defVersion);
    const def = definitionById(node.defId);
    return `${def?.name ?? "?"} v${node.defVersion ?? "?"}${version ? "" : "（缺失）"}`;
  }

  function exportLibrary(): string {
    return JSON.stringify({ version: 2, definitions: definitions.value }, null, 2);
  }

  /**
   * Import a library file. Accepts either a {definitions:[...]} envelope or a
   * bare array; runs the same validation as the workspace decoder.
   */
  function importLibrary(text: string): string | null {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return "子电路库文件不是合法的 JSON";
    }
    const raw = Array.isArray(data)
      ? data
      : data && typeof data === "object" && "definitions" in data
        ? (data as { definitions: unknown }).definitions
        : null;
    if (!Array.isArray(raw)) return "子电路库格式无效";
    let parsed: SubcircuitDef[];
    try {
      parsed = decodeLibrary(raw);
    } catch (error) {
      return error instanceof Error ? error.message : "子电路库内容无效";
    }
    const cycle = findRecursion(parsed);
    if (cycle) return `导入的子电路含递归：${cycle.join(" → ")}`;
    const merged = [...definitions.value];
    for (const def of parsed) {
      const index = merged.findIndex((item) => item.id === def.id);
      if (index >= 0) merged[index] = def;
      else merged.push(def);
    }
    const check = validateLibrary(merged);
    if (check.some((issue) => issue.tone === "error"))
      return check
        .filter((issue) => issue.tone === "error")
        .map((issue) => issue.message)
        .join("；");
    setLibrary(merged);
    return null;
  }

  return {
    definitions,
    issues,
    selectedDefId,
    selectedDef,
    upgrading,
    setLibrary,
    definitionById,
    captureSelection,
    publish,
    preview,
    openUpgrade,
    closeUpgrade,
    confirmUpgrade,
    refreshUpgrade,
    dropDefinition,
    renameDefinition,
    createInstance,
    latestOf,
    versionLabel,
    exportLibrary,
    importLibrary,
  };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Simple layered layout for the captured body so it is readable when opened. */
function bodyLayout(
  nodes: GateNode[],
  internalWires: { from: { nodeId: string }; to: { nodeId: string } }[],
): { x: number; y: number }[] {
  const depth = new Map<string, number>();
  for (const node of nodes) depth.set(node.id, 0);
  for (let round = 0; round < nodes.length; round++) {
    let changed = false;
    for (const wire of internalWires) {
      const next = (depth.get(wire.from.nodeId) ?? 0) + 1;
      if ((depth.get(wire.to.nodeId) ?? 0) < next) {
        depth.set(wire.to.nodeId, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const columns = new Map<number, number>();
  return nodes.map((node) => {
    const column = Math.min(4, depth.get(node.id) ?? 0);
    const row = columns.get(column) ?? 0;
    columns.set(column, row + 1);
    return { x: 240 + column * 150, y: 60 + (row % 5) * 92 };
  });
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const result = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return [...result];
}

function boundaryName(
  ports: BoundaryPort[],
  direction: "input" | "output",
  base: string,
): string {
  const used = new Set(ports.map((port) => port.name));
  const trimmed = (base || (direction === "input" ? "IN" : "OUT")).slice(0, 20);
  if (!used.has(trimmed)) return trimmed;
  let index = 2;
  while (used.has(`${trimmed}_${index}`)) index++;
  return `${trimmed}_${index}`;
}

function boundaryNode(
  kind: "SUBPORT_IN" | "SUBPORT_OUT",
  label: string,
  portKey: string,
  x: number,
  y: number,
): GateNode {
  return {
    id: createId("node"),
    kind,
    label,
    value: 0,
    x,
    y,
    portKey,
  };
}

function widthTextFor(node: GateNode, port: number): string {
  if (node.kind === "INPUT" || node.kind === "OUTPUT") return String(node.width ?? 1);
  if (node.kind === "SLICE" && node.sliceWidth) return String(node.sliceWidth);
  if (node.kind === "CONCAT") return "2";
  void port;
  return "1";
}

function reparentBodyNode(node: GateNode): GateNode {
  return JSON.parse(JSON.stringify(node)) as GateNode;
}

function inputIndex(ports: BoundaryPort[], key: string): number {
  return ports.filter((port) => port.direction === "input").findIndex((port) => port.key === key);
}
function outputIndex(ports: BoundaryPort[], key: string): number {
  return ports.filter((port) => port.direction === "output").findIndex((port) => port.key === key);
}

export function captureFromSelection(
  document: CircuitDocument,
  selection: string[],
): { nodes: GateNode[]; wires: CircuitDocument["wires"] } {
  const ids = new Set(selection);
  return {
    nodes: document.nodes.filter((node) => ids.has(node.id)),
    wires: document.wires.filter(
      (wire) => ids.has(wire.from.nodeId) && ids.has(wire.to.nodeId),
    ),
  };
}

export function portKeyOf(node: GateNode): string | undefined {
  return node.portKey;
}
