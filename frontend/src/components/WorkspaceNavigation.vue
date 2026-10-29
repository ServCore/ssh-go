<script setup lang="ts">
import { useWorkspace } from "../composables/workspace";
import AppIcon from "./AppIcon.vue";

const w = useWorkspace();
const { hosts, active } = w;
const address = () => {
  const host = hosts.value.find(h => h.id === active.value?.hostId);
  return host ? `${host.username}@${host.address}` : active.value?.hostName;
};
</script>

<template>
  <header class="workspace-navigation" aria-label="工作区导航">
    <div v-if="active" class="workspace-mode-tabs" role="group" aria-label="会话工具">
      <button :class="{ active: active.workspace === 'terminal' }" :aria-pressed="active.workspace === 'terminal'" @click="w.selectWorkspace(active, 'terminal')"><AppIcon name="terminal" :size="17" />终端</button>
      <button :class="{ active: active.workspace === 'files' }" :aria-pressed="active.workspace === 'files'" @click="w.selectWorkspace(active, 'files')"><AppIcon name="folder" :size="17" />SFTP</button>
      <button :class="{ active: active.workspace === 'monitor' }" :aria-pressed="active.workspace === 'monitor'" @click="w.selectWorkspace(active, 'monitor')"><AppIcon name="monitor" :size="17" />监控</button>
    </div>
    <div v-if="active" class="workspace-connection" :title="address()"><i class="session-dot" :class="{ online: !active.closed }"></i><span>{{ active.closed ? '已断开' : address() }}</span></div>
    <div v-if="active" class="workspace-actions">
      <div id="workspace-monitor-controls" v-show="active?.workspace === 'monitor'"></div>
      <template v-if="active">
        <a-button v-if="active.workspace === 'terminal'" size="small" type="text" aria-label="终端配色" :aria-pressed="active.appearanceOpen" @click="active.appearanceOpen = !active.appearanceOpen"><template #icon><AppIcon name="settings" :size="15" /></template><span class="action-label">配色</span></a-button>
      </template>
    </div>
  </header>
</template>

<style scoped>
.workspace-navigation { position: relative; z-index: 10; display: flex; align-items: center; gap: 20px; flex: 0 0 auto; min-height: 50px; padding: 8px 18px; border-bottom: 1px solid var(--line); background: var(--surface); min-width: 0; }
.session-dot { display: inline-block; width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--muted); }
.session-dot.online { background: var(--green); }
.workspace-mode-tabs { display: flex; gap: 3px; flex-shrink: 0; }
.workspace-mode-tabs > button { --icon-color: currentColor; display: flex; align-items: center; justify-content: center; gap: 6px; height: var(--control-height); padding: 0 12px; color: var(--subtle); font-size: 12px; border-radius: var(--control-radius); transition: background .15s, color .15s; }
.workspace-mode-tabs > button.active { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
.workspace-mode-tabs > button:hover:not(.active) { color: var(--ink); background: var(--hover); }
.workspace-mode-tabs > button:active { background: var(--accent-soft); color: var(--accent); }
.workspace-connection { display: flex; align-items: center; gap: 7px; min-width: 0; max-width: 240px; border-left: 1px solid var(--line); padding-left: 20px; color: var(--muted); font: 11px Menlo, Monaco, monospace; }
.workspace-connection > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.workspace-actions { margin-left: auto; display: flex; align-items: center; gap: 3px; flex-shrink: 0; }
.workspace-actions :deep(.arco-btn) { --icon-color: currentColor; height: var(--control-compact); border-radius: var(--control-radius); font-size: 12px; padding: 0 8px; }
.workspace-actions :deep(.arco-btn-text:not(:disabled)) { color: var(--subtle); }
.workspace-actions :deep(.arco-btn-text:not(:disabled):hover) { color: var(--accent); background: var(--hover); }
.workspace-actions :deep(.arco-btn-text[aria-pressed="true"]:not(:disabled)), .workspace-actions :deep(.arco-btn-text:not(:disabled):active) { color: var(--accent); background: var(--accent-soft); }
@media (max-width: 1100px) { .workspace-navigation { gap: 12px; padding: 10px 14px; } .workspace-connection { padding-left: 12px; } }
@media (max-width: 780px) { .workspace-navigation { gap: 8px; } .workspace-connection { display: none; } .workspace-mode-tabs { gap: 1px; } .workspace-mode-tabs > button { padding: 0 8px; } .workspace-actions .action-label { display: none; } .workspace-actions :deep(.arco-btn) { padding: 0 6px; } }
@media (max-width: 400px) { .workspace-navigation { flex-wrap: wrap; gap: 8px; padding: 9px 12px; } .workspace-actions { margin-left: auto; } }
@media (prefers-reduced-motion: reduce) { .workspace-mode-tabs > button { transition: none; } }
</style>
