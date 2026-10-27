<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
} from "vue";
import ADrawer from "@arco-design/web-vue/es/drawer";
import "@arco-design/web-vue/es/drawer/style/css.js";
import AppIcon from "../../components/AppIcon.vue";
import ServerAvatar from "../../components/ServerAvatar.vue";
import { containModalFocus } from "../../composables/modalFocus";
import { useWorkspace } from "../../composables/workspace";
import type { HostConfig } from "../../lib/types";

const props = defineProps<{ host: HostConfig }>();
defineEmits<{ close: []; connect: []; edit: [] }>();
const w = useWorkspace();
const open = ref(true),
  id = useId();
const pending = computed(() => w.attempts.has(props.host.id));
const connected = computed(() =>
  w.sessions.value.some((s) => s.hostId === props.host.id && !s.closed),
);
const method = computed(() =>
  props.host.authMethod === "privateKey"
    ? "SSH 私钥"
    : props.host.authMethod === "agent"
      ? "SSH Agent"
      : "账号密码",
);
const jumpHost = computed(
  () =>
    w.hosts.value.find((h) => h.id === props.host.jumpHostId)?.name ||
    "直接连接",
);
let stop: (() => void) | undefined,
  alive = true;
onMounted(async () => {
  await nextTick();
  const element = document.getElementById(id);
  if (alive && element) stop = containModalFocus(element);
});
onBeforeUnmount(() => {
  alive = false;
  stop?.();
});
</script>
<template>
  <a-drawer
    :id="id"
    class="host-details-drawer"
    :visible="open"
    placement="right"
    width="min(420px, 100vw)"
    :closable="false"
    role="dialog"
    aria-label="连接详情"
    aria-modal="true"
    tabindex="-1"
    @cancel="open = false"
    @close="$emit('close')"
  >
    <template #header>
      <div class="host-drawer-heading">
        <span>连接详情</span
        ><button
          class="icon-button"
          aria-label="关闭连接详情"
          @click="open = false"
        >
          <AppIcon name="close" :size="20" />
        </button>
      </div>
    </template>
    <div class="host-drawer-identity">
      <ServerAvatar :system="host.remoteSystem" large />
      <h2>{{ host.name }}</h2>
      <span class="connection-status" :class="{ online: connected, pending }"
        ><i></i>{{ pending ? "连接中" : connected ? "已连接" : "未连接" }}</span
      >
    </div>
    <dl class="host-details-fields">
      <dt>主机地址</dt>
      <dd class="host-details-address">{{ host.address }}:{{ host.port }}</dd>
      <dt>登录用户</dt>
      <dd>{{ host.username }}</dd>
      <dt>认证方式</dt>
      <dd>{{ method }}</dd>
      <dt>所属分组</dt>
      <dd>{{ host.group || "未分组" }}</dd>
      <dt>跳板机</dt>
      <dd>{{ jumpHost }}</dd>
      <template v-if="host.remoteSystem?.name"
        ><dt>操作系统</dt>
        <dd>
          {{ host.remoteSystem.name }} {{ host.remoteSystem.version }}
        </dd></template
      >
    </dl>
    <p class="host-drawer-note">
      <AppIcon name="safe" :size="17" /><span
        >SSH 加密连接<br />文件使用 SFTP 协议传输</span
      >
    </p>
    <template #footer>
      <div class="host-drawer-actions">
        <a-button @click="$emit('edit')"
          ><template #icon><AppIcon name="edit" :size="16" /></template
          >编辑连接</a-button
        >
        <a-button v-if="pending" @click="w.cancelConnection(host.id)"
          >取消连接</a-button
        >
        <a-button v-else type="primary" @click="$emit('connect')"
          ><template #icon><AppIcon name="terminal" :size="16" /></template
          >打开终端</a-button
        >
      </div>
    </template>
  </a-drawer>
</template>
