<script setup lang="ts">
import { computed, ref } from "vue";
import type { GateSpec, SubcircuitDef } from "@/shared/types";
import { baseGateSpecs, busToolSpecs } from "../lib/specs";
import type { PlacementTool } from "../model/placement";
import GateTile from "./GateTile.vue";

const props = defineProps<{
  tool: PlacementTool | null;
  definitions: SubcircuitDef[];
}>();
const emit = defineEmits<{
  choose: [tool: PlacementTool | null];
  create: [];
  manage: [defId: string];
}>();

const query = ref("");
const filtered = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return props.definitions;
  return props.definitions.filter((def) => def.name.toLowerCase().includes(text));
});

function pick(kind: GateSpec["kind"]) {
  emit(
    "choose",
    props.tool?.kind === kind ? null : { kind },
  );
}
function pickDef(def: SubcircuitDef) {
  const version = def.versions[def.versions.length - 1];
  emit(
    "choose",
    props.tool?.defId === def.id
      ? null
      : {
          kind: "SUBCIRCUIT",
          defId: def.id,
          defVersion: version.version,
          name: def.name,
        },
  );
}
</script>

<template>
  <aside class="catalog panel">
    <div class="panel-heading">
      <span>元件库</span><small>COMPONENTS</small>
    </div>
    <p class="panel-help">选择元件，再点击工作台放置。基础门对整条总线逐位工作。</p>
    <div class="gate-list">
      <GateTile
        v-for="spec in baseGateSpecs"
        :key="spec.kind"
        :spec="spec"
        :active="tool?.kind === spec.kind"
        @choose="pick(spec.kind)"
      />
    </div>
    <div class="panel-heading sub-heading">
      <span>总线工具</span><small>BUS</small>
    </div>
    <div class="gate-list">
      <GateTile
        v-for="spec in busToolSpecs"
        :key="spec.kind"
        :spec="spec"
        :active="tool?.kind === spec.kind"
        @choose="pick(spec.kind)"
      />
    </div>
    <div class="panel-heading sub-heading">
      <span>子电路</span><small>REUSE</small>
    </div>
    <input
      v-model="query"
      class="catalog-search"
      placeholder="搜索子电路"
      aria-label="搜索子电路"
    />
    <div class="gate-list">
      <button
        v-for="def in filtered"
        :key="def.id"
        class="gate-tile subcircuit-tile"
        :class="{ active: tool?.defId === def.id }"
        :aria-pressed="tool?.defId === def.id"
        @click="pickDef(def)"
      >
        <span class="gate-symbol">◫</span>
        <span>
          <strong>{{ def.name }}</strong>
          <small>v{{ def.versions[def.versions.length - 1].version }} ·
            {{ def.versions[def.versions.length - 1].ports.length }} 端口</small>
        </span>
        <span class="tile-plus">＋</span>
      </button>
      <p v-if="!filtered.length" class="panel-help">
        {{ definitions.length ? "没有匹配的子电路" : "还没有子电路。框选元件后点“圈定为子电路”。" }}
      </p>
    </div>
    <div class="catalog-actions">
      <button class="primary" @click="emit('create')">框选圈定为子电路</button>
      <button
        :disabled="!definitions.length"
        @click="emit('manage', filtered[0]?.id ?? '')"
      >
        管理子电路…
      </button>
    </div>
    <div class="legend">
      <span><i class="dot high" />高电平 1</span>
      <span><i class="dot low" />低电平 0</span>
      <span><i class="dot unknown" />未确定 X</span>
    </div>
    <p class="small-note">
      点击输出端口再点输入端口连线。<br />
      Shift + 点击可多选元件；<br />
      在空白处拖拽可框选。
    </p>
  </aside>
</template>
