import type { CircuitDocument, SubcircuitDef } from "@/shared/types";


export function sampleCircuit(): CircuitDocument {
  return {
    version: 1,
    name: "我的异或电路",
    targetId: "xor",
    nodes: [
      { id: "a", kind: "INPUT", label: "A", value: 0, width: 1, x: 60, y: 120 },
      { id: "b", kind: "INPUT", label: "B", value: 0, width: 1, x: 60, y: 340 },
      { id: "or", kind: "OR", label: "OR 1", value: 0, x: 320, y: 120 },
      { id: "nand", kind: "NAND", label: "NAND 1", value: 0, x: 320, y: 340 },
      { id: "and", kind: "AND", label: "AND 1", value: 0, x: 580, y: 230 },
      { id: "y", kind: "OUTPUT", label: "Y", value: 0, width: 1, x: 820, y: 230 },
    ],
    wires: [
      { id: "w1", from: { nodeId: "a", port: 0 }, to: { nodeId: "or", port: 0 } },
      { id: "w2", from: { nodeId: "b", port: 0 }, to: { nodeId: "or", port: 1 } },
      { id: "w3", from: { nodeId: "a", port: 0 }, to: { nodeId: "nand", port: 0 } },
      { id: "w4", from: { nodeId: "b", port: 0 }, to: { nodeId: "nand", port: 1 } },
      { id: "w5", from: { nodeId: "or", port: 0 }, to: { nodeId: "and", port: 0 } },
      { id: "w6", from: { nodeId: "nand", port: 0 }, to: { nodeId: "and", port: 1 } },
      { id: "w7", from: { nodeId: "and", port: 0 }, to: { nodeId: "y", port: 0 } },
    ],
  };
}

export function emptyCircuit(): CircuitDocument {
  return { version: 1, name: "未命名实验", targetId: "xor", nodes: [], wires: [] };
}

/**
 * A ready-made 4-bit adder library so the feature is discoverable. The body
 * uses one full-adder expressed with two XOR, two AND and one OR, with N = 1.
 */
export function seedLibrary(): SubcircuitDef[] {
  const param = { name: "N", min: 1, max: 16, default: 1 };
  const n = { kind: "param" as const, name: "N" };
  return [
    {
      id: "seed-full-adder",
      name: "全加器位",
      versions: [
        {
          version: 1,
          params: [param],
          ports: [
            { key: "fa-a", name: "A", direction: "input", width: n },
            { key: "fa-b", name: "B", direction: "input", width: n },
            { key: "fa-cin", name: "Cin", direction: "input", width: n },
            { key: "fa-s", name: "S", direction: "output", width: n },
            { key: "fa-co", name: "Cout", direction: "output", width: n },
          ],
          nodes: [
            { id: "fa-pa", kind: "SUBPORT_IN", label: "A", value: 0, x: 40, y: 80, portKey: "fa-a" },
            { id: "fa-pb", kind: "SUBPORT_IN", label: "B", value: 0, x: 40, y: 220, portKey: "fa-b" },
            { id: "fa-pc", kind: "SUBPORT_IN", label: "Cin", value: 0, x: 40, y: 360, portKey: "fa-cin" },
            { id: "fa-x1", kind: "XOR", label: "XOR 1", value: 0, x: 240, y: 140 },
            { id: "fa-x2", kind: "XOR", label: "XOR 2", value: 0, x: 460, y: 200 },
            { id: "fa-a1", kind: "AND", label: "AND 1", value: 0, x: 420, y: 40 },
            { id: "fa-a2", kind: "AND", label: "AND 2", value: 0, x: 420, y: 320 },
            { id: "fa-o1", kind: "OR", label: "OR 1", value: 0, x: 640, y: 180 },
            { id: "fa-ps", kind: "SUBPORT_OUT", label: "S", value: 0, x: 820, y: 200, portKey: "fa-s" },
            { id: "fa-pco", kind: "SUBPORT_OUT", label: "Cout", value: 0, x: 820, y: 340, portKey: "fa-co" },
          ],
          wires: [
            { id: "fa-w1", from: { nodeId: "fa-pa", port: 0 }, to: { nodeId: "fa-x1", port: 0 } },
            { id: "fa-w2", from: { nodeId: "fa-pb", port: 0 }, to: { nodeId: "fa-x1", port: 1 } },
            { id: "fa-w3", from: { nodeId: "fa-x1", port: 0 }, to: { nodeId: "fa-x2", port: 0 } },
            { id: "fa-w4", from: { nodeId: "fa-pc", port: 0 }, to: { nodeId: "fa-x2", port: 1 } },
            { id: "fa-w5", from: { nodeId: "fa-x1", port: 0 }, to: { nodeId: "fa-a1", port: 0 } },
            { id: "fa-w6", from: { nodeId: "fa-pc", port: 0 }, to: { nodeId: "fa-a1", port: 1 } },
            { id: "fa-w7", from: { nodeId: "fa-pa", port: 0 }, to: { nodeId: "fa-a2", port: 0 } },
            { id: "fa-w8", from: { nodeId: "fa-pb", port: 0 }, to: { nodeId: "fa-a2", port: 1 } },
            { id: "fa-w9", from: { nodeId: "fa-a1", port: 0 }, to: { nodeId: "fa-o1", port: 0 } },
            { id: "fa-w10", from: { nodeId: "fa-a2", port: 0 }, to: { nodeId: "fa-o1", port: 1 } },
            { id: "fa-w11", from: { nodeId: "fa-x2", port: 0 }, to: { nodeId: "fa-ps", port: 0 } },
            { id: "fa-w12", from: { nodeId: "fa-o1", port: 0 }, to: { nodeId: "fa-pco", port: 0 } },
          ],
          note: "A + B + Cin 的单位全加器；N 为按位总线的宽度",
          createdAt: 0,
        },
      ],
    },
  ];
}

export function seedBusCircuit(): CircuitDocument {
  return {
    version: 1,
    name: "4 位取反与切片",
    targetId: "xor",
    nodes: [
      { id: "ba", kind: "INPUT", label: "A", value: 0, width: 4, bits: [1, 0, 1, 0], x: 60, y: 100 },
      { id: "bnot", kind: "NOT", label: "NOT 1", value: 0, x: 300, y: 100 },
      { id: "by", kind: "OUTPUT", label: "Y", value: 0, width: 4, x: 620, y: 100 },
      { id: "bslice", kind: "SLICE", label: "SLICE 1", value: 0, x: 300, y: 320, sliceWidth: 2, sliceOffset: 1 },
      { id: "by2", kind: "OUTPUT", label: "Y2", value: 0, width: 2, x: 620, y: 320 },
    ],
    wires: [
      { id: "bw1", from: { nodeId: "ba", port: 0 }, to: { nodeId: "bnot", port: 0 } },
      { id: "bw2", from: { nodeId: "bnot", port: 0 }, to: { nodeId: "by", port: 0 } },
      { id: "bw3", from: { nodeId: "ba", port: 0 }, to: { nodeId: "bslice", port: 0 } },
      { id: "bw4", from: { nodeId: "bslice", port: 0 }, to: { nodeId: "by2", port: 0 } },
    ],
  };
}

export function seedInstanceCircuit(): { document: CircuitDocument; library: SubcircuitDef[] } {
  const library = seedLibrary();
  const def = library[0];
  const version = def.versions[0];
  return {
    library,
    document: {
      version: 1,
      name: "子电路示例：两位全加",
      targetId: "xor",
      nodes: [
        { id: "ia", kind: "INPUT", label: "A", value: 0, width: 1, x: 60, y: 120 },
        { id: "ib", kind: "INPUT", label: "B", value: 0, width: 1, x: 60, y: 300 },
        {
          id: "fa1",
          kind: "SUBCIRCUIT",
          label: "FA 低位",
          value: 0,
          x: 300,
          y: 120,
          defId: def.id,
          defVersion: version.version,
        },
        { id: "isum", kind: "OUTPUT", label: "Y", value: 0, width: 1, x: 700, y: 120 },
        { id: "cout", kind: "OUTPUT", label: "Cout", value: 0, width: 1, x: 700, y: 340 },
        { id: "zero", kind: "INPUT", label: "Cin", value: 0, width: 1, x: 60, y: 430 },
      ],
      wires: [
        { id: "iw1", from: { nodeId: "ia", port: 0 }, to: { nodeId: "fa1", port: 0, portKey: "fa-a" } },
        { id: "iw2", from: { nodeId: "ib", port: 0 }, to: { nodeId: "fa1", port: 1, portKey: "fa-b" } },
        { id: "iw3", from: { nodeId: "zero", port: 0 }, to: { nodeId: "fa1", port: 2, portKey: "fa-cin" } },
        { id: "iw4", from: { nodeId: "fa1", port: 0, portKey: "fa-s" }, to: { nodeId: "isum", port: 0 } },
        { id: "iw5", from: { nodeId: "fa1", port: 1, portKey: "fa-co" }, to: { nodeId: "cout", port: 0 } },
      ],
    },
  };
}
