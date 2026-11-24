import { computed, ref, type Ref } from "vue";
import type { CircuitDocument, SubcircuitDef } from "@/shared/types";
import type { WidthModel } from "@/features/library";
import { targetById } from "../lib/targets";
import { truthTable } from "../lib/truthTable";

export function useChallenge(
  document: Ref<CircuitDocument>,
  library: Ref<SubcircuitDef[]>,
  model: Ref<WidthModel>,
) {
  const inspected = ref(false);
  const hint = ref(false);
  const target = computed(() => targetById(document.value.targetId));
  const table = computed(() =>
    truthTable(document.value, target.value, library.value, model.value),
  );
  const passed = computed(
    () => !table.value.error && table.value.rows.every((row) => row.matches),
  );
  function choose(id: string) {
    document.value.targetId = id;
    inspected.value = false;
    hint.value = false;
  }
  function reset() {
    inspected.value = false;
    hint.value = false;
  }
  return { target, table, passed, inspected, hint, choose, reset };
}
