<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useWorkspace, type SessionView } from "../composables/workspace";
import AppIcon from "./AppIcon.vue";

const w = useWorkspace();
const { sessions, hosts, view, closing, settingsOpened } = w;
const root = ref<HTMLElement>();
const list = ref<HTMLElement>();
const overflow = ref(false), atStart = ref(true), atEnd = ref(true);
const tabIds = computed(() => [
  ...sessions.value.map(s => s.id),
  ...(settingsOpened.value ? ["settings"] : []),
]);
const focusId = computed(() => tabIds.value.includes(view.value) ? view.value : tabIds.value[0]);
function tabElement(id: string) {
  return document.getElementById(id === "settings" ? "settings-tab" : `session-tab-${id}`);
}
function address(s: SessionView) {
  const host = hosts.value.find(h => h.id === s.hostId);
  return `${s.closed ? "已断开 · " : ""}${host ? `${host.username}@${host.address}` : s.hostName}`;
}
function measure() {
  if (!list.value || !root.value) return;
  overflow.value = list.value.scrollWidth > root.value.clientWidth + 1;
  atStart.value = list.value.scrollLeft <= 1;
  atEnd.value = list.value.scrollLeft + list.value.clientWidth >= list.value.scrollWidth - 1;
}
async function reveal() {
  await nextTick();
  list.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.closest(".connection-tab")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  measure();
}
function choose(id: string) {
  if (id === "settings") w.showSettings();
  else view.value = id;
}
async function keydown(event: KeyboardEvent, id: string) {
  if (event.key === "Delete") {
    event.preventDefault();
    if (id === "settings") await closeSettings();
    else {
      const session = sessions.value.find(s => s.id === id);
      if (session) await closeSession(session);
    }
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const ids = tabIds.value;
  const index = ids.indexOf(id);
  const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1
    : (index + (event.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length;
  const target = ids[next];
  if (!target) return;
  choose(target);
  await nextTick();
  // Terminal visibility watchers finish their autofocus in this same flush.
  await nextTick();
  tabElement(target)?.focus();
}
async function closeSession(s: SessionView) {
  const index = sessions.value.findIndex(item => item.id === s.id);
  let restoreFocus = !!root.value?.contains(document.activeElement);
  const moved = (event: FocusEvent) => {
    if (sessions.value.some(item => item.id === s.id) && !root.value?.contains(event.target as Node)) restoreFocus = false;
  };
  document.addEventListener("focusin", moved);
  try { await w.closeSession(s); }
  finally { document.removeEventListener("focusin", moved); }
  await nextTick();
  await nextTick();
  // Do not steal focus if the user moved elsewhere while disconnecting.
  if (!restoreFocus) return;
  const target = tabIds.value.includes(view.value) ? view.value : tabIds.value[Math.min(index, tabIds.value.length - 1)];
  if (target) tabElement(target)?.focus();
  else document.querySelector<HTMLButtonElement>(".application-brand")?.focus();
}
async function closeSettings() {
  const restoreFocus = !!root.value?.contains(document.activeElement);
  w.closeSettings();
  await nextTick();
  await nextTick();
  if (!restoreFocus) return;
  const target = tabIds.value.includes(view.value) ? view.value : tabIds.value[0];
  if (target) tabElement(target)?.focus();
  else document.querySelector<HTMLButtonElement>(".application-brand")?.focus();
}
function scroll(direction: number) {
  list.value?.scrollBy({ left: direction * Math.max(140, list.value.clientWidth * .75), behavior: "auto" });
}
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => { measure(); void reveal(); });
  if (root.value) observer.observe(root.value);
  void reveal();
});
onBeforeUnmount(() => observer?.disconnect());
watch(() => [view.value, ...tabIds.value], reveal);
watch(overflow, async () => { await nextTick(); measure(); });
</script>
<template>
  <div ref="root" class="connection-tabs">
    <button v-if="overflow" class="tab-scroll" aria-label="向左滚动工作区标签" :disabled="atStart" @click="scroll(-1)"><AppIcon name="left" :size="13" /></button>
    <div ref="list" class="connection-tab-list" role="tablist" aria-label="已打开的工作区" @scroll="measure">
      <div v-for="s in sessions" :key="s.id" class="connection-tab" :class="{ active: view === s.id, disconnected: s.closed }" role="presentation">
        <button :id="`session-tab-${s.id}`" class="connection-tab-select" role="tab" :aria-label="s.hostName" :aria-selected="view === s.id" :aria-controls="`session-panel-${s.id}`" :aria-description="address(s)" :tabindex="focusId === s.id ? 0 : -1" :title="`${s.hostName}\n${address(s)}`" @click="choose(s.id)" @keydown="keydown($event, s.id)">
          <i class="connection-dot" :class="{ online: !s.closed }"></i><span>{{ s.hostName }}</span>
        </button>
        <button class="connection-tab-close" :aria-label="`${s.closed ? '移除' : '关闭连接'} ${s.hostName}`" :title="s.closed ? '移除会话' : '关闭连接'" :aria-busy="closing.has(s.id)" @click="closeSession(s)"><AppIcon name="close" :size="12" /></button>
      </div>
      <div v-if="settingsOpened" class="connection-tab" :class="{ active: view === 'settings' }" role="presentation">
        <button id="settings-tab" class="connection-tab-select" role="tab" aria-label="设置" :aria-selected="view === 'settings'" aria-controls="settings-panel" :tabindex="focusId === 'settings' ? 0 : -1" title="设置" @click="choose('settings')" @keydown="keydown($event, 'settings')">
          <AppIcon name="settings" :size="14" /><span>设置</span>
        </button>
        <button class="connection-tab-close" aria-label="关闭 设置" title="关闭设置" @click="closeSettings"><AppIcon name="close" :size="12" /></button>
      </div>
    </div>
    <button v-if="overflow" class="tab-scroll" aria-label="向右滚动工作区标签" :disabled="atEnd" @click="scroll(1)"><AppIcon name="right" :size="13" /></button>
  </div>
</template>
<style scoped>
.connection-tabs { display: flex; align-items: center; flex: 1; min-width: 0; gap: 3px; height: 100%; }
.connection-tab-list { display: flex; align-items: center; gap: 2px; flex: 1; min-width: 0; height: 100%; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; }
.connection-tab-list::-webkit-scrollbar { display: none; }
.connection-tab { position: relative; display: flex; align-items: center; flex: 0 0 176px; min-width: 0; height: 34px; border: 1px solid transparent; border-radius: 6px; color: var(--subtle); transition: background .15s, color .15s; }
.connection-tab:hover { background: var(--surface); color: var(--ink); }
.connection-tab.active { color: var(--ink); background: var(--surface); border-color: var(--line); }
.connection-tab.active::after { content: ""; position: absolute; bottom: -1px; left: 12px; right: 12px; height: 2px; background: var(--accent); border-radius: 2px; pointer-events: none; }
.connection-tab-select { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; height: 100%; padding: 0 8px 0 11px; border-radius: 6px; font-size: 12px; text-align: left; }
.connection-tab-select > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-tab.active .connection-tab-select { font-weight: 500; }
.connection-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--muted); }
.connection-dot.online { background: var(--green); }
.connection-tab.disconnected .connection-tab-select > span { color: var(--muted); }
.connection-tab-close { display: grid; place-items: center; flex: 0 0 22px; width: 22px; height: 22px; margin-right: 4px; border-radius: 4px; color: var(--muted); opacity: 0; transition: opacity .15s, background .15s; }
.connection-tab:hover .connection-tab-close, .connection-tab:focus-within .connection-tab-close, .connection-tab.active .connection-tab-close { opacity: 1; }
@media (hover: none) { .connection-tab-close { opacity: 1; } }
.connection-tab-close:hover { color: var(--danger); background: var(--danger-soft); }
.connection-tab-close[aria-busy="true"] { opacity: .4; }
.tab-scroll { --icon-color: currentColor; display: grid; place-items: center; flex: 0 0 22px; width: 22px; height: 26px; border-radius: 4px; }
.tab-scroll:hover:not(:disabled) { background: var(--raised); }
.tab-scroll:disabled { opacity: .3; cursor: default; }
@media (max-width: 780px) { .connection-tab { flex-basis: 144px; } }
@media (max-width: 560px) { .connection-tab { flex-basis: 128px; } }
@media (prefers-reduced-motion: reduce) { .connection-tab { transition: none; } }
</style>
