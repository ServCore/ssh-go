<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { FileEndpoint, FileEntry } from "../../lib/types";
import {
  confirmAction,
  createFile,
  getPreferences,
  setPreference,
  deleteFile,
  listFiles,
  mkdirFile,
  renameFile,
  resolveFilePath,
} from "../../lib/api";
import {
  errorMessage,
  formatBytes,
  joinPath,
  parentPath,
} from "../../lib/format";
import AppIcon from "../../components/AppIcon.vue";
import FilePathBar from "./FilePathBar.vue";
import FileContextMenu, { type FileMenuAction } from "./FileContextMenu.vue";
import BaseModal from "../../components/BaseModal.vue";
import { useWorkspace } from "../../composables/workspace";
export interface PanelState {
  path: string;
  selections: FileEntry[];
}
const props = defineProps<{
  endpoint: FileEndpoint;
  initialPath: string;
  title: string;
  visible: boolean;
  transferAction: "upload" | "download";
  disabled?: boolean;
  transferDisabled?: boolean;
  dropToken?: string;
}>();
const emit = defineEmits<{
  state: [state: PanelState];
  transfer: [entries: FileEntry[]];
  operation: [text: string];
  dragStart: [entries: FileEntry[], event: DragEvent];
  dragEnd: [];
  dropFiles: [];
}>();
const path = ref(props.initialPath),
  pathInput = ref(props.initialPath),
  pathControl = ref<InstanceType<typeof FilePathBar>>(),
  // Directory replies are immutable snapshots, replaced together after a load.
  // Deep reactivity would proxy and track every entry, including offscreen rows.
  entries = shallowRef<FileEntry[]>([]),
  selected = shallowRef(new Set<string>()),
  filter = ref(""),
  hidden = ref(false),
  sort = ref<"name" | "size" | "modified">("name"),
  busy = ref(false),
  error = ref(""),
  scroll = ref<HTMLDivElement | null>(null),
  action = ref<"mkdir" | "create" | "rename" | null>(null),
  value = ref(""),
  saving = ref(false),
  actionError = ref("");
let alive = true,
  requestID = 0,
  anchor: string | null = null;
let loaded = false;
let loadingPath: string | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
// Only the displayed and currently loading directories can be dirty.
const dirtyDirectories = new Set<string>();
function canRefresh() { return alive && props.visible && !props.disabled; }
function scheduleRefresh(delay = 120) {
  if (!canRefresh() || busy.value || saving.value || refreshTimer !== undefined) return;
  if (loaded && !dirtyDirectories.has(path.value)) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined;
    if (canRefresh() && !busy.value && !saving.value && (!loaded || dirtyDirectories.has(path.value))) void load();
  }, delay);
}
const stopChanges = useWorkspace().onDirectoryChanged(change => {
  if (change.endpoint.kind !== props.endpoint.kind) return;
  if (change.endpoint.kind === "remote" && (props.endpoint.kind !== "remote" || change.endpoint.sessionId !== props.endpoint.sessionId)) return;
  if (change.path !== path.value && change.path !== loadingPath) return;
  dirtyDirectories.add(change.path);
  scheduleRefresh();
});
const collator = new Intl.Collator("zh-CN", { numeric: true });
const displayed = computed(() => {
  const showHidden = hidden.value,
    query = filter.value.toLocaleLowerCase(),
    order = sort.value;
  return entries.value
    .filter(
      (e) =>
        (showHidden || !e.name.startsWith(".")) &&
        (!query || e.name.toLocaleLowerCase().includes(query)),
    )
    .sort((a, b) => {
      if ((a.kind === "directory") !== (b.kind === "directory"))
        return a.kind === "directory" ? -1 : 1;
      return order === "size"
        ? b.size - a.size
        : order === "modified"
          ? (b.modified || 0) - (a.modified || 0)
          : collator.compare(a.name, b.name);
    });
});
const selections = computed(() => {
  const paths = selected.value;
  return paths.size ? entries.value.filter((e) => paths.has(e.path)) : [];
});
const mode = ref<"list" | "icons">("list"), gridColumns = ref(1), dropActive = ref(false);
const columns = computed(() => mode.value === "icons" ? gridColumns.value : 1);
const preferenceKey = `files.${props.endpoint.kind}.viewMode`;
let modeRevision = 0;
let preferenceWrite: Promise<unknown> = Promise.resolve();
async function setMode(next: "list" | "icons") {
  modeRevision++;
  mode.value = next;
  preferenceWrite = preferenceWrite.catch(() => {}).then(() => setPreference(preferenceKey, next));
  try { await preferenceWrite; } catch (e) { if (alive) error.value = errorMessage(e); }
}
const virtualizer = useVirtualizer(
  computed(() => ({
    count: Math.ceil(displayed.value.length / columns.value),
    getScrollElement: () => scroll.value,
    estimateSize: () => mode.value === "icons" ? 126 : 37,
    overscan: mode.value === "icons" ? 3 : 12,
    getItemKey: (index: number) => displayed.value[index * columns.value]!.path,
  })),
);
const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalHeight = computed(() => virtualizer.value.getTotalSize());
function rowEntries(index: number) {
  const start = index * columns.value;
  return displayed.value.slice(start, start + columns.value).map((entry, offset) => ({ entry, index: start + offset }));
}
watch([mode, columns], async () => {
  await nextTick();
  virtualizer.value.measure();
});
watch(mode, () => virtualizer.value.scrollToOffset(0));
const menu = ref<{ x: number; y: number } | null>(null);
let menuAnchor: HTMLElement | undefined;
function closeMenu(restore = false) {
  menu.value = null;
  if (restore && menuAnchor?.isConnected) menuAnchor.focus();
}
function showMenu(event: MouseEvent, target?: HTMLElement) {
  const element = target || event.target as HTMLElement | null;
  const item = element?.closest<HTMLElement>("[data-file-path]");
  menuAnchor = item || scroll.value || undefined;
  if (item) {
    const entry = entries.value.find(e => e.path === item.dataset.filePath);
    if (entry && !selected.value.has(entry.path)) select(entry, event);
  }
  menu.value = { x: event.clientX, y: event.clientY };
}
function contextAction(kind: FileMenuAction) {
  closeMenu(true);
  if (kind === "list" || kind === "icons") void setMode(kind);
  else if (kind === "refresh") void load();
  else if (kind === "transfer") emit("transfer", selections.value);
  else if (kind === "delete") void remove();
  else chooseAction(kind);
}
function dragStart(entry: FileEntry, event: DragEvent) {
  closeMenu();
  if (props.disabled || props.transferDisabled || busy.value || saving.value || !["file", "directory"].includes(entry.kind)) {
    event.preventDefault(); return;
  }
  if (!selected.value.has(entry.path)) {
    selected.value = new Set([entry.path]);
    anchor = entry.path;
  }
  emit("dragStart", selections.value, event);
}
function dragOver(event: DragEvent) {
  if (!props.dropToken || props.disabled || props.transferDisabled || busy.value || saving.value || !event.dataTransfer?.types.includes("application/x-ssh-go-files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  dropActive.value = true;
}
function dragLeave(event: DragEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dropActive.value = false;
}
function drop(event: DragEvent) {
  event.preventDefault();
  dropActive.value = false;
  if (props.dropToken && !props.disabled && !props.transferDisabled && !busy.value && !saving.value && event.dataTransfer?.getData("application/x-ssh-go-files") === props.dropToken) emit("dropFiles");
}
watch(() => [props.dropToken, props.visible, props.disabled], () => {
  dropActive.value = false;
  if (!props.visible || props.disabled) closeMenu();
});
watch(
  [path, selections],
  () => emit("state", { path: path.value, selections: selections.value }),
  { immediate: true },
);
async function load(target = path.value) {
  if (!alive || props.disabled) return;
  clearTimeout(refreshTimer);
  refreshTimer = undefined;
  const request = ++requestID;
  let resolved: string | undefined;
  let succeeded = false;
  busy.value = true;
  error.value = "";
  emit("operation", `读取${props.title}`);
  try {
    resolved = await resolveFilePath(props.endpoint, target);
    if (!alive || request !== requestID) return;
    loadingPath = resolved;
    for (const directory of dirtyDirectories) {
      if (directory !== path.value && directory !== resolved) dirtyDirectories.delete(directory);
    }
    // Changes preceding this read are covered by it; later completions remain
    // dirty and cause one follow-up read after the current request finishes.
    dirtyDirectories.delete(resolved);
    const next = await listFiles(props.endpoint, resolved);
    if (!alive || request !== requestID) return;
    const same = path.value === resolved;
    entries.value = next;
    path.value = resolved;
    pathInput.value = resolved;
    const retained = new Set<string>();
    const selectedPaths = selected.value;
    if (same && selectedPaths.size) {
      for (const entry of next) {
        if (selectedPaths.has(entry.path)) retained.add(entry.path);
      }
    }
    selected.value = retained;
    loaded = true;
    succeeded = true;
    for (const directory of dirtyDirectories) {
      if (directory !== resolved) dirtyDirectories.delete(directory);
    }
    anchor = null;
    if (!same) {
      filter.value = "";
      virtualizer.value.scrollToOffset(0);
    }
  } catch (e) {
    if (alive && request === requestID) {
      error.value = errorMessage(e);
      if (resolved) dirtyDirectories.add(resolved);
    }
  } finally {
    if (alive && request === requestID) {
      busy.value = false;
      loadingPath = undefined;
      emit("operation", "文件管理");
      if (succeeded && dirtyDirectories.has(path.value)) scheduleRefresh();
    }
  }
}
function select(entry: FileEntry, event: MouseEvent | KeyboardEvent) {
  const next = new Set(selected.value);
  if (event.shiftKey && anchor) {
    const a = displayed.value.findIndex((e) => e.path === anchor),
      b = displayed.value.indexOf(entry);
    if (a >= 0) {
      if (!event.metaKey && !event.ctrlKey) next.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++)
        next.add(displayed.value[i]!.path);
    }
  } else if (event.metaKey || event.ctrlKey) {
    if (next.has(entry.path)) next.delete(entry.path);
    else next.add(entry.path);
    anchor = entry.path;
  } else {
    next.clear();
    next.add(entry.path);
    anchor = entry.path;
  }
  selected.value = next;
}
function open(entry: FileEntry) {
  if (entry.kind === "directory") void load(entry.path);
}
function chooseAction(kind: "mkdir" | "create" | "rename") {
  action.value = kind;
  value.value = kind === "rename" ? selections.value[0]?.name || "" : "";
  actionError.value = "";
}
async function saveAction() {
  if (saving.value || !action.value || props.disabled || busy.value) return;
  const name = value.value.trim();
  let relativePath = name;
  if (action.value === "mkdir") {
    const parts = name.split("/");
    relativePath = parts.filter(part => part && part !== ".").join("/");
    if (!relativePath || name.startsWith("/") || name.includes("\0") || parts.includes("..")) {
      actionError.value = "请输入当前目录下的相对路径，可用 / 分隔多级目录，不包含 ..。";
      return;
    }
  } else if (!name || [".", ".."].includes(name) || /[\/\x00]/.test(name)) {
    actionError.value = "请输入有效文件名，不包含路径分隔符。";
    return;
  }
  saving.value = true;
  actionError.value = "";
  try {
    const target = joinPath(path.value, relativePath);
    if (action.value === "mkdir") await mkdirFile(props.endpoint, target);
    else if (action.value === "create") await createFile(props.endpoint, target);
    else {
      const entry = selections.value[0];
      if (!entry) throw new Error("请重新选择文件");
      await renameFile(props.endpoint, entry.path, target);
    }
    if (alive) {
      action.value = null;
      await load();
    }
  } catch (e) {
    if (alive) actionError.value = errorMessage(e);
  } finally {
    if (alive) saving.value = false;
  }
}
async function remove() {
  const snapshot = [...selections.value];
  if (!snapshot.length || saving.value) return;
  if (
    !(await confirmAction(
      "删除文件",
      `确认删除 ${snapshot.length} 项？\n${snapshot
        .slice(0, 5)
        .map((e) => e.name)
        .join("\n")}\n目录仅可删除空目录。`,
    ))
  )
    return;
  saving.value = true;
  error.value = "";
  const failures: string[] = [];
  for (const entry of snapshot) {
    try {
      await deleteFile(props.endpoint, entry.path, entry.kind === "directory");
    } catch (e) {
      failures.push(entry.name + "：" + errorMessage(e));
    }
  }
  if (alive) {
    await load();
    if (failures.length) error.value = failures.join("\n");
    saving.value = false;
  }
}
async function keydown(event: KeyboardEvent) {
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const bounds = target.getBoundingClientRect();
    showMenu(new MouseEvent("contextmenu", { clientX: bounds.left + 20, clientY: bounds.top + 20 }), target);
    return;
  }
  if (mode.value === "icons" && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-file-path]");
    if (element) {
      event.preventDefault();
      const index = displayed.value.findIndex(entry => entry.path === element.dataset.filePath);
      const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns.value : columns.value;
      const next = event.key === "Home" ? 0 : event.key === "End" ? displayed.value.length - 1 : Math.max(0, Math.min(displayed.value.length - 1, index + offset));
      const entry = displayed.value[next];
      if (entry) {
        if (!event.ctrlKey && !event.metaKey) select(entry, event);
        virtualizer.value.scrollToIndex(Math.floor(next / columns.value));
        await nextTick();
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await nextTick();
        if (alive && props.visible) [...(scroll.value?.querySelectorAll<HTMLElement>("[data-file-path]") || [])].find(item => item.dataset.filePath === entry.path)?.focus();
      }
      return;
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selected.value = new Set(displayed.value.map((e) => e.path));
  }
  if (event.key === "Backspace" && !props.disabled) {
    event.preventDefault();
    void load(parentPath(path.value));
  }
}
const date = (timestamp: number | null) =>
  timestamp
    ? new Date(timestamp * 1000).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
let sizeObserver: ResizeObserver | undefined;
onMounted(() => {
  sizeObserver = new ResizeObserver(() => {
    gridColumns.value = Math.max(1, Math.floor(((scroll.value?.clientWidth || 128) - 8) / 128));
  });
  if (scroll.value) sizeObserver.observe(scroll.value);
  const revision = modeRevision;
  void getPreferences().then(p => {
    const saved = p[preferenceKey];
    if (alive && revision === modeRevision && (saved === "list" || saved === "icons")) mode.value = saved;
  }).catch(() => {});
  if (canRefresh()) void load(props.initialPath);
});
watch(
  [() => props.visible, () => props.disabled, saving],
  () => {
    if (canRefresh()) scheduleRefresh(0);
    else { clearTimeout(refreshTimer); refreshTimer = undefined; }
  },
);
onBeforeUnmount(() => {
  alive = false;
  sizeObserver?.disconnect();
  requestID++;
  clearTimeout(refreshTimer);
  stopChanges();
});
</script>
<template>
  <section class="file-panel" :class="{ 'is-drop-target': dropActive }" :aria-label="title" @dragover="dragOver" @dragleave="dragLeave" @drop="drop">
    <div class="file-panel-title">
      <span class="file-panel-heading"
        ><AppIcon
          :name="endpoint.kind === 'local' ? 'desktop' : 'server'"
          :size="16"
        /><span>{{ title }}</span><small class="caption">{{ entries.length }} 项</small></span>
      <div v-if="$slots.actions" class="file-panel-heading-actions"><slot name="actions" /></div>
    </div>
    <form class="file-pathbar" @submit.prevent="pathControl?.submit()">
      <button
        type="button"
        class="icon-button"
        :aria-label="`${title}上级目录`"
        :disabled="disabled || busy || path === '/'"
        @click="load(parentPath(path))"
      >
        <AppIcon name="up" :size="16" /></button
      ><FilePathBar ref="pathControl" v-model="pathInput" :path="path" :title="title" :disabled="disabled" :loading="busy" :navigation-error="error" :visible="visible" @navigate="load" @edit="closeMenu()" /><button
        class="icon-button"
        :aria-label="`${title}前往目录`"
        :disabled="disabled || busy"
      >
        <AppIcon name="right" :size="15" /></button
      ><button
        type="button"
        class="icon-button"
        :aria-label="`刷新${title}`"
        :disabled="disabled || busy"
        @click="load()"
      >
        <AppIcon name="refresh" :size="15" />
      </button>
    </form>
    <div class="file-tools">
      <div class="file-search">
        <AppIcon name="search" :size="14" /><input
          v-model="filter"
          :aria-label="`搜索${title}`"
          placeholder="搜索当前目录"
        />
      </div>
      <div class="file-view-switch" role="group" :aria-label="`${title}展示模式`">
        <button :aria-label="`${title}列表展示`" title="列表展示" :aria-pressed="mode === 'list'" @click="setMode('list')"><AppIcon name="list" :size="15" /></button>
        <button :aria-label="`${title}图标展示`" title="图标展示" :aria-pressed="mode === 'icons'" @click="setMode('icons')"><AppIcon name="apps" :size="15" /></button>
      </div>
      <label class="hidden-files"
        ><input v-model="hidden" type="checkbox" />隐藏文件</label
      ><select v-model="sort" :aria-label="`${title}排序`">
        <option value="name">名称</option>
        <option value="size">大小</option>
        <option value="modified">修改时间</option>
      </select>
    </div>
    <div
      class="file-table"
      :role="mode === 'list' ? 'table' : 'grid'"
      :aria-label="`${title}${mode === 'list' ? '列表' : '图标'}`"
      :aria-rowcount="mode === 'list' ? displayed.length + 1 : Math.ceil(displayed.length / columns)"
      :aria-colcount="mode === 'icons' ? columns : undefined"
    >
      <div v-if="mode === 'list'" class="file-table-header" role="row">
        <span role="columnheader">名称</span
        ><span role="columnheader">大小</span
        ><span role="columnheader" class="file-modified">修改时间</span>
      </div>
      <div
        ref="scroll"
        class="file-scroll"
        role="rowgroup"
        tabindex="0"
        @keydown="keydown"
        @contextmenu.prevent="showMenu"
      >
        <div v-if="busy && !entries.length" class="file-loading" role="status">
          正在读取目录…
        </div>
        <div v-else-if="!displayed.length" class="file-empty">
          {{
            error
              ? "目录读取失败"
              : filter
                ? "没有匹配的文件"
                : "这个目录是空的"
          }}
        </div>
        <div :style="{ height: totalHeight + 'px', position: 'relative' }">
          <div v-for="row in virtualRows" :key="String(row.key)" class="file-virtual-row" :class="{ 'file-icon-row': mode === 'icons' }"
            :role="mode === 'icons' ? 'row' : 'presentation'" :aria-rowindex="mode === 'icons' ? row.index + 1 : undefined"
            :style="{ transform: `translateY(${row.start}px)`, height: row.size + 'px', gridTemplateColumns: mode === 'icons' ? `repeat(${columns}, minmax(0, 1fr))` : undefined }">
            <div v-for="{ entry, index } in rowEntries(row.index)" :key="entry.path" class="file-item"
              :class="{ 'file-row': mode === 'list', 'file-icon-item': mode === 'icons', selected: selected.has(entry.path) }"
              :role="mode === 'list' ? 'row' : 'gridcell'" :aria-label="entry.name" :aria-selected="selected.has(entry.path)"
              :aria-rowindex="mode === 'list' ? index + 2 : undefined" :aria-colindex="mode === 'icons' ? index % columns + 1 : undefined"
              :data-file-path="entry.path" tabindex="0" :draggable="!disabled && !transferDisabled && !busy && !saving && ['file', 'directory'].includes(entry.kind)"
              @click="select(entry, $event)" @dblclick="open(entry)" @keydown.enter.prevent="open(entry)" @keydown.space.prevent="select(entry, $event)"
              @dragstart="dragStart(entry, $event)" @dragend="emit('dragEnd')">
              <span class="file-name" :role="mode === 'list' ? 'cell' : undefined" :title="entry.name">
                <AppIcon :name="entry.kind === 'directory' ? 'folder' : entry.kind === 'symlink' ? 'link' : 'file'" :size="mode === 'icons' ? 36 : 17" :class="{ 'folder-icon': entry.kind === 'directory' }" />
                <span>{{ entry.name }}</span><small class="file-parent-path" :title="`上级目录：${parentPath(entry.path)}`">{{ parentPath(entry.path) }}</small>
              </span>
              <span v-if="mode === 'list'" role="cell" class="file-size">{{ entry.kind === 'directory' ? '—' : formatBytes(entry.size) }}</span>
              <span v-if="mode === 'list'" role="cell" class="file-modified">{{ date(entry.modified) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
    <Transition name="file-drop">
      <div v-if="dropActive" class="file-drop-overlay" aria-hidden="true"><AppIcon :name="endpoint.kind === 'remote' ? 'upload' : 'download'" :size="26" /><strong>{{ endpoint.kind === 'remote' ? '松开上传到当前目录' : '松开下载到当前目录' }}</strong><span>{{ path }}</span></div>
    </Transition>
    <FileContextMenu v-if="menu" :x="menu.x" :y="menu.y" :title="title" :path="path" :mode="mode" :transfer-action="transferAction"
      :can-mutate="!disabled && !busy && !saving" :can-rename="!disabled && !busy && !saving && selections.length === 1"
      :can-delete="!disabled && !busy && !saving && selections.length > 0" :can-transfer="!disabled && !transferDisabled && selections.length > 0"
      @action="contextAction" @close="closeMenu" />
    <div v-if="error" class="file-error" role="alert">{{ error }}</div>
    <div class="file-actions">
      <a-button
        size="small"
        :disabled="disabled || busy || saving"
        :aria-label="`${title}新建目录`"
        @click="chooseAction('mkdir')"
        ><template #icon><AppIcon name="plus" :size="14" /></template
        >新建</a-button
      ><a-button
        size="small"
        :disabled="disabled || selections.length !== 1 || saving"
        :aria-label="`${title}重命名`"
        @click="chooseAction('rename')"
        ><AppIcon name="edit" :size="14" /></a-button
      ><a-button
        size="small"
        :disabled="disabled || !selections.length || saving"
        :aria-label="`${title}删除所选`"
        @click="remove"
        ><AppIcon name="delete" :size="14" /></a-button
      ><span
        class="file-selection-count"
        :title="selections.map((e) => e.name).join('\n')"
        >{{
          selections.length ? `已选 ${selections.length} 项` : "未选择文件"
        }}</span
      ><a-button
        size="small"
        type="primary"
        :disabled="disabled || transferDisabled || !selections.length"
        :aria-label="`${transferAction === 'upload' ? '上传' : '下载'}所选文件`"
        @click="emit('transfer', selections)"
        ><template #icon><AppIcon :name="transferAction" :size="14" /></template
        >{{ transferAction === "upload" ? "上传" : "下载" }}</a-button
      >
    </div>
    <BaseModal
      v-if="action"
      :title="action === 'mkdir' ? '新建目录' : action === 'create' ? '新建文件' : '重命名文件'"
      :width="420"
      :busy="saving"
      @close="action = null"
      ><form class="form-stack" @submit.prevent="saveAction">
        <label class="form-field"
          >{{ action === "mkdir" ? "目录名称" : action === "create" ? "文件名称" : "新名称"
          }}<input v-model="value" required autofocus :placeholder="action === 'mkdir' ? '例如 data/yiqiban/config' : undefined"
        /></label>
        <p v-if="action === 'mkdir'" class="form-note">支持用 / 创建多级目录，缺少的父目录会自动创建。</p>
        <p v-if="actionError" class="inline-error" role="alert">
          {{ actionError }}
        </p>
        <div class="modal-actions">
          <a-button :disabled="saving" @click="action = null">取消</a-button
          ><a-button type="primary" html-type="submit" :loading="saving" :disabled="disabled || busy"
            >确认</a-button
          >
        </div>
      </form></BaseModal
    >
  </section>
</template>

<style scoped>
.file-panel { position: relative; transition: box-shadow 120ms ease-out; }
.file-tools { flex-wrap: wrap; }
.file-view-switch { display: flex; flex-shrink: 0; gap: 2px; }
.file-view-switch button { --icon-color: currentColor; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 4px; color: var(--muted); }
.file-view-switch button:hover { background: var(--hover); color: var(--ink); }
.file-view-switch button[aria-pressed="true"] { color: var(--accent); background: var(--accent-soft); }
.file-virtual-row { position: absolute; top: 0; left: 0; width: 100%; }
.file-icon-row { display: grid; gap: 8px; padding: 6px 8px; }
.file-icon-item { min-width: 0; border: 1px solid transparent; border-radius: 6px; padding: 7px 5px; user-select: none; }
.file-icon-item:hover { background: var(--hover); }
.file-icon-item.selected { background: var(--accent-soft); border-color: var(--accent-line); }
.file-icon-item .file-name { flex-direction: column; gap: 4px; width: 100%; height: 100%; }
.file-icon-item .file-name > span { flex: none; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; max-height: 32px; line-height: 16px; white-space: normal; overflow-wrap: anywhere; text-align: center; width: 100%; }
.file-icon-item .file-parent-path { flex: none; max-width: 100%; font-size: 9px; }
.file-drop-overlay { position: absolute; inset: 85px 10px 46px; z-index: 20; pointer-events: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 20px; border: 2px dashed var(--accent); border-radius: 8px; background: var(--surface); opacity: .96; color: var(--accent); }
.file-drop-overlay strong { font-size: 13px; font-weight: 500; }
.file-drop-overlay span { font-size: 11px; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.is-drop-target { box-shadow: inset 0 0 0 2px var(--accent); }
.file-drop-enter-active, .file-drop-leave-active { transition: opacity 120ms ease-out; }
.file-drop-enter-active .app-icon { transition: transform 160ms ease-out; }
.file-drop-enter-from, .file-drop-leave-to { opacity: 0; }
.file-drop-enter-from .app-icon { transform: translateY(4px); }
</style>
