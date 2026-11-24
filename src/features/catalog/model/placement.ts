import { ref } from "vue";
import type { CircuitDocument, GateNode, GateKind, Point } from "@/shared/types";
import { createId } from "@/shared/document";

export interface PlacementTool {
  kind: GateKind;
  /** Present for SUBCIRCUIT placements. */
  defId?: string;
  defVersion?: number;
  name?: string;
}

export function usePlacement() {
  const tool = ref<PlacementTool | null>(null);

  function choose(next: PlacementTool | null) {
    tool.value = next;
  }

  function createNode(
    document: CircuitDocument,
    placement: PlacementTool,
    position: Point,
  ): GateNode {
    const peers = document.nodes.filter((node) => node.kind === placement.kind);
    const base = peers.length + 1;
    const node: GateNode = {
      id: createId("node"),
      kind: placement.kind,
      label: defaultLabel(placement, document, base),
      value: 0,
      x: position.x,
      y: position.y,
    };
    if (placement.kind === "SLICE") {
      node.sliceWidth = 1;
      node.sliceOffset = 0;
    }
    if (placement.kind === "CONCAT") node.ports = 2;
    if (placement.kind === "INPUT" || placement.kind === "OUTPUT") node.width = 1;
    if (placement.kind === "SUBCIRCUIT") {
      node.defId = placement.defId;
      node.defVersion = placement.defVersion;
      node.paramArgs = {};
    }
    return node;
  }

  return { tool, choose, createNode };
}

function defaultLabel(
  placement: PlacementTool,
  document: CircuitDocument,
  index: number,
): string {
  const { kind } = placement;
  if (kind === "INPUT")
    return (
      ["A", "B", "C", "D"].find(
        (name) => !document.nodes.some((node) => node.label === name),
      ) ?? `I${index}`
    );
  if (kind === "OUTPUT") return index === 1 ? "Y" : `Y${index}`;
  if (kind === "SUBCIRCUIT") return `${placement.name ?? "子电路"} ${index}`;
  if (kind === "SLICE") return `SLICE ${index}`;
  if (kind === "CONCAT") return `CAT ${index}`;
  return `${kind} ${index}`;
}
