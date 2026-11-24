import type { CircuitDocument, Signal, SubcircuitDef } from "@/shared/types";
import type { WidthModel } from "@/features/library";
import { evaluate } from "@/features/simulation";
import type { Target } from "./targets";

export interface TruthRow {
  a: 0 | 1;
  b: 0 | 1;
  expected: 0 | 1;
  actual: Signal;
  matches: boolean;
}

export function truthTable(
  document: CircuitDocument,
  target: Target,
  library: readonly SubcircuitDef[],
  model: WidthModel,
): { rows: TruthRow[]; error: string | null } {
  const inputs = document.nodes.filter((node) => node.kind === "INPUT");
  const a = inputs.filter((node) => node.label === "A");
  const b = inputs.filter((node) => node.label === "B");
  const outputs = document.nodes.filter(
    (node) => node.kind === "OUTPUT" && node.label === "Y",
  );
  const singleBit =
    a.every((node) => (node.width ?? 1) === 1) &&
    b.every((node) => (node.width ?? 1) === 1) &&
    outputs.every((node) => (node.width ?? 1) === 1);
  if (inputs.length !== 2 || a.length !== 1 || b.length !== 1 || outputs.length !== 1)
    return {
      rows: [],
      error: "目标检测需要恰好两个输入 A、B，以及一个名为 Y 的输出。",
    };
  if (!singleBit)
    return {
      rows: [],
      error: "目标检测针对单比特实验：请把 A、B、Y 设为 1 位，或使用总线示例。",
    };
  if (!model.ok)
    return { rows: [], error: "当前存在位宽问题，请先查看信号观测中的提示。" };
  return {
    error: null,
    rows: target.expected.map((expected, index) => {
      const av = (index >> 1) as 0 | 1;
      const bv = (index & 1) as 0 | 1;
      const result = evaluate(document, library, model, {
        overrides: { [a[0].id]: av, [b[0].id]: bv },
      });
      const bus = result.values[outputs[0].id] ?? [];
      const actual: Signal = bus.length === 1 ? bus[0] : "X";
      return { a: av, b: bv, expected, actual, matches: actual === expected };
    }),
  };
}
