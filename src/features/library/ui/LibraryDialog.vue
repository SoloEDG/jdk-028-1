<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SubcircuitDef } from "@/shared/types";
import type { UpgradePreview } from "../lib/upgrade";
import { portsOf } from "../lib/widths";
import { formatExpr } from "../lib/expr";

const props = defineProps<{
  definitions: SubcircuitDef[];
  selectedId: string | null;
  upgrade: UpgradePreview | null;
  useCounts: Record<string, number>;
}>();
const emit = defineEmits<{
  select: [defId: string];
  publish: [
    payload: {
      defId: string;
      name: string;
      note: string;
      ports: { key: string; name: string; direction: "input" | "output"; width: string }[];
      params: { name: string; min: number; max: number; default: number }[];
    },
  ];
  drop: [defId: string];
  close: [];
  openUpgrade: [instanceId: string, version?: number];
  applyUpgrade: [];
  cancelUpgrade: [];
  importLibrary: [text: string];
}>();

const selected = computed(() =>
  props.definitions.find((def) => def.id === props.selectedId) ?? null,
);
const latest = computed(() => selected.value?.versions[selected.value.versions.length - 1]);
const name = ref("");
const note = ref("");
const ports = ref<
  { key: string; name: string; direction: "input" | "output"; width: string }[]
>([]);
const params = ref<{ name: string; min: number; max: number; default: number }[]>([]);
const error = ref<string | null>(null);
const selectedVersion = ref<number | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const importError = ref<string | null>(null);
async function uploadLibrary(event: Event) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  if (!file) return;
  try {
    emit("importLibrary", await file.text());
    importError.value = null;
  } catch {
    importError.value = "文件读取失败";
  }
  el.value = "";
}

watch(
  selected,
  (def) => {
    const version = def?.versions[def.versions.length - 1];
    name.value = def?.name ?? "";
    note.value = version?.note ?? "";
    ports.value = (version?.ports ?? []).map((port) => ({
      key: port.key,
      name: port.name,
      direction: port.direction,
      width: formatExpr(port.width),
    }));
    params.value = (version?.params ?? []).map((param) => ({ ...param }));
    selectedVersion.value = version?.version ?? null;
    error.value = null;
  },
  { immediate: true },
);

function addPort(direction: "input" | "output") {
  ports.value.push({
    key: `new-${direction}-${Date.now()}-${ports.value.length}`,
    name: direction === "input" ? `IN${ports.value.length + 1}` : `OUT${ports.value.length + 1}`,
    direction,
    width: "1",
  });
}
function removePort(index: number) {
  ports.value.splice(index, 1);
}
function movePort(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= ports.value.length) return;
  const copy = [...ports.value];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  ports.value = copy;
}
function addParam() {
  const name = `P${params.value.length + 1}`;
  params.value.push({ name, min: 1, max: 16, default: 1 });
}

function publish() {
  if (!selected.value) return;
  const seen = new Set<string>();
  for (const port of ports.value) {
    if (!port.name.trim()) {
      error.value = "端口名不能为空";
      return;
    }
    const label = `${port.direction}:${port.name.trim()}`;
    if (seen.has(label)) {
      error.value = `端口名重复：${port.name}`;
      return;
    }
    seen.add(label);
  }
  error.value = null;
  emit("publish", {
    defId: selected.value.id,
    name: name.value,
    note: note.value,
    ports: ports.value.map((port) => ({ ...port })),
    params: params.value.map((param) => ({ ...param })),
  });
}

const versionView = computed(() => {
  if (!selected.value) return null;
  return (
    selected.value.versions.find((item) => item.version === selectedVersion.value) ??
    latest.value ??
    null
  );
});
const viewPorts = computed(() => portsOf(versionView.value, "input"));
const viewOutputs = computed(() => portsOf(versionView.value, "output"));
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal library-modal" role="dialog" aria-label="子电路库">
      <header class="modal-head">
        <h2>子电路库</h2>
        <button class="text-button" @click="emit('close')">关闭</button>
      </header>
      <div class="library-layout">
        <aside class="library-list">
          <button
            v-for="def in definitions"
            :key="def.id"
            class="library-item"
            :class="{ active: def.id === selectedId }"
            @click="emit('select', def.id)"
          >
            <b>{{ def.name }}</b>
            <small>
              v{{ def.versions[def.versions.length - 1].version }} ·
              {{ useCounts[def.id] ?? 0 }} 个实例
            </small>
          </button>
          <p v-if="!definitions.length" class="panel-help">还没有子电路。</p>
          <button @click="fileInput?.click()">导入库文件…</button>
          <input
            ref="fileInput"
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="导入子电路库"
            @change="uploadLibrary"
          />
          <p v-if="importError" class="inline-error">{{ importError }}</p>
        </aside>
        <div v-if="selected" class="library-detail">
          <label class="field">
            <span>名称</span>
            <input v-model="name" maxlength="40" />
          </label>
          <div class="version-row">
            <label class="field compact">
              <span>查看版本</span>
              <select v-model.number="selectedVersion">
                <option
                  v-for="version in [...selected.versions].reverse()"
                  :key="version.version"
                  :value="version.version"
                >
                  v{{ version.version }}{{ version.version === latest?.version ? "（最新）" : "" }}
                </option>
              </select>
            </label>
            <span class="version-count">
              共 {{ selected.versions.length }} 个版本；修改并保存会生成新版本，已有实例保持原版本
            </span>
          </div>

          <div class="sub-heading-row"><b>边界端口</b><span>改名、调序不会错接</span></div>
          <table class="port-table editable">
            <thead>
              <tr><th>方向</th><th>名称</th><th>位宽</th><th>顺序</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="(port, index) in ports" :key="port.key">
                <td>
                  <select v-model="port.direction">
                    <option value="input">输入</option>
                    <option value="output">输出</option>
                  </select>
                </td>
                <td><input v-model="port.name" maxlength="20" /></td>
                <td><input v-model="port.width" class="width-input" /></td>
                <td class="order-cell">
                  <button :disabled="index === 0" @click="movePort(index, -1)">↑</button>
                  <button :disabled="index === ports.length - 1" @click="movePort(index, 1)">↓</button>
                </td>
                <td><button class="chip-remove" @click="removePort(index)">×</button></td>
              </tr>
            </tbody>
          </table>
          <div class="inline-actions">
            <button @click="addPort('input')">＋ 输入端口</button>
            <button @click="addPort('output')">＋ 输出端口</button>
          </div>

          <div class="sub-heading-row"><b>位宽参数</b><span>1–16 位</span></div>
          <table class="port-table editable">
            <thead>
              <tr><th>名称</th><th>最小</th><th>最大</th><th>默认</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="(param, index) in params" :key="index">
                <td><input v-model="param.name" maxlength="16" /></td>
                <td><input v-model.number="param.min" type="number" min="1" max="16" /></td>
                <td><input v-model.number="param.max" type="number" min="1" max="16" /></td>
                <td><input v-model.number="param.default" type="number" min="1" max="16" /></td>
                <td><button class="chip-remove" @click="params.splice(index, 1)">×</button></td>
              </tr>
            </tbody>
          </table>
          <div class="inline-actions">
            <button @click="addParam">＋ 参数</button>
          </div>

          <label class="field">
            <span>本版备注</span>
            <input v-model="note" maxlength="120" />
          </label>
          <p v-if="error" class="inline-error">{{ error }}</p>
          <div class="inline-actions">
            <button class="primary" @click="publish">保存为新版本</button>
            <button
              :disabled="(useCounts[selected.id] ?? 0) > 0"
              @click="emit('drop', selected.id)"
            >
              删除子电路
            </button>
          </div>

          <div v-if="versionView" class="version-summary">
            <b>v{{ versionView.version }}</b>
            <span>输入 {{ viewPorts.length }} · 输出 {{ viewOutputs.length }} · 内部元件
              {{ versionView.nodes.length }} 个</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
