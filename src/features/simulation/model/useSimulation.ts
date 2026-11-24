import { computed, type ComputedRef, type Ref } from "vue";
import type { CircuitDocument, SimulationResult, SubcircuitDef } from "@/shared/types";
import type { WidthModel } from "@/features/library";
import { evaluate } from "../lib/evaluate";

export function useSimulation(
  document: Ref<CircuitDocument>,
  library: Ref<SubcircuitDef[]>,
  model: ComputedRef<WidthModel>,
) {
  const result = computed<SimulationResult>(() =>
    evaluate(document.value, library.value, model.value),
  );
  const signals = computed(() => result.value);

  /** Toggle all bits of an input, or one bit when an index is given. */
  function toggle(id: string, bit?: number) {
    const node = document.value.nodes.find((item) => item.id === id);
    if (node?.kind !== "INPUT") return;
    const width = node.width ?? 1;
    if (width <= 1) {
      node.value = node.value === 0 ? 1 : 0;
      return;
    }
    const bits = Array.from({ length: width }, (_, index) => node.bits?.[index] ?? 0);
    if (bit === undefined) {
      const next = bits.map((value) => (value === 0 ? 1 : 0)) as (0 | 1)[];
      node.bits = next;
      node.value = next[0] ?? 0;
    } else {
      bits[bit] = bits[bit] === 1 ? 0 : 1;
      node.bits = bits as (0 | 1)[];
      node.value = bits[0] ?? 0;
    }
  }

  function setWidth(id: string, width: number) {
    const node = document.value.nodes.find((item) => item.id === id);
    if (!node) return;
    const clamped = Math.max(1, Math.min(16, Math.round(width) || 1));
    node.width = clamped;
    if (node.kind === "INPUT") {
      const bits = Array.from({ length: clamped }, (_, index) => node.bits?.[index] ?? 0);
      node.bits = bits as (0 | 1)[];
      node.value = bits[0] ?? 0;
    }
  }

  return { signals, result, toggle, setWidth };
}
