<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CircuitDocument, GateNode } from "@/shared/types";
import { parseExpr, formatExpr } from "@/features/library";

/** Best guess for a captured port's width, before inference runs again. */
function autoWidthOf(node: GateNode): string {
  if (node.kind === "INPUT" || node.kind === "OUTPUT") return String(node.width ?? 1);
  if (node.kind === "SLICE") return String(node.sliceWidth ?? 1);
  if (node.kind === "SUBCIRCUIT") return "1";
  return "1";
}

export interface CapturePortDraft {
  key: string;
  wireId: string;
  name: string;
  direction: "input" | "output";
  width: string;
  autoWidth: string;
}
export interface CaptureParamDraft {
  name: string;
  min: number;
  max: number;
  default: number;
}

const props = defineProps<{
  document: CircuitDocument;
  selection: string[];
}>();
const emit = defineEmits<{
  close: [];
  submit: [
    payload: {
      name: string;
      params: CaptureParamDraft[];
      note: string;
      ports: { wireId: string; direction: "input" | "output"; name: string; width: string }[];
    },
  ];
}>();

const name = ref("我的子电路");
const note = ref("");
const params = ref<CaptureParamDraft[]>([]);
const newParam = ref({ name: "N", min: 1, max: 16, default: 4 });
const error = ref<string | null>(null);

const selectedNodes = computed<GateNode[]>(() =>
  props.document.nodes.filter((node) => props.selection.includes(node.id)),
);

/** Ports are previewed from wires crossing the selection boundary. */
const draftPorts = computed<CapturePortDraft[]>(() => {
  const ids = new Set(props.selection);
  const ports: CapturePortDraft[] = [];
  const used = new Set<string>();
  const unique = (direction: "input" | "output", base: string): string => {
    let name = `${base}`;
    let index = 2;
    while (used.has(`${direction}:${name}`)) name = `${base}_${index++}`;
    used.add(`${direction}:${name}`);
    return name;
  };
  for (const wire of props.document.wires) {
    const insideFrom = ids.has(wire.from.nodeId);
    const insideTo = ids.has(wire.to.nodeId);
    if (insideFrom === insideTo) continue;
    if (insideTo) {
      const node = props.document.nodes.find((item) => item.id === wire.to.nodeId);
      if (!node) continue;
      const name = unique("input", node.label);
      ports.push({
        key: `draft-in-${wire.id}`,
        wireId: wire.id,
        name,
        direction: "input",
        width: autoWidthOf(node),
        autoWidth: autoWidthOf(node),
      });
    } else {
      const node = props.document.nodes.find((item) => item.id === wire.from.nodeId);
      if (!node) continue;
      const name = unique("output", node.label);
      ports.push({
        key: `draft-out-${wire.id}`,
        wireId: wire.id,
        name,
        direction: "output",
        width: autoWidthOf(node),
        autoWidth: autoWidthOf(node),
      });
    }
  }
  return ports;
});

watch(
  () => props.selection,
  () => {
    error.value = null;
  },
);

/** Width guesses: bus nodes keep their own width; single-bit gates default to 1. */
const ports = ref<CapturePortDraft[]>([]);
watch(
  draftPorts,
  (next) => {
    const previous = new Map(ports.value.map((port) => [port.key, port]));
    ports.value = next.map((port) => {
      const match = previous.get(port.key);
      return match ? { ...port, width: match.width } : port;
    });
  },
  { immediate: true, deep: true },
);

function addParam() {
  const draft = newParam.value;
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,15}$/.test(draft.name.trim())) {
    error.value = "参数名必须以字母或下划线开头，只包含字母数字下划线";
    return;
  }
  if (params.value.some((param) => param.name === draft.name.trim())) {
    error.value = "参数名重复";
    return;
  }
  params.value.push({
    name: draft.name.trim(),
    min: Math.round(draft.min),
    max: Math.round(draft.max),
    default: Math.round(draft.default),
  });
  error.value = null;
}
function removeParam(name: string) {
  params.value = params.value.filter((param) => param.name !== name);
}
function applyWidth(port: CapturePortDraft, value: string) {
  try {
    const expr = parseExpr(value);
    port.width = formatExpr(expr);
    error.value = null;
  } catch (problem) {
    error.value = problem instanceof Error ? problem.message : "位宽表达式无效";
  }
}

function submit() {
  if (!name.value.trim()) {
    error.value = "请填写子电路名称";
    return;
  }
  if (!selectedNodes.value.length) {
    error.value = "请先框选至少一个元件";
    return;
  }
  for (const port of ports.value) {
    try {
      parseExpr(port.width);
    } catch (problem) {
      error.value = `端口 ${port.name}：${problem instanceof Error ? problem.message : "位宽无效"}`;
      return;
    }
  }
  emit("submit", {
    name: name.value.trim(),
    params: params.value.map((param) => ({ ...param })),
    note: note.value.trim(),
    ports: ports.value.map((port) => ({
      wireId: port.wireId,
      direction: port.direction,
      name: port.name.trim(),
      width: port.width,
    })),
  });
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal capture-modal" role="dialog" aria-label="圈定为子电路">
      <header class="modal-head">
        <h2>圈定为可复用子电路</h2>
        <button class="text-button" @click="emit('close')">关闭</button>
      </header>
      <p class="modal-help">
        已选 {{ selectedNodes.length }} 个元件。跨越选区的连线会变成边界端口；
        选区内部的连线保留为子电路内部接线。
      </p>
      <label class="field">
        <span>子电路名称</span>
        <input v-model="name" maxlength="40" />
      </label>
      <label class="field">
        <span>备注（可选）</span>
        <input v-model="note" maxlength="120" placeholder="例如：四位全加器，N 为位宽" />
      </label>

      <div class="sub-heading-row">
        <b>边界端口</b>
        <span>端口身份与名称、顺序无关</span>
      </div>
      <table class="port-table">
        <thead>
          <tr><th>方向</th><th>名称</th><th>位宽表达式</th></tr>
        </thead>
        <tbody>
          <tr v-for="port in ports" :key="port.key">
            <td>{{ port.direction === "input" ? "输入" : "输出" }}</td>
            <td><input v-model="port.name" maxlength="20" /></td>
            <td>
              <input
                :value="port.width"
                class="width-input"
                @change="applyWidth(port, ($event.target as HTMLInputElement).value)"
              />
              <small v-if="port.autoWidth !== port.width" class="muted">
                自动推导为 {{ port.autoWidth }}
              </small>
            </td>
          </tr>
          <tr v-if="!ports.length">
            <td colspan="3" class="muted">
              没有跨越选区的连线，子电路暂时只有内部接线。
            </td>
          </tr>
        </tbody>
      </table>

      <div class="sub-heading-row">
        <b>位宽参数</b>
        <span>1–16 位；端口表达式可引用参数，例如 N、2*N、N-1</span>
      </div>
      <div class="param-editor">
        <input v-model="newParam.name" maxlength="16" aria-label="参数名" placeholder="N" />
        <input v-model.number="newParam.min" type="number" min="1" max="16" aria-label="最小值" />
        <input v-model.number="newParam.max" type="number" min="1" max="16" aria-label="最大值" />
        <input v-model.number="newParam.default" type="number" min="1" max="16" aria-label="默认值" />
        <button @click="addParam">添加参数</button>
      </div>
      <div class="chips">
        <span v-for="param in params" :key="param.name" class="chip">
          {{ param.name }} ∈ [{{ param.min }}, {{ param.max }}]，默认 {{ param.default }}
          <button class="chip-remove" @click="removeParam(param.name)">×</button>
        </span>
      </div>

      <p v-if="error" class="inline-error">{{ error }}</p>
      <footer class="modal-actions">
        <button @click="emit('close')">取消</button>
        <button class="primary" @click="submit">创建并替换为实例</button>
      </footer>
    </section>
  </div>
</template>
