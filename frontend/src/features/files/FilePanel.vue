<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { FileEndpoint, FileEntry } from "../../lib/types";
import {
  confirmAction,
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
}>();
const emit = defineEmits<{
  state: [state: PanelState];
  transfer: [entries: FileEntry[]];
  operation: [text: string];
}>();
const path = ref(props.initialPath),
  pathInput = ref(props.initialPath),
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
  action = ref<"mkdir" | "rename" | null>(null),
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
const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayed.value.length,
    getScrollElement: () => scroll.value,
    estimateSize: () => 37,
    overscan: 12,
    getItemKey: (index: number) => displayed.value[index]!.path,
  })),
);
const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalHeight = computed(() => virtualizer.value.getTotalSize());
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
function chooseAction(kind: "mkdir" | "rename") {
  action.value = kind;
  value.value = kind === "rename" ? selections.value[0]?.name || "" : "";
  actionError.value = "";
}
async function saveAction() {
  if (saving.value || !action.value) return;
  if (
    !value.value.trim() ||
    [".", ".."].includes(value.value) ||
    /[\/\x00]/.test(value.value)
  ) {
    actionError.value = "请输入有效文件名，不包含路径分隔符。";
    return;
  }
  saving.value = true;
  actionError.value = "";
  try {
    const target = joinPath(path.value, value.value.trim());
    if (action.value === "mkdir") await mkdirFile(props.endpoint, target);
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
function keydown(event: KeyboardEvent) {
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
onMounted(() => { if (canRefresh()) void load(props.initialPath); });
watch(
  [() => props.visible, () => props.disabled, saving],
  () => {
    if (canRefresh()) scheduleRefresh(0);
    else { clearTimeout(refreshTimer); refreshTimer = undefined; }
  },
);
onBeforeUnmount(() => {
  alive = false;
  requestID++;
  clearTimeout(refreshTimer);
  stopChanges();
});
</script>
<template>
  <section class="file-panel" :aria-label="title">
    <div class="file-panel-title">
      <span class="file-panel-heading"
        ><AppIcon
          :name="endpoint.kind === 'local' ? 'desktop' : 'server'"
          :size="16"
        /><span>{{ title }}</span><small class="caption">{{ entries.length }} 项</small></span>
      <div v-if="$slots.actions" class="file-panel-heading-actions"><slot name="actions" /></div>
    </div>
    <form class="file-pathbar" @submit.prevent="load(pathInput)">
      <button
        type="button"
        class="icon-button"
        :aria-label="`${title}上级目录`"
        :disabled="disabled || busy || path === '/'"
        @click="load(parentPath(path))"
      >
        <AppIcon name="up" :size="16" /></button
      ><input
        v-model="pathInput"
        :aria-label="`${title}目录路径`"
        :disabled="disabled"
        spellcheck="false"
        @keydown.enter.prevent="load(pathInput)"
      /><button
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
      role="table"
      :aria-label="`${title}列表`"
      :aria-rowcount="displayed.length + 1"
    >
      <div class="file-table-header" role="row">
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
          <div
            v-for="row in virtualRows"
            :key="String(row.key)"
            class="file-row"
            role="row"
            :aria-label="displayed[row.index]!.name"
            :aria-selected="selected.has(displayed[row.index]!.path)"
            :aria-rowindex="row.index + 2"
            :class="{ selected: selected.has(displayed[row.index]!.path) }"
            :style="{ transform: `translateY(${row.start}px)` }"
            tabindex="0"
            @click="select(displayed[row.index]!, $event)"
            @dblclick="open(displayed[row.index]!)"
            @keydown.enter.prevent="open(displayed[row.index]!)"
            @keydown.space.prevent="select(displayed[row.index]!, $event)"
          >
            <span
              class="file-name"
              role="cell"
              :title="displayed[row.index]!.name"
              ><AppIcon
                :name="
                  displayed[row.index]!.kind === 'directory'
                    ? 'folder'
                    : displayed[row.index]!.kind === 'symlink'
                      ? 'link'
                      : 'file'
                "
                :size="17"
                :class="{
                  'folder-icon': displayed[row.index]!.kind === 'directory',
                }"
              /><span>{{ displayed[row.index]!.name }}</span></span
            ><span role="cell" class="file-size">{{
              displayed[row.index]!.kind === "directory"
                ? "—"
                : formatBytes(displayed[row.index]!.size)
            }}</span
            ><span role="cell" class="file-modified">{{
              date(displayed[row.index]!.modified)
            }}</span>
          </div>
        </div>
      </div>
    </div>
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
      :title="action === 'mkdir' ? '新建目录' : '重命名文件'"
      :width="420"
      :busy="saving"
      @close="action = null"
      ><form class="form-stack" @submit.prevent="saveAction">
        <label class="form-field"
          >{{ action === "mkdir" ? "目录名称" : "新名称"
          }}<input v-model="value" required autofocus
        /></label>
        <p v-if="actionError" class="inline-error" role="alert">
          {{ actionError }}
        </p>
        <div class="modal-actions">
          <a-button :disabled="saving" @click="action = null">取消</a-button
          ><a-button type="primary" html-type="submit" :loading="saving"
            >确认</a-button
          >
        </div>
      </form></BaseModal
    >
  </section>
</template>
