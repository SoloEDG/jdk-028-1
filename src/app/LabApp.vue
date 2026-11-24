<script setup lang="ts">
import { computed, onMounted, onUnmounted } from "vue";
import { CatalogPanel } from "@/features/catalog";
import { CircuitBoard } from "@/features/circuit";
import { InputRack, SignalMonitor } from "@/features/simulation";
import { ChallengePanel } from "@/features/challenge";
import { WorkspaceBar } from "@/features/workspace";
import {
  CaptureDialog,
  InstanceBodyDialog,
  InstanceInspector,
  LibraryDialog,
  UpgradeDialog,
} from "@/features/library";
import type { Bus } from "@/shared/types";
import type { PortRow } from "@/features/library/ui/InstanceInspector.vue";
import { useLab } from "./useLab";

const lab = useLab();
const { document, notice, model } = lab;
const { selected, pending, multiSelection } = lab.circuit;
const { signals } = lab.simulation;
const { target, table, passed, inspected, hint } = lab.challenge;
const { status } = lab.workspace;
const { dialogs } = lab;

const selectedNode = computed(() =>
  document.value.nodes.find((node) => node.id === selected.value),
);
const multiCount = computed(() => multiSelection.value.length);

const inspectorRows = computed<PortRow[]>(() => {
  const node = lab.inspectorNode.value;
  if (!node) return [];
  const summary = lab.inspectorSummary.value;
  if (!summary) return [];
  const scopeSignals = signals.value.scopes[node.id];
  return summary.ports.map((port) => {
    let bus: Bus | undefined;
    if (scopeSignals && node.defId) {
      const boundary = model.value
        .scope(node.id)
        ?.nodes.find(
          (item) =>
            (item.kind === "SUBPORT_IN" || item.kind === "SUBPORT_OUT") &&
            item.portKey === port.key,
        );
      if (boundary) bus = scopeSignals.values[boundary.id];
    }
    return {
      key: port.key,
      name: port.name,
      direction: port.direction,
      width: port.width,
      expr: port.expr,
      bus,
    };
  });
});

const inspectorParamValues = computed(() => {
  const summary = lab.inspectorSummary.value;
  const values: Record<string, number | null> = {};
  for (const param of summary?.params ?? []) values[param.name] = param.value;
  return values;
});
const inspectorParamFree = computed(() => {
  const summary = lab.inspectorSummary.value;
  const values: Record<string, number[]> = {};
  for (const param of summary?.params ?? []) values[param.name] = param.frees;
  return values;
});

const bodyPayload = computed(() => {
  const path = dialogs.value.body;
  if (!path) return null;
  const scope = model.value.scope(path);
  const def = lab.lib.definitionById(scope?.node?.defId);
  const version = def?.versions.find((item) => item.version === scope?.node?.defVersion);
  return {
    definitionName: def?.name ?? scope?.node?.label ?? "子电路",
    version: scope?.node?.defVersion ?? 0,
    body: version ? { nodes: version.nodes, wires: version.wires } : null,
    scopePath: path,
  };
});

const libraryDefinitions = computed(() => lab.lib.definitions.value);


function keydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).closest("input,textarea,select")) return;
  if (event.key === "Escape") {
    if (dialogs.value.capture) dialogs.value.capture = false;
    else if (dialogs.value.library) dialogs.value.library = false;
    else if (dialogs.value.inspector) dialogs.value.inspector = null;
    else if (dialogs.value.body) dialogs.value.body = null;
    else lab.cancel();
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    lab.circuit.deleteSelected();
  }
}
onMounted(() => window.addEventListener("keydown", keydown));
onUnmounted(() => window.removeEventListener("keydown", keydown));
</script>

<template>
  <div class="lab-app">
    <header class="masthead">
      <div class="brand">
        <span class="brand-icon">⌘</span>
        <div>
          <h1>LOGIC <em>LAB</em><span>数字电路逻辑实验室</span></h1>
          <p>把逻辑，连接起来。</p>
        </div>
      </div>
      <div class="instrument-label">
        <span class="power-light" />总线与子电路模式
        <small>BENCH / JDK–028 · WIDTH 1–16</small>
      </div>
    </header>
    <WorkspaceBar
      :name="document.name"
      :status="status"
      :definitions="libraryDefinitions.length"
      @rename="document.name = $event"
      @sample="lab.workspace.sample"
      @sample-bus="lab.workspace.sampleBus"
      @sample-instance="lab.workspace.sampleInstance"
      @clear="lab.workspace.clear"
      @save="lab.workspace.save"
      @export="lab.workspace.exportFile"
      @export-library="lab.workspace.exportLibraryFile"
      @library="lab.openLibrary()"
      @import="lab.workspace.importText"
      @error="lab.notify({ tone: 'error', message: $event })"
    />
    <main class="workbench">
      <CatalogPanel
        :tool="lab.placement.tool.value"
        :definitions="libraryDefinitions"
        @choose="
          lab.placement.tool.value = $event;
          lab.circuit.pending.value = null;
        "
        @create="lab.beginCapture"
        @manage="lab.openLibrary($event || undefined)"
      />
      <section class="center-workspace">
        <div class="board-toolbar">
          <span>
            <b>工作台</b>
            <small>总线按位传播 · 实例位宽由外接推导</small>
          </span>
          <div>
            <button
              :disabled="!selected && !multiCount"
              @click="lab.beginCapture"
            >
              圈定为子电路{{ multiCount > 1 ? `（${multiCount}）` : "" }}
            </button>
            <button :disabled="!selected && !multiCount" aria-label="删除所选" @click="lab.circuit.deleteSelected">
              删除所选</button><button :disabled="!pending && !lab.placement.tool.value" @click="lab.cancel">
              取消 / Esc
            </button>
          </div>
        </div>
        <div class="mode-strip" v-if="lab.placement.tool.value || pending">
          {{
            lab.placement.tool.value
              ? `点击网格放置 ${
                  lab.placement.tool.value.defId
                    ? lab.placement.tool.value.name ?? "子电路实例"
                    : lab.placement.tool.value.kind
                }`
              : "已选择输出端口，请点击目标输入端口"
          }}<button @click="lab.cancel">取消</button>
        </div>
        <CircuitBoard
          :document="document"
          :signals="signals"
          :model="model"
          :selected="selected"
          :multi-selection="multiSelection"
          :pending="pending"
          :placing="!!lab.placement.tool.value"
          @place="lab.place"
          @move="lab.move"
          @select="lab.circuit.select"
          @multi="lab.circuit.toggleMulti"
          @box-select="lab.circuit.selectBox"
          @port="lab.circuit.pickPort"
          @toggle="lab.simulation.toggle"
        />
        <div class="selection-strip">
          <template v-if="selectedNode">
            <label>
              元件名称
              <input
                :key="selectedNode.id"
                :value="selectedNode.label"
                maxlength="40"
                aria-label="所选元件名称"
                @change="lab.renameNode(($event.target as HTMLInputElement).value)"
              />
            </label>
            <span>{{ selectedNode.kind }} · 拖动移动 · Delete 删除</span>
            <button
              v-if="selectedNode.kind === 'SUBCIRCUIT'"
              @click="lab.openInspector(selectedNode.id)"
            >
              实例参数与内部信号…
            </button>
            <button
              v-if="selectedNode.kind === 'INPUT' || selectedNode.kind === 'OUTPUT' || selectedNode.kind === 'SLICE' || selectedNode.kind === 'CONCAT'"
              @click="lab.openInspector(selectedNode.id)"
            >
              位宽设置…
            </button>
          </template>
          <span v-else-if="multiCount > 1">
            已选 {{ multiCount }} 个元件 · 点击“圈定为子电路”创建可复用定义
          </span>
          <span v-else-if="selected">
            已选择连线，按 Delete 或点击“删除所选”断开。
          </span>
          <span v-else>
            拖动元件移动位置 · Shift 多选 · 空白处拖拽框选 · Esc 取消
          </span>
          <span class="grid-label">GRID 20</span>
        </div>
        <div class="instruments">
          <InputRack
            :nodes="document.nodes"
            :signals="signals"
            @toggle="lab.simulation.toggle"
            @bit="(id: string, index: number) => lab.setNodeBits(id, index, (lab.document.value.nodes.find((n) => n.id === id)?.bits?.[index] ?? 0) === 1 ? 0 : 1)"
            @inspect="lab.openInspector"
          />
          <SignalMonitor
            :document="document"
            :signals="signals"
            :selected="selected"
            :model="model"
            @apply-option="lab.applyParamOption"
          />
        </div>
      </section>
      <ChallengePanel
        :document="document"
        :target="target"
        :table="table"
        :passed="passed"
        :inspected="inspected"
        :hint="hint"
        @choose="lab.challenge.choose"
        @check="inspected = true"
        @hint="hint = !hint"
      />
    </main>
    <footer class="status-bar" :class="notice.tone" role="status">
      <span>
        {{
          notice.tone === "error" ? "!" : notice.tone === "success" ? "✓" : "●"
        }}
        {{ notice.message }}
      </span>
      <small>LOCAL LAB / 纯前端实验</small>
    </footer>

    <CaptureDialog
      v-if="dialogs.capture"
      :document="document"
      :selection="multiSelection.length ? multiSelection : selected ? [selected] : []"
      @close="dialogs.capture = false"
      @submit="lab.submitCapture"
    />
    <LibraryDialog
      v-if="dialogs.library"
      :definitions="libraryDefinitions"
      :selected-id="lab.lib.selectedDefId.value"
      :upgrade="lab.upgradePreview.value"
      :use-counts="lab.useCounts.value"
      @select="lab.lib.selectedDefId.value = $event"
      @publish="lab.publishDefinition"
      @drop="lab.dropDefinition"
      @close="dialogs.library = false"
      @open-upgrade="lab.openUpgrade"
      @apply-upgrade="lab.confirmUpgrade"
      @cancel-upgrade="lab.lib.closeUpgrade"
      @import-library="lab.importLibraryText"
    />
    <InstanceInspector
      v-if="dialogs.inspector && lab.inspectorNode.value"
      :node="lab.inspectorNode.value"
      :definition="lab.lib.definitionById(lab.inspectorNode.value.defId) ?? null"
      :model="model"
      :ports="inspectorRows"
      :param-values="inspectorParamValues"
      :param-free="inspectorParamFree"
      :scope-path="dialogs.inspector"
      :expanded="false"
      @close="dialogs.inspector = null"
      @upgrade="lab.openUpgrade(lab.inspectorNode.value!.id)"
      @rename="lab.renameNode"
      @toggle-expand="dialogs.body = dialogs.inspector"
      @set-width="lab.setNodeWidth(dialogs.inspector!, $event)"
      @set-instance-param="(name: string, value: string) => lab.setInstanceParam(name, value)"
      @choose-param="(name: string, value: number) => lab.setInstanceParam(name, String(value))"
      @set-bits="(index: number, value: 0 | 1) => lab.setNodeBits(dialogs.inspector!, index, value)"
      @set-slice="(width: number, offset: number) => lab.setSlice(dialogs.inspector!, width, offset)"
      @set-ports="lab.setPorts(dialogs.inspector!, $event)"
      @open-body="lab.openInstanceBody(dialogs.inspector!)"
    />
    <InstanceBodyDialog
      v-if="dialogs.body && bodyPayload && bodyPayload.body"
      :definition-name="bodyPayload.definitionName"
      :version="bodyPayload.version"
      :scope-path="bodyPayload.scopePath"
      :document="document"
      :body="bodyPayload.body"
      :signals="signals"
      :model="model"
      @close="dialogs.body = null"
      @select="lab.notify({ tone: 'info', message: `内部元件 ${$event}` })"
      @enter="lab.openInstanceBody($event)"
    />
    <UpgradeDialog
      v-if="lab.upgradeOpen.value && lab.upgradePreview.value"
      :preview="lab.upgradePreview.value"
      @close="lab.upgradeOpen.value = false; lab.lib.closeUpgrade()"
      @apply="lab.confirmUpgrade"
    />
  </div>
</template>
