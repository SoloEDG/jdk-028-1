<script setup lang="ts">
import { ref } from "vue";
import type {
  CircuitDocument,
  Point,
  SimulationResult,
} from "@/shared/types";
import type { PortRequest } from "@/shared/commands";
import type { WidthModel } from "@/features/library";
import { BOARD, snapPosition } from "../lib/geometry";
import NodeBody from "./NodeBody.vue";
import WireLayer from "./WireLayer.vue";

const props = defineProps<{
  document: CircuitDocument;
  signals: SimulationResult;
  model: WidthModel | null;
  selected: string | null;
  multiSelection: string[];
  pending: PortRequest | null;
  placing: boolean;
}>();
const emit = defineEmits<{
  place: [point: Point];
  move: [id: string, point: Point];
  select: [id: string | null];
  multi: [id: string, event: MouseEvent];
  port: [port: PortRequest];
  toggle: [id: string];
  boxSelect: [ids: string[]];
}>();

const svg = ref<SVGSVGElement | null>(null);
let drag: { id: string; offset: Point; moved: boolean } | null = null;
let box: { start: Point; current: Point } | null = null;
const boxRect = ref<{ x: number; y: number; width: number; height: number } | null>(null);

function coordinate(event: PointerEvent | MouseEvent): Point {
  const matrix = svg.value?.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
}

function startDrag(event: PointerEvent, id: string) {
  if (event.button !== 0) return;
  if (event.shiftKey || event.metaKey || event.ctrlKey) {
    emit("multi", id, event);
    return;
  }
  emit("select", id);
  const node = props.document.nodes.find((item) => item.id === id)!;
  const point = coordinate(event);
  drag = { id, offset: { x: point.x - node.x, y: point.y - node.y }, moved: false };
  svg.value?.setPointerCapture(event.pointerId);
}

function pointerMove(event: PointerEvent) {
  const point = coordinate(event);
  if (drag) {
    drag.moved = true;
    emit("move", drag.id, snapPosition({ x: point.x - drag.offset.x, y: point.y - drag.offset.y }));
    return;
  }
  if (box) {
    box.current = point;
    const x = Math.min(box.start.x, point.x);
    const y = Math.min(box.start.y, point.y);
    boxRect.value = {
      x,
      y,
      width: Math.abs(point.x - box.start.x),
      height: Math.abs(point.y - box.start.y),
    };
  }
}

function pointerUp() {
  if (box && boxRect.value) {
    const rect = boxRect.value;
    if (rect.width > 12 && rect.height > 12) {
      const ids = props.document.nodes
        .filter(
          (node) =>
            node.x + BOARD.nodeWidth >= rect.x &&
            node.x <= rect.x + rect.width &&
            node.y + BOARD.nodeHeight >= rect.y &&
            node.y <= rect.y + rect.height,
        )
        .map((node) => node.id);
      emit("boxSelect", ids);
    }
  }
  drag = null;
  box = null;
  boxRect.value = null;
}

function background(event: PointerEvent) {
  if (event.button !== 0) return;
  if (props.placing) {
    emit("place", snapPosition(coordinate(event)));
    return;
  }
  const point = coordinate(event);
  box = { start: point, current: point };
  boxRect.value = { x: point.x, y: point.y, width: 0, height: 0 };
  if (!event.shiftKey) emit("select", null);
  svg.value?.setPointerCapture(event.pointerId);
}
</script>

<template>
  <div class="board-scroll">
    <div class="board-wrapper">
      <svg
        ref="svg"
        class="circuit-board"
        :class="{ placing: placing }"
        :viewBox="`0 0 ${BOARD.width} ${BOARD.height}`"
        aria-label="电路接线工作台"
        @pointermove="pointerMove"
        @pointerup="pointerUp"
        @pointercancel="pointerUp"
        @lostpointercapture="pointerUp"
      >
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#c9d5dd" />
          </pattern>
        </defs>
        <rect
          :width="BOARD.width"
          :height="BOARD.height"
          fill="url(#grid)"
          @pointerdown.self="background"
        />
        <text x="25" y="29" class="board-caption">
          COMBINATIONAL CIRCUIT / 组合逻辑接线台 · 基础门按位工作
        </text>
        <WireLayer
          :document="document"
          :signals="signals"
          :selected="selected"
          :model="model"
          @select="emit('select', $event)"
        />
        <rect
          v-if="boxRect"
          :x="boxRect.x"
          :y="boxRect.y"
          :width="boxRect.width"
          :height="boxRect.height"
          class="selection-box"
        />
        <NodeBody
          v-for="node in document.nodes"
          :key="node.id"
          :node="node"
          :bus="signals.values[node.id] ?? []"
          :selected="selected === node.id"
          :multi-selected="multiSelection.includes(node.id)"
          :pending-node="pending?.nodeId ?? null"
          :model="model"
          scope-path=""
          @start-drag="startDrag"
          @port="emit('port', $event)"
          @toggle="emit('toggle', $event)"
          @select="emit('select', $event)"
          @multi="emit('multi', $event, $event)"
        />
        <text
          v-if="!document.nodes.length"
          x="500"
          y="270"
          text-anchor="middle"
          class="empty-board"
        >
          从左侧选择元件，或框选已有元件创建可复用子电路
        </text>
        <text
          v-if="!document.nodes.length"
          x="500"
          y="300"
          text-anchor="middle"
          class="empty-hint"
        >
          拖拽框选 · Shift 多选 · 选中后点“圈定为子电路”
        </text>
      </svg>
    </div>
  </div>
</template>
