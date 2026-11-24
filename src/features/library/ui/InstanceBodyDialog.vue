<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CircuitDocument } from "@/shared/types";
import type { WidthModel } from "@/features/library";
import { busText } from "@/features/library";
import type { SimulationResult } from "@/shared/types";
import { BOARD } from "@/features/circuit";
import NodeBody from "@/features/circuit/ui/NodeBody.vue";
import WireLayer from "@/features/circuit/ui/WireLayer.vue";

const props = defineProps<{
  definitionName: string;
  version: number;
  scopePath: string;
  document: CircuitDocument;
  body: { nodes: import("@/shared/types").GateNode[]; wires: CircuitDocument["wires"] } | null;
  signals: SimulationResult | null;
  model: WidthModel | null;
}>();
const emit = defineEmits<{ close: []; select: [id: string]; enter: [path: string] }>();
const selected = ref<string | null>(null);

const bodyDocument = computed<CircuitDocument | null>(() =>
  props.body
    ? {
        version: 1,
        name: props.definitionName,
        targetId: "xor",
        nodes: props.body.nodes,
        wires: props.body.wires,
      }
    : null,
);

const scopeSignals = computed<SimulationResult | null>(() => {
  if (!props.signals) return null;
  return props.signals.scopes[props.scopePath] ?? null;
});

watch(
  () => props.scopePath,
  () => {
    selected.value = null;
  },
);
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal body-modal" role="dialog" :aria-label="`观察 ${definitionName} 内部`">
      <header class="modal-head">
        <h2>{{ definitionName }} · v{{ version }} 内部</h2>
        <button class="text-button" @click="emit('close')">关闭</button>
      </header>
      <p class="instance-sub">
        这是本实例的内部观测，其他实例互不影响。可点击内部元件查看信号，返回后实验保持原样。
      </p>
      <div class="body-canvas">
        <svg
          v-if="bodyDocument && scopeSignals"
          class="circuit-board inner"
          :viewBox="`0 0 ${BOARD.width} ${BOARD.height}`"
          aria-label="子电路内部接线"
        >
          <defs>
            <pattern id="grid-inner" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#c9d5dd" />
            </pattern>
          </defs>
          <rect :width="BOARD.width" :height="BOARD.height" fill="url(#grid-inner)" />
          <WireLayer
            :document="bodyDocument"
            :signals="scopeSignals"
            :selected="selected"
            :model="model"
            :scope-path="scopePath"
            @select="selected = $event"
          />
          <NodeBody
            v-for="node in bodyDocument.nodes"
            :key="node.id"
            :node="node"
            :bus="scopeSignals.values[node.id] ?? []"
            :selected="selected === node.id"
            :multi-selected="false"
            :pending-node="null"
            :model="model"
            :scope-path="scopePath"
            @select="selected = $event; emit('select', $event)"
            @multi="(id: string) => { selected = id; }"
            @start-drag="() => {}"
            @port="() => {}"
            @toggle="() => {}"
          />
        </svg>
        <p v-else class="inline-error">无法读取该实例内部信号。</p>
      </div>
      <table v-if="scopeSignals" class="param-table">
        <thead><tr><th>内部元件</th><th>输出总线</th><th /></tr></thead>
        <tbody>
          <tr v-for="node in body?.nodes ?? []" :key="node.id">
            <td>{{ node.label }}</td>
            <td class="mono">{{ busText(scopeSignals.values[node.id]) }}</td>
            <td>
              <button
                v-if="node.kind === 'SUBCIRCUIT'"
                class="text-button nested-enter"
                @click="emit('enter', `${scopePath}/${node.id}`)"
              >
                进入下一层
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
