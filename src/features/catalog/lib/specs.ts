import type { GateSpec } from "@/shared/types";

export const gateSpecs: readonly GateSpec[] = [
  {
    kind: "INPUT",
    name: "输入开关",
    symbol: "IN",
    inputs: 0,
    outputs: 1,
    description: "手动切换 0 / 1；可设为 1–16 位总线",
  },
  {
    kind: "OUTPUT",
    name: "输出指示灯",
    symbol: "OUT",
    inputs: 1,
    outputs: 0,
    description: "观察电路末端的逻辑电平或总线值",
  },
  {
    kind: "AND",
    name: "与门",
    symbol: "&",
    inputs: 2,
    outputs: 1,
    description: "按位与：两位输入逐位计算",
  },
  {
    kind: "OR",
    name: "或门",
    symbol: "≥1",
    inputs: 2,
    outputs: 1,
    description: "按位或",
  },
  {
    kind: "XOR",
    name: "异或门",
    symbol: "=1",
    inputs: 2,
    outputs: 1,
    description: "按位异或",
  },
  {
    kind: "NOT",
    name: "非门",
    symbol: "1̅",
    inputs: 1,
    outputs: 1,
    description: "按位取反",
  },
  {
    kind: "NAND",
    name: "与非门",
    symbol: "&̅",
    inputs: 2,
    outputs: 1,
    description: "按位与非",
  },
  {
    kind: "NOR",
    name: "或非门",
    symbol: "≥1̅",
    inputs: 2,
    outputs: 1,
    description: "按位或非",
  },
  {
    kind: "SLICE",
    name: "切片",
    symbol: "⌗",
    inputs: 1,
    outputs: 1,
    description: "从总线取出一段连续位，设置起点与宽度",
    family: "bus",
  },
  {
    kind: "CONCAT",
    name: "拼接",
    symbol: "⧺",
    inputs: 2,
    outputs: 1,
    description: "把多段总线拼成一条；段数 2–16",
    family: "bus",
  },
];

export function getSpec(kind: string): GateSpec {
  const spec = gateSpecs.find((item) => item.kind === kind);
  if (!spec) throw new Error(`未知元件类型：${kind}`);
  return spec;
}

export const baseGateSpecs = gateSpecs.filter((spec) => spec.family !== "bus");
export const busToolSpecs = gateSpecs.filter((spec) => spec.family === "bus");
