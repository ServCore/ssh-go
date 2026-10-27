<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
  ackTerminal,
  closeTerminal,
  openTerminal,
  resizeTerminal,
  writeTerminal,
} from "../../lib/api";
import { errorMessage } from "../../lib/format";
import {
  terminalTheme,
  terminalAnsi,
  colorPromptCommand,
  restorePromptCommand,
} from "./appearance";
import { TerminalOutputHighlighter } from "./outputHighlight";
import type { TerminalEvent } from "../../lib/types";
import BaseModal from "../../components/BaseModal.vue";
import { isDark, accentColor } from "../../composables/appearance";
const previewAnsi = computed(() => terminalAnsi[isDark.value ? "dark" : "light"]);
const props = defineProps<{
  sessionId: string;
  connected: boolean;
  visible: boolean;
  highlight: boolean;
  appearanceOpen: boolean;
}>();
const emit = defineEmits<{
  ready: [];
  closed: [reason: string];
  operation: [value: string];
  "close-appearance": [];
  "update:highlight": [value: boolean];
}>();
const container = ref<HTMLDivElement | null>(null),
  error = ref(""),
  ready = ref(false);
let term: Terminal | undefined,
  fit: FitAddon | undefined,
  highlighter: TerminalOutputHighlighter | undefined,
  id: string | undefined,
  disposed = false,
  unacked = 0,
  input = "",
  timer: ReturnType<typeof setTimeout> | undefined,
  resizeFrame = 0,
  command = "";
let inputQueue = Promise.resolve();
const disposeCallbacks: (() => void)[] = [];
function queue(data: Uint8Array) {
  if (!id) return;
  const terminalID = id;
  inputQueue = inputQueue
    .then(async () => {
      for (
        let offset = 0;
        offset < data.length && !disposed && props.connected;
        offset += 65536
      )
        await writeTerminal(terminalID, data.subarray(offset, offset + 65536));
    })
    .catch((e) => {
      if (!disposed) error.value = errorMessage(e);
    });
}
function flush() {
  clearTimeout(timer);
  timer = undefined;
  if (!id) return;
  const data = input;
  input = "";
  if (data) queue(new TextEncoder().encode(data));
}
function receive(event: TerminalEvent) {
  if (disposed || !term) return;
  if (event.kind === "output") {
    const bytes = new Uint8Array(event.data);
    term.write(bytes, () => {
      if (disposed) return;
      if (id) void ackTerminal(id, bytes.length).catch(() => {});
      else unacked += bytes.length;
    });
  } else if (event.kind === "closed") {
    error.value = event.reason || "终端已关闭";
    emit("closed", event.reason);
  } else error.value = event.message;
}
function resize() {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    if (
      disposed ||
      !container.value?.clientWidth ||
      !container.value.clientHeight ||
      !term ||
      !fit
    )
      return;
    fit.fit();
    if (id) void resizeTerminal(id, term.cols, term.rows).catch(() => {});
  });
}
function fill(value: string) {
  if (!ready.value || !props.connected || !term) return;
  term.paste(value);
  emit("close-appearance");
  void nextTick(() =>
    requestAnimationFrame(() => {
      if (!disposed && props.visible) term?.focus();
    }),
  );
}
onMounted(async () => {
  await nextTick();
  if (disposed || !container.value) return;
  term = new Terminal({
    fontFamily: 'Menlo, Monaco, "SFMono-Regular", monospace',
    fontSize: 13,
    lineHeight: 1.35,
    cursorBlink: false,
    scrollback: 3000,
    minimumContrastRatio: 4.5,
    drawBoldTextInBrightColors: true,
    theme: terminalTheme(isDark.value),
    allowProposedApi: true,
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container.value);
  if (container.value.clientWidth && container.value.clientHeight) fit.fit();
  highlighter = new TerminalOutputHighlighter(term, {
    enabled: props.highlight,
    dark: isDark.value,
    visible: props.visible,
  });
  const data = term.onData((value) => {
    if (!props.connected) return;
    input += value;
    if (!timer) timer = setTimeout(flush, 8);
  });
  const binary = term.onBinary((value) => {
    if (!props.connected) return;
    flush();
    queue(Uint8Array.from(value, (c) => c.charCodeAt(0) & 255));
  });
  const osc133 = term.parser.registerOscHandler(133, (value) => {
    const marker = value.split(";")[0];
    if (marker === "A" || marker === "D") emit("operation", "等待命令");
    if (marker === "C") emit("operation", "正在执行命令 · shell 集成");
    return true;
  });
  const osc633 = term.parser.registerOscHandler(633, (value) => {
    const marker = value.split(";")[0];
    if (marker === "E")
      command = value
        .slice(2)
        .split(";")[0]
        .replace(
          /\\x([0-9a-fA-F]{2})|\\\\/g,
          (match, hex: string | undefined) =>
            hex ? String.fromCharCode(parseInt(hex, 16)) : match.slice(1),
        )
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, 240);
    if (marker === "C")
      emit(
        "operation",
        command ? `执行：${command}` : "正在执行命令 · shell 集成",
      );
    if (marker === "A" || marker === "D") {
      command = "";
      emit("operation", "等待命令");
    }
    return true;
  });
  disposeCallbacks.push(() => {
    data.dispose();
    binary.dispose();
    osc133.dispose();
    osc633.dispose();
  });
  const observer = new ResizeObserver(resize);
  observer.observe(container.value);
  disposeCallbacks.push(() => observer.disconnect());
  try {
    const info = await openTerminal(
      props.sessionId,
      term.cols,
      term.rows,
      receive,
    );
    if (disposed) {
      void closeTerminal(info.id).catch(() => {});
      return;
    }
    id = info.id;
    ready.value = true;
    emit("ready");
    if (unacked) {
      void ackTerminal(id, unacked).catch(() => {});
      unacked = 0;
    }
    if (input) flush();
    if (props.visible) term.focus();
  } catch (e) {
    if (!disposed) error.value = errorMessage(e);
  }
});
watch(
  () => props.visible,
  async (visible) => {
    highlighter?.update({ enabled: props.highlight, dark: isDark.value, visible });
    if (visible) {
      await nextTick();
      resize();
      term?.focus();
    }
  },
);
watch(
  () => props.highlight,
  (value) =>
    highlighter?.update({
      enabled: value,
      dark: isDark.value,
      visible: props.visible,
    }),
);
watch([isDark, accentColor], ([dark]) => {
  // CSS variables are applied synchronously before this watcher runs. Preserve
  // the terminal, PTY, selection and scrollback while refreshing its palette.
  if (term) term.options.theme = terminalTheme(dark);
  highlighter?.update({ enabled: props.highlight, dark, visible: props.visible });
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(timer);
  cancelAnimationFrame(resizeFrame);
  for (const stop of disposeCallbacks) stop();
  highlighter?.dispose();
  if (id) void closeTerminal(id).catch(() => {});
  id = undefined;
  term?.dispose();
  term = undefined;
  input = "";
  command = "";
});
</script>
<template>
  <div class="terminal-pane">
    <div ref="container" class="terminal-container"></div>
    <div v-if="error" class="terminal-notice" role="alert">{{ error }}</div>
    <div v-else-if="!ready" class="terminal-notice">正在建立终端通道…</div>
  </div>
  <BaseModal
    v-if="appearanceOpen"
    title="终端配色"
    close-label="关闭终端配色"
    description="终端配色跟随外观模式，保留 ANSI 颜色与纯文本显示高亮。"
    :width="460"
    @close="emit('close-appearance')"
    ><div class="terminal-color-preview" aria-label="提示符颜色示例">
      <span :style="{ color: previewAnsi.green }">user</span>@<span
        :style="{ color: previewAnsi.cyan }"
        >server</span
      >:<span :style="{ color: previewAnsi.blue }">~/project</span> $ ls
      <div>
        <span :style="{ color: previewAnsi.green }">成功</span
        ><span :style="{ color: previewAnsi.yellow }">警告</span
        ><span :style="{ color: previewAnsi.red }">错误</span>
      </div>
    </div>
    <label class="checkbox-label"
      ><input
        type="checkbox"
        :checked="highlight"
        @change="
          emit('update:highlight', ($event.target as HTMLInputElement).checked)
        "
      />纯文本显示高亮</label
    >
    <p class="form-note">
      为 Docker 表格、提示符和登录失败提示着色，复制的文本保持原样。
    </p>
    <div class="settings-divider"></div>
    <h3>彩色提示符 · Bash / Zsh</h3>
    <p class="form-note">
      在空的 shell 提示符处填入命令，再按回车应用。仅影响当前
      shell，可恢复原提示符。
    </p>
    <div class="modal-actions">
      <a-button
        :disabled="!ready || !connected"
        @click="fill(restorePromptCommand)"
        >填入恢复命令</a-button
      ><a-button
        type="primary"
        :disabled="!ready || !connected"
        @click="fill(colorPromptCommand)"
        >填入启用命令</a-button
      >
    </div></BaseModal
  >
</template>
