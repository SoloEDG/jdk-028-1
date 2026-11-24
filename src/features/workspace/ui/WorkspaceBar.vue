<script setup lang="ts">
import { ref } from "vue";

const props = defineProps<{ name: string; status: string; definitions: number }>();
const emit = defineEmits<{
  rename: [name: string];
  sample: [];
  sampleBus: [];
  sampleInstance: [];
  clear: [];
  save: [];
  export: [];
  exportLibrary: [];
  import: [text: string];
  error: [message: string];
  library: [];
}>();
const input = ref<HTMLInputElement | null>(null);
async function upload(event: Event) {
  const el = event.target as HTMLInputElement;
  const file = el.files?.[0];
  if (!file) return;
  if (file.size > 4_000_000) {
    emit("error", "文件超过 4 MB，当前实验已保留");
    el.value = "";
    return;
  }
  try {
    emit("import", await file.text());
  } catch {
    emit("error", "文件读取失败，当前实验已保留");
  }
  el.value = "";
}
function replace(kind: "sample" | "sampleBus" | "sampleInstance" | "clear") {
  const message =
    kind === "clear"
      ? "新建会替换当前工作台，建议先导出。继续吗？"
      : "载入示例会替换当前工作台，继续吗？";
  if (!window.confirm(message)) return;
  if (kind === "clear") emit("clear");
  else if (kind === "sample") emit("sample");
  else if (kind === "sampleBus") emit("sampleBus");
  else emit("sampleInstance");
}
</script>

<template>
  <div class="workspace-bar">
    <div class="document-name">
      <input
        :value="props.name"
        aria-label="实验名称"
        maxlength="80"
        @change="
          emit(
            'rename',
            ($event.target as HTMLInputElement).value.trim() || '未命名实验',
          )
        "
      /><span class="save-status">● {{ status }}</span>
    </div>
    <div class="workspace-actions">
      <button @click="replace('sample')">单比特示例</button>
      <button @click="replace('sampleBus')">总线示例</button>
      <button @click="replace('sampleInstance')">子电路示例</button>
      <button @click="replace('clear')">新建</button>
      <button @click="emit('library')">子电路库（{{ definitions }}）</button>
      <button @click="emit('save')">保存</button>
      <button @click="input?.click()">导入</button>
      <button class="export-button" @click="emit('export')">导出工作区 ↓</button>
      <button :disabled="!definitions" @click="emit('exportLibrary')">导出库</button>
      <input
        ref="input"
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="导入实验文件"
        @change="upload"
      />
    </div>
  </div>
</template>
