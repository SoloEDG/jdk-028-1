<script setup lang="ts">
import { computed } from "vue";
import type { CircuitDocument, SimulationResult } from "@/shared/types";
import type { WidthModel } from "@/features/library";
import { busText, busToDecimal, busToHex } from "../lib/evaluate";

const props = defineProps<{
  document: CircuitDocument;
  signals: SimulationResult;
  selected: string | null;
  model: WidthModel;
}>();
defineEmits<{ applyOption: [params: Record<string, Record<string, number>>] }>();
const node = computed(() =>
  props.document.nodes.find((item) => item.id === props.selected),
);
const ports = computed(() =>
  node.value ? props.model.nodePorts("", node.value.id) : [],
);
const unknowns = computed(
  () =>
    Object.values(props.signals.values).filter((bus) => bus.some((bit) => bit === "X"))
      .length,
);
const issues = computed(() => props.model.issues);
const options = computed(() => props.model.options.slice(0, 5));
function optionLabel(params: Record<string, Record<string, number>>): string {
  return Object.entries(params)
    .flatMap(([path, entries]) =>
      Object.entries(entries).map(([name, value]) => `${path.split("/").pop()}.${name}=${value}`),
    )
    .join("，");
}
</script>

<template>
  <div class="signal-monitor">
    <div class="panel-heading">
      <span>信号观测</span><small>PROBE</small>
    </div>
    <div v-if="node" class="probe-detail">
      <b>{{ node.label }}</b>
      <span v-for="port in ports.filter((p) => p.direction === 'input')" :key="`i${port.key}`">
        {{ port.name }}
        <strong class="text-X">{{ port.width ?? "?" }}b</strong>
      </span>
      <span>
        OUT
        <strong class="text-1">{{ busText(signals.values[node.id]) }}</strong>
      </span>
      <span v-if="(signals.values[node.id]?.length ?? 0) > 1" class="mono">
        = {{ busToDecimal(signals.values[node.id]) }} / {{ busToHex(signals.values[node.id]) }}
      </span>
    </div>
    <div v-else class="probe-detail">
      <span>{{ document.nodes.length }} 个元件</span>
      <span>{{ document.wires.length }} 条连线</span>
      <span>{{ model.instances.length }} 个实例</span>
      <span>{{ unknowns ? `${unknowns} 个未确定信号` : "全部信号已确定" }}</span>
    </div>
    <div v-if="options.length > 1" class="option-block">
      <div class="sub-heading-row"><b>可行参数组合</b><span>点击采用</span></div>
      <button
        v-for="(option, index) in options"
        :key="index"
        class="option-row"
        @click="$emit('applyOption', option.params)"
      >
        {{ optionLabel(option.params) }}
      </button>
    </div>
    <ul v-if="issues.length" class="issue-list compact">
      <li
        v-for="(issue, index) in issues.slice(0, 4)"
        :key="index"
        :class="issue.tone"
      >
        {{ issue.message }}
      </li>
    </ul>
    <p v-else class="small-note">
      {{
        unknowns
          ? "X 表示端口悬空或信号尚未确定。点击端口检查位宽与来源。"
          : "橙色为 1，蓝灰为 0，紫色为总线；总线会显示二进制值。"
      }}
    </p>
  </div>
</template>
