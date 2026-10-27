<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { desktopAvailable } from "../lib/api";
import type { MenuAction } from "../lib/menu";

const props = defineProps<{ canClose: boolean }>();
const emit = defineEmits<{ action: [action: MenuAction] }>();
const root = ref<HTMLElement>();
const opened = ref(-1);
const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
interface MenuItem { label: string; action: MenuAction; shortcut?: string; disabled?: boolean }
const menus = computed<{ label: string; items: MenuItem[] }[]>(() => [
  { label: "文件", items: [
    { label: "添加服务器…", action: "new", shortcut: `${modifier}N`, disabled: !desktopAvailable },
    { label: "关闭当前工作区", action: "close", disabled: !props.canClose },
  ] },
  { label: "查看", items: [
    { label: "服务器", action: "hosts" },
    { label: "搜索资源与操作…", action: "search", shortcut: `${modifier}K` },
    { label: "传输队列", action: "transfers" },
    { label: "设置…", action: "settings", shortcut: `${modifier},` },
  ] },
]);
function trigger(index: number) {
  return root.value?.querySelectorAll<HTMLButtonElement>(".menu-trigger")[index];
}
function close(restore = false) {
  const index = opened.value;
  opened.value = -1;
  if (restore) trigger(index)?.focus();
}
function choose(action: string) {
  close(true);
  emit("action", action as MenuAction);
}
function focusItem(last = false) {
  requestAnimationFrame(() => {
    const items = root.value?.querySelectorAll<HTMLButtonElement>(".application-menu-item:not(:disabled)");
    items?.[last ? items.length - 1 : 0]?.focus();
  });
}
function keydown(event: KeyboardEvent, index: number) {
  const onTrigger = (event.target as HTMLElement).classList.contains("menu-trigger");
  const items = [...(root.value?.querySelectorAll<HTMLButtonElement>(".application-menu-item:not(:disabled)") || [])];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === "Escape") { event.preventDefault(); close(true); }
  else if (event.key === "Tab") close();
  else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    const next = (index + (event.key === "ArrowRight" ? 1 : menus.value.length - 1)) % menus.value.length;
    trigger(next)?.focus();
    if (opened.value !== -1) { opened.value = next; focusItem(); }
  } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (onTrigger) { opened.value = index; focusItem(event.key === "ArrowUp" || event.key === "End"); }
    else if (items.length) {
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    }
  }
}
function outside(event: Event) {
  if (!root.value?.contains(event.target as Node)) close();
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
});
</script>

<template>
  <nav ref="root" class="application-menubar" role="menubar" aria-label="应用菜单">
    <div v-for="(menu, index) in menus" :key="menu.label" class="application-menu" @keydown="keydown($event, index)">
      <button :id="`app-menu-trigger-${index}`" class="menu-trigger" role="menuitem" aria-haspopup="menu"
        :aria-expanded="opened === index" :aria-controls="opened === index ? `app-menu-${index}` : undefined"
        @click="opened = opened === index ? -1 : index"
        @pointerenter="opened !== -1 && (opened = index)">{{ menu.label }}</button>
      <div v-if="opened === index" :id="`app-menu-${index}`" class="application-menu-popup" role="menu" :aria-labelledby="`app-menu-trigger-${index}`">
        <button v-for="item in menu.items" :key="item.action" class="application-menu-item" role="menuitem"
          :aria-label="item.label" :disabled="item.disabled" @click="choose(item.action)">
          <span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </div>
    </div>
  </nav>
</template>
