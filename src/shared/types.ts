export type Signal = 0 | 1 | "X";
/** A bus is stored least-significant bit first. */
export type Bus = Signal[];

export type BaseGateKind =
  | "INPUT"
  | "OUTPUT"
  | "AND"
  | "OR"
  | "XOR"
  | "NOT"
  | "NAND"
  | "NOR";

export type GateKind =
  | BaseGateKind
  | "SUBCIRCUIT"
  | "SLICE"
  | "CONCAT"
  | "SUBPORT_IN"
  | "SUBPORT_OUT";

export interface Point {
  x: number;
  y: number;
}

/** Symbolic width expression used by reusable subcircuit definitions. */
export type WidthExpr =
  | { kind: "const"; value: number }
  | { kind: "param"; name: string }
  | { kind: "add"; left: WidthExpr; right: WidthExpr }
  | { kind: "sub"; left: WidthExpr; right: WidthExpr }
  | { kind: "mul"; left: WidthExpr; right: WidthExpr };

export interface WidthParamSpec {
  name: string;
  min: number;
  max: number;
  default: number;
}

export interface BoundaryPort {
  /** Stable identity. Renaming or reordering never changes it. */
  key: string;
  name: string;
  direction: "input" | "output";
  width: WidthExpr;
}

export interface GateNode extends Point {
  id: string;
  kind: GateKind;
  label: string;
  /** Legacy single-bit switch state; width-1 inputs keep using it. */
  value: 0 | 1;
  /** Declared bus width for INPUT / OUTPUT nodes (1..16). */
  width?: number;
  /** Individual switch states for a multi-bit INPUT node, LSB first. */
  bits?: (0 | 1)[];
  /** Subcircuit instance identity. */
  defId?: string;
  defVersion?: number;
  /** Explicit parameter values. Omitted entries are inferred from wiring. */
  paramArgs?: Record<string, WidthExpr>;
  /** Stable boundary port key for SUBPORT_IN / SUBPORT_OUT body nodes. */
  portKey?: string;
  /** SLICE: extracted width and starting bit. */
  sliceWidth?: number;
  sliceOffset?: number;
  /** CONCAT: number of input ports. */
  ports?: number;
}

export interface Endpoint {
  nodeId: string;
  /** Index for ordinary ports. Subcircuit ports use `portKey` as identity. */
  port: number;
  /** Authoritative identity for subcircuit boundary ports. */
  portKey?: string;
}

export interface Wire {
  id: string;
  from: Endpoint;
  to: Endpoint;
}

export interface SubcircuitVersion {
  version: number;
  params: WidthParamSpec[];
  ports: BoundaryPort[];
  nodes: GateNode[];
  wires: Wire[];
  note: string;
  createdAt: number;
}

export interface SubcircuitDef {
  id: string;
  name: string;
  versions: SubcircuitVersion[];
}

export interface CircuitDocument {
  version: 1;
  name: string;
  nodes: GateNode[];
  wires: Wire[];
  targetId: string;
}

export interface GateSpec {
  kind: GateKind;
  name: string;
  symbol: string;
  inputs: number;
  outputs: number;
  description: string;
  family?: "base" | "bus" | "subport" | "subcircuit";
}

export interface NodeWidths {
  inputs: (number | null)[];
  outputs: (number | null)[];
}

export interface SimulationIssue {
  tone: "error" | "warning" | "info";
  message: string;
}

/** Evaluation result of one circuit scope (experiment or one instance body). */
export interface SimulationResult {
  values: Record<string, Bus>;
  pins: Record<string, Bus[]>;
  wires: Record<string, Bus>;
  order: string[];
  widths: Record<string, NodeWidths>;
  /** Internal scopes keyed by instance path, e.g. "sub-1/sub-2". */
  scopes: Record<string, SimulationResult>;
  /** Instance node ids whose parameters could not be resolved. */
  unresolved: string[];
  errors: SimulationIssue[];
}

export interface LibraryDocument {
  version: 2;
  definitions: SubcircuitDef[];
}

export interface WorkspaceFile {
  version: 2;
  document: CircuitDocument;
  library: SubcircuitDef[];
}
