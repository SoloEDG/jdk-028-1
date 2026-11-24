<script setup lang="ts">
import type { Bus, GateNode, SubcircuitDef } from "@/shared/types";
import type { WidthModel } from "@/features/library";
import { busText, busToDecimal, busToHex } from "@/features/simulation/lib/evaluate";

export interface PortRow {
  key: string;
  name: string;
  direction: "input" | "output";
  width: number | null;
  expr: string;
  bus?: Bus;
}

const props = defineProps<{
  node: GateNode;
  definition: SubcircuitDef | null;
  model: WidthModel | null;
  ports: PortRow[];
  paramValues: Record<string, number | null>;
  paramFree: Record<string, number[]>;
  scopePath: string;
  expanded: boolean;
}>();
const emit = defineEmits<{
  close: [];
  upgrade: [];
  rename: [name: string];
  toggleExpand: [];
  setWidth: [width: number];
  setInstanceParam: [name: string, value: string];
  chooseParam: [name: string, value: number];
  setBits: [index: number, value: 0 | 1];
  setSlice: [width: number, offset: number];
  setPorts: [ports: number];
  openBody: [];
}>();
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal instance-modal" role="dialog" :aria-label="`实例 ${node.label}`">
      <header class="modal-head">
        <h2>{{ node.label }}</h2>
        <button class="text-button" @click="emit('close')">关闭</button>
      </header>
      <p v-if="definition" class="instance-sub">
        {{ definition.name }} · 固定版本 v{{ node.defVersion }}
        <span v-if="definition.versions.length > 1">
          （当前最新 v{{ definition.versions[definition.versions.length - 1].version }}）
        </span>
      </p>
      <p v-else class="inline-error">实例引用的子电路定义已不存在，请改接或删除。</p>

      <div class="instance-actions">
        <button @click="emit('openBody')">进入实例观察内部</button>
        <button
          v-if="definition && node.defVersion !== definition.versions[definition.versions.length - 1].version"
          class="primary"
          @click="emit('upgrade')"
        >
          升级到新版本…
        </button>
        <button @click="emit('toggleExpand')">
          {{ expanded ? "返回上级观察" : "仅展开信号" }}
        </button>
      </div>

      <template v-if="definition">
        <div class="sub-heading-row"><b>位宽参数</b><span>外部线宽推导；多解时可切换</span></div>
        <table class="param-table">
          <thead>
            <tr><th>参数</th><th>当前</th><th>可行取值</th><th>指定</th></tr>
          </thead>
          <tbody>
            <tr v-for="param in definition.versions.find(v => v.version === node.defVersion)?.params ?? []" :key="param.name">
              <td>{{ param.name }}</td>
              <td><b>{{ paramValues[param.name] ?? "未定" }}</b></td>
              <td class="free-cell">
                <template v-if="(paramFree[param.name] ?? []).length">
                  <button
                    v-for="value in paramFree[param.name].slice(0, 8)"
                    :key="value"
                    class="free-choice"
                    :class="{ active: value === paramValues[param.name] }"
                    @click="emit('chooseParam', param.name, value)"
                  >
                    {{ value }}
                  </button>
                </template>
                <span v-else-if="paramValues[param.name] !== null" class="muted">
                  唯一解
                </span>
                <span v-else class="muted">由接线决定</span>
              </td>
              <td>
                <input
                  class="param-input"
                  :value="paramValues[param.name] ?? ''"
                  :min="param.min"
                  :max="param.max"
                  type="number"
                  @change="emit('setInstanceParam', param.name, ($event.target as HTMLInputElement).value)"
                />
              </td>
            </tr>
            <tr v-if="!(definition.versions.find(v => v.version === node.defVersion)?.params ?? []).length">
              <td colspan="4" class="muted">该子电路没有位宽参数。</td>
            </tr>
          </tbody>
        </table>

        <div class="sub-heading-row"><b>端口与内部信号</b><span>名称来自定义；接线按身份保持</span></div>
        <table class="param-table ports">
          <thead>
            <tr><th>方向</th><th>端口</th><th>位宽</th><th>二进制</th><th>十进制 / 十六进制</th></tr>
          </thead>
          <tbody>
            <tr v-for="port in ports" :key="`${port.direction}-${port.key}`">
              <td>{{ port.direction === "input" ? "输入" : "输出" }}</td>
              <td>{{ port.name }}</td>
              <td>{{ port.width ?? "?" }} <small>({{ port.expr }})</small></td>
              <td class="mono">{{ port.bus ? busText(port.bus) : "—" }}</td>
              <td class="mono">
                {{ port.bus ? `${busToDecimal(port.bus)} / ${busToHex(port.bus)}` : "—" }}
              </td>
            </tr>
          </tbody>
        </table>
      </template>

      <template v-else-if="node.kind === 'INPUT'">
        <div class="sub-heading-row"><b>输入开关</b><span>1–16 位</span></div>
        <label class="field compact">
          <span>位宽</span>
          <input
            type="number"
            min="1"
            max="16"
            :value="node.width ?? 1"
            @change="emit('setWidth', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
        <div v-if="(node.width ?? 1) > 1" class="bit-grid">
          <button
            v-for="index in (node.width ?? 1)"
            :key="index"
            class="bit-toggle"
            :class="{ on: (node.bits ?? [])[index - 1] === 1 }"
            @click="emit('setBits', index - 1, (node.bits ?? [])[index - 1] === 1 ? 0 : 1)"
          >
            b{{ index - 1 }}<b>{{ (node.bits ?? [])[index - 1] ?? 0 }}</b>
          </button>
        </div>
      </template>

      <template v-else-if="node.kind === 'OUTPUT'">
        <div class="sub-heading-row"><b>输出指示灯</b><span>1–16 位</span></div>
        <label class="field compact">
          <span>位宽</span>
          <input
            type="number"
            min="1"
            max="16"
            :value="node.width ?? 1"
            @change="emit('setWidth', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </template>

      <template v-else-if="node.kind === 'SLICE'">
        <div class="sub-heading-row"><b>切片</b><span>从总线取连续位</span></div>
        <div class="inline-fields">
          <label class="field compact">
            <span>起点</span>
            <input
              type="number"
              min="0"
              max="15"
              :value="node.sliceOffset ?? 0"
              @change="emit('setSlice', node.sliceWidth ?? 1, Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label class="field compact">
            <span>宽度</span>
            <input
              type="number"
              min="1"
              max="16"
              :value="node.sliceWidth ?? 1"
              @change="emit('setSlice', Number(($event.target as HTMLInputElement).value), node.sliceOffset ?? 0)"
            />
          </label>
        </div>
      </template>

      <template v-else-if="node.kind === 'CONCAT'">
        <div class="sub-heading-row"><b>拼接</b><span>2–16 段</span></div>
        <label class="field compact">
          <span>段数</span>
          <input
            type="number"
            min="2"
            max="16"
            :value="node.ports ?? 2"
            @change="emit('setPorts', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </template>

      <template v-else>
        <div class="sub-heading-row"><b>门</b><span>按位工作，所有输入必须同宽</span></div>
        <p class="small-note">
          总线宽度 {{ model?.portWidth(scopePath, node.id, "output", undefined, 0) ?? "?" }} 位；
          由接线推导，不能单独指定。
        </p>
      </template>

      <label class="field">
        <span>元件名称</span>
        <input
          :value="node.label"
          maxlength="40"
          @change="emit('rename', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </section>
  </div>
</template>
