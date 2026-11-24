import { computed, ref } from "vue";
import type { Notice } from "@/shared/commands";
import type { GateNode, Point } from "@/shared/types";
import { usePlacement, type PlacementTool } from "@/features/catalog";
import { useCircuit } from "@/features/circuit";
import {
  buildWidthModel,
  useLibrary,
  type UpgradePreview,
} from "@/features/library";
import { useSimulation } from "@/features/simulation";
import { useChallenge } from "@/features/challenge";
import { loadInitial, useWorkspace } from "@/features/workspace";

export function useLab() {
  const initial = loadInitial();
  const document = ref(initial.document);
  const library = ref(initial.library);
  const notice = ref<Notice>({
    tone: initial.warning ? "error" : "info",
    message:
      initial.warning ??
      "框选元件创建子电路；实例可进入内部观察，库升级只影响你选择的实例。",
  });
  const notify = (next: Notice) => {
    notice.value = next;
  };

  const model = computed(() => buildWidthModel(document.value, library.value));
  const placement = usePlacement();
  const circuit = useCircuit(document, library, notify, () => model.value);
  const simulation = useSimulation(document, library, model);
  const challenge = useChallenge(document, library, model);
  const lib = useLibrary(document, notify, library);

  const dialogs = ref<{
    capture: boolean;
    library: boolean;
    inspector: string | null;
    body: string | null;
  }>({ capture: false, library: false, inspector: null, body: null });
  const inspectedInstance = ref<string | null>(null);
  const upgradeOpen = ref(false);

  // Keep library definitions in sync with the shared library ref.
  const libraryView = computed(() => lib.definitions.value);

  const workspace = useWorkspace(document, library, notify, () => {
    circuit.resetSelection();
    challenge.reset();
    placement.choose(null);
    dialogs.value = { capture: false, library: false, inspector: null, body: null };
  });

  function place(point: Point) {
    if (!placement.tool.value) return;
    if (document.value.nodes.length >= 160) {
      notify({ tone: "error", message: "最多支持 160 个元件，请先删除不用的元件" });
      return;
    }
    const node = placement.createNode(document.value, placement.tool.value, point);
    if (node.kind === "SUBCIRCUIT") {
      const created = lib.createInstance(node.defId!, point);
      if (!created) {
        notify({ tone: "error", message: "子电路定义缺失，无法放置实例" });
        return;
      }
      created.label = uniqueLabel(document.value, created.label);
      document.value.nodes.push(created);
      circuit.select(created.id);
      notify({
        tone: "success",
        message: `已放置实例 ${created.label}，位宽由外部接线推导`,
      });
    } else {
      if (node.kind === "INPUT") {
        node.bits = [0];
        node.value = 0;
      }
      document.value.nodes.push(node);
      circuit.select(node.id);
      notify({
        tone: "success",
        message: `已放置 ${node.label}，点击端口开始连线`,
      });
    }
    placement.choose(null);
  }

  function uniqueLabel(current: { nodes: GateNode[] }, base: string): string {
    const used = new Set(current.nodes.map((node) => node.label));
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(`${base} ${index}`)) index++;
    return `${base} ${index}`;
  }

  function move(id: string, point: Point) {
    const node = document.value.nodes.find((item) => item.id === id);
    if (node) {
      node.x = point.x;
      node.y = point.y;
    }
  }

  function renameNode(label: string) {
    const node = document.value.nodes.find((item) => item.id === circuit.selected.value);
    if (node) node.label = label.trim().slice(0, 40) || node.kind;
  }

  function cancel() {
    circuit.pending.value = null;
    placement.choose(null);
    notify({ tone: "info", message: "已取消当前放置或连线" });
  }

  function beginCapture() {
    const ids = circuit.multiSelection.value.length
      ? circuit.multiSelection.value
      : circuit.selected.value
        ? [circuit.selected.value]
        : [];
    if (!ids.length) {
      notify({ tone: "error", message: "请先框选或选中至少一个元件" });
      return;
    }
    dialogs.value.capture = true;
  }

  function submitCapture(payload: {
    name: string;
    params: { name: string; min: number; max: number; default: number }[];
    note: string;
    ports: {
      wireId: string;
      direction: "input" | "output";
      name: string;
      width: string;
    }[];
  }) {
    const ids = circuit.multiSelection.value.length
      ? circuit.multiSelection.value
      : circuit.selected.value
        ? [circuit.selected.value]
        : [];
    const result = lib.captureSelection(
      ids,
      payload.name,
      payload.params,
      payload.note,
      payload.ports,
    );
    if (!result.ok) {
      notify({ tone: "error", message: result.message });
      return;
    }
    dialogs.value.capture = false;
    circuit.resetSelection();
  }

  function openLibrary(defId?: string) {
    dialogs.value.library = true;
    if (defId) lib.selectedDefId.value = defId;
  }

  function importLibraryText(text: string) {
    const error = lib.importLibrary(text);
    if (error) notify({ tone: "error", message: `库导入失败：${error}` });
    else notify({ tone: "success", message: "子电路库已合并导入" });
  }

  function publishDefinition(payload: { defId: string } & Parameters<typeof lib.publish>[1]) {
    const result = lib.publish(payload.defId, payload);
    if (!result.ok) notify({ tone: "error", message: result.message });
  }

  function dropDefinition(defId: string) {
    lib.dropDefinition(defId);
  }

  function openInspector(id: string | null) {
    dialogs.value.inspector = id;
    if (id) lib.openUpgrade(id);
    upgradeOpen.value = false;
  }

  function openInstanceBody(path: string) {
    inspectedInstance.value = path;
    dialogs.value.body = path;
  }

  function openUpgrade(id: string, version?: number) {
    lib.openUpgrade(id, version);
    upgradeOpen.value = true;
  }

  function confirmUpgrade() {
    const preview = lib.upgrading.value;
    if (!preview) return;
    const ok = lib.confirmUpgrade();
    if (ok) upgradeOpen.value = false;
    void preview;
  }

  function setInstanceParam(name: string, raw: string) {
    const node = document.value.nodes.find(
      (item) => item.id === dialogs.value.inspector,
    );
    if (!node || node.kind !== "SUBCIRCUIT") return;
    const value = Number(raw);
    node.paramArgs = node.paramArgs ?? {};
    if (!raw.trim()) delete node.paramArgs[name];
    else if (Number.isInteger(value) && value >= 1 && value <= 16)
      node.paramArgs[name] = { kind: "const", value };
    else {
      notify({ tone: "error", message: "参数需要是 1–16 的整数" });
      return;
    }
    lib.refreshUpgrade();
  }

  function setNodeWidth(id: string, width: number) {
    simulation.setWidth(id, width);
  }
  function setNodeBits(id: string, index: number, value: 0 | 1) {
    const node = document.value.nodes.find((item) => item.id === id);
    if (!node || node.kind !== "INPUT") return;
    const width = node.width ?? 1;
    const bits = Array.from({ length: width }, (_, i) => node.bits?.[i] ?? 0);
    bits[index] = value;
    node.bits = bits as (0 | 1)[];
    node.value = bits[0] ?? 0;
  }
  function setSlice(id: string, width: number, offset: number) {
    const node = document.value.nodes.find((item) => item.id === id);
    if (!node || node.kind !== "SLICE") return;
    node.sliceWidth = Math.max(1, Math.min(16, Math.round(width)));
    node.sliceOffset = Math.max(0, Math.min(15, Math.round(offset)));
  }
  function setPorts(id: string, ports: number) {
    const node = document.value.nodes.find((item) => item.id === id);
    if (!node || node.kind !== "CONCAT") return;
    node.ports = Math.max(2, Math.min(16, Math.round(ports)));
    document.value.wires = document.value.wires.filter(
      (wire) => wire.to.nodeId !== id || wire.to.port < node.ports!,
    );
  }

  function applyParamOption(option: Record<string, Record<string, number>>) {
    for (const [path, params] of Object.entries(option)) {
      const segments = path ? path.split("/") : [];
      const last = segments[segments.length - 1];
      const node = document.value.nodes.find((item) => item.id === last);
      if (!node) continue;
      node.paramArgs = node.paramArgs ?? {};
      for (const [name, value] of Object.entries(params))
        node.paramArgs[name] = { kind: "const", value };
    }
    notify({ tone: "success", message: "已应用所选的参数组合" });
  }

  const useCounts = computed(() => {
    const counts: Record<string, number> = {};
    const visit = (nodes: GateNode[]) => {
      for (const node of nodes) {
        if (node.kind === "SUBCIRCUIT" && node.defId)
          counts[node.defId] = (counts[node.defId] ?? 0) + 1;
      }
    };
    visit(document.value.nodes);
    for (const def of library.value)
      for (const version of def.versions) visit(version.nodes);
    return counts;
  });

  const inspectorNode = computed<GateNode | null>(() => {
    const id = dialogs.value.inspector;
    if (!id) return null;
    return document.value.nodes.find((node) => node.id === id) ?? null;
  });

  const inspectorSummary = computed(() => {
    const id = dialogs.value.inspector;
    if (!id) return null;
    return model.value.instanceSummary(id) ?? null;
  });

  const upgradePreview = computed<UpgradePreview | null>(() => lib.upgrading.value);

  return {
    document,
    library: libraryView,
    model,
    notice,
    notify,
    placement,
    circuit,
    simulation,
    challenge,
    workspace,
    dialogs,
    inspectedInstance,
    upgradeOpen,
    placedTool: computed(() => placement.tool.value as PlacementTool | null),
    place,
    move,
    cancel,
    renameNode,
    beginCapture,
    submitCapture,
    openLibrary,
    importLibraryText,
    publishDefinition,
    dropDefinition,
    openInspector,
    openInstanceBody,
    openUpgrade,
    confirmUpgrade,
    setInstanceParam,
    setNodeWidth,
    setNodeBits,
    setSlice,
    setPorts,
    applyParamOption,
    useCounts,
    inspectorNode,
    inspectorSummary,
    upgradePreview,
    lib,
  };
}
