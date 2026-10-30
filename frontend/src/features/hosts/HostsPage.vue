<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useWorkspace } from "../../composables/workspace";
import type { HostConfig } from "../../lib/types";
import { desktopAvailable } from "../../lib/api";
import AppIcon from "../../components/AppIcon.vue";
import ServerAvatar from "../../components/ServerAvatar.vue";

const w = useWorkspace();
const {
  hosts,
  filtered,
  group,
  groups,
  search,
  editor,
  attempts,
  sessions,
  loading,
} = w;
const connected = (id: string) =>
  sessions.value.some((s) => s.hostId === id && !s.closed);
const menu = ref<{ host: HostConfig | null; x: number; y: number } | null>(null);
const menuRoot = ref<HTMLElement>();
let menuAnchor: HTMLElement | null = null;
const duplicating = ref(new Set<string>());
async function duplicateHost(h: HostConfig) {
  if (duplicating.value.has(h.id)) return;
  duplicating.value.add(h.id);
  try {
    await w.duplicate(h);
  } finally {
    duplicating.value.delete(h.id);
  }
}
function editHost(h: HostConfig) {
  menu.value = null;
  w.openHostSettings(h);
}
function openTerminal(h: HostConfig, event?: MouseEvent) {
  if (event?.target instanceof Element && event.target.closest("button")) return;
  menu.value = null;
  const existing = sessions.value.find(s => s.hostId === h.id && !s.closed);
  if (existing) w.selectWorkspace(existing, "terminal");
  else void w.connect(h);
}
function cardKey(h: HostConfig, event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  if (event.key === " ") {
    event.preventDefault();
    menu.value = null;
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    if (!event.repeat) openTerminal(h);
    return;
  }
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    const element = event.currentTarget as HTMLElement,
      rect = element.getBoundingClientRect();
    showMenu(
      h,
      new MouseEvent("contextmenu", {
        clientX: rect.left + 45,
        clientY: rect.top + 30,
      }),
      element,
    );
  }
}
function showMenu(
  h: HostConfig | null,
  event: MouseEvent,
  anchor = event.currentTarget as HTMLElement | null,
) {
  menuAnchor = anchor;
  menu.value = {
    host: h,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 188)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 153)),
  };
  void nextTick(() => menuRoot.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true }));
}
function pageMenu(event: MouseEvent) {
  if ((event.target as Element).closest("input,select,textarea,button,a,[contenteditable='true']")) {
    menu.value = null;
    return;
  }
  event.preventDefault();
  showMenu(null, event);
}
function pageKey(event: KeyboardEvent) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
  event.preventDefault();
  const element = event.currentTarget as HTMLElement;
  const rect = element.getBoundingClientRect();
  showMenu(null, new MouseEvent("contextmenu", { clientX: rect.left + 28, clientY: rect.top + 28 }), element);
}
function menuKey(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = [...(menuRoot.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
    : (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
  items[next]?.focus();
}
function outside(e: Event) {
  if (!(e.target as HTMLElement).closest(".context-menu")) menu.value = null;
}
function escape(e: KeyboardEvent) {
  if (e.key === "Escape" && menu.value) {
    e.preventDefault();
    menu.value = null;
    menuAnchor?.focus();
  }
}
onMounted(() => {
  window.addEventListener("pointerdown", outside);
  window.addEventListener("focusin", outside);
  window.addEventListener("keydown", escape);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", outside);
  window.removeEventListener("focusin", outside);
  window.removeEventListener("keydown", escape);
});
watch(
  () => w.view.value,
  () => {
    menu.value = null;
  },
);
function action(kind: "edit" | "duplicate" | "delete") {
  const h = menu.value?.host;
  menu.value = null;
  if (!h) return;
  if (kind === "edit") w.openHostSettings(h);
  else if (kind === "duplicate") void duplicateHost(h);
  else void w.removeHost(h).catch(w.fail);
}
function pageAction(kind: "new" | "refresh" | "clear") {
  menu.value = null;
  if (kind === "new" && desktopAvailable) editor.value = "new";
  else if (kind === "refresh") void w.reloadHosts().catch(w.fail);
  else if (kind === "clear") {
    search.value = "";
    group.value = null;
  }
}
</script>
<template>
  <section class="hosts-page" aria-label="服务器" tabindex="-1" @contextmenu="pageMenu" @keydown="pageKey">
    <div v-if="!desktopAvailable" class="preview-note">
      <AppIcon name="info" :size="16" />当前为页面预览。启动 ssh-go
      桌面应用后即可管理服务器与连接 SSH。
    </div>
    <div class="hosts-toolbar">
      <div class="hosts-view-label">
        <h1>服务器</h1><span>{{ filtered.length }}</span>
      </div>
      <select v-model="group" class="group-filter" aria-label="服务器分组">
        <option :value="null">全部分组</option>
        <option v-for="g in groups" :key="g" :value="g">{{ g || "未分组" }}</option>
      </select>
      <div class="search-field">
        <AppIcon name="search" :size="16" /><input
          v-model="search"
          aria-label="搜索服务器"
          placeholder="搜索名称、地址或用户名"
        />
      </div>
      <a-button
        type="text"
        aria-label="刷新服务器列表"
        :loading="loading"
        @click="w.reloadHosts().catch(w.fail)"
        ><AppIcon name="refresh" :size="17"
      /></a-button>
      <a-button
        type="primary"
        :disabled="!desktopAvailable"
        @click="editor = 'new'"
      >
        <template #icon><AppIcon name="plus" :size="16" /></template>添加服务器
      </a-button>
    </div>
    <div class="hosts-list">
      <div
        v-if="loading && !hosts.length"
        class="host-grid host-grid-loading"
        aria-label="正在加载服务器"
      >
        <div v-for="n in 6" :key="n" class="host-card-skeleton">
          <span></span><span></span><span></span>
        </div>
      </div>
      <div v-else-if="!filtered.length" class="empty-state hosts-empty">
        <div class="empty-symbol"><AppIcon name="server" :size="34" /></div>
        <h2>{{ hosts.length ? "没有找到匹配的服务器" : "添加第一台服务器" }}</h2>
        <p>
          {{
            hosts.length
              ? "试试其他名称、地址或分组。"
              : "保存地址和账号，即可打开终端与 SFTP 文件。"
          }}
        </p>
        <a-button
          v-if="!hosts.length"
          type="primary"
          :disabled="!desktopAvailable"
          @click="editor = 'new'"
          ><template #icon><AppIcon name="plus" :size="15" /></template
          >新建连接</a-button
        >
        <a-button
          v-else
          @click="
            search = '';
            group = null;
          "
          >清除筛选</a-button
        >
      </div>
      <div v-else class="host-grid" aria-label="服务器卡片">
        <article
          v-for="h in filtered"
          :key="h.id"
          class="host-card"
          role="group"
          :aria-label="`服务器 ${h.name}`"
          aria-description="双击或按 Enter 打开终端，悬浮按钮或右键管理连接"
          tabindex="0"
          @dblclick="openTerminal(h, $event)"
          @keydown="cardKey(h, $event)"
          @contextmenu.stop.prevent="showMenu(h, $event)"
        >
          <ServerAvatar :system="h.remoteSystem">
            <i
              class="host-state"
              :class="{ online: connected(h.id), pending: attempts.has(h.id), 'activity-pending': attempts.has(h.id) && w.view.value === 'hosts' }"
              :title="attempts.has(h.id) ? '连接中' : connected(h.id) ? '已连接' : '未连接'"
              :aria-label="attempts.has(h.id) ? '连接中' : connected(h.id) ? '已连接' : '未连接'"
            ></i>
          </ServerAvatar>
          <div class="host-card-identity">
            <h2 :title="h.name">{{ h.name }}</h2>
            <div class="host-card-address" :title="`${h.address}:${h.port}`">
              {{ h.address }}<span>:{{ h.port }}</span>
            </div>
          </div>
          <div class="host-card-quick-actions" @click.stop @dblclick.stop>
            <button type="button" class="icon-button host-card-quick-action" :aria-label="`编辑连接 ${h.name}`" title="编辑连接" @click="editHost(h)">
              <AppIcon name="edit" :size="14" />
            </button>
            <button type="button" class="icon-button host-card-quick-action" :aria-label="`复制连接 ${h.name}`" title="复制连接"
              :disabled="duplicating.has(h.id)" :aria-busy="duplicating.has(h.id)" @click="duplicateHost(h)">
              <AppIcon name="copy" :size="14" />
            </button>
          </div>
          <div v-if="attempts.has(h.id)" class="host-card-actions" @dblclick.stop>
            <a-button
              class="host-card-cancel"
              size="small"
              :aria-label="`取消连接 ${h.name}`"
              @click.stop="w.cancelConnection(h.id)"
              >取消连接</a-button
            >
          </div>
        </article>
      </div>
    </div>
    <div v-if="filtered.length" class="hosts-footnote">
      共 {{ filtered.length }} 台服务器<span>悬浮编辑或复制 · 双击打开终端 · 右键管理</span>
    </div>
  </section>
  <Teleport to="body">
    <div
      v-if="menu"
      ref="menuRoot"
      class="context-menu"
      role="menu"
      :aria-label="menu.host ? '服务器操作' : '服务器列表操作'"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @keydown="menuKey"
    >
      <template v-if="menu.host">
      <button role="menuitem" @click="action('edit')">
        <AppIcon name="edit" :size="16" />编辑连接
      </button>
      <button role="menuitem" @click="action('duplicate')">
        <AppIcon name="copy" :size="16" />复制连接
      </button>
      <div class="menu-divider"></div>
      <button role="menuitem" class="danger" @click="action('delete')">
        <AppIcon name="delete" :size="16" />删除服务器
      </button>
      </template>
      <template v-else>
        <button role="menuitem" :disabled="!desktopAvailable" @click="pageAction('new')">
          <AppIcon name="plus" :size="16" />添加服务器
        </button>
        <button role="menuitem" :disabled="loading" @click="pageAction('refresh')">
          <AppIcon name="refresh" :size="16" />刷新服务器列表
        </button>
        <div class="menu-divider"></div>
        <button role="menuitem" :disabled="group === null && !search" @click="pageAction('clear')">
          <AppIcon name="close" :size="16" />清除筛选
        </button>
      </template>
    </div>
  </Teleport>
</template>
