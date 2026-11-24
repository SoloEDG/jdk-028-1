import { ref, type Ref } from "vue";
import type { CircuitDocument, SubcircuitDef } from "@/shared/types";
import type { Notice, PortRequest } from "@/shared/commands";
import { removeNode } from "@/shared/document";
import type { WidthModel } from "@/features/library";
import { connect } from "./connections";

export function useCircuit(
  document: Ref<CircuitDocument>,
  library: Ref<SubcircuitDef[]>,
  notify: (notice: Notice) => void,
  model: () => WidthModel | null,
) {
  const selected = ref<string | null>(null);
  const multiSelection = ref<string[]>([]);
  const pending = ref<PortRequest | null>(null);

  function resetSelection() {
    selected.value = null;
    multiSelection.value = [];
    pending.value = null;
  }

  function select(id: string | null) {
    selected.value = id;
    multiSelection.value = [];
  }

  function toggleMulti(id: string) {
    const current = [...multiSelection.value];
    // The first shift-click should extend the existing single selection.
    if (!current.length && selected.value && selected.value !== id)
      current.push(selected.value);
    const index = current.indexOf(id);
    if (index >= 0) current.splice(index, 1);
    else current.push(id);
    multiSelection.value = current;
    selected.value = current[0] ?? id;
  }

  function selectBox(ids: string[]) {
    multiSelection.value = [...new Set(ids)];
    selected.value = multiSelection.value[0] ?? null;
  }

  function pickPort(port: PortRequest) {
    if (port.direction === "output") {
      pending.value = port;
      notify({ tone: "info", message: "已选择输出端口，请点击一个输入端口" });
      return;
    }
    if (!pending.value) {
      notify({ tone: "error", message: "请先点击元件右侧的输出端口" });
      return;
    }
    const error = connect(document.value, pending.value, port, {
      library: library.value,
      model: model(),
    });
    if (error) notify({ tone: "error", message: error });
    else {
      pending.value = null;
      notify({ tone: "success", message: "连接成功，信号已更新" });
    }
  }

  function deleteSelected() {
    const ids =
      multiSelection.value.length > 1
        ? [...multiSelection.value]
        : selected.value
          ? [selected.value]
          : [];
    if (!ids.length) return;
    const removedNodes = ids.filter((id) =>
      document.value.nodes.some((node) => node.id === id),
    );
    for (const id of removedNodes) removeNode(document.value, id);
    if (!removedNodes.length && ids.length === 1)
      document.value.wires = document.value.wires.filter(
        (wire) => wire.id !== ids[0],
      );
    resetSelection();
    notify({
      tone: "info",
      message: removedNodes.length
        ? `已删除 ${removedNodes.length} 个元件`
        : "已删除所选连线",
    });
  }

  return {
    selected,
    multiSelection,
    pending,
    select,
    toggleMulti,
    selectBox,
    pickPort,
    deleteSelected,
    resetSelection,
  };
}
