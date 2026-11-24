import type { CircuitDocument, Endpoint, GateNode } from "@/shared/types";
import { createId, findNode } from "@/shared/document";
import type { WidthModel } from "@/features/library";
import { concatPorts, findPort, portCounts, versionFor } from "@/features/library";
import { topologicalOrder } from "../lib/graph";

export interface ConnectionContext {
  library: readonly import("@/shared/types").SubcircuitDef[];
  model: WidthModel | null;
}

/** Verify a candidate endpoint exists on the node, by stable port identity when available. */
export function endpointValid(
  node: GateNode,
  endpoint: Endpoint,
  direction: "input" | "output",
  library: readonly import("@/shared/types").SubcircuitDef[],
): boolean {
  if (node.kind === "SUBCIRCUIT") {
    const version = versionFor(library, node.defId, node.defVersion);
    const port = findPort(version, direction, endpoint.portKey, endpoint.port);
    return !!port && (!endpoint.portKey || port.key === endpoint.portKey);
  }
  const counts = portCounts(node);
  const count = direction === "input" ? counts.inputs : counts.outputs;
  if (!Number.isInteger(endpoint.port) || endpoint.port < 0 || endpoint.port >= count)
    return false;
  return true;
}

export function validateConnection(
  document: CircuitDocument,
  from: Endpoint,
  to: Endpoint,
  context: ConnectionContext,
): string | null {
  if (document.wires.length >= 480)
    return "最多支持 480 条连线，请先删除不用的连线";
  const source = findNode(document, from.nodeId);
  const target = findNode(document, to.nodeId);
  if (!source || !target) return "元件已不存在，请重新选择端口";
  if (from.nodeId === to.nodeId) return "不能将元件连接到自身";
  if (source.kind === "SUBPORT_OUT" || target.kind === "SUBPORT_IN")
    return "边界端点只能在子电路内部接线";
  if (!endpointValid(source, from, "output", context.library))
    return "请选择有效的输出端口";
  if (!endpointValid(target, to, "input", context.library))
    return "请选择有效的输入端口";
  if (target.kind === "CONCAT" && to.port >= concatPorts(target))
    return "拼接器没有这个输入段";
  const occupied = document.wires.some((wire) => {
    if (wire.to.nodeId !== to.nodeId) return false;
    if (target.kind === "SUBCIRCUIT" && to.portKey)
      return wire.to.portKey === to.portKey;
    return wire.to.port === to.port;
  });
  if (occupied) return "这个输入端口已有连线，请先选择旧连线并删除";
  try {
    topologicalOrder({
      ...document,
      wires: [...document.wires, { id: "candidate", from, to }],
    });
  } catch {
    return "该连线会形成反馈环；请连接到下游元件";
  }
  if (context.model) {
    const candidate: CircuitDocument = {
      ...document,
      wires: [...document.wires, { id: "candidate", from, to }],
    };
    // Rebuild widths lazily by the caller; here we report obvious constant mismatches.
    const fromWidth = context.model.outputWidth("", from.nodeId, from);
    const toWidth = context.model.inputWidth("", to.nodeId, to);
    if (fromWidth !== null && toWidth !== null && fromWidth !== toWidth)
      return `位宽不匹配：输出是 ${fromWidth} 位，输入需要 ${toWidth} 位。请使用切片或拼接对齐`;
    void candidate;
  }
  return null;
}

export function connect(
  document: CircuitDocument,
  from: Endpoint,
  to: Endpoint,
  context: ConnectionContext,
): string | null {
  const error = validateConnection(document, from, to, context);
  if (!error)
    document.wires.push({
      id: createId("wire"),
      from: { ...from },
      to: { ...to },
    });
  return error;
}

export function endpointKey(endpoint: Endpoint): string {
  return `${endpoint.nodeId}:${endpoint.portKey ?? endpoint.port}`;
}

export function endpointsEqual(a: Endpoint, b: Endpoint): boolean {
  if (a.nodeId !== b.nodeId) return false;
  if (a.portKey || b.portKey) return a.portKey === b.portKey;
  return a.port === b.port;
}
