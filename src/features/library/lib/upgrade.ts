import type {
  CircuitDocument,
  GateNode,
  SubcircuitDef,
  SubcircuitVersion,
  WidthExpr,
} from "@/shared/types";
import { cloneDocument } from "@/shared/document";
import { buildWidthModel, versionFor } from "./widths";
import { busToBinary } from "@/features/simulation/lib/evaluate";
import { evaluate } from "@/features/simulation/lib/evaluate";
import { formatExpr } from "./expr";

export interface PreviewPort {
  key: string;
  nameBefore: string;
  nameAfter: string | null;
  indexBefore: number;
  indexAfter: number | null;
  widthBefore: string;
  widthAfter: string | null;
  status: "same" | "renamed" | "moved" | "resized" | "removed";
}

export interface PreviewParam {
  name: string;
  before: string | null;
  after: string | null;
  status: "same" | "added" | "removed" | "changed";
}

export interface PreviewWire {
  wireId: string;
  side: "input" | "output";
  portKey: string | null;
  portName: string;
  peer: string;
  widthBefore: number | null;
  widthAfter: number | null;
  problem: "none" | "removed-port" | "incompatible" | "width-change";
  action: string;
}

export interface DetectionRow {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}

export interface UpgradePreview {
  instanceId: string;
  instanceLabel: string;
  defId: string;
  defName: string;
  fromVersion: number;
  toVersion: number;
  ports: PreviewPort[];
  params: PreviewParam[];
  wires: PreviewWire[];
  detection: DetectionRow[];
  detectionBefore: string;
  detectionAfter: string;
  blockers: string[];
  warnings: string[];
  canApply: boolean;
  /** Candidate document used for preview; never applied until confirmed. */
  candidate: CircuitDocument | null;
}

function targetVersionOf(
  def: SubcircuitDef,
  requested: number,
): SubcircuitVersion | null {
  return def.versions.find((item) => item.version === requested) ?? null;
}

function detectionLabels(
  document: CircuitDocument,
  library: readonly SubcircuitDef[],
): { labels: string[]; values: string[] } {
  const model = buildWidthModel(cloneDocument(document), library);
  const result = evaluate(cloneDocument(document), library, model);
  const labels: string[] = [];
  const values: string[] = [];
  for (const node of document.nodes) {
    if (node.kind === "INPUT") {
      labels.push(`输入 ${node.label}`);
      values.push(busToBinary(result.values[node.id]));
    }
    if (node.kind === "OUTPUT") {
      labels.push(`输出 ${node.label}`);
      values.push(busToBinary(result.values[node.id]));
    }
  }
  return { labels, values };
}

function challengeStatus(
  document: CircuitDocument,
  library: readonly SubcircuitDef[],
): string {
  const inputs = document.nodes.filter((node) => node.kind === "INPUT");
  const a = inputs.filter((node) => node.label === "A");
  const b = inputs.filter((node) => node.label === "B");
  const outputs = document.nodes.filter(
    (node) => node.kind === "OUTPUT" && node.label === "Y",
  );
  if (inputs.length !== 2 || a.length !== 1 || b.length !== 1 || outputs.length !== 1)
    return "目标检测：当前不满足 A/B/Y 配置，未参与检测";
  const expected =
    document.targetId === "xor"
      ? [0, 1, 1, 0]
      : document.targetId === "and"
        ? [0, 0, 0, 1]
        : [0, 1, 1, 1];
  let passed = 0;
  for (let index = 0; index < 4; index++) {
    const model = buildWidthModel(cloneDocument(document), library);
    const result = evaluate(cloneDocument(document), library, model, {
      overrides: { [a[0].id]: (index >> 1) as 0 | 1, [b[0].id]: (index & 1) as 0 | 1 },
    });
    const bus = result.values[outputs[0].id] ?? [];
    if (bus.length === 1 && bus[0] === expected[index]) passed++;
  }
  return passed === 4
    ? "目标检测：通过（4/4）"
    : `目标检测：未通过（${passed}/4）`;
}

function withInstanceVersion(
  document: CircuitDocument,
  instanceId: string,
  version: number,
): CircuitDocument {
  const candidate = cloneDocument(document);
  const node = candidate.nodes.find((item) => item.id === instanceId);
  if (node) node.defVersion = version;
  return candidate;
}

export function previewUpgrade(
  document: CircuitDocument,
  library: readonly SubcircuitDef[],
  instanceId: string,
  requestedVersion?: number,
): UpgradePreview {
  const node = document.nodes.find((item) => item.id === instanceId);
  const def = node?.defId ? library.find((item) => item.id === node.defId) : undefined;
  if (!node || node.kind !== "SUBCIRCUIT" || !def) {
    return {
      instanceId,
      instanceLabel: node?.label ?? instanceId,
      defId: node?.defId ?? "",
      defName: def?.name ?? "—",
      fromVersion: node?.defVersion ?? 0,
      toVersion: requestedVersion ?? 0,
      ports: [],
      params: [],
      wires: [],
      detection: [],
      detectionBefore: "",
      detectionAfter: "",
      blockers: ["找不到该实例或其子电路定义"],
      warnings: [],
      canApply: false,
      candidate: null,
    };
  }
  const fromVersion = node.defVersion ?? def.versions[0]?.version ?? 0;
  const target = targetVersionOf(def, requestedVersion ?? def.versions[def.versions.length - 1].version);
  if (!target) {
    return {
      instanceId,
      instanceLabel: node.label,
      defId: def.id,
      defName: def.name,
      fromVersion,
      toVersion: requestedVersion ?? 0,
      ports: [],
      params: [],
      wires: [],
      detection: [],
      detectionBefore: "",
      detectionAfter: "",
      blockers: [`目标版本 v${requestedVersion} 不存在`],
      warnings: [],
      canApply: false,
      candidate: null,
    };
  }
  const before = versionFor(library, def.id, fromVersion);
  const blockers: string[] = [];
  const warnings: string[] = [];

  /* Ports */
  const ports: PreviewPort[] = [];
  const beforePorts = before?.ports ?? [];
  const afterPorts = target.ports;
  for (const oldPort of beforePorts) {
    const newPort = afterPorts.find((item) => item.key === oldPort.key);
    if (!newPort) {
      ports.push({
        key: oldPort.key,
        nameBefore: oldPort.name,
        nameAfter: null,
        indexBefore: beforePorts.indexOf(oldPort),
        indexAfter: null,
        widthBefore: formatExpr(oldPort.width),
        widthAfter: null,
        status: "removed",
      });
      continue;
    }
    const sameDirection = newPort.direction === oldPort.direction;
    if (!sameDirection)
      blockers.push(`端口「${oldPort.name}」的方向从 ${oldPort.direction} 变为 ${newPort.direction}，需重新接线`);
    const indexBefore = beforePorts.indexOf(oldPort);
    const indexAfter = afterPorts.indexOf(newPort);
    const status: PreviewPort["status"] =
      formatExpr(oldPort.width) !== formatExpr(newPort.width)
        ? "resized"
        : oldPort.name !== newPort.name
          ? "renamed"
          : indexBefore !== indexAfter
            ? "moved"
            : "same";
    ports.push({
      key: oldPort.key,
      nameBefore: oldPort.name,
      nameAfter: newPort.name,
      indexBefore,
      indexAfter,
      widthBefore: formatExpr(oldPort.width),
      widthAfter: formatExpr(newPort.width),
      status,
    });
  }
  for (const newPort of afterPorts) {
    if (beforePorts.some((item) => item.key === newPort.key)) continue;
    ports.push({
      key: newPort.key,
      nameBefore: "—",
      nameAfter: newPort.name,
      indexBefore: -1,
      indexAfter: afterPorts.indexOf(newPort),
      widthBefore: "—",
      widthAfter: formatExpr(newPort.width),
      status: "same",
    });
    warnings.push(`新增端口「${newPort.name}」（${formatExpr(newPort.width)} 位），需接线后才能使用`);
  }

  /* Params */
  const params: PreviewParam[] = [];
  const beforeParams = before?.params ?? [];
  for (const param of beforeParams) {
    const next = target.params.find((item) => item.name === param.name);
    if (!next) {
      params.push({
        name: param.name,
        before: String(param.default),
        after: null,
        status: "removed",
      });
      warnings.push(
        `参数 ${param.name} 已被删除；依赖它的连接或嵌套参数需要重新指定`,
      );
      continue;
    }
    params.push({
      name: param.name,
      before: String(node.paramArgs?.[param.name] ? formatExpr(node.paramArgs[param.name]!) : param.default),
      after: String(next.default),
      status:
        node.paramArgs?.[param.name] ||
        param.default !== next.default ||
        param.min !== next.min ||
        param.max !== next.max
          ? "changed"
          : "same",
    });
  }
  for (const param of target.params) {
    if (beforeParams.some((item) => item.name === param.name)) continue;
    params.push({ name: param.name, before: null, after: String(param.default), status: "added" });
  }
  const argNames = Object.keys(node.paramArgs ?? {});
  for (const name of argNames)
    if (!target.params.some((param) => param.name === name))
      warnings.push(`实例上保存的参数 ${name} 已不在新版本中，将被移除`);

  /* Wires */
  const wires: PreviewWire[] = [];
  const candidate = withInstanceVersion(document, instanceId, target.version);
  const candidateModel = buildWidthModel(candidate, library);
  const currentModel = buildWidthModel(document, library);
  const candidateScope = candidateModel.scope("");

  const connected = document.wires.filter(
    (wire) => wire.from.nodeId === instanceId || wire.to.nodeId === instanceId,
  );
  for (const wire of connected) {
    const side: "input" | "output" = wire.to.nodeId === instanceId ? "input" : "output";
    const endpoint = side === "input" ? wire.to : wire.from;
    const peerEndpoint = side === "input" ? wire.from : wire.to;
    const peerNode = document.nodes.find((item) => item.id === peerEndpoint.nodeId);
    const portKey = endpoint.portKey ?? null;
    const oldPort = before?.ports.find((item) => item.key === portKey);
    const newPort = target.ports.find((item) => item.key === portKey);
    const widthBefore =
      side === "input"
        ? currentModel.portWidth("", instanceId, "input", portKey ?? undefined, endpoint.port)
        : currentModel.portWidth("", instanceId, "output", portKey ?? undefined, endpoint.port);
    const widthAfter =
      side === "input"
        ? candidateModel.portWidth("", instanceId, "input", portKey ?? undefined, endpoint.port)
        : candidateModel.portWidth("", instanceId, "output", portKey ?? undefined, endpoint.port);
    let problem: PreviewWire["problem"] = "none";
    let action = "可直接沿用（按端口身份保持接线）";
    if (!portKey) {
      problem = "removed-port";
      action = "旧连线没有端口身份（旧格式），请删除后重新接线";
      blockers.push(`连线 ${wire.id} 使用了没有端口身份的旧格式连线，请重新接线`);
    } else if (!newPort) {
      problem = "removed-port";
      action = `端口「${oldPort?.name ?? portKey}」已删除，请删除或改接该线路`;
      blockers.push(
        `实例「${node.label}」端口「${oldPort?.name ?? portKey}」在新版本中已删除；线路 ${wire.id}（连到 ${peerNode?.label ?? "?"}）必须先处理`,
      );
    } else if (widthAfter === null) {
      problem = "incompatible";
      action = "新版本位宽无法确定，请先指定参数或检查接线";
      blockers.push(`线路 ${wire.id} 在新版本下位宽无法确定`);
    } else if (widthBefore !== null && widthAfter !== widthBefore) {
      const peerWidth =
        side === "input"
          ? candidateModel.outputWidth("", peerEndpoint.nodeId, peerEndpoint)
          : candidateModel.inputWidth("", peerEndpoint.nodeId, peerEndpoint);
      if (peerWidth !== null && peerWidth !== widthAfter) {
        problem = "incompatible";
        action = `端口宽度 ${widthBefore}→${widthAfter} 位，但 ${peerNode?.label ?? "?"} 端仍为 ${peerWidth} 位，需加宽/缩窄后重接`;
        blockers.push(
          `线路 ${wire.id}：${node.label} 端口「${newPort.name}」宽度 ${widthBefore}→${widthAfter} 位，与 ${peerNode?.label ?? "?"}（${peerWidth} 位）不匹配；请先处理该线路`,
        );
      } else {
        problem = "width-change";
        action = `宽度 ${widthBefore}→${widthAfter} 位（两端可同时推导，可直接沿用）`;
      }
    }
    wires.push({
      wireId: wire.id,
      side,
      portKey,
      portName: newPort?.name ?? oldPort?.name ?? portKey ?? "?",
      peer: `${peerNode?.label ?? "?"}`,
      widthBefore,
      widthAfter,
      problem,
      action,
    });
  }

  /* Detection changes */
  const beforeDetection = detectionLabels(document, library);
  const afterDetection = detectionLabels(candidate, library);
  const detection: DetectionRow[] = beforeDetection.labels
    .filter((label) => afterDetection.labels.includes(label))
    .map((label) => {
      const index = beforeDetection.labels.indexOf(label);
      const afterIndex = afterDetection.labels.indexOf(label);
      const beforeValue = beforeDetection.values[index];
      const afterValue = afterDetection.values[afterIndex];
      return {
        label,
        before: beforeValue,
        after: afterValue,
        changed: beforeValue !== afterValue,
      };
    });
  const detectionBefore = challengeStatus(document, library);
  const detectionAfter = challengeStatus(candidate, library);
  if (!candidateModel.ok)
    blockers.push(
      ...candidateModel.issues
        .filter((issue) => issue.tone === "error")
        .map((issue) => issue.message),
    );
  void candidateScope;

  return {
    instanceId,
    instanceLabel: node.label,
    defId: def.id,
    defName: def.name,
    fromVersion,
    toVersion: target.version,
    ports,
    params,
    wires,
    detection,
    detectionBefore,
    detectionAfter,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    canApply: blockers.length === 0,
    candidate,
  };
}

export function applyUpgrade(
  document: CircuitDocument,
  library: readonly SubcircuitDef[],
  preview: UpgradePreview,
): { ok: boolean; message: string } {
  if (!preview.canApply || !preview.candidate) {
    return {
      ok: false,
      message: `升级未执行：仍有 ${preview.blockers.length} 项需处理的线路或约束，实例保持原样`,
    };
  }
  const node = document.nodes.find((item) => item.id === preview.instanceId);
  const def = library.find((item) => item.id === preview.defId);
  const target = def?.versions.find((item) => item.version === preview.toVersion);
  if (!node || !target)
    return { ok: false, message: "升级未执行：实例或目标版本已不存在" };
  node.defVersion = target.version;
  if (node.paramArgs) {
    for (const key of Object.keys(node.paramArgs))
      if (!target.params.some((param) => param.name === key)) delete node.paramArgs[key];
  }
  return {
    ok: true,
    message: `实例「${node.label}」已升级到 v${target.version}，其余实例保持原版本`,
  };
}

export function upgradeAllCompatible(
  document: CircuitDocument,
  library: readonly SubcircuitDef[],
  instanceIds: string[],
): { upgraded: string[]; skipped: string[] } {
  const upgraded: string[] = [];
  const skipped: string[] = [];
  for (const id of instanceIds) {
    const preview = previewUpgrade(document, library, id);
    if (preview.fromVersion === preview.toVersion) continue;
    const result = applyUpgrade(document, library, preview);
    if (result.ok) upgraded.push(id);
    else skipped.push(id);
  }
  return { upgraded, skipped };
}

export function widthExprOf(value: WidthExpr): string {
  return formatExpr(value);
}

export function instanceNode(document: CircuitDocument, id: string): GateNode | undefined {
  return document.nodes.find((node) => node.id === id);
}
