<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
} from "vue";
import { createWorkspace, workspaceKey } from "./composables/workspace";
import AppIcon from "./components/AppIcon.vue";
import AppLogo from "./components/AppLogo.vue";
import ApplicationMenu from "./components/ApplicationMenu.vue";
import SessionTabs from "./components/SessionTabs.vue";
import WorkspaceNavigation from "./components/WorkspaceNavigation.vue";
import { desktopAvailable } from "./lib/api";
import type { MenuAction } from "./lib/menu";
import HostsPage from "./features/hosts/HostsPage.vue";
import { formatBytes } from "./lib/format";
const HostEditor = defineAsyncComponent(
  () => import("./features/hosts/HostEditor.vue"),
);
const PasswordDialog = defineAsyncComponent(
  () => import("./features/hosts/PasswordDialog.vue"),
);
const SettingsPage = defineAsyncComponent(
  () => import("./features/settings/SettingsPage.vue"),
);
const LocalForwards = defineAsyncComponent(
  () => import("./features/sessions/LocalForwards.vue"),
);
const TransferQueue = defineAsyncComponent(
  () => import("./features/transfers/TransferQueue.vue"),
);
const CommandPalette = defineAsyncComponent(
  () => import("./features/workbench/CommandPalette.vue"),
);
const TerminalPane = defineAsyncComponent(
  () => import("./features/terminal/TerminalPane.vue"),
);
const FileWorkspace = defineAsyncComponent(
  () => import("./features/files/FileWorkspace.vue"),
);
const ServerMonitor = defineAsyncComponent(
  () => import("./features/monitor/ServerMonitor.vue"),
);
const w = createWorkspace();
provide(workspaceKey, w);
const {
  hosts,
  sessions,
  view,
  settingsOpened,
  error,
  editor,
  group,
  paletteOpen,
  transfersOpen,
  forwardID,
  attempts,
  resource,
  authPrompt,
  highlight,
  activeTransfers,
} = w;
const forward = computed(() =>
  sessions.value.find((s) => s.id === forwardID.value),
);
const connected = computed(() => sessions.value.filter((s) => !s.closed));
const aggregate = computed(() => {
  const all = activeTransfers.value,
    total = all.reduce((n, t) => n + t.bytesTotal, 0),
    done = all.reduce((n, t) => n + t.bytesDone, 0);
  return total
    ? Math.min(100, Math.floor((done / total) * 100)) + "%"
    : "准备中";
});
async function saved() {
  editor.value = null;
  try {
    await w.reloadHosts();
  } catch (e) {
    w.fail(e);
  }
}
function submitAuth(secret: string) {
  const prompt = authPrompt.value;
  authPrompt.value = null;
  error.value = "";
  void prompt?.submit(secret).catch(w.fail);
}
const nativeMenu = ref(false);
let stopMenu: (() => void) | undefined;
function menuAction(action: MenuAction) {
  // Menu commands must not open another tool behind a modal or a details drawer.
  if (document.querySelector('[role="dialog"]')) return;
  switch (action) {
    case "new": if (desktopAvailable) editor.value = "new"; break;
    case "hosts": view.value = "hosts"; group.value = null; break;
    case "settings": w.showSettings(); break;
    case "search": paletteOpen.value = true; break;
    case "transfers": transfersOpen.value = true; break;
    case "close":
      if (view.value === "settings") {
        settingsOpened.value = false;
        view.value = "hosts";
      } else if (w.active.value) void w.closeSession(w.active.value);
      break;
  }
}
function keyboard(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const action = ({ n: "new", k: "search", ",": "settings" } as const)[
    e.key.toLowerCase() as "n" | "k" | ","
  ];
  // Native accelerators own these shortcuts on macOS; this listener is the fallback.
  if (action && !nativeMenu.value) {
    e.preventDefault();
    menuAction(action);
  }
}
onMounted(async () => {
  window.addEventListener("keydown", keyboard);
  stopMenu = window.runtime?.EventsOn("app:menu", (action) => menuAction(action as MenuAction));
  try {
    nativeMenu.value = (await window.runtime?.Environment?.())?.platform === "darwin";
  } catch { /* Keep window menus available if platform detection fails. */ }
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", keyboard);
  stopMenu?.();
});
</script>
<template>
  <div class="ssh-app">
    <div class="app-main">
      <header class="topbar">
        <div class="application-navigation">
          <button class="application-brand" aria-label="服务器" title="返回服务器" @click="menuAction('hosts')">
            <AppLogo /><strong>ssh-go</strong>
          </button>
          <ApplicationMenu v-if="!nativeMenu" :can-close="view !== 'hosts'" @action="menuAction" />
        </div>
        <SessionTabs v-if="sessions.length" />
        <div class="topbar-actions">
          <button class="command-trigger" aria-label="搜索资源与操作" :title="`搜索资源与操作 (${w.shortcutModifier} K)`" @click="paletteOpen = true">
            <AppIcon name="search" :size="16" />
          </button>
          <button class="servers-entry" aria-label="返回服务器" title="服务器列表" :aria-current="view === 'hosts' ? 'page' : undefined" @click="view = 'hosts'">
            <AppIcon name="server" :size="16" /><span>服务器</span>
          </button>
        </div>
      </header>
      <WorkspaceNavigation v-if="sessions.length || settingsOpened" v-show="view !== 'hosts'" />
      <div v-if="error" class="global-error" role="alert">
        <AppIcon name="info" :size="17" /><span>{{ error }}</span
        ><button
          class="icon-button"
          aria-label="关闭错误提示"
          @click="error = ''"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </div>
      <main class="workspace-main">
        <div v-show="view === 'hosts'" class="hosts-workspace">
          <HostsPage />
        </div>
        <section
          v-for="s in sessions"
          v-show="view === s.id"
          :key="s.id"
          class="session-workspace"
          :id="`session-panel-${s.id}`"
          role="tabpanel"
          :aria-labelledby="`session-tab-${s.id}`"
          :data-session-id="s.id"
        >
          <div class="session-content">
            <div v-show="s.workspace === 'terminal'" class="terminal-slot">
              <TerminalPane
                :key="s.id + '-' + s.generation"
                :session-id="s.id"
                :connected="!s.closed && !s.terminalClosed"
                :visible="view === s.id && s.workspace === 'terminal'"
                :highlight="highlight"
                :appearance-open="s.appearanceOpen && view === s.id"
                @update:highlight="w.setHighlight"
                @close-appearance="s.appearanceOpen = false"
                @ready="w.terminalReady(s)"
                @closed="
                  s.terminalClosed = true;
                  s.operation = $event || '终端已关闭';
                "
                @operation="s.operation = $event"
              />
            </div>
            <div
              v-if="s.filesOpened"
              v-show="s.workspace === 'files' || (s.workspace === 'terminal' && s.filesDocked)"
              class="files-slot"
              :class="{ 'is-docked': s.workspace === 'terminal' }"
            >
              <FileWorkspace
                :session-id="s.id"
                :closed="s.closed"
                :visible="view === s.id && (s.workspace === 'files' || (s.workspace === 'terminal' && s.filesDocked))"
                :compact="s.workspace === 'terminal'"
                @expand="w.selectWorkspace(s, 'files')"
                @close="s.filesDocked = false"
              />
            </div>
            <ServerMonitor
              v-if="s.monitorOpened"
              v-show="s.workspace === 'monitor'"
              :session-id="s.id"
              :host-name="s.hostName"
              :system="hosts.find((h) => h.id === s.hostId)?.remoteSystem"
              :closed="s.closed"
              :visible="view === s.id && s.workspace === 'monitor'"
            />
          </div>
        </section>
        <SettingsPage v-if="view === 'settings'" />
      </main>
      <footer class="statusbar">
        <span class="status-product">ssh-go <small>0.1.0</small></span>
        <span class="connection-count"
          ><i :class="{ online: connected.length > 0 }"></i
          >{{
            connected.length ? `${connected.length} 个连接` : "未连接"
          }}</span
        ><span
          class="current-operation"
          :title="w.active.value?.operation || '就绪'"
          >{{
            attempts.size
              ? "正在连接服务器…"
              : w.active.value?.operation || "就绪"
          }}</span
        ><button
          aria-label="传输队列"
          :aria-expanded="transfersOpen"
          class="status-transfers"
          :class="{ running: activeTransfers.length > 0 }"
          @click="transfersOpen = !transfersOpen"
        >
          <AppIcon name="swap" :size="14" />{{
            activeTransfers.length
              ? `${activeTransfers.length} 个传输 · ${aggregate}`
              : "传输队列空闲"
          }}
        </button>
        <div
          class="resource-usage"
          :title="resource?.scope || '桌面应用启动后显示进程资源占用'"
        >
          <span
            >CPU
            {{
              typeof resource?.cpuPercent === "number"
                ? resource.cpuPercent.toFixed(1) + "%"
                : "—"
            }}</span
          ><span
            >内存 {{ resource ? formatBytes(resource.memoryBytes) : "—" }}</span
          >
        </div>
      </footer>
    </div>
    <HostEditor
      v-if="editor"
      :host="editor === 'new' ? undefined : editor"
      :hosts="hosts"
      @close="editor = null"
      @saved="saved"
    />
    <PasswordDialog
      v-if="authPrompt"
      :host="authPrompt.host"
      @close="authPrompt = null"
      @submit="submitAuth"
    />
    <LocalForwards
      v-if="forward"
      :session-id="forward.id"
      :host-name="forward.hostName"
      :closed="forward.closed"
      @close="forwardID = null"
    />
    <TransferQueue v-if="transfersOpen" @close="transfersOpen = false" />
    <CommandPalette v-if="paletteOpen" @close="paletteOpen = false" />
  </div>
</template>
