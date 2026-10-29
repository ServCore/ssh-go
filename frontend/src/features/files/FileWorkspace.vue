<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import FilePanel from "./FilePanel.vue";
import type { PanelState } from "./FilePanel.vue";
import AppIcon from "../../components/AppIcon.vue";
import {
  chooseLocalDirectory,
  chooseLocalFiles,
  confirmAction,
  getHomeDirectory,
  getPreferences,
  listFiles,
  setPreference,
  startTransfer,
} from "../../lib/api";
import type { FileEndpoint, FileEntry } from "../../lib/types";
import { useWorkspace } from "../../composables/workspace";
import { errorMessage, joinPath } from "../../lib/format";
const props = defineProps<{
  sessionId: string;
  closed: boolean;
  visible: boolean;
  compact?: boolean;
  initialLocalPath?: string;
  initialRemotePath?: string;
}>();
const emit = defineEmits<{ expand: []; close: []; paths: [paths: { local: string; remote: string }] }>();
const w = useWorkspace();
const home = ref(""),
  local = shallowRef<PanelState>({ path: "", selections: [] }),
  remote = shallowRef<PanelState>({ path: props.initialRemotePath || ".", selections: [] }),
  busy = ref(false),
  error = ref(""),
  notice = ref(""),
  ratio = ref(50),
  panels = ref<HTMLDivElement | null>(null);
let alive = true;
const stops: (() => void)[] = [];
const localEndpoint: FileEndpoint = { kind: "local" },
  remoteEndpoint = computed<FileEndpoint>(() => ({
    kind: "remote",
    sessionId: props.sessionId,
  }));
const pageVisible = ref(!document.hidden);
const panelsVisible = computed(() => props.visible && pageVisible.value);
function visibility() { pageVisible.value = !document.hidden; }
watch(() => [local.value.path, remote.value.path], ([localPath, remotePath]) => {
  if (localPath && remotePath) emit("paths", { local: localPath, remote: remotePath });
});
onMounted(async () => {
  document.addEventListener("visibilitychange", visibility);
  try {
    const path = props.initialLocalPath || await getHomeDirectory();
    if (alive) home.value = path;
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  }
  try {
    const p = await getPreferences();
    if (alive && typeof p["files.panelRatio"] === "number")
      ratio.value = Math.min(75, Math.max(25, p["files.panelRatio"]));
  } catch {}
});
onBeforeUnmount(() => {
  alive = false;
  document.removeEventListener("visibilitychange", visibility);
  for (const stop of stops) stop();
});
async function transferBatch(
  items: Array<{ path: string; kind?: string }>,
  source: FileEndpoint,
  destination: FileEndpoint,
  target: string,
) {
  if (busy.value || props.closed || !items.length) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const existing = new Map(
      (await listFiles(destination, target)).map((e) => [e.name, e]),
    );
    const names = new Set<string>(),
      problems: string[] = [];
    let submitted = 0,
      skipped = 0;
    for (let index = 0; index < items.length; index++) {
      if (!alive) break;
      const entry = items[index]!,
        name = entry.path.split("/").filter(Boolean).pop() || "file";
      try {
        if (entry.kind && !["file", "directory"].includes(entry.kind))
          throw new Error("不传输符号链接或特殊文件。");
        if (names.has(name)) throw new Error("本批次已有同名目标。");
        const prior = existing.get(name);
        if (prior && prior.kind !== "file")
          throw new Error("目标目录或特殊文件已存在，不能覆盖或合并。");
        let overwrite = false;
        if (prior) {
          overwrite = await confirmAction(
            "覆盖现有文件",
            `${joinPath(target, name)} 已存在。确认覆盖？`,
          );
          if (!overwrite) {
            skipped++;
            continue;
          }
        }
        if (!alive) break;
        const task = await startTransfer({
          source,
          destination,
          sourcePath: entry.path,
          destinationPath: joinPath(target, name),
          overwrite,
        });
        w.updateTransfer(task);
        names.add(name);
        submitted++;
      } catch (e) {
        if (problems.length < 12) problems.push(name + "：" + errorMessage(e));
        if ((e as { code?: string }).code === "transfer_queue_full") {
          problems.push(
            `传输队列已满，剩余 ${items.length - index - 1} 项未提交。`,
          );
          break;
        }
      }
    }
    if (alive) {
      notice.value = `已提交 ${submitted} 项${skipped ? ` · 跳过 ${skipped} 项` : ""}。传输进度见状态栏。`;
      error.value = problems.join("\n");
    }
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function uploadFiles() {
  try {
    const paths = await chooseLocalFiles();
    await transferBatch(
      paths.map((path) => ({ path })),
      localEndpoint,
      remoteEndpoint.value,
      remote.value.path,
    );
  } catch (e) {
    error.value = errorMessage(e);
  }
}
async function uploadDirectory() {
  try {
    const path = await chooseLocalDirectory();
    if (path)
      await transferBatch(
        [{ path, kind: "directory" }],
        localEndpoint,
        remoteEndpoint.value,
        remote.value.path,
      );
  } catch (e) {
    error.value = errorMessage(e);
  }
}
function upload(entries: FileEntry[]) {
  void transferBatch(
    entries,
    localEndpoint,
    remoteEndpoint.value,
    remote.value.path,
  );
}
function download(entries: FileEntry[]) {
  void transferBatch(
    entries,
    remoteEndpoint.value,
    localEndpoint,
    local.value.path,
  );
}
// Keep drag contents inside this workspace. The data transfer carries only an
// opaque token; external payloads cannot choose arbitrary source paths.
const drag = shallowRef<{ token: string; kind: "local" | "remote"; entries: FileEntry[] } | null>(null);
function beginDrag(kind: "local" | "remote", entries: FileEntry[], event: DragEvent) {
  if (props.closed || busy.value || !event.dataTransfer || !entries.length) { event.preventDefault(); return; }
  const token = crypto.randomUUID();
  drag.value = { token, kind, entries: entries.map(entry => ({ ...entry })) };
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData("application/x-ssh-go-files", token);
}
function endDrag() { drag.value = null; }
function dropOn(kind: "local" | "remote") {
  const source = drag.value;
  endDrag();
  if (!source || source.kind === kind || props.closed || busy.value) return;
  if (kind === "remote") upload(source.entries);
  else download(source.entries);
}
watch(() => [panelsVisible.value, props.closed], endDrag);
function saveRatio() {
  void setPreference("files.panelRatio", ratio.value).catch(w.fail);
}
function resize(event: PointerEvent) {
  const element = panels.value;
  if (!element) return;
  const bounds = element.getBoundingClientRect(),
    handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => {
    ratio.value = Math.max(
      25,
      Math.min(75, ((e.clientX - bounds.left) / bounds.width) * 100),
    );
  };
  const stop = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", stop);
    handle.removeEventListener("pointercancel", stop);
    saveRatio();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  stops.push(stop);
}
</script>
<template>
  <div class="file-workspace" :class="{ compact }">
    <p v-if="notice" class="batch-notice" role="status">{{ notice }}</p>
    <p v-if="error" class="inline-error batch-error" role="alert">
      {{ error }}
    </p>
    <div ref="panels" class="file-panels" :style="{ '--split': ratio + '%' }">
      <FilePanel
        v-if="home"
        :endpoint="localEndpoint"
        :initial-path="home"
        title="本地文件"
        :visible="panelsVisible"
        transfer-action="upload"
        :transfer-disabled="closed || busy"
        :drop-token="drag?.kind === 'remote' ? drag.token : undefined"
        @drag-start="(entries, event) => beginDrag('local', entries, event)"
        @drag-end="endDrag"
        @drop-files="dropOn('local')"
        @state="local = $event"
        @transfer="upload"
        @operation="panelsVisible && w.active.value && (w.active.value.operation = $event)"
      />
      <div v-else class="file-empty">读取本地目录…</div>
      <div
        class="panel-resizer"
        role="separator"
        aria-label="调整本地和远程面板宽度"
        :aria-valuenow="Math.round(ratio)"
        :aria-valuemin="25"
        :aria-valuemax="75"
        aria-orientation="vertical"
        tabindex="0"
        @pointerdown="resize"
        @dblclick="
          ratio = 50;
          saveRatio();
        "
        @keydown.left.prevent="
          ratio = Math.max(25, ratio - 3);
          saveRatio();
        "
        @keydown.right.prevent="
          ratio = Math.min(75, ratio + 3);
          saveRatio();
        "
      ></div>
      <FilePanel
        :endpoint="remoteEndpoint"
        :initial-path="initialRemotePath || '.'"
        title="远程文件"
        :visible="panelsVisible"
        transfer-action="download"
        :disabled="closed"
        :transfer-disabled="closed || busy || !local.path"
        :drop-token="drag?.kind === 'local' ? drag.token : undefined"
        @drag-start="(entries, event) => beginDrag('remote', entries, event)"
        @drag-end="endDrag"
        @drop-files="dropOn('remote')"
        @state="remote = $event"
        @transfer="download"
        @operation="panelsVisible && w.active.value && (w.active.value.operation = $event)"
      >
        <template #actions>
          <a-button size="small" type="text" aria-label="上传文件" title="上传文件到当前远程目录"
            :disabled="closed || busy || !home" @click="uploadFiles">
            <template #icon><AppIcon name="upload" :size="15" /></template>
            <span class="upload-label">上传文件</span>
          </a-button>
          <a-button size="small" type="text" aria-label="上传目录" title="上传目录到当前远程目录"
            :disabled="closed || busy || !home" @click="uploadDirectory">
            <template #icon><AppIcon name="folder" :size="15" /></template>
            <span class="upload-label">上传目录</span>
          </a-button>
          <template v-if="compact">
            <a-button type="text" size="small" aria-label="展开文件面板" title="展开文件面板" @click="emit('expand')">
              <AppIcon name="expand" :size="15" />
            </a-button>
            <a-button type="text" size="small" aria-label="关闭文件面板" title="关闭文件面板" @click="emit('close')">
              <AppIcon name="close" :size="15" />
            </a-button>
          </template>
        </template>
      </FilePanel>
    </div>
  </div>
</template>
