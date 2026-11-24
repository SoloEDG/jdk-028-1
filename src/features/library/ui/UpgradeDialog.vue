<script setup lang="ts">
import type { UpgradePreview } from "../lib/upgrade";

const props = defineProps<{ preview: UpgradePreview }>();
const emit = defineEmits<{
  close: [];
  apply: [];
}>();

function statusText(status: string): string {
  switch (status) {
    case "renamed":
      return "改名（按身份沿用）";
    case "moved":
      return "调序（按身份沿用）";
    case "resized":
      return "位宽改变";
    case "removed":
      return "已删除";
    default:
      return "未变";
  }
}
function problemText(problem: string): string {
  switch (problem) {
    case "removed-port":
      return "端口已删除";
    case "incompatible":
      return "不兼容";
    case "width-change":
      return "位宽变化";
    default:
      return "可沿用";
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal upgrade-modal" role="dialog" aria-label="升级预览">
      <header class="modal-head">
        <h2>升级预览 · {{ preview.instanceLabel }}</h2>
        <button class="text-button" @click="emit('close')">关闭</button>
      </header>
      <p class="instance-sub">
        {{ preview.defName }}：v{{ preview.fromVersion }} → v{{ preview.toVersion }}。
        升级只影响这一个实例，其他实例保持原版本。失败时实例保持原样。
      </p>

      <div class="sub-heading-row"><b>端口变化</b><span>改名、调序不会错接</span></div>
      <table class="param-table">
        <thead>
          <tr><th>端口</th><th>旧</th><th>新</th><th>位宽</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="port in preview.ports" :key="port.key">
            <td>{{ port.nameBefore }}<span v-if="port.nameAfter && port.nameAfter !== port.nameBefore"> → {{ port.nameAfter }}</span></td>
            <td class="muted">#{{ port.indexBefore }}</td>
            <td class="muted">{{ port.indexAfter === null ? "—" : `#${port.indexAfter}` }}</td>
            <td>{{ port.widthBefore }} → {{ port.widthAfter ?? "—" }}</td>
            <td :class="port.status === 'removed' ? 'bad' : 'ok'">{{ statusText(port.status) }}</td>
          </tr>
        </tbody>
      </table>

      <div class="sub-heading-row"><b>参数变化</b><span>外部线宽重新推导</span></div>
      <table class="param-table">
        <thead>
          <tr><th>参数</th><th>旧</th><th>新</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="param in preview.params" :key="param.name">
            <td>{{ param.name }}</td>
            <td>{{ param.before ?? "—" }}</td>
            <td>{{ param.after ?? "—" }}</td>
            <td :class="param.status === 'removed' ? 'bad' : 'ok'">
              {{
                param.status === "added"
                  ? "新增"
                  : param.status === "removed"
                    ? "删除"
                    : param.status === "changed"
                      ? "变化"
                      : "未变"
              }}
            </td>
          </tr>
        </tbody>
      </table>

      <div class="sub-heading-row"><b>接线影响</b><span>冲突时先列出需处理的线路</span></div>
      <table class="param-table">
        <thead>
          <tr><th>线路</th><th>端口</th><th>对端</th><th>旧→新位宽</th><th>结论</th></tr>
        </thead>
        <tbody>
          <tr v-for="wire in preview.wires" :key="wire.wireId" :class="{ 'row-bad': wire.problem !== 'none' }">
            <td>{{ wire.wireId }}</td>
            <td>{{ wire.side === "input" ? "入 " : "出 " }}{{ wire.portName }}</td>
            <td>{{ wire.peer }}</td>
            <td>{{ wire.widthBefore ?? "?" }} → {{ wire.widthAfter ?? "?" }}</td>
            <td :class="wire.problem === 'none' ? 'ok' : 'bad'">
              {{ problemText(wire.problem) }}<br /><small>{{ wire.action }}</small>
            </td>
          </tr>
          <tr v-if="!preview.wires.length">
            <td colspan="5" class="muted">没有外部接线。</td>
          </tr>
        </tbody>
      </table>

      <div class="sub-heading-row"><b>目标检测变化</b><span>参数 · 接线 · 检测结果</span></div>
      <p class="detection-line">{{ preview.detectionBefore }} → {{ preview.detectionAfter }}</p>
      <table class="param-table">
        <thead>
          <tr><th>观测点</th><th>升级前</th><th>升级后</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="row in preview.detection" :key="row.label">
            <td>{{ row.label }}</td>
            <td class="mono">{{ row.before }}</td>
            <td class="mono">{{ row.after }}</td>
            <td :class="row.changed ? 'bad' : 'ok'">{{ row.changed ? "变化" : "相同" }}</td>
          </tr>
        </tbody>
      </table>

      <ul v-if="preview.blockers.length" class="issue-list error">
        <li v-for="(blocker, index) in preview.blockers" :key="index">{{ blocker }}</li>
      </ul>
      <ul v-if="preview.warnings.length" class="issue-list warning">
        <li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li>
      </ul>

      <footer class="modal-actions">
        <button @click="emit('close')">取消</button>
        <button class="primary" :disabled="!preview.canApply" @click="emit('apply')">
          {{ preview.canApply ? "确认升级此实例" : "需先处理线路" }}
        </button>
      </footer>
    </section>
  </div>
</template>
