<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import AppIcon from "../../components/AppIcon.vue";
export type FileMenuAction = "mkdir" | "create" | "rename" | "delete" | "transfer" | "list" | "icons" | "refresh";
const props = defineProps<{
  x: number; y: number; title: string; path: string; mode: "list" | "icons";
  canMutate: boolean; canRename: boolean; canDelete: boolean; canTransfer: boolean;
  transferAction: "upload" | "download";
}>();
const emit = defineEmits<{ action: [action: FileMenuAction]; close: [restoreFocus: boolean] }>();
const root = ref<HTMLElement>(), left = ref(props.x), top = ref(props.y);
function outside(event: Event) {
  if (!root.value?.contains(event.target as Node)) emit("close", false);
}
function dismiss() { emit("close", false); }
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); emit("close", true); return; }
  if (event.key === "Tab") { emit("close", false); return; }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = [...(root.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
  items[next]?.focus();
}
onMounted(async () => {
  await nextTick();
  if (!root.value) return;
  const bounds = root.value.getBoundingClientRect();
  if (bounds) {
    left.value = Math.max(8, Math.min(props.x, window.innerWidth - bounds.width - 8));
    top.value = Math.max(8, Math.min(props.y, window.innerHeight - bounds.height - 8));
  }
  root.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  window.addEventListener("pointerdown", outside);
  window.addEventListener("resize", dismiss);
  document.addEventListener("scroll", outside, true);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", outside);
  window.removeEventListener("resize", dismiss);
  document.removeEventListener("scroll", outside, true);
});
</script>
<template>
  <Teleport to="body">
    <div ref="root" class="context-menu file-context-menu" role="menu" :aria-label="`${title}操作`" :style="{ left: left + 'px', top: top + 'px' }" @keydown="keydown" @contextmenu.prevent>
      <div class="file-menu-path" :title="path">{{ path }}</div>
      <button role="menuitem" :disabled="!canMutate" @click="emit('action', 'mkdir')"><AppIcon name="folder" :size="16" />新建目录</button>
      <button role="menuitem" :disabled="!canMutate" @click="emit('action', 'create')"><AppIcon name="file" :size="16" />新建文件</button>
      <div class="menu-divider" role="separator"></div>
      <button role="menuitemradio" :aria-checked="mode === 'list'" @click="emit('action', 'list')"><AppIcon name="list" :size="16" />列表展示<AppIcon v-if="mode === 'list'" class="file-menu-check" name="check" :size="14" /></button>
      <button role="menuitemradio" :aria-checked="mode === 'icons'" @click="emit('action', 'icons')"><AppIcon name="apps" :size="16" />图标展示<AppIcon v-if="mode === 'icons'" class="file-menu-check" name="check" :size="14" /></button>
      <button role="menuitem" :disabled="!canMutate" @click="emit('action', 'refresh')"><AppIcon name="refresh" :size="16" />刷新</button>
      <div class="menu-divider" role="separator"></div>
      <button role="menuitem" :disabled="!canTransfer" @click="emit('action', 'transfer')"><AppIcon :name="transferAction" :size="16" />{{ transferAction === 'upload' ? '上传所选' : '下载所选' }}</button>
      <button role="menuitem" :disabled="!canRename" @click="emit('action', 'rename')"><AppIcon name="edit" :size="16" />重命名</button>
      <button role="menuitem" class="danger" :disabled="!canDelete" @click="emit('action', 'delete')"><AppIcon name="delete" :size="16" />删除</button>
    </div>
  </Teleport>
</template>
<style scoped>
.file-context-menu { width: 210px; max-width: calc(100vw - 16px); }
.file-menu-path { padding: 7px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 10px; }
.file-menu-check { margin-left: auto; }
.file-context-menu button { --icon-color: currentColor; color: var(--subtle); }
.file-context-menu button:focus-visible { outline: none; background: var(--accent-soft); color: var(--accent); }
.file-context-menu button:disabled { color: var(--muted); opacity: .5; cursor: default; background: transparent; }
.file-context-menu button.danger:not(:disabled) { color: var(--danger); }
</style>
