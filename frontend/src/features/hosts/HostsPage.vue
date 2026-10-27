<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useWorkspace } from "../../composables/workspace";
import type { HostConfig } from "../../lib/types";
import { desktopAvailable } from "../../lib/api";
import AppIcon from "../../components/AppIcon.vue";
import ServerAvatar from "../../components/ServerAvatar.vue";

const HostDetailsDrawer = defineAsyncComponent(
  () => import("./HostDetailsDrawer.vue"),
);
const w = useWorkspace();
const {
  hosts,
  filtered,
  group,
  groups,
  search,
  selectedHost,
  editor,
  attempts,
  sessions,
  loading,
} = w;
const detailsOpen = ref(false);
const selected = computed(() =>
  hosts.value.find((h) => h.id === selectedHost.value),
);
const connected = (id: string) =>
  sessions.value.some((s) => s.hostId === id && !s.closed);
const menu = ref<{ host: HostConfig; x: number; y: number } | null>(null);
let menuAnchor: HTMLElement | null = null;
function showDetails(h: HostConfig) {
  selectedHost.value = h.id;
  menu.value = null;
  detailsOpen.value = true;
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
  h: HostConfig,
  event: MouseEvent,
  anchor = event.currentTarget as HTMLElement | null,
) {
  menuAnchor = anchor;
  selectedHost.value = h.id;
  menu.value = {
    host: h,
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 188)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 153)),
  };
}
function outside(e: PointerEvent) {
  if (!(e.target as HTMLElement).closest(".context-menu")) menu.value = null;
}
function escape(e: KeyboardEvent) {
  if (e.key === "Escape" && menu.value) {
    menu.value = null;
    menuAnchor?.focus();
  }
}
onMounted(() => {
  window.addEventListener("pointerdown", outside);
  window.addEventListener("keydown", escape);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", outside);
  window.removeEventListener("keydown", escape);
});
watch(
  () => w.view.value,
  () => {
    detailsOpen.value = false;
    menu.value = null;
  },
);
function action(kind: "edit" | "duplicate" | "delete") {
  const h = menu.value?.host;
  menu.value = null;
  if (!h) return;
  if (kind === "edit") editor.value = h;
  else if (kind === "duplicate") void w.duplicate(h);
  else void w.removeHost(h).catch(w.fail);
}
function connectFromDetails(host: HostConfig) {
  detailsOpen.value = false;
  openTerminal(host);
}
function editFromDetails(host: HostConfig) {
  detailsOpen.value = false;
  editor.value = host;
}
</script>
<template>
  <section class="hosts-page" aria-label="服务器">
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
          :class="{ selected: (detailsOpen || menu) && selectedHost === h.id }"
          role="group"
          :aria-label="`服务器 ${h.name}`"
          aria-description="双击或按 Enter 打开终端"
          tabindex="0"
          @dblclick="openTerminal(h, $event)"
          @keydown="cardKey(h, $event)"
          @contextmenu.prevent="showMenu(h, $event)"
        >
          <ServerAvatar :system="h.remoteSystem">
            <i
              class="host-state"
              :class="{ online: connected(h.id), pending: attempts.has(h.id) }"
              :title="attempts.has(h.id) ? '连接中' : connected(h.id) ? '已连接' : '未连接'"
              :aria-label="attempts.has(h.id) ? '连接中' : connected(h.id) ? '已连接' : '未连接'"
            ></i>
          </ServerAvatar>
          <div class="host-card-identity">
            <h2 :title="h.name">{{ h.name }}</h2>
            <p :title="[h.remoteSystem?.name, h.remoteSystem?.version, h.group].filter(Boolean).join(' · ')">
              SSH · {{ h.username }}
            </p>
            <div class="host-card-address" :title="`${h.address}:${h.port}`">
              {{ h.address }}<span>:{{ h.port }}</span>
            </div>
          </div>
          <div class="host-card-actions" @dblclick.stop>
            <a-button
              type="text"
              class="host-card-more"
              :aria-label="`更多操作 ${h.name}`"
              @click.stop="showMenu(h, $event)"
              ><AppIcon name="more" :size="18"
            /></a-button>
            <a-button
              v-if="attempts.has(h.id)"
              class="host-card-cancel"
              size="small"
              :aria-label="`取消连接 ${h.name}`"
              @click.stop="w.cancelConnection(h.id)"
              >取消连接</a-button
            >
            <a-button
              type="text"
              size="small"
              aria-haspopup="dialog"
              :aria-label="`查看详情 ${h.name}`"
              @click.stop="showDetails(h)"
              >查看详情<AppIcon name="right" :size="12" /></a-button
            >
          </div>
        </article>
      </div>
    </div>
    <div v-if="filtered.length" class="hosts-footnote">
      共 {{ filtered.length }} 台服务器<span>双击卡片打开终端 · 查看详情 · 右键管理</span>
    </div>
  </section>
  <HostDetailsDrawer
    v-if="detailsOpen && selected"
    :host="selected"
    @close="detailsOpen = false"
    @connect="connectFromDetails(selected)"
    @edit="editFromDetails(selected)"
  />
  <Teleport to="body">
    <div
      v-if="menu"
      class="context-menu"
      role="menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
    >
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
    </div>
  </Teleport>
</template>
