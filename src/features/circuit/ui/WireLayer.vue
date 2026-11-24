<script setup lang="ts">
import type { CircuitDocument, SimulationResult } from "@/shared/types";
import type { WidthModel } from "@/features/library";
import { busText } from "@/features/library";
import { portPointOf, wirePath } from "../lib/geometry";

const props = defineProps<{
  document: CircuitDocument;
  signals: SimulationResult;
  selected: string | null;
  model: WidthModel | null;
  scopePath?: string;
}>();
defineEmits<{ select: [id: string] }>();

function pathFor(wireId: string): string {
  const wire = props.document.wires.find((item) => item.id === wireId);
  if (!wire) return "";
  const from = props.document.nodes.find((node) => node.id === wire.from.nodeId);
  const to = props.document.nodes.find((node) => node.id === wire.to.nodeId);
  if (!from || !to) return "";
  const scope = props.scopePath ?? "";
  return wirePath(
    portPointOf(props.model, scope, from, "output", wire.from.portKey, wire.from.port),
    portPointOf(props.model, scope, to, "input", wire.to.portKey, wire.to.port),
  );
}

function wireClass(wireId: string): string {
  const bus = props.signals.wires[wireId] ?? [];
  const head = bus.length > 1 ? (bus.some((bit) => bit === "X") ? "X" : "B") : (bus[0] ?? "X");
  return `wire wire-${head}`;
}

function labelFor(wireId: string): string {
  const bus = props.signals.wires[wireId] ?? [];
  return bus.length > 1 ? busText(bus) : "";
}
</script>

<template>
  <g class="wires">
    <g v-for="wire in document.wires" :key="wire.id">
      <path
        :d="pathFor(wire.id)"
        class="wire-hit"
        role="button"
        tabindex="0"
        aria-label="选择连线"
        @pointerdown.stop
        @click.stop="$emit('select', wire.id)"
        @keydown.enter="$emit('select', wire.id)"
      />
      <path :d="pathFor(wire.id)" :class="[wireClass(wire.id), { 'wire-selected': selected === wire.id }]" />
      <text v-if="labelFor(wire.id)" class="wire-label">
        <textPath :href="`#wire-text-${wire.id}`" startOffset="50%" text-anchor="middle">
          {{ labelFor(wire.id) }}
        </textPath>
      </text>
      <path :id="`wire-text-${wire.id}`" :d="pathFor(wire.id)" fill="none" stroke="none" />
    </g>
  </g>
</template>
