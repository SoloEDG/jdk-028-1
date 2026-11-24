<script setup lang="ts">
import { computed } from "vue";
import type { Bus, GateNode } from "@/shared/types";
import type { PortRequest } from "@/shared/commands";
import type { WidthModel } from "@/features/library";
import { busText } from "@/features/library";
import { BOARD, nodePortLayouts } from "../lib/geometry";

const props = defineProps<{
  node: GateNode;
  bus: Bus;
  selected: boolean;
  pendingNode: string | null;
  multiSelected: boolean;
  model: WidthModel | null;
  scopePath: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  multi: [id: string, event: MouseEvent];
  startDrag: [event: PointerEvent, id: string];
  port: [port: PortRequest];
  toggle: [id: string];
}>();

const layouts = computed(() => nodePortLayouts(props.model, props.scopePath, props.node));
const portSummary = computed(() => props.model?.nodePorts(props.scopePath, props.node.id) ?? []);
const isInstance = computed(() => props.node.kind === "SUBCIRCUIT");
const display = computed(() => busText(props.bus));
const widthLabel = computed(() => {
  const width = props.model?.portWidth(
    props.scopePath,
    props.node.id,
    "output",
    undefined,
    0,
  );
  return width && width > 1 ? `${width} 位` : "";
});
const inputWidths = computed(() =>
  layouts.value.inputs.map((port) => port.width).filter((width): width is number => !!width),
);
const symbol = computed(() => {
  switch (props.node.kind) {
    case "INPUT":
      return "IN";
    case "OUTPUT":
      return "OUT";
    case "SLICE":
      return "⌗";
    case "CONCAT":
      return "⧺";
    case "AND":
      return "&";
    case "OR":
      return "≥1";
    case "XOR":
      return "=1";
    case "NOT":
      return "1̅";
    case "NAND":
      return "&̅";
    case "NOR":
      return "≥1̅";
    default:
      return "◫";
  }
});
const badge = computed(() => {
  if (props.node.kind === "SLICE")
    return `${props.node.sliceOffset ?? 0}+${props.node.sliceWidth ?? 1}`;
  if (props.node.kind === "CONCAT") return `${props.node.ports ?? 2} 段`;
  if (isInstance.value) return `v${props.node.defVersion ?? "?"}`;
  if (props.node.kind === "INPUT" || props.node.kind === "OUTPUT")
    return `${props.node.width ?? 1}b`;
  const width = inputWidths.value[0] ?? 1;
  return width > 1 ? `${width}b` : "";
});
</script>

<template>
  <g
    class="gate-node"
    :class="{ 'is-selected': selected, 'is-multi': multiSelected, 'is-instance': isInstance }"
    :data-node="node.id"
    role="group"
    tabindex="0"
    :aria-label="node.label"
    @keydown.enter.self="emit('select', node.id)"
  >
    <rect
      :x="node.x"
      :y="node.y"
      :width="BOARD.nodeWidth"
      :height="BOARD.nodeHeight"
      rx="10"
      class="node-body"
      @pointerdown.stop="emit('startDrag', $event, node.id)"
      @click.stop="
        $event.shiftKey || $event.metaKey || $event.ctrlKey
          ? emit('multi', node.id, $event)
          : emit('select', node.id)
      "
    />
    <text :x="node.x + 12" :y="node.y + 21" class="node-label" pointer-events="none">
      {{ node.label }}
    </text>
    <text
      :x="node.x + BOARD.nodeWidth / 2"
      :y="node.y + 57"
      class="node-symbol"
      pointer-events="none"
      :class="{ 'instance-symbol': isInstance }"
    >
      {{ symbol }}
    </text>
    <text
      v-if="badge"
      :x="node.x + BOARD.nodeWidth - 10"
      :y="node.y + 21"
      class="node-badge"
      text-anchor="end"
      pointer-events="none"
    >
      {{ badge }}
    </text>

    <g v-if="node.kind === 'INPUT'">
      <g
        role="button"
        tabindex="0"
        :aria-label="`切换 ${node.label}，当前 ${display}`"
        @pointerdown.stop
        @click.stop="emit('toggle', node.id)"
        @keydown.enter.prevent="emit('toggle', node.id)"
        @keydown.space.prevent="emit('toggle', node.id)"
      >
        <rect
          :x="node.x + 26"
          :y="node.y + 64"
          :width="BOARD.nodeWidth - 52"
          height="20"
          rx="4"
          :class="`switch signal-${bus[0] ?? 'X'}`"
        />
        <text :x="node.x + BOARD.nodeWidth / 2" :y="node.y + 78" class="switch-text">
          {{ display }}
        </text>
      </g>
    </g>
    <g v-else-if="node.kind === 'OUTPUT'">
      <circle
        :cx="node.x + BOARD.nodeWidth / 2"
        :cy="node.y + 72"
        r="10"
        :class="`output-led signal-${bus[0] ?? 'X'}`"
      />
      <text :x="node.x + BOARD.nodeWidth / 2" :y="node.y + 76" class="led-text">
        {{ bus.length > 1 ? busText(bus) : (bus[0] ?? "X") }}
      </text>
    </g>
    <text
      v-if="node.kind !== 'INPUT' && node.kind !== 'OUTPUT'"
      :x="node.x + BOARD.nodeWidth - 12"
      :y="node.y + BOARD.nodeHeight - 10"
      class="node-value-chip"
      :class="`chip-${bus.length > 1 ? 'B' : (bus[0] ?? 'X')}`"
      text-anchor="end"
      pointer-events="none"
    >
      {{ display }}
    </text>

    <g
      v-for="port in layouts.inputs"
      :key="`in-${port.key ?? port.index}`"
      class="port-group"
    >
      <circle
        :cx="port.point.x"
        :cy="port.point.y"
        r="7"
        class="port input-port"
        role="button"
        tabindex="0"
        :aria-label="`${node.label} 输入 ${port.name}`"
        @pointerdown.stop
        @click.stop="
          emit('port', {
            nodeId: node.id,
            port: port.index,
            portKey: port.key,
            direction: 'input',
          })
        "
        @keydown.enter="
          emit('port', {
            nodeId: node.id,
            port: port.index,
            portKey: port.key,
            direction: 'input',
          })
        "
      />
      <text
        v-if="isInstance"
        :x="port.point.x + 10"
        :y="port.point.y + 3"
        class="port-name"
      >
        {{ port.name }}<tspan v-if="port.width && port.width > 1"> {{ port.width }}b</tspan>
      </text>
    </g>
    <g v-for="port in layouts.outputs" :key="`out-${port.key ?? port.index}`">
      <circle
        :cx="port.point.x"
        :cy="port.point.y"
        r="7"
        :class="['port', `signal-${bus[0] ?? 'X'}`, { 'port-pending': pendingNode === node.id }]"
        role="button"
        tabindex="0"
        :aria-label="`${node.label} 输出 ${port.name}`"
        @pointerdown.stop
        @click.stop="
          emit('port', {
            nodeId: node.id,
            port: port.index,
            portKey: port.key,
            direction: 'output',
          })
        "
        @keydown.enter="
          emit('port', {
            nodeId: node.id,
            port: port.index,
            portKey: port.key,
            direction: 'output',
          })
        "
      />
      <text
        v-if="isInstance"
        :x="port.point.x - 10"
        :y="port.point.y + 3"
        class="port-name"
        text-anchor="end"
      >
        {{ port.name }}<tspan v-if="port.width && port.width > 1"> {{ port.width }}b</tspan>
      </text>
    </g>
    <text
      v-if="isInstance && portSummary.length === 0"
      :x="node.x + 14"
      :y="node.y + 76"
      class="node-warning"
    >
      定义缺失
    </text>
    <text
      v-if="widthLabel && !isInstance"
      :x="node.x + 12"
      :y="node.y + BOARD.nodeHeight - 8"
      class="node-width"
    >
      {{ widthLabel }}
    </text>
  </g>
</template>
