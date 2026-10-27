<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import BaseModal from "../../components/BaseModal.vue";
import AppIcon from "../../components/AppIcon.vue";
import {
  listLocalForwards,
  startLocalForward,
  stopLocalForward,
} from "../../lib/api";
import type { PortForwardInfo } from "../../lib/types";
import { errorMessage } from "../../lib/format";
const props = defineProps<{
  sessionId: string;
  hostName: string;
  closed: boolean;
}>();
const emit = defineEmits<{ close: [] }>();
const forwards = ref<PortForwardInfo[]>([]),
  host = ref("127.0.0.1"),
  port = ref(5432),
  local = ref(0),
  busy = ref(false),
  error = ref("");
let alive = true,
  generation = 0;
async function refresh() {
  const request = ++generation;
  if (props.closed) {
    forwards.value = [];
    return;
  }
  try {
    const items = await listLocalForwards(props.sessionId);
    if (alive && request === generation) forwards.value = items;
  } catch (e) {
    if (alive && request === generation) error.value = errorMessage(e);
  }
}
async function start() {
  if (busy.value || props.closed) return;
  const request = generation;
  busy.value = true;
  error.value = "";
  try {
    await startLocalForward(
      props.sessionId,
      host.value.trim(),
      Number(port.value),
      Number(local.value),
    );
    if (alive && request === generation && !props.closed) await refresh();
  } catch (e) {
    if (alive && request === generation) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
async function stop(id: string) {
  busy.value = true;
  error.value = "";
  try {
    await stopLocalForward(id);
    if (alive) forwards.value = forwards.value.filter((f) => f.id !== id);
  } catch (e) {
    if (alive) error.value = errorMessage(e);
  } finally {
    if (alive) busy.value = false;
  }
}
onMounted(refresh);
watch(() => props.closed, refresh);
onBeforeUnmount(() => {
  alive = false;
  generation++;
});
</script>
<template>
  <BaseModal
    :title="`端口转发 · ${hostName}`"
    description="通过当前 SSH 连接访问远端服务，本地只监听 127.0.0.1。"
    :busy="busy"
    @close="emit('close')"
    ><p v-if="closed" class="notice" role="status">
      SSH 已断开，端口转发已停止。请重新连接服务器。
    </p>
    <form v-else class="form-stack" @submit.prevent="start">
      <label class="form-field"
        >远端服务地址<input v-model="host" required maxlength="253"
      /></label>
      <div class="form-grid">
        <label class="form-field"
          >远端服务端口<input
            v-model.number="port"
            required
            type="number"
            min="1"
            max="65535" /></label
        ><label class="form-field"
          >本地端口<input
            v-model.number="local"
            required
            type="number"
            min="0"
            max="65535"
        /></label>
      </div>
      <p class="form-note">
        本地端口填 0 自动分配空闲端口。SSH 断开时自动停止转发。
      </p>
      <a-button type="primary" html-type="submit" :loading="busy"
        >开启转发</a-button
      >
    </form>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <ul class="forward-list" aria-label="当前端口转发">
      <li v-for="f in forwards" :key="f.id">
        <AppIcon name="link" :size="18" />
        <div>
          <strong class="mono">127.0.0.1:{{ f.localPort }}</strong
          ><small>{{ f.remoteHost }}:{{ f.remotePort }}</small>
        </div>
        <a-button
          :disabled="busy"
          :aria-label="`停止转发 ${f.localPort}`"
          @click="stop(f.id)"
          >停止</a-button
        >
      </li>
    </ul>
    <p v-if="!closed && !forwards.length" class="form-note">
      当前没有端口转发。
    </p></BaseModal
  >
</template>
