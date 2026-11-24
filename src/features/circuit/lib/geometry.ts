import type { GateNode, Point } from "@/shared/types";
import type { WidthModel, PortSummary } from "@/features/library";

export const BOARD = {
  width: 1000,
  height: 560,
  nodeWidth: 132,
  nodeHeight: 92,
};

export function snapPosition(point: Point): Point {
  return {
    x: Math.round(Math.max(24, Math.min(844, point.x)) / 20) * 20,
    y: Math.round(Math.max(40, Math.min(444, point.y)) / 20) * 20,
  };
}

export interface PortLayout {
  key: string | undefined;
  index: number;
  name: string;
  width: number | null;
  point: Point;
}

export function portsOfNode(
  model: WidthModel | null,
  scopePath: string,
  node: GateNode,
): { inputs: PortSummary[]; outputs: PortSummary[] } {
  const ports = model?.nodePorts(scopePath, node.id) ?? [];
  return {
    inputs: ports.filter((port) => port.direction === "input"),
    outputs: ports.filter((port) => port.direction === "output"),
  };
}

function layoutPorts(
  node: GateNode,
  ports: PortSummary[],
  direction: "input" | "output",
): PortLayout[] {
  const count = Math.max(1, ports.length);
  return ports.map((port, index) => ({
    key: port.key || undefined,
    index: port.index,
    name: port.name,
    width: port.width,
    point: {
      x: node.x + (direction === "output" ? BOARD.nodeWidth : 0),
      y: node.y + (BOARD.nodeHeight * (index + 1)) / (count + 1),
    },
  }));
}

export function nodePortLayouts(
  model: WidthModel | null,
  scopePath: string,
  node: GateNode,
): { inputs: PortLayout[]; outputs: PortLayout[] } {
  const ports = portsOfNode(model, scopePath, node);
  return {
    inputs: layoutPorts(node, ports.inputs, "input"),
    outputs: layoutPorts(node, ports.outputs, "output"),
  };
}

export function portPointOf(
  model: WidthModel | null,
  scopePath: string,
  node: GateNode,
  direction: "input" | "output",
  key: string | undefined,
  fallbackIndex: number,
): Point {
  const layouts = nodePortLayouts(model, scopePath, node);
  const list = direction === "input" ? layouts.inputs : layouts.outputs;
  const found =
    (key ? list.find((port) => port.key === key) : undefined) ??
    list[fallbackIndex] ??
    list[0];
  return found?.point ?? {
    x: node.x + (direction === "output" ? BOARD.nodeWidth : 0),
    y: node.y + BOARD.nodeHeight / 2,
  };
}

export function wirePath(from: Point, to: Point): string {
  const bend = Math.max(42, Math.abs(to.x - from.x) * 0.46);
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
}

export function nodeWidthPx(): number {
  return BOARD.nodeWidth;
}

export function busBadge(width: number | null): string {
  if (width === null) return "?";
  return width > 1 ? `${width}b` : "1b";
}
