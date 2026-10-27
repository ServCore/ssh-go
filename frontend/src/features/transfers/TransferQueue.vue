<script setup lang="ts">
import { ref } from "vue";
import BaseModal from "../../components/BaseModal.vue";
import AppIcon from "../../components/AppIcon.vue";
import RecoveryPanel from "./RecoveryPanel.vue";
import { useWorkspace } from "../../composables/workspace";
import { cancelTransfer, retryTransfer } from "../../lib/api";
import { formatBytes, errorMessage } from "../../lib/format";
import type { TransferInfo } from "../../lib/types";
const w = useWorkspace(),
  busy = ref(new Set<string>()),
  error = ref("");
const emit = defineEmits<{ close: [] }>();
const statuses: Record<TransferInfo["status"], string> = {
  queued: "排队中",
  preparing: "准备中",
  running: "传输中",
  committing: "正在提交",
  cancelling: "取消中",
  completed: "已完成",
  cancelled: "已取消",
  failed: "传输失败",
};
async function cancel(id: string) {
  busy.value.add(id);
  error.value = "";
  try {
    await cancelTransfer(id);
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value.delete(id);
  }
}
async function retry(id: string) {
  busy.value.add(id);
  error.value = "";
  try {
    w.updateTransfer(await retryTransfer(id));
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    busy.value.delete(id);
  }
}
function showFiles(t: TransferInfo) {
  const s = w.sessions.value.find((s) => t.sessionIds?.includes(s.id));
  if (s) {
    w.selectWorkspace(s, "files");
    emit("close");
  }
}
</script>
<template>
  <BaseModal
    title="传输队列"
    close-label="关闭传输队列"
    :width="720"
    @close="emit('close')"
    ><div class="transfer-summary">
      <span
        ><strong>{{ w.activeTransfers.value.length }}</strong> 项进行中</span
      ><span
        >{{
          w.transfers.value.filter((t) => t.status === "completed").length
        }}
        项已完成</span
      ><span>最多同时传输 4 项</span>
    </div>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <div class="transfer-list">
      <div v-if="!w.transfers.value.length" class="transfer-empty">
        <AppIcon name="swap" :size="30" /><strong>暂无传输任务</strong
        ><span>在 SFTP 文件面板中选择文件，开始上传或下载。</span>
      </div>
      <article
        v-for="t in [...w.transfers.value].reverse()"
        :key="t.id"
        class="transfer-item"
      >
        <span class="transfer-direction"
          ><AppIcon
            :name="t.direction === 'upload' ? 'upload' : 'download'"
            :size="19"
        /></span>
        <div class="transfer-item-main">
          <div>
            <strong :title="t.name">{{ t.name }}</strong
            ><span :class="{ danger: t.status === 'failed' }">{{
              statuses[t.status]
            }}</span>
          </div>
          <progress
            :value="t.bytesDone"
            :max="Math.max(1, t.bytesTotal)"
            :aria-label="`${t.name} 传输进度`"
          ></progress
          ><small
            >{{ formatBytes(t.bytesDone) }} / {{ formatBytes(t.bytesTotal)
            }}<span v-if="t.error"> · {{ t.error }}</span></small
          >
        </div>
        <div class="transfer-item-actions">
          <a-button
            v-if="['queued', 'preparing', 'running'].includes(t.status)"
            size="small"
            :disabled="busy.has(t.id)"
            @click="cancel(t.id)"
            >取消</a-button
          ><a-button
            v-if="['failed', 'cancelled'].includes(t.status)"
            size="small"
            :disabled="busy.has(t.id)"
            @click="retry(t.id)"
            >重试</a-button
          ><a-button
            v-if="
              t.sessionIds?.some((id) =>
                w.sessions.value.some((s) => s.id === id && !s.closed),
              )
            "
            type="text"
            size="small"
            @click="showFiles(t)"
            >查看文件</a-button
          >
        </div>
      </article>
    </div>
    <RecoveryPanel
  /></BaseModal>
</template>
