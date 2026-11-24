import { ref, watch, type Ref } from "vue";
import type { CircuitDocument, SubcircuitDef } from "@/shared/types";
import type { Notice } from "@/shared/commands";
import {
  decodeDocument,
  decodeWorkspace,
  encodeDocument,
  encodeLibrary,
} from "../lib/codec";
import {
  sampleCircuit,
  emptyCircuit,
  seedBusCircuit,
  seedInstanceCircuit,
} from "../lib/seeds";

export const STORAGE_KEY = "logic-lab-jdk-028-v2";
export const LEGACY_STORAGE_KEY = "logic-lab-jdk-028-v1";

export interface WorkspaceSnapshot {
  document: CircuitDocument;
  library: SubcircuitDef[];
}

export function loadInitial(): WorkspaceSnapshot & { warning: string | null } {
  const text =
    localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!text)
    return { ...seedInstanceCircuit(), warning: null };
  try {
    return { ...decodeWorkspace(text), warning: null };
  } catch {
    try {
      return { ...seedInstanceCircuit(), warning: "本地存档无法读取，已打开示例；导出当前实验后可重新保存。" };
    } catch {
      return {
        document: sampleCircuit(),
        library: [],
        warning: "本地存档无法读取，已打开示例。",
      };
    }
  }
}

export function useWorkspace(
  document: Ref<CircuitDocument>,
  library: Ref<SubcircuitDef[]>,
  notify: (notice: Notice) => void,
  reset: () => void,
) {
  const status = ref("本地自动保存");

  function snapshot(): WorkspaceSnapshot {
    return {
      document: JSON.parse(JSON.stringify(document.value)) as CircuitDocument,
      library: JSON.parse(JSON.stringify(library.value)) as SubcircuitDef[],
    };
  }

  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 2, ...snapshot() }),
      );
      status.value = "已保存到此浏览器";
    } catch {
      status.value = "保存失败，请导出文件";
      notify({ tone: "error", message: "浏览器存储不可用，请导出实验文件" });
    }
  }

  watch([document, library], save, { deep: true });

  function replace(next: WorkspaceSnapshot) {
    document.value = next.document;
    library.value = next.library;
    reset();
  }

  function sample() {
    replace({ document: sampleCircuit(), library: library.value });
    notify({ tone: "success", message: "已载入单比特异或示例" });
  }

  function sampleBus() {
    replace({ document: seedBusCircuit(), library: library.value });
    notify({ tone: "success", message: "已载入 4 位总线示例" });
  }

  function sampleInstance() {
    const next = seedInstanceCircuit();
    replace(next);
    notify({ tone: "success", message: "已载入子电路示例：两位全加" });
  }

  function clear() {
    replace({ document: emptyCircuit(), library: library.value });
    notify({ tone: "info", message: "已新建空白实验（子电路库保留）" });
  }

  function importText(text: string) {
    try {
      const next = decodeWorkspace(text);
      replace(next);
      notify({
        tone: "success",
        message: `导入成功：${next.document.nodes.length} 个元件、${next.library.length} 个子电路`,
      });
    } catch (error) {
      notify({
        tone: "error",
        message: `导入失败：${error instanceof Error ? error.message : "文件无法读取"}；当前实验已保留`,
      });
    }
  }

  function download(text: string, name: string, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = window.document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportFile() {
    download(
      JSON.stringify({ version: 2, ...snapshot() }, null, 2),
      `${document.value.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "logic-lab"}.json`,
    );
    notify({
      tone: "success",
      message: "工作区已导出（含子电路定义版本、实例参数与端口身份）",
    });
  }

  function exportLibraryFile() {
    download(
      encodeLibrary(library.value),
      `${document.value.name.replace(/[^\p{L}\p{N}_-]/gu, "_") || "logic-lab"}-library.json`,
    );
    notify({ tone: "success", message: "子电路库已导出" });
  }

  return {
    status,
    save,
    sample,
    sampleBus,
    sampleInstance,
    clear,
    importText,
    exportFile,
    exportLibraryFile,
    snapshot,
  };
}

export function encodeCurrent(document: CircuitDocument): string {
  return encodeDocument(document);
}
export function decodeWithLibrary(
  text: string,
  library: SubcircuitDef[],
): CircuitDocument {
  return decodeDocument(text, library);
}
