import type { GateKind, Point } from "./types";

export interface PlacementRequest {
  kind: GateKind;
  defId?: string;
  position: Point;
}
export interface PortRequest {
  nodeId: string;
  port: number;
  portKey?: string;
  direction: "input" | "output";
}
export type Notice = {
  tone: "info" | "error" | "success";
  message: string;
};
