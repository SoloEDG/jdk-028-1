<script setup lang="ts">
import type { GateNode, SimulationResult } from "@/shared/types";
import { busText, busToDecimal } from "../lib/evaluate";

defineProps<{ nodes: GateNode[]; signals: SimulationResult }>();
defineEmits<{ toggle: [id: string]; bit: [id: string, index: number]; inspect: [id: string] }>();


function bitsOf(node: GateNode): (0 | 1)[] {
  const width = node.width ?? 1;
  return Array.from({ length: width }, (_, index) => node.bits?.[index] ?? 0);
}
</script>

<template>
  <div class="input-rack">
    <div class="panel-heading">
      <span>输入控制</span><small>LIVE INPUTS</small>
    </div>
    <div class="rack-switches">
      <div
        v-for="node in nodes.filter((n) => n.kind === 'INPUT')"
        :key="node.id"
        class="rack-group"
      >
        <button
          class="rack-switch"
          :class="{ on: signals.values[node.id]?.some((bit) => bit === 1) }"
          :aria-label="`切换输入 ${node.label}`"
          :aria-pressed="signals.values[node.id]?.some((bit) => bit === 1)"
          @click="$emit('toggle', node.id)"
        >
          <span>{{ node.label }}</span>
          <i />
          <b>{{ busText(signals.values[node.id]) }}</b>
        </button>
        <div v-if="(node.width ?? 1) > 1" class="bit-row">
          <button
            v-for="value, index in bitsOf(node)"
            :key="index"
            class="bit-pill"
            :class="{ on: value === 1 }"
            :aria-label="`${node.label} 第 ${index} 位`"
            @click="$emit('bit', node.id, index)"
          >
            b{{ index }}
          </button>
          <span class="bit-dec">= {{ busToDecimal(signals.values[node.id]) }}</span>
        </div>
      </div>
      <span v-if="!nodes.some((n) => n.kind === 'INPUT')" class="panel-help">
        放置一个输入开关以发送信号。
      </span>
    </div>
  </div>
</template>
